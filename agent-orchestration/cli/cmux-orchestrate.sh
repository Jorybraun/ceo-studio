#!/bin/bash

# CMUX Agent Orchestration Script
# 
# Uses CMUX CLI to create a workspace with 4 agent panes + CLI pane
# All agents run with live logs visible
# Agent registry maintained via HTTP discovery

PROJECT_PATH="/Users/hans/Code/AGENT/CEO_STUDIO"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}=== CMUX Agent Orchestration ===${NC}"
echo -e "${GREEN}Creating CMUX workspace with 4 agents + CLI${NC}"
echo ""

# Create new workspace
echo -e "${YELLOW}Creating new CMUX workspace...${NC}"
cmux new-workspace --name "Agent Orchestration" --cwd "$PROJECT_PATH/agent-orchestration"

# Get the workspace ID
WORKSPACE_ID=$(cmux list-workspaces | grep "Agent Orchestration" | head -1 | awk '{print $1}')
echo -e "${GREEN}✓ Workspace created: $WORKSPACE_ID${NC}"

# Start Devin Agent in first pane
echo -e "${YELLOW}Starting Devin Agent...${NC}"
cmux send --workspace "$WORKSPACE_ID" "npm run agent-server -- --type devin --port 8001 --project $PROJECT_PATH"
cmux send-key --workspace "$WORKSPACE_ID" Enter

# Split and start Voice Agent
echo -e "${YELLOW}Splitting for Voice Agent...${NC}"
cmux new-split right --workspace "$WORKSPACE_ID"
sleep 1
cmux send --workspace "$WORKSPACE_ID" "npm run agent-server -- --type voice-agent --port 8002 --project $PROJECT_PATH"
cmux send-key --workspace "$WORKSPACE_ID" Enter

# Split and start Specialist Agent
echo -e "${YELLOW}Splitting for Specialist Agent...${NC}"
cmux new-split down --workspace "$WORKSPACE_ID"
sleep 1
cmux send --workspace "$WORKSPACE_ID" "npm run agent-server -- --type specialist --port 8003 --project $PROJECT_PATH"
cmux send-key --workspace "$WORKSPACE_ID" Enter

# Split and start Coordinator Agent
echo -e "${YELLOW}Splitting for Coordinator Agent...${NC}"
cmux new-split right --workspace "$WORKSPACE_ID"
sleep 1
cmux send --workspace "$WORKSPACE_ID" "npm run agent-server -- --type coordinator --port 8004 --project $PROJECT_PATH"
cmux send-key --workspace "$WORKSPACE_ID" Enter

# Split and start CLI
echo -e "${YELLOW}Splitting for CLI pane...${NC}"
cmux new-split down --workspace "$WORKSPACE_ID"
sleep 1
cmux send --workspace "$WORKSPACE_ID" "echo '=== Agent CLI Ready ==='"
cmux send-key --workspace "$WORKSPACE_ID" Enter
cmux send --workspace "$WORKSPACE_ID" "echo 'Commands:'"
cmux send-key --workspace "$WORKSPACE_ID" Enter
cmux send --workspace "$WORKSPACE_ID" "echo '  npm run agent-cli -- discover'"
cmux send-key --workspace "$WORKSPACE_ID" Enter
cmux send --workspace "$WORKSPACE_ID" "echo '  npm run agent-cli -- talk --from <agent> --to <agent> --message <msg>'"
cmux send-key --workspace "$WORKSPACE_ID" Enter
cmux send --workspace "$WORKSPACE_ID" "echo '  npm run agent-cli -- collaborate --project <path>'"
cmux send-key --workspace "$WORKSPACE_ID" Enter
cmux send --workspace "$WORKSPACE_ID" "echo '  npm run agent-cli -- monitor'"
cmux send-key --workspace "$WORKSPACE_ID" Enter
cmux send --workspace "$WORKSPACE_ID" "echo ''"
cmux send-key --workspace "$WORKSPACE_ID" Enter

# Wait for agents to start
echo -e "${YELLOW}Waiting for agents to start (5 seconds)...${NC}"
sleep 5

# Auto-discover agents in CLI pane
echo -e "${YELLOW}Auto-discovering agents...${NC}"
cmux send --workspace "$WORKSPACE_ID" "npm run agent-cli -- discover"
cmux send-key --workspace "$WORKSPACE_ID" Enter

echo -e "${GREEN}✓ CMUX workspace created with 4 agents + CLI${NC}"
echo -e "${GREEN}✓ All agents running with live logs${NC}"
echo -e "${GREEN}✓ CLI pane ready for commands${NC}"
echo ""
echo -e "${BLUE}Switch to the 'Agent Orchestration' workspace in CMUX to see your agents!${NC}"