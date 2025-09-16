#!/bin/bash

echo "🚀 Starting SmolVLM Live Robot Monitor"
echo "====================================="

# Check if SmolVLM server is running
echo "Checking SmolVLM server..."
if curl -s http://localhost:8080/health > /dev/null 2>&1; then
    echo "✅ SmolVLM server is running"
else
    echo "⚠️  SmolVLM server not detected!"
    echo "Please start it with: ./start-llama-server.sh"
    echo ""
fi

# Check if RTSP proxy is running
echo "Checking RTSP proxy..."
if curl -s http://localhost:3000/status > /dev/null 2>&1; then
    echo "✅ RTSP proxy is running"
else
    echo "⚠️  RTSP proxy not running!"
    echo "Starting camera services..."
    ./start-camera-monitor.sh &
    sleep 3
fi

echo ""
echo "📺 Opening SmolVLM Live Monitor..."
echo "====================================="
echo ""
echo "Features:"
echo "  • Real-time motion detection"
echo "  • SmolVLM vision analysis"
echo "  • Automatic event announcements"
echo "  • Ball-in-cup scoring detection"
echo "  • Robot status monitoring"
echo ""
echo "To share via ngrok:"
echo "  ngrok http 3000"
echo ""

# Open in default browser
open smolvlm-live-monitor.html

echo "Monitor is ready! Check your browser."