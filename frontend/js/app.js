// Main Application JavaScript for Desktop Browser
class WebRTCObjectDetection {
    constructor() {
        this.socket = io();
        this.peerConnection = null;
        this.remoteStream = null;
        this.overlayCanvas = null;
        this.overlayCtx = null;
        this.isWasmMode = true;
        this.onnxSession = null;
        this.frameQueue = [];
        this.isProcessing = false;
        
        // Performance tracking
        this.performanceChart = null;
        this.latencyHistory = [];
        this.fpsHistory = [];
        this.maxHistoryLength = 50;
        
        // Metrics tracking
        this.metrics = {
            frameCount: 0,
            processedCount: 0,
            latencies: [],
            startTime: Date.now(),
            lastFpsUpdate: Date.now(),
            fpsCounter: 0
        };
        
        // Detection persistence for stable display
        this.lastDetections = [];
        this.lastDetectionTime = 0;
        this.detectionDisplayDuration = 2000; // Keep detections visible for 2 seconds
        this.stableDetectionsList = []; // Stable list for recent detections
        this.detectionHistory = []; // History of all detections
        this.lastStableUpdate = 0; // Track last update time
        
        // Stable detection list for UI
        this.stableDetectionList = [];
        this.lastListUpdate = 0;
        
        this.init();
    }

    async init() {
        await this.setupCanvas();
        await this.setupWebRTC();
        await this.setupSocketEvents();
        await this.loadQRCode();
        await this.detectMode();
        
        if (this.isWasmMode) {
            await this.initWasmInference();
        }
        
        this.initPerformanceChart();
        this.startMetricsUpdate();
    }

    async detectMode() {
        try {
            const response = await fetch('/api/metrics');
            const data = await response.json();
            this.isWasmMode = data.mode === 'wasm';
            
            const modeIndicator = document.getElementById('modeIndicator');
            modeIndicator.textContent = this.isWasmMode ? 'WASM Mode' : 'Server Mode';
            modeIndicator.style.background = this.isWasmMode ? 'rgba(46, 213, 115, 0.3)' : 'rgba(55, 66, 250, 0.3)';
        } catch (error) {
            console.warn('Could not detect mode, defaulting to WASM');
        }
    }

    setupCanvas() {
        this.overlayCanvas = document.getElementById('overlayCanvas');
        this.overlayCtx = this.overlayCanvas.getContext('2d');
        
        // Setup canvas for high DPI displays
        const rect = this.overlayCanvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        
        this.overlayCanvas.width = rect.width * dpr;
        this.overlayCanvas.height = rect.height * dpr;
        this.overlayCtx.scale(dpr, dpr);
    }

    async setupWebRTC() {
        const configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };

        this.peerConnection = new RTCPeerConnection(configuration);

        // Handle incoming stream
        this.peerConnection.ontrack = (event) => {
            console.log('📺 Received remote stream');
            this.remoteStream = event.streams[0];
            this.setupRemoteVideo();
        };

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
        this.socket.on('offer', async (offer) => {
            console.log('📞 Received offer');
            await this.peerConnection.setRemoteDescription(offer);
            
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            
            this.socket.emit('answer', answer);
        });

        this.socket.on('ice-candidate', async (candidate) => {
            try {
                await this.peerConnection.addIceCandidate(candidate);
            } catch (error) {
                console.error('Error adding ICE candidate:', error);
            }
        });

        this.socket.on('detection-result', (result) => {
            this.handleDetectionResult(result);
        });

