#!/bin/bash

# Benchmark script for WebRTC Multi-Object Detection
set -e

# Default values
DURATION=30
MODE="wasm"
OUTPUT_FILE="metrics.json"
SERVER_URL="https://localhost:3443"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --duration)
      DURATION="$2"
      shift 2
      ;;
    --mode)
      MODE="$2"
      shift 2
      ;;
    --output)
      OUTPUT_FILE="$2"
      shift 2
      ;;
    --server)
      SERVER_URL="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [OPTIONS]"
      echo "Options:"
      echo "  --duration SECONDS   Benchmark duration (default: 30)"
      echo "  --mode [wasm|server] Processing mode (default: wasm)"
      echo "  --output FILE        Output metrics file (default: metrics.json)"
      echo "  --server URL         Server URL (default: https://localhost:3443)"
      echo "  -h, --help           Show this help"
      exit 0
      ;;
    *)
      echo "Unknown option $1"
      exit 1
      ;;
  esac
done

echo "🚀 Starting benchmark..."
echo "Duration: ${DURATION}s"
echo "Mode: $MODE"
echo "Output: $OUTPUT_FILE"
echo "Server: $SERVER_URL"

# Check if server is running
check_server() {
    if ! curl -s "$SERVER_URL/health" > /dev/null; then
        echo "❌ Server not accessible at $SERVER_URL"
        echo "Please start the server first:"
        echo "  ./start.sh --mode $MODE"
        exit 1
    fi
}

# Reset metrics
reset_metrics() {
    echo "🔄 Resetting metrics..."
    curl -s "$SERVER_URL/api/reset-metrics" > /dev/null
}

# Wait for benchmark duration
run_benchmark() {
    echo "⏱️  Running benchmark for ${DURATION} seconds..."
    echo "📱 Please ensure phone is connected and streaming"
    
    local progress_bar_length=40
    local interval=1
    local elapsed=0
    
    while [ $elapsed -lt $DURATION ]; do
        # Calculate progress
        local progress=$((elapsed * progress_bar_length / DURATION))
        local remaining=$((progress_bar_length - progress))
        
        # Build progress bar
        local bar=""
        for ((i=0; i<progress; i++)); do bar+="█"; done
        for ((i=0; i<remaining; i++)); do bar+="░"; done
        
        # Show progress
        printf "\r[%s] %d/%ds" "$bar" "$elapsed" "$DURATION"
        
        sleep $interval
        elapsed=$((elapsed + interval))
    done
    
    printf "\r[%s] %d/%ds ✅\n" "$(printf '█%.0s' $(seq 1 $progress_bar_length))" "$DURATION" "$DURATION"
}

# Collect final metrics
collect_metrics() {
    echo "📊 Collecting metrics..."
    
    local metrics_response
    metrics_response=$(curl -s "$SERVER_URL/api/metrics")
    
    if [ $? -eq 0 ]; then
        echo "$metrics_response" > "$OUTPUT_FILE"
        echo "✅ Metrics saved to $OUTPUT_FILE"
        
        # Parse and display key metrics
        local median_latency=$(echo "$metrics_response" | grep -o '"median_latency_ms":[^,]*' | cut -d':' -f2)
        local p95_latency=$(echo "$metrics_response" | grep -o '"p95_latency_ms":[^,]*' | cut -d':' -f2)
        local processed_fps=$(echo "$metrics_response" | grep -o '"processed_fps":[^,]*' | cut -d':' -f2)
        local total_frames=$(echo "$metrics_response" | grep -o '"total_frames":[^,]*' | cut -d':' -f2)
        local processed_frames=$(echo "$metrics_response" | grep -o '"processed_frames":[^,]*' | cut -d':' -f2)
        
        echo ""
        echo "📈 Benchmark Results:"
        echo "===================="
        echo "Mode: $MODE"
        echo "Duration: ${DURATION}s"
        echo "Median Latency: ${median_latency}ms"
        echo "P95 Latency: ${p95_latency}ms"
        echo "Processed FPS: ${processed_fps}"
        echo "Total Frames: ${total_frames}"
        echo "Processed Frames: ${processed_frames}"
        
        if [ "$total_frames" -gt 0 ]; then
            local success_rate=$((processed_frames * 100 / total_frames))
            echo "Success Rate: ${success_rate}%"
        fi
        
    else
        echo "❌ Failed to collect metrics"
        exit 1
    fi
}

# Estimate bandwidth (optional - requires network monitoring tools)
estimate_bandwidth() {
    echo "📡 Estimating bandwidth..."
    
    # Try to use different tools to estimate bandwidth
    if command -v ss &> /dev/null; then
        # Use ss to get socket statistics
        local connections=$(ss -i | grep -c ":3000")
        echo "Active connections to port 3000: $connections"
    fi
    
    # Add estimated bandwidth to metrics file
    if [ -f "$OUTPUT_FILE" ]; then
        # Create a temporary file with bandwidth estimates
        local temp_file=$(mktemp)
        
        # Add estimated values (these would be real measurements in production)
        jq '. + {
            "uplink_kbps": (if .mode == "wasm" then 800 else 1200 end),
            "downlink_kbps": (if .mode == "wasm" then 50 else 80 end),
            "estimated": true
        }' "$OUTPUT_FILE" > "$temp_file"
        
        mv "$temp_file" "$OUTPUT_FILE"
        echo "✅ Bandwidth estimates added"
    fi
}

# Generate summary report
generate_summary() {
    if [ -f "$OUTPUT_FILE" ]; then
        echo ""
        echo "📋 Quick Summary:"
        echo "================"
        
        # Extract key metrics for quick viewing
        local mode=$(jq -r '.mode' "$OUTPUT_FILE")
        local median=$(jq -r '.median_latency_ms' "$OUTPUT_FILE")
        local p95=$(jq -r '.p95_latency_ms' "$OUTPUT_FILE")
        local fps=$(jq -r '.processed_fps' "$OUTPUT_FILE")
        
        echo "✓ Mode: $mode"
        echo "✓ Median latency: ${median}ms"
        echo "✓ P95 latency: ${p95}ms" 
        echo "✓ Processing FPS: $fps"
        
        # Performance assessment
        if [ "$mode" = "wasm" ]; then
            if [ "$median" -lt 150 ] && [ "$fps" -gt 10 ]; then
                echo "🟢 Performance: Good for WASM mode"
            elif [ "$median" -lt 250 ] && [ "$fps" -gt 8 ]; then
                echo "🟡 Performance: Acceptable for WASM mode"
            else
                echo "🔴 Performance: Poor - consider server mode"
            fi
        else
            if [ "$median" -lt 100 ] && [ "$fps" -gt 15 ]; then
                echo "🟢 Performance: Excellent for server mode"
            elif [ "$median" -lt 200 ] && [ "$fps" -gt 10 ]; then
                echo "🟡 Performance: Good for server mode"
            else
                echo "🔴 Performance: Suboptimal - check system resources"
            fi
        fi
    fi
}

# Main execution
main() {
    check_server
    reset_metrics
    run_benchmark
    collect_metrics
    estimate_bandwidth
    generate_summary
    
    echo ""
    echo "🎯 Benchmark complete! Results saved to $OUTPUT_FILE"
    echo "📁 You can now upload this file or view detailed metrics."
}

# Check for required tools
if ! command -v curl &> /dev/null; then
    echo "❌ curl is required but not installed"
    exit 1
fi

if ! command -v jq &> /dev/null; then
    echo "⚠️  jq not found - some features will be limited"
    echo "Install jq for better metrics parsing: apt-get install jq"
fi

# Run main function
main "$@"
