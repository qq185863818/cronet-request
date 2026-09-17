'use strict';

const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const path = require('node:path');
const cronet = require('..');

function startProxy() {
  const child = fork(path.join(__dirname, 'http-connect-proxy-server.js'), [], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  const state = { targets: [], errors: [] };
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('HTTP proxy did not start')), 10000);
    child.on('message', (message) => {
      if (message.type === 'ready') {
        clearTimeout(timer);
        resolve(message.port);
      } else if (message.type === 'target') {
        state.targets.push(message);
      } else if (message.type === 'error') {
        state.errors.push(message);
      }
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code && state.errors.length === 0) reject(new Error(`HTTP proxy exited with ${code}`));
    });
  });
  return { child, state, ready };
}

async function main() {
  const proxy = startProxy();
  try {
    const port = await proxy.ready;
    const proxyUrl = `http://127.0.0.1:${port}`;
    const options = {
      trust_env: false,
      proxies: { https: proxyUrl },
      enableQuic: false,
      enableHttp2: false,
      timeout: 45000,
    };

    const syncResponse = cronet.request('GET', 'https://httpbin.org/ip', options);
    assert.equal(syncResponse.status_code, 200);
    const syncBody = syncResponse.json();
    syncResponse.close();

    const asyncResponse = await cronet.asyncRequest(
      'GET',
      'https://httpbin.org/ip',
      options,
    );
    assert.equal(asyncResponse.status_code, 200);
    const asyncBody = await asyncResponse.json();
    await asyncResponse.close();

    assert.equal(proxy.state.errors.length, 0,
      proxy.state.errors.map((item) => item.message).join('; '));
    assert.ok(proxy.state.targets.length >= 2);
    assert.ok(proxy.state.targets.every((target) =>
      target.host === 'httpbin.org' && target.port === 443));

    console.log(JSON.stringify({
      httpConnectProxy: true,
      proxy: proxyUrl,
      sync: { status: syncResponse.status_code, origin: syncBody.origin },
      async: { status: asyncResponse.status_code, origin: asyncBody.origin },
      connectTunnels: proxy.state.targets.length,
    }, null, 2));
  } finally {
    try { cronet.close(); } catch {}
    if (proxy.child.connected) proxy.child.disconnect();
    if (!proxy.child.killed) proxy.child.kill();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  try { cronet.close(); } catch {}
  process.exitCode = 1;
});
