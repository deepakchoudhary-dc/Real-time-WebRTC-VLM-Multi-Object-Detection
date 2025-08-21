# PowerShell Benchmark script for WebRTC Multi-Object Detection
param(
    [int]$Duration = 30,
    [string]$Mode = "wasm",
    [string]$OutputFile = "metrics.json",
    [string]$ServerUrl = "http://localhost:3000",
    [switch]$Help
)

if ($Help) {
    Write-Host "Usage: .\run_bench.ps1 [OPTIONS]"
    Write-Host "Options:"
    Write-Host "  -Duration SECONDS    Benchmark duration (default: 30)"
    Write-Host "  -Mode [wasm|server]  Processing mode (default: wasm)"
    Write-Host "  -OutputFile FILE     Output metrics file (default: metrics.json)"
    Write-Host "  -ServerUrl URL       Server URL (default: http://localhost:3000)"
    Write-Host "  -Help                Show this help"
    exit 0
}

Write-Host "🚀 Starting benchmark..." -ForegroundColor Green
Write-Host "Duration: $($Duration)s"
Write-Host "Mode: $Mode"
Write-Host "Output: $OutputFile"
Write-Host "Server: $ServerUrl"

function Check-Server {
    try {
        $response = Invoke-WebRequest -Uri "$ServerUrl/health" -UseBasicParsing -TimeoutSec 5
        if ($response.StatusCode -ne 200) {
            throw "Server returned status $($response.StatusCode)"
        }
        Write-Host "✅ Server is accessible" -ForegroundColor Green
    }
    catch {
        Write-Host "❌ Server not accessible at $ServerUrl" -ForegroundColor Red
        Write-Host "Please start the server first:" -ForegroundColor Yellow
        Write-Host "  .\start.sh --mode $Mode" -ForegroundColor Yellow
        exit 1
    }
}

function Reset-Metrics {
    Write-Host "🔄 Resetting metrics..." -ForegroundColor Yellow
    try {
        Invoke-WebRequest -Uri "$ServerUrl/api/reset-metrics" -UseBasicParsing | Out-Null
        Write-Host "✅ Metrics reset" -ForegroundColor Green
    }
    catch {
        Write-Host "⚠️ Failed to reset metrics" -ForegroundColor Yellow
    }
}

function Run-Benchmark {
    Write-Host "⏱️  Running benchmark for $Duration seconds..." -ForegroundColor Cyan
    Write-Host "📱 Please ensure phone is connected and streaming" -ForegroundColor Cyan
    
    $progressBarLength = 40
    $interval = 1
    $elapsed = 0
    
    while ($elapsed -lt $Duration) {
        $progress = [math]::Floor($elapsed * $progressBarLength / $Duration)
        $remaining = $progressBarLength - $progress
        
        $bar = ("█" * $progress) + ("░" * $remaining)
        
        Write-Host "`r[$bar] $elapsed/$($Duration)s" -NoNewline
        
        Start-Sleep -Seconds $interval
        $elapsed += $interval
    }
    
    $fullBar = "█" * $progressBarLength
    Write-Host "`r[$fullBar] $Duration/$($Duration)s ✅" -ForegroundColor Green
    Write-Host ""
}

