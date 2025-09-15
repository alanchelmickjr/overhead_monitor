const WebSocket = require('ws');

console.log('Testing WebSocket chat on port 4040...\n');

const ws = new WebSocket('ws://localhost:4040');

ws.on('open', () => {
    console.log('✅ Connected to WebSocket');
    
    // Send a test message
    const testMessage = {
        type: 'chat',
        message: 'Test message from script'
    };
    
    console.log('📤 Sending:', JSON.stringify(testMessage));
    ws.send(JSON.stringify(testMessage));
});

ws.on('message', (data) => {
    console.log('📥 Received:', data.toString());
    try {
        const parsed = JSON.parse(data.toString());
        console.log('   Parsed:', parsed);
    } catch (e) {
        console.log('   (Not JSON)');
    }
});

ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error.message);
});

ws.on('close', () => {
    console.log('🔌 WebSocket closed');
});

// Keep the script running
setTimeout(() => {
    console.log('\n✅ Test complete, closing connection...');
    ws.close();
    process.exit(0);
}, 5000);