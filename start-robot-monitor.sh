#!/bin/bash

echo "🤖 Starting Robot Overhead Monitor (AI-Enhanced)..."
echo "=============================================="

# Kill any existing processes on port 3000
echo "Cleaning up old processes..."
lsof -ti:3000 | xargs kill -9 2>/dev/null

# Start the enhanced server with AI capabilities
echo "Starting Enhanced Robot Monitor Server on port 3000..."
echo ""
PORT=3000 node robot-monitor-server-enhanced.js