#!/bin/bash

# Start the Public Monitor Server on port 4040
# This is the PUBLIC VIEWER with read-only access and chat

echo "🤖 Starting Public Monitor Server (Read-Only Viewer)"
echo "===================================================="
echo "📍 Port: 4040 (PUBLIC - Safe to share)"
echo "✨ Features:"
echo "  • Live video stream (proxied from internal server)"
echo "  • Public chat for teleoperators"
echo "  • Read-only access"
echo "  • Event notifications"
echo ""
echo "⚠️  NOTE: This requires the Enhanced Robot Monitor"
echo "         to be running on port 3000"
echo ""

# Check if internal server is running
if ! lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "❌ ERROR: Enhanced Robot Monitor not running on port 3000"
    echo "   Please run: ./start-robot-monitor.sh first"
    exit 1
fi

# Kill any existing instances
pkill -f "node.*robot-monitor-public-server.js" || true
sleep 1

# Start the public server
node robot-monitor-public-server.js