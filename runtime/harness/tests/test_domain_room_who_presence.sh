#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

presence_dir="$TMP_ROOT/brain/rooms/discovery/presence"
mkdir -p "$presence_dir"

printf '%s\n' 'CHAT_ORCHESTRATOR' > "$presence_dir/Swarm Facilitator.persona"
printf '%s\n' '2026-01-01T00:00:00Z' > "$presence_dir/Swarm Facilitator.last_seen"
printf '%s\n' 'GENERALIST' > "$presence_dir/Grok.persona"
printf '%s\n' '2026-01-01T00:00:00Z' > "$presence_dir/Grok.last_seen"

output="$(HARNESS_ROOT="$TMP_ROOT" "$ROOT/bin/domain-room" who discovery)"

printf '%s\n' "$output"

if ! grep -Fq 'Swarm Facilitator → CHAT_ORCHESTRATOR' <<< "$output"; then
  echo "Expected persona with spaces to be listed" >&2
  exit 1
fi

if ! grep -Fq 'Grok → GENERALIST' <<< "$output"; then
  echo "Expected persona without spaces to be listed" >&2
  exit 1
fi
