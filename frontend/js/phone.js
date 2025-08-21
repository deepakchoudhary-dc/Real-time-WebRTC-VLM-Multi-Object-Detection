// Phone Camera JavaScript
class PhoneCamera {
    constructor() {
        this.socket = io();
        this.peerConnection = null;
        this.localStream = null;
        this.overlayCanvas = null;
        this.overlayCtx = null;
        this.currentCamera = 'user'; // 'user' for front, 'environment' for back
        this.isHD = false;
        this.frameId = 0;
        
        // Metrics
        this.metrics = {
            fps: 0,
            lastLatency: 0,
            objectCount: 0,
            framesSent: 0,
            lastFpsUpdate: Date.now()
        };
        
        this.recentDetections = [];
        
        // Initialize YOLO detector
        this.yoloDetector = null;
        this.detectionEnabled = true;
        
        this.init();
    }

    async init() {
        await this.setupCanvas();
        await this.setupWebRTC();
        await this.setupSocketEvents();
        this.updateMetricsDisplay();
        
        // Initialize YOLO detector
        this.initializeDetector();
    }

    async initializeDetector() {
        try {
            if (window.yoloDetector) {
                this.yoloDetector = window.yoloDetector;
                console.log('🤖 Initializing YOLO detector...');
                await this.yoloDetector.loadModel();
                console.log('✅ YOLO detector ready');
            }
        } catch (error) {
            console.error('❌ Failed to initialize detector:', error);
        }
    }

    setupCanvas() {
        this.overlayCanvas = document.getElementById('overlayCanvas');
        this.overlayCtx = this.overlayCanvas.getContext('2d');
    }

    async setupWebRTC() {
        const configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };

        this.peerConnection = new RTCPeerConnection(configuration);

