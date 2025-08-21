#!/bin/bash

# Advanced benchmarking script with comprehensive metrics
set -e

DURATION=30
MODE="wasm"
OUTPUT_FILE="metrics.json"
SERVER_URL="http://localhost:3000"
SAMPLES=100
DETAILED=false

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
    --samples)
      SAMPLES="$2"
      shift 2
      ;;
    --detailed)
      DETAILED=true
      shift
      ;;
    --output)
      OUTPUT_FILE="$2"
      shift 2
      ;;
    *)
      echo "Unknown option $1"
      exit 1
      ;;
  esac
done

echo "🚀 Advanced Benchmark Starting..."
echo "Duration: ${DURATION}s | Mode: $MODE | Samples: $SAMPLES"

# Enhanced metrics collection
collect_system_metrics() {
    local output_file="$1"
    
    # CPU and Memory monitoring
    echo "📊 Collecting system performance..."
    
    # Get CPU info
    local cpu_info=""
    if command -v lscpu &> /dev/null; then
        cpu_info=$(lscpu | grep "Model name" | cut -d':' -f2 | xargs)
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        cpu_info=$(sysctl -n machdep.cpu.brand_string)
    fi
    
    # Get memory info
    local memory_info=""
    if command -v free &> /dev/null; then
        memory_info=$(free -h | grep "Mem:" | awk '{print $2}')
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        memory_info=$(echo "$(sysctl -n hw.memsize) / 1024 / 1024 / 1024" | bc)GB
    fi
    
    # Monitor CPU usage during test
    local cpu_samples=()
    local memory_samples=()
    
    for i in $(seq 1 $SAMPLES); do
        if command -v top &> /dev/null; then
            local cpu_usage=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1)
            cpu_samples+=($cpu_usage)
        fi
        
        sleep $(echo "$DURATION / $SAMPLES" | bc -l)
    done
    
    # Calculate averages
    local avg_cpu=0
    if [ ${#cpu_samples[@]} -gt 0 ]; then
        local sum=0
        for cpu in "${cpu_samples[@]}"; do
            sum=$(echo "$sum + $cpu" | bc -l)
        done
        avg_cpu=$(echo "scale=1; $sum / ${#cpu_samples[@]}" | bc -l)
    fi
    
    # Add to metrics file
    if [ -f "$output_file" ]; then
        local temp_file=$(mktemp)
        jq --arg cpu "$cpu_info" --arg mem "$memory_info" --argjson avg_cpu "$avg_cpu" \
           '. + {
             "system_info": {
               "cpu": $cpu,
               "memory": $mem,
               "avg_cpu_usage": $avg_cpu,
               "os": $OSTYPE
             }
           }' "$output_file" > "$temp_file"
        mv "$temp_file" "$output_file"
    fi
}

# Network quality assessment
assess_network_quality() {
    local output_file="$1"
    
    echo "🌐 Assessing network quality..."
    
    # Ping test for latency
    local ping_results=()
    for i in {1..10}; do
        if command -v ping &> /dev/null; then
            local ping_time=$(ping -c 1 8.8.8.8 | grep "time=" | cut -d'=' -f4 | cut -d' ' -f1)
            if [[ $ping_time =~ ^[0-9.]+$ ]]; then
                ping_results+=($ping_time)
            fi
        fi
    done
    
    # Calculate network metrics
    local avg_ping=0
    if [ ${#ping_results[@]} -gt 0 ]; then
        local sum=0
        for ping in "${ping_results[@]}"; do
            sum=$(echo "$sum + $ping" | bc -l)
        done
        avg_ping=$(echo "scale=1; $sum / ${#ping_results[@]}" | bc -l)
    fi
    
    # Add to metrics
    if [ -f "$output_file" ]; then
        local temp_file=$(mktemp)
        jq --argjson ping "$avg_ping" \
           '. + {
             "network_quality": {
               "avg_ping_ms": $ping,
               "samples": '"${#ping_results[@]}"'
             }
           }' "$output_file" > "$temp_file"
        mv "$temp_file" "$output_file"
    fi
}

# Performance analysis
analyze_performance() {
    local output_file="$1"
    
    if [ ! -f "$output_file" ]; then
        echo "❌ Metrics file not found"
        return 1
    fi
    
    echo ""
    echo "📈 Performance Analysis:"
    echo "======================="
    
    local mode=$(jq -r '.mode' "$output_file")
    local median=$(jq -r '.median_latency_ms' "$output_file")
    local p95=$(jq -r '.p95_latency_ms' "$output_file")
    local fps=$(jq -r '.processed_fps' "$output_file")
    local success_rate=$(jq -r '.success_rate // 0' "$output_file")
    
    # Performance grading
    local grade="F"
    local grade_color="\033[0;31m"  # Red
    
    if [[ "$mode" == "wasm" ]]; then
        if (( $(echo "$median < 120" | bc -l) )) && (( $(echo "$fps > 10" | bc -l) )); then
            grade="A"
            grade_color="\033[0;32m"  # Green
        elif (( $(echo "$median < 180" | bc -l) )) && (( $(echo "$fps > 8" | bc -l) )); then
            grade="B"
            grade_color="\033[0;33m"  # Yellow
        elif (( $(echo "$median < 250" | bc -l) )) && (( $(echo "$fps > 6" | bc -l) )); then
            grade="C"
            grade_color="\033[0;35m"  # Magenta
        fi
    else
        if (( $(echo "$median < 80" | bc -l) )) && (( $(echo "$fps > 20" | bc -l) )); then
            grade="A"
            grade_color="\033[0;32m"
        elif (( $(echo "$median < 120" | bc -l) )) && (( $(echo "$fps > 15" | bc -l) )); then
            grade="B"
            grade_color="\033[0;33m"
        elif (( $(echo "$median < 180" | bc -l) )) && (( $(echo "$fps > 10" | bc -l) )); then
            grade="C"
            grade_color="\033[0;35m"
        fi
    fi
    
    echo -e "Performance Grade: ${grade_color}${grade}\033[0m"
    echo "Mode: $mode"
    echo "Median Latency: ${median}ms"
    echo "P95 Latency: ${p95}ms"
    echo "Processing FPS: $fps"
    echo "Success Rate: ${success_rate}%"
    
    # Recommendations
    echo ""
    echo "🎯 Recommendations:"
    case $grade in
        "A")
            echo "✅ Excellent performance! Consider enabling higher resolution or additional features."
            ;;
        "B")
            echo "🟡 Good performance. Consider optimizing preprocessing or reducing input resolution."
            ;;
        "C")
            echo "🟠 Acceptable performance. Recommend switching to lighter model or server mode."
            ;;
        "F")
            echo "🔴 Poor performance. Check system resources, network quality, or switch modes."
            ;;
    esac
}

