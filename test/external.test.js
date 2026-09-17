'use strict';

const assert = require('node:assert/strict');
const requests = require('..');

async function main() {
  const client = requests.session({ trust_env: false, enableQuic: false, enableHttp2: false });
  try {
    const tls = await client.asyncGet('https://tls.peet.ws/api/all', { timeout: 45000 });
    const tlsBody = await tls.json();
    assert.equal(tls.status_code, 200);
    assert.ok(tlsBody.tls || tlsBody.http);

    const ip = await client.asyncGet('https://httpbin.org/ip', { timeout: 45000 });
    const ipBody = await ip.json();
    assert.equal(ip.status_code, 200);
    assert.match(String(ipBody.origin), /\S+/);

    const root = await client.asyncGet('https://httpbin.org/', { timeout: 45000 });
    assert.equal(root.status_code, 200);
    const rootText = await root.text();
    assert.match(rootText, /httpbin/i);

    console.log(JSON.stringify({
      tls: { status: tls.status_code, httpVersion: tlsBody.http_version, ja3Hash: tlsBody.tls?.ja3_hash || null },
      ip: ipBody,
      httpbinRootStatus: root.status_code,
    }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  try { requests.close(); } catch {}
  process.exitCode = 1;
});
