#!/bin/bash

echo "🚀 Starting Everything..."

# Kill old stuff
pkill -f node
pkill -f llama-server

# Start camera server and proxy
./start-camera-monitor.sh &

# Wait for it to start
sleep 3

# Also serve the SmolVLM HTML
echo "Adding SmolVLM page to http://localhost:3000/test-camera-stream-smolvlm.html"

echo "✅ Done! Open http://localhost:3000 in Safari"
echo "Press Ctrl+C to stop"

wait