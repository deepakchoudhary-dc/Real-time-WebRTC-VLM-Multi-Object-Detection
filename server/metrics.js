'use strict';

const config = require('./config');

class MetricsStore {
  constructor(maxSamples = config.MAX_LATENCY_SAMPLES) {
    this.maxSamples = maxSamples;
    this.reset();
  }

  reset() {
    this.totalFrames = 0;
    this.processedFrames = 0;
    this.latencies = [];
    this.latencyIndex = 0;
    this.startTime = Date.now();
  }

  recordLatency(latency) {
    // Strict validation: must be a finite positive number within reasonable boundary (0 to 60,000 ms)
    if (typeof latency !== 'number' || !Number.isFinite(latency) || latency < 0 || latency > 60_000) {
      return;
    }

    if (this.latencies.length < this.maxSamples) {
      this.latencies.push(latency);
    } else {
      this.latencies[this.latencyIndex] = latency;
    }
    this.latencyIndex = (this.latencyIndex + 1) % this.maxSamples;
  }

  incrementTotalFrames() {
    this.totalFrames++;
  }

  incrementProcessedFrames() {
    this.processedFrames++;
  }

  getSnapshot() {
    const now = Date.now();
    const durationSeconds = Math.max(1, (now - this.startTime) / 1000);

    const validLatencies = this.latencies.filter((l) => Number.isFinite(l));
    const sorted = [...validLatencies].sort((a, b) => a - b);
    const count = sorted.length;

    const median = count > 0 ? sorted[Math.floor(count / 2)] : 0;
    const p95 = count > 0 ? sorted[Math.floor(count * 0.95)] : 0;
    const min = count > 0 ? sorted[0] : 0;
    const max = count > 0 ? sorted[count - 1] : 0;
    const avg = count > 0 ? Math.round(sorted.reduce((acc, v) => acc + v, 0) / count) : 0;

    return {
      duration_seconds: Math.round(durationSeconds),
      total_frames: this.totalFrames,
      processed_frames: this.processedFrames,
      median_latency_ms: Math.round(median),
      p95_latency_ms: Math.round(p95),
      min_latency_ms: Math.round(min),
      max_latency_ms: Math.round(max),
      avg_latency_ms: avg,
      sample_count: count,
      processed_fps: Math.round((this.processedFrames / durationSeconds) * 10) / 10
    };
  }
}

const metricsStore = new MetricsStore();

module.exports = {
  MetricsStore,
  metricsStore
};
