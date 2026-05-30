> **⚠️ SUPERSEDED.** This early draft (React frontend, FastAPI/Python backend, scanner) predates the current direction. The authoritative architecture is now `E2E_PLAN.md` (Electron + Node/TS runtime, Brain memory contract, cost guardrails, capability ladder). Kept for history only — do not implement from this file.

# CEO Studio Architecture

## Vision

A visual collaboration interface where you and your AI CEO can work together on project management, documentation, and planning.

## Core Components

**1. CEO Agent** (Backend)
- Single strong model (GPT-4o or Claude Sonnet)
- Loads Matt Pocock's skills from `context/skills/`
- Loads project knowledge: `knowledge/STRATEGY.md`, `knowledge/INDEX.md`
- Tools: read_file, search_docs, scan_project
- Eleven Labs voice interface
- Hard cost limit: $5/session, $20/day

**2. Frontend** (Simple React App)
- File browser for navigating project files
- Split screen: file view + agent response
- Basic chat interface (text first, voice later)
- Markdown rendering for files and responses
- Simple state management

**3. Skills Integration**
- Agent loads skills from `context/skills/`
- Skills inform agent's analysis and recommendations
- Key skills: grill-with-docs, improve-codebase-architecture, diagnose, zoom-out

**4. Scanner**
- Python script using agent-harness patterns
- Detects documentation contradictions
- Can be triggered manually by agent or user

## Architecture

```
You (Voice/Text) → CEO Agent → Tools (skills, scanner, file reading) → Analysis
                                      ↓
                              Frontend (React)
                                      ↓
                                You (See Results)
```

## File Structure

```
CEO_STUDIO/
├── backend/
│   ├── main.py              # FastAPI + WebSocket server
│   ├── agent.py             # CEO agent logic
│   ├── tools.py             # read_file, search_docs, scan_project
│   ├── skills_integration/  # Load skills from context/skills/
│   └── scanner.py           # Contradiction scanner
├── frontend/
│   ├── src/
│   │   ├── App.tsx          # Main layout
│   │   ├── FileBrowser.tsx  # Navigate project files
│   │   ├── FileViewer.tsx   # Display file content
│   │   ├── ChatPanel.tsx    # Conversation with CEO
│   │   └── ResponsePanel.tsx # Agent's analysis and recommendations
│   └── package.json
├── shared/
│   └── types.ts             # Shared TypeScript types
└── EXTERNAL_INTEGRATIONS.md
```

## Data Flow

```
1. You type or speak a request to the agent
2. Agent processes: loads context, uses skills, calls scanner as needed
3. Agent responds with analysis and recommendations
4. Frontend displays agent's response alongside relevant files
5. You can ask follow-up questions or navigate to different files
```

## Tech Stack

**Backend:**
- FastAPI (Python) - simple, fast
- Eleven Labs SDK - voice (Phase 2)
- OpenAI/Anthropic API - agent brain
- WebSockets - real-time communication

**Frontend:**
- React + TypeScript + Vite
- Tailwind CSS - styling
- React Markdown - render files
- Shadcn components - UI elements

**Scanner:**
- Python + grep/ripgrep - fast file search
- Simple heuristics - contradiction detection

## Integration Points

**context/skills/** → Agent capabilities:
- Load Matt Pocock's engineering skills
- Skills inform agent's analysis approach
- No special UI - agent uses skills internally

**agent-harness/** → Scanner patterns:
- File walking and conflict detection logic
- Database patterns for future state tracking
- Multi-agent patterns for future autonomous execution

## Build Phases

**Phase 1 (MVP - 2-3 days):**
- Text-based interface (no voice)
- Basic file navigation and viewing
- Agent with skills integration
- Manual scanner triggering
- Simple contradiction detection

**Phase 2:**
- Add Eleven Labs voice
- Improve scanner with more sophisticated detection
- Add project health dashboard
- Better visualizations

**Phase 3:**
- Kanban integration
- Automated monitoring
- Multi-project support
- Advanced autonomous features

## External Integrations

### context/skills/ Integration
- Load Matt Pocock's engineering skills as agent's core toolset
- Skills inform agent's analysis approach and recommendations
- Key skills: grill-with-docs, improve-codebase-architecture, diagnose, zoom-out
- See `EXTERNAL_INTEGRATIONS.md` for detailed integration approach

### agent-harness/ Integration
- Use file scanning and conflict detection patterns from agent-harness/broker/
- Adapt database patterns for future project state tracking
- Multi-agent coordination patterns available for Phase 3
- See `EXTERNAL_INTEGRATIONS.md` for detailed integration approach

## Success Criteria for MVP

1. You can type to CEO agent about your project and get useful responses
2. Agent can read and analyze project files
3. Scanner finds obvious documentation contradictions
4. Skills integration works (agent can use grill-with-docs, etc.)
5. Total cost per session < $5
6. Setup time < 2 days