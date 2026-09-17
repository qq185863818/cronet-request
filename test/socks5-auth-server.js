'use strict';

const net = require('node:net');

const expectedUser = process.argv[2] || 'cronet-user';
const expectedPassword = process.argv[3] || 'cronet-pass';

function send(message) {
  if (typeof process.send === 'function') process.send(message);
}

const server = net.createServer((socket) => {
  let buffer = Buffer.alloc(0);
  let stage = 'greeting';
  let targetSocket;

  const fail = (message) => {
    send({ type: 'error', message: String(message) });
    if (targetSocket) targetSocket.destroy();
    socket.destroy();
  };

  const pump = () => {
    try {
      if (stage === 'greeting') {
        if (buffer.length < 2) return;
        const methodCount = buffer[1];
        if (buffer.length < 2 + methodCount) return;
        const methods = buffer.subarray(2, 2 + methodCount);
        if (!methods.includes(2)) return fail('SOCKS5 username/password was not offered');
        buffer = buffer.subarray(2 + methodCount);
        socket.write(Buffer.from([5, 2]));
        stage = 'auth';
      }

      if (stage === 'auth') {
        if (buffer.length < 2) return;
        const userLength = buffer[1];
        const passwordLengthOffset = 2 + userLength;
        if (buffer.length < passwordLengthOffset + 1) return;
        const passwordLength = buffer[passwordLengthOffset];
        const total = passwordLengthOffset + 1 + passwordLength;
        if (buffer.length < total) return;
        const username = buffer.toString('utf8', 2, passwordLengthOffset);
        const password = buffer.toString('utf8', passwordLengthOffset + 1, total);
        send({ type: 'auth', username, password });
        buffer = buffer.subarray(total);
        if (username !== expectedUser || password !== expectedPassword) {
          socket.write(Buffer.from([1, 1]));
          return fail('SOCKS5 credentials did not match');
        }
        socket.write(Buffer.from([1, 0]));
        stage = 'request';
      }

      if (stage !== 'request' || buffer.length < 4) return;
      if (buffer[0] !== 5 || buffer[1] !== 1) return fail('unexpected SOCKS5 request');
      const addressType = buffer[3];
      let host;
      let portOffset;
      if (addressType === 1) {
        if (buffer.length < 10) return;
        host = [...buffer.subarray(4, 8)].join('.');
        portOffset = 8;
      } else if (addressType === 3) {
        if (buffer.length < 5) return;
        const addressLength = buffer[4];
        if (buffer.length < 7 + addressLength) return;
        host = buffer.toString('utf8', 5, 5 + addressLength);
        portOffset = 5 + addressLength;
      } else if (addressType === 4) {
        if (buffer.length < 22) return;
        host = buffer.subarray(4, 20).toString('hex');
        portOffset = 20;
      } else return fail(`unsupported SOCKS5 address type ${addressType}`);

      const port = buffer.readUInt16BE(portOffset);
      const remainder = buffer.subarray(portOffset + 2);
      buffer = Buffer.alloc(0);
      send({ type: 'target', host, port });
      targetSocket = net.connect(port, host);
      targetSocket.once('error', fail);
      targetSocket.once('connect', () => {
        socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
        socket.removeListener('data', onData);
        if (remainder.length) targetSocket.write(remainder);
        socket.pipe(targetSocket);
        targetSocket.pipe(socket);
      });
    } catch (error) {
      fail(error);
    }
  };

  const onData = (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    pump();
  };
  socket.on('data', onData);
  socket.once('error', () => {});
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
