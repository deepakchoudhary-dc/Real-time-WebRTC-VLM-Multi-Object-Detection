# 📱🎯 Real-Time WebRTC Multi-Object Detection

A privacy-first, real-time computer vision system that streams a mobile camera feed to a desktop browser over **WebRTC** and performs **genuine multi-object detection** using **TensorFlow.js & COCO-SSD** with WebGL GPU acceleration.

---

## ✨ Features

- 📱 **Wireless Mobile Camera Stream:** Transform any phone into a high-frame-rate wireless camera stream via P2P WebRTC.
- 🧠 **Real On-Device AI Detection:** Powered by TensorFlow.js COCO-SSD (detects 80 real COCO classes: person, car, phone, bottle, laptop, chair, etc.).
- 🔒 **Privacy-First & Secure:**
  - Dynamic in-memory self-signed TLS certificates (no hardcoded secrets).
  - Secure room-based signaling isolation (devices pair securely via 4-character Room codes).
  - WebRTC video is processed locally in the client browser with GPU acceleration.
- ⚡ **Zero Local Heavy Downloads:** TensorFlow.js and COCO-SSD load directly via CDN into browser WebGL cache.
- 📊 **Real-time Performance Metrics:** Live measurement of latency, processing FPS, object counts, and interactive latency charts.
- 🐳 **Container Ready:** Clean Docker and Docker Compose configuration.

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js** 16+ ([Download](https://nodejs.org/))
- **Modern Web Browser** (Chrome, Edge, Safari, Firefox) with WebGL enabled
- **Mobile Device** with a camera on the same Wi-Fi / Local Network

### 2. Installation
```bash
# Clone the repository
git clone https://github.com/deepakchoudhary-dc/Real-time-WebRTC-VLM-Multi-Object-Detection.git
cd Real-time-WebRTC-VLM-Multi-Object-Detection

# Install lightweight dependencies
npm install

# Start the secure HTTPS server
npm start
```

### 3. Connect & Detect
1. **Desktop:** Open `https://localhost:3443` in your browser.
   - *Note:* Accept the self-signed certificate warning (standard for local HTTPS).
2. **Mobile:** Scan the generated QR code or open `https://<YOUR-LOCAL-IP>:3443/phone?room=<ROOM_CODE>`.
3. **Detection:** Tap **"Start Camera"** on your phone. Real-time bounding boxes and labels will track objects on both mobile and desktop screens!

---

## 🛠️ Architecture & Technology Stack

```
[ Mobile Browser (Phone) ]
       │  ▲
WebRTC │  │ Socket.IO Signaling (Room-Isolated)
Video  │  │ & Detection Relay
       ▼  │
[ Desktop Browser / Client ]  ◄── [ HTTPS / Express Backend ]
       │
   WebGL / TF.js COCO-SSD
  (Real-Time Inference Overlay)
```

- **Frontend:** Modern Vanilla JavaScript (ES6+), HTML5 Canvas API, WebGL.
- **Computer Vision:** TensorFlow.js (`@tensorflow/tfjs`) + COCO-SSD (`@tensorflow-models/coco-ssd`).
- **Backend & Signaling:** Node.js, Express, Socket.IO, `selfsigned`.
- **Security:** Room-scoped WebRTC signaling, in-memory dynamic TLS, Content Security Policy, rate limiting, payload validation.

---

## 🔒 Cybersecurity & Hardening

- **Dynamic Ephemeral Certificates:** Generated at boot time using `selfsigned`; zero private keys stored in the git repository.
- **Room-Isolated Signaling:** Prevents cross-session eavesdropping and signaling collision by strictly scoping SDP offers/answers to unique room IDs.
- **Socket.IO Hardening:** Message size limits (1MB cap) and payload schema validation on all incoming socket events.
- **XSS Prevention:** Safe DOM manipulation with no raw HTML injection.
- **Memory Safety:** Metrics ring buffer (capped at 1,000 entries) preventing server memory leaks.

---

## 🐳 Docker Deployment

Run with Docker Compose in one command:

```bash
docker-compose up --build
```
Access at `https://localhost:3443` (HTTP redirects automatically from `http://localhost:3000`).

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
