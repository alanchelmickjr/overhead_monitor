#!/bin/bash

echo "🚀 Starting Everything..."

# Kill old stuff
pkill -f node
pkill -f llama-server

# Start camera server and proxy
./start-camera-monitor.sh &

# Start llama server for SmolVLM
./start-llama-server.sh &

# Wait for them to start
sleep 5

# Also serve the SmolVLM HTML
echo "Adding SmolVLM page to http://localhost:3000/test-camera-stream-smolvlm.html"

echo "✅ Done! Open http://localhost:3000 in Safari"
echo "Press Ctrl+C to stop"

wait