'use strict';

const assert = require('node:assert/strict');
const requests = require('..');

const source = requests.tlsProfiles.chrome_144;
const customProfile = {
  tls_cipher_suites: [...source.tls_cipher_suites],
  tls_curves: [...source.tls_curves],
  tls_extensions: [...source.tls_extensions],
};

function options() {
  return {
    trust_env: false,
    enableQuic: false,
    enableHttp2: true,
    timeout: 45000,
    tls: {
      profile: 'facade_custom',
      profiles: { facade_custom: customProfile },
    },
  };
}

async function main() {
  const syncResponse = requests.request('GET', 'https://tls.peet.ws/api/all', options());
  assert.equal(syncResponse instanceof Promise, false);
  assert.equal(syncResponse.status_code, 200);
  const syncBody = syncResponse.json();
  assert.ok(syncBody.tls || syncBody.http);
  syncResponse.close();

  const asyncResponse = await requests.asyncRequest('GET', 'https://tls.peet.ws/api/all', options());
  assert.equal(asyncResponse.status_code, 200);
  const asyncBody = await asyncResponse.json();
  assert.ok(asyncBody.tls || asyncBody.http);
  await asyncResponse.close();

  console.log(JSON.stringify({
    customTlsConfig: true,
    sync: {
      status: syncResponse.status_code,
      httpVersion: syncBody.http_version || syncBody.http?.http_version || null,
      ja3Hash: syncBody.tls?.ja3_hash || null,
    },
    async: {
      status: asyncResponse.status_code,
      httpVersion: asyncBody.http_version || asyncBody.http?.http_version || null,
      ja3Hash: asyncBody.tls?.ja3_hash || null,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  try { requests.close(); } catch {}
  process.exitCode = 1;
});
