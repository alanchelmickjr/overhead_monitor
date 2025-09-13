/**
 * RTSP to WebSocket/HTTP proxy for browser viewing
 * This allows viewing RTSP streams in the browser
 */

const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const Stream = require('node-rtsp-stream');
const cors = require('cors');
const { spawn } = require('child_process');

// Enable CORS
app.use(cors());
app.use(express.static('.'));

// Camera configuration
const CAMERA_IP = '192.168.88.40';
const RTSP_PORT = 554;
const RTSP_PATH = '/stream1';
const RTSP_URL = `rtsp://${CAMERA_IP}:${RTSP_PORT}${RTSP_PATH}`;

// Alternative URLs to try
const RTSP_URLS = [
  `rtsp://${CAMERA_IP}:554/stream1`,
  `rtsp://${CAMERA_IP}:554/1`,
  `rtsp://${CAMERA_IP}:554/live`,
  `rtsp://${CAMERA_IP}:554/ch0_0.h264`,
  `rtsp://${CAMERA_IP}:554/`
];

let currentStream = null;
let mjpegStream = null;

// Serve the HTML viewer
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/camera-viewer.html');
});

// MJPEG stream endpoint
app.get('/stream.mjpeg', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=myboundary',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Pragma': 'no-cache'
  });

  // Use FFmpeg to convert RTSP to MJPEG
  const ffmpeg = spawn('ffmpeg', [
    '-rtsp_transport', 'tcp',
    '-i', RTSP_URL,
    '-f', 'mjpeg',
    '-q:v', '5',
    '-r', '10',
    '-'
  ]);

  ffmpeg.stdout.on('data', (data) => {
    res.write(`--myboundary\r\n`);
    res.write(`Content-Type: image/jpeg\r\n`);
    res.write(`Content-Length: ${data.length}\r\n`);
    res.write(`\r\n`);
    res.write(data);
  });

  ffmpeg.stderr.on('data', (data) => {
    console.log('FFmpeg stderr:', data.toString());
  });

  req.on('close', () => {
    ffmpeg.kill();
  });
});

// Snapshot endpoint
app.get('/snapshot.jpg', async (req, res) => {
  const ffmpeg = spawn('ffmpeg', [
    '-rtsp_transport', 'tcp',
    '-i', RTSP_URL,
    '-vframes', '1',
    '-f', 'image2',
    '-'
  ]);

  const chunks = [];
  
  ffmpeg.stdout.on('data', (chunk) => {
    chunks.push(chunk);
  });

  ffmpeg.stdout.on('end', () => {
    const buffer = Buffer.concat(chunks);
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Content-Length': buffer.length
    });
    res.end(buffer);
  });

  ffmpeg.stderr.on('data', (data) => {
    console.log('FFmpeg snapshot stderr:', data.toString());
  });
});

// WebSocket stream for RTSP
io.on('connection', (socket) => {
  console.log('Client connected');
  
  socket.on('start-stream', (url) => {
    const streamUrl = url || RTSP_URL;
    console.log('Starting stream from:', streamUrl);
    
    if (currentStream) {
      currentStream.stop();
    }
    
    try {
      currentStream = new Stream({
        name: 'camera',
        streamUrl: streamUrl,
        wsPort: 9999,
        ffmpegOptions: {
          '-rtsp_transport': 'tcp',
          '-r': '30'
        }
      });
      
      socket.emit('stream-started');
    } catch (error) {
      console.error('Stream error:', error);
      socket.emit('stream-error', error.message);
    }
  });
  
  socket.on('stop-stream', () => {
    if (currentStream) {
      currentStream.stop();
      currentStream = null;
    }
    socket.emit('stream-stopped');
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// Test RTSP URLs endpoint
app.get('/test-rtsp', async (req, res) => {
  const results = [];
  
  for (const url of RTSP_URLS) {
    const result = await testRTSPUrl(url);
    results.push({ url, ...result });
  }
  
  res.json(results);
});

function testRTSPUrl(url) {
  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', [
      '-rtsp_transport', 'tcp',
      '-i', url,
      '-t', '1',
      '-f', 'null',
      '-'
    ], { timeout: 5000 });
    
    let success = false;
    
    ffmpeg.on('exit', (code) => {
      resolve({ success: code === 0 });
    });
    
    ffmpeg.on('error', (error) => {
      resolve({ success: false, error: error.message });
    });
    
    setTimeout(() => {
      ffmpeg.kill();
      resolve({ success: false, error: 'Timeout' });
    }, 5000);
  });
}

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`RTSP Proxy Server running on http://localhost:${PORT}`);
  console.log(`Camera IP: ${CAMERA_IP}`);
  console.log(`RTSP URL: ${RTSP_URL}`);
  console.log('');
  console.log('Available endpoints:');
  console.log(`  - HTML Viewer: http://localhost:${PORT}/`);
  console.log(`  - MJPEG Stream: http://localhost:${PORT}/stream.mjpeg`);
  console.log(`  - Snapshot: http://localhost:${PORT}/snapshot.jpg`);
  console.log(`  - Test RTSP URLs: http://localhost:${PORT}/test-rtsp`);
  console.log('');
  console.log('Make sure FFmpeg is installed: brew install ffmpeg');
});