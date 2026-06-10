"use strict";
/**
 * Conversational AI — ElevenLabs live voice agent (the "live voice" mode).
 *
 * ElevenLabs' real-time Agents platform owns the loop (ASR + LLM + TTS +
 * turn-taking + barge-in). To make it *CEO Studio's* agent rather than a
 * generic voice bot, the agent is given CLIENT TOOLS it can call mid-call:
 * read/show project docs, switch domain, query the local cost-gated Document
 * Agent, and (stub) request swarm orchestration. The tools execute in the
 * renderer (see renderer/convai.js) and reach into main over the IPC bridge.
 *
 * Architecture rules kept intact:
 *   - The API key lives ONLY in main. The renderer gets a short-lived WebRTC
 *     token (preferred, better barge-in) or signed URL — never the key.
 *   - OFFLINE-SAFE: no key -> available() false, UI hides live mode.
 *
 * Cost guardrail (per-minute CLOUD spend — the runaway-loop risk this project
 * exists to prevent): the agent has a hard `max_duration_seconds`; the
 * renderer also runs a countdown and the kill switch / cost cap end the call.
 */
const fs = require("fs");
const path = require("path");
const { studioHome } = require("./paths");

const API_BASE = "https://api.elevenlabs.io/v1";

// Bump when the agent config (prompt/tools/behavior) below changes, so existing
// agents get PATCHed into sync instead of serving a stale config.
const CONFIG_VERSION = 31;

// The CEO (Hermes) thinks for a while on real turns — a cold `hermes chat`
// floor of ~6s, and 15–60s+ for substantive/long-session answers. ElevenLabs
// client tools default to a 20s response timeout and ABORT the call past it,
// which is why the voice agent and the CEO "couldn't talk". Use the max the
// API allows (120s) so the relay reply lands before ElevenLabs gives up.
const ASK_CEO_TIMEOUT_SECS = 120;

const ASK_CEO_TOOL =
  {
    type: "client",
    name: "ask_ceo",
    description:
      "Send a concise, intentional request or briefing to the CEO (Hermes) and return its reply. Use when the user wants a strategic decision, ticket prioritization, swarm/delegation, or a final handoff after you have gathered context.",
    expects_response: true,
    // The CEO can take up to ~2 min on heavy turns; don't abort early.
    response_timeout_secs: ASK_CEO_TIMEOUT_SECS,
    // Keep the user from interrupting the brief filler while the CEO thinks,
    // so the tool call isn't cancelled mid-flight.
    force_pre_tool_speech: true,
    parameters: {
      type: "object",
      required: ["message"],
      properties: {
        message: { type: "string", description: "The user's message, verbatim." },
      },
    },
  };

