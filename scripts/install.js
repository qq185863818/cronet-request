'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  platformKey,
  bundledLibraryName,
  isSupportedPlatform,
} = require('../platform');

const rootDirectory = path.resolve(__dirname, '..');
const key = platformKey();
const libraryName = bundledLibraryName();
const forceBuild = ['1', 'true', 'yes'].includes(String(
  process.env.npm_config_build_from_source ||
  process.env.CRONET_REQUEST_BUILD_FROM_SOURCE ||
  '',
).toLowerCase());
const prebuildPath = path.join(rootDirectory, 'prebuilds', key, 'jscronet.node');

function fail(message) {
  console.error(`[cronet-request] ${message}`);
  process.exit(1);
}

function configuredNodeGyp() {
  const candidates = [
    process.env.npm_config_node_gyp,
    process.env.NPM_CONFIG_NODE_GYP,
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npmCommand, ['config', 'get', 'node-gyp'], {
    cwd: rootDirectory,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    windowsHide: true,
  });
  if (result.status !== 0) return undefined;
  const value = String(result.stdout || '').trim();
  return value && value !== 'undefined' && fs.existsSync(value) ? value : undefined;
}

function runNodeGyp() {
  const nodeGyp = configuredNodeGyp();
  if (nodeGyp) {
    return spawnSync(process.execPath, [nodeGyp, 'rebuild'], {
      cwd: rootDirectory,
      stdio: 'inherit',
      windowsHide: true,
    });
  }

  // This fallback handles npm distributions that do not expose their bundled
  // node-gyp path through npm config. It may download node-gyp from npm.
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return spawnSync(npmCommand, [
    'exec', '--yes', '--package=node-gyp', '--', 'node-gyp', 'rebuild',
  ], {
    cwd: rootDirectory,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    windowsHide: true,
  });
}

if (!isSupportedPlatform()) {
  fail(`unsupported platform ${key}; supported platforms are win32/linux/darwin on x64/arm64`);
}

if (!fs.existsSync(path.join(rootDirectory, 'lib', libraryName))) {
  fail(`bundled Cronet shared library is missing: lib/${libraryName}`);
}

if (fs.existsSync(prebuildPath) && !forceBuild) {
  console.log(`[cronet-request] using prebuilt addon for ${key}`);
  process.exit(0);
}

console.log(`[cronet-request] building native addon for ${key}`);
const result = runNodeGyp();
if (result.error) fail(`unable to start node-gyp: ${result.error.message}`);
if (result.status !== 0) fail(`node-gyp rebuild failed with exit code ${result.status}`);

const builtPath = path.join(rootDirectory, 'build', 'Release', 'jscronet.node');
if (!fs.existsSync(builtPath)) fail(`node-gyp completed without producing ${builtPath}`);
console.log(`[cronet-request] native addon ready: build/Release/jscronet.node`);
