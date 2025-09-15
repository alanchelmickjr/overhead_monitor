# LeKiwi Robot Nanny Cam 🤖🥝

> *Overhead monitoring system for LeKiwi holonomic robots with 6DOF arms*

A real-time computer vision system that watches LeKiwi robots from above, tracking their movements, arm operations, and ball-in-bucket scoring events in the arena.

![Robot Status](https://img.shields.io/badge/LeKiwi-Active-brightgreen)
![Vision AI](https://img.shields.io/badge/Vision-AI%20Powered-blue)
![Scoring](https://img.shields.io/badge/Ball%20Tracking-Enabled-ff69b4)

## 🤖 What are LeKiwi Robots?

LeKiwi robots by Hugging Face feature:
- **Holonomic Drive Base**: Tri-wheel omnidirectional movement
- **6DOF Robot Arm**: LeRobot arm mounted on top for manipulation tasks
- **Round Form Factor**: Compact circular design for agile navigation

## 📹 System Overview

The nanny cam system provides:
- **Overhead Camera View**: Wall-mounted camera looking down at the robot arena floor
- **Real-time Robot Tracking**: Monitor multiple LeKiwi robots simultaneously
- **Ball-in-Bucket Scoring**: Automatic point detection when balls enter the white bucket
- **Multi-Model Vision AI**: LLaVA, SmolVLM, and custom model support
- **Remote Access**: Built-in ngrok integration for monitoring from anywhere

## 🚀 Quick Start

```bash
# Clone the repository
git clone https://github.com/yourusername/lekiwi-robot-nanny-cam.git
cd lekiwi-robot-nanny-cam

# One button to rule them all
./start-all.sh

# That's it! The system will:
# - Install all dependencies
# - Download AI models
# - Start the camera feed
# - Launch the monitoring interface
```

## 🌐 Remote Access Setup

Watch your robots from anywhere with automated ngrok setup:

```bash
# Run the automated setup wizard
./setup-ngrok.sh

# Or configure manually if preferred
ngrok config add-authtoken YOUR_TOKEN_HERE
```

## 📊 Features

### Robot Monitoring
- Track multiple LeKiwi robots in real-time
- Monitor arm movements and manipulation tasks
- Detect robot collisions or stuck conditions
- Record robot paths and activity patterns

### Ball-in-Bucket Scoring
- Automatic detection when balls enter the white bucket
- Score tracking and event logging
- Visual indicators for successful shots
- Dataset creation for training robot shooting skills

### Vision AI Capabilities
- **Object Detection**: Identify robots, balls, and obstacles
- **Motion Analysis**: Track movement patterns and trajectories
- **Event Recognition**: Detect specific robot behaviors
- **Multi-Model Support**: Switch between different AI models on the fly

## 🛠️ System Architecture

```
Wall Camera (Overhead View)
         |
         v
  Camera Server (RTSP)
         |
         v
   Vision AI Engine
    /    |    \
LLaVA  SmolVLM  Custom
   \     |     /
    Web Interface
         |
    Remote Access
      (ngrok)
```

## 📱 Interface

Access the monitoring dashboard at:
- **Local**: http://localhost:3000
- **Remote**: Your ngrok URL (shown after running start-all.sh)

### Dashboard Features
- Live camera feed with overlay
- Robot status indicators
- Score counter for ball-in-bucket events
- Model selection dropdown
- Event log and alerts

## 🎯 Use Cases

1. **Robot Training**: Create datasets for robot manipulation tasks
2. **Competition Monitoring**: Track robot performance in challenges
3. **Research**: Analyze robot behavior patterns
4. **Remote Supervision**: Monitor robot arena from anywhere
5. **Fun**: Keep score of robot basketball games!

## 🔧 Configuration

### Camera Setup
Edit `config.json` to set your camera URL:
```json
{
  "camera": {
    "url": "rtsp://your-camera-ip/stream"
  }
}
```

### Scoring Zone
The system automatically detects the white bucket. To adjust detection:
- Edit detection parameters in `src/detection/EventDetector.js`
- Modify scoring logic in `src/vision/VisionEngine.js`

## 📚 Documentation

- [API Documentation](API.md)
- [Architecture Guide](ARCHITECTURE.md)
- [Monitoring Guide](MONITORING_GUIDE.md)
- [Multi-Model Setup](MULTI_MODEL_GUIDE.md)
- [ngrok Setup](NGROK_SETUP.md)

## 🤝 Contributing

We welcome contributions! Whether it's improving robot detection, adding new scoring modes, or enhancing the UI.

## 📄 License

MIT License - Feel free to use this for your robot monitoring needs!

---

**Built with ❤️ for the LeKiwi robot community**