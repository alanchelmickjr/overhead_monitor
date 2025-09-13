# API Documentation

## Overview

The Robot Overhead Monitor system provides a comprehensive REST API and WebSocket interface for integration with external systems, custom clients, and third-party applications.

## Base URL

```
http://localhost:3000/api
```

For production deployments:
```
https://your-domain.com/api
```

## Authentication

### API Key Authentication

Include your API key in the request header:

```http
Authorization: Bearer YOUR_API_KEY
```

### JWT Token Authentication

For user-based authentication:

```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "operator",
  "password": "secure_password"
}
```

Response:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_in": 3600,
  "refresh_token": "refresh_token_here"
}
```

Use the token in subsequent requests:
```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

## REST API Endpoints

### System Status

#### Get System Health

```http
GET /api/health
```

Response:
```json
{
  "status": "healthy",
  "uptime": 3600,
  "version": "1.0.0",
  "components": {
    "camera": "connected",
    "api": "operational",
    "database": "connected",
    "alerts": "active"
  }
}
```

#### Get System Metrics

```http
GET /api/metrics
```

Response:
```json
{
  "cpu_usage": 45.2,
  "memory_usage": 62.8,
  "disk_usage": 35.4,
  "active_connections": 12,
  "events_processed": 1523,
  "alerts_triggered": 7
}
```

### Camera Management

#### List Cameras

```http
GET /api/cameras
```

Response:
```json
{
  "cameras": [
    {
      "id": "cam-001",
      "name": "Overhead Main",
      "status": "online",
      "protocol": "rtsp",
      "resolution": "1920x1080",
      "fps": 30,
      "last_frame": "2024-12-12T10:30:00Z"
    }
  ]
}
```

#### Get Camera Details

```http
GET /api/cameras/{camera_id}
```

Response:
```json
{
  "id": "cam-001",
  "name": "Overhead Main",
  "status": "online",
  "protocol": "rtsp",
  "url": "rtsp://192.168.1.100:554/stream1",
  "resolution": "1920x1080",
  "fps": 30,
  "bitrate": 4000,
  "codec": "H.264",
  "last_frame": "2024-12-12T10:30:00Z",
  "statistics": {
    "frames_captured": 156234,
    "frames_processed": 155890,
    "dropped_frames": 344,
    "average_latency": 45
  }
}
```

#### Update Camera Settings

```http
PUT /api/cameras/{camera_id}/settings
Content-Type: application/json

{
  "resolution": "1280x720",
  "fps": 15,
  "quality": 0.8
}
```

Response:
```json
{
  "success": true,
  "message": "Camera settings updated",
  "camera_id": "cam-001"
}
```

#### Capture Snapshot

```http
POST /api/cameras/{camera_id}/snapshot
```

Response:
```json
{
  "snapshot_url": "/api/snapshots/snap-123456.jpg",
  "timestamp": "2024-12-12T10:30:00Z",
  "camera_id": "cam-001"
}
```

### Event Management

#### Get Events

```http
GET /api/events?start_date=2024-12-01&end_date=2024-12-12&type=robot_tipped&limit=50&offset=0
```

Query Parameters:
- `start_date` (optional): ISO 8601 date string
- `end_date` (optional): ISO 8601 date string
- `type` (optional): Event type filter
- `robot_id` (optional): Filter by robot ID
- `zone_id` (optional): Filter by zone
- `priority` (optional): Filter by priority (critical, warning, info)
- `limit` (optional): Number of results (default: 50)
- `offset` (optional): Pagination offset (default: 0)

Response:
```json
{
  "total": 234,
  "limit": 50,
  "offset": 0,
  "events": [
    {
      "id": "evt-789",
      "timestamp": "2024-12-12T10:15:30Z",
      "type": "robot_tipped",
      "confidence": 0.92,
      "robot_id": "robot-003",
      "zone_id": "zone-1",
      "priority": "critical",
      "description": "Robot detected in tipped position",
      "screenshot": "/api/screenshots/scr-456.jpg",
      "metadata": {
        "orientation": "sideways",
        "last_known_position": {"x": 234, "y": 567},
        "duration_stuck": 0
      },
      "acknowledged": false,
      "acknowledged_by": null,
      "acknowledged_at": null
    }
  ]
}
```

#### Get Event Details

```http
GET /api/events/{event_id}
```

Response:
```json
{
  "id": "evt-789",
  "timestamp": "2024-12-12T10:15:30Z",
  "type": "robot_tipped",
  "confidence": 0.92,
  "robot_id": "robot-003",
  "zone_id": "zone-1",
  "priority": "critical",
  "description": "Robot detected in tipped position",
  "screenshot": "/api/screenshots/scr-456.jpg",
  "video_clip": "/api/clips/clip-123.mp4",
  "ai_analysis": {
    "prompt": "Is the robot tipped over?",
    "response": "Yes, the robot appears to be lying on its side",
    "processing_time": 234
  },
  "metadata": {
    "orientation": "sideways",
    "last_known_position": {"x": 234, "y": 567},
    "previous_state": "moving",
    "speed_before_event": 0.5
  },
  "actions_taken": [
    {
      "type": "alert_sent",
      "channel": "email",
      "recipient": "operator@example.com",
      "timestamp": "2024-12-12T10:15:32Z"
    }
  ]
}
```

