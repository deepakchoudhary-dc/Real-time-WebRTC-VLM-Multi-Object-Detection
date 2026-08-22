'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MetricsStore } = require('../../server/metrics');

test('MetricsStore - Ring buffer capacity & finiteness validation', () => {
  const store = new MetricsStore(5);

  // Valid entries
  store.recordLatency(10);
  store.recordLatency(20);
  store.recordLatency(30);

  // Invalid entries (NaN, negative, Infinity, strings) should be silently discarded
  store.recordLatency(NaN);
  store.recordLatency(-5);
  store.recordLatency(Infinity);
  store.recordLatency('100');
  store.recordLatency(null);

  assert.equal(store.latencies.length, 3);
  assert.deepEqual(store.latencies, [10, 20, 30]);

  // Overflow ring buffer
  store.recordLatency(40);
  store.recordLatency(50);
  store.recordLatency(60); // Overwrites index 0

  assert.equal(store.latencies.length, 5);
  assert.equal(store.latencies[0], 60);
});

test('MetricsStore - Statistics calculation (Median, P95, Min, Max, Processed Frames)', () => {
  const store = new MetricsStore(100);

  // Insert latencies: 10, 20, 30, ..., 100
  for (let i = 1; i <= 10; i++) {
    store.recordLatency(i * 10);
  }
  store.incrementProcessedFrames();
  store.incrementProcessedFrames();

  const snapshot = store.getSnapshot();

  assert.equal(snapshot.min_latency_ms, 10);
  assert.equal(snapshot.max_latency_ms, 100);
  assert.equal(snapshot.median_latency_ms, 60);
  assert.equal(snapshot.p95_latency_ms, 100);
  assert.equal(snapshot.sample_count, 10);
  assert.equal(snapshot.processed_frames, 2);
  assert.equal('total_frames' in snapshot, false); // total_frames removed (G01)
});

test('MetricsStore - Reset capability', () => {
  const store = new MetricsStore();
  store.recordLatency(50);
  store.incrementProcessedFrames();

  store.reset();
  const snapshot = store.getSnapshot();

  assert.equal(snapshot.sample_count, 0);
  assert.equal(snapshot.processed_frames, 0);
  assert.equal(snapshot.median_latency_ms, 0);
});

test('MetricsStore - Prometheus exposition format (zero-dependency export)', () => {
  const store = new MetricsStore(100);
  for (let i = 1; i <= 10; i++) {
    store.recordLatency(i * 10);
  }
  store.incrementProcessedFrames();

  const output = store.getPrometheusFormat();

  // Format fundamentals
  assert.ok(output.endsWith('\n'));
  const lines = output.trim().split('\n');
  assert.ok(lines.every((l) => l.length > 0));

  // Declared families & sample lines
  assert.match(output, /^# TYPE webrtc_detection_processed_frames_total counter$/m);
  assert.match(output, /^webrtc_detection_processed_frames_total 1$/m);
  assert.match(output, /^webrtc_detection_uptime_seconds \d+$/m);
  assert.match(output, /^webrtc_detection_latency_ms\{quantile="0.5"\} 60$/m);
  assert.match(output, /^webrtc_detection_latency_ms\{quantile="0.95"\} 100$/m);
  assert.match(output, /^webrtc_detection_latency_ms_min 10$/m);
  assert.match(output, /^webrtc_detection_latency_ms_max 100$/m);
  assert.match(output, /^webrtc_detection_latency_ms_avg 55$/m);
  assert.match(output, /^webrtc_detection_latency_samples 10$/m);

  // Empty store must still render valid output
  const emptyOutput = new MetricsStore().getPrometheusFormat();
  assert.match(emptyOutput, /^webrtc_detection_processed_frames_total 0$/m);
  assert.match(emptyOutput, /^webrtc_detection_latency_ms\{quantile="0.5"\} 0$/m);
});
