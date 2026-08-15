# 🛠️ Developer & Architecture Guide

## Project Structure

```
ADBrand2/
├── frontend/
│   ├── index.html           # Desktop hub interface (semantic HTML, accessible)
│   ├── phone.html           # Mobile camera interface (touch-optimized HUD)
│   └── js/
│       ├── core/
│       │   └── common.js    # Shared utilities (objectFitRect, IceCandidateQueue, PerfectNegotiator)
│       ├── detector.js      # TensorFlow.js COCO-SSD detection engine
│       ├── app.js           # Desktop WebRTC client & metrics renderer
│       └── phone.js         # Mobile WebRTC streaming controller
├── server/
│   ├── config.js            # Environment config with built-in .env parser
│   ├── logger.js            # Structured logger with data redaction
│   ├── tls.js               # Dynamic TLS cert generator with Subject Alternative Names (SANs)
│   ├── security.js          # Security headers, origin checks, CSP, CSRF
│   ├── rate-limiter.js      # HTTP & per-socket event token bucket limiter
│   ├── metrics.js           # Bounded ring-buffer metrics store
│   ├── room-store.js        # Token-authenticated room registry with TTL/GC
│   ├── signaling.js         # WebRTC signaling, offer buffering, point-to-peer relay
│   ├── routes.js            # HTTP endpoints (/api/qr, /api/metrics, /health, etc.)
│   ├── http-redirect.js     # HTTP to HTTPS redirection
│   ├── app.js               # Express application factory
│   └── index.js             # Main server entrypoint
├── test/
│   ├── unit/                # Unit tests (room-store, metrics, rate-limiter, security, config)
│   ├── integration/         # Integration tests (routes, signaling)
│   └── run-all.js           # Cross-platform test suite runner
├── .github/workflows/ci.yml # GitHub Actions CI workflow
├── Dockerfile               # Production multi-stage container image
├── docker-compose.yml       # Hardened container orchestration definition
├── package.json             # Manifest with scripts and engines
└── plan.md                  # Master architectural specification
```

---

## Local Development Workflow

1. **Start Development Server with Live-Reload:**
   ```bash
   npm run dev
   ```
2. **Accessing the Hub:**
   - Desktop Hub: `https://localhost:3443`
   - Mobile Camera: `https://<YOUR-LAN-IP>:3443/phone?room=<ROOM_CODE>&token=<TOKEN>`
3. **Run Automated Test Suite:**
   ```bash
   npm test
   ```

---

## Computer Vision Pipeline

Detection uses TensorFlow.js COCO-SSD (`lite_mobilenet_v2` backbone).
- **Client-Side WebGL Inference:** Model inference runs directly inside browser GPU memory.
- **Normalized Coordinates:** All bounding boxes are formatted as normalized floats (`0.0` to `1.0`) relative to video dimensions.
- **Letterbox/Pillarbox Compensation:** The `objectFitRect` utility computes the exact rendered video sub-rectangle to prevent coordinate misalignment on different screen ratios.
- **80 Supported Classes:**
  `person`, `bicycle`, `car`, `motorcycle`, `airplane`, `bus`, `train`, `truck`, `boat`, `traffic light`, `fire hydrant`, `stop sign`, `parking meter`, `bench`, `bird`, `cat`, `dog`, `horse`, `sheep`, `cow`, `elephant`, `bear`, `zebra`, `giraffe`, `backpack`, `umbrella`, `handbag`, `tie`, `suitcase`, `frisbee`, `skis`, `snowboard`, `sports ball`, `kite`, `baseball bat`, `baseball glove`, `skateboard`, `surfboard`, `tennis racket`, `bottle`, `wine glass`, `cup`, `fork`, `knife`, `spoon`, `bowl`, `banana`, `apple`, `sandwich`, `orange`, `broccoli`, `carrot`, `hot dog`, `pizza`, `donut`, `cake`, `chair`, `couch`, `potted plant`, `bed`, `dining table`, `toilet`, `tv`, `laptop`, `mouse`, `remote`, `keyboard`, `cell phone`, `microwave`, `oven`, `toaster`, `sink`, `refrigerator`, `book`, `clock`, `vase`, `scissors`, `teddy bear`, `hair drier`, `toothbrush`.