#### Acknowledge Event

```http
POST /api/events/{event_id}/acknowledge
Content-Type: application/json

{
  "notes": "Robot manually reset by operator"
}
```

Response:
```json
{
  "success": true,
  "event_id": "evt-789",
  "acknowledged_at": "2024-12-12T10:20:00Z",
  "acknowledged_by": "operator-1"
}
```

### Zone Management

#### Get Zones

```http
GET /api/zones
```

Response:
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
      "active": true,
      "alerts_enabled": true
    }
  ]
}
```

#### Create Zone

```http
POST /api/zones
Content-Type: application/json

{
  "name": "Danger Zone",
  "type": "polygon",
  "coordinates": [
    {"x": 400, "y": 100},
    {"x": 500, "y": 150},
    {"x": 450, "y": 250},
    {"x": 350, "y": 200}
  ],
  "color": "#ff0000",
  "alerts": ["zone_entry", "zone_violation"]
}
```

Response:
```json
{
  "id": "zone-2",
  "name": "Danger Zone",
  "created_at": "2024-12-12T10:30:00Z",
  "active": true
}
```

#### Update Zone

```http
PUT /api/zones/{zone_id}
Content-Type: application/json

{
  "name": "Updated Zone Name",
  "active": false
}
```

#### Delete Zone

```http
DELETE /api/zones/{zone_id}
```

### Robot Tracking

#### Get Robots

```http
GET /api/robots
```

Response:
```json
{
  "robots": [
    {
      "id": "robot-001",
      "name": "Picker Bot 1",
      "status": "active",
      "position": {"x": 234, "y": 456},
      "orientation": 45,
      "speed": 0.5,
      "last_seen": "2024-12-12T10:30:00Z",
      "current_task": "item_pickup",
      "battery_level": 78
    }
  ]
}
```

#### Get Robot Details

```http
GET /api/robots/{robot_id}
```

Response:
```json
{
  "id": "robot-001",
  "name": "Picker Bot 1",
  "status": "active",
  "position": {"x": 234, "y": 456},
  "orientation": 45,
  "speed": 0.5,
  "last_seen": "2024-12-12T10:30:00Z",
  "current_task": "item_pickup",
  "battery_level": 78,
  "statistics": {
    "uptime": 3600,
    "distance_traveled": 1234.5,
    "tasks_completed": 45,
    "average_speed": 0.45,
    "efficiency_score": 0.89
  },
  "history": [
    {
      "timestamp": "2024-12-12T10:29:00Z",
      "position": {"x": 230, "y": 450},
      "status": "active"
    }
  ]
}
```

#### Get Robot Performance Metrics

```http
GET /api/robots/{robot_id}/metrics?period=hour
```

Query Parameters:
- `period`: hour, day, week, month

Response:
```json
{
  "robot_id": "robot-001",
  "period": "hour",
  "metrics": {
    "tasks_completed": 12,
    "average_task_time": 234,
    "distance_traveled": 456.7,
    "average_speed": 0.48,
    "idle_time": 300,
    "efficiency_score": 0.87,
    "error_count": 1
  },
  "timeline": [
    {
      "timestamp": "2024-12-12T10:00:00Z",
      "tasks": 3,
      "speed": 0.45
    }
  ]
}
```

### Alert Configuration

#### Get Alert Rules

```http
GET /api/alerts/rules
```

Response:
```json
{
  "rules": [
    {
      "id": "rule-001",
      "name": "Robot Tipped Alert",
      "event_type": "robot_tipped",
      "conditions": {
        "confidence_threshold": 0.8
      },
      "actions": [
        {
          "type": "email",
          "recipients": ["operator@example.com"],
          "template": "robot_tipped_email"
        },
        {
          "type": "dashboard",
          "priority": "critical"
        }
      ],
      "cooldown": 60,
      "enabled": true
    }
  ]
}
```

#### Create Alert Rule

```http
POST /api/alerts/rules
Content-Type: application/json

{
  "name": "Collision Warning",
  "event_type": "collision_detected",
  "conditions": {
    "confidence_threshold": 0.7,
    "zones": ["zone-1", "zone-2"]
  },
  "actions": [
    {
      "type": "webhook",
      "url": "https://your-webhook.com/alerts",
      "method": "POST"
    }
  ],
  "cooldown": 30,
  "enabled": true
}
```

#### Update Alert Rule

```http
PUT /api/alerts/rules/{rule_id}
Content-Type: application/json

