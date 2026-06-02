#!/bin/bash
# Launch CEO Studio with remote debugging enabled for MCP / CDP clients
# Usage: bash scripts/launch-electron-debug.sh

set -euo pipefail

PORT="${CEO_STUDIO_REMOTE_DEBUG_PORT:-9222}"

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

npm run build:agui
CEO_STUDIO_REMOTE_DEBUG_PORT="${PORT}" ./node_modules/.bin/electron .

# Note: the MCP server itself runs in the AI client's stdio context, not here.
# This script just exposes the CDP port for the MCP server to connect to.
