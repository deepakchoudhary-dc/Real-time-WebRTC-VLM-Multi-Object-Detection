# 📱🖥️ Real-Time WebRTC Object Detection

A privacy-focused, real-time object detection system using WebRTC to stream camera feed from mobile devices to desktop browsers for AI processing.

## 🎯 **Features**

- **📱 Mobile Camera Streaming**: Use your phone as a wireless camera
- **🖥️ Desktop Processing**: Real-time object detection in browser
- **🔒 Privacy-First**: All processing happens locally on your network
- **🚀 WebRTC Technology**: Low-latency peer-to-peer video streaming
- **🧠 AI-Powered**: Browser-based ONNX model inference
- **📊 Performance Metrics**: Live FPS and latency monitoring

## 🚀 **Quick Start**

### Prerequisites
- **Node.js** 16+ ([Download](https://nodejs.org/))
- **Modern Browser** (Chrome, Firefox, Safari)
- **Mobile Device** with camera

### Installation
```bash
# Clone the repository
git clone https://github.com/deepakchoudhary-dc/Real-time-WebRTC-VLM-Multi-Object-Detection.git
cd Real-time-WebRTC-VLM-Multi-Object-Detection

# Install dependencies
npm install

# Download AI models
./scripts/download_models.sh

# Start the server (HTTPS for phone compatibility)
npm start
```

### Usage
1. **Desktop**: Open https://localhost:3443 in your browser (accept security warning)
2. **Mobile**: Scan the QR code or visit https://[your-ip]:3443/phone
3. **Detection**: Point your phone camera at objects to see live detection

## 🔧 **Mode Switch**

### WASM Mode (Low-Resource, Default)
```bash
MODE=wasm npm start
```
- Browser-based inference using ONNX Runtime Web
- Supports modest laptops (Intel i5, 8GB RAM)
- Input: 320×240, Target: 10-15 FPS
- CPU usage: ~40-60% on Intel i5

### Server Mode (Higher Performance)  
```bash
MODE=server npm start
```
- Server-side inference with full-resolution support
- Requires dedicated server or powerful laptop

## 📈 **Benchmarking**

Run official benchmark for 30 seconds:

```bash
# Ensure server is running
npm start

# In another terminal, run benchmark  
./bench/run_bench.sh --duration 30 --mode wasm

# View results
cat metrics.json
```

**Expected Performance (WASM Mode on Intel i5, 8GB RAM):**
- Median E2E Latency: 125ms
- P95 E2E Latency: 198ms
- Processing FPS: 12.3
- CPU Usage: ~45%

## 🔒 **Privacy & Security**

✅ **100% Local Processing** - No cloud services or external APIs  
✅ **No Data Storage** - Video streams are processed in real-time only  
✅ **Network Isolation** - Works entirely on your local network  
✅ **Open Source** - Full transparency, no hidden tracking  

## 🛠️ **Technology Stack**

- **Frontend**: Vanilla JavaScript, WebRTC, ONNX.js
- **Backend**: Node.js, Socket.IO, Express
- **AI Models**: MobileNet-SSD, YOLOv5n (ONNX format)
- **Protocols**: HTTPS, WebRTC, Socket.IO

## 📁 **Project Structure**

```
├── frontend/           # Client-side code
│   ├── js/            # JavaScript modules
│   ├── index.html     # Desktop interface
│   └── phone.html     # Mobile interface
├── server/            # Server-side code
├── models/            # AI models (downloaded separately)
├── scripts/           # Setup and utility scripts
└── docs/              # Documentation
```

## 🔧 **Configuration**

### Server Modes
- **WASM Mode** (default): Client-side inference
- **Server Mode**: Server-side processing

### Environment Variables
```bash
PORT=3000              # Server port
MODE=wasm              # Processing mode (wasm/server)
```

## 📈 **Performance**

- **Latency**: <200ms end-to-end
- **Frame Rate**: 10-15 FPS
- **Resolution**: 320×240 optimized for speed
- **Models**: Lightweight ONNX models for browser compatibility

## 🤝 **Contributing**

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 **License**

This project is open source and available under the [MIT License](LICENSE).

## 🆘 **Support**

- **Issues**: Report bugs or request features via GitHub Issues
- **Documentation**: See `/docs` folder for detailed documentation
- **Community**: Join discussions in GitHub Discussions

---

**⭐ Star this project if you find it useful!**
