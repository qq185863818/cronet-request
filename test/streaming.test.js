'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const requests = require('..');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startChunkServer() {
  const chunks = ['stream-1\n', 'stream-2\n', 'stream-3\n', 'stream-4\n'];
  const interval = 120;
  const server = http.createServer(async (request, response) => {
    if (request.url !== '/stream') {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.flushHeaders();
    for (const chunk of chunks) {
      if (response.destroyed) return;
      response.write(chunk);
      await wait(interval);
    }
    if (!response.destroyed) response.end();
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, chunks, interval }));
  });
}

async function main() {
  const fixture = await startChunkServer();
  const url = `http://127.0.0.1:${fixture.server.address().port}/stream`;
  const client = requests.session({
    trust_env: false,
    enableQuic: false,
    enableHttp2: false,
  });
  const started = performance.now();

  try {
    const response = await client.asyncGet(url, { stream: true, timeout: 30000 });
    const headersMs = performance.now() - started;
    assert.equal(response.status_code, 200);
    assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');

    const received = [];
    const times = [];
    for await (const chunk of response.iter_content({ chunk_size: null })) {
      received.push(Buffer.from(chunk).toString('utf8'));
      times.push(performance.now() - started);
    }
    await response.close();

    assert.equal(received.join(''), fixture.chunks.join(''));
    assert.ok(headersMs < fixture.interval * fixture.chunks.length,
      `headers resolved too late: ${headersMs}ms`);
    assert.ok(times.length >= 1);

    const slowResponse = await client.asyncGet(url, { stream: true, timeout: 30000 });
    const slowTimes = [];
    const slowStarted = performance.now();
    for await (const chunk of slowResponse.iter_content({ chunk_size: null })) {
      assert.ok(Buffer.from(chunk).length > 0);
      slowTimes.push(performance.now() - slowStarted);
      await wait(150);
    }
    await slowResponse.close();
    const slowGaps = slowTimes.slice(1).map((time, index) => time - slowTimes[index]);
    assert.ok(slowGaps.length > 0);
    assert.ok(Math.min(...slowGaps) >= fixture.interval,
      `backpressure gap was too small: ${slowGaps.join(', ')}`);

    const earlyResponse = await client.asyncGet(url, { stream: true, timeout: 30000 });
    let earlyChunks = 0;
    for await (const chunk of earlyResponse.iter_content({ chunk_size: null })) {
      assert.ok(Buffer.from(chunk).length > 0);
      earlyChunks += 1;
      break;
    }
    await earlyResponse.close();
    assert.equal(earlyChunks, 1);

    console.log(JSON.stringify({
      status: response.status_code,
      streamingApi: 'Session.asyncGet(..., { stream: true })',
      headersMs: Math.round(headersMs),
      firstChunkMs: Math.round(times[0]),
      lastChunkMs: Math.round(times[times.length - 1]),
      chunksObserved: times.length,
      body: received.join(''),
      slowConsumerReadTimes: slowTimes.map((time) => Math.round(time)),
      slowConsumerGaps: slowGaps.map((time) => Math.round(time)),
      strictBackpressureObserved: Math.min(...slowGaps) >= fixture.interval,
      earlyCloseChunksObserved: earlyChunks,
      cronetVersion: requests.cronet.version,
    }, null, 2));
  } finally {
    await client.close();
    await new Promise((resolve) => fixture.server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  try { requests.close(); } catch {}
  process.exitCode = 1;
});
