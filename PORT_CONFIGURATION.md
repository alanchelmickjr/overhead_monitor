# Port Configuration Summary

## Current Working Configuration

### Services and Ports:
1. **Enhanced Robot Monitor Server**: Port 3001
   - Serves main interface at http://localhost:3001
   - Provides MJPEG stream at http://localhost:3001/stream.mjpeg
   - Handles WebSocket for main interface
   - Includes RTSP proxy functionality

2. **Public Monitor Server**: Port 4040
   - Serves public interface at http://localhost:4040
   - Proxies video stream from port 3001
   - Handles its own WebSocket for chat on port 4040
   - Read-only access with chat functionality

3. **LLaMA Server**: Port 8080
   - Vision AI API endpoint

4. **ngrok Web Interface**: Port 4041
   - Configuration and tunnel management

### Key Configuration Files:

#### robot-monitor-server-enhanced.js
```javascript
const PORT = process.env.PORT || 3001;  // Can be overridden by PORT env var
```

#### robot-monitor-public-server.js
```javascript
const PORT = 4040;                       // Public server port
const MAIN_SERVER = 'http://localhost:3001';  // Main server for snapshots
const STREAM_SERVER = 'http://localhost:3001'; // Stream proxy source
```

#### start-robot-monitor.sh
```bash
PORT=3000 node robot-monitor-server-enhanced.js  # Override to port 3000
```

### WebSocket Connections:
- **robot-monitor.html**: Connects to `ws://${window.location.host}` (same as serving port)
- **Public server**: Tries to connect to main server WebSocket on port 3001 for event forwarding

### Important Notes:
1. The enhanced server can run on either port 3000 or 3001 depending on whether PORT env var is set
2. The public server must know the correct port of the main server for proxying
3. Both chat systems work independently - they don't share messages between main and public interfaces
4. The video stream is proxied from the main server to the public server

### To Start Everything:
1. Start ngrok first: `ngrok start --all --config ngrok.yml`
2. Then run: `./start-all.sh`

### Current ngrok Configuration:
- camera-viewer → localhost:3000
- robot-monitor → localhost:4040
- llava-api → localhost:8080