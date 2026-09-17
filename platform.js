'use strict';

const path = require('node:path');

const PLATFORM_LIBRARY_NAMES = Object.freeze({
  'win32-x64': 'cronet.150.0.7871.63-windows-x64.dll',
  'win32-arm64': 'cronet.150.0.7871.63-windows-arm64.dll',
  'linux-x64': 'cronet.150.0.7871.63-linux-x64.so',
  'linux-arm64': 'cronet.150.0.7871.63-linux-arm64.so',
  'darwin-x64': 'cronet.150.0.7871.63-macos-x64.dylib',
  'darwin-arm64': 'cronet.150.0.7871.63-macos-arm64.dylib',
});

function platformKey(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

function bundledLibraryName(platform = process.platform, arch = process.arch) {
  return PLATFORM_LIBRARY_NAMES[platformKey(platform, arch)];
}

function bundledLibraryPath(rootDirectory, platform = process.platform, arch = process.arch) {
  const name = bundledLibraryName(platform, arch);
  return name ? path.join(rootDirectory, 'lib', name) : undefined;
}

function isSupportedPlatform(platform = process.platform, arch = process.arch) {
  return Boolean(bundledLibraryName(platform, arch));
}

module.exports = {
  PLATFORM_LIBRARY_NAMES,
  platformKey,
  bundledLibraryName,
  bundledLibraryPath,
  isSupportedPlatform,
};
