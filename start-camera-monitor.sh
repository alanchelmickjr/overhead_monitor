#!/bin/bash

echo "🤖 Starting Robot Overhead Monitor..."
echo "====================================="

# Kill any existing processes on ports 3000 and 3001
echo "Cleaning up old processes..."
lsof -ti:3000 | xargs kill -9 2>/dev/null
lsof -ti:3001 | xargs kill -9 2>/dev/null

# Start RTSP proxy in background
echo "Starting RTSP Proxy on port 3001..."
node rtsp-proxy.js &
PROXY_PID=$!

# Wait a moment for proxy to start
sleep 2

# Start camera server
echo "Starting Camera Server on port 3000..."
echo ""
node camera-server.js

# Cleanup on exit
trap "kill $PROXY_PID 2>/dev/null" EXIT