/**
 * Robot Overhead Monitor - Dashboard Application
 */

// WebSocket connection
let socket = null;
let isConnected = false;

// Current state
let currentCameraId = null;
let currentInterval = 500;
let isMonitoring = false;
let selectedAlertId = null;

// DOM elements
const elements = {
    // Connection status
    connectionStatus: document.getElementById('connectionStatus'),
    connectionText: document.getElementById('connectionText'),
    
    // Header buttons
    emergencyStop: document.getElementById('emergencyStop'),
    settingsBtn: document.getElementById('settingsBtn'),
    
    // Camera controls
    cameraList: document.getElementById('cameraList'),
    cameraTitle: document.getElementById('cameraTitle'),
    startMonitor: document.getElementById('startMonitor'),
    stopMonitor: document.getElementById('stopMonitor'),
    captureSnapshot: document.getElementById('captureSnapshot'),
    intervalSelect: document.getElementById('intervalSelect'),
    
    // Video display
    videoCanvas: document.getElementById('videoCanvas'),
    videoOverlay: document.getElementById('videoOverlay'),
    noFeed: document.getElementById('noFeed'),
    fps: document.getElementById('fps'),
    resolution: document.getElementById('resolution'),
    latency: document.getElementById('latency'),
    
    // Analysis
    analysisContent: document.getElementById('analysisContent'),
    customAnalysis: document.getElementById('customAnalysis'),
    
    // Status displays
    visionStatus: document.getElementById('visionStatus'),
    dbStatus: document.getElementById('dbStatus'),
    alertStatus: document.getElementById('alertStatus'),
    
    // Statistics
    eventCount: document.getElementById('eventCount'),
    alertCount: document.getElementById('alertCount'),
    robotCount: document.getElementById('robotCount'),
    
    // Lists
    alertList: document.getElementById('alertList'),
    eventList: document.getElementById('eventList'),
    robotList: document.getElementById('robotList'),
    alertBadge: document.getElementById('alertBadge'),
    clearEvents: document.getElementById('clearEvents'),
    
    // Footer
    systemTime: document.getElementById('systemTime'),
    
    // Modals
    settingsModal: document.getElementById('settingsModal'),
    analysisModal: document.getElementById('analysisModal'),
    alertModal: document.getElementById('alertModal'),
    
    // Settings
    tippedThreshold: document.getElementById('tippedThreshold'),
    tippedThresholdValue: document.getElementById('tippedThresholdValue'),
    collisionThreshold: document.getElementById('collisionThreshold'),
    collisionThresholdValue: document.getElementById('collisionThresholdValue'),
    emailAlerts: document.getElementById('emailAlerts'),
    smsAlerts: document.getElementById('smsAlerts'),
    soundAlerts: document.getElementById('soundAlerts'),
    showZones: document.getElementById('showZones'),
    showRobotIds: document.getElementById('showRobotIds'),
    darkMode: document.getElementById('darkMode'),
    saveSettings: document.getElementById('saveSettings'),
    
    // Custom analysis
    customPrompt: document.getElementById('customPrompt'),
    runAnalysis: document.getElementById('runAnalysis'),
    
    // Alert details
    alertDetails: document.getElementById('alertDetails'),
    acknowledgeAlert: document.getElementById('acknowledgeAlert'),
    
    // Audio
    alertSound: document.getElementById('alertSound')
};

// Canvas context
const ctx = elements.videoCanvas.getContext('2d');

// Frame rate calculation
let frameCount = 0;
let lastFpsUpdate = Date.now();
let currentFps = 0;

// Initialize application
function init() {
    setupWebSocket();
    setupEventListeners();
    startClock();
    loadSettings();
    
    // Hide video canvas initially
    elements.videoCanvas.style.display = 'none';
    elements.noFeed.style.display = 'flex';
}