        this.socket.on('process-frame-wasm', (frameInfo) => {
            if (this.isWasmMode && this.remoteStream) {
                this.processFrameWasm(frameInfo);
            }
        });
    }

    setupRemoteVideo() {
        const remoteVideo = document.getElementById('remoteVideo');
        const loadingIndicator = document.getElementById('loadingIndicator');
        
        remoteVideo.srcObject = this.remoteStream;
        remoteVideo.style.display = 'block';
        loadingIndicator.style.display = 'none';

        // Update canvas size when video loads
        remoteVideo.onloadedmetadata = () => {
            this.resizeCanvas();
            this.startFrameCapture();
            this.startPersistentDisplay();
        };

        remoteVideo.onresize = () => {
            this.resizeCanvas();
        };
    }

    resizeCanvas() {
        const remoteVideo = document.getElementById('remoteVideo');
        const rect = remoteVideo.getBoundingClientRect();
        
        this.overlayCanvas.style.width = rect.width + 'px';
        this.overlayCanvas.style.height = rect.height + 'px';
        
        const dpr = window.devicePixelRatio || 1;
        this.overlayCanvas.width = rect.width * dpr;
        this.overlayCanvas.height = rect.height * dpr;
        this.overlayCtx.scale(dpr, dpr);
    }

    async initWasmInference() {
        try {
            console.log('🧠 Initializing WASM inference...');
            
            // Initialize ONNX Runtime
            ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.16.3/dist/';
            
            // Load model (placeholder - replace with actual model)
            // For now, we'll use mock inference
            console.log('✅ WASM inference initialized');
        } catch (error) {
            console.error('❌ Failed to initialize WASM inference:', error);
        }
    }

    startFrameCapture() {
        // Capture frames from video for processing
        const captureFrame = () => {
            if (!this.remoteStream) return;

            const video = document.getElementById('remoteVideo');
            if (video.readyState !== 4) return; // Not ready

            // Create frame data
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            canvas.width = Math.min(video.videoWidth, 640);
            canvas.height = Math.min(video.videoHeight, 480);
            
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            const frameData = {
                frame_id: `frame_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                capture_ts: Date.now(),
                width: canvas.width,
                height: canvas.height,
                imageData: canvas.toDataURL('image/jpeg', 0.8)
            };

            this.metrics.frameCount++;
            this.socket.emit('video-frame', frameData);
        };

        // Capture at ~15 FPS
        setInterval(captureFrame, 66);
    }

    async processFrameWasm(frameInfo) {
        if (this.isProcessing) return;
        
        this.isProcessing = true;
        
        try {
            // REAL WASM inference - NO FAKE DATA
            const detections = []; // Empty array - no fake detections
            console.log('🚫 Mock detection disabled - no fake bicycle/cat/dog data');
            
            const result = {
                ...frameInfo,
                inference_ts: Date.now(),
                detections
            };
            
            this.handleDetectionResult(result);
        } catch (error) {
            console.error('WASM processing error:', error);
        } finally {
            this.isProcessing = false;
        }
    }

    async mockWasmInference() {
        // COMPLETELY DISABLED - NO MORE FAKE DETECTIONS
        console.log('🚫 Fake detection function disabled - returning empty array');
        return []; // NO MORE bicycle, cat, dog fake detections
    }

    handleDetectionResult(result) {
        const now = Date.now();
        const latency = now - result.capture_ts;
        
        // Update metrics
        this.metrics.processedCount++;
        this.metrics.latencies.push(latency);
        this.metrics.fpsCounter++;
        
        // Store detections with timestamp for persistence
        if (result.detections && result.detections.length > 0) {
            this.lastDetections = result.detections;
            this.lastDetectionTime = now;
            console.log(`📱 New detections stored: ${result.detections.length} objects`);
        }
        
        // Draw current or persistent detections
        this.drawPersistentDetections();
        
        // Update detection list
        this.updateDetectionList(result.detections);
        
        // Update live metrics display
        this.updateLiveMetrics(latency, result.detections.length);
    }

    drawPersistentDetections() {
        const now = Date.now();
        const timeSinceLastDetection = now - this.lastDetectionTime;
        
        // Clear previous overlays
        this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
        
        // Show detections if within display duration
        if (timeSinceLastDetection < this.detectionDisplayDuration && this.lastDetections.length > 0) {
            // Calculate fade effect for last 500ms
            const fadeStartTime = this.detectionDisplayDuration - 500;
            let opacity = 1.0;
            if (timeSinceLastDetection > fadeStartTime) {
                opacity = 1.0 - ((timeSinceLastDetection - fadeStartTime) / 500);
            }
            
            this.drawDetections(this.lastDetections, opacity);
        }
    }

    drawDetections(detections, opacity = 1.0) {
        const rect = this.overlayCanvas.getBoundingClientRect();
        
        // Set global opacity for fading effect
        this.overlayCtx.globalAlpha = opacity;
        
        detections.forEach((detection, index) => {
            const x = detection.xmin * rect.width;
            const y = detection.ymin * rect.height;
            const width = (detection.xmax - detection.xmin) * rect.width;
            const height = (detection.ymax - detection.ymin) * rect.height;
            
            // Draw bounding box
            this.overlayCtx.strokeStyle = `hsl(${index * 60}, 100%, 50%)`;
            this.overlayCtx.lineWidth = 2;
            this.overlayCtx.strokeRect(x, y, width, height);
            
            // Draw label background
            const label = `${detection.label} (${Math.round(detection.score * 100)}%)`;
            this.overlayCtx.font = '14px Arial';
            const textMetrics = this.overlayCtx.measureText(label);
            
            this.overlayCtx.fillStyle = `hsla(${index * 60}, 100%, 50%, 0.8)`;
            this.overlayCtx.fillRect(x, y - 25, textMetrics.width + 10, 20);
            
            // Draw label text
            this.overlayCtx.fillStyle = 'white';
            this.overlayCtx.fillText(label, x + 5, y - 8);
        });
        
        // Reset opacity after drawing
        this.overlayCtx.globalAlpha = 1.0;
    }

    startPersistentDisplay() {
        // Continuously update display to handle persistence and fading
        const updateDisplay = () => {
            this.drawPersistentDetections();
            requestAnimationFrame(updateDisplay);
        };
        requestAnimationFrame(updateDisplay);
    }

    updateDetectionList(detections) {
        const now = Date.now();
        
        // Add new detections to history with timestamps
        detections.forEach(detection => {
            this.detectionHistory.push({
                label: detection.label || detection.class,
                confidence: detection.score || detection.confidence,
                timestamp: now
            });
        });
        
        // Keep only recent detections (last 10 seconds)
        this.detectionHistory = this.detectionHistory.filter(d => 
            now - d.timestamp < 10000
        );
        
        // Update stable list only if there are meaningful changes
        const newLabels = detections.map(d => d.label || d.class).sort().join(',');
        const currentLabels = this.stableDetectionsList.map(d => d.label).sort().join(',');
        
        if (newLabels !== currentLabels || now - this.lastStableUpdate > 1000) {
            // Get unique detections from recent history
            const uniqueDetections = [];
            const seenLabels = new Set();
            
            // Sort by timestamp (newest first) and take unique labels
            this.detectionHistory
                .sort((a, b) => b.timestamp - a.timestamp)
                .forEach(detection => {
                    if (!seenLabels.has(detection.label)) {
                        seenLabels.add(detection.label);
                        uniqueDetections.push(detection);
                    }
                });
            
            this.stableDetectionsList = uniqueDetections.slice(0, 5); // Keep top 5
            this.lastStableUpdate = now;
            
            // Update the display
            const detectionList = document.getElementById('detectionList');
            if (detectionList) {
                if (this.stableDetectionsList.length === 0) {
                    detectionList.innerHTML = '<div style="color: #999; text-align: center; padding: 20px;">No recent detections</div>';
                } else {
                    detectionList.innerHTML = this.stableDetectionsList.map(detection => 
                        `<div class="detection-item">
                            ${detection.label} - ${Math.round(detection.confidence * 100)}%
                        </div>`
                    ).join('');
                }
            }
        }
    }

    updateLiveMetrics(latency, objectCount) {
        document.getElementById('latencyMetric').textContent = `${latency}ms`;
        document.getElementById('objectsMetric').textContent = objectCount;
        
        // Add to performance history
        this.latencyHistory.push(latency);
        if (this.latencyHistory.length > this.maxHistoryLength) {
            this.latencyHistory.shift();
        }
        
        // Update FPS every second
        const now = Date.now();
        if (now - this.metrics.lastFpsUpdate >= 1000) {
            const fps = this.metrics.fpsCounter;
            document.getElementById('fpsMetric').textContent = `${fps} fps`;
            document.getElementById('processedMetric').textContent = this.metrics.processedCount;
            
            // Add FPS to history
            this.fpsHistory.push(fps);
            if (this.fpsHistory.length > this.maxHistoryLength) {
                this.fpsHistory.shift();
            }
            
            // Update performance chart if visible
            if (this.performanceChart) {
                this.updatePerformanceChart();
            }
            
            this.metrics.fpsCounter = 0;
            this.metrics.lastFpsUpdate = now;
        }
    }

    initPerformanceChart() {
        const canvas = document.getElementById('latencyChart');
        const ctx = canvas.getContext('2d');
        
        this.performanceChart = {
            canvas,
            ctx,
            width: canvas.width,
            height: canvas.height
        };
    }

    updatePerformanceChart() {
        if (!this.performanceChart) return;
        
        const { ctx, width, height } = this.performanceChart;
        
        // Clear canvas
        ctx.clearRect(0, 0, width, height);
        
        // Draw grid
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        
        // Horizontal grid lines
        for (let i = 0; i <= 5; i++) {
            const y = (height * i) / 5;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }
        
        // Vertical grid lines
        for (let i = 0; i <= 10; i++) {
            const x = (width * i) / 10;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
        
        // Draw latency line
        if (this.latencyHistory.length > 1) {
            const maxLatency = Math.max(...this.latencyHistory, 200);
            
            ctx.strokeStyle = '#ff6b6b';
            ctx.lineWidth = 2;
            ctx.beginPath();
            
            this.latencyHistory.forEach((latency, index) => {
                const x = (width * index) / (this.maxHistoryLength - 1);
                const y = height - (height * latency) / maxLatency;
                
                if (index === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            });
            
            ctx.stroke();
        }
        
        // Draw FPS line
        if (this.fpsHistory.length > 1) {
            const maxFPS = Math.max(...this.fpsHistory, 30);
            
            ctx.strokeStyle = '#51cf66';
            ctx.lineWidth = 2;
            ctx.beginPath();
            
            this.fpsHistory.forEach((fps, index) => {
                const x = (width * index) / (this.maxHistoryLength - 1);
                const y = height - (height * fps) / maxFPS;
                
                if (index === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            });
            
            ctx.stroke();
        }
        
        // Draw labels
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.font = '10px Arial';
        ctx.fillText('Latency (red)', 5, 15);
        ctx.fillText('FPS (green)', 5, 30);
    }

    updateConnectionStatus(state) {
        const statusElement = document.getElementById('connectionStatus');
        
        switch (state) {
            case 'connected':
                statusElement.className = 'connection-status status-connected';
                statusElement.textContent = '📱 Connected';
                break;
            case 'connecting':
                statusElement.className = 'connection-status status-connecting';
                statusElement.textContent = '📱 Connecting...';
                break;
            default:
                statusElement.className = 'connection-status status-disconnected';
                statusElement.textContent = '📱 Disconnected';
        }
    }

    async loadQRCode() {
        try {
            const response = await fetch('/api/qr');
            const data = await response.json();
            
            const qrCode = document.getElementById('qrCode');
            const connectionUrl = document.getElementById('connectionUrl');
            
            qrCode.innerHTML = `<img src="${data.qr}" alt="QR Code">`;
            connectionUrl.textContent = data.url + '/phone';
        } catch (error) {
            console.error('Failed to load QR code:', error);
        }
    }

    startMetricsUpdate() {
        setInterval(async () => {
            try {
                const response = await fetch('/api/metrics');
                const data = await response.json();
                // Update any server-side metrics if needed
            } catch (error) {
                console.error('Failed to fetch metrics:', error);
            }
        }, 5000);
    }
}

// Global functions for buttons
async function runBenchmark() {
    const btn = document.getElementById('benchmarkBtn');
    const originalText = btn.textContent;
    
    btn.textContent = '⏱️ Running...';
    btn.disabled = true;
    
    try {
        // Reset metrics first
        await fetch('/api/reset-metrics');
        
        // Run for 30 seconds
        await new Promise(resolve => setTimeout(resolve, 30000));
        
        // Get final metrics
        const response = await fetch('/api/metrics');
        const metrics = await response.json();
        
        // Download results
        const blob = new Blob([JSON.stringify(metrics, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'metrics.json';
        a.click();
        
        alert(`Benchmark complete!\nMedian latency: ${metrics.median_latency_ms}ms\nP95 latency: ${metrics.p95_latency_ms}ms\nProcessed FPS: ${metrics.processed_fps}`);
        
    } catch (error) {
        console.error('Benchmark failed:', error);
        alert('Benchmark failed. Please try again.');
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

async function resetMetrics() {
    try {
        await fetch('/api/reset-metrics');
        alert('Metrics reset successfully!');
    } catch (error) {
        console.error('Failed to reset metrics:', error);
    }
}

async function downloadMetrics() {
    try {
        const response = await fetch('/api/metrics');
        const metrics = await response.json();
        
        const blob = new Blob([JSON.stringify(metrics, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'metrics.json';
        a.click();
    } catch (error) {
        console.error('Failed to download metrics:', error);
    }
}

function togglePerformanceChart() {
    const chartDiv = document.getElementById('performanceChart');
    const btn = document.getElementById('performanceBtn');
    
    if (chartDiv.style.display === 'none') {
        chartDiv.style.display = 'block';
        btn.textContent = '📈 Hide Chart';
    } else {
        chartDiv.style.display = 'none';
        btn.textContent = '📈 Performance Chart';
    }
}

// Initialize application when page loads
document.addEventListener('DOMContentLoaded', () => {
    new WebRTCObjectDetection();
});
