# Debug Control Guide

## Overview
The LeKiwi Pen Nanny Cam system now includes a debug control switch that allows you to run the system in quiet mode (default) or debug mode with verbose logging.

## Usage

### Quiet Mode (Default)
Run the system without debug output - clean and minimal logging:
```bash
./start-all.sh
```

**What you'll see:**
- ✅ Only essential startup messages
- ✅ Success/error notifications
- ✅ Service status updates
- ❌ No frame streaming counters
- ❌ No verbose llama-server output
- ❌ No debug-level logs

### Debug Mode
Run the system with full debug output for troubleshooting:
```bash
./start-all.sh --debug
# or
./start-all.sh -d
```

**What you'll see:**
- ✅ All normal messages
- ✅ Frame streaming statistics
- ✅ Verbose llama-server output
- ✅ Detailed connection logs
- ✅ Debug-level information

### Help
Display usage information:
```bash
./start-all.sh --help
# or
./start-all.sh -h
```

## What Gets Controlled

### In Quiet Mode (Default):
1. **llama-server**: Runs without `--verbose` flag
2. **Node.js servers**: Skip DEBUG level logs including:
   - Frame streaming counters
   - WebSocket connection details
   - Snapshot request logs
   - Stream request logs
   - Chat message logs

### In Debug Mode:
1. **llama-server**: Runs with `--verbose` flag for detailed output
2. **Node.js servers**: Show all log levels including DEBUG

## Implementation Details

The debug control is implemented through:
- Environment variable `DEBUG` passed to Node.js processes
- Conditional `--verbose` flag for llama-server
- Log level filtering in server code

## Benefits

✨ **Clean Terminal Output**: No more flooding with frame streaming logs
🔍 **Easy Troubleshooting**: Enable debug when needed with a simple flag
🚀 **Better Performance**: Slightly improved performance in quiet mode
📊 **Focused Monitoring**: See only what matters during normal operation

## Example Output Comparison

### Quiet Mode:
```
🦜 Starting LeKiwi Pen Nanny Cam System...
========================================
[SUCCESS] ngrok is installed: ngrok version 3.4.0
🤖 Starting llama.cpp server...
llama-server started with PID: 12345
✅ llama.cpp server started successfully
📹 Starting camera monitoring services...
✅ Enhanced Robot Monitor started successfully on port 3000
✅ Public monitor server started successfully on port 4040
🎉 System Ready!
```

### Debug Mode:
```
🦜 Starting LeKiwi Pen Nanny Cam System...
🔍 Debug mode enabled
========================================
[DEBUG] Checking ngrok installation...
[SUCCESS] ngrok is installed: ngrok version 3.4.0
[DEBUG] Starting ngrok tunnels...
🤖 Starting llama.cpp server...
Using llama-server: /opt/homebrew/bin/llama-server
Using model: /Users/.../ggml-model-q4_k.gguf
Using mmproj: /Users/.../mmproj-model-f16.gguf
[DEBUG] Starting enhanced robot monitor on port 3000...
[DEBUG] Streamed 30 frames to client-::1-1758495433707
[DEBUG] Streamed 60 frames to client-::1-1758495433707
...
```

## Troubleshooting

If you're not seeing debug output when using `--debug`:
1. Make sure you're using the updated `start-all.sh` script
2. Check that the Node.js servers have been restarted
3. Verify the DEBUG environment variable is set: `echo $DEBUG`

## Notes

- The debug setting only affects the current session
- Default is quiet mode for production use
- Debug mode is recommended when:
  - Troubleshooting connection issues
  - Monitoring frame rates
  - Debugging AI model responses
  - Investigating performance problems