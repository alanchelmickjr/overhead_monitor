# System Architecture

## Overview

The Robot Overhead Monitor system follows a modular, event-driven architecture that separates concerns between video capture, AI processing, event detection, and user interface. The system is designed for real-time monitoring with configurable processing intervals and extensible detection capabilities.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Web Dashboard                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────────┐   │
│  │  Video   │ │  Status  │ │  Event   │ │  Configuration  │   │
│  │  Display │ │  Panel   │ │  History │ │     Editor      │   │
│  └─────┬────┘ └─────┬────┘ └─────┬────┘ └────────┬────────┘   │
└────────┼────────────┼────────────┼───────────────┼─────────────┘
         │            │            │               │
    WebSocket    WebSocket    REST API        REST API
         │            │            │               │
┌────────┴────────────┴────────────┴───────────────┴─────────────┐
│                     Application Server                           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                   Event Bus (Pub/Sub)                     │  │
│  └──────┬────────┬────────┬────────┬────────┬──────────────┘  │
│         │        │        │        │        │                  │
│  ┌──────▼───┐ ┌──▼────┐ ┌▼──────┐ ┌▼─────┐ ┌▼──────────┐     │
│  │  Camera  │ │Vision │ │Event  │ │Alert │ │  Storage  │     │
│  │ Manager  │ │Engine │ │Detect │ │Mgr   │ │  Service  │     │
│  └──────┬───┘ └──┬────┘ └┬──────┘ └┬─────┘ └┬──────────┘     │
└─────────┼────────┼───────┼─────────┼────────┼──────────────────┘
          │        │       │         │        │
     ┌────▼────┐ ┌─▼──┐ ┌─▼──┐ ┌───▼───┐ ┌─▼────────┐
     │   IP    │ │API │ │Rule│ │External│ │Database/ │
     │ Camera  │ │LLM │ │Eng │ │Services│ │  Files   │
     └─────────┘ └────┘ └────┘ └────────┘ └──────────┘
```

## Core Components

### 1. Camera Manager

**Purpose**: Handles all camera-related operations including connection, stream processing, and frame extraction.

**Key Features**:
- Multi-protocol support (RTSP, HTTP MJPEG, WebRTC)
- Automatic reconnection on stream failure
- Frame rate control and quality optimization
- Buffer management for smooth streaming

**Implementation Details**:
```javascript
class CameraManager {
  - connect(config: CameraConfig): Promise<Stream>
  - captureFrame(): Promise<Frame>
  - handleStreamError(error: Error): void
  - reconnect(): Promise<void>
}
```

**Configuration**:
```json
{
  "protocol": "rtsp|http|webrtc",
  "url": "stream_url",
  "credentials": { "username": "", "password": "" },
  "frameRate": 30,
  "resolution": { "width": 1920, "height": 1080 },
  "quality": 0.8
}
```

### 2. Vision Engine

**Purpose**: Interfaces with the SmolVLM API to process captured frames and generate descriptions.

**Key Features**:
- Prompt template management
- Request queuing and rate limiting
- Response parsing and validation
- Retry logic with exponential backoff

**Implementation Details**:
```javascript
class VisionEngine {
  - processFrame(frame: Frame, prompt: string): Promise<Analysis>
  - batchProcess(frames: Frame[], prompts: string[]): Promise<Analysis[]>
  - validateResponse(response: APIResponse): boolean
  - handleAPIError(error: APIError): void
}
```

**Prompt Templates**:
```javascript
const PROMPTS = {
  ROBOT_STATUS: "Describe the robot's current position and orientation",
  TASK_COMPLETION: "Has the robot completed picking up the object?",
  COLLISION_CHECK: "Are any robots touching or about to collide?",
  ZONE_CHECK: "Is the robot within the marked blue zone?"
}
```

### 3. Event Detection System

**Purpose**: Analyzes vision engine outputs to detect specific robot conditions and events.

**Key Features**:
- Rule-based event detection
- Confidence scoring
- State machine for complex events
- Historical context awareness

**Event Types**:
```javascript
enum EventType {
  ROBOT_TIPPED = "robot_tipped",
  ROBOT_STUCK = "robot_stuck",
  COLLISION_DETECTED = "collision_detected",
  TASK_COMPLETED = "task_completed",
  ZONE_VIOLATION = "zone_violation",
  PERFORMANCE_ANOMALY = "performance_anomaly"
}
```

**Detection Pipeline**:
```javascript
class EventDetector {
  - analyze(analysis: Analysis): Event[]
  - checkRules(data: AnalysisData): RuleMatch[]
  - calculateConfidence(matches: RuleMatch[]): number
  - updateState(event: Event): void
  - getHistoricalContext(timeWindow: number): Event[]
}
```

### 4. Alert Manager

**Purpose**: Manages notifications and response actions for detected events.

**Key Features**:
- Multi-channel alerting (email, SMS, webhook, dashboard)
- Alert prioritization and throttling
- Action execution (emergency stop, logging, screenshots)
- Alert history and acknowledgment tracking

**Alert Configuration**:
```json
{
  "alerts": [
    {
      "event": "robot_tipped",
      "priority": "critical",
      "channels": ["dashboard", "email", "sms"],
      "actions": ["capture_screenshot", "log_event", "sound_alarm"],
      "throttle": { "count": 1, "window": 60 }
    }
  ]
}
```

### 5. Storage Service

**Purpose**: Handles data persistence for events, metrics, and configuration.

**Key Features**:
- Event log storage with timestamps
- Screenshot archival
- Metrics aggregation
- Configuration versioning

**Data Models**:
```javascript
interface Event {
  id: string;
  timestamp: Date;
  type: EventType;
  confidence: number;
  robotId?: string;
  zone?: string;
  screenshot?: string;
  metadata: Record<string, any>;
}

