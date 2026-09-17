'use strict';

const assert = require('node:assert/strict');
const requests = require('..');

function main() {
  const response = requests.request('GET', 'https://tls.peet.ws/api/all', {
    trust_env: false,
    enableQuic: false,
    enableHttp2: false,
    timeout: 45000,
  });

  assert.equal(response instanceof Promise, false);
  assert.equal(response.status_code, 200);
  const body = response.json();
  assert.ok(body.tls || body.http);

  console.log(JSON.stringify({
    api: 'request',
    synchronous: true,
    status: response.status_code,
    url: response.url,
    httpVersion: body.http_version || body.http?.http_version || null,
    tlsVersion: body.tls?.tls_version_negotiated || null,
    ja3Hash: body.tls?.ja3_hash || null,
    nativePath: requests.nativePath,
  }, null, 2));
  response.close();
}

try {
  main();
} catch (error) {
  console.error(error.stack || error);
  try { requests.close(); } catch {}
  process.exitCode = 1;
}
