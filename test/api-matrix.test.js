'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const requests = require('..');

function startServer() {
  const server = http.createServer((request, response) => {
    if (request.url === '/redirect') {
      response.writeHead(302, { Location: '/echo' });
      response.end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ method: request.method, url: request.url }));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const cases = [
      ['asyncRequest', () => requests.asyncRequest('GET', `${base}/echo`), 'GET'],
      ['asyncGet', () => requests.asyncGet(`${base}/echo`), 'GET'],
      ['asyncOptions', () => requests.asyncOptions(`${base}/echo`), 'OPTIONS'],
      ['asyncHead', () => requests.asyncHead(`${base}/echo`), 'HEAD'],
      ['asyncPost', () => requests.asyncPost(`${base}/echo`), 'POST'],
      ['asyncPut', () => requests.asyncPut(`${base}/echo`), 'PUT'],
      ['asyncPatch', () => requests.asyncPatch(`${base}/echo`), 'PATCH'],
      ['asyncDelete', () => requests.asyncDelete(`${base}/echo`), 'DELETE'],
      ['asyncDel', () => requests.asyncDel(`${base}/echo`), 'DELETE'],
    ];
    for (const [name, call, expectedMethod] of cases) {
      const response = await call();
      assert.equal(response.status_code, 200, name);
      if (expectedMethod === 'HEAD') assert.equal(await response.text(), '', name);
      else assert.equal((await response.json()).method, expectedMethod, name);
    }
    const headRedirect = await requests.asyncHead(`${base}/redirect`);
    assert.equal(headRedirect.status_code, 302);
    assert.equal(headRedirect.history.length, 0);
    console.log('top-level API matrix passed');
  } finally {
    try { requests.close(); } catch {}
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
