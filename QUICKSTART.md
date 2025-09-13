# 🚀 Quick Start Guide - Robot Overhead Monitor

## Your Setup
- Camera IP: `192.168.88.40`
- llama.cpp with SmolVLM installed
- RTSP stream likely on port 554

## Step 1: Install Dependencies

```bash
# Install Node.js dependencies
npm install

# Install FFmpeg (required for RTSP streaming)
brew install ffmpeg
```

## Step 2: Start the llama.cpp Server

```bash
# Make the script executable
chmod +x start-llama-server.sh

# Edit the script to point to your llama.cpp and model paths
nano start-llama-server.sh

# Start the server
./start-llama-server.sh
```

The llama.cpp server should now be running at `http://localhost:8080`

## Step 3: Start the RTSP Proxy Server

```bash
# This converts RTSP to a browser-viewable format
node rtsp-proxy.js
```

This will start a proxy server on `http://localhost:3001`

## Step 4: Open the Camera Viewer

### Option A: Direct HTML File
Simply open `camera-viewer.html` in your browser

### Option B: Via the Proxy Server
Navigate to `http://localhost:3001` in your browser

## Step 5: Connect to Your Camera

1. In the camera viewer, you'll see configuration options
2. The camera URL is pre-filled with `rtsp://192.168.88.40:554/stream1`
3. Click **"Connect Camera"**

### If RTSP doesn't work directly:

Try these alternative methods:

#### Method 1: HTTP Snapshot
- Change protocol to "HTTP Snapshot"
- URL: `http://192.168.88.40/snapshot.jpg`

#### Method 2: MJPEG Stream via Proxy
- Change protocol to "MJPEG Stream"  
- URL: `http://localhost:3001/stream.mjpeg`

## Step 6: Start Analysis

1. Once connected to the camera, click **"Start Analysis"**
2. Adjust the interval (default is 2 seconds)
3. Customize the prompt or use quick prompts from the dropdown
4. Watch as SmolVLM analyzes what it sees!

## Troubleshooting

### Camera Connection Issues

Test your camera URLs:
```bash
# Test RTSP with FFmpeg
ffmpeg -rtsp_transport tcp -i rtsp://192.168.88.40:554/stream1 -t 5 -f null -

# Test all common RTSP paths
curl http://localhost:3001/test-rtsp
```

Common RTSP URLs for IP cameras:
- `rtsp://192.168.88.40:554/stream1`
- `rtsp://192.168.88.40:554/1`
- `rtsp://192.168.88.40:554/live`
- `rtsp://192.168.88.40:554/ch0_0.h264`
- `rtsp://admin:password@192.168.88.40:554/stream1` (with credentials)

### llama.cpp Issues

If the vision analysis isn't working:

1. Check that llama.cpp server is running:
```bash
curl http://localhost:8080/health
```

2. Test the API directly:
```bash
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Hello"}],
    "temperature": 0.7
  }'
```

### Alternative: Use HTTP Snapshots

If RTSP is problematic, many IP cameras support HTTP snapshots:

1. Find your camera's web interface: `http://192.168.88.40`
2. Look for snapshot URL (often `/snapshot.jpg` or `/image.jpg`)
3. Use HTTP mode in the viewer

## Features

- **📹 Live Camera Feed**: View your camera stream in real-time
- **🤖 AI Analysis**: SmolVLM describes what it sees
- **⏱️ Adjustable Interval**: Analyze every 0.5 to 10 seconds
- **💬 Custom Prompts**: Ask specific questions about the scene
- **📸 Snapshots**: Capture images anytime
- **📊 Analysis History**: See the last 20 analysis results

## Quick Prompts Available

- Robot Count & Status
- Check for Tipped Robots
- Collision Detection
- Stuck Robot Detection
- Task Analysis
- Safety Check

## Full System (Optional)

To run the complete monitoring system with database and all features:

```bash
# Using Docker
docker-compose up -d

# Or manually
npm start
```

Then navigate to `http://localhost:3000` for the full dashboard.

---

## Summary

You should now be able to:
1. ✅ See your camera feed at 192.168.88.40 in the browser
2. ✅ Have SmolVLM analyze what it sees
3. ✅ Adjust the analysis interval (0.5 - 10 seconds)
4. ✅ Use custom prompts to ask specific questions
5. ✅ Save snapshots of interesting moments

The system will continuously analyze the camera feed and show you what the AI sees!