{
  "enabled": false
}
```

### Analytics

#### Get Summary Statistics

```http
GET /api/analytics/summary?start_date=2024-12-01&end_date=2024-12-12
```

Response:
```json
{
  "period": {
    "start": "2024-12-01T00:00:00Z",
    "end": "2024-12-12T23:59:59Z"
  },
  "statistics": {
    "total_events": 1234,
    "critical_events": 23,
    "robots_monitored": 8,
    "uptime_percentage": 99.5,
    "average_response_time": 234,
    "tasks_completed": 456,
    "efficiency_score": 0.89
  },
  "event_breakdown": {
    "robot_tipped": 5,
    "robot_stuck": 12,
    "collision_detected": 3,
    "task_completed": 456,
    "zone_violation": 8
  }
}
```

#### Get Trend Analysis

```http
GET /api/analytics/trends?metric=efficiency&period=week
```

Response:
```json
{
  "metric": "efficiency",
  "period": "week",
  "data": [
    {
      "date": "2024-12-06",
      "value": 0.85
    },
    {
      "date": "2024-12-07",
      "value": 0.87
    },
    {
      "date": "2024-12-08",
      "value": 0.89
    }
  ],
  "trend": "increasing",
  "change_percentage": 4.7
}
```

## WebSocket API

### Connection

Connect to the WebSocket server:

```javascript
const socket = io('http://localhost:3000', {
  auth: {
    token: 'your_auth_token'
  }
});
```

### Events

#### Client to Server Events

##### Subscribe to Live Feed

```javascript
socket.emit('subscribe', {
  feed: 'live',
  camera_id: 'cam-001'
});
```

##### Request Frame Analysis

```javascript
socket.emit('analyze_frame', {
  camera_id: 'cam-001',
  prompt: 'Check if any robots are tipped over'
});
```

##### Update Configuration

```javascript
socket.emit('update_config', {
  type: 'capture_interval',
  value: 1000
});
```

##### Control Commands

```javascript
// Start monitoring
socket.emit('start_monitoring', {
  camera_id: 'cam-001',
  interval: 500
});

// Stop monitoring
socket.emit('stop_monitoring', {
  camera_id: 'cam-001'
});

// Emergency stop all robots (if integrated)
socket.emit('emergency_stop', {
  confirmation: 'CONFIRM_STOP'
});
```

#### Server to Client Events

##### Live Frame

```javascript
socket.on('frame', (data) => {
  console.log('New frame:', {
    camera_id: data.camera_id,
    timestamp: data.timestamp,
    image: data.image, // base64 encoded
    format: data.format // 'jpeg' or 'png'
  });
});
```

##### Event Detection

```javascript
socket.on('event_detected', (event) => {
  console.log('Event:', {
    id: event.id,
    type: event.type,
    confidence: event.confidence,
    robot_id: event.robot_id,
    priority: event.priority,
    description: event.description
  });
});
```

##### Alert Notification

```javascript
socket.on('alert', (alert) => {
  console.log('Alert:', {
    id: alert.id,
    event_id: alert.event_id,
    priority: alert.priority,
    message: alert.message,
    actions_required: alert.actions
  });
});
```

##### Robot Status Update

```javascript
socket.on('robot_status', (status) => {
  console.log('Robot status:', {
    robot_id: status.robot_id,
    position: status.position,
    orientation: status.orientation,
    speed: status.speed,
    task: status.current_task
  });
});
```

##### System Status

```javascript
socket.on('system_status', (status) => {
  console.log('System:', {
    camera: status.camera,
    api: status.api,
    processing_queue: status.queue_size,
    active_alerts: status.alerts
  });
});
```

##### Error Events

```javascript
socket.on('error', (error) => {
  console.error('WebSocket error:', {
    code: error.code,
    message: error.message,
    details: error.details
  });
});

socket.on('connect_error', (error) => {
  console.error('Connection error:', error.message);
});
```

## SmolVLM API Integration

### Chat Completions Endpoint

The system integrates with SmolVLM's chat completions API:

```http
POST /v1/chat/completions
Content-Type: application/json

{
  "model": "smolvlm-instruct",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "Describe what you see in this robot pen. Are any robots tipped over?"
        },
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
          }
        }
      ]
    }
  ],
  "max_tokens": 150,
  "temperature": 0.7
}
```

Response:
```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1702825464,
  "model": "smolvlm-instruct",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "I can see a robot pen with 3 robots. One robot in the center appears to be tipped over on its side. The other two robots are upright and appear to be functioning normally."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 45,
    "completion_tokens": 38,
    "total_tokens": 83
  }
}
```

## Client Libraries

### JavaScript/TypeScript

```javascript
import { RobotMonitorClient } from '@robot-monitor/client';