interface Metric {
  timestamp: Date;
  robotId: string;
  type: "speed" | "position" | "task_time";
  value: number;
  unit: string;
}
```

### 6. Web Dashboard

**Purpose**: Provides real-time visualization and control interface.

**Key Features**:
- Live video feed with overlay zones
- Real-time event notifications
- Historical event viewer
- Configuration management UI
- Performance metrics dashboard

**WebSocket Events**:
```javascript
// Server -> Client
socket.emit('frame', { image: base64, timestamp });
socket.emit('event', { type, confidence, details });
socket.emit('metrics', { robotId, metrics });

// Client -> Server
socket.emit('updateConfig', { config });
socket.emit('acknowledgeAlert', { alertId });
socket.emit('requestSnapshot', { });
```

## Data Flow

### Real-time Monitoring Flow

1. **Frame Capture**: Camera Manager captures frame at configured interval
2. **Vision Processing**: Frame sent to Vision Engine with appropriate prompt
3. **Event Detection**: Analysis results evaluated by Event Detector
4. **Alert Generation**: Significant events trigger Alert Manager
5. **UI Update**: Dashboard receives updates via WebSocket
6. **Storage**: Events and metrics persisted to database

### Configuration Update Flow

1. **UI Change**: User modifies configuration in dashboard
2. **Validation**: Server validates new configuration
3. **Component Update**: Relevant components receive new config
4. **Persistence**: Configuration saved to storage
5. **Confirmation**: UI receives update confirmation

## Scalability Considerations

### Horizontal Scaling

- **Multiple Cameras**: Each camera runs in separate process/thread
- **Load Balancing**: Distribute API requests across multiple SmolVLM instances
- **Event Processing**: Use message queue for async event processing
- **Storage**: Implement database sharding for large-scale deployments

### Performance Optimization

- **Frame Buffering**: Maintain small buffer to handle processing delays
- **Caching**: Cache recent API responses for similar frames
- **Batch Processing**: Group multiple frame analyses when possible
- **Resource Pooling**: Reuse connections and resources

## Security Architecture

### Authentication & Authorization

```javascript
// JWT-based authentication
interface AuthToken {
  userId: string;
  role: "admin" | "operator" | "viewer";
  permissions: string[];
  exp: number;
}
```

### Secure Communication

- **HTTPS/WSS**: All web traffic encrypted
- **Camera Credentials**: Stored encrypted in configuration
- **API Keys**: Secure storage and rotation support
- **Audit Logging**: All configuration changes logged

## Extension Points

### Plugin Architecture

The system supports plugins for:
- Custom event detection rules
- Additional camera protocols
- New alert channels
- External system integrations

```javascript
interface Plugin {
  name: string;
  version: string;
  type: "detector" | "camera" | "alert" | "integration";
  initialize(context: PluginContext): void;
  execute(data: any): Promise<any>;
}
```

### API Extensions

REST API endpoints for third-party integrations:
- `GET /api/events` - Retrieve event history
- `POST /api/zones` - Define monitoring zones
- `GET /api/metrics` - Access performance metrics
- `POST /api/alerts/acknowledge` - Acknowledge alerts

## Deployment Architecture

### Docker Deployment

```yaml
version: '3.8'
services:
  app:
    image: robot-monitor:latest
    ports:
      - "3000:3000"
    environment:
      - API_URL=http://smolvlm:8080
    volumes:
      - ./config:/app/config
      - ./data:/app/data
  
  smolvlm:
    image: smolvlm:latest
    ports:
      - "8080:8080"
    deploy:
      resources:
        reservations:
          devices:
            - capabilities: [gpu]
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: robot-monitor
spec:
  replicas: 3
  selector:
    matchLabels:
      app: robot-monitor
  template:
    metadata:
      labels:
        app: robot-monitor
    spec:
      containers:
      - name: app
        image: robot-monitor:latest
        ports:
        - containerPort: 3000
        env:
        - name: API_URL
          valueFrom:
            configMapKeyRef:
              name: app-config
              key: api.url
