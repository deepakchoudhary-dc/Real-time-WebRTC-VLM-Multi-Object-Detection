# API Contract - Frame Detection Protocol

## Per-Frame Detection Message Format

The system uses this exact JSON message format for detection results sent from server to client via WebSocket/DataChannel:

```json
{
  "frame_id": "string_or_int",
  "capture_ts": 1690000000000,
  "recv_ts": 1690000000100,
  "inference_ts": 1690000000120,
  "detections": [
    { 
      "label": "person", 
      "score": 0.93, 
      "xmin": 0.12, 
      "ymin": 0.08, 
      "xmax": 0.34, 
      "ymax": 0.67 
    }
  ]
}
```

## Field Specifications

| Field | Type | Unit | Description |
|-------|------|------|-------------|
| `frame_id` | string/int | - | Unique identifier for frame alignment |
| `capture_ts` | number | milliseconds | Timestamp when frame was captured on phone |
| `recv_ts` | number | milliseconds | Timestamp when frame was received by server |
| `inference_ts` | number | milliseconds | Timestamp when inference completed |
| `detections` | array | - | Array of detected objects |
| `detections[].label` | string | - | Object class name (e.g., "person", "car") |
| `detections[].score` | number | 0.0-1.0 | Confidence score |
| `detections[].xmin` | number | 0.0-1.0 | Left boundary (normalized) |
| `detections[].ymin` | number | 0.0-1.0 | Top boundary (normalized) |
| `detections[].xmax` | number | 0.0-1.0 | Right boundary (normalized) |
| `detections[].ymax` | number | 0.0-1.0 | Bottom boundary (normalized) |

## Coordinate System

- **Normalized coordinates**: All bounding box coordinates are in range [0.0, 1.0]
- **Origin**: Top-left corner (0,0)
- **X-axis**: Left to right (0.0 = left edge, 1.0 = right edge)
- **Y-axis**: Top to bottom (0.0 = top edge, 1.0 = bottom edge)

## Latency Calculations

The browser uses these timestamps to compute latencies:

```javascript
// End-to-end latency (what user sees)
const e2e_latency = overlay_display_ts - capture_ts;

// Server processing latency
const server_latency = inference_ts - recv_ts;

// Network latency
const network_latency = recv_ts - capture_ts;
```

## Implementation Notes

- All timestamps use `Date.now()` (milliseconds since Unix epoch)
- Frame alignment uses `frame_id` to match overlays with correct video frames
- Coordinates are resolution-independent for cross-device compatibility
- Empty `detections` array indicates no objects found in frame