// Setup WebSocket connection
function setupWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    socket = io(wsUrl, {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 10
    });
    
    // Connection events
    socket.on('connect', () => {
        console.log('Connected to server');
        isConnected = true;
        updateConnectionStatus(true);
        
        // Subscribe to feeds
        socket.emit('subscribe', { feed: 'events' });
        socket.emit('subscribe', { feed: 'alerts' });
        socket.emit('subscribe', { feed: 'metrics' });
    });
    
    socket.on('disconnect', () => {
        console.log('Disconnected from server');
        isConnected = false;
        updateConnectionStatus(false);
    });
    
    socket.on('error', (error) => {
        console.error('WebSocket error:', error);
        showNotification('Connection error: ' + error.message, 'error');
    });
    
    // Initial status
    socket.on('initial_status', handleInitialStatus);
    
    // Real-time updates
    socket.on('frame', handleFrame);
    socket.on('event_detected', handleEvent);
    socket.on('alert', handleAlert);
    socket.on('alert_notification', handleAlertNotification);
    socket.on('robot_status', handleRobotStatus);
    socket.on('system_status', handleSystemStatus);
    socket.on('camera_status', handleCameraStatus);
    
    // Response handlers
    socket.on('subscribed', (data) => {
        console.log('Subscribed to:', data);
    });
    
    socket.on('monitoring_started', (data) => {
        isMonitoring = true;
        updateMonitoringControls();
        showNotification(`Monitoring started for camera ${data.cameraId}`, 'success');
    });
    
    socket.on('monitoring_stopped', (data) => {
        isMonitoring = false;
        updateMonitoringControls();
        showNotification(`Monitoring stopped for camera ${data.cameraId}`, 'info');
    });
    
    socket.on('snapshot', handleSnapshot);
    socket.on('frame_analyzed', handleAnalysisResult);
    socket.on('emergency_stop_activated', handleEmergencyStop);
    socket.on('status', handleStatusUpdate);
    socket.on('events', handleEventsList);
    socket.on('metrics', handleMetrics);
}

// Setup event listeners
function setupEventListeners() {
    // Emergency stop
    elements.emergencyStop.addEventListener('click', () => {
        if (confirm('Are you sure you want to trigger an emergency stop? This will stop all robot operations.')) {
            socket.emit('emergency_stop', { confirmation: 'CONFIRM_STOP' });
        }
    });
    
    // Settings modal
    elements.settingsBtn.addEventListener('click', () => {
        showModal('settingsModal');
    });
    
    // Camera controls
    elements.startMonitor.addEventListener('click', startMonitoring);
    elements.stopMonitor.addEventListener('click', stopMonitoring);
    elements.captureSnapshot.addEventListener('click', captureSnapshot);
    elements.intervalSelect.addEventListener('change', updateInterval);
    
    // Analysis
    elements.customAnalysis.addEventListener('click', () => {
        showModal('analysisModal');
    });
    
    elements.runAnalysis.addEventListener('click', runCustomAnalysis);
    
    // Clear events
    elements.clearEvents.addEventListener('click', clearEventsList);
    
    // Settings
    elements.saveSettings.addEventListener('click', saveSettings);
    
    // Threshold sliders
    elements.tippedThreshold.addEventListener('input', (e) => {
        elements.tippedThresholdValue.textContent = e.target.value + '%';
    });
    
    elements.collisionThreshold.addEventListener('input', (e) => {
        elements.collisionThresholdValue.textContent = e.target.value + '%';
    });
    
    // Dark mode
    elements.darkMode.addEventListener('change', (e) => {
        document.body.classList.toggle('dark-mode', e.target.checked);
        localStorage.setItem('darkMode', e.target.checked);
    });
    
    // Acknowledge alert
    elements.acknowledgeAlert.addEventListener('click', acknowledgeAlert);
    
    // Modal close buttons
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modal = e.target.closest('.modal');
            modal.classList.remove('show');
        });
    });
    
    // Click outside modal to close
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('show');
            }
        });
    });
    
    // Prompt suggestions
    document.querySelectorAll('.suggestion-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            elements.customPrompt.value = e.target.dataset.prompt;
        });
    });
}

