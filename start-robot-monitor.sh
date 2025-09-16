#!/bin/bash

# Start the Enhanced Robot Monitor Server on port 3000
# This is the INTERNAL CONTROL server with ALL features

echo "🚀 Starting Enhanced Robot Monitor (Internal Control)"
echo "=================================================="
echo "📍 Port: 3000 (PRIVATE - DO NOT SHARE)"
echo "✨ Features:"
echo "  • RTSP proxy"
echo "  • Frame capture & buffering"
echo "  • Multi-model AI vision"
echo "  • Model benchmarking"
echo "  • Full control interface"
echo ""

# Kill any existing instances
pkill -f "node.*robot-monitor-server-enhanced.js" || true
sleep 1

# Start the enhanced server
PORT=3000 node robot-monitor-server-enhanced.js