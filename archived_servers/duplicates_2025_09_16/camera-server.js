#!/usr/bin/env node

const express = require('express');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const PORT = 3000;

// Serve static files
app.use(express.static('.'));

// Main route - serve the camera viewer
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'test-camera-stream-llava.html'));
});

// Health check for proxy
app.get('/proxy-status', async (req, res) => {
    try {
        const response = await fetch('http://localhost:3000/status');
        const data = await response.json();
        res.json({ proxyRunning: true, ...data });
    } catch (error) {
        res.json({ proxyRunning: false, error: error.message });
    }
});

// Start server
app.listen(PORT, () => {
    console.log('\n🚀 Robot Overhead Monitor');
    console.log('═══════════════════════════════════════════');
    console.log(`📹 Camera Interface: http://localhost:${PORT}`);
    console.log(`🔄 RTSP Proxy: http://localhost:3000`);
    console.log('═══════════════════════════════════════════');
    console.log('\nCamera Credentials:');
    console.log('  Username: LeKiwi');
    console.log('  Password: LeKiwi995');
    console.log('  RTSP URL: rtsp://192.168.88.40:554/stream1');
    console.log('\n✅ Open http://localhost:3000 in your browser\n');
});

// Check if proxy is running
setTimeout(async () => {
    try {
        const response = await fetch('http://localhost:3000/status');
        if (response.ok) {
            console.log('✅ RTSP Proxy is running on port 3000');
        }
    } catch (error) {
        console.log('⚠️  RTSP Proxy not detected. Run: node rtsp-proxy-debug.js');
    }
}, 1000);