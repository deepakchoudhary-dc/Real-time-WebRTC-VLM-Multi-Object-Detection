# 🛠️ Development & Architecture Guide

## Project Structure

```
ADBrand2/
├── frontend/
│   ├── index.html           # Desktop monitoring & detection dashboard
│   ├── phone.html           # Mobile streaming & camera interface
│   └── js/
│       ├── app.js           # Desktop WebRTC client & metrics renderer
│       ├── phone.js         # Phone WebRTC stream controller
│       └── yolo-detector.js # TensorFlow.js COCO-SSD detection engine
├── server/
│   └── https_server.js      # Consolidated HTTPS signaling & static server
├── Dockerfile               # Production container image
├── docker-compose.yml       # Docker Compose service definition
├── package.json             # Minimal dependencies & scripts
├── plan.md                  # Modernization and audit specification
└── README.md                # Project overview and quick start
```

---

## Local Development Workflow

1. **Start Development Server with Live-Reload:**
   ```bash
   npm run dev
   ```
2. **Accessing Local Server:**
   - Desktop: `https://localhost:3443`
   - Mobile: `https://<YOUR-LAN-IP>:3443/phone?room=<ROOM_CODE>`

---

## Computer Vision Pipeline

Detection uses TensorFlow.js COCO-SSD (`lite_mobilenet_v2` backbone).
- **Zero Local Downloads:** Model weights are loaded directly via CDN into browser WebGL memory.
- **Normalized Coordinates:** All bounding boxes are formatted as normalized floats (`0.0` to `1.0`) relative to source dimensions.
- **80 Supported Classes:**
  `person`, `bicycle`, `car`, `motorcycle`, `airplane`, `bus`, `train`, `truck`, `boat`, `traffic light`, `fire hydrant`, `stop sign`, `parking meter`, `bench`, `bird`, `cat`, `dog`, `horse`, `sheep`, `cow`, `elephant`, `bear`, `zebra`, `giraffe`, `backpack`, `umbrella`, `handbag`, `tie`, `suitcase`, `frisbee`, `skis`, `snowboard`, `sports ball`, `kite`, `baseball bat`, `baseball glove`, `skateboard`, `surfboard`, `tennis racket`, `bottle`, `wine glass`, `cup`, `fork`, `knife`, `spoon`, `bowl`, `banana`, `apple`, `sandwich`, `orange`, `broccoli`, `carrot`, `hot dog`, `pizza`, `donut`, `cake`, `chair`, `couch`, `potted plant`, `bed`, `dining table`, `toilet`, `tv`, `laptop`, `mouse`, `remote`, `keyboard`, `cell phone`, `microwave`, `oven`, `toaster`, `sink`, `refrigerator`, `book`, `clock`, `vase`, `scissors`, `teddy bear`, `hair drier`, `toothbrush`.
