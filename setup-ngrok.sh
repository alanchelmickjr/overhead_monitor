#!/bin/bash

# Robot Monitor ngrok Setup Script
# This script starts the application and creates an ngrok tunnel

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}🚀 Robot Monitor External Access Setup${NC}"
echo "======================================"

# Check if ngrok is installed
if ! command -v ngrok &> /dev/null; then
    echo -e "${RED}❌ ngrok is not installed${NC}"
    echo "Please install ngrok first: https://ngrok.com/download"
    exit 1
fi

# Check if robot monitor is running
if ! curl -s http://localhost:3000/status > /dev/null; then
    echo -e "${YELLOW}⚠️  Robot Monitor not running. Starting it now...${NC}"
    npm start &
    SERVER_PID=$!
    
    # Wait for server to start
    echo "Waiting for server to start..."
    sleep 5
    
    if ! curl -s http://localhost:3000/status > /dev/null; then
        echo -e "${RED}❌ Failed to start Robot Monitor${NC}"
        exit 1
    fi
fi

echo -e "${GREEN}✅ Robot Monitor is running${NC}"

# Start ngrok
echo -e "${YELLOW}🔗 Starting ngrok tunnel...${NC}"

# Create a simple ngrok configuration if it doesn't exist
if [ ! -f "ngrok.yml" ]; then
    cat > ngrok.yml << EOF
version: "2"
tunnels:
  robot-monitor:
    proto: http
    addr: 3000
    inspect: true
    bind_tls: true
    schemes:
      - https
EOF
fi

# Start ngrok in background and capture output
ngrok start --config ngrok.yml robot-monitor > ngrok.log 2>&1 &
NGROK_PID=$!

sleep 3

# Get the public URL
NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | grep -o '"public_url":"https://[^"]*' | grep -o 'https://[^"]*' | head -1)

if [ -z "$NGROK_URL" ]; then
    echo -e "${RED}❌ Failed to get ngrok URL${NC}"
    echo "Check ngrok.log for errors"
    exit 1
fi

# Display access information
echo ""
echo -e "${GREEN}✅ External Access Enabled!${NC}"
echo "======================================"
echo -e "🌐 Public URL: ${YELLOW}$NGROK_URL${NC}"
echo -e "📹 Camera Stream: ${YELLOW}$NGROK_URL/stream.mjpeg${NC}"
echo -e "📸 Snapshot: ${YELLOW}$NGROK_URL/snapshot.jpg${NC}"
echo -e "🔍 ngrok Inspector: ${YELLOW}http://localhost:4040${NC}"
echo ""
echo -e "${YELLOW}Share the public URL with your team!${NC}"
echo ""
echo "Press Ctrl+C to stop..."

# Create access info file
cat > access-info.txt << EOF
Robot Monitor External Access
============================
Public URL: $NGROK_URL
Camera Stream: $NGROK_URL/stream.mjpeg
Snapshot: $NGROK_URL/snapshot.jpg
Generated: $(date)
EOF

# Handle cleanup
cleanup() {
    echo -e "\n${YELLOW}Shutting down...${NC}"
    if [ ! -z "$NGROK_PID" ]; then
        kill $NGROK_PID 2>/dev/null || true
    fi
    if [ ! -z "$SERVER_PID" ]; then
        kill $SERVER_PID 2>/dev/null || true
    fi
    rm -f ngrok.log
    echo -e "${GREEN}✅ Cleanup complete${NC}"
    exit 0
}

trap cleanup EXIT INT TERM

# Wait
wait