```

## Monitoring & Observability

### Metrics Collection

- **Application Metrics**: Response times, error rates, throughput
- **System Metrics**: CPU, memory, network usage
- **Business Metrics**: Events detected, alerts triggered, robot uptime

### Logging Strategy

```javascript
// Structured logging
logger.info({
  event: 'frame_processed',
  cameraId: 'cam-01',
  processingTime: 234,
  timestamp: new Date()
});
```

### Health Checks

```javascript
// Health check endpoints
GET /health/live    // Basic liveness check
GET /health/ready   // Readiness with dependency checks
GET /health/startup // Startup probe for initialization
```

## Technology Stack

### Frontend
- **Framework**: React/Vue.js/vanilla JavaScript
- **WebSocket**: Socket.io for real-time updates
- **Visualization**: Canvas API for overlay rendering
- **State Management**: Redux/Vuex for complex state

### Backend
- **Runtime**: Node.js or Python
- **Framework**: Express.js/FastAPI
- **WebSocket**: Socket.io/WebSockets
- **Queue**: Redis/RabbitMQ for event processing

### Storage
- **Database**: PostgreSQL for events/metrics
- **Cache**: Redis for session/temporary data
- **File Storage**: S3/local filesystem for screenshots

### Infrastructure
- **Container**: Docker for packaging
- **Orchestration**: Kubernetes for production
- **Monitoring**: Prometheus + Grafana
- **Logging**: ELK stack or similar

## Performance Requirements

### Latency Targets
- Frame capture to display: < 100ms
- Event detection: < 500ms
- Alert delivery: < 1 second
- API response time: < 200ms

### Throughput Targets
- Concurrent cameras: 10+
- Events per second: 100+
- Active users: 50+
- Storage: 30 days retention

## Failure Handling

### Graceful Degradation
- Continue monitoring if storage fails
- Queue events if alerts fail
- Fallback to local processing if API unavailable
- Maintain last known state on connection loss

### Recovery Procedures
- Automatic reconnection for all external services
- Event replay from queue after recovery
- Configuration rollback on invalid updates
- Data integrity checks on startup