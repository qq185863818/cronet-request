'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  PLATFORM_LIBRARY_NAMES,
  platformKey,
  bundledLibraryName,
  bundledLibraryPath,
  isSupportedPlatform,
} = require('../platform');

const expected = {
  'win32-x64': 'cronet.150.0.7871.63-windows-x64.dll',
  'win32-arm64': 'cronet.150.0.7871.63-windows-arm64.dll',
  'linux-x64': 'cronet.150.0.7871.63-linux-x64.so',
  'linux-arm64': 'cronet.150.0.7871.63-linux-arm64.so',
  'darwin-x64': 'cronet.150.0.7871.63-macos-x64.dylib',
  'darwin-arm64': 'cronet.150.0.7871.63-macos-arm64.dylib',
};

assert.deepEqual(PLATFORM_LIBRARY_NAMES, expected);
for (const [key, name] of Object.entries(expected)) {
  const [platform, arch] = key.split('-');
  assert.equal(platformKey(platform, arch), key);
  assert.equal(bundledLibraryName(platform, arch), name);
  assert.equal(
    bundledLibraryPath('/package', platform, arch),
    path.join('/package', 'lib', name),
  );
  assert.equal(isSupportedPlatform(platform, arch), true);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'lib', name)), true);
}
assert.equal(bundledLibraryName('freebsd', 'x64'), undefined);
assert.equal(bundledLibraryPath('/package', 'freebsd', 'x64'), undefined);
assert.equal(isSupportedPlatform('freebsd', 'x64'), false);

console.log('platform mapping tests passed');