// Connection status update
function updateConnectionStatus(connected) {
    elements.connectionStatus.className = 'status-indicator ' + (connected ? 'connected' : 'disconnected');
    elements.connectionText.textContent = connected ? 'Connected' : 'Disconnected';
}

// Handle initial status
function handleInitialStatus(status) {
    console.log('Initial status:', status);
    
    // Update service status
    if (status.services) {
        updateServiceStatus('visionStatus', status.services.vision);
        updateServiceStatus('dbStatus', status.services.database);
        updateServiceStatus('alertStatus', status.services.alerts);
    }
    
    // Update camera list
    if (status.cameras) {
        updateCameraList(status.cameras);
    }
    
    // Update active alerts
    if (status.activeAlerts) {
        status.activeAlerts.forEach(alert => {
            addAlertToList(alert);
        });
        updateAlertBadge();
    }
}

// Update service status display
function updateServiceStatus(elementId, status) {
    const element = elements[elementId];
    if (element) {
        element.textContent = status || 'offline';
        element.className = 'status-value ' + (status === 'online' ? 'online' : 'offline');
    }
}

// Update camera list
function updateCameraList(cameras) {
    elements.cameraList.innerHTML = '';
    
    cameras.forEach(camera => {
        const item = document.createElement('div');
        item.className = 'camera-item';
        item.dataset.cameraId = camera.id;
        
        item.innerHTML = `
            <span>${camera.name}</span>
            <span class="camera-status ${camera.status === 'connected' ? 'online' : ''}"></span>
        `;
        
        item.addEventListener('click', () => selectCamera(camera.id));
        
        elements.cameraList.appendChild(item);
    });
}

// Select camera
function selectCamera(cameraId) {
    // Update UI
    document.querySelectorAll('.camera-item').forEach(item => {
        item.classList.toggle('active', item.dataset.cameraId === cameraId);
    });
    
    // Update current camera
    currentCameraId = cameraId;
    
    // Find camera name
    const cameraItem = document.querySelector(`.camera-item[data-camera-id="${cameraId}"]`);
    const cameraName = cameraItem ? cameraItem.querySelector('span').textContent : cameraId;
    elements.cameraTitle.textContent = cameraName;
    
    // Subscribe to camera feed
    socket.emit('subscribe', { feed: 'live', cameraId: cameraId });
    
    // Show video canvas
    elements.videoCanvas.style.display = 'block';
    elements.noFeed.style.display = 'none';
}

// Start monitoring
function startMonitoring() {
    if (!currentCameraId) {
        showNotification('Please select a camera first', 'warning');
        return;
    }
    
    socket.emit('start_monitoring', {
        cameraId: currentCameraId,
        interval: currentInterval
    });
}

// Stop monitoring
function stopMonitoring() {
    if (!currentCameraId) return;
    
    socket.emit('stop_monitoring', {
        cameraId: currentCameraId
    });
}

// Update monitoring controls
function updateMonitoringControls() {
    elements.startMonitor.disabled = isMonitoring;
    elements.stopMonitor.disabled = !isMonitoring;
}

// Update interval
function updateInterval() {
    currentInterval = parseInt(elements.intervalSelect.value);
    
    if (isMonitoring && currentCameraId) {
        // Restart with new interval
        stopMonitoring();
        setTimeout(() => startMonitoring(), 100);
    }
}

// Capture snapshot
function captureSnapshot() {
    if (!currentCameraId) {
        showNotification('Please select a camera first', 'warning');
        return;
    }
    
    socket.emit('request_snapshot', { cameraId: currentCameraId });
}

