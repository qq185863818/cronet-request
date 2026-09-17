'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const requests = require('..');

function startServer() {
  const server = http.createServer(async (request, response) => {
    if (request.url === '/redirect') {
      response.writeHead(302, { Location: '/echo', 'Set-Cookie': 'redirected=yes; Path=/' });
      response.end();
      return;
    }
    if (request.url === '/set-cookie') {
      response.writeHead(200, { 'Content-Type': 'text/plain', 'Set-Cookie': 'sid=local; Path=/' });
      response.end('cookie set');
      return;
    }
    if (request.url === '/status') {
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('not found');
      return;
    }
    if (request.url === '/stream') {
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.write('first\n');
      setTimeout(() => response.write('second\n'), 20);
      setTimeout(() => response.end('third\n'), 40);
      return;
    }
    if (request.url === '/slow') {
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      setTimeout(() => response.end('late'), 250);
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      method: request.method,
      url: request.url,
      body: body.toString('utf8'),
      contentType: request.headers['content-type'] || null,
      cookie: request.headers.cookie || null,
      header: request.headers['x-request-test'] || null,
    }));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = requests.session({ trust_env: false, enableQuic: false, enableHttp2: false });
  try {
    const get = await client.asyncGet(`${base}/echo`, { params: { q: 'cronet request', tag: ['a', 'b'] }, headers: { 'X-Request-Test': 'get' } });
    const getBody = await get.json();
    assert.equal(get.status_code, 200);
    assert.equal(getBody.method, 'GET');
    assert.equal(getBody.url, '/echo?q=cronet+request&tag=a&tag=b');
    assert.equal(getBody.header, 'get');

    const post = await client.asyncPost(`${base}/echo`, { json: { hello: 'cronet' } });
    const postBody = await post.json();
    assert.equal(postBody.method, 'POST');
    assert.deepEqual(JSON.parse(postBody.body), { hello: 'cronet' });
    assert.equal(postBody.contentType, 'application/json');

    const form = await client.asyncPut(`${base}/echo`, { data: { a: '1', b: 'two' } });
    const formBody = await form.json();
    assert.equal(formBody.body, 'a=1&b=two');
    assert.equal(formBody.contentType, 'application/x-www-form-urlencoded');

    const redirected = await client.asyncGet(`${base}/redirect`);
    assert.equal(redirected.status_code, 200);
    assert.equal(redirected.history.length, 1);
    assert.equal(redirected.history[0].status_code, 302);
    assert.equal((await redirected.json()).cookie, 'redirected=yes');

    await client.asyncGet(`${base}/set-cookie`);
    const cookieResponse = await client.asyncGet(`${base}/echo`);
    assert.match((await cookieResponse.json()).cookie, /sid=local/);

    const streaming = await client.asyncGet(`${base}/stream`, { stream: true });
    const lines = [];
    for await (const line of streaming.iter_lines({ decode_unicode: true })) lines.push(line);
    assert.deepEqual(lines, ['first', 'second', 'third']);
    await streaming.close();

    const notFound = await client.asyncGet(`${base}/status`);
    assert.equal(notFound.status_code, 404);
    assert.equal(notFound.ok, false);
    assert.throws(() => notFound.raise_for_status(), requests.HTTPError);

    await assert.rejects(
      client.asyncGet(`${base}/slow`, { timeout: 30 }),
      (error) => error instanceof requests.ReadTimeout,
    );
    const probe = new requests.CronetAdapter();
    try {
      assert.throws(
        () => probe._ensureEngine({ verify: 'custom-ca.pem' }, null),
        requests.UnsupportedError,
      );
    } finally {
      probe.close();
    }
    console.log(JSON.stringify({
      cronetVersion: requests.cronet.version,
      nativePath: requests.nativePath,
      status: 'passed',
    }, null, 2));
  } finally {
    await client.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  try { requests.close(); } catch {}
  process.exitCode = 1;
});
