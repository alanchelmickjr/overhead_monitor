#!/bin/bash

echo "🤖 Starting Robot Monitor Public Server..."
echo "=========================================="

# Kill any existing processes on port 4040
echo "Cleaning up old processes..."
lsof -ti:4040 | xargs kill -9 2>/dev/null

# Start the public server
echo "Starting Public Monitor Server on port 4040..."
echo ""
node robot-monitor-public-server.js