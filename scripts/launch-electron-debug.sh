#!/bin/bash
# Launch CEO Studio with remote debugging enabled for MCP / CDP clients
# Usage: bash scripts/launch-electron-debug.sh

set -euo pipefail

PORT="${CEO_STUDIO_REMOTE_DEBUG_PORT:-9222}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Clean slate: a fresh launch should leave no prior instance behind. Kill any
# existing CEO Studio Electron processes from THIS repo (scoped by repo path so
# we never touch unrelated Electron apps), then free the debug port if anything
# is still holding it. Guards (|| true) keep `set -e` happy when nothing matches.
echo "🧹 Stopping any existing CEO Studio instances…"
pkill -f "${REPO_DIR}/node_modules/electron" 2>/dev/null || true
pkill -f "${REPO_DIR}/node_modules/.bin/electron" 2>/dev/null || true
PORT_PIDS="$(lsof -ti "tcp:${PORT}" 2>/dev/null || true)"
[ -n "${PORT_PIDS}" ] && kill ${PORT_PIDS} 2>/dev/null || true
sleep 1

echo "🚀 Launching CEO Studio with CDP remote debugging on port ${PORT}"
echo ""
echo "For AI clients (Claude, Cursor, etc.) add to MCP config:"
echo '{'
echo '  "mcpServers": {'
echo '    "chrome-devtools": {'
echo '      "command": "npx",'
echo "      \"args\": [\"-y\", \"chrome-devtools-mcp@latest\", \"--browserUrl=http://localhost:${PORT}\"]"
echo '    },'
echo '    "electron-debug": {'
echo '      "command": "node",'
echo '      "args": ["/absolute/path/to/electron-mcp-server/build/index.js"]'
echo '    }'
echo '  }'
echo '}'
echo ""
echo "Then start the app below. The Electron renderer will be inspectable via CDP."

npm run build:renderer
CEO_STUDIO_REMOTE_DEBUG_PORT="${PORT}" ./node_modules/.bin/electron .

# Note: the MCP server itself runs in the AI client's stdio context, not here.
# This script just exposes the CDP port for the MCP server to connect to.