        // Handle connection state changes
        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection.connectionState;
            console.log('🔗 Connection state:', state);
            this.updateConnectionStatus(state);
        };

        // Handle ICE candidates
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('ice-candidate', event.candidate);
            }
        };
    }

    setupSocketEvents() {
        this.socket.on('answer', async (answer) => {
            console.log('✅ Received answer');
            await this.peerConnection.setRemoteDescription(answer);
        });

        this.socket.on('ice-candidate', async (candidate) => {
            try {
                await this.peerConnection.addIceCandidate(candidate);
            } catch (error) {
                console.error('Error adding ICE candidate:', error);
            }
        });

        this.socket.on('detection-result', (result) => {
            // Ignore server-side detection results to prevent fake detections
            console.log('🚫 Ignoring server-side detection result to prevent fake data');
            // this.handleDetectionResult(result); // Commented out
        });

        this.socket.on('process-frame-wasm', (frameInfo) => {
            // In WASM mode, we handle detection locally
            console.log('📱 WASM mode: Local detection active');
        });
    }

    async startCamera() {
        const startButton = document.getElementById('startButton');
        const loadingSpinner = document.getElementById('loadingSpinner');
        const errorMessage = document.getElementById('errorMessage');
        
        startButton.style.display = 'none';
        loadingSpinner.style.display = 'block';
        errorMessage.style.display = 'none';

        try {
            // Check if getUserMedia is available with fallback
            if (!navigator.mediaDevices) {
                // Try to polyfill for older browsers
                navigator.mediaDevices = {};
            }
            
            if (!navigator.mediaDevices.getUserMedia) {
                // Try legacy getUserMedia
                navigator.mediaDevices.getUserMedia = function(constraints) {
                    const getUserMedia = navigator.webkitGetUserMedia || 
                                       navigator.mozGetUserMedia || 
                                       navigator.msGetUserMedia || 
                                       navigator.getUserMedia;
                    
                    if (!getUserMedia) {
                        return Promise.reject(new Error('getUserMedia is not supported in this browser'));
                    }
                    
                    return new Promise((resolve, reject) => {
                        getUserMedia.call(navigator, constraints, resolve, reject);
                    });
                };
            }

            const constraints = this.getCameraConstraints();
            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            
            await this.setupLocalVideo();
            await this.startWebRTCConnection();
            
            this.showCameraView();
            this.startFrameCapture();
            
        } catch (error) {
            console.error('❌ Camera access failed:', error);
            this.showError(this.getCameraErrorMessage(error));
            
            startButton.style.display = 'block';
            loadingSpinner.style.display = 'none';
        }
    }

    getCameraConstraints() {
        const baseConstraints = {
            video: {
                facingMode: this.currentCamera,
                aspectRatio: { ideal: 16/9 }
            },
            audio: false
        };

        if (this.isHD) {
            baseConstraints.video.width = { ideal: 1280 };
            baseConstraints.video.height = { ideal: 720 };
        } else {
            baseConstraints.video.width = { ideal: 640 };
            baseConstraints.video.height = { ideal: 480 };
        }

        return baseConstraints;
    }

    setupLocalVideo() {
        const localVideo = document.getElementById('localVideo');
        localVideo.srcObject = this.localStream;
        
        localVideo.onloadedmetadata = () => {
            this.resizeCanvas();
        };

        localVideo.onresize = () => {
            this.resizeCanvas();
        };
    }

    resizeCanvas() {
        const localVideo = document.getElementById('localVideo');
        const rect = localVideo.getBoundingClientRect();
        
        this.overlayCanvas.style.width = rect.width + 'px';
        this.overlayCanvas.style.height = rect.height + 'px';
        
        const dpr = window.devicePixelRatio || 1;
        this.overlayCanvas.width = rect.width * dpr;
        this.overlayCanvas.height = rect.height * dpr;
        this.overlayCtx.scale(dpr, dpr);
    }

    async startWebRTCConnection() {
        // Add local stream to peer connection
        this.localStream.getTracks().forEach(track => {
            this.peerConnection.addTrack(track, this.localStream);
        });

        // Create and send offer
        const offer = await this.peerConnection.createOffer();
        await this.peerConnection.setLocalDescription(offer);
        
        this.socket.emit('offer', offer);
    }

    startFrameCapture() {
        let lastCaptureTime = Date.now();
        let lastDetectionTime = Date.now();
        
        const captureFrame = () => {
            const now = Date.now();
            const timeSinceLastCapture = now - lastCaptureTime;
            const timeSinceLastDetection = now - lastDetectionTime;
            
            // Slower detection for more stable display
            const targetInterval = 100; // ~10 FPS (slower capture)
            const detectionInterval = 800; // Run detection every 800ms (1.25 FPS - much slower)
            
            if (timeSinceLastCapture >= targetInterval) {
                this.captureAndSendFrame();
                lastCaptureTime = now;
                
                // Update FPS counter
                this.metrics.framesSent++;
                if (now - this.metrics.lastFpsUpdate >= 1000) {
                    this.metrics.fps = this.metrics.framesSent;
                    this.metrics.framesSent = 0;
                    this.metrics.lastFpsUpdate = now;
                }
                
                // Run detection less frequently
                if (timeSinceLastDetection >= detectionInterval && this.detectionEnabled) {
                    this.runDetection();
                    lastDetectionTime = now;
                }
            }
            
            requestAnimationFrame(captureFrame);
        };
        
        requestAnimationFrame(captureFrame);
    }

    async runDetection() {
        try {
            const video = document.getElementById('localVideo');
            if (video.readyState !== 4) return;
            
            // Use YOLO detector for real object detection
            let detections = [];
            
            if (window.yoloDetector) {
                // Ensure detector is loaded
                if (!window.yoloDetector.modelLoaded) {
                    await window.yoloDetector.loadModel();
                }
                
                // Run actual detection
                detections = await window.yoloDetector.detect(video);
                
                if (detections.length > 0) {
                    const labels = detections.map(d => `${d.label} (${Math.round(d.score * 100)}%)`);
                    console.log(`🔍 Detection result: ${detections.length} objects found - ${labels.join(', ')}`);
                } else {
                    console.log(`🔍 Detection result: No objects detected`);
                }
            } else {
                console.log('⚠️ YOLO detector not available');
            }
            
            const result = {
                frame_id: `phone_${++this.frameId}_${Date.now()}`,
                capture_ts: Date.now(),
                recv_ts: Date.now(),
                inference_ts: Date.now(),
                detections
            };
            
            // Send detection results to desktop via socket
            if (detections.length > 0) {
                console.log(`📤 Sending ${detections.length} detections to desktop:`, detections.map(d => d.label));
                this.socket.emit('detection-result', result);
            } else {
                console.log('📤 Sending empty detection result to desktop');
                this.socket.emit('detection-result', result);
            }
            
            this.handleDetectionResult(result);
            
        } catch (error) {
            console.error('❌ Detection error:', error);
        }
    }

    captureAndSendFrame() {
        const video = document.getElementById('localVideo');
        if (video.readyState !== 4) return;

        // Create canvas for frame capture
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Use smaller resolution for processing
        const maxWidth = 640;
        const maxHeight = 480;
        
        const aspectRatio = video.videoWidth / video.videoHeight;
        let width = Math.min(video.videoWidth, maxWidth);
        let height = width / aspectRatio;
        
        if (height > maxHeight) {
            height = maxHeight;
            width = height * aspectRatio;
        }
        
        canvas.width = width;
        canvas.height = height;
        
        // Draw and flip horizontally for front camera
        if (this.currentCamera === 'user') {
            ctx.scale(-1, 1);
            ctx.drawImage(video, -width, 0, width, height);
        } else {
            ctx.drawImage(video, 0, 0, width, height);
        }
        
        const frameData = {
            frame_id: `phone_${++this.frameId}_${Date.now()}`,
            capture_ts: Date.now(),
            width: canvas.width,
            height: canvas.height,
            imageData: canvas.toDataURL('image/jpeg', 0.7)
        };

        this.socket.emit('video-frame', frameData);
    }

    handleDetectionResult(result) {
        const latency = Date.now() - result.capture_ts;
        
        // Update metrics
        this.metrics.lastLatency = latency;
        this.metrics.objectCount = result.detections.length;
        
        // Draw overlays
        this.drawDetections(result.detections);
        
        // Update recent detections
        this.updateRecentDetections(result.detections);
    }

    drawDetections(detections) {
        // Clear previous overlays
        this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
        
        const rect = this.overlayCanvas.getBoundingClientRect();
        
        detections.forEach((detection, index) => {
            let x = detection.xmin * rect.width;
            let y = detection.ymin * rect.height;
            let width = (detection.xmax - detection.xmin) * rect.width;
            let height = (detection.ymax - detection.ymin) * rect.height;
            
            // Flip coordinates for front camera
            if (this.currentCamera === 'user') {
                x = rect.width - x - width;
            }
            
            // Draw bounding box
            this.overlayCtx.strokeStyle = `hsl(${index * 60 + 120}, 100%, 60%)`;
            this.overlayCtx.lineWidth = 3;
            this.overlayCtx.strokeRect(x, y, width, height);
            
            // Draw label background
            const label = `${detection.label} ${Math.round(detection.score * 100)}%`;
            this.overlayCtx.font = 'bold 16px Arial';
            const textMetrics = this.overlayCtx.measureText(label);
            
            this.overlayCtx.fillStyle = `hsla(${index * 60 + 120}, 100%, 60%, 0.9)`;
            this.overlayCtx.fillRect(x, y - 30, textMetrics.width + 12, 25);
            
            // Draw label text
            this.overlayCtx.fillStyle = 'white';
            this.overlayCtx.fillText(label, x + 6, y - 10);
        });
    }

    updateRecentDetections(detections) {
        // Only show real detections, no fake data
        if (detections.length === 0) {
            // Clear any previous fake detections
            this.recentDetections = [];
        } else {
            // Add real detections with timestamps
            const timestamp = new Date().toLocaleTimeString();
            detections.forEach(detection => {
                this.recentDetections.unshift({
                    ...detection,
                    timestamp
                });
            });
            
            // Keep only last 5 detections
            this.recentDetections = this.recentDetections.slice(0, 5);
        }
        
        // Update display
        const recentDetectionsEl = document.getElementById('recentDetections');
        if (this.recentDetections.length === 0) {
            recentDetectionsEl.innerHTML = '<div style="color: #999; font-size: 0.7rem;">🔍 Looking for objects... (No fake detections)</div>';
        } else {
            recentDetectionsEl.innerHTML = this.recentDetections.map(detection => 
                `<div class="detection-item">
                    ✅ ${detection.label} (${Math.round(detection.score * 100)}%)
                </div>`
            ).join('');
        }
    }

    updateConnectionStatus(state) {
        const statusElement = document.getElementById('connectionStatus');
        
        switch (state) {
            case 'connected':
                statusElement.className = 'status-indicator status-connected';
                statusElement.innerHTML = '<div class="status-dot"></div><span>Connected</span>';
                break;
            case 'connecting':
                statusElement.className = 'status-indicator status-connecting';
                statusElement.innerHTML = '<div class="status-dot"></div><span>Connecting...</span>';
                break;
            default:
                statusElement.className = 'status-indicator';
                statusElement.innerHTML = '<div class="status-dot"></div><span>Disconnected</span>';
        }
    }

    showCameraView() {
        document.getElementById('permissionScreen').style.display = 'none';
        document.getElementById('videoContainer').style.display = 'block';
        document.getElementById('controlsPanel').style.display = 'flex';
    }

    showError(message) {
        const errorMessage = document.getElementById('errorMessage');
        errorMessage.textContent = message;
        errorMessage.style.display = 'block';
    }

    getCameraErrorMessage(error) {
        switch (error.name) {
            case 'NotAllowedError':
                return 'Camera permission denied. Please allow camera access and refresh.';
            case 'NotFoundError':
                return 'No camera found on this device.';
            case 'NotSupportedError':
                return 'Camera not supported in this browser.';
            case 'SecurityError':
                return 'Camera access blocked due to security. Try using HTTPS or localhost.';
            default:
                if (error.message.includes('getUserMedia')) {
                    return 'Camera API not available. Please try a different browser or enable camera permissions.';
                }
                return `Camera error: ${error.message}. Try refreshing the page.`;
        }
    }

    updateMetricsDisplay() {
        const updateInterval = () => {
            document.getElementById('fpsDisplay').textContent = this.metrics.fps;
            document.getElementById('latencyDisplay').textContent = `${this.metrics.lastLatency}ms`;
            document.getElementById('objectCountDisplay').textContent = this.metrics.objectCount;
        };
        
        setInterval(updateInterval, 500);
    }
}

