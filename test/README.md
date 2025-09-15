# Frame Capture System - Test Suite

This comprehensive test suite verifies that the refactored frame capture system meets all requirements for local frame capture, multi-client support, buffering, and AI integration.

## Test Components

### 1. Frame Capture Integration Tests (`test-frame-capture-integration.js`)
Tests the core `FrameCaptureService` and `FrameBufferManager` components:
- Basic frame capture and buffering
- Multi-camera support
- Multiple subscribers
- Memory management and buffer limits
- Buffer replay functionality
- Error handling and recovery
- Frame retrieval operations
- Performance under load

### 2. Streaming Server Tests (`test-streaming-servers.js`)
Tests all three refactored servers:
- **robot-monitor-server.js** - Basic authenticated streaming with buffering
- **rtsp-proxy.js** - Multi-client RTSP proxy with frame capture
- **robot-monitor-server-enhanced.js** - AI-enhanced server with multi-model support

Tests include:
- MJPEG streaming endpoints
- Snapshot endpoints with buffered frames
- Multi-client support
- Buffer statistics and frame history
- Status and health endpoints
- AI analysis capabilities (enhanced server)
- Concurrent client stress testing
- Memory management under load

### 3. Client Integration Tests (`test-client-integration.html`)
Browser-based tests for client-side functionality:
- MJPEG streaming mode
- WebSocket streaming mode
- Frame buffering visualization
- Replay functionality
- Adaptive streaming
- Reconnection handling

### 4. Test Runner (`test-refactored-system.js`)
Main test orchestrator that:
- Runs all automated tests
- Manages test server lifecycle
- Verifies system requirements
- Generates HTML and JSON reports

## Running the Tests

### Prerequisites
```bash
# Install dependencies
npm install

# Ensure FFmpeg is installed (or tests will use mock)
ffmpeg -version
```

### Quick Start - Run All Tests
```bash
# Run all tests with mock FFmpeg
node test/test-refactored-system.js

# Run with real FFmpeg
node test/test-refactored-system.js --no-mock-ffmpeg

# Keep servers running after tests for manual testing
node test/test-refactored-system.js --keep-running

# Show debug output
node test/test-refactored-system.js --debug
```

### Run Individual Test Suites

#### Frame Capture Integration Tests Only
```bash
node test/test-frame-capture-integration.js
```

#### Streaming Server Tests Only
```bash
node test/test-streaming-servers.js
```

#### Client Integration Tests (Manual)
1. Start the servers:
   ```bash
   node robot-monitor-server.js &
   node rtsp-proxy.js &
   node robot-monitor-server-enhanced.js &
   ```

2. Open `test/test-client-integration.html` in a web browser

3. Click "Run All Tests" or test individual features

## Test Configuration

### Environment Variables
- `MOCK_FFMPEG=true/false` - Use mock FFmpeg (default: true)
- `SKIP_SERVERS=true` - Skip server startup for integration tests
- `KEEP_SERVERS_RUNNING=true` - Don't stop servers after tests
- `DEBUG=true` - Show detailed debug output

### Command Line Options
- `--help` - Show help message
- `--skip-servers` - Skip server tests
- `--keep-running` - Keep servers running after tests
- `--no-mock-ffmpeg` - Use real FFmpeg
- `--debug` - Enable debug output

## Test Output

### Console Output
Tests provide real-time feedback with color-coded results:
- 🟢 Green: Passed tests
- 🔴 Red: Failed tests
- 🔵 Blue: Information
- 🟡 Yellow: Warnings

### Test Reports
After running the main test suite, you'll find:
- `test/test-report.html` - HTML report with visual summary
- `test/test-report.json` - JSON report for programmatic access

## System Requirements Verification

The test suite verifies these key requirements:

1. **Frame Capture**: Frames are captured locally before streaming
2. **Multi-Client**: Multiple clients can connect simultaneously  
3. **Frame Buffers**: Buffers work correctly with configurable limits
4. **Storage Integration**: Frames can be saved when storage is enabled
5. **AI Analysis**: Buffered frames can be used for AI analysis
6. **Backward Compatibility**: System maintains compatibility with existing clients
7. **Performance**: Improved performance over direct streaming

## Troubleshooting

### Common Issues

1. **FFmpeg not found**
   - Install FFmpeg: `brew install ffmpeg` (macOS) or `apt-get install ffmpeg` (Linux)
   - Or use mock mode: `MOCK_FFMPEG=true node test/test-refactored-system.js`

2. **Port already in use**
   - Kill existing processes: `pkill -f "robot-monitor"`
   - Or change test ports in the test configuration

3. **WebSocket connection failed in client tests**
   - Ensure servers are running
   - Check CORS settings
   - Verify firewall settings

4. **Memory limit errors**
   - Increase Node.js memory: `node --max-old-space-size=4096 test/test-refactored-system.js`
   - Reduce buffer sizes in test configuration

### Debug Mode
Run with debug output to see detailed information:
```bash
DEBUG=true node test/test-refactored-system.js --debug
```

## Continuous Integration

The test suite is designed to work in CI environments:

```yaml
# Example GitHub Actions workflow
name: Test Frame Capture System
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - run: npm install
      - run: node test/test-refactored-system.js
      - uses: actions/upload-artifact@v2
        if: always()
        with:
          name: test-reports
          path: test/test-report.*
```

## Contributing

When adding new tests:
1. Follow the existing test structure
2. Use descriptive test names
3. Include both positive and negative test cases
4. Clean up resources in test teardown
5. Update this README with new test descriptions

## License

This test suite is part of the Frame Capture System and follows the same license.