// Handle frame
function handleFrame(data) {
    if (data.cameraId !== currentCameraId) return;
    
    // Create image from base64
    const img = new Image();
    img.onload = () => {
        // Clear canvas
        ctx.clearRect(0, 0, elements.videoCanvas.width, elements.videoCanvas.height);
        
        // Draw image
        const scale = Math.min(
            elements.videoCanvas.width / img.width,
            elements.videoCanvas.height / img.height
        );
        const x = (elements.videoCanvas.width - img.width * scale) / 2;
        const y = (elements.videoCanvas.height - img.height * scale) / 2;
        
        ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
        
        // Update FPS
        frameCount++;
        const now = Date.now();
        if (now - lastFpsUpdate >= 1000) {
            currentFps = frameCount;
            frameCount = 0;
            lastFpsUpdate = now;
            elements.fps.textContent = currentFps;
        }
        
        // Update resolution
        elements.resolution.textContent = `${img.width}x${img.height}`;
    };
    
    img.src = 'data:image/jpeg;base64,' + data.image;
    
    // Update analysis if provided
    if (data.analysis) {
        updateAnalysis(data.analysis);
    }
    
    // Calculate latency
    const latency = Date.now() - new Date(data.timestamp).getTime();
    elements.latency.textContent = Math.max(0, latency);
}

// Handle snapshot
function handleSnapshot(data) {
    // Download snapshot
    const link = document.createElement('a');
    link.download = `snapshot_${data.cameraId}_${Date.now()}.jpg`;
    link.href = 'data:image/jpeg;base64,' + data.image;
    link.click();
    
    showNotification('Snapshot captured', 'success');
}

// Handle event
function handleEvent(event) {
    console.log('Event detected:', event);
    
    // Add to event list
    addEventToList(event);
    
    // Update event count
    const currentCount = parseInt(elements.eventCount.textContent);
    elements.eventCount.textContent = currentCount + 1;
    
    // Show notification for critical events
    if (event.priority === 'critical' || event.priority === 'high') {
        showNotification(`${event.type}: ${event.description}`, 'warning');
    }
}

// Add event to list
function addEventToList(event) {
    const item = document.createElement('div');
    item.className = 'event-item';
    
    const time = new Date(event.timestamp).toLocaleTimeString();
    
    item.innerHTML = `
        <div class="event-type">${event.type.replace(/_/g, ' ')}</div>
        <div class="event-details">
            ${time} - ${event.description}
            ${event.confidence ? `(${Math.round(event.confidence * 100)}% confidence)` : ''}
        </div>
    `;
    
    // Add to top of list
    elements.eventList.insertBefore(item, elements.eventList.firstChild);
    
    // Limit list size
    while (elements.eventList.children.length > 50) {
        elements.eventList.removeChild(elements.eventList.lastChild);
    }
}

// Clear events list
function clearEventsList() {
    elements.eventList.innerHTML = '';
    elements.eventCount.textContent = '0';
}

// Handle alert
function handleAlert(alert) {
    console.log('Alert received:', alert);
    addAlertToList(alert);
    updateAlertBadge();
}

// Handle alert notification
function handleAlertNotification(alert) {
    // Show notification
    showNotification(alert.title, alert.priority);
    
    // Play sound if enabled
    if (elements.soundAlerts.checked) {
        elements.alertSound.play().catch(e => console.error('Could not play alert sound:', e));
    }
}

// Add alert to list
function addAlertToList(alert) {
    const item = document.createElement('div');
    item.className = `alert-item ${alert.priority}`;
    item.dataset.alertId = alert.id;
    
    const time = new Date(alert.timestamp || Date.now()).toLocaleTimeString();
    
    item.innerHTML = `
        <div class="alert-title">${alert.title}</div>
        <div class="alert-time">${time}</div>
    `;
    
    item.addEventListener('click', () => showAlertDetails(alert));
    
    // Add to top of list
    elements.alertList.insertBefore(item, elements.alertList.firstChild);
    
    // Limit list size
    while (elements.alertList.children.length > 20) {
        elements.alertList.removeChild(elements.alertList.lastChild);
    }
}

// Update alert badge
function updateAlertBadge() {
    const count = document.querySelectorAll('.alert-item').length;
    elements.alertBadge.textContent = count;
    elements.alertBadge.style.display = count > 0 ? 'block' : 'none';
}