// Global functions
async function switchCamera() {
    if (!window.phoneCamera) return;
    
    window.phoneCamera.currentCamera = 
        window.phoneCamera.currentCamera === 'user' ? 'environment' : 'user';
    
    // Stop current stream
    if (window.phoneCamera.localStream) {
        window.phoneCamera.localStream.getTracks().forEach(track => track.stop());
    }
    
    // Restart with new camera
    try {
        const constraints = window.phoneCamera.getCameraConstraints();
        window.phoneCamera.localStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        await window.phoneCamera.setupLocalVideo();
        
        // Update WebRTC connection
        const sender = window.phoneCamera.peerConnection.getSenders().find(s => 
            s.track && s.track.kind === 'video'
        );
        
        if (sender) {
            await sender.replaceTrack(window.phoneCamera.localStream.getVideoTracks()[0]);
        }
        
    } catch (error) {
        console.error('Camera switch failed:', error);
        alert('Failed to switch camera');
    }
}

function toggleQuality() {
    if (!window.phoneCamera) return;
    
    window.phoneCamera.isHD = !window.phoneCamera.isHD;
    const qualityToggle = document.getElementById('qualityToggle');
    qualityToggle.textContent = window.phoneCamera.isHD ? '📺 SD' : '📺 HD';
    
    // Restart camera with new quality
    switchCamera().then(() => switchCamera()); // Toggle twice to apply new constraints
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else {
        document.exitFullscreen();
    }
}

function startCamera() {
    if (window.phoneCamera) {
        window.phoneCamera.startCamera();
    }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.phoneCamera = new PhoneCamera();
    
    // Auto-start camera on mobile
    if (/Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
        // Show start button but don't auto-start for privacy
        console.log('📱 Mobile device detected');
    }
});
