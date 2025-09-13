#!/bin/bash

echo "🤖 Starting Robot Overhead Monitor (All-in-One)..."
echo "=============================================="

# Kill any existing processes on port 3000
echo "Cleaning up old processes..."
lsof -ti:3000 | xargs kill -9 2>/dev/null

# Start the all-in-one server
echo "Starting Robot Monitor Server on port 3000..."
echo ""
node robot-monitor-server.js