# Generate detailed report
generate_report() {
    local output_file="$1"
    local report_file="${output_file%.json}_report.md"
    
    echo "📋 Generating detailed report..."
    
    cat > "$report_file" << EOF
# Performance Benchmark Report

**Generated**: $(date)
**Duration**: ${DURATION} seconds
**Mode**: $MODE

## Summary Metrics

$(jq -r '
"- **Median Latency**: " + (.median_latency_ms | tostring) + "ms" + "\n" +
"- **P95 Latency**: " + (.p95_latency_ms | tostring) + "ms" + "\n" +
"- **Processed FPS**: " + (.processed_fps | tostring) + "\n" +
"- **Success Rate**: " + ((.success_rate // 0) | tostring) + "%" + "\n" +
"- **Total Frames**: " + (.total_frames | tostring) + "\n" +
"- **Processed Frames**: " + (.processed_frames | tostring)
' "$output_file")

## System Information

$(jq -r '
if .system_info then
"- **CPU**: " + .system_info.cpu + "\n" +
"- **Memory**: " + .system_info.memory + "\n" +
"- **Avg CPU Usage**: " + (.system_info.avg_cpu_usage | tostring) + "%"
else
"System information not available"
end
' "$output_file")

## Network Quality

$(jq -r '
if .network_quality then
"- **Average Ping**: " + (.network_quality.avg_ping_ms | tostring) + "ms"
else
"Network quality not assessed"
end
' "$output_file")

## Performance Breakdown

\`\`\`json
$(jq '.performance_breakdown // {}' "$output_file")
\`\`\`

## Raw Metrics

\`\`\`json
$(jq '.' "$output_file")
\`\`\`

---
*Generated by advanced benchmark tool*
EOF

    echo "✅ Report saved to: $report_file"
}

# Main execution
main() {
    # Check if server is running
    if ! curl -s "$SERVER_URL/health" > /dev/null; then
        echo "❌ Server not accessible. Please start with: ./start.sh --mode $MODE"
        exit 1
    fi
    
    # Reset metrics
    curl -s "$SERVER_URL/api/reset-metrics" > /dev/null
    
    # Start system monitoring in background
    if [ "$DETAILED" = true ]; then
        collect_system_metrics "$OUTPUT_FILE" &
        MONITOR_PID=$!
    fi
    
    # Run benchmark
    echo "⏱️  Running ${DURATION}s benchmark..."
    sleep "$DURATION"
    
    # Stop monitoring
    if [ "$DETAILED" = true ] && [ -n "$MONITOR_PID" ]; then
        kill $MONITOR_PID 2>/dev/null || true
    fi
    
    # Collect metrics
    curl -s "$SERVER_URL/api/metrics" > "$OUTPUT_FILE"
    
    # Enhanced analysis
    if [ "$DETAILED" = true ]; then
        assess_network_quality "$OUTPUT_FILE"
        generate_report "$OUTPUT_FILE"
    fi
    
    analyze_performance "$OUTPUT_FILE"
    
    echo ""
    echo "🎯 Benchmark complete! Results in: $OUTPUT_FILE"
}

# Check dependencies
for cmd in curl jq bc; do
    if ! command -v $cmd &> /dev/null; then
        echo "⚠️  $cmd not found - some features will be limited"
    fi
done

main "$@"