// Show alert details
function showAlertDetails(alert) {
    selectedAlertId = alert.id;
    
    elements.alertDetails.innerHTML = `
        <p><strong>Title:</strong> ${alert.title}</p>
        <p><strong>Message:</strong> ${alert.message}</p>
        <p><strong>Type:</strong> ${alert.eventType}</p>
        <p><strong>Priority:</strong> ${alert.priority}</p>
        <p><strong>Time:</strong> ${new Date(alert.timestamp).toLocaleString()}</p>
        <p><strong>State:</strong> ${alert.state}</p>
    `;
    
    showModal('alertModal');
}

// Acknowledge alert
function acknowledgeAlert() {
    if (!selectedAlertId) return;
    
    const notes = prompt('Add notes (optional):');
    
    socket.emit('acknowledge_alert', {
        alertId: selectedAlertId,
        notes: notes || ''
    });
    
    // Remove from list
    const alertItem = document.querySelector(`.alert-item[data-alert-id="${selectedAlertId}"]`);
    if (alertItem) {
        alertItem.remove();
    }
    
    updateAlertBadge();
    hideModal('alertModal');
    
    showNotification('Alert acknowledged', 'success');
}

// Handle robot status
function handleRobotStatus(status) {
    console.log('Robot status:', status);
    updateRobotList([status]);
}

// Update robot list
function updateRobotList(robots) {
    elements.robotList.innerHTML = '';
    
    robots.forEach(robot => {
        const item = document.createElement('div');
        item.className = 'robot-item';
        
        let indicatorClass = 'robot-indicator';
        if (robot.status === 'error' || robot.status === 'tipped') {
            indicatorClass += ' error';
        } else if (robot.status === 'stuck' || robot.status === 'warning') {
            indicatorClass += ' warning';
        }
        
        item.innerHTML = `
            <div class="robot-info">
                <div class="robot-name">${robot.robotId || robot.robot_id}</div>
                <div class="robot-status">${robot.status} - ${robot.currentTask || 'idle'}</div>
            </div>
            <div class="${indicatorClass}"></div>
        `;
        
        elements.robotList.appendChild(item);
    });
    
    elements.robotCount.textContent = robots.length;
}

// Handle system status
function handleSystemStatus(status) {
    console.log('System status:', status);
    
    if (status.camera) updateServiceStatus('visionStatus', status.camera);
    if (status.api) updateServiceStatus('visionStatus', status.api);
    if (status.database) updateServiceStatus('dbStatus', status.database);
    if (status.alerts) updateServiceStatus('alertStatus', status.alerts);
}

// Handle camera status
function handleCameraStatus(status) {
    const cameraItem = document.querySelector(`.camera-item[data-camera-id="${status.cameraId}"]`);
    if (cameraItem) {
        const statusIndicator = cameraItem.querySelector('.camera-status');
        statusIndicator.classList.toggle('online', status.status === 'streaming');
    }
}

// Handle emergency stop
function handleEmergencyStop(data) {
    showNotification('EMERGENCY STOP ACTIVATED', 'error');
    isMonitoring = false;
    updateMonitoringControls();
}

// Handle status update
function handleStatusUpdate(status) {
    console.log('Status update:', status);
    
    // Update statistics if provided
    if (status.statistics) {
        if (status.statistics.events) {
            elements.eventCount.textContent = status.statistics.events.eventsDetected || 0;
        }
        if (status.statistics.alerts) {
            const activeAlerts = status.statistics.alerts.activeAlerts || 0;
            elements.alertBadge.textContent = activeAlerts;
            elements.alertBadge.style.display = activeAlerts > 0 ? 'block' : 'none';
        }
    }
}

// Handle events list
function handleEventsList(events) {
    elements.eventList.innerHTML = '';
    events.forEach(event => addEventToList(event));
}

// Handle metrics
function handleMetrics(data) {
    console.log('Metrics:', data);
    // Could display metrics in a chart or table
}

