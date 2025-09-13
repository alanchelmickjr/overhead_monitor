# Setup Guide

This guide provides detailed instructions for setting up the Robot Overhead Monitor system, including camera configuration, server installation, and system deployment.

## Table of Contents
- [Prerequisites](#prerequisites)
- [IP Camera Setup](#ip-camera-setup)
- [Server Installation](#server-installation)
- [SmolVLM API Setup](#smolvlm-api-setup)
- [Configuration](#configuration)
- [Deployment Options](#deployment-options)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### System Requirements

**Minimum Requirements:**
- CPU: 4 cores @ 2.4GHz
- RAM: 8GB
- Storage: 50GB available
- Network: 100Mbps
- OS: Ubuntu 20.04+, macOS 12+, Windows 10+

**Recommended Requirements:**
- CPU: 8 cores @ 3.0GHz
- RAM: 16GB
- Storage: 200GB SSD
- Network: 1Gbps
- GPU: NVIDIA GTX 1060+ (for local SmolVLM)

### Software Dependencies

```bash
# Node.js version 18 or higher
node --version  # Should output v18.x.x or higher

# Python 3.10+ (if using Python backend)
python3 --version  # Should output Python 3.10.x or higher

# Git
git --version

# Docker (optional, for containerized deployment)
docker --version
```

### Network Requirements

- Access to IP camera on local network
- Port 3000 available for web dashboard
- Port 8080 available for SmolVLM API (or external endpoint)
- WebSocket support for real-time updates

## IP Camera Setup

### Supported Camera Types

1. **RTSP Cameras** (Recommended)
   - Most IP cameras support RTSP
   - Low latency streaming
   - H.264/H.265 codec support

2. **HTTP MJPEG Cameras**
   - Simple setup
   - Higher bandwidth usage
   - Universal browser support

3. **WebRTC Cameras**
   - Ultra-low latency
   - P2P capability
   - Requires STUN/TURN server

### Camera Configuration

#### Step 1: Find Your Camera's IP Address

```bash
# Scan network for IP cameras (Linux/Mac)
nmap -p 554,80,8080 192.168.1.0/24

# Or use manufacturer's discovery tool
# Examples: ONVIF Device Manager, IP Camera Finder
```

#### Step 2: Access Camera Settings

1. Open web browser and navigate to camera IP
2. Login with admin credentials (check camera manual)
3. Configure the following settings:

```
Resolution: 1920x1080 (1080p) recommended
Frame Rate: 15-30 fps
Bitrate: 2-4 Mbps
Codec: H.264 (most compatible)
```

#### Step 3: Get Stream URL

**RTSP URL Format:**
```
rtsp://username:password@camera_ip:554/stream1
rtsp://username:password@camera_ip:554/h264/ch1/main/av_stream
```

**HTTP MJPEG URL Format:**
```
http://camera_ip/mjpg/video.mjpg
http://camera_ip:8080/video
```

**Common Camera URLs by Manufacturer:**

| Manufacturer | RTSP URL Pattern |
|-------------|------------------|
| Hikvision | `rtsp://user:pass@ip:554/Streaming/Channels/101` |
| Dahua | `rtsp://user:pass@ip:554/cam/realmonitor?channel=1&subtype=0` |
| Axis | `rtsp://user:pass@ip/axis-media/media.amp` |
| Foscam | `rtsp://user:pass@ip:88/videoMain` |
| Amcrest | `rtsp://user:pass@ip:554/cam/realmonitor?channel=1&subtype=0` |

#### Step 4: Test Camera Stream

```bash
# Test RTSP stream with VLC
vlc rtsp://username:password@camera_ip:554/stream1

# Test with ffmpeg
ffmpeg -i rtsp://username:password@camera_ip:554/stream1 -t 5 test.mp4

# Test HTTP MJPEG in browser
# Simply navigate to the HTTP URL in your browser
```

### Camera Positioning

For optimal robot monitoring:

1. **Mount Height**: 3-5 meters above robot pen
2. **Angle**: Direct overhead (90°) or slight angle (75-85°)
3. **Coverage**: Entire robot operation area visible
4. **Lighting**: Ensure adequate and even lighting
5. **Stability**: Secure mounting to prevent vibration

## Server Installation

### Option 1: Node.js Installation

```bash
# Clone repository
git clone https://github.com/yourusername/overhead_monitor.git
cd overhead_monitor

# Install dependencies
npm install

# Create environment file
cp .env.example .env

# Edit environment variables
nano .env
```

**.env Configuration:**
```bash
# Server Configuration
PORT=3000
NODE_ENV=production

# Camera Configuration
CAMERA_IP=192.168.1.100
CAMERA_USERNAME=admin
CAMERA_PASSWORD=your_password
CAMERA_STREAM_URL=rtsp://192.168.1.100:554/stream1

# API Configuration
SMOLVLM_API_URL=http://localhost:8080
SMOLVLM_API_KEY=your_api_key

# Database Configuration
DATABASE_URL=postgresql://user:password@localhost:5432/robot_monitor

# Alert Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
```

### Option 2: Python Installation

```bash
# Clone repository
git clone https://github.com/yourusername/overhead_monitor.git
cd overhead_monitor

# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Create configuration file
cp config.example.yaml config.yaml

# Edit configuration
nano config.yaml
```

**config.yaml Configuration:**
```yaml
server:
  host: 0.0.0.0
  port: 3000
  debug: false

camera:
  ip: 192.168.1.100
  username: admin
  password: your_password
  protocol: rtsp
  stream_path: /stream1
  port: 554

api:
  base_url: http://localhost:8080
  timeout: 30
  max_retries: 3

database:
  type: postgresql
  host: localhost
  port: 5432
  name: robot_monitor
  user: dbuser
  password: dbpass
```

### Option 3: Docker Installation

```bash
# Clone repository
git clone https://github.com/yourusername/overhead_monitor.git
cd overhead_monitor

# Build Docker image
docker build -t robot-monitor:latest .

# Create docker-compose.yml
cat > docker-compose.yml << EOF
version: '3.8'

services:
  app:
    image: robot-monitor:latest
    ports:
      - "3000:3000"
    environment:
      - CAMERA_IP=192.168.1.100
      - CAMERA_USERNAME=admin
      - CAMERA_PASSWORD=your_password
      - API_URL=http://smolvlm:8080
    volumes:
      - ./config:/app/config
      - ./data:/app/data
    restart: unless-stopped

  postgres:
    image: postgres:14
    environment:
      - POSTGRES_DB=robot_monitor
      - POSTGRES_USER=dbuser
      - POSTGRES_PASSWORD=dbpass
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

volumes:
  postgres_data:
EOF

# Start services
docker-compose up -d
```

## SmolVLM API Setup

### Option 1: Local SmolVLM Server

```bash
# Clone SmolVLM repository
git clone https://github.com/huggingface/smolvlm.git
cd smolvlm

# Install dependencies
pip install -r requirements.txt

# Download model weights
python download_model.py --model smolvlm-instruct

# Start API server
python server.py --port 8080 --model smolvlm-instruct
```

### Option 2: Docker SmolVLM

```bash
# Pull SmolVLM Docker image
docker pull huggingface/smolvlm:latest

# Run SmolVLM container
docker run -d \
  --name smolvlm \
  -p 8080:8080 \
  --gpus all \
  -v $(pwd)/models:/models \
  huggingface/smolvlm:latest
```

### Option 3: Cloud API Endpoint

Configure your cloud provider's endpoint:

```javascript
// config.json
{
  "api": {
    "base_url": "https://api.your-provider.com/v1",
    "api_key": "your-api-key",
    "model": "smolvlm-latest"
  }
}
```

## Configuration

### Zone Configuration

Create monitoring zones in `zones.json`:

```json
{
  "zones": [
    {
      "id": "zone-1",
      "name": "Pickup Area",
      "type": "rectangle",
      "coordinates": {
        "x": 100,
        "y": 100,
        "width": 300,
        "height": 200
      },
      "color": "#00ff00",
      "alerts": ["zone_entry", "zone_exit"]
    },
    {
      "id": "zone-2",
      "name": "Danger Zone",
      "type": "polygon",
      "coordinates": [
        {"x": 400, "y": 100},
        {"x": 500, "y": 150},
        {"x": 450, "y": 250},
        {"x": 350, "y": 200}
      ],
      "color": "#ff0000",
      "alerts": ["zone_violation"]
    }
  ]
}
```

### Alert Rules Configuration

Configure detection rules in `rules.json`:

```json
{
  "rules": [
    {
      "id": "tipped-robot",
      "name": "Robot Tipped Over",
      "condition": {
        "type": "keyword_match",
        "keywords": ["tipped", "fallen", "upside down", "on its side"],
        "confidence_threshold": 0.8
      },
      "alert": {
        "priority": "critical",
        "channels": ["dashboard", "email", "sms"],
        "cooldown": 60
      }
    },
    {
      "id": "stuck-detection",
      "name": "Robot Stuck",
      "condition": {
        "type": "no_movement",
        "duration": 30,
        "threshold": 5
      },
      "alert": {
        "priority": "warning",
        "channels": ["dashboard"],
        "cooldown": 120
      }
    }
  ]
}
```

### Performance Tuning

Optimize `performance.json`:

```json
{
  "capture": {
    "interval_ms": 500,
    "quality": 0.8,
    "max_width": 1920,
    "max_height": 1080
  },
  "processing": {
    "batch_size": 5,
    "max_concurrent": 3,
    "timeout_ms": 5000,
    "retry_attempts": 2
  },
  "storage": {
    "max_events": 10000,
    "retention_days": 30,
    "screenshot_compression": 0.7
  },
  "cache": {
    "enabled": true,
    "ttl_seconds": 10,
    "max_size_mb": 100
  }
}
```

## Deployment Options

### Development Deployment

```bash
# Start in development mode with hot reload
npm run dev

# Or with Python
python app.py --debug
```

### Production Deployment

#### Systemd Service (Linux)

Create `/etc/systemd/system/robot-monitor.service`:

```ini
[Unit]
Description=Robot Overhead Monitor
After=network.target

[Service]
Type=simple
User=robot-monitor
WorkingDirectory=/opt/robot-monitor
ExecStart=/usr/bin/node /opt/robot-monitor/server.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable robot-monitor
sudo systemctl start robot-monitor
```

#### PM2 Process Manager

```bash
# Install PM2
npm install -g pm2

# Start application
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup startup script
pm2 startup
```

`ecosystem.config.js`:
```javascript
module.exports = {
  apps: [{
    name: 'robot-monitor',
    script: './server.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
};
```

#### Kubernetes Deployment

Apply Kubernetes manifests:

```bash
kubectl create namespace robot-monitor
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/ingress.yaml
```

## Testing

### Unit Tests

```bash
# Run unit tests
npm test

# With coverage
npm run test:coverage

# Python tests
pytest tests/
```

### Integration Tests

```bash
# Run integration tests
npm run test:integration

# Test camera connection
npm run test:camera

# Test API connectivity
npm run test:api
```

### Load Testing

```bash
# Install artillery
npm install -g artillery

# Run load test
artillery run tests/load-test.yml
```

`tests/load-test.yml`:
```yaml
config:
  target: "http://localhost:3000"
  phases:
    - duration: 60
      arrivalRate: 10
  processor: "./tests/processor.js"

scenarios:
  - name: "Monitor Stream"
    engine: "socketio"
    flow:
      - emit:
          channel: "subscribe"
          data:
            room: "monitor"
      - think: 5
      - emit:
          channel: "capture"
      - think: 1
```

### Manual Testing Checklist

- [ ] Camera stream connects successfully
- [ ] Video feed displays in dashboard
- [ ] Frame capture works at configured interval
- [ ] API processes frames and returns responses
- [ ] Events are detected correctly
- [ ] Alerts are triggered for configured events
- [ ] Zone overlays render properly
- [ ] Historical events are stored and retrievable
- [ ] Configuration changes apply without restart
- [ ] System recovers from network interruptions

## Troubleshooting

### Common Issues and Solutions

#### Camera Connection Issues

**Problem**: Cannot connect to IP camera
```
Error: Connection refused to camera at 192.168.1.100:554
```

**Solutions**:
1. Verify camera IP address:
```bash
ping 192.168.1.100
```

2. Check camera credentials:
```bash
# Test with curl
curl -u username:password http://192.168.1.100/snapshot.jpg
```

3. Verify firewall settings:
```bash
# Check if port is open
telnet 192.168.1.100 554
```

4. Try alternative stream URLs:
```javascript
// config.json
"stream_urls": [
  "rtsp://192.168.1.100:554/stream1",
  "rtsp://192.168.1.100:554/h264/ch1/main/av_stream",
  "rtsp://192.168.1.100/live/main"
]
```

#### API Timeout Errors

**Problem**: SmolVLM API requests timing out
```
Error: API request timeout after 30000ms
```

**Solutions**:
1. Increase timeout in configuration:
```json
{
  "api": {
    "timeout": 60000
  }
}
```

2. Check API server status:
```bash
curl http://localhost:8080/health
```

3. Monitor API server resources:
```bash
# Check CPU and memory
htop

# Check GPU usage (if applicable)
nvidia-smi
```

4. Reduce frame quality/size:
```json
{
  "capture": {
    "quality": 0.6,
    "max_width": 1280,
    "max_height": 720
  }
}
```

#### High CPU/Memory Usage

**Problem**: Server consuming excessive resources

**Solutions**:
1. Adjust processing interval:
```json
{
  "capture": {
    "interval_ms": 1000  // Increase interval
  }
}
```

2. Enable frame skipping:
```json
{
  "processing": {
    "skip_frames": 2  // Process every 3rd frame
  }
}
```

3. Implement rate limiting:
```json
{
  "api": {
    "rate_limit": {
      "max_requests": 10,
      "window_ms": 1000
    }
  }
}
```

#### WebSocket Connection Drops

**Problem**: Dashboard loses real-time updates

**Solutions**:
1. Configure WebSocket heartbeat:
```javascript
// client.js
socket.io({
  pingInterval: 10000,
  pingTimeout: 5000,
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: 10
});
```

2. Check proxy/reverse proxy settings:
```nginx
# nginx.conf
location /socket.io/ {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

### Debug Mode

Enable debug logging:

```bash
# Set environment variable
export DEBUG=robot-monitor:*

# Or in .env file
DEBUG=robot-monitor:*

# Start with verbose logging
npm run dev:debug
```

### Log Analysis

Check logs for errors:

```bash
# Application logs
tail -f logs/app.log | grep ERROR

# System logs
journalctl -u robot-monitor -f

# Docker logs
docker logs -f robot-monitor

# Parse logs for patterns
grep "camera\|api\|error" logs/app.log | tail -100
```

### Performance Profiling

```bash
# CPU profiling
node --prof server.js
node --prof-process isolate-*.log > profile.txt

# Memory profiling
node --inspect server.js
# Open chrome://inspect in Chrome

# Network analysis
tcpdump -i any -w capture.pcap host 192.168.1.100
```

## Support Resources

### Getting Help

1. **Documentation**: Check the [docs/](docs/) directory
2. **GitHub Issues**: [Report bugs or request features](https://github.com/yourusername/overhead_monitor/issues)
3. **Discussions**: [Community forum](https://github.com/yourusername/overhead_monitor/discussions)
4. **Discord**: Join our [Discord server](https://discord.gg/robotmonitor)

### Useful Commands Reference

```bash
# Check system status
systemctl status robot-monitor

# View recent logs
journalctl -u robot-monitor --since "1 hour ago"

# Test camera stream
ffplay rtsp://username:password@camera_ip:554/stream1

# Monitor network traffic
iftop -i eth0

# Check port usage
netstat -tulpn | grep 3000

# Database backup
pg_dump robot_monitor > backup.sql

# Clear cache
redis-cli FLUSHALL
```

### Configuration Templates

Find example configurations in the `config-templates/` directory:
- `basic-setup.json` - Minimal configuration
- `multi-camera.json` - Multiple camera setup
- `high-performance.json` - Optimized for performance
- `secure-deployment.json` - Security-focused configuration