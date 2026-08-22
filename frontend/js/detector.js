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
    this.loadingPromise = null;
    this.confidenceThreshold = options.confidenceThreshold || 0.45;
    this.maxDetections = options.maxDetections || 20;
  }

  /**
   * Load the COCO-SSD model (supports in-flight promise deduplication, H6)
   * @param {function} onProgress - Progress reporting callback (0-100)
   * @returns {Promise<boolean>}
   */
  async loadModel(onProgress) {
    if (this.modelLoaded && this.model) return true;
    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    this.loadingPromise = (async () => {
      try {
        if (onProgress) onProgress(15);

        if (typeof tf === 'undefined') {
          throw new Error('TensorFlow.js not available.');
        }
        if (typeof cocoSsd === 'undefined') {
          throw new Error('COCO-SSD library not available.');
        }

        if (onProgress) onProgress(35);

        // Initialize backend (WebGL > WASM > CPU)
        try {
          await tf.setBackend('webgl');
          await tf.ready();
        } catch {
          try {
            await tf.setBackend('wasm');
            await tf.ready();
          } catch {
            await tf.setBackend('cpu');
            await tf.ready();
          }
        }

        if (onProgress) onProgress(60);

        const loadOptions = {
          base: 'lite_mobilenet_v2'
        };

        this.model = await cocoSsd.load(loadOptions);

        if (onProgress) onProgress(100);

        this.modelLoaded = true;
        return true;
      } catch (error) {
        console.warn('[ObjectDetector] Model load failed:', error?.message || error);
        this.modelLoaded = false;
        return false;
      } finally {
        this.loadingPromise = null;
      }
    })();

    return this.loadingPromise;
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
      const predictions = await this.model.detect(
        source,
        this.maxDetections,
        this.confidenceThreshold
      );

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
      console.warn('[ObjectDetector] Detection failed:', error?.message || error);
      return [];
    }
  }

  dispose() {
    this.loadingPromise = null;
    if (this.model) {
      this.model = null;
      this.modelLoaded = false;
    }
    if (typeof tf !== 'undefined' && tf.disposeVariables) {
      try {
        tf.disposeVariables();
      } catch {
        // Safe disposal
      }
    }
  }
}

window.ObjectDetector = ObjectDetector;
