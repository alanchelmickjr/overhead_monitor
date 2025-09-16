#!/bin/bash

# Start ngrok with custom domain for LeKiwi Robot Nanny Cam
# Uses the upgraded ngrok account with custom domain: lekiwi.ngrok.io

echo "🚀 Starting ngrok with custom domain..."
echo "==============================================="
echo "Custom Domain: https://lekiwi.ngrok.io"
echo "Public Chat: Port 4040 → lekiwi.ngrok.io"
echo "==============================================="

# Check if ngrok is installed
if ! command -v ngrok &> /dev/null; then
    echo "❌ ngrok is not installed. Please install it first:"
    echo "   brew install ngrok/ngrok/ngrok"
    exit 1
fi

# Check if ngrok.yml exists
if [ ! -f "ngrok.yml" ]; then
    echo "❌ ngrok.yml not found. Please ensure it exists in the current directory."
    exit 1
fi

# Start ngrok with custom domain configuration
echo "Starting ngrok with custom domain lekiwi.ngrok.io..."
ngrok start robot-monitor --config ngrok.yml &

echo ""
echo "✅ ngrok started with custom domain!"
echo ""
echo "📱 Public Access URLs:"
echo "   - Public Chat: https://lekiwi.ngrok.io"
echo "   - Robot Monitor: Check ngrok dashboard for auto-generated URL"
echo "   - Llava API: Check ngrok dashboard for auto-generated URL"
echo ""
echo "📊 ngrok Dashboard: http://localhost:4040"
echo ""
echo "To stop ngrok, press Ctrl+C or run: pkill ngrok"