'use strict';

const assert = require('node:assert/strict');
const requests = require('..');

function rawResponse(request, status, headers, body) {
  return {
    status,
    statusText: status === 200 ? 'OK' : 'Found',
    url: request.url,
    headers,
    body: Buffer.from(body),
  };
}

function createSyncAdapter() {
  const calls = [];
  return {
    calls,
    sendSync(request) {
      calls.push(request);
      if (request.url.endsWith('/first')) {
        return { raw: rawResponse(request, 302, [['Location', '/second'], ['Set-Cookie', 'sid=sync; Path=/']], '') };
      }
      return {
        raw: rawResponse(
          request,
          200,
          [['Content-Type', 'application/json']],
          JSON.stringify({ method: request.method, cookie: request.headers.get('cookie') }),
        ),
      };
    },
    send(request) {
      return Promise.resolve(this.sendSync(request));
    },
    close() {},
  };
}

function main() {
  const adapter = createSyncAdapter();
  const client = requests.session({ trust_env: false, adapter });
  const response = client.request('GET', 'http://sync.test/first');
  assert.equal(response instanceof Promise, false);
  assert.equal(response.status_code, 200);
  assert.equal(response.history.length, 1);
  assert.equal(response.text().length > 0, true);
  assert.deepEqual(response.json(), { method: 'GET', cookie: 'sid=sync' });
  assert.equal(adapter.calls.length, 2);
  assert.equal(adapter.calls[1].headers.get('cookie'), 'sid=sync');
  client.closeSync();

  const topLevelAdapter = createSyncAdapter();
  const topLevel = requests.get('http://sync.test/second', {
    trust_env: false,
    adapter: topLevelAdapter,
  });
  assert.equal(topLevel instanceof Promise, false);
  assert.equal(topLevel.status_code, 200);
  assert.equal(topLevel.json().method, 'GET');

  const asyncAdapter = createSyncAdapter();
  const asyncValue = requests.asyncRequest('GET', 'http://sync.test/second', {
    trust_env: false,
    adapter: asyncAdapter,
  });
  assert.equal(typeof asyncValue.then, 'function');
  return asyncValue.then((asyncResponse) => {
    assert.equal(asyncResponse.status_code, 200);
    return asyncResponse.close();
  });
}

Promise.resolve(main()).then(() => {
  console.log('sync API and asyncRequest rename tests passed');
}).catch((error) => {
  console.error(error.stack || error);
  try { requests.close(); } catch {}
  process.exitCode = 1;
});