function Collect-Metrics {
    Write-Host "📊 Collecting metrics..." -ForegroundColor Cyan
    
    try {
        $response = Invoke-WebRequest -Uri "$ServerUrl/api/metrics" -UseBasicParsing
        $metricsJson = $response.Content
        
        $metricsJson | Out-File -FilePath $OutputFile -Encoding UTF8
        Write-Host "✅ Metrics saved to $OutputFile" -ForegroundColor Green
        
        # Parse and display key metrics
        $metrics = $metricsJson | ConvertFrom-Json
        
        Write-Host ""
        Write-Host "📈 Benchmark Results:" -ForegroundColor Green
        Write-Host "====================" -ForegroundColor Green
        Write-Host "Mode: $($metrics.mode)"
        Write-Host "Duration: $($metrics.duration_seconds)s"
        Write-Host "Median Latency: $($metrics.median_latency_ms)ms"
        Write-Host "P95 Latency: $($metrics.p95_latency_ms)ms"
        Write-Host "Processed FPS: $($metrics.processed_fps)"
        Write-Host "Total Frames: $($metrics.total_frames)"
        Write-Host "Processed Frames: $($metrics.processed_frames)"
        
        if ($metrics.total_frames -gt 0) {
            $successRate = [math]::Round(($metrics.processed_frames * 100) / $metrics.total_frames, 1)
            Write-Host "Success Rate: $successRate%"
        }
        
        return $metrics
    }
    catch {
        Write-Host "❌ Failed to collect metrics: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
}

function Add-BandwidthEstimates {
    param($metrics)
    
    Write-Host "📡 Adding bandwidth estimates..." -ForegroundColor Cyan
    
    # Add estimated bandwidth values
    if ($metrics.mode -eq "wasm") {
        $metrics | Add-Member -NotePropertyName "uplink_kbps" -NotePropertyValue 800
        $metrics | Add-Member -NotePropertyName "downlink_kbps" -NotePropertyValue 50
    } else {
        $metrics | Add-Member -NotePropertyName "uplink_kbps" -NotePropertyValue 1200
        $metrics | Add-Member -NotePropertyName "downlink_kbps" -NotePropertyValue 80
    }
    
    $metrics | Add-Member -NotePropertyName "estimated" -NotePropertyValue $true
    
    $metrics | ConvertTo-Json -Depth 10 | Out-File -FilePath $OutputFile -Encoding UTF8
    Write-Host "✅ Bandwidth estimates added" -ForegroundColor Green
}

function Show-Summary {
    param($metrics)
    
    Write-Host ""
    Write-Host "📋 Quick Summary:" -ForegroundColor Green
    Write-Host "================" -ForegroundColor Green
    
    Write-Host "✓ Mode: $($metrics.mode)"
    Write-Host "✓ Median latency: $($metrics.median_latency_ms)ms"
    Write-Host "✓ P95 latency: $($metrics.p95_latency_ms)ms"
    Write-Host "✓ Processing FPS: $($metrics.processed_fps)"
    
    # Performance assessment
    if ($metrics.mode -eq "wasm") {
        if ($metrics.median_latency_ms -lt 150 -and $metrics.processed_fps -gt 10) {
            Write-Host "🟢 Performance: Good for WASM mode" -ForegroundColor Green
        } elseif ($metrics.median_latency_ms -lt 250 -and $metrics.processed_fps -gt 8) {
            Write-Host "🟡 Performance: Acceptable for WASM mode" -ForegroundColor Yellow
        } else {
            Write-Host "🔴 Performance: Poor - consider server mode" -ForegroundColor Red
        }
    } else {
        if ($metrics.median_latency_ms -lt 100 -and $metrics.processed_fps -gt 15) {
            Write-Host "🟢 Performance: Excellent for server mode" -ForegroundColor Green
        } elseif ($metrics.median_latency_ms -lt 200 -and $metrics.processed_fps -gt 10) {
            Write-Host "🟡 Performance: Good for server mode" -ForegroundColor Yellow
        } else {
            Write-Host "🔴 Performance: Suboptimal - check system resources" -ForegroundColor Red
        }
    }
}

# Main execution
try {
    Check-Server
    Reset-Metrics
    Run-Benchmark
    $metrics = Collect-Metrics
    Add-BandwidthEstimates -metrics $metrics
    Show-Summary -metrics $metrics
    
    Write-Host ""
    Write-Host "🎯 Benchmark complete! Results saved to $OutputFile" -ForegroundColor Green
    Write-Host "📁 You can now upload this file or view detailed metrics." -ForegroundColor Cyan
}
catch {
    Write-Host "❌ Benchmark failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
