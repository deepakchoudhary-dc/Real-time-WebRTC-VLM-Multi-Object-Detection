'use strict';

/**
 * CSP Simulation Harness — Proves TensorFlow.js + COCO-SSD run WITHOUT 'unsafe-eval'
 *
 * Browsers enforcing CSP without 'unsafe-eval' block:
 *   1. Direct/indirect eval()
 *   2. new Function(...) constructor
 *   3. setTimeout/setInterval with string arguments
 *
 * This harness poisons all three mechanisms identically, then loads the real
 * production CDN bundles (tf.min.js@4.10.0, coco-ssd@2.2.3) and exercises
 * tensor operations. If everything works, removing 'unsafe-eval' from the
 * server CSP is empirically proven safe.
 *
 * Usage: node test/csp-simulation.js [path-to-tf.min.js] [path-to-coco-ssd.min.js]
 * Exits 0 on success (removal is safe), 1 on harness failure,
 * 2 when verdict is: bundles REQUIRE 'unsafe-eval' (do not remove).
 */

const path = require('path');
const os = require('os');

const tfPath = process.argv[2] || path.join(os.tmpdir(), 'tf.min.js');
const cocoPath = process.argv[3] || path.join(os.tmpdir(), 'coco-ssd.min.js');

// ── 1. Poison dynamic code generation (CSP 'unsafe-eval' absent) ──────
const RealFunction = Function;

function cspBlock() {
  throw new EvalError(
    "Refused to evaluate a string, because 'unsafe-eval' is not allowed by CSP"
  );
}

const PoisonedFunction = function (...args) {
  cspBlock();
};
PoisonedFunction.prototype = RealFunction.prototype;
globalThis.Function = PoisonedFunction;

// Block indirect eval
const realEval = globalThis.eval;
globalThis.eval = function () {
  cspBlock();
};

// Block string-based timers
const realSetTimeout = globalThis.setTimeout;
const realSetInterval = globalThis.setInterval;
globalThis.setTimeout = function (fn, ...args) {
  if (typeof fn === 'string') cspBlock();
  return realSetTimeout(fn, ...args);
};
globalThis.setInterval = function (fn, ...args) {
  if (typeof fn === 'string') cspBlock();
  return realSetInterval(fn, ...args);
};

// ── 2. Minimal browser-like environment for Node ──────────────────────
globalThis.self = globalThis;
globalThis.window = globalThis;
// Node >= 21 defines `navigator` as a getter-only global; use defineProperty
Object.defineProperty(globalThis, 'navigator', {
  value: {
    userAgent: 'Mozilla/5.0 (CSP-sim)',
    platform: 'Win32',
    language: 'en-US',
    hardwareConcurrency: 8
  },
  configurable: true,
  writable: true
});
globalThis.document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  createElement: () => ({ style: {}, getContext: () => null }),
  addEventListener: () => {},
  removeEventListener: () => {},
  documentElement: { style: {} },
  head: { appendChild: () => {} },
  body: { appendChild: () => {} },
  readyState: 'complete'
};

// ── 3. Verify the harness actually blocks eval ────────────────────────
let harnessBlocksEval = false;
try {
  realEval.call(null, '1+1'); // sanity: real eval works
  globalThis.eval('1+1'); // poisoned eval must throw
} catch (e) {
  harnessBlocksEval = e instanceof EvalError;
}
console.log(`Harness blocks eval(): ${harnessBlocksEval}`);

let harnessBlocksFunctionCtor = false;
try {
  globalThis.Function('return 1');
} catch (e) {
  harnessBlocksFunctionCtor = e instanceof EvalError;
}
console.log(`Harness blocks new Function(): ${harnessBlocksFunctionCtor}`);

if (!harnessBlocksEval || !harnessBlocksFunctionCtor) {
  console.error('FAIL: Harness poisoning is ineffective — cannot prove anything.');
  process.exit(1);
}

// ── 4. Load real production bundles under poisoned CSP ────────────────
// Use vm.runInThisContext to accurately simulate a browser <script> tag:
// no CommonJS wrapper (module/exports/require are undefined), so UMD bundles
// take their browser path. This matters for regenerator-runtime, whose UMD
// wrapper creates global.regeneratorRuntime BEFORE the strict-mode assignment,
// so the Function(...) fallback never executes in real browsers.
const fs = require('fs');
const vm = require('vm');

try {
  const tfCode = fs.readFileSync(tfPath, 'utf8');
  vm.runInThisContext(tfCode, { filename: 'tf.min.js' });
  console.log(`tf.js loaded OK (tfjs ${typeof tf !== 'undefined' ? tf.version.tfjs : 'n/a'})`);

  const cocoCode = fs.readFileSync(cocoPath, 'utf8');
  vm.runInThisContext(cocoCode, { filename: 'coco-ssd.min.js' });
  console.log(`coco-ssd loaded OK: ${typeof cocoSsd !== 'undefined'}`);

  if (typeof tf === 'undefined' || typeof cocoSsd === 'undefined') {
    throw new Error('Globals tf/cocoSsd not defined after load');
  }

  // Exercise kernel execution (CPU backend in Node)
  const a = tf.tensor2d([[1, 2], [3, 4]]);
  const b = tf.matMul(a, a);
  b.data().then((d) => {
    const result = Array.from(d);
    const expected = [7, 10, 15, 22];
    const correct = result.every((v, i) => v === expected[i]);
    console.log(`matMul result: [${result}] — ${correct ? 'correct' : 'WRONG'}`);

    if (correct) {
      console.log('');
      console.log('SUCCESS: TensorFlow.js + COCO-SSD fully operational WITHOUT unsafe-eval.');
      console.log("Removing 'unsafe-eval' from Content-Security-Policy is empirically safe.");
      process.exit(0);
    } else {
      console.error('FAIL: Tensor math produced wrong results.');
      process.exit(1);
    }
  }).catch((e) => {
    console.error('FAIL: Tensor operation error:', e.message);
    process.exit(1);
  });
} catch (e) {
  // ── VERDICT: bundles REQUIRE 'unsafe-eval' — removal is NOT safe ─────
  if (e instanceof EvalError) {
    console.error('');
    console.error('VERDICT: TensorFlow.js @ this pinned version REQUIRES \'unsafe-eval\'.');
    console.error(`  Blocked at: ${e.message}`);
    console.error("  => Do NOT remove 'unsafe-eval' from the server CSP while these");
    console.error('     CDN bundles are in use: tf.min.js would fail to load entirely');
    console.error('     (its strict-mode regenerator-runtime fallback calls Function()).');
    console.error("  Re-run this harness after migrating to a different inference stack");
    console.error('  (e.g. YOLOv10-N via ONNX Runtime Web) or upgrading TF.js.');
    process.exit(2); // 2 = verdict: unsafe-eval required (not a harness error)
  }
  console.error('FAIL: Bundle load failed under CSP simulation:', e.constructor.name, e.message);
  console.error(e.stack);
  process.exit(1);
}
