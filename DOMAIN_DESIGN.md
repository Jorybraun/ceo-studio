> **Scope note (read `NORTH_STAR.md` + `E2E_PLAN.md` first).** This document is **UI/runtime design notes**, not the project definition. It details the Electron shell, panel rendering, and agent-controlled UI mechanics that serve **L0 (Foundation)** and **L3 (Swarm view)** of the capability ladder. Where it conflicts with `E2E_PLAN.md`, the plan wins. The multi-project/multi-domain model here is correct; the implication that the UI *is* the project is not — the agent + brain + guardrails are the project.

# CEO Studio - Multi-Project, Multi-Domain Architecture

## Domain Definition

**CEO Studio Domain**: An Electron app where an AI CEO agent manages multiple projects across multiple domains - red pulsing circle visualization + 2 flexible panels.

## Core Insight

**Electron app with multi-project, multi-domain support** - Project-agnostic but project-aware when selected, with domain-specific knowledge and skills.

## Core Entities

### 1. Electron App Structure
**Purpose**: Single application with multi-project, multi-domain support
**Implementation**: Electron + Node.js + HTML/JS
**Components:**
- Main Process (Node.js): Agent logic, file system access, project management
- Renderer Process (Frontend): UI, panel rendering, visual libraries
- IPC: Communication between main and renderer processes

### 2. Project Management
**Purpose**: Manage multiple projects
**Implementation**: Project configuration storage + folder picker
**Responsibilities:**
- Add/remove projects by selecting folders
- Switch between projects
- Store project configurations
- Recent projects list
- Project-specific settings

**Project Configuration:**
```typescript
interface Project {
  id: string;
  name: string;
  path: string;
  domains: Domain[];
  settings: ProjectSettings;
}

interface Domain {
  name: string;
  skills: string[];
  knowledge: Record<string, string>;
  settings: DomainSettings;
}
```

### 3. Domain Management (per Project)
**Purpose**: Manage domains within each project
**Implementation**: Domain configuration + skill loading
**Responsibilities:**
- Define domains per project (Discovery, Engineering, etc.)
- Load domain-specific skills
- Load domain-specific knowledge
- Switch between domains
- Cross-domain analysis

### 4. Agent with Multi-Project Context
**Purpose**: Agent that can work across multiple projects and domains
**Implementation**: Node.js + OpenAI/Anthropic SDK
**Responsibilities:**
- Maintain current project + domain context
- Switch between projects/domains
- Load domain-specific skills and knowledge
- Cross-project analysis
- Domain-aware recommendations
- Panel control and HTML generation

**Agent Context:**
```typescript
interface AgentContext {
  currentProject: Project;
  currentDomain: Domain | null;
  allProjects: Project[];
  availableSkills: Skill[];
}
```

### 5. Fixed Frontend Layout
**Purpose**: Consistent UI with project/domain switchers
**Implementation**: HTML + Tailwind CSS + JavaScript
**Layout:**
```
┌─────────────────────────────────────────┐
│  [Project: CEO_STUDIO ▼] [Domain: All ▼]│  ← Switchers
├─────────────────────────────────────────┤
│        [Red Pulsing Circle]             │
├──────────────────┬──────────────────────┤
│   Panel 1        │   Panel 2            │  ← Agent controls content
│                  │                      │     Can be file, chat, diagram, etc.
│                  │                      │     Editable with submit mechanisms
└──────────────────┴──────────────────────┘
```

**Responsibilities:**
- Render project/domain switchers
- Render red pulsing circle (agent state)
- Render 2 panels with agent-specified content
- Handle interactivity as agent specifies
- Process visual libraries (marked.js, mermaid.js, highlight.js)
- Send user interactions back to agent via IPC

## Domain Boundaries

### Project Management Domain
- Project configuration and storage
- Project switching logic
- Domain configuration per project
- No business logic about project content

### Agent Domain
- Business logic (project analysis, documentation review)
- Multi-project context management
- Domain-aware decision making
- Panel control and HTML generation
- Cross-project analysis

### Frontend Domain
- Fixed layout with switchers
- Panel rendering based on agent instructions
- Interactivity handling
- Visual library processing
- Sends user actions back to agent via IPC

## Key Relationships

```
Electron App
├── Main Process (Node.js)
│   ├── Project Management
│   ├── Domain Management
│   ├── Agent (with multi-project context)
│   └── File System Access
└── Renderer Process (Frontend)
    ├── Project/Domain Switchers
    ├── Red Circle Visualization
    └── Panel Rendering

User → Select Project/Domain → Agent Loads Context → Generates Panel HTML → IPC → Frontend → Renders Panels
                                      ↓
                              Visual Libraries Process
                                      ↓
                                User Interacts → IPC → Agent Responds
```

## Project & Domain Flow

1. **You add project**: Select folder via file picker
2. **App scans project**: Detects domains, loads configuration
3. **You select domain**: Choose domain within project
4. **Agent loads context**: Loads project knowledge + domain-specific skills
5. **You interact**: Type in chat, edit files, switch panels
6. **Agent responds**: Uses current project + domain context
7. **You switch projects**: Agent loads new project context
8. **You switch domains**: Agent loads domain-specific context

## File Structure

```
CEO_STUDIO/
├── main/
│   ├── index.js              # Electron main process
│   ├── agent.js              # Agent logic + multi-project context
│   ├── project-manager.js    # Project management
│   ├── domain-manager.js     # Domain management
│   └── skills-loader.js      # Skills integration
├── renderer/
│   ├── index.html            # Fixed layout with switchers
│   ├── styles.css            # Tailwind + custom styles
│   └── app.js                # Panel rendering + IPC
├── storage/
│   └── projects.json         # Project configurations
└── package.json
```

## Tech Stack

**Electron Main Process:**
- Electron
- Node.js
- OpenAI SDK or Anthropic SDK
- Eleven Labs SDK (Phase 2)
- File system access

**Electron Renderer Process:**
- HTML/JavaScript
- Tailwind CSS (via CDN)
- External libraries via CDN (marked.js, mermaid.js, highlight.js)
- IPC communication

## Implementation Plan

**Phase 1: Electron + Agent (2-3 hours)**
1. Set up Electron app structure
2. Create main process with IPC handlers
3. Implement project management (add/remove/switch)
4. Implement domain management (per project)
5. Agent with multi-project context
6. Fixed layout with project/domain switchers
7. IPC for agent ↔ frontend communication

**Phase 2: Project Integration (2-3 hours)**
1. Project folder selection via file picker
2. File reading from any project path
3. Domain detection and configuration
4. Skills integration (context/skills/)
5. Domain-specific skill loading
6. Editable panel mechanisms

**Phase 3: Polish (1-2 hours)**
1. Red circle states (per project/domain)
2. 2-way stream chat
3. Project switching persistence
4. Domain switching logic
5. Cross-project analysis capabilities
6. End-to-end testing

**Total: 5-8 hours for working MVP**

## Next Steps

1. Set up Electron app structure
2. Implement project management
3. Implement domain management
4. Create agent with multi-project context
5. Build fixed layout with switchers
6. Implement IPC communication
7. Add visual libraries
8. Test multi-project switching