> **Scope note (partially stale).** The *concept* here is correct and current: CEO Studio reuses `harness/` skills/personas and project-analysis patterns rather than rebuilding them (see the asset-reuse table in `NORTH_STAR.md`). However, the surrounding framing (React frontend, "scanner", visual collaboration layer) is **stale** — defer to `E2E_PLAN.md` for the actual runtime. Use this file only as a reference for *which* harness assets to reuse and how.

# External Integrations - How CEO Studio Leverages Existing Infrastructure

## Overview

CEO Studio is designed as a **visual collaboration layer** on top of existing, proven infrastructure rather than rebuilding from scratch. We leverage two key existing components:

1. **context/skills/** - Matt Pocock's battle-tested engineering skills
2. **agent-harness/** - Multi-agent execution patterns and project analysis

## context/skills/ Integration

### What We're Using

**Matt Pocock's Skills Library** - A comprehensive set of engineering skills used daily by thousands of developers:

**Core Engineering Skills for CEO Agent:**
- `grill-with-docs` - Challenge plans against existing documentation, build shared language
- `improve-codebase-architecture` - Find structural issues and deepening opportunities  
- `diagnose` - Systematic debugging loop for hard problems
- `zoom-out` - Give broader context on unfamiliar code
- `handoff` - Compact conversations for context preservation
- `triage` - Issue management through state machines
- `tdd` - Test-driven development guidance

### Integration Architecture

```python
# backend/skills_integration/skill_loader.py
from pathlib import Path
import yaml

class SkillLoader:
    def __init__(self, skills_base_path: str):
        self.skills_base_path = Path(skills_base_path)
        self.loaded_skills = {}
        
    def load_engineering_skills(self):
        """Load all engineering skills from context/skills/skills/engineering/"""
        engineering_path = self.skills_base_path / "skills" / "engineering"
        
        for skill_dir in engineering_path.iterdir():
            if skill_dir.is_dir() and (skill_dir / "SKILL.md").exists():
                skill_name = skill_dir.name
                skill_definition = self._parse_skill_md(skill_dir / "SKILL.md")
                self.loaded_skills[skill_name] = skill_definition
                
        return self.loaded_skills
    
    def _parse_skill_md(self, skill_md_path: Path) -> dict:
        """Parse SKILL.md file into structured definition"""
        content = skill_md_path.read_text()
        # Extract: description, when to use, core process, quality standards
        return {
            "name": skill_md_path.parent.name,
            "description": self._extract_section(content, "Description"),
            "when_to_use": self._extract_section(content, "When to use"),
            "process": self._extract_section(content, "Core process"),
            "anti_patterns": self._extract_section(content, "Anti-patterns"),
        }
```

```python
# backend/agent.py
class CEOAgent:
    def __init__(self):
        # Load skills as core toolset
        self.skill_loader = SkillLoader("../context/skills/")
        self.available_skills = self.skill_loader.load_engineering_skills()
        
        # Build system prompt with skills context
        self.system_prompt = self._build_system_prompt()
        
    def _build_system_prompt(self) -> str:
        """Build system prompt that includes skill descriptions"""
        skills_context = "\n\n".join([
            f"## /{name}\n{skill['description']}\nWhen to use: {skill['when_to_use']}"
            for name, skill in self.available_skills.items()
        ])
        
        return f"""You are the CEO of PIPE-OS. You have access to these proven engineering skills:

{skills_context}

You can invoke these skills when appropriate to help with project management, documentation review, architecture analysis, and strategic planning."""
```

### Frontend Integration

```typescript
// frontend/src/components/SkillPanel.tsx
const AVAILABLE_SKILLS = [
  { id: 'grill-with-docs', name: 'Grill Docs', description: 'Challenge plans against documentation' },
  { id: 'improve-codebase-architecture', name: 'Architecture Review', description: 'Find structural issues' },
  { id: 'diagnose', name: 'Diagnose', description: 'Systematic debugging' },
  { id: 'zoom-out', name: 'Zoom Out', description: 'Broader context' },
];

export function SkillPanel() {
  const [activeSkill, setActiveSkill] = useState<string | null>(null);
  
  const activateSkill = async (skillId: string) => {
    setActiveSkill(skillId);
    await fetch('/api/agent/skill', {
      method: 'POST',
      body: JSON.stringify({ skill: skillId, context: getCurrentFileContext() })
    });
  };
  
  return (
    <div className="skill-panel">
      <h3>Available Skills</h3>
      {AVAILABLE_SKILLS.map(skill => (
        <button key={skill.id} onClick={() => activateSkill(skill.id)}>
          {skill.name}
        </button>
      ))}
    </div>
  );
}
```

### Benefits

1. **Proven Effectiveness**: These skills are battle-tested by thousands of developers
2. **No Reinventing**: Leverage existing patterns for documentation analysis, architecture review
3. **Immediate Value**: CEO agent has powerful capabilities from day one
4. **Community Improvements**: Benefits from ongoing improvements to the skills library

## agent-harness/ Integration

### What We're Using

**Agent Harness Patterns** - Sophisticated multi-agent coordination and project analysis:

**Key Patterns for CEO Studio:**
- File walking and markdown parsing from `agent-harness/broker/plan_walker.py`
- Conflict detection logic from `agent-harness/broker/db.py`
- SQLite database patterns for project state tracking
- Multi-agent coordination patterns (for Phase 2 autonomous execution)

### Integration Architecture

```python
# project-scanner/scan.py (adapted from agent-harness/broker/plan_walker.py)
from pathlib import Path
import re
from typing import List, Dict

class ProjectScanner:
    def __init__(self, project_root: str):
        self.project_root = Path(project_root)
        
    def scan_for_conflicts(self) -> List[Dict]:
        """Scan project for documentation contradictions
        Adapted from agent-harness conflict detection patterns"""
        conflicts = []
        
        # Pattern 1: Files mentioned in docs that don't exist
        conflicts.extend(self._check_file_existence_claims())
        
        # Pattern 2: STRATEGY.md findings not reflected in current work
        conflicts.extend(self._check_strategy_alignment())
        
        # Pattern 3: Duplicate/conflicting documentation
        conflicts.extend(self._check_duplicate_documentation())
        
        return conflicts
    
    def _check_file_existence_claims(self) -> List[Dict]:
        """Check if files mentioned in documentation actually exist"""
        conflicts = []
        
        for doc_file in self.project_root.rglob("*.md"):
            content = doc_file.read_text()
            mentioned_files = self._extract_file_paths(content)
            
            for file_path in mentioned_files:
                full_path = self.project_root / file_path
                if not full_path.exists():
                    conflicts.append({
                        "type": "file_not_found",
                        "source": str(doc_file.relative_to(self.project_root)),
                        "claim": file_path,
                        "severity": "high"
                    })
        
        return conflicts
    
    def _extract_file_paths(self, content: str) -> List[str]:
        """Extract file paths from markdown content
        Uses similar patterns to agent-harness plan_walker.py"""
        # Match patterns like `src/file.ts`, `./path/to/file`, etc.
        path_pattern = r'`([a-zA-Z0-9_./-]+\.[a-zA-Z]+)`'
        return re.findall(path_pattern, content)
```

```python
# backend/scanner.py (simplified version for MVP)
class CEOScanner:
    def __init__(self, project_root: str):
        self.scanner = ProjectScanner(project_root)
        
    async def run_scan(self) -> Dict:
        """Run contradiction scan and return results"""
        conflicts = self.scanner.scan_for_conflicts()
        
        return {
            "scan_time": datetime.now().isoformat(),
            "total_conflicts": len(conflicts),
            "conflicts_by_severity": self._group_by_severity(conflicts),
            "conflicts": conflicts
        }
```

### Database Integration (Phase 2)

For Phase 2, we can leverage agent-harness database patterns:

```python
# backend/db.py (adapted from agent-harness/broker/db.py)
from sqlite3 import connect
from pathlib import Path

class CEOStudioDB:
    def __init__(self, db_path: str):
        self.db_path = Path(db_path)
        self._init_db()
    
    def _init_db(self):
        """Initialize database with schema adapted from agent-harness"""
        with connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS contradictions (
                    id INTEGER PRIMARY KEY,
                    type TEXT,
                    source TEXT,
                    claim TEXT,
                    severity TEXT,
                    detected_at REAL,
                    resolved BOOLEAN DEFAULT FALSE
                )
            """)
            
            conn.execute("""
                CREATE TABLE IF NOT EXISTS conversations (
                    id INTEGER PRIMARY KEY,
                    skill_used TEXT,
                    context_file TEXT,
                    result_summary TEXT,
                    timestamp REAL
                )
            """)
```

### Benefits

1. **Proven Patterns**: File scanning and conflict detection logic already battle-tested
2. **Scalability**: Database patterns can handle larger projects in Phase 2
3. **Consistency**: Uses same patterns as existing infrastructure
4. **Future-Ready**: Can leverage more advanced agent-harness features as needed

## Integration Strategy

### Phase 1 (MVP)
- **Skills**: Load and use core engineering skills from context/skills/
- **Scanner**: Simplified conflict detection using agent-harness patterns
- **Database**: In-memory storage (simplicity)

### Phase 2 (Enhanced)
- **Skills**: Add skill composition and custom skill creation
- **Scanner**: Advanced contradiction detection with ML
- **Database**: SQLite with agent-harness schema patterns
- **Autonomous**: Limited autonomous execution using agent-harness coordination

### Phase 3 (Full Integration)
- **Skills**: Full skills library with custom CEO-specific skills
- **Scanner**: Continuous monitoring with alerts
- **Database**: Full agent-harness integration for plan tracking
- **Autonomous**: Multi-agent execution for complex tasks

## Risk Mitigation

**Risk**: Skills don't work as expected in CEO context
**Solution**: Test each skill independently before integration, have fallback to basic tools

**Risk**: Agent-harness patterns too complex for MVP
**Solution**: Start with simplified versions, add complexity gradually

**Risk**: Integration becomes maintenance burden
**Solution**: Keep integration layer thin, document dependencies clearly

## Success Metrics

1. **Skills Integration**: Can CEO agent successfully use grill-with-docs on STRATEGY.md?
2. **Scanner Integration**: Does scanner find real conflicts in PIPE-OS?
3. **Performance**: Does integration add acceptable overhead?
4. **Reliability**: Do skills work consistently in CEO context?

## Conclusion

By leveraging context/skills/ and agent-harness/, CEO Studio gains:
- Immediate access to battle-tested agent capabilities
- Proven patterns for project analysis
- Foundation for future autonomous execution
- Consistency with existing infrastructure

This approach allows CEO Studio to focus on its core value (visual collaboration interface) while building on proven foundations.