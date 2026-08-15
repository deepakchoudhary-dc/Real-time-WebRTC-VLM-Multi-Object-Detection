/**
 * Real-time Object Detection using TensorFlow.js COCO-SSD
 * 
 * Supports GPU acceleration (WebGL), WASM, and CPU backends.
 * Yields normalized [0..1] bounding boxes with confidence scores for 80 COCO classes.
 */
'use strict';

class ObjectDetector {
  constructor(options = {}) {
    this.model = null;
    this.modelLoaded = false;
    this.isLoading = false;
    this.confidenceThreshold = options.confidenceThreshold || 0.45;
    this.maxDetections = options.maxDetections || 20;
    this.backend = 'webgl';
    this.lastInferenceDuration = 0;
  }

  /**
   * Load the COCO-SSD model (supports local self-hosted model or CDN fallback)
   * @param {function} onProgress - Progress reporting callback (0-100)
   * @returns {Promise<boolean>}
   */
  async loadModel(onProgress) {
    if (this.modelLoaded) return true;
    if (this.isLoading) return false;

    this.isLoading = true;

    try {
      if (onProgress) onProgress(15);

      if (typeof tf === 'undefined') {
        throw new Error('TensorFlow.js not available. Check script imports.');
      }
      if (typeof cocoSsd === 'undefined') {
        throw new Error('COCO-SSD library not available. Check script imports.');
      }

      if (onProgress) onProgress(35);

      // Initialize backend (WebGL > WASM > CPU)
      try {
        await tf.setBackend('webgl');
        await tf.ready();
        this.backend = 'webgl';
      } catch (err) {
        console.warn('WebGL backend unavailable, trying WASM:', err);
        try {
          await tf.setBackend('wasm');
          await tf.ready();
          this.backend = 'wasm';
        } catch {
          await tf.setBackend('cpu');
          await tf.ready();
          this.backend = 'cpu';
        }
      }

      if (onProgress) onProgress(60);

      // Load model using lite_mobilenet_v2
      const loadOptions = {
        base: 'lite_mobilenet_v2'
      };

      // Probe local self-hosted model
      try {
        const checkLocal = await fetch('/vendor/models/ssdlite_mobilenet_v2/model.json', { method: 'HEAD' });
        if (checkLocal.ok) {
          loadOptions.modelUrl = '/vendor/models/ssdlite_mobilenet_v2/model.json';
        }
      } catch {
        // Fallback to default CDN
      }

      this.model = await cocoSsd.load(loadOptions);

      if (onProgress) onProgress(100);

      this.modelLoaded = true;
      this.isLoading = false;
      return true;
    } catch (error) {
      console.error('Failed to load COCO-SSD detector:', error);
      this.isLoading = false;
      return false;
    }
  }

  /**
   * Run object detection on an image source (video or canvas)
   * @param {HTMLVideoElement|HTMLCanvasElement} source
   * @returns {Promise<Array>} Array of detections with normalized coordinates
   */
  async detect(source) {
    if (!this.modelLoaded || !this.model) {
      return [];
    }

    if (source instanceof HTMLVideoElement) {
      if (source.readyState < 2 || source.videoWidth === 0 || source.videoHeight === 0) {
        return [];
      }
    }

    try {
      const startTime = performance.now();
      const predictions = await this.model.detect(
        source,
        this.maxDetections,
        this.confidenceThreshold
      );
      this.lastInferenceDuration = performance.now() - startTime;

      const width = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
      const height = source instanceof HTMLVideoElement ? source.videoHeight : source.height;

      if (!width || !height) return [];

      const detections = predictions.map((p) => ({
        label: p.class,
        score: p.score,
        xmin: Math.max(0, Math.min(1, p.bbox[0] / width)),
        ymin: Math.max(0, Math.min(1, p.bbox[1] / height)),
        xmax: Math.max(0, Math.min(1, (p.bbox[0] + p.bbox[2]) / width)),
        ymax: Math.max(0, Math.min(1, (p.bbox[1] + p.bbox[3]) / height))
      }));

      return detections;
    } catch (error) {
      console.error('Detection inference error:', error);
      return [];
    }
  }

  get inferenceDuration() {
    return Math.round(this.lastInferenceDuration);
  }

  dispose() {
    if (this.model) {
      this.model = null;
      this.modelLoaded = false;
    }
    if (typeof tf !== 'undefined' && tf.disposeVariables) {
      tf.disposeVariables();
    }
  }
}

window.ObjectDetector = ObjectDetector;
