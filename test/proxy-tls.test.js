'use strict';

const assert = require('node:assert/strict');
const requests = require('..');

const proxyAddress = process.argv[2];
if (!proxyAddress) {
  throw new Error('Usage: node test/proxy-tls.test.js <http://host:port>');
}

const proxyUrl = /^https?:\/\//i.test(proxyAddress)
  ? proxyAddress
  : `http://${proxyAddress}`;

async function main() {
  const startedAt = Date.now();
  const client = requests.session({
    trust_env: false,
    proxies: { https: proxyUrl },
    // HTTP proxy CONNECT is used for HTTPS. Disable QUIC because UDP is not
    // transported through this HTTP proxy configuration.
    enableQuic: false,
    enableHttp2: false,
  });

  try {
    const response = await client.get('https://tls.peet.ws/api/all', {
      timeout: { connect: 15000, read: 45000 },
    });
    const body = await response.json();
    assert.equal(response.status_code, 200);
    assert.ok(body.tls || body.http, 'tls.peet.ws returned no TLS/HTTP details');

    console.log(JSON.stringify({
      proxy: proxyUrl,
      target: 'https://tls.peet.ws/api/all',
      status: response.status_code,
      elapsedMs: Date.now() - startedAt,
      exitIp: body.ip || null,
      httpVersion: body.http_version || body.http?.http_version || null,
      tlsVersion: body.tls?.tls_version_negotiated || null,
      ja3: body.tls?.ja3 || null,
      ja3Hash: body.tls?.ja3_hash || null,
    }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    proxy: proxyUrl,
    target: 'https://tls.peet.ws/api/all',
    passed: false,
    errorName: error.name,
    errorCode: error.code || null,
    message: error.message,
  }, null, 2));
  try { requests.close(); } catch {}
  process.exitCode = 1;
});