// Update analysis display
function updateAnalysis(analysis) {
    elements.analysisContent.innerHTML = `
        <div class="analysis-result">
            <strong>Analysis:</strong> ${analysis}
        </div>
    `;
}

// Run custom analysis
function runCustomAnalysis() {
    const prompt = elements.customPrompt.value.trim();
    
    if (!prompt) {
        showNotification('Please enter a prompt', 'warning');
        return;
    }
    
    if (!currentCameraId) {
        showNotification('Please select a camera first', 'warning');
        return;
    }
    
    socket.emit('analyze_frame', {
        cameraId: currentCameraId,
        prompt: prompt
    });
    
    hideModal('analysisModal');
    showNotification('Analysis requested...', 'info');
}

// Handle analysis result
function handleAnalysisResult(data) {
    console.log('Analysis result:', data);
    
    if (data.analysis) {
        elements.analysisContent.innerHTML = `
            <div class="analysis-result">
                <strong>Custom Analysis:</strong><br>
                ${data.analysis.content || data.analysis.summary || 'No result'}
                ${data.analysis.confidence ? `<br><em>Confidence: ${Math.round(data.analysis.confidence * 100)}%</em>` : ''}
            </div>
        `;
        
        showNotification('Analysis complete', 'success');
    }
}

// Show modal
function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('show');
    }
}

// Hide modal
function hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('show');
    }
}

// Show notification
function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 1rem 1.5rem;
        background: white;
        border-radius: 4px;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        z-index: 10000;
        animation: slideIn 0.3s ease;
        border-left: 4px solid;
    `;
    
    // Set color based on type
    const colors = {
        info: '#17a2b8',
        success: '#28a745',
        warning: '#ffc107',
        error: '#dc3545'
    };
    notification.style.borderLeftColor = colors[type] || colors.info;
    
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    // Remove after 5 seconds
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 5000);
}

// Save settings
function saveSettings() {
    const settings = {
        tippedThreshold: elements.tippedThreshold.value,
        collisionThreshold: elements.collisionThreshold.value,
        emailAlerts: elements.emailAlerts.checked,
        smsAlerts: elements.smsAlerts.checked,
        soundAlerts: elements.soundAlerts.checked,
        showZones: elements.showZones.checked,
        showRobotIds: elements.showRobotIds.checked,
        darkMode: elements.darkMode.checked
    };
    
    localStorage.setItem('settings', JSON.stringify(settings));
    
    // Apply settings
    applySettings(settings);
    
    hideModal('settingsModal');
    showNotification('Settings saved', 'success');
}

// Load settings
function loadSettings() {
    const saved = localStorage.getItem('settings');
    if (saved) {
        const settings = JSON.parse(saved);
        
        // Apply to UI
        elements.tippedThreshold.value = settings.tippedThreshold || 85;
        elements.tippedThresholdValue.textContent = elements.tippedThreshold.value + '%';
        
        elements.collisionThreshold.value = settings.collisionThreshold || 80;
        elements.collisionThresholdValue.textContent = elements.collisionThreshold.value + '%';
        
        elements.emailAlerts.checked = settings.emailAlerts !== false;
        elements.smsAlerts.checked = settings.smsAlerts === true;
        elements.soundAlerts.checked = settings.soundAlerts !== false;
        elements.showZones.checked = settings.showZones !== false;
        elements.showRobotIds.checked = settings.showRobotIds !== false;
        elements.darkMode.checked = settings.darkMode === true;
        
        applySettings(settings);
    }
}

// Apply settings
function applySettings(settings) {
    // Apply dark mode
    document.body.classList.toggle('dark-mode', settings.darkMode);
    
    // Could send threshold updates to server here
    // socket.emit('update_config', { type: 'thresholds', value: { ... } });
}

// Start clock
function startClock() {
    const updateTime = () => {
        const now = new Date();
        elements.systemTime.textContent = now.toLocaleString();
    };
    
    updateTime();
    setInterval(updateTime, 1000);
}

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}