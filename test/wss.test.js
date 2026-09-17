'use strict';

const assert = require('node:assert/strict');
const requests = require('..');

const WSS_URL = process.env.CRONET_WSS_URL || 'wss://echo.websocket.org';

function testWebSocket() {
  assert.equal(requests.websocketSupported, true);
  return new Promise((resolve, reject) => {
    let settled = false;
    let opened = false;
    let messages = 0;
    const socket = requests.websocket(WSS_URL, {
      headers: { 'X-jsCronet-Test': 'cronet-request-wss' },
      origin: 'https://example.com',
    });
    assert.equal(socket instanceof requests.WebSocket, true);
    const timer = setTimeout(() => finish(new Error('Cronet WebSocket timed out')), 30000);

    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        try { socket.close(); } catch {}
        reject(error);
      } else {
        resolve({ opened, messages, readyState: socket.readyState });
      }
    }

    socket.onopen = (event) => {
      opened = true;
      assert.equal(event.type, 'open');
      socket.send('cronet-request websocket test');
    };
    socket.onmessage = (event) => {
      messages += 1;
      assert.equal(event.type, 'message');
      assert.equal(typeof event.data, 'string');
      assert.ok(event.data.length > 0);
      socket.close(1000, 'test complete');
    };
    socket.onerror = (event) => finish(event.error || new Error(event.message || 'Cronet WebSocket failed'));
    socket.onclose = (event) => {
      assert.equal(event.type, 'close');
      assert.equal(event.code >= 1000, true);
      finish();
    };
  });
}

async function main() {
  try {
    const result = await testWebSocket();
    console.log(JSON.stringify({
      target: WSS_URL,
      supported: requests.websocketSupported,
      ...result,
      cronetVersion: requests.cronet.version,
      nativePath: requests.nativePath,
    }, null, 2));
  } finally {
    try { requests.close(); } catch (error) {
      console.error(`close: ${error.message}`);
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  try { requests.close(); } catch {}
  process.exitCode = 1;
});
