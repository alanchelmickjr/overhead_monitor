# Port Configuration Summary

## Clean Architecture (NO DUPLICATES)

### Services and Ports:

1. **Enhanced Robot Monitor Server**: Port 3000 (INTERNAL CONTROL - PRIVATE)
   - File: `robot-monitor-server-enhanced.js`
   - Main control interface at http://localhost:3000
   - MJPEG stream at http://localhost:3000/stream.mjpeg
   - Includes ALL features:
     - RTSP proxy functionality
     - Frame capture and buffering
     - Multi-model AI vision support
     - Model benchmarking
     - WebSocket for internal monitoring
   - **DO NOT SHARE THIS PORT - INTERNAL TEAM ONLY**

2. **Public Monitor Server**: Port 4040 (PUBLIC VIEWER - READ-ONLY)
   - File: `robot-monitor-public-server.js`
   - Public interface at http://localhost:4040
   - Proxies video stream from port 3000
   - Standalone chat system (does not interact with control server)
   - Read-only access for teleoperators
   - Safe to share via ngrok

3. **LLaMA Server**: Port 8080
   - Vision AI API endpoint
   - http://localhost:8080/v1/chat/completions

4. **ngrok Web Interface**: Port 4041 (when running)
   - Configuration and tunnel management

### Key Configuration:

#### robot-monitor-server-enhanced.js (Port 3000)
```javascript
const PORT = process.env.PORT || 3000;  // Can be overridden but defaults to 3000
```

#### robot-monitor-public-server.js (Port 4040)
```javascript
const PORT = 4040;                       // Public server port
const MAIN_SERVER = 'http://localhost:3000';  // Proxies from internal server
const STREAM_SERVER = 'http://localhost:3000'; // Stream source
```

### Archived/Removed Duplicates:
The following redundant servers have been archived to `archived_servers/duplicates_2025_09_16/`:
- `camera-server.js` (duplicate functionality)
- `robot-monitor-server.js` (old version)
- `rtsp-proxy.js` (functionality included in enhanced server)
- `rtsp-proxy-gun.js` (redundant)
- `server.js` (redundant)

### Important Architecture Notes:
1. **ONE control server** on port 3000 (enhanced server with ALL features)
2. **ONE public viewer** on port 4040 (read-only proxy)
3. **NO duplicate servers** running on the same port
4. Chat on 4040 is standalone - it doesn't control anything
5. Port 3000 is for internal team control only

### To Start Everything:
```bash
./start-all.sh
```

This will:
1. Start LLaMA server on port 8080
2. Start Enhanced Robot Monitor on port 3000 (internal)
3. Start Public Monitor on port 4040 (public)
4. Configure ngrok tunnels (if setup)

### ngrok Configuration:
- camera-viewer → localhost:3000 (rename to "internal-control" for clarity)
- robot-monitor → localhost:4040 (public viewer - safe to share)
- llava-api → localhost:8080

### Troubleshooting:
If you see "EADDRINUSE" errors:
1. Check no duplicate servers are running: `lsof -i :3000` and `lsof -i :4040`
2. Kill any zombies: `pkill -f "node.*robot-monitor"`
3. Run `./start-all.sh` again

### Security Notes:
- **NEVER share port 3000 access** - this is the control interface
- **Port 4040 is safe to share** - it's read-only with chat
- The public chat on 4040 doesn't control anything, just for communication