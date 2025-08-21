# Development Guide
## WebRTC Multi-Object Detection System

---

## Quick Setup

### Prerequisites
- **Node.js** 16+ ([Download](https://nodejs.org/))
- **Git** ([Download](https://git-scm.com/))
- **Modern Browser** (Chrome 90+, Firefox 88+, Safari 14+)
- **Mobile Device** with camera and modern browser

### One-Command Start
```bash
# Clone repository
git clone <your-repo-url>
cd ADBrand2

# Start in WASM mode (default)
./start.sh
# OR on Windows
start.bat

# Start in server mode
./start.sh --mode server

# Start with ngrok for remote phone access
./start.sh --ngrok
```

### Docker Alternative
```bash
# WASM mode
docker-compose up --build

# Server mode  
docker-compose -f docker-compose.server.yml up --build
```

---

## Project Structure

```
ADBrand2/
├── frontend/                 # Browser client code
│   ├── index.html           # Desktop interface
│   ├── phone.html           # Mobile interface
│   └── js/
│       ├── app.js           # Main application logic
│       └── phone.js         # Phone camera logic
├── server/                  # Node.js backend
│   └── index.js             # WebRTC signaling server
├── models/                  # ONNX detection models
│   ├── config.json          # Model configuration
│   └── README.md            # Model documentation
├── bench/                   # Benchmarking tools
│   ├── run_bench.sh         # Linux/Mac benchmark
│   └── run_bench.ps1        # Windows PowerShell benchmark
├── scripts/                 # Utility scripts
│   └── download_models.sh   # Model setup script
├── docker/                  # Docker configurations
├── start.sh                 # Main startup script (Linux/Mac)
├── start.bat                # Main startup script (Windows)
├── package.json             # Node.js dependencies
├── docker-compose.yml       # Docker orchestration
└── README.md                # Project documentation
```

---

## Development Workflow

### 1. Local Development
```bash
# Install dependencies
npm install

# Start development server with auto-reload
npm run dev

# Run in specific mode
MODE=wasm npm run dev
MODE=server npm run dev
```

### 2. Testing Setup
```bash
# Start server
./start.sh

# Open desktop browser
open http://localhost:3000

# Connect phone
# Scan QR code OR navigate to http://[your-ip]:3000/phone
```

### 3. Debugging

#### Browser Developer Tools
- **Desktop**: F12 → Console/Network tabs
- **Phone**: Chrome → Settings → More Tools → Remote Devices

#### WebRTC Debugging
- **Chrome**: `chrome://webrtc-internals/`
- **Firefox**: `about:webrtc`

#### Common Issues
```bash
# Port already in use
lsof -ti:3000 | xargs kill

# Clear browser cache
# Chrome: Ctrl+Shift+R
# Safari: Cmd+Option+R

# Reset WebRTC connection
# Refresh both desktop and phone browsers
```

---

## Code Architecture

### Frontend (Browser)

#### Main Application (`frontend/js/app.js`)
```javascript
class WebRTCObjectDetection {
    constructor() {
        this.socket = io();              // WebSocket connection
        this.peerConnection = null;      // WebRTC peer
        this.overlayCanvas = null;       // Detection overlay
        this.onnxSession = null;         // WASM inference
    }
    
    async initWasmInference() {
        // Initialize ONNX Runtime Web for browser-side processing
    }
    
    handleDetectionResult(result) {
        // Draw bounding boxes and update metrics
    }
}
```

#### Phone Interface (`frontend/js/phone.js`)
```javascript
class PhoneCamera {
    async startCamera() {
        // Request camera permissions
        // Setup MediaStream
        // Initialize WebRTC connection
    }
    
    captureAndSendFrame() {
        // Capture video frame
        // Resize/compress for processing
        // Send via WebRTC DataChannel
    }
}
```

### Backend (Node.js)

#### Server (`server/index.js`)
```javascript
// WebRTC signaling via Socket.IO
io.on('connection', (socket) => {
    socket.on('offer', handleOffer);
    socket.on('answer', handleAnswer);
    socket.on('video-frame', processFrame);
});

// Frame processing pipeline
async function processFrame(frameData) {
    if (MODE === 'server') {
        // Server-side inference
    } else {
        // Signal browser to process via WASM
    }
}
```

---

## Model Integration

### Adding New Models

1. **Place ONNX file in models/ directory**
```bash
cp your-model.onnx models/
```

2. **Update models/config.json**
```json
{
  "models": {
    "your-model": {
      "file": "your-model.onnx",
      "input_size": [640, 640],
      "preprocessing": {
        "mean": [0, 0, 0],
        "std": [255, 255, 255]
      }
    }
  }
}
```

3. **Modify inference code**
```javascript
// In app.js for WASM mode
const session = await ort.InferenceSession.create('models/your-model.onnx');
const results = await session.run(inputTensor);
```

### Model Requirements
- **Format**: ONNX (.onnx)
- **Input**: Single image tensor [batch, channels, height, width]
- **Output**: Detection format (boxes, scores, classes)
- **Size**: <50MB for WASM compatibility
- **Quantization**: INT8 recommended for performance

---

## Performance Optimization

### Browser Optimizations

```javascript
// Use Web Workers for heavy processing
const worker = new Worker('inference-worker.js');

// Recycle canvas objects
const canvasPool = [];
function getCanvas() {
    return canvasPool.pop() || document.createElement('canvas');
}

// Optimize WebRTC settings
const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    iceCandidatePoolSize: 0,  // Reduce signaling overhead
    bundlePolicy: 'balanced',
    rtcpMuxPolicy: 'require'
};
```

### Network Optimizations

```javascript
// Adaptive bitrate based on network conditions
peerConnection.getSenders().forEach(sender => {
    const params = sender.getParameters();
    params.encodings[0].maxBitrate = adaptiveBitrate;
    sender.setParameters(params);
});

// Monitor connection quality
setInterval(async () => {
    const stats = await peerConnection.getStats();
    const quality = calculateNetworkQuality(stats);
    adaptResolution(quality);
}, 1000);
```

---

## Benchmarking & Metrics

### Running Benchmarks
```bash
# 30-second benchmark in WASM mode
./bench/run_bench.sh --duration 30 --mode wasm

# Extended benchmark with custom output
./bench/run_bench.sh --duration 60 --output extended_metrics.json

# Windows PowerShell
.\bench\run_bench.ps1 -Duration 30 -Mode wasm
```

### Custom Metrics Collection
```javascript
// Add custom metric
metrics.customValue = calculateCustomMetric();

// Real-time monitoring
setInterval(() => {
    updateMetricsDisplay();
    logPerformanceData();
}, 1000);
```

### Metrics Visualization
```javascript
// Simple chart with Chart.js
const ctx = document.getElementById('metricsChart');
const chart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: timestamps,
        datasets: [{
            label: 'Latency (ms)',
            data: latencyData
        }]
    }
});
```

---

## Deployment Options

### Local Network
```bash
# Find your IP address
ipconfig getifaddr en0   # Mac
ip route get 1.1.1.1     # Linux
ipconfig                 # Windows

# Start with your IP
./start.sh --mode wasm
# Phone: http://[your-ip]:3000/phone
```

### Public Access (ngrok)
```bash
# Install ngrok
npm install -g ngrok
# OR download from https://ngrok.com/

# Start with ngrok
./start.sh --ngrok

# Share the ngrok URL with phone users
```

### Docker Production
```bash
# Build production image
docker build -t webrtc-detection .

# Run with Docker Compose
docker-compose -f docker-compose.server.yml up -d

# Scale for multiple users
docker-compose up --scale webrtc-detection=3
```

### Cloud Deployment
```yaml
# kubernetes.yml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: webrtc-detection
spec:
  replicas: 3
  selector:
    matchLabels:
      app: webrtc-detection
  template:
    spec:
      containers:
      - name: webrtc-detection
        image: your-registry/webrtc-detection:latest
        ports:
        - containerPort: 3000
        env:
        - name: MODE
          value: "server"
```

---

## Troubleshooting

### Common Issues

#### 1. Phone Can't Connect
```bash
# Check firewall
sudo ufw allow 3000        # Linux
# Windows: Allow port 3000 in Windows Firewall

# Check network connectivity
ping [desktop-ip]          # From phone

# Use ngrok as fallback
./start.sh --ngrok
```

#### 2. High CPU Usage
```javascript
// Reduce processing frequency
const TARGET_FPS = 10;  // Instead of 15
const FRAME_INTERVAL = 1000 / TARGET_FPS;

// Lower input resolution
const MAX_WIDTH = 320;   // Instead of 640
const MAX_HEIGHT = 240;  // Instead of 480
```

#### 3. Detection Accuracy Issues
```javascript
// Adjust confidence threshold
const CONFIDENCE_THRESHOLD = 0.3;  // Lower for more detections

// Improve preprocessing
function preprocessImage(imageData) {
    // Ensure proper normalization
    // Check color space (RGB vs BGR)
    // Verify input dimensions
}
```

#### 4. WebRTC Connection Failures
```javascript
// Add more ICE servers
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun.sipgate.net:3478' }
    ]
};

// Enable debug logging
RTCPeerConnection.prototype.originalAddIceCandidate = RTCPeerConnection.prototype.addIceCandidate;
RTCPeerConnection.prototype.addIceCandidate = function(candidate) {
    console.log('ICE Candidate:', candidate);
    return this.originalAddIceCandidate(candidate);
};
```

---

## Contributing

### Code Style
- **JavaScript**: ES6+ with async/await
- **HTML**: Semantic markup with accessibility
- **CSS**: Modern flexbox/grid layout
- **Comments**: JSDoc format for functions

### Testing
```bash
# Unit tests
npm test

# Integration tests
npm run test:integration

# Performance tests
npm run test:performance
```

### Pull Request Process
1. Fork repository
2. Create feature branch
3. Add tests for new functionality
4. Update documentation
5. Submit pull request with performance metrics

---

## Additional Resources

- **WebRTC Documentation**: [MDN WebRTC](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
- **ONNX Runtime Web**: [Microsoft Docs](https://onnxruntime.ai/docs/get-started/with-javascript.html)
- **Object Detection Models**: [ONNX Model Zoo](https://github.com/onnx/models)
- **Performance Monitoring**: [Web Vitals](https://web.dev/vitals/)

---

**Happy coding! 🚀**
