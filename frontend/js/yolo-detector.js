/**
 * Real-time Object Detection using TensorFlow.js COCO-SSD
 * 
 * Loads the MobileNetV2-based COCO-SSD model directly from CDN.
 * Detects 80 object classes (person, car, bottle, laptop, etc.)
 * Runs entirely in the browser using WebGL GPU acceleration.
 */
class ObjectDetector {
  constructor() {
    this.model = null;
    this.modelLoaded = false;
    this.isLoading = false;
    this.confidenceThreshold = 0.45;
    this.maxDetections = 20;

    // Performance tracking
    this.lastInferenceTime = 0;
  }

  /**
   * Load the COCO-SSD model from CDN.
   * @param {function} onProgress - Optional progress callback (0-100)
   * @returns {Promise<boolean>} true if model loaded successfully
   */
  async loadModel(onProgress) {
    if (this.modelLoaded) return true;
    if (this.isLoading) return false;

    this.isLoading = true;

    try {
      if (onProgress) onProgress(10);
      console.log('🧠 Loading COCO-SSD model from CDN...');

      // Verify TensorFlow.js is available
      if (typeof tf === 'undefined') {
        throw new Error('TensorFlow.js not loaded. Check CDN script tags.');
      }
      if (typeof cocoSsd === 'undefined') {
        throw new Error('COCO-SSD not loaded. Check CDN script tags.');
      }

      if (onProgress) onProgress(30);

      // Set WebGL backend for GPU acceleration, fall back to WASM/CPU
      try {
        await tf.setBackend('webgl');
        await tf.ready();
        console.log('✅ Using WebGL backend (GPU accelerated)');
      } catch {
        try {
          await tf.setBackend('wasm');
          await tf.ready();
          console.log('⚠️ Using WASM backend (CPU)');
        } catch {
          await tf.setBackend('cpu');
          await tf.ready();
          console.log('⚠️ Using CPU backend (slowest)');
        }
      }

      if (onProgress) onProgress(50);

      // Load the COCO-SSD model (lite_mobilenet_v2 is ~5MB, fast)
      this.model = await cocoSsd.load({
        base: 'lite_mobilenet_v2',
      });

      if (onProgress) onProgress(100);

      this.modelLoaded = true;
      this.isLoading = false;
      console.log('✅ COCO-SSD model loaded successfully');
      console.log(`   Backend: ${tf.getBackend()}`);

      return true;
    } catch (error) {
      console.error('❌ Failed to load COCO-SSD model:', error);
      this.isLoading = false;
      return false;
    }
  }

  /**
   * Run object detection on a video element or canvas.
   * @param {HTMLVideoElement|HTMLCanvasElement} source - Video or canvas element
   * @returns {Promise<Array>} Array of detections with normalized coordinates
   */
  async detect(source) {
    if (!this.modelLoaded || !this.model) {
      return [];
    }

    // Verify the source is ready
    if (source instanceof HTMLVideoElement) {
      if (source.readyState < 2 || source.videoWidth === 0) {
        return [];
      }
    }

    try {
      const startTime = performance.now();

      // Run COCO-SSD detection
      const predictions = await this.model.detect(
        source,
        this.maxDetections,
        this.confidenceThreshold
      );

      this.lastInferenceTime = performance.now() - startTime;

      // Convert predictions to normalized coordinate format
      const sourceWidth =
        source instanceof HTMLVideoElement
          ? source.videoWidth
          : source.width;
      const sourceHeight =
        source instanceof HTMLVideoElement
          ? source.videoHeight
          : source.height;

      if (sourceWidth === 0 || sourceHeight === 0) return [];

      const detections = predictions.map((p) => ({
        label: p.class,
        score: p.score,
        xmin: Math.max(0, p.bbox[0] / sourceWidth),
        ymin: Math.max(0, p.bbox[1] / sourceHeight),
        xmax: Math.min(1, (p.bbox[0] + p.bbox[2]) / sourceWidth),
        ymax: Math.min(1, (p.bbox[1] + p.bbox[3]) / sourceHeight),
      }));

      return detections;
    } catch (error) {
      console.error('❌ Detection error:', error);
      return [];
    }
  }

  /**
   * Get the last inference time in milliseconds.
   */
  getInferenceTime() {
    return Math.round(this.lastInferenceTime);
  }

  /**
   * Clean up model resources.
   */
  dispose() {
    if (this.model) {
      // TF.js models don't have a standard dispose, but clean tensors
      tf.dispose();
      this.model = null;
      this.modelLoaded = false;
    }
  }
}

// Export as global
window.objectDetector = new ObjectDetector();
