'use strict';

const config = require('./config');

class MetricsStore {
  constructor(maxSamples = config.MAX_LATENCY_SAMPLES) {
    this.maxSamples = maxSamples;
    this.reset();
  }

  reset() {
    this.processedFrames = 0;
    this.latencies = [];
    this.latencyIndex = 0;
    this.startTime = Date.now();
  }

  recordLatency(latency) {
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

  /**
   * Prometheus text exposition format (version 0.0.4) — zero dependencies.
   * Served at GET /metrics/prometheus (plan.md "Prometheus Metrics Export").
   * @returns {string}
   */
  getPrometheusFormat() {
    const s = this.getSnapshot();
    const lines = [
      '# HELP webrtc_detection_processed_frames_total Total detection frames processed.',
      '# TYPE webrtc_detection_processed_frames_total counter',
      `webrtc_detection_processed_frames_total ${s.processed_frames}`,
      '# HELP webrtc_detection_uptime_seconds Server uptime in seconds.',
      '# TYPE webrtc_detection_uptime_seconds gauge',
      `webrtc_detection_uptime_seconds ${s.duration_seconds}`,
      '# HELP webrtc_detection_latency_ms Detection end-to-end latency statistics.',
      '# TYPE webrtc_detection_latency_ms summary',
      `webrtc_detection_latency_ms{quantile="0.5"} ${s.median_latency_ms}`,
      `webrtc_detection_latency_ms{quantile="0.95"} ${s.p95_latency_ms}`,
      `webrtc_detection_latency_ms_min ${s.min_latency_ms}`,
      `webrtc_detection_latency_ms_max ${s.max_latency_ms}`,
      `webrtc_detection_latency_ms_avg ${s.avg_latency_ms}`,
      '# HELP webrtc_detection_latency_samples Number of latency samples collected.',
      '# TYPE webrtc_detection_latency_samples gauge',
      `webrtc_detection_latency_samples ${s.sample_count}`,
      '# HELP webrtc_detection_processed_fps Average processed frames per second.',
      '# TYPE webrtc_detection_processed_fps gauge',
      `webrtc_detection_processed_fps ${s.processed_fps}`
    ];
    // Prometheus requires the final line to end with a line feed
    return lines.join('\n') + '\n';
  }
}

const metricsStore = new MetricsStore();

module.exports = {
  MetricsStore,
  metricsStore
};
