# CEO Studio Testing Scenarios Registry

This registry tracks all testing scenarios across domains for systematic regression testing.

## Scenario Index

| Scenario Name | Domain | Feature | Status | Last Tested | Location |
|--------------|--------|---------|--------|-------------|----------|
| Terminal Input via Agent Surface | Teams | Agent terminal interaction | PASSING | 2026-06-02 | teams/terminal-input-agent-surface.md |
| Channels Feature Testing | Teams | Channels/Room browser | FAILING | 2026-06-02 | teams/channels-feature-testing.md |
| Room-Based Agent Communication | Teams | Room communication & A2A meetings | PARTIAL | 2026-06-02 | teams/room-based-agent-communication.md |
| Meetings UI Mounted Agent Filter | Teams | Meetings UI agent selection | PASSING | 2026-06-02 | teams/meetings-ui-mounted-filter.md |

## Domain Directories

- **teams/** - Teams domain testing scenarios
- **domain-lifecycle/** - Domain Lifecycle testing scenarios (to be added)
- **planning/** - Planning workflow testing scenarios (to be added)

## Cross-Domain Scenarios

Some scenarios span multiple domains. These are registered with multiple domain tags:

| Scenario Name | Domains | Primary Location |
|--------------|---------|------------------|
| (none yet) | - | - |

## Scenario Status Legend

- **PASSING** - All expected results achieved
- **FAILING** - Critical failures preventing feature use
- **PARTIAL** - Some functionality works but has issues

## Regression Testing Protocol

Before testing any feature:

1. Check this registry for existing scenarios in the relevant domain
2. Re-run existing scenarios to verify no regressions
3. Update scenario status and last-tested date
4. Add new findings to scenario documentation
5. Register new scenarios in this index

## Adding New Scenarios

When creating a new testing scenario:

1. Create scenario file in appropriate domain directory using the template
2. Register scenario in this index with all required fields
3. If scenario spans multiple domains, add to Cross-Domain Scenarios section
4. Update the dogfood skill to reference the new scenario if relevant

## Scenario Template

Use this template for new scenario files:

```markdown
# Scenario: {Scenario Name}

**Date**: {YYYY-MM-DD}
**Domain**: {domain-name}
**Feature**: {feature description}
**Status**: PASSING | FAILING | PARTIAL
**Last Tested**: {YYYY-MM-DD}

## Purpose
{Why this test exists}

## Setup
1. {Step 1}
2. {Step 2}

## Test Steps
1. {Step 1}
2. {Step 2}

## Expected Results
- {Expected outcome 1}
- {Expected outcome 2}

## Actual Results
- {Actual outcome 1}
- {Actual outcome 2}

## Implementation Notes
- {Any implementation details or fixes}
- {Files modified}
- {Technical observations}

## Related Issues
- {Links to related Kanban tasks or issues}

## History
- {YYYY-MM-DD}: {Change description}
```

---

**Last Updated**: 2026-06-02  
**Total Scenarios**: 4  
**Passing**: 2  
**Failing**: 1  
**Partial**: 1