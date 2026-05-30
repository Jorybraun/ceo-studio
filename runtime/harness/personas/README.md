# Personas

This is the **main home** for all personas in the Harem.

## How it works

- Any `.md` file under this directory (recursively) can be used as a persona.
- When you do `/new my-agent some-persona` in `herder-chat`, or pass `--persona some-persona` to `launch-agent`, the system will find the file and load it.
- The watcher (`domain-room watch`) and `HerderAgent` will print the persona content at startup and record it in presence.

## Organization

You are encouraged to organize this folder however makes sense for you:

```
personas/
    general/
        architect.md
        planner.md
    research/
        deep-researcher.md
    domains/
        discovery/
            discovery-architect.md
        mexicans/
            taco-strategist.md
    architecture/
        systems-architect.md
```

Domain-specific personas are fully supported — just put them in a subfolder. The loader searches recursively by name.

## Adding new personas

1. Create a new `.md` file anywhere under `personas/`.
2. Write the persona in whatever style you like (the content gets injected when the agent starts).
3. Use it immediately with `/new foo my-new-persona` or `--persona my-new-persona`.

## Multiple instances

You can (and should) have many agents with the same persona:

```
/new grok-1 planner
/new grok-2 planner
/new researcher-7 deep-researcher
```

They can even be in the same room.

## Listing

Run:

    ./bin/list-personas

## Legacy locations (still work)

For backward compatibility the system also looks in:
- `skills/planning-team/`
- `agents/personas/`

But the recommended place to manage and grow your collection is right here in `personas/`.
