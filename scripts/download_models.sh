#!/bin/bash

# Model download script for WebRTC Multi-Object Detection
set -e

MODELS_DIR="models"
BASE_URL="https://github.com/onnx/models/raw/main"

echo "🧠 Downloading object detection models..."

# Create models directory
mkdir -p "$MODELS_DIR"

# Download MobileNet-SSD ONNX model (lightweight for WASM)
download_mobilenet() {
    local model_file="$MODELS_DIR/mobilenet-ssd.onnx"
    
    if [ ! -f "$model_file" ]; then
        echo "📦 Downloading MobileNet-SSD..."
        
        # For now, create a placeholder file
        # In production, you would download the actual model
        cat > "$model_file.info" << EOF
{
  "name": "MobileNet-SSD",
  "description": "Lightweight object detection model",
  "input_size": [300, 300],
  "classes": ["background", "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat", "traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch", "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard", "cell phone", "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase", "scissors", "teddy bear", "hair drier", "toothbrush"],
  "format": "ONNX",
  "quantized": true
}
EOF
        
        echo "ℹ️  Model info saved. In production, download actual ONNX model."
        echo "✅ MobileNet-SSD placeholder created"
    else
        echo "✅ MobileNet-SSD already exists"
    fi
}

# Download YOLOv5n (nano) - ultra lightweight
download_yolov5n() {
    local model_file="$MODELS_DIR/yolov5n.onnx"
    
    if [ ! -f "$model_file" ]; then
        echo "📦 Downloading YOLOv5n..."
        
        cat > "$model_file.info" << EOF
{
  "name": "YOLOv5n",
  "description": "Ultra-lightweight YOLO model",
  "input_size": [640, 640],
  "classes": ["person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat", "traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch", "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard", "cell phone", "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase", "scissors", "teddy bear", "hair drier", "toothbrush"],
  "format": "ONNX",
  "quantized": true,
  "size_mb": 3.9
}
EOF
        
        echo "✅ YOLOv5n placeholder created"
    else
        echo "✅ YOLOv5n already exists"
    fi
}

# Create model configuration
create_model_config() {
    cat > "$MODELS_DIR/config.json" << EOF
{
  "default_model": "mobilenet-ssd",
  "models": {
    "mobilenet-ssd": {
      "file": "mobilenet-ssd.onnx",
      "input_size": [300, 300],
      "preprocessing": {
        "mean": [127.5, 127.5, 127.5],
        "std": [127.5, 127.5, 127.5],
        "format": "RGB"
      },
      "postprocessing": {
        "confidence_threshold": 0.5,
        "nms_threshold": 0.4
      }
    },
    "yolov5n": {
      "file": "yolov5n.onnx", 
      "input_size": [640, 640],
      "preprocessing": {
        "mean": [0, 0, 0],
        "std": [255, 255, 255],
        "format": "RGB"
      },
      "postprocessing": {
        "confidence_threshold": 0.25,
        "nms_threshold": 0.45
      }
    }
  }
}
EOF
    echo "✅ Model configuration created"
}

# Create README for models
create_models_readme() {
    cat > "$MODELS_DIR/README.md" << EOF
# Object Detection Models

This directory contains the ONNX models used for real-time object detection.

## Available Models

### MobileNet-SSD
- **File**: mobilenet-ssd.onnx
- **Size**: ~27MB
- **Input**: 300x300 RGB
- **Classes**: 80 COCO classes
- **Best for**: WASM mode, low-resource environments

### YOLOv5n (Nano)
- **File**: yolov5n.onnx  
- **Size**: ~3.9MB
- **Input**: 640x640 RGB
- **Classes**: 80 COCO classes
- **Best for**: Ultra-low resource, mobile

## Model Download

In production, models would be downloaded from:

- **MobileNet-SSD**: [ONNX Model Zoo](https://github.com/onnx/models/tree/main/vision/object_detection_segmentation/ssd-mobilenetv1)
- **YOLOv5n**: [Ultralytics](https://github.com/ultralytics/yolov5/releases)

For this demo, placeholder files are created to show the structure.

## Usage

Models are automatically loaded based on the configuration in \`config.json\`.
The default model is MobileNet-SSD for optimal WASM performance.

## Custom Models

To add your own model:

1. Place the ONNX file in this directory
2. Update \`config.json\` with model details
3. Restart the application

Ensure your model:
- Is in ONNX format
- Has a single input (image tensor)
- Outputs detection results (boxes, scores, classes)
- Is quantized for WASM compatibility (optional but recommended)
EOF
    echo "✅ Models README created"
}

# Main execution
main() {
    download_mobilenet
    download_yolov5n
    create_model_config
    create_models_readme
    
    echo ""
    echo "🎯 Model setup complete!"
    echo "📁 Models directory: $MODELS_DIR"
    echo "📝 Configuration: $MODELS_DIR/config.json"
    echo ""
    echo "Note: In production, replace placeholder files with actual ONNX models"
}

main "$@"
