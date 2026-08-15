'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function getTestFiles(dir) {
  let files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(getTestFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

const testFiles = getTestFiles(__dirname);
console.log(`\n🧪 Running WebRTC Object Detection Test Suite (${testFiles.length} files)...\n`);

let failed = 0;
let passed = 0;

for (const file of testFiles) {
  const relPath = path.relative(path.join(__dirname, '..'), file);
  process.stdout.write(`• ${relPath}: `);
  
  // Enforce 10s timeout on each test runner subprocess (N34)
  const res = spawnSync(process.execPath, ['--test', file], {
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'warn' }
  });

  if (res.status === 0) {
    console.log('✅ PASS');
    passed++;
  } else {
    console.log('❌ FAIL');
    if (res.error && res.error.code === 'ETIMEDOUT') {
      console.error('Test timed out after 10000ms.');
    }
    if (res.stdout) console.error(res.stdout);
    if (res.stderr) console.error(res.stderr);
    failed++;
  }
}

console.log('\n' + '─'.repeat(45));
console.log(`Summary: ${passed} passed, ${failed} failed, total ${testFiles.length} test suites.`);
console.log('─'.repeat(45) + '\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
