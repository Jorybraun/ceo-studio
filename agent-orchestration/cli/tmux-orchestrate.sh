#!/bin/bash

# Tmux Agent Orchestration Script
# 
# Creates a tmux session with 4 agent panes + CLI pane
# All agents run with live logs visible
# Agent registry maintains coordination

SESSION_NAME="agent-orchestration"
PROJECT_PATH="/Users/hans/Code/AGENT/CEO_STUDIO"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Tmux Agent Orchestration ===${NC}"
echo -e "${GREEN}Creating tmux session with 4 agents + CLI${NC}"
echo ""

# Kill existing session if it exists
tmux kill-session -t $SESSION_NAME 2>/dev/null

# Create new session
tmux new-session -d -s $SESSION_NAME -n "orchestration"

# Pane 1: Devin Agent (port 8001)
echo -e "${YELLOW}Starting Devin Agent in pane 1...${NC}"
tmux split-window -h -t $SESSION_NAME:0
tmux select-pane -t $SESSION_NAME:0.0
tmux send-keys -t $SESSION_NAME:0.0 "cd $PROJECT_PATH/agent-orchestration" C-m
tmux send-keys -t $SESSION_NAME:0.0 "npm run agent-server -- --type devin --port 8001 --project $PROJECT_PATH" C-m
tmux select-pane -t $SESSION_NAME:0.0 -T "Devin (8001)"

# Pane 2: Voice Agent (port 8002)
echo -e "${YELLOW}Starting Voice Agent in pane 2...${NC}"
tmux split-window -v -t $SESSION_NAME:0.0
tmux send-keys -t $SESSION_NAME:0.1 "cd $PROJECT_PATH/agent-orchestration" C-m
tmux send-keys -t $SESSION_NAME:0.1 "npm run agent-server -- --type voice-agent --port 8002 --project $PROJECT_PATH" C-m
tmux select-pane -t $SESSION_NAME:0.1 -T "Voice Agent (8002)"

# Pane 3: Specialist Agent (port 8003)
echo -e "${YELLOW}Starting Specialist Agent in pane 3...${NC}"
tmux split-window -v -t $SESSION_NAME:0.1
tmux send-keys -t $SESSION_NAME:0.2 "cd $PROJECT_PATH/agent-orchestration" C-m
tmux send-keys -t $SESSION_NAME:0.2 "npm run agent-server -- --type specialist --port 8003 --project $PROJECT_PATH" C-m
tmux select-pane -t $SESSION_NAME:0.2 -T "Specialist (8003)"

# Pane 4: Coordinator Agent (port 8004)
echo -e "${YELLOW}Starting Coordinator Agent in pane 4...${NC}"
tmux split-window -h -t $SESSION_NAME:0.2
tmux send-keys -t $SESSION_NAME:0.3 "cd $PROJECT_PATH/agent-orchestration" C-m
tmux send-keys -t $SESSION_NAME:0.3 "npm run agent-server -- --type coordinator --port 8004 --project $PROJECT_PATH" C-m
tmux select-pane -t $SESSION_NAME:0.3 -T "Coordinator (8004)"

# Pane 5: CLI (bottom pane for commands)
echo -e "${YELLOW}Starting CLI pane in pane 5...${NC}"
tmux split-window -v -t $SESSION_NAME:0.3
tmux send-keys -t $SESSION_NAME:0.4 "cd $PROJECT_PATH/agent-orchestration" C-m
tmux send-keys -t $SESSION_NAME:0.4 "echo '=== Agent CLI Ready ==='" C-m
tmux send-keys -t $SESSION_NAME:0.4 "echo 'Commands:'" C-m
tmux send-keys -t $SESSION_NAME:0.4 "echo '  npm run agent-cli -- discover'" C-m
tmux send-keys -t $SESSION_NAME:0.4 "echo '  npm run agent-cli -- talk --from <agent> --to <agent> --message <msg>'" C-m
tmux send-keys -t $SESSION_NAME:0.4 "echo '  npm run agent-cli -- collaborate --project <path>'" C-m
tmux send-keys -t $SESSION_NAME:0.4 "echo '  npm run agent-cli -- monitor'" C-m
tmux send-keys -t $SESSION_NAME:0.4 "echo ''" C-m
tmux select-pane -t $SESSION_NAME:0.4 -T "CLI"

# Wait for agents to start
echo -e "${YELLOW}Waiting for agents to start (5 seconds)...${NC}"
sleep 5

# Auto-discover agents in CLI pane
echo -e "${YELLOW}Auto-discovering agents...${NC}"
tmux send-keys -t $SESSION_NAME:0.4 "npm run agent-cli -- discover" C-m

# Layout optimization
tmux select-layout -t $SESSION_NAME:0 tiled

# Set pane colors and borders
tmux set -g pane-border-style fg=blue
tmux set -g pane-active-border-style fg=green

# Show pane numbers
tmux set -g pane-border-status top
tmux set -g pane-border-format " #{pane_index} #{pane_title} "

# Enable mouse support
tmux set -g mouse on

# Select CLI pane
tmux select-pane -t $SESSION_NAME:0.4

echo -e "${GREEN}✓ Tmux session created: $SESSION_NAME${NC}"
echo -e "${GREEN}✓ 4 agents running in separate panes${NC}"
echo -e "${GREEN}✓ CLI pane ready for commands${NC}"
echo ""
echo -e "${BLUE}Attach to session:${NC}"
echo "  tmux attach-session -t $SESSION_NAME"
echo ""
echo -e "${BLUE}Or use this command to attach now:${NC}"
echo "  tmux attach -t $SESSION_NAME"

# Auto-attach if not already in tmux
if [ -z "$TMUX" ]; then
    echo -e "${YELLOW}Attaching to session...${NC}"
    tmux attach-session -t $SESSION_NAME
else
    echo -e "${YELLOW}Already in tmux. Attach manually with: tmux attach -t $SESSION_NAME${NC}"
fi