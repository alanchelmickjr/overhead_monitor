#!/bin/bash

# Stop all daemon processes

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}🛑 Stopping all daemon services...${NC}"

# Kill processes using PID files
for pidfile in /tmp/*.pid; do
    if [ -f "$pidfile" ]; then
        PID=$(cat "$pidfile")
        SERVICE=$(basename "$pidfile" .pid)
        if kill -0 "$PID" 2>/dev/null; then
            echo "Stopping $SERVICE (PID: $PID)..."
            kill "$PID" 2>/dev/null
        fi
        rm "$pidfile"
    fi
done

# Also kill by process name as backup
pkill -f "llama-server" 2>/dev/null || true
pkill -f "node.*robot-monitor" 2>/dev/null || true
pkill -f "ngrok" 2>/dev/null || true

# Kill any lingering start-all.sh process
pkill -f "start-all.sh" 2>/dev/null || true

echo -e "${GREEN}✅ All services stopped${NC}"
echo ""
echo "Log files preserved in /tmp/*.log"