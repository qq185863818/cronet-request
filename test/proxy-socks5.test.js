'use strict';

const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const path = require('node:path');
const requests = require('..');

const username = 'cronet-user';
const password = 'cronet-pass';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startProxy() {
  const child = fork(path.join(__dirname, 'socks5-auth-server.js'), [username, password], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  const state = { auth: [], targets: [], errors: [] };
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SOCKS5 test server did not start')), 10000);
    child.on('message', (message) => {
      if (message.type === 'ready') {
        clearTimeout(timer);
        resolve(message.port);
      } else if (message.type === 'auth') state.auth.push(message);
      else if (message.type === 'target') state.targets.push(message);
      else if (message.type === 'error') state.errors.push(message);
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code && state.errors.length === 0) reject(new Error(`SOCKS5 test server exited with ${code}`));
    });
  });
  return { child, state, ready };
}

async function main() {
  const proxy = startProxy();
  try {
    const port = await proxy.ready;
    const base = `127.0.0.1:${port}`;
    const syncProxy = `socks5://${username}:${password}@${base}`;
    const asyncProxy = `socks5h://${username}:${password}@${base}`;
    const options = {
      trust_env: false,
      enableQuic: false,
      enableHttp2: false,
      timeout: 45000,
    };

    const syncResponse = requests.request('GET', 'https://tls.peet.ws/api/all', {
      ...options,
      proxies: { https: syncProxy },
    });
    assert.equal(syncResponse.status_code, 200);
    const syncBody = syncResponse.json();
    assert.ok(syncBody.ip);
    syncResponse.close();

    const asyncResponse = await requests.asyncRequest('GET', 'https://tls.peet.ws/api/all', {
      ...options,
      proxies: { https: asyncProxy },
    });
    assert.equal(asyncResponse.status_code, 200);
    const asyncBody = await asyncResponse.json();
    assert.ok(asyncBody.ip);
    await asyncResponse.close();

    await wait(200);
    assert.equal(proxy.state.errors.length, 0, proxy.state.errors.map((item) => item.message).join('; '));
    assert.ok(proxy.state.auth.length >= 2);
    assert.ok(proxy.state.auth.every((item) => item.username === username && item.password === password));
    assert.ok(proxy.state.targets.length >= 2);

    console.log(JSON.stringify({
      socks5Auth: true,
      sync: { status: syncResponse.status_code, exitIp: syncBody.ip },
      async: { status: asyncResponse.status_code, exitIp: asyncBody.ip },
      authenticationHandshakes: proxy.state.auth.length,
      targets: proxy.state.targets,
    }, null, 2));
  } finally {
    try { requests.close(); } catch {}
    if (proxy.child.connected) proxy.child.disconnect();
    if (!proxy.child.killed) proxy.child.kill();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  try { requests.close(); } catch {}
  process.exitCode = 1;
});
