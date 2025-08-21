#!/bin/bash

# Real-time WebRTC Multi-Object Detection Startup Script
set -e

# Default configuration
MODE=${MODE:-wasm}
PORT=${PORT:-3000}
USE_NGROK=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --ngrok)
      USE_NGROK=true
      shift
      ;;
    --mode)
      MODE="$2"
      shift 2
      ;;
    --port)
      PORT="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [OPTIONS]"
      echo "Options:"
      echo "  --mode [wasm|server]  Processing mode (default: wasm)"
      echo "  --port PORT          Server port (default: 3000)"
      echo "  --ngrok              Use ngrok for phone connectivity"
      echo "  -h, --help           Show this help"
      exit 0
      ;;
    *)
      echo "Unknown option $1"
      exit 1
      ;;
  esac
done

echo "🚀 Starting WebRTC Multi-Object Detection"
echo "Mode: $MODE"
echo "Port: $PORT"
echo "Ngrok: $USE_NGROK"

# Check dependencies
check_deps() {
    local missing=()
    
    if ! command -v node &> /dev/null; then
        missing+=("node")
    fi
    
    if ! command -v npm &> /dev/null; then
        missing+=("npm")
    fi
    
    if [[ ${#missing[@]} -gt 0 ]]; then
        echo "❌ Missing dependencies: ${missing[*]}"
        echo "Please install Node.js and npm"
        exit 1
    fi
}

# Install dependencies if needed
install_deps() {
    if [ ! -d "node_modules" ]; then
        echo "📦 Installing dependencies..."
        npm install
    fi
    
    if [ ! -d "models" ]; then
        echo "🧠 Downloading models..."
        ./scripts/download_models.sh
    fi
}

# Start ngrok if requested
start_ngrok() {
    if [ "$USE_NGROK" = true ]; then
        if ! command -v ngrok &> /dev/null; then
            echo "❌ ngrok not found. Please install from https://ngrok.com/"
            exit 1
        fi
        
        echo "🌐 Starting ngrok tunnel..."
        ngrok http $PORT --log=stdout > ngrok.log 2>&1 &
        NGROK_PID=$!
        
        # Wait for ngrok to start and get URL
        sleep 3
        NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[0].public_url' 2>/dev/null || echo "")
        
        if [ -n "$NGROK_URL" ]; then
            echo "📱 Phone URL: $NGROK_URL"
        else
            echo "⚠️  Could not get ngrok URL, check ngrok.log"
        fi
    fi
}

# Cleanup function
cleanup() {
    echo "🧹 Cleaning up..."
    if [ -n "$NGROK_PID" ]; then
        kill $NGROK_PID 2>/dev/null || true
    fi
    if [ -n "$SERVER_PID" ]; then
        kill $SERVER_PID 2>/dev/null || true
    fi
}

# Set trap for cleanup
trap cleanup EXIT

# Main execution
main() {
    check_deps
    install_deps
    start_ngrok
    
    echo "🎯 Starting server in $MODE mode..."
    
    # Set environment variables
    export MODE=$MODE
    export PORT=$PORT
    export NODE_ENV=production
    
    # Start the server
    if [ "$MODE" = "server" ]; then
        npm run start:server &
    else
        npm run start:wasm &
    fi
    
    SERVER_PID=$!
    
    # Wait a moment for server to start
    sleep 2
    
    # Open browser
    if command -v xdg-open &> /dev/null; then
        xdg-open "http://localhost:$PORT"
    elif command -v open &> /dev/null; then
        open "http://localhost:$PORT"
    elif command -v start &> /dev/null; then
        start "http://localhost:$PORT"
    else
        echo "🌐 Open http://localhost:$PORT in your browser"
    fi
    
    echo "✅ Server running! Press Ctrl+C to stop"
    
    # Wait for server process
    wait $SERVER_PID
}

main "$@"
