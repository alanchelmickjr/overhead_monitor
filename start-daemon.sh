#!/bin/bash

# Lightweight daemon wrapper - uses existing start scripts
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}🚀 Starting Overhead Monitor in Daemon Mode${NC}"

# Kill any existing processes first
echo -e "${YELLOW}Cleaning up existing processes...${NC}"
pkill -f "llama-server" 2>/dev/null || true
pkill -f "node.*robot-monitor" 2>/dev/null || true
pkill -f "ngrok" 2>/dev/null || true
sleep 2

# Start llama server using existing script
if [ -f "start-llama-server.sh" ]; then
    echo -e "${GREEN}Starting llama server...${NC}"
    nohup ./start-llama-server.sh > /tmp/llama-server.log 2>&1 &
    echo "llama-server PID: $! (log: /tmp/llama-server.log)"
    echo "$!" > /tmp/llama-server.pid
    sleep 5
fi

# Start robot monitor using existing script
if [ -f "start-robot-monitor.sh" ]; then
    echo -e "${GREEN}Starting robot monitor...${NC}"
    nohup ./start-robot-monitor.sh > /tmp/robot-monitor.log 2>&1 &
    echo "robot-monitor PID: $! (log: /tmp/robot-monitor.log)"
    echo "$!" > /tmp/robot-monitor.pid
fi

# Start public monitor using existing script  
if [ -f "start-public-monitor.sh" ]; then
    echo -e "${GREEN}Starting public monitor...${NC}"
    nohup ./start-public-monitor.sh > /tmp/public-monitor.log 2>&1 &
    echo "public-monitor PID: $! (log: /tmp/public-monitor.log)"
    echo "$!" > /tmp/public-monitor.pid
fi

# Start ngrok if configured
if ngrok config check &>/dev/null; then
    echo -e "${GREEN}Starting ngrok...${NC}"
    nohup ngrok http 4040 --domain=lekiwi.ngrok.io > /tmp/ngrok.log 2>&1 &
    echo "ngrok PID: $! (log: /tmp/ngrok.log)"
    echo "$!" > /tmp/ngrok.pid
fi

echo ""
echo -e "${GREEN}✅ Services started in daemon mode${NC}"
echo ""
echo "📊 Service Status:"
echo "  • Robot Monitor: http://localhost:3000"
echo "  • Public Viewer: http://localhost:4040"
echo "  • LLaVA API: http://localhost:8080"
echo ""
echo "🛑 To stop: ./stop-daemon.sh"
echo "📝 Logs: /tmp/*.log"