# Backpressure & Performance Policy

## Frame Dropping Strategy

### Queue Management
- **Fixed-length queue**: Maximum 3 frames in processing pipeline
- **Drop-old policy**: When queue is full, discard oldest unprocessed frames
- **Latest-frame priority**: Always process the most recent frame to minimize latency

### Implementation
```javascript
// Frame queue with size limit
const FRAME_QUEUE_SIZE = 3;
const frameQueue = [];

function processFrame(newFrame) {
    // Add new frame
    frameQueue.push(newFrame);
    
    // Drop old frames if queue exceeded
    while (frameQueue.length > FRAME_QUEUE_SIZE) {
        const droppedFrame = frameQueue.shift();
        console.log(`Dropped frame ${droppedFrame.frame_id} due to backpressure`);
    }
    
    // Process latest frame
    const currentFrame = frameQueue.pop();
    return performInference(currentFrame);
}
```

## Adaptive Frame Rate

### Target Performance
- **WASM Mode**: 10-15 FPS processing
- **Server Mode**: 15-20 FPS processing
- **Input Resolution**: 320×240 default for performance

### Load Detection
```javascript
// Monitor processing latency
const LATENCY_THRESHOLD_MS = 200;
let currentFPS = 15;

function adaptFrameRate(latency) {
    if (latency > LATENCY_THRESHOLD_MS) {
        // Reduce frame rate under load
        currentFPS = Math.max(8, currentFPS - 2);
    } else if (latency < 100) {
        // Increase frame rate when resources available
        currentFPS = Math.min(20, currentFPS + 1);
    }
}
```

## Resource Management

### Memory Limits
- **Frame buffer**: 50MB maximum
- **Model cache**: 100MB for ONNX models
- **Automatic cleanup**: Clear buffers every 1000 frames

### CPU Throttling
- **WASM Mode**: Single-threaded, non-blocking
- **Server Mode**: Worker pool with CPU core detection
- **Graceful degradation**: Reduce resolution under high CPU load

## Error Handling

### Network Issues
- **Reconnection**: Automatic WebRTC reconnection with exponential backoff
- **Fallback**: Switch to server mode if WASM fails
- **Timeout**: 5-second inference timeout with frame skip

### Performance Monitoring
```javascript
// Real-time performance tracking
const performanceMetrics = {
    droppedFrames: 0,
    avgLatency: 0,
    cpuUsage: 0,
    memoryUsage: 0
};

// Automatic mode switching
if (performanceMetrics.avgLatency > 300) {
    console.log("Switching to server mode due to high latency");
    switchToServerMode();
}
```

This policy ensures smooth real-time performance even on modest hardware by prioritizing recent frames and gracefully degrading under load.
