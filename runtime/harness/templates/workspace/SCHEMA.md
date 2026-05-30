# `.harem/` workspace — schema

A `.harem/` directory is the per-project **workspace**: everything the harness
runtime produces or consumes *for one project* lives here. Presence of
`.harem/harem.json` means "this project is managed by the harness."

This mirrors the `.git/` model: the **engine** (bin/, agents/, config logic) is
installed once and shared; the **workspace** is per-project and travels with the
project repo.

## `harem.json` fields

| Field | Type | Meaning |
|-------|------|---------|
| `schema` | int | Schema version (currently `1`). |
| `project.slug` | string | Stable machine id for the project (kebab-case). |
| `project.name` | string | Human-readable project name. |
| `project.root` | string | Path to the project root **relative to `.harem/`** (normally `..`). |
| `default_domain` | string | Domain used when none is specified (`all` by default). |
| `domains` | string[] | Known domains (units of strategic ownership). Scaffolded under `context/<domain>-team/`. |
| `providers.default` | string | Default agent provider (`echo` = free/offline, `devin`, `grok`, ...). |
| `providers.allow_paid` | bool | If false, paid providers are refused for automated spawns (maps to `CEO_ALLOW_PAID`). |
| `cost.max_session_usd` | number | Hard per-session USD cap. |
| `cost.max_day_usd` | number | Hard per-day USD cap. |
| `cost.max_concurrent_agents` | int | Maps to `CEO_MAX_CONCURRENT_AGENTS`. |
| `cost.max_spawns_per_cycle` | int | Maps to `CEO_MAX_SPAWNS_PER_CYCLE`. |
| `cost.max_spawns_per_hour` | int | Maps to `CEO_MAX_SPAWNS_PER_HOUR`. |
| `created_at` | string | ISO timestamp the workspace was scaffolded. |
| `harness_version` | string | Harness version that scaffolded it. |

## Directory layout

```
.harem/
├── harem.json              # marker + identity + config (this schema)
├── kanban/                 # one board markdown per domain (e.g. all.md)
├── mgmt/
│   └── stage-map.md        # stage -> team -> workflow -> personas bindings
├── context/                # per-domain context: <domain>-team/ (AGENTS.md, docs/, mgmt/)
├── brain/
│   └── rooms/              # agent <-> agent + human comms; <room>/chat.log
│       └── main/
├── sessions/               # orchestrator state, processed-action dedup, spawn ledger
└── README.md
```

## Path contract for the runtime

- `HARNESS_HOME` = where the engine **code** lives (installed once).
- `HARNESS_WORKSPACE` = this `.harem/` directory.
- All **data** paths resolve under `HARNESS_WORKSPACE`; all **code** lookups under `HARNESS_HOME`.
