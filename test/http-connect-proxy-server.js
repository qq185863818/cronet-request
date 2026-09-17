'use strict';

const net = require('node:net');

function send(message) {
  if (typeof process.send === 'function') process.send(message);
}

const server = net.createServer((client) => {
  let buffer = Buffer.alloc(0);
  let upstream;
  let connected = false;

  const fail = (error) => {
    send({ type: 'error', message: String(error && error.message || error) });
    if (upstream) upstream.destroy();
    client.destroy();
  };

  const onData = (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    const end = buffer.indexOf('\r\n\r\n');
    if (end < 0) return;

    const headerEnd = end + 4;
    const header = buffer.subarray(0, headerEnd).toString('latin1');
    const remainder = buffer.subarray(headerEnd);
    const firstLine = header.split('\r\n', 1)[0];
    const match = /^CONNECT\s+([^\s]+)\s+HTTP\/1\.([01])$/i.exec(firstLine);
    if (!match) return fail(`expected HTTP CONNECT, received ${firstLine}`);

    let host;
    let port;
    const authority = match[1];
    if (authority.startsWith('[')) {
      const close = authority.indexOf(']');
      host = authority.slice(1, close);
      port = Number(authority.slice(close + 2));
    } else {
      const separator = authority.lastIndexOf(':');
      host = authority.slice(0, separator);
      port = Number(authority.slice(separator + 1));
    }
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      return fail(`invalid CONNECT authority ${authority}`);
    }

    buffer = Buffer.alloc(0);
    send({ type: 'target', host, port });
    upstream = net.connect(port, host);
    upstream.once('error', fail);
    upstream.once('connect', () => {
      connected = true;
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      client.removeListener('data', onData);
      if (remainder.length) upstream.write(remainder);
      client.pipe(upstream);
      upstream.pipe(client);
    });
  };

  client.on('data', (chunk) => {
    if (connected) return;
    onData(chunk);
  });
  client.once('error', () => {});
});

server.listen(0, '127.0.0.1', () => {
  send({ type: 'ready', port: server.address().port });
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on('disconnect', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
