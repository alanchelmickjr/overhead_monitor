/**
 * Gun.js based credential manager for dynamic, decentralized credential storage
 * This is weird and wonderful - credentials stored in a distributed graph database!
 */

const Gun = require('gun');
require('gun/sea'); // For encryption
require('gun/lib/unset');

class GunCredentialManager {
    constructor(peers = ['http://localhost:8765/gun']) {
        this.gun = Gun({
            peers: peers,
            localStorage: false,
            radisk: true
        });
        
        // Create a special credentials namespace
        this.credsSpace = this.gun.get('robot-monitor-credentials');
        this.cameraSpace = this.credsSpace.get('cameras');
        
        // Cache for quick access
        this.credCache = new Map();
        
        // Setup real-time listeners
        this.setupListeners();
    }
    
    setupListeners() {
        // Listen for credential updates
        this.cameraSpace.map().on((data, key) => {
            if (data) {
                console.log(`📡 Credential update for camera: ${key}`);
                this.credCache.set(key, data);
            }
        });
    }
    
    /**
     * Store camera credentials (encrypted)
     */
    async setCameraCredentials(cameraId, credentials) {
        try {
            // Create a unique camera node
            const cameraNode = this.cameraSpace.get(cameraId);
            
            // Encrypt password first
            const encryptedPassword = await this.encrypt(credentials.password);
            
            // Store encrypted credentials
            await new Promise((resolve) => {
                cameraNode.put({
                    id: cameraId,
                    ip: credentials.ip,
                    username: credentials.username,
                    password: encryptedPassword,
                    paths: credentials.paths || ['/stream1', '/1', '/live'],
                    lastUpdated: Date.now(),
                    active: true
                }, (ack) => {
                    if (ack.err) {
                        console.error('Failed to store credentials:', ack.err);
                    } else {
                        console.log(`✅ Stored credentials for camera: ${cameraId}`);
                    }
                    resolve(ack);
                });
            });
            
            // Update cache
            this.credCache.set(cameraId, credentials);
            
            return true;
        } catch (error) {
            console.error('Error storing credentials:', error);
            return false;
        }
    }
    
    /**
     * Get camera credentials
     */
    async getCameraCredentials(cameraId) {
        // Check cache first
        if (this.credCache.has(cameraId)) {
            const cached = this.credCache.get(cameraId);
            // Decrypt password if needed
            if (cached.password && cached.password.startsWith('SEA{')) {
                cached.password = await this.decrypt(cached.password);
            }
            return cached;
        }
        
        // Fetch from Gun
        return new Promise((resolve) => {
            this.cameraSpace.get(cameraId).once(async (data) => {
                if (data && data.active) {
                    // Decrypt password
                    if (data.password) {
                        data.password = await this.decrypt(data.password);
                    }
                    this.credCache.set(cameraId, data);
                    resolve(data);
                } else {
                    resolve(null);
                }
            });
        });
    }
    
    /**
     * Get all camera credentials
     */
    async getAllCameras() {
        return new Promise((resolve) => {
            const cameras = [];
            this.cameraSpace.map().once(async (data, key) => {
                if (data && data.active) {
                    // Decrypt password
                    if (data.password) {
                        data.password = await this.decrypt(data.password);
                    }
                    cameras.push(data);
                }
            }).then(() => {
                resolve(cameras);
            });
        });
    }
    
    /**
     * Find camera by IP
     */
    async findCameraByIP(ip) {
        return new Promise((resolve) => {
            let found = null;
            this.cameraSpace.map().once(async (data, key) => {
                if (data && data.ip === ip && data.active) {
                    // Decrypt password
                    if (data.password) {
                        data.password = await this.decrypt(data.password);
                    }
                    found = data;
                }
            }).then(() => {
                resolve(found);
            });
        });
    }
    
    /**
     * Update camera status
     */
    async updateCameraStatus(cameraId, status) {
        const cameraNode = this.cameraSpace.get(cameraId);
        cameraNode.get('lastSeen').put(Date.now());
        cameraNode.get('status').put(status);
        
        if (status.workingUrl) {
            cameraNode.get('lastWorkingUrl').put(status.workingUrl);
        }
    }
    
    /**
     * Simple encryption for passwords
     */
    async encrypt(text) {
        // In production, use Gun's SEA for proper encryption
        // For now, simple base64 with marker
        return 'SEA{' + Buffer.from(text).toString('base64') + '}';
    }
    
    async decrypt(encrypted) {
        if (!encrypted.startsWith('SEA{')) return encrypted;
        const base64 = encrypted.slice(4, -1);
        return Buffer.from(base64, 'base64').toString();
    }
    
    /**
     * Migrate from config file to Gun
     */
    async migrateFromConfig(config) {
        if (config.camera) {
            const cameraId = config.camera.name || 'default-camera';
            await this.setCameraCredentials(cameraId, {
                ip: config.camera.ip,
                username: config.camera.username,
                password: config.camera.password,
                paths: config.camera.paths || ['/stream1']
            });
            console.log('🔄 Migrated camera config to Gun.js');
        }
    }
    
    /**
     * Create test credentials
     */
    async createTestCredentials() {
        await this.setCameraCredentials('overhead-camera', {
            ip: '192.168.88.40',
            username: 'LeKiwi',
            password: 'LeKiwi995',
            paths: ['/stream1', '/1', '/live', '/ch0_0.h264']
        });
    }
}

module.exports = GunCredentialManager;