const client = new RobotMonitorClient({
  baseUrl: 'http://localhost:3000',
  apiKey: 'your_api_key'
});

// Get events
const events = await client.events.list({
  startDate: '2024-12-01',
  type: 'robot_tipped'
});

// Subscribe to live updates
client.on('event', (event) => {
  console.log('New event:', event);
});

client.connect();
```

### Python

```python
from robot_monitor import Client

client = Client(
    base_url='http://localhost:3000',
    api_key='your_api_key'
)

# Get events
events = client.events.list(
    start_date='2024-12-01',
    event_type='robot_tipped'
)

# Subscribe to live updates
@client.on('event')
def handle_event(event):
    print(f"New event: {event}")

client.connect()
```

### cURL Examples

```bash
# Get system health
curl -H "Authorization: Bearer YOUR_API_KEY" \
  http://localhost:3000/api/health

# Get recent events
curl -H "Authorization: Bearer YOUR_API_KEY" \
  "http://localhost:3000/api/events?limit=10"

# Capture snapshot
curl -X POST -H "Authorization: Bearer YOUR_API_KEY" \
  http://localhost:3000/api/cameras/cam-001/snapshot

# Acknowledge event
curl -X POST -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"notes": "Resolved"}' \
  http://localhost:3000/api/events/evt-789/acknowledge
```

## Rate Limiting

API requests are rate-limited to prevent abuse:

- **Default limits**:
  - 1000 requests per hour per API key
  - 100 requests per minute per API key
  - 10 concurrent connections per client

Response headers include rate limit information:
```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 950
X-RateLimit-Reset: 1702825464
```

When rate limited, the API returns:
```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60

{
  "error": "Rate limit exceeded",
  "retry_after": 60
}
```

## Error Responses

Standard error response format:

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Invalid camera ID provided",
    "details": {
      "camera_id": "invalid-cam",
      "valid_cameras": ["cam-001", "cam-002"]
    }
  },
  "request_id": "req-123456"
}
```

Common error codes:
- `INVALID_REQUEST` - Malformed request
- `UNAUTHORIZED` - Missing or invalid authentication
- `FORBIDDEN` - Insufficient permissions
- `NOT_FOUND` - Resource not found
- `RATE_LIMITED` - Rate limit exceeded
- `INTERNAL_ERROR` - Server error
- `SERVICE_UNAVAILABLE` - Service temporarily unavailable

## Webhooks

Configure webhooks to receive real-time notifications:

### Webhook Configuration

```http
POST /api/webhooks
Content-Type: application/json

{
  "url": "https://your-server.com/webhook",
  "events": ["robot_tipped", "collision_detected"],
  "secret": "webhook_secret_key"
}
```

### Webhook Payload

```json
{
  "id": "webhook-evt-123",
  "timestamp": "2024-12-12T10:30:00Z",
  "event": {
    "type": "robot_tipped",
    "id": "evt-789",
    "robot_id": "robot-003",
    "confidence": 0.92,
    "priority": "critical"
  },
  "signature": "sha256=abcdef123456..."
}
```

### Webhook Signature Verification

```javascript
const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, secret) {
  const hash = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
  
  return `sha256=${hash}` === signature;
}
```

## API Versioning

The API uses URL versioning:

- Current version: `/api/v1/`
- Legacy support: `/api/v0/` (deprecated)

Version information in response headers:
```http
X-API-Version: 1.0.0
X-API-Deprecated: false
```

## SDK Examples

### Complete Monitoring Setup

```javascript
// Initialize client
const client = new RobotMonitorClient({
  baseUrl: 'http://localhost:3000',
  apiKey: process.env.API_KEY
});

// Configure zones
await client.zones.create({
  name: 'Work Area',
  type: 'rectangle',
  coordinates: { x: 0, y: 0, width: 1000, height: 800 }
});

// Set up alert rules
await client.alerts.createRule({
  name: 'Tipped Robot Alert',
  event_type: 'robot_tipped',
  actions: [{
    type: 'email',
    recipients: ['operator@example.com']
  }]
});

// Start monitoring
client.on('connect', () => {
  console.log('Connected to monitoring system');
  client.startMonitoring('cam-001', { interval: 500 });
});

// Handle events
client.on('event_detected', async (event) => {
  console.log(`Event detected: ${event.type}`);
  
  if (event.priority === 'critical') {
    // Take immediate action
    await client.alerts.trigger(event.id);
  }
  
  // Log to external system
  await logToExternalSystem(event);
});

// Connect
client.connect();
```

## API Testing

Test the API using the provided Postman collection:

1. Import `robot-monitor-api.postman_collection.json`
2. Set environment variables:
   - `base_url`: Your API URL
   - `api_key`: Your API key
3. Run collection tests

Or use the automated test suite:

```bash
npm run test:api