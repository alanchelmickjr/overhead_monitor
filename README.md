# Robot Overhead Monitor 🤖📷

A real-time vision monitoring system that uses SmolVLM to observe and analyze robot behavior in a pen environment through an overhead IP camera. The system detects critical events, tracks performance, and provides alerts for various robot conditions.

## Overview

The Robot Overhead Monitor leverages computer vision and language models to continuously monitor robots in their operational environment. Using an overhead IP camera, the system captures frames at configurable intervals and analyzes them for specific conditions like task completion, robot failures, or performance metrics.

## Key Features

- **Real-time IP Camera Integration**: Connects to overhead room cameras for continuous monitoring
- **Intelligent Event Detection**: Identifies robot tipping, stuck conditions, collisions, and task completions
- **Configurable Alert System**: Customizable thresholds and response actions
- **Performance Analytics**: Tracks robot movement patterns, task completion times, and efficiency
- **Web-based Dashboard**: Live video feed with overlay zones and status indicators
- **Event Logging**: Comprehensive logging with timestamps and screenshots
- **Multi-robot Support**: Monitor and coordinate multiple robots simultaneously

## Quick Start

### Prerequisites

- Node.js 18+ or Python 3.10+
- Access to IP camera with RTSP/HTTP stream
- SmolVLM API server running locally or accessible endpoint
- Modern web browser (Chrome, Firefox, Safari)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/overhead_monitor.git
cd overhead_monitor

# Install dependencies (if using Node.js backend)
npm install

# Or for Python backend
pip install -r requirements.txt
```

### Configuration

1. Copy the example configuration:
```bash
cp config.example.json config.json
```

2. Edit `config.json` with your IP camera details:
```json
{
  "camera": {
    "ip": "192.168.1.100",
    "username": "admin",
    "password": "your-password",
    "stream_url": "rtsp://192.168.1.100:554/stream1"
  },
  "api": {
    "base_url": "http://localhost:8080",
    "model": "smolvlm-latest"
  }
}
```

### Running the System

```bash
# Start the monitoring server
npm start

# Or for Python
python app.py
```

Open your browser and navigate to `http://localhost:3000`

## System Architecture

The system consists of several key components:

- **Camera Interface**: Handles IP camera connection and stream processing
- **Vision Processing**: Captures frames and sends to SmolVLM API
- **Detection Engine**: Analyzes responses for specific robot conditions
- **Alert Manager**: Triggers notifications and actions based on events
- **Web Dashboard**: Real-time visualization and control interface
- **Data Storage**: Event logging and metrics persistence

For detailed architecture information, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Robot Monitoring Scenarios

### Critical Events
- **Robot Tipping**: Detects when a robot has fallen or tipped over
- **Stuck Detection**: Identifies robots that haven't moved for configured duration
- **Collision Detection**: Recognizes robot-to-robot or robot-to-obstacle collisions
- **Boundary Violations**: Alerts when robots leave designated zones

### Performance Tracking
- **Task Completion**: Monitors successful task execution
- **Path Efficiency**: Analyzes movement patterns and optimization
- **Speed Monitoring**: Tracks robot velocity and acceleration patterns
- **Coordination Metrics**: Multi-robot collaboration effectiveness

For comprehensive monitoring scenarios, see [MONITORING_GUIDE.md](MONITORING_GUIDE.md).

## Configuration Options

### Camera Settings
- Stream type (RTSP, HTTP MJPEG, WebRTC)
- Frame capture rate (100ms - 2s intervals)
- Video quality and compression settings

### Detection Parameters
- Confidence thresholds for event detection
- Zone definitions for area monitoring
- Alert sensitivity levels
- Response action mappings

### UI Customization
- Dashboard layout options
- Overlay zone visualization
- Status indicator preferences
- Historical data display settings

## API Integration

The system communicates with a SmolVLM-compatible API endpoint:

```javascript
POST /v1/chat/completions
{
  "messages": [{
    "role": "user",
    "content": [
      { "type": "text", "text": "Is the robot tipped over?" },
      { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,..." }}
    ]
  }],
  "max_tokens": 100
}
```

For complete API documentation, see [API.md](API.md).

## Development

### Project Structure
```
overhead_monitor/
├── src/
│   ├── camera/         # IP camera integration
│   ├── detection/      # Event detection logic
│   ├── api/           # SmolVLM API client
│   └── web/           # Dashboard interface
├── config/            # Configuration files
├── docs/             # Documentation
└── tests/            # Test suites
```

### Testing
```bash
# Run unit tests
npm test

# Run integration tests
npm run test:integration

# Run with test camera feed
npm run dev:mock
```

### Contributing
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Troubleshooting

### Common Issues

**Camera Connection Failed**
- Verify IP camera is accessible on network
- Check credentials and stream URL
- Ensure firewall allows camera access

**API Timeout Errors**
- Confirm SmolVLM server is running
- Adjust timeout settings in config
- Check network connectivity

**Low Frame Rate**
- Reduce video quality settings
- Increase capture interval
- Optimize network bandwidth

For detailed troubleshooting, see [SETUP.md](SETUP.md#troubleshooting).

## License

MIT License - see [LICENSE](LICENSE) file for details

## Acknowledgments

- SmolVLM team for the vision-language model
- Contributors and testers
- Robot pen facility for testing environment

## Support

- **Documentation**: [Full documentation](docs/)
- **Issues**: [GitHub Issues](https://github.com/yourusername/overhead_monitor/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/overhead_monitor/discussions)

---

**Current Version**: 1.0.0  
**Last Updated**: December 2024