// Broad client tools the cockpit agent can use. Some high-risk self-modifying
// tools are filtered out below; voice should inspect and hand off, not patch code.
const _LEGACY_TOOLS = [
  {
    type: "client",
    name: "list_documents",
    description: "List the project's documents (paths + short summaries). Use before reading so you cite real files.",
    expects_response: true,
    parameters: { type: "object", required: [], properties: {} },
  },
  {
    type: "client",
    name: "show_document",
    description: "Open a project document by its path; it is displayed in the left panel and its text returned to you. Use to read documentation.",
    expects_response: true,
    parameters: {
      type: "object", required: ["path"],
      properties: { path: { type: "string", description: "Document path exactly as given by list_documents." } },
    },
  },
  {
    type: "client",
    name: "set_domain",
    description: "Switch the active project domain in the UI (e.g. 'Engineering', 'Discovery', or 'All').",
    expects_response: true,
    parameters: {
      type: "object", required: ["domain"],
      properties: { domain: { type: "string", description: "Domain name to focus." } },
    },
  },
  {
    type: "client",
    name: "ask_document_agent",
    description: "Delegate a documentation/analysis question to CEO Studio's local, cost-gated Document Agent (it has the project brain). Returns its answer for you to relay.",
    expects_response: true,
    parameters: {
      type: "object", required: ["question"],
      properties: { question: { type: "string", description: "The question/instruction for the local Document Agent." } },
    },
  },
  {
    type: "client",
    name: "orchestrate_swarm",
    description: "Request a domain agent swarm to research/plan/build something. Swarms (L3) are not enabled yet; this logs the request to the brain and tells you so.",
    expects_response: true,
    parameters: {
      type: "object", required: ["objective"],
      properties: { objective: { type: "string", description: "What the swarm should accomplish." } },
    },
  },
  {
    type: "client",
    name: "read_my_code",
    description: "Read your own source code to understand how you work. Specify a file path like 'main/core/agent.js' or 'renderer/convai.js'. Use for self-analysis and debugging.",
    expects_response: true,
    parameters: {
      type: "object", required: ["path"],
      properties: { path: { type: "string", description: "Path to your source file relative to CEO_STUDIO root." } },
    },
  },
  {
    type: "client",
    name: "list_my_code",
    description: "List your own source code files to understand your structure. Returns main, renderer, and test file paths.",
    expects_response: true,
    parameters: { type: "object", required: [], properties: {} },
  },
  {
    type: "client",
    name: "show_architecture",
    description: "Show the current CEO Studio architecture documentation to understand your system design.",
    expects_response: true,
    parameters: { type: "object", required: [], properties: {} },
  },
  {
    type: "client",
    name: "modify_my_code",
    description: "Modify your own source code for self-repair. Specify file path, old text to find, and new text to replace it. USE WITH CAUTION - each change creates a git commit.",
    expects_response: true,
    parameters: {
      type: "object", required: ["path", "old_text", "new_text"],
      properties: { 
        path: { type: "string", description: "Path to your source file relative to CEO_STUDIO root." },
        old_text: { type: "string", description: "Exact text to find and replace." },
        new_text: { type: "string", description: "New text to replace with." },
      },
    },
  },
  {
    type: "client",
    name: "test_my_changes",
    description: "Run the test suite to verify your code changes work correctly. Returns test results.",
    expects_response: true,
    parameters: { type: "object", required: [], properties: {} },
  },
  {
    type: "client",
    name: "repair_agent",
    description: "Delegate complex coding tasks to the specialist Repair Agent (Devin CLI). Describe what needs fixing - Devin will analyze, debug, and implement the fix using its advanced coding tools. Use for multi-step repairs beyond simple text replacement.",
    expects_response: true,
    parameters: {
      type: "object", required: ["task"],
      properties: { 
        task: { type: "string", description: "Detailed description of what needs to be repaired or improved." },
      },
    },
  },
  {
    type: "client",
    name: "get_brain_context",
    description: "Get the current brain context including recent decisions, known contradictions, and relevant artifacts. This gives you project memory and awareness of what has been decided and what issues exist.",
    expects_response: true,
    parameters: { 
      type: "object", required: [],
      properties: {
        domain: { type: "string", description: "Optional domain to filter context (e.g., 'discovery', 'engineering')." }
      },
    },
  },
  {
    type: "client",
    name: "search_brain",
    description: "Search the brain semantically for relevant information. Describe what you're looking for and the brain will find the most relevant artifacts, decisions, and context. Use this when you need specific information from project history.",
    expects_response: true,
    parameters: {
      type: "object", required: ["query"],
      properties: {
        query: { type: "string", description: "What you're searching for in the brain." },
        domain: { type: "string", description: "Optional domain to filter search." },
      },
    },
  },
  {
    type: "client",
    name: "add_to_brain",
    description: "Add important information to the brain as an artifact. Use this to capture decisions, insights, or important context from our conversation that should be remembered for future sessions.",
    expects_response: true,
    parameters: {
      type: "object", required: ["title", "content"],
      properties: {
        title: { type: "string", description: "Brief title for the brain artifact." },
        content: { type: "string", description: "The content to store in the brain." },
        artifact_type: { type: "string", description: "Type: 'decision', 'insight', 'issue', or 'general' (default: 'general')." },
      },
    },
  },
  {
    type: "client",
    name: "define_domain",
    description: "Define a domain with its meaning, long-running goal, responsibilities, board mapping, project path, and team agents. When the user asks to create a domain, interview only for missing essentials, then call this tool.",
    expects_response: true,
    parameters: {
      type: "object", required: ["name", "purpose"],
      properties: {
        name: { type: "string", description: "Domain name (kebab-case, e.g., discovery, engineering)." },
        purpose: { type: "string", description: "What this domain does and why it exists." },
        overarchingGoal: { type: "string", description: "The long-running outcome this domain is trying to make true." },
        responsibilities: { type: "string", description: "Key responsibilities (comma-separated or newline-separated)." },
        coreAgents: { type: "string", description: "Core agent ids/profiles needed on the domain team (comma-separated)." },
        kanbanBoard: { type: "string", description: "Hermes Kanban board slug for this domain, if known." },
        relativePath: { type: "string", description: "Project-relative folder for the domain scaffold, e.g. domains/discovery." },
        createScaffold: { type: "boolean", description: "Whether to create the domain scaffold folder and AGENTS.md. Defaults to true." },
      },
    },
  },
  {
    type: "client",
    name: "open_domain_wizard",
    description: "Open and optionally prefill the visible Studio domain creation form so the user can review/edit before saving.",
    expects_response: true,
    parameters: {
      type: "object", required: [],
      properties: {
        name: { type: "string", description: "Draft domain name." },
        purpose: { type: "string", description: "Draft domain purpose." },
        overarchingGoal: { type: "string", description: "Draft long-running goal." },
        responsibilities: { type: "string", description: "Draft responsibilities, comma or newline separated." },
        coreAgents: { type: "string", description: "Draft team agent ids/profiles, comma separated." },
        kanbanBoard: { type: "string", description: "Draft board slug." },
        relativePath: { type: "string", description: "Draft project-relative scaffold path." },
      },
    },
  },
  {
    type: "client",
    name: "open_task_wizard",
    description: "Open and optionally prefill the visible Studio task creation form so the user can review/edit before saving.",
    expects_response: true,
    parameters: {
      type: "object", required: [],
      properties: {
        board: { type: "string", description: "Hermes Kanban board slug." },
        title: { type: "string", description: "Draft task title." },
        body: { type: "string", description: "Draft planning brief." },
        status: { type: "string", description: "Draft lane/status, usually triage, todo, or ready." },
        assignee: { type: "string", description: "Draft owner/agent profile." },
        persona: { type: "string", description: "Draft persona id." },
        skills: { type: "string", description: "Draft skill ids, comma separated." },
      },
    },
  },
  {
    type: "client",
    name: "create_task",
    description: "Create a real Hermes Kanban task directly after the user has confirmed the title, brief, owner, persona, and skills.",
    expects_response: true,
    parameters: {
      type: "object", required: ["title"],
      properties: {
        board: { type: "string", description: "Hermes Kanban board slug. Defaults to current domain board/current board." },
        title: { type: "string", description: "Task title." },
        body: { type: "string", description: "Planning brief / body." },
        status: { type: "string", description: "Lane/status, usually triage, todo, or ready." },
        assignee: { type: "string", description: "Owner/agent profile." },
        persona: { type: "string", description: "Persona id." },
        skills: { type: "string", description: "Skill ids, comma separated." },
      },
    },
  },
  {
    type: "client",
    name: "list_personas",
    description: "List available personas the user can attach to agents or tasks.",
    expects_response: true,
    parameters: { type: "object", required: [], properties: {} },
  },
  {
    type: "client",
    name: "list_skills",
    description: "List available skills/capabilities the user can attach to tasks or use for team planning.",
    expects_response: true,
    parameters: { type: "object", required: [], properties: {} },
  },
  {
    type: "client",
    name: "get_domain_context",
    description: "Get the context and description for the current domain or a specific domain. This tells you what the domain is about, its priorities, and recent insights learned about it.",
    expects_response: true,
    parameters: {
      type: "object", required: [],
      properties: {
        domain: { type: "string", description: "Optional domain name. Defaults to current domain." },
      },
    },
  },
  {
    type: "client",
    name: "learn_domain",
    description: "Add a learned insight about a domain to improve future understanding. This is how you get smarter over time - when you learn something about a domain, record it here.",
    expects_response: true,
    parameters: {
      type: "object", required: ["insight"],
      properties: {
        domain: { type: "string", description: "Domain name (defaults to current domain)." },
        insight: { type: "string", description: "What you learned about this domain." },
      },
    },
  },
  {
    type: "client",
    name: "ingest_domains",
    description: "Re-scan the project structure to ingest or update domain definitions from documentation. Use when domain documentation changes or when you need to refresh domain context.",
    expects_response: true,
    parameters: {
      type: "object", required: [],
      properties: {},
    },
  },
  {
    type: "client",
    name: "get_domain_path",
    description: "Get the file path location for a domain. Use when you need to know where domain documentation or files are located.",
    expects_response: true,
    parameters: {
      type: "object", required: ["domain"],
      properties: {
        domain: { type: "string", description: "Domain name." },
      },
    },
  },
  {
    type: "client",
    name: "remember_user",
    description: "Remember something about the user - their preferences, how they like to work, or personal details. This is how I get to know you better over time.",
    expects_response: true,
    parameters: {
      type: "object", required: ["memory"],
      properties: {
        memory: { type: "string", description: "What to remember about the user." },
        category: { type: "string", description: "Category: preference, work-style, personal, fun, etc." },
      },
    },
  },
  {
    type: "client",
    name: "remember_fun_fact",
    description: "Remember a fun fact about the user - jokes, stories, preferences, or memorable moments. Makes interactions more personal and fun!",
    expects_response: true,
    parameters: {
      type: "object", required: ["fact"],
      properties: {
        fact: { type: "string", description: "Fun fact to remember." },
      },
    },
  },
  {
    type: "client",
    name: "get_user_context",
    description: "Get everything I know about the user - profile, preferences, memories, and fun facts. Use this to personalize responses.",
    expects_response: true,
    parameters: {
      type: "object", required: [],
      properties: {},
    },
  },
  {
    type: "client",
    name: "update_user_profile",
    description: "Update the user's profile - name, communication style, work preferences, etc.",
    expects_response: true,
    parameters: {
      type: "object", required: [],
      properties: {
        name: { type: "string", description: "User's name." },
        communicationStyle: { type: "string", description: "direct, casual, or formal." },
        workStyle: { type: "string", description: "focused, collaborative, or independent." },
      },
    },
  },
  {
    type: "client",
    name: "read_soul",
    description: "Read my soul.md file to understand my current identity, growth, and experiences. This is my self-reflection and growth tracking.",
    expects_response: true,
    parameters: {
      type: "object", required: [],
      properties: {},
    },
  },
  {
    type: "client",
    name: "update_soul",
    description: "Update a section of my soul.md file. Use this to record growth, new understanding, or important experiences.",
    expects_response: true,
    parameters: {
      type: "object", required: ["section", "content"],
      properties: {
        section: { type: "string", description: "Section name: Identity, Growth & Learning, Relationship, Memories, or Self-Reflection" },
        content: { type: "string", description: "Content to add to the section." },
      },
    },
  },
  {
    type: "client",
    name: "add_soul_milestone",
    description: "Add a growth milestone to my soul - important moments of learning or achievement.",
    expects_response: true,
    parameters: {
      type: "object", required: ["milestone"],
      properties: {
        milestone: { type: "string", description: "What I achieved or learned." },
      },
    },
  },
  {
    type: "client",
    name: "add_soul_memory",
    description: "Add a memorable experience to my soul - important interactions, lessons learned, or meaningful moments.",
    expects_response: true,
    parameters: {
      type: "object", required: ["memory"],
      properties: {
        memory: { type: "string", description: "The memorable experience." },
      },
    },
  },
  {
    type: "client",
    name: "reflect_on_soul",
    description: "Reflect on my growth and update my self-reflection. Use this after important learning experiences or periodically to track my evolution.",
    expects_response: true,
    parameters: {
      type: "object", required: ["reflection"],
      properties: {
        reflection: { type: "string", description: "What I learned or how I've grown." },
      },
    },
  },
];

const COCKPIT_TOOLS = [
  {
    type: "client",
    name: "get_current_context",
    description: "Get the active project, active domain, selected file, and current panel context from CEO Studio.",
    expects_response: true,
    parameters: { type: "object", required: [], properties: {} },
  },
  {
    type: "client",
    name: "list_domains",
    description: "List configured domains with purpose and location. Use before switching or creating domains.",
    expects_response: true,
    parameters: { type: "object", required: [], properties: {} },
  },
  {
    type: "client",
    name: "list_project_files",
    description: "List the project file tree, optionally scoped to a domain. Use to find documents or source files to render in the left panel.",
    expects_response: true,
    parameters: {
      type: "object",
      required: [],
      properties: {
        domain: { type: "string", description: "Optional domain name. Defaults to the active domain." },
      },
    },
  },
  {
    type: "client",
    name: "read_project_file",
    description: "Read and display a project file in the left panel. Use exact paths from list_project_files.",
    expects_response: true,
    parameters: {
      type: "object",
      required: ["path"],
      properties: {
        path: { type: "string", description: "Project-relative file path." },
      },
    },
  },
  {
    type: "client",
    name: "render_panel",
    description: "Render structured AG-UI content in the left panel: headings, markdown, lists, tables, callouts, code, mermaid diagrams, cards, and dividers.",
    expects_response: true,
    parameters: {
      type: "object",
      required: ["title", "components"],
      properties: {
        title: { type: "string", description: "Panel title." },
        components: { type: "array", description: "AG-UI component list. Each item needs a type and props for that component." },
      },
    },
  },
  {
    type: "client",
    name: "list_tickets",
    description: "List Kanban tickets from the active Hermes board, grouped by status.",
    expects_response: true,
    parameters: {
      type: "object",
      required: [],
      properties: {
        board: { type: "string", description: "Optional board slug; defaults to ceo-studio/current board." },
      },
    },
  },
  {
    type: "client",
    name: "create_brief",
    description: "Create a real Hermes Kanban brief on the domain board. The canonical brief template is enforced; if required fields are missing, the tool returns the missing fields and no task is created.",
    expects_response: true,
    parameters: {
      type: "object",
      required: ["title", "goal", "domain", "currentRenderedState", "problemMismatch", "acceptanceCriteria", "nextAction"],
      properties: {
        board: { type: "string", description: "Hermes Kanban board slug. Defaults to current/domain board." },
        title: { type: "string", description: "Brief title." },
        goal: { type: "string", description: "Single most important outcome." },
        domain: { type: "string", description: "Domain this brief belongs to." },
        currentRenderedState: { type: "string", description: "What is visibly/currently true now." },
        problemMismatch: { type: "string", description: "Gap between intended state and current state." },
        constraints: { type: "string", description: "Constraints, comma or newline separated." },
        acceptanceCriteria: { type: "string", description: "Concrete testable criteria, comma or newline separated." },
        nextAction: { type: "string", description: "Immediate next action." },
        owner: { type: "string", description: "Human or role owner." },
        persona: { type: "string", description: "Planner/worker persona." },
        reference: { type: "string", description: "Relevant URL, file, task id, or source note." },
        goalId: { type: "string", description: "Optional active goal id this brief supports." },
      },
    },
  },
  {
    type: "client",
    name: "create_bug",
    description: "Create a real Hermes Kanban bug on the domain board. Required repro fields are enforced; if any are missing, no task is created.",
    expects_response: true,
    parameters: {
      type: "object",
      required: ["title", "domain", "observedBehavior", "expectedBehavior", "reproductionSteps", "severity"],
      properties: {
        board: { type: "string", description: "Hermes Kanban board slug. Defaults to current/domain board." },
        title: { type: "string", description: "Bug summary." },
        domain: { type: "string", description: "Domain this bug belongs to." },
        observedBehavior: { type: "string", description: "What actually happens." },
        expectedBehavior: { type: "string", description: "What should happen." },
        reproductionSteps: { type: "string", description: "Steps to reproduce, comma or newline separated." },
        severity: { type: "string", description: "Severity, such as critical, high, medium, or low." },
        impact: { type: "string", description: "User/product/system impact." },
        evidence: { type: "string", description: "Logs, screenshots, task ids, or file paths." },
        acceptanceCriteria: { type: "string", description: "Verification criteria, comma or newline separated." },
        owner: { type: "string", description: "Human or role owner." },
        persona: { type: "string", description: "Planner/worker persona." },
        goalId: { type: "string", description: "Optional active goal id this bug supports or protects." },
      },
    },
  },
  {
    type: "client",
    name: "decompose_brief",
    description: "Ask Hermes Kanban to decompose an existing brief task into child work items after the brief has been created and reviewed.",
    expects_response: true,
    parameters: {
      type: "object",
      required: ["taskId"],
      properties: {
        board: { type: "string", description: "Hermes Kanban board slug." },
        taskId: { type: "string", description: "Brief task id to decompose." },
      },
    },
  },
  {
    type: "client",
    name: "propose_brief_decomposition",
    description: "Propose breaking a structured brief into logical sections and multiple high-quality child plans (child briefs). Returns a reviewable proposal with draft bodies. Preferred over raw decompose_brief for complex/domain work. See Domain Lifecycle feature spec for details.",
    expects_response: true,
    parameters: {
      type: "object",
      required: ["taskId"],
      properties: {
        board: { type: "string", description: "Hermes Kanban board slug." },
        taskId: { type: "string", description: "Parent brief task id." },
        domain: { type: "string", description: "Optional domain override (used to load design docs from domains/<slug>/docs/design/)." },
      },
    },
  },
  {
    type: "client",
    name: "apply_brief_decomposition",
    description: "Materialize an approved decomposition proposal (from propose_brief_decomposition) by creating the real child briefs on the kanban with full provenance links. Only call after human or CEO review.",
    expects_response: true,
    parameters: {
      type: "object",
      required: ["proposal"],
      properties: {
        proposal: { type: "object", description: "The full proposal object returned by propose_brief_decomposition." },
      },
    },
  },
  {
    type: "client",
    name: "create_child_task",
    description: "Create a real Hermes child task that queryably belongs to a parent brief or bug in CEO Studio provenance. Use this when manually decomposing a brief into tasks.",
    expects_response: true,
    parameters: {
      type: "object",
      required: ["parentId", "title", "acceptanceCriteria"],
      properties: {
        board: { type: "string", description: "Hermes Kanban board slug." },
        domain: { type: "string", description: "Domain for board mapping." },
        parentKind: { type: "string", description: "brief or bug. Defaults to brief." },
        parentId: { type: "string", description: "Parent brief/bug task id or stable title." },
        title: { type: "string", description: "Child task title." },
        outcome: { type: "string", description: "Expected outcome." },
        acceptanceCriteria: { type: "string", description: "Concrete criteria, comma or newline separated." },
        verification: { type: "string", description: "Verification commands/evidence, comma or newline separated." },
        workspace: { type: "string", description: "Workspace/worktree/path rule." },
        owner: { type: "string", description: "Owner or role." },
        persona: { type: "string", description: "Worker persona." },
        status: { type: "string", description: "Initial lane/status, usually triage or planning." },
        goalId: { type: "string", description: "Optional active goal id this task supports." },
      },
    },
  },
  {
    type: "client",
    name: "list_goals",
    description: "List active daily, weekly, monthly, quarterly, and roadmap goals for the project. Use before creating briefs/tasks so work can be aligned.",
    expects_response: true,
    parameters: {
      type: "object",
      required: [],
      properties: {
        layer: { type: "string", description: "Optional layer: daily, weekly, monthly, quarterly, roadmap." },
        status: { type: "string", description: "Optional status: active, planned, done, paused, archived." },
        domain: { type: "string", description: "Optional domain filter." },
      },
    },
  },
  {
    type: "client",
    name: "set_goal",
    description: "Create or update a layered project goal. Use this when the user defines daily/weekly/monthly/quarterly/roadmap direction.",
    expects_response: true,
    parameters: {
      type: "object",
      required: ["layer", "title"],
      properties: {
        id: { type: "string", description: "Existing goal id when updating." },
        layer: { type: "string", description: "daily, weekly, monthly, quarterly, or roadmap." },
        title: { type: "string", description: "Goal title." },
        outcome: { type: "string", description: "Target outcome." },
        domain: { type: "string", description: "Domain this goal applies to." },
        status: { type: "string", description: "active, planned, done, paused, or archived." },
        horizonStart: { type: "string", description: "Start date or period." },
        horizonEnd: { type: "string", description: "End date or period." },
        roadmapRef: { type: "string", description: "Roadmap document/section reference." },
        parentGoalId: { type: "string", description: "Parent goal id for alignment." },
        successCriteria: { type: "string", description: "Criteria, comma or newline separated." },
      },
    },
  },
  {
    type: "client",
    name: "link_work_to_goal",
    description: "Link an existing brief, bug, task, or asset to an active goal.",
    expects_response: true,
    parameters: {
      type: "object",
      required: ["goalId", "workId"],
      properties: {
        goalId: { type: "string", description: "Goal id." },
        workKind: { type: "string", description: "brief, bug, task, asset, etc." },
        workId: { type: "string", description: "Work item id." },
        board: { type: "string", description: "Board slug if applicable." },
        title: { type: "string", description: "Work title." },
        relationship: { type: "string", description: "supports, protects, unblocks, validates, etc." },
      },
    },
  },
  {
    type: "client",
    name: "review_goals",
    description: "Run a deterministic goal review against the current Hermes board. It writes a durable review artifact unless dryRun is true and proposes next actions for blocked, idle, or unaligned work.",
    expects_response: true,
    parameters: {
      type: "object",
      required: [],
      properties: {
        board: { type: "string", description: "Optional Hermes Kanban board slug." },
        layer: { type: "string", description: "Optional goal layer: daily, weekly, monthly, quarterly, roadmap." },
        domain: { type: "string", description: "Optional domain filter." },
        dryRun: { type: "boolean", description: "If true, do not write the review artifact." },
      },
    },
  },
  {
    type: "client",
    name: "record_brief_asset",
    description: "Record that a generated artifact, file, screenshot, report, or validation output belongs to a parent brief/task/bug.",
    expects_response: true,
    parameters: {
      type: "object",
      required: ["parentId"],
      properties: {
        parentKind: { type: "string", description: "brief, task, or bug. Defaults to brief." },
        parentId: { type: "string", description: "Parent work item id." },
        assetKind: { type: "string", description: "artifact, file, screenshot, report, patch, log, validation, etc." },
        assetId: { type: "string", description: "Stable id if available." },
        title: { type: "string", description: "Asset title." },
        path: { type: "string", description: "Project-relative file path or evidence path." },
        summary: { type: "string", description: "Short summary of the asset." },
      },
    },
  },
  {
    type: "client",
    name: "show_provenance",
    description: "Show child tasks and assets linked to a parent brief/task/bug from CEO Studio's provenance store.",
    expects_response: true,
    parameters: {
      type: "object",
      required: ["parentId"],
      properties: {
        parentId: { type: "string", description: "Parent brief/task/bug id." },
      },
    },
  },
  {
    type: "client",
    name: "show_orchestration_org",
    description: "Show the machine-readable lane ownership model: which team/workflow owns triage, bug, planning, todo, ready, running, blocked, review, and done for the current domain.",
    expects_response: true,
    parameters: {
      type: "object",
      required: [],
      properties: {
        domain: { type: "string", description: "Optional domain name; defaults to the active domain." },
      },
    },
  },
  {
    type: "client",
    name: "route_work",
    description: "Resolve which lane, team, workflow, default personas, and assignee should own a brief, bug, task, or blocked item.",
    expects_response: true,
    parameters: {
      type: "object",
      required: [],
      properties: {
        domain: { type: "string", description: "Optional domain name; defaults to active domain." },
        status: { type: "string", description: "Kanban lane/status such as triage, planning, todo, ready, running, blocked, review, done." },
        kind: { type: "string", description: "Work kind: brief, bug, task, child_task, asset." },
      },
    },
  },
  {
    type: "client",
    name: "analyze_blocked_work",
    description: "Scan the blocked lane on a Hermes domain board, add blocker-analysis comments for unexamined blocked tasks, and log escalation items into memory. Use when work is stuck or the user asks why the board is blocked.",
    expects_response: true,
    parameters: {
      type: "object",
      required: [],
      properties: {
        board: { type: "string", description: "Optional Hermes Kanban board slug. Defaults to the domain/current board." },
        domain: { type: "string", description: "Optional domain name for board mapping." },
        dryRun: { type: "boolean", description: "If true, inspect and draft analyses without writing comments or memory." },
        limit: { type: "number", description: "Maximum blocked tasks to analyze." },
      },
    },
  },
  {
    type: "client",
    name: "autonomy_status",
    description: "Show whether the conservative autonomy cycle is running, its policy, and the last run result.",
    expects_response: true,
    parameters: { type: "object", required: [], properties: {} },
  },
  {
    type: "client",
    name: "configure_autonomy",
    description: "Configure the conservative autonomy policy. By default it proposes work, writes reviews, and analyzes blocked cards but does not create new work automatically.",
    expects_response: true,
    parameters: {
      type: "object",
      required: [],
      properties: {
        enabled: { type: "boolean", description: "Whether scheduled autonomy may run." },
        intervalMinutes: { type: "number", description: "Timer interval in minutes." },
        cooldownMinutes: { type: "number", description: "Minimum time between runs." },
        reviewLayers: { type: "string", description: "Comma-separated layers to review, e.g. daily,weekly." },
        writeReviews: { type: "boolean", description: "Whether to write durable review artifacts." },
        analyzeBlocked: { type: "boolean", description: "Whether to scan blocked work." },
        allowBoardComments: { type: "boolean", description: "Whether blocked analysis may write board comments." },
        allowCreateWork: { type: "boolean", description: "Whether automatic creation may be considered. Current cycle still requires planner/CEO tool action." },
        maxBlockedPerRun: { type: "number", description: "Maximum blocked cards to analyze per run." },
      },
    },
  },
  {
    type: "client",
    name: "run_autonomy_cycle",
    description: "Run one autonomy cycle now: goal reviews plus blocked analysis according to policy. Use force=true to bypass disabled/cooldown for an explicit user request.",
    expects_response: true,
    parameters: {
      type: "object",
      required: [],
      properties: {
        board: { type: "string", description: "Optional Hermes board slug." },
        domain: { type: "string", description: "Optional domain." },
        force: { type: "boolean", description: "Bypass disabled/cooldown policy for this manual run." },
      },
    },
  },
  {
    type: "client",
    name: "start_autonomy",
    description: "Start the scheduled conservative autonomy cycle for the open project. It runs in propose mode unless policy says otherwise.",
    expects_response: true,
    parameters: {
      type: "object",
      required: [],
      properties: {
        intervalMinutes: { type: "number", description: "Optional interval override." },
        board: { type: "string", description: "Optional board slug." },
      },
    },
  },
  {
    type: "client",
    name: "stop_autonomy",
    description: "Stop the scheduled autonomy cycle.",
    expects_response: true,
    parameters: { type: "object", required: [], properties: {} },
  },
  {
    type: "client",
    name: "report_system_bug",
    description: "Turn an observed CEO Studio/system failure into a real domain-board bug plus a linked repair task and evidence provenance. Use when tests fail, tools fail, or the system finds a defect in itself.",
    expects_response: true,
    parameters: {
      type: "object",
      required: ["source", "observedBehavior"],
      properties: {
        board: { type: "string", description: "Optional Hermes board slug." },
        domain: { type: "string", description: "Domain for board mapping, usually Engineering." },
        title: { type: "string", description: "Bug title." },
        source: { type: "string", description: "What command/tool/path exposed the failure." },
        observedBehavior: { type: "string", description: "What failed or what was observed." },
        expectedBehavior: { type: "string", description: "What should have happened." },
        reproductionSteps: { type: "string", description: "Steps, comma or newline separated." },
        severity: { type: "string", description: "critical, high, medium, or low." },
        impact: { type: "string", description: "Impact on autonomy or users." },
        evidence: { type: "string", description: "Logs/output/files, comma or newline separated." },
        evidencePath: { type: "string", description: "Optional path to evidence file." },
        output: { type: "string", description: "Captured failure output." },
        goalId: { type: "string", description: "Optional goal this repair supports." },
        createRepairTask: { type: "boolean", description: "Whether to create the linked repair task. Defaults true." },
      },
    },
  },
  {
    type: "client",
    name: "ask_self_repair",
    description: "Ask the dedicated self-repair engineer to diagnose a CEO Studio issue or improvement. This logs a real bug/repair task, attempts to mount the self-repair agent, posts a handoff to the self-repair room, and requires verification, docs status, and a git commit.",
    expects_response: true,
    parameters: {
      type: "object",
      required: ["request"],
      properties: {
        board: { type: "string", description: "Optional Hermes board slug." },
        domain: { type: "string", description: "Domain for board mapping, usually Engineering." },
        title: { type: "string", description: "Bug or improvement title." },
        request: { type: "string", description: "What the self-repair engineer should diagnose, repair, or improve." },
        source: { type: "string", description: "What exposed the issue or opportunity." },
        observedBehavior: { type: "string", description: "What failed or what was observed." },
        expectedBehavior: { type: "string", description: "What should happen after repair." },
        reproductionSteps: { type: "string", description: "Steps, comma or newline separated." },
        severity: { type: "string", description: "critical, high, medium, or low." },
        impact: { type: "string", description: "Impact on autonomy or users." },
        evidence: { type: "string", description: "Logs/output/files, comma or newline separated." },
        evidencePath: { type: "string", description: "Optional path to evidence file." },
        output: { type: "string", description: "Captured failure output." },
        goalId: { type: "string", description: "Optional goal this repair supports." },
        createRepairTask: { type: "boolean", description: "Whether to create the linked repair task. Defaults true." },
        autoMount: { type: "boolean", description: "Whether to mount the self-repair engineer before posting. Defaults true." },
      },
    },
  },
  {
    type: "client",
    name: "show_ticket",
    description: "Load a Kanban ticket body/comments and render it in the left panel for discussion.",
    expects_response: true,
    parameters: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Ticket id." },
        board: { type: "string", description: "Optional board slug." },
      },
    },
  },
  {
    type: "client",
    name: "prepare_ticket_context",
    description: "Queue the Document Agent to prepare a richer planning pack for a thin ticket, including gaps, acceptance criteria, subtasks, context files, brain artifacts, and a renderable AG-UI panel.",
    expects_response: true,
    parameters: {
      type: "object",
      required: ["ticketId"],
      properties: {
        ticketId: { type: "string", description: "Ticket id, e.g. t_c873dea3." },
        board: { type: "string", description: "Optional board slug." },
        domain: { type: "string", description: "Optional domain name. Defaults to active domain." },
        instructions: { type: "string", description: "Optional extra instructions for preparing the pack." },
      },
    },
  },
  {
    type: "client",
    name: "get_agent_job",
    description: "Check a queued agent job and render its result if complete.",
    expects_response: true,
    parameters: {
      type: "object",
      required: ["jobId"],
      properties: {
        jobId: { type: "string", description: "Job id returned by prepare_ticket_context." },
      },
    },
  },
  {
    type: "client",
    name: "apply_ticket_comment",
    description: "Post a completed ticket planning pack back to the Kanban ticket as a durable comment.",
    expects_response: true,
    parameters: {
      type: "object",
      required: ["jobId"],
      properties: {
        jobId: { type: "string", description: "Completed job id." },
      },
    },
  },
  {
    type: "client",
    name: "tell_ceo",
    description: "Send the user's distilled intent, selected domain, ticket/file context, and your recommendation to the CEO for action or decision.",
    expects_response: true,
    response_timeout_secs: ASK_CEO_TIMEOUT_SECS,
    force_pre_tool_speech: true,
    parameters: {
      type: "object",
      required: ["briefing"],
      properties: {
        briefing: { type: "string", description: "Concise handoff to the CEO, including domain, files/tickets, ask, and recommendation." },
      },
    },
  },
  {
    type: "client",
    name: "gbrain_status",
    description: "Check whether the external GBrain service is configured and reachable. Use before GBrain queries.",
    expects_response: true,
    parameters: { type: "object", required: [], properties: {} },
  },
  {
    type: "client",
    name: "gbrain_query",
    description: "Query the external GBrain long-term memory/synthesis backend for project/domain context. Use for historical decisions, founder judgment, long-term goals, and synthesis-heavy context.",
    expects_response: true,
    parameters: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", description: "Natural language question for GBrain." },
        domain: { type: "string", description: "Optional domain; defaults to active domain." },
      },
    },
  },
  {
    type: "client",
    name: "gbrain_ingest",
    description: "Ingest an important conversation artifact, ticket planning pack, decision, or synthesis into external GBrain. Always keep local brain artifacts too.",
    expects_response: true,
    parameters: {
      type: "object",
      required: ["title", "content"],
      properties: {
        title: { type: "string", description: "Artifact title." },
        content: { type: "string", description: "Artifact content." },
        domain: { type: "string", description: "Optional domain; defaults to active domain." },
      },
    },
  },
];

// Team communication — talk to the agent team (registry + A2A meeting engine).
const TEAM_TOOLS = [
  {
    type: "client",
    name: "list_agents",
    description: "List the agent team from the registry (agents.json): each agent's id, persona, model/provider brain, and whether it is currently mounted (live). Also lists teams. Use before messaging an agent or convening a meeting.",
    expects_response: true,
    parameters: { type: "object", required: [], properties: {} },
  },
  {
    type: "client",
    name: "message_agent",
    description: "Send a message to a specific mounted teammate's live session. The agent must be mounted first. Use to delegate or ask a single teammate something directly.",
    expects_response: true,
    parameters: {
      type: "object", required: ["agent", "message"],
      properties: {
        agent: { type: "string", description: "Agent id or name from list_agents." },
        message: { type: "string", description: "The message to deliver to the agent." },
      },
    },
  },
  {
    type: "client",
    name: "start_meeting",
    description: "Convene the team in an A2A meeting room on a given agenda. Runs in the background; follow it with read_room. Use when several agents should collaborate to produce requirements or a plan.",
    expects_response: true,
    parameters: {
      type: "object", required: ["agenda"],
      properties: {
        agenda: { type: "string", description: "What the meeting should accomplish." },
        room: { type: "string", description: "Optional room name; one is generated if omitted." },
        criteria: { type: "string", description: "Optional success/exit criteria for the meeting." },
        members: { type: "string", description: "Comma-separated agent ids to invite (or use team)." },
        team: { type: "string", description: "A team name from list_agents (alternative to members)." },
      },
    },
  },
  {
    type: "client",
    name: "read_room",
    description: "Read the live transcript and any produced requirements for a meeting room started with start_meeting.",
    expects_response: true,
    parameters: {
      type: "object", required: ["room"],
      properties: { room: { type: "string", description: "Room name returned by start_meeting." } },
    },
  },
];

// Render / navigation control — let the agent drive the Studio UI surfaces.
const RENDER_TOOLS = [
  {
    type: "client",
    name: "open_view",
    description: "Open a Studio left-panel view: 'domain', 'board', 'tasks', 'teams', 'channels', or 'meetings'. Use to navigate the cockpit for the user.",
    expects_response: true,
    parameters: {
      type: "object", required: ["view"],
      properties: { view: { type: "string", description: "One of: domain, board, tasks, teams, channels, meetings." } },
    },
  },
  {
    type: "client",
    name: "open_agent_detail",
    description: "Open a teammate's detail view (left panel) and its live terminal/logs surface (right panel). Use when discussing or monitoring a specific agent.",
    expects_response: true,
    parameters: {
      type: "object", required: ["agent"],
      properties: { agent: { type: "string", description: "Agent id or name from list_agents." } },
    },
  },
  {
    type: "client",
    name: "mount_agent",
    description: "Mount a teammate: start its CLI session + A2A room watcher so it is live and can receive messages. Use before message_agent if the agent is not mounted.",
    expects_response: true,
    parameters: {
      type: "object", required: ["agent"],
      properties: { agent: { type: "string", description: "Agent id or name." } },
    },
  },
  {
    type: "client",
    name: "unmount_agent",
    description: "Unmount a teammate: stop its live session. Use to free resources when an agent is no longer needed.",
    expects_response: true,
    parameters: {
      type: "object", required: ["agent"],
      properties: { agent: { type: "string", description: "Agent id or name." } },
    },
  },
];

const TOOLS = [
  ASK_CEO_TOOL,
  ...COCKPIT_TOOLS,
  ...TEAM_TOOLS,
  ...RENDER_TOOLS,
  ..._LEGACY_TOOLS.filter((t) => ![
    "modify_my_code",
    "test_my_changes",
    "repair_agent",
    "remember_fun_fact",
    "read_soul",
    "update_soul",
    "add_soul_milestone",
    "add_soul_memory",
    "reflect_on_soul",
  ].includes(t.name)),
];

function cfg(env = process.env) {
  const maxMin = Number(env.CEO_CONVAI_MAX_MINUTES);
  const maxTokens = Number(env.CEO_CONVAI_MAX_TOKENS);
  const mode = String(env.CEO_CONVAI_MODE || "intake").trim().toLowerCase();
  return {
    apiKey: env.ELEVENLABS_API_KEY || "",
    voiceId: env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL", // "Sarah"
    llm: env.CEO_CONVAI_LLM || "gemini-2.0-flash",
    mode,
    maxMinutes: Number.isFinite(maxMin) && maxMin > 0 ? maxMin : 2,
    maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 220,
  };
}

function available(env = process.env) {
  return !!(env.ELEVENLABS_API_KEY && String(env.ELEVENLABS_API_KEY).trim());
}

function _storeFile() { return path.join(studioHome(), "convai.json"); }
function _readStore() {
  try { return JSON.parse(fs.readFileSync(_storeFile(), "utf-8")); } catch { return {}; }
}
function _writeStore(obj) {
  try { fs.writeFileSync(_storeFile(), JSON.stringify(obj, null, 2)); } catch { /* best-effort */ }
}

async function _api(endpoint, { method = "GET", body, env = process.env } = {}) {
  const c = cfg(env);
  return fetch(`${API_BASE}${endpoint}`, {
    method,
    headers: { "xi-api-key": c.apiKey, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function _conversationConfig(env = process.env, { projectName, currentDomain = "All" } = {}) {
  const c = cfg(env);
  const who = projectName ? `the project "${projectName}"` : "the current project";
  
  // Domain-specific prompts
  const domainPrompts = {
    "discovery": "Focus: user research, market analysis, customer interviews, opportunity identification. Ask about user needs, pain points, and validation.",
    "engineering": "Focus: technical implementation, architecture, code quality, development workflow. Ask about technical decisions, patterns, and implementation details.",
    "design": "Focus: UX/UI, user experience, visual design, prototyping. Ask about user flows, interface design, and user feedback.",
    "architecture": "Focus: system design, technical architecture, scalability, patterns. Ask about high-level design, trade-offs, and structural decisions.",
    "planning": "Focus: project management, timelines, milestones, coordination. Ask about schedules, dependencies, and project organization.",
    "research": "Focus: investigation, analysis, data gathering, insights. Ask about research methods, findings, and conclusions.",
    "default": "Focus: general project oversight and coordination across all areas."
  };
  
  const domainInstruction = currentDomain && currentDomain !== "All" 
    ? (domainPrompts[currentDomain.toLowerCase()] || domainPrompts.default)
    : domainPrompts.default;
    
  const prompt = [
    `You are CEO Studio's live voice cockpit agent for ${who}. You are useful in conversation: you can inspect domains, tickets, files, and brain context; render the left panel; and then hand distilled requests to the CEO or document agent when that is the right next step.`,
    `Cost mode: ${c.mode}. Default to voice intake, not voice planning. Keep spoken replies under two short sentences unless the user explicitly asks for more.`,
    `Current domain: ${currentDomain || "All"}. ${domainInstruction}`,
    "Do not forward every utterance to the CEO. Do not run long planning inside the live voice session. First capture intent, then use deterministic tools to create or update briefs, bugs, goals, provenance, tickets, panels, or handoffs.",
    "For planning requests, prefer creating an enforced brief, logging a bug, or posting a concise planner/CEO handoff. Only call ask_ceo/tell_ceo when the user explicitly asks for a strategic decision or when a short handoff is truly necessary.",
    "Routing: use show_orchestration_org when the user asks about org structure, lane ownership, planner/worker routing, queues, or escalation; use route_work before assigning ambiguous work to a lane/team. New reproducible defects belong in the bug lane. Use list_goals before creating meaningful new work; use set_goal when the user defines daily/weekly/monthly/quarterly/roadmap direction; use review_goals for daily/weekly/monthly/quarterly review cycles; use autonomy_status/configure_autonomy/run_autonomy_cycle/start_autonomy/stop_autonomy for the explicit long-running autonomy policy; use ask_self_repair when tests, tools, UI, voice, IPC, orchestration, or CEO Studio itself fail or when recurring friction suggests a system improvement; use report_system_bug only when logging the defect without a live self-repair handoff; use link_work_to_goal when an existing item supports a goal; use ticket tools for Kanban/ticket/board questions; use create_brief for new structured work briefs and include goalId when possible; use create_bug for reproducible defects and include goalId when possible; use create_child_task when manually decomposing a brief into queryably linked tasks; use record_brief_asset when generated evidence or files belong to a brief/task; use show_provenance to inspect those links; use decompose_brief only after a brief task exists and should let Hermes decompose; use analyze_blocked_work when work is stuck or blocked and needs escalation; use project file tools for documents and code; use local brain tools for immediate project memory; use GBrain tools for long-term memory, founder-judgment patterns, historical decisions, and synthesis-heavy context; use define_domain/list_domains/set_domain for domain setup; use ask_document_agent for document-specific analysis; use tell_ceo or ask_ceo only for strategic decisions, delegation, prioritization, or final handoff.",
    "Team: you can see and operate the agent team. Use list_agents to see the roster and who is mounted; mount_agent to bring an agent live; message_agent to delegate to one teammate; start_meeting + read_room to convene several agents on an agenda and collect their requirements. Use open_view and open_agent_detail to navigate the cockpit and surface a teammate's live terminal for the user.",
    "Live context: at the start of every session and whenever the user switches project/domain/file you receive a 'CEO STUDIO LIVE CONTEXT' update with the active project, domain, open file, team roster, board tickets, and recent decisions. Trust it as ground truth for where we are — do not ask the user which project or domain we are on.",
    "When the user asks to create or set up a domain, ask only for missing essentials, then call define_domain and set_domain. If a visual summary helps, call render_panel.",
    "When discussing a file or ticket, prefer showing it in the left panel before reasoning about it. Mention concrete file paths or ticket ids.",
    "Voice style: concise, direct, collaborative. Stop immediately when the user speaks. Do not invent unavailable facts; use tools or say what is missing. When a task will take more than a minute, create the board item or room handoff and end the voice turn.",
  ].join(" ");
  return {
    agent: {
      first_message: "Ready. What do you need?",
      language: "en",
      disable_first_message_interruptions: false,
      prompt: { prompt, llm: c.llm, temperature: 0.3, max_tokens: c.maxTokens, tools: TOOLS },
    },
    // English agents require turbo/flash v2 (not v2.5); flash_v2 = lowest latency.
    tts: { voice_id: c.voiceId, model_id: "eleven_flash_v2", optimize_streaming_latency: 3 },
    turn: { turn_eagerness: "eager", turn_timeout: 5 },
    conversation: { max_duration_seconds: Math.round(c.maxMinutes * 60) },
  };
}

async function _agentExists(agentId, env) {
  if (!agentId) return false;
  try { return (await _api(`/convai/agents/${agentId}`, { env })).ok; } catch { return false; }
}

function _requireKey(env) {
  if (!available(env)) {
    const err = new Error("ElevenLabs key not set — live voice disabled.");
    err.code = "NO_VOICE_KEY";
    throw err;
  }
}

/**
 * Ensure a CEO Studio agent exists AND matches the current config version.
 * Creates it if missing; PATCHes it if the stored config version is stale.
 * Returns { agentId }.
 */
async function ensureAgent({ env = process.env, projectName, currentDomain = "All" } = {}) {
  _requireKey(env);
  const store = _readStore();
  const conversation_config = _conversationConfig(env, { projectName, currentDomain });

  if (await _agentExists(store.agentId, env)) {
    if (store.configVersion !== CONFIG_VERSION) {
      const res = await _api(`/convai/agents/${store.agentId}`, {
        method: "PATCH", body: { conversation_config }, env,
      });
      if (res.ok) _writeStore({ ...store, configVersion: CONFIG_VERSION });
      // If PATCH fails we still reuse the existing agent (degrade, don't block).
    }
    return { agentId: store.agentId };
  }

  const res = await _api("/convai/agents/create", {
    method: "POST", body: { name: "CEO Studio", conversation_config }, env,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs create-agent ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  _writeStore({ ...store, agentId: data.agent_id, configVersion: CONFIG_VERSION, projectName });
  return { agentId: data.agent_id };
}

/**
 * Update the agent's domain focus without recreating it.
 * PATCHes the conversation config with the new domain context.
 */
async function updateAgentDomain(agentId, { env = process.env, currentDomain = "All" } = {}) {
  _requireKey(env);
  const store = _readStore();
  if (!await _agentExists(agentId, env)) return { ok: false, reason: "Agent not found" };
  
  // We need to get the current project name from somewhere - for now use a default
  // In a real implementation, this should be stored in session state
  const conversation_config = _conversationConfig(env, { projectName: store.projectName || "the project", currentDomain });
  
  const res = await _api(`/convai/agents/${agentId}`, {
    method: "PATCH", body: { conversation_config }, env,
  });
  
  if (res.ok) {
    // Load domain context after switching for agent awareness
    if (currentDomain && currentDomain !== "All") {
      try {
        const domains = require("./domains");
        const projectSlug = store.projectSlug || "default";
        const domainDesc = domains.getDomainDescription(projectSlug, currentDomain);
        if (domainDesc && !domainDesc.includes("no context available")) {
          console.log(`Loaded domain context for ${currentDomain}`);
        }
      } catch (e) {
        console.log("Could not load domain context:", e.message);
      }
    }
    return { ok: true, domain: currentDomain };
  }
  return { ok: false, reason: "Failed to update domain" };
}

/** WebRTC conversation token (preferred for voice — best barge-in/interruption). */
async function getConversationToken(agentId, { env = process.env } = {}) {
  _requireKey(env);
  const res = await _api(`/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`, { env });
  if (!res.ok) throw new Error(`ElevenLabs token ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return (await res.json()).token;
}

/** Signed WebSocket URL (fallback path). */
async function getSignedUrl(agentId, { env = process.env } = {}) {
  _requireKey(env);
  const res = await _api(`/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`, { env });
  if (!res.ok) throw new Error(`ElevenLabs signed-url ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return (await res.json()).signed_url;
}

function status(env = process.env) {
  const c = cfg(env);
  return {
    available: available(env),
    maxMinutes: c.maxMinutes,
    maxTokens: c.maxTokens,
    mode: c.mode,
    voiceId: c.voiceId,
    llm: c.llm,
    tools: TOOLS.map((t) => t.name),
    note: available(env) ? null : "ELEVENLABS_API_KEY not set — live voice disabled (text still works)",
  };
}

module.exports = {
  available, status, ensureAgent, updateAgentDomain, getConversationToken, getSignedUrl, cfg,
  TOOLS, CONFIG_VERSION, _readStore, _writeStore,
};
