# cronet-request

[中文文档](README.md) | English

cronet-request is a standalone Node.js HTTP, streaming, and WebSocket client backed by the bundled Cronet native addon. The package selects the Cronet shared library that matches the current operating system and CPU architecture.

All examples use this import:

~~~js
const cronet = require('cronet-request');
~~~

The default User-Agent is `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36`. Override it with a request `User-Agent` header or the Engine `userAgent` option.

## Features

| Feature | Entry points |
| --- | --- |
| Synchronous HTTP | request, get, post, put, patch, delete |
| Asynchronous HTTP | asyncRequest, asyncGet, asyncPost, and related methods |
| Chromium Cronet TLS | Built in by default |
| HTTP/2 | enableHttp2 |
| QUIC/HTTP/3 | enableQuic |
| Custom TLS profiles | tls, tlsProfile, tlsProfiles |
| Fixed TLS extension order | tls.extensionOrder |
| Random TLS extension order | tls.randomizeExtensions |
| Trust anchors | tls.experimentalOptions |
| HTTP and HTTPS proxies | proxies |
| SOCKS5 and SOCKS5h | socks5:// and socks5h:// |
| SOCKS5 credentials | SOCKS5 username/password handshake |
| Streaming responses | asyncGet(url, { stream: true }) |
| WebSocket and WSS | WebSocket and websocket |
| Cookie jar | RequestsCookieJar |
| Basic and Digest authentication | HTTPBasicAuth and HTTPDigestAuth |
| Multipart upload | files |

Synchronous methods block the current Node.js thread. Asynchronous methods return Promises and do not block the event loop.

## Installation

### Install from npm

Install the published package from the npm registry:

~~~bash
npm install cronet-request
~~~

After installation, use the library directly:

~~~js
const cronet = require('cronet-request');

const response = cronet.get('https://httpbin.org/ip');
console.log(response.json());
response.close();
~~~

The install lifecycle selects the shared library for the current platform. When a matching native addon is not already available, it invokes node-gyp to build jscronet.node.

The package supports Node.js 18 or newer on these six targets:

| Target | Bundled Cronet library |
| --- | --- |
| Windows x64 | lib/cronet.150.0.7871.63-windows-x64.dll |
| Windows arm64 | lib/cronet.150.0.7871.63-windows-arm64.dll |
| Linux x64 | lib/cronet.150.0.7871.63-linux-x64.so |
| Linux arm64 | lib/cronet.150.0.7871.63-linux-arm64.so |
| macOS x64 | lib/cronet.150.0.7871.63-macos-x64.dylib |
| macOS arm64 | lib/cronet.150.0.7871.63-macos-arm64.dylib |

The first source build requires Python and the normal C/C++ toolchain for the target platform. Windows builds require Visual C++ with the native desktop C++ workload.

Force a source build with:

~~~bash
npm install --build-from-source
~~~

### Install a local package

For local package development:

~~~bash
npm pack
npm install <path-to-cronet-request-tarball>
~~~

Or install the local directory directly:

~~~bash
npm install <path-to-cronet-request>
~~~

### GitHub Actions validation

The repository has a source-build workflow for all six targets. A second workflow creates a clean consumer project on every target, runs npm install cronet-request from the public npm registry, copies the repository tests next to the installed package, and runs the complete feature matrix against that installed package.

## Synchronous API

The synchronous API returns a response directly.

~~~js
const cronet = require('cronet-request');

const response = cronet.get('https://httpbin.org/ip', {
  timeout: 45000,
});

console.log(response.status_code);
console.log(response.text());
console.log(response.json());

response.close();
~~~

Use request for an arbitrary method:

~~~js
const cronet = require('cronet-request');

const response = cronet.request('POST', 'https://httpbin.org/post', {
  json: { hello: 'cronet' },
});

console.log(response.status_code);
console.log(response.json().json);
response.close();
~~~

Synchronous wrappers:

~~~text
request
get
options
head
post
put
patch
delete
del
~~~

head defaults to allow_redirects: false. Other wrappers follow redirects by default.

## Asynchronous API

The asynchronous API is named asyncRequest so it is distinct from synchronous request.

~~~js
const cronet = require('cronet-request');

async function main() {
  const response = await cronet.asyncRequest(
    'GET',
    'https://httpbin.org/ip',
    { timeout: 45000 },
  );

  console.log(response.status_code);
  console.log(await response.text());
  console.log(await response.json());

  await response.close();
}

main().catch(console.error);
~~~

Asynchronous wrappers:

~~~js
const cronet = require('cronet-request');

async function main() {
  const url = 'https://httpbin.org/get';
  const options = { trust_env: false };

  const responses = [
    await cronet.asyncGet(url, options),
    await cronet.asyncOptions(url, options),
    await cronet.asyncHead(url, options),
    await cronet.asyncPost(url, { ...options, json: { method: 'post' } }),
    await cronet.asyncPut(url, { ...options, data: { method: 'put' } }),
    await cronet.asyncPatch(url, { ...options, data: { method: 'patch' } }),
    await cronet.asyncDelete(url, options),
    await cronet.asyncDel(url, options),
  ];

  for (const response of responses) await response.close();
}

main().catch(console.error);
~~~

## Request Options

request, Session.request, asyncRequest, and Session.asyncRequest accept:

| Option | Description |
| --- | --- |
| method | HTTP method |
| url | http or https URL |
| params | Query parameters |
| headers | Request headers |
| data | Form data, string, Buffer, or raw body |
| json | JSON request body |
| files | Multipart file entries |
| cookies | Per-request cookies or a cookie jar |
| auth | Basic, Digest, or custom authentication |
| timeout | Milliseconds, or a connect/read object |
| allow_redirects | Follow redirects |
| proxies | HTTP, HTTPS, or SOCKS5 proxy settings |
| hooks | Response hooks |
| stream | Asynchronous streaming mode |
| verify | Certificate verification switch |
| tls | Nested Cronet TLS configuration |
| enableHttp2 | Enable HTTP/2 |
| enableQuic | Enable QUIC |
| disableCache | Disable Cronet cache |
| priority | Cronet request priority |

Accepted aliases:

~~~text
allowRedirects
trustEnv
maxRedirects
tlsProfile
tlsProfiles
tlsExtensionOrder
tlsExtensionIds
randomizeTlsExtensions
~~~

## Request Headers

Headers can be supplied as an object:

~~~js
const cronet = require('cronet-request');

const response = cronet.get('https://httpbin.org/headers', {
  headers: {
    'User-Agent': 'cronet-request-demo/1.0',
    'X-Client-Name': 'cronet-request',
    Accept: 'application/json',
  },
});

console.log(response.json());
response.close();
~~~

Or as name/value pairs:

~~~js
const cronet = require('cronet-request');

const response = cronet.get('https://httpbin.org/headers', {
  headers: [
    ['X-First', 'one'],
    ['X-Second', 'two'],
  ],
});

console.log(response.json());
response.close();
~~~

Use the Headers class when headers need to be changed programmatically:

~~~js
const cronet = require('cronet-request');

const headers = new cronet.Headers();
headers.set('X-Request-ID', 'request-001');
headers.append('X-Trace', 'part-1');
headers.append('X-Trace', 'part-2');

const response = cronet.get('https://httpbin.org/headers', { headers });
console.log(headers.get('x-request-id'));
console.log(response.status_code);
response.close();
~~~

Header names are case-insensitive. Names and values containing CR or LF are rejected with InvalidHeader.

## Query Parameters

~~~js
const cronet = require('cronet-request');

const response = cronet.get('https://httpbin.org/get?existing=1', {
  params: {
    query: 'cronet request',
    page: 2,
    tag: ['tls', 'http2'],
    ignored: null,
  },
});

console.log(response.json().url);
response.close();
~~~

Encoding rules:

~~~text
spaces are encoded as +
array values are repeated under the same key
null and undefined are not sent
existing query values are extended with &
fragments remain after the query
strings and byte arrays are appended as encoded query text
~~~

Already-encoded query text:

~~~js
const cronet = require('cronet-request');

const response = cronet.get('https://httpbin.org/get', {
  params: 'already=encoded&tag=a&tag=b',
});

console.log(response.json());
response.close();
~~~

## Request Bodies

### String and Buffer

~~~js
const cronet = require('cronet-request');

const response = cronet.post('https://httpbin.org/post', {
  headers: { 'Content-Type': 'application/octet-stream' },
  data: Buffer.from([0x00, 0x01, 0x02, 0xff]),
});

console.log(response.status_code);
response.close();
~~~

### JSON

~~~js
const cronet = require('cronet-request');

const response = cronet.post('https://httpbin.org/post', {
  json: {
    name: 'cronet',
    mode: 'json',
  },
});

console.log(response.json().json);
response.close();
~~~

json automatically sets Content-Type to application/json. Non-finite numbers, BigInt, Buffer values, and circular references are rejected.

When data and json are both supplied, data takes precedence. A valid files option selects multipart encoding.

## Multipart Upload

Buffer file:

~~~js
const cronet = require('cronet-request');

const response = cronet.post('https://httpbin.org/post', {
  data: { description: 'demo file' },
  files: {
    file: {
      filename: 'demo.txt',
      data: Buffer.from('hello from cronet-request'),
      contentType: 'text/plain',
      headers: { 'X-Part-Name': 'demo' },
    },
  },
});

console.log(response.json().files);
response.close();
~~~

File stream:

~~~js
const cronet = require('cronet-request');
const fs = require('node:fs');

const file = fs.createReadStream('./demo.txt');
const response = cronet.post('https://httpbin.org/post', {
  files: { file },
});

console.log(response.status_code);
response.close();
~~~

File streams are read before sending. True streaming multipart for very large files is outside the current core scope.

Tuple forms:

~~~text
[filename, content]
[filename, content, contentType]
[filename, content, contentType, partHeaders]
~~~

Example:

~~~js
const cronet = require('cronet-request');

const response = cronet.post('https://httpbin.org/post', {
  files: {
    file1: ['one.txt', Buffer.from('one')],
    file2: ['two.txt', Buffer.from('two'), 'text/plain'],
    file3: ['three.txt', Buffer.from('three'), 'text/plain', {
      'X-Part': 'three',
    }],
  },
});

console.log(response.status_code);
response.close();
~~~

## Request and PreparedRequest

~~~js
const cronet = require('cronet-request');

const request = new cronet.Request({
  method: 'POST',
  url: 'https://example.test/upload',
  params: { source: 'demo' },
  headers: { 'X-Prepared': 'yes' },
  data: { ok: true },
});

const prepared = request.prepare();
console.log(prepared.method);
console.log(prepared.url);
console.log(prepared.path_url);
console.log(prepared.headers.toObject());
console.log(prepared.body.toString());
~~~

Copy a prepared request before modifying it:

~~~js
const cronet = require('cronet-request');

const original = new cronet.Request({
  method: 'GET',
  url: 'https://example.test/',
}).prepare();

const copy = original.copy();
copy.headers.set('X-Copy', 'yes');

console.log(original.headers.has('X-Copy'));
console.log(copy.headers.get('X-Copy'));
~~~

## Responses

Common properties:

~~~text
status_code
statusCode
headers
url
reason
request
history
cookies
elapsed
encoding
ok
is_redirect
is_permanent_redirect
next
links
~~~

Synchronous response:

~~~js
const cronet = require('cronet-request');

const response = cronet.get('https://httpbin.org/get');

console.log(response instanceof cronet.SyncResponse);
console.log(response.content);
console.log(response.bytes());
console.log(response.text());
console.log(response.json());

response.close();
~~~

Asynchronous response:

~~~js
const cronet = require('cronet-request');

async function main() {
  const response = await cronet.asyncGet('https://httpbin.org/get');

  console.log(response instanceof cronet.Response);
  console.log(await response.bytes());
  console.log(await response.text());
  console.log(await response.json());

  await response.close();
}

main().catch(console.error);
~~~

HTTP 4xx and 5xx responses are returned normally. Call raise_for_status when an HTTP exception is required:

~~~js
const cronet = require('cronet-request');

const response = cronet.get('https://httpbin.org/status/404');
console.log(response.status_code);
console.log(response.ok);

try {
  response.raise_for_status();
} catch (error) {
  console.log(error instanceof cronet.HTTPError);
  console.log(error.response.status_code);
}

response.close();
~~~

Iterate response content:

~~~js
const cronet = require('cronet-request');

const response = cronet.get('https://httpbin.org/stream/3');
for (const chunk of response.iter_content({ chunk_size: 128 })) {
  console.log(Buffer.from(chunk).toString('utf8'));
}
for (const line of response.iter_lines({ decode_unicode: true })) {
  console.log(line);
}
response.close();
~~~

## Sessions

A session reuses cookies, default headers, proxy settings, and the Cronet Engine.

Synchronous session:

~~~js
const cronet = require('cronet-request');

const session = cronet.session({
  trust_env: false,
  enableHttp2: true,
  headers: { 'X-Client': 'cronet-session' },
});

try {
  const response = session.get('https://httpbin.org/headers');
  console.log(response.status_code);
  console.log(response.json());
} finally {
  session.closeSync();
}
~~~

Asynchronous session:

~~~js
const cronet = require('cronet-request');

async function main() {
  const session = cronet.session({
    trust_env: false,
    enableHttp2: true,
    headers: { 'X-Client': 'cronet-async-session' },
  });

  try {
    const response = await session.asyncGet('https://httpbin.org/headers');
    console.log(await response.json());
    await response.close();
  } finally {
    await session.close();
  }
}

main().catch(console.error);
~~~

Session defaults and cookies:

~~~js
const cronet = require('cronet-request');

const session = cronet.session({
  trust_env: false,
  headers: { 'X-Session-Header': 'default-value' },
});

session.params = { source: 'session' };
session.cookies.set('sid', 'abc123', {
  domain: 'httpbin.org',
  path: '/',
});

const response = session.get('https://httpbin.org/cookies');
console.log(response.json());
session.closeSync();
~~~

Prepared requests can be sent through a session with sendSync or send:

~~~js
const cronet = require('cronet-request');

const session = cronet.session({ trust_env: false });
const request = new cronet.Request({
  method: 'GET',
  url: 'https://httpbin.org/get',
}).prepare();

const response = session.sendSync(request);
console.log(response.status_code);
session.closeSync();
~~~

## Cookies

Cookie jar:

~~~js
const cronet = require('cronet-request');

const jar = new cronet.RequestsCookieJar();
jar.set('root', 'yes', { domain: 'example.test', path: '/' });
jar.set('private', 'yes', { domain: 'example.test', path: '/private' });
jar.set('secure', 'yes', {
  domain: 'example.test',
  path: '/',
  secure: true,
});

console.log(jar.keys());
console.log(jar.values());
console.log(jar.items());
console.log(jar.get_dict());
console.log(jar.list_domains());
console.log(jar.list_paths());
~~~

Session persistence:

~~~js
const cronet = require('cronet-request');

const session = cronet.session({ trust_env: false });
session.get('https://httpbin.org/cookies/set/session/value');
const response = session.get('https://httpbin.org/cookies');
console.log(response.json());
session.closeSync();
~~~

Cookies are filtered by domain, path, secure, and expiry. Public helpers include:

~~~text
create_cookie
cookiejar_from_dict
merge_cookies
get_cookie_header
extract_cookies_to_jar
remove_cookie_by_name
morsel_to_cookie
RequestsCookieJar
CookieConflictError
~~~

## Redirects

~~~js
const cronet = require('cronet-request');

const followed = cronet.get('https://httpbin.org/redirect/2');
console.log(followed.status_code);
console.log(followed.url);
console.log(followed.history.length);
followed.close();

const notFollowed = cronet.get('https://httpbin.org/redirect/1', {
  allow_redirects: false,
});
console.log(notFollowed.status_code);
console.log(notFollowed.headers.get('location'));
notFollowed.close();
~~~

Redirect rules:

~~~text
301: POST becomes GET
302: every method except HEAD becomes GET
303: every method except HEAD becomes GET
307: method and body are preserved
308: method and body are preserved
~~~

Authorization is removed for a cross-host redirect. Cookies and proxy selection are recalculated for every hop.

## Authentication

Basic tuple:

~~~js
const cronet = require('cronet-request');

const response = cronet.get(
  'https://httpbin.org/basic-auth/demo/password',
  { auth: ['demo', 'password'] },
);

console.log(response.status_code);
console.log(response.json());
response.close();
~~~

Basic authentication class:

~~~js
const cronet = require('cronet-request');

const auth = new cronet.HTTPBasicAuth('demo', 'password');
const response = cronet.get(
  'https://httpbin.org/basic-auth/demo/password',
  { auth },
);

console.log(response.json());
response.close();
~~~

Digest authentication:

~~~js
const cronet = require('cronet-request');

const auth = new cronet.HTTPDigestAuth('user', 'password');
const response = cronet.get(
  'https://httpbin.org/digest-auth/auth/user/password',
  { auth },
);

console.log(response.status_code);
console.log(response.json());
response.close();
~~~

Custom authentication:

~~~js
const cronet = require('cronet-request');

const auth = (prepared) => {
  prepared.headers.set('X-Custom-Auth', 'demo-token');
  return prepared;
};

const response = cronet.get('https://httpbin.org/headers', { auth });
console.log(response.json());
response.close();
~~~

## Proxies

HTTP or HTTPS proxy:

~~~js
const cronet = require('cronet-request');

const response = cronet.get('https://httpbin.org/ip', {
  trust_env: false,
  proxies: {
    http: 'http://127.0.0.1:7890',
    https: 'http://127.0.0.1:7890',
  },
});

console.log(response.status_code);
console.log(response.json());
response.close();
~~~

HTTPS targets use an HTTP proxy CONNECT tunnel.

SOCKS5 credentials:

~~~js
const cronet = require('cronet-request');

const response = cronet.get('https://httpbin.org/ip', {
  trust_env: false,
  proxies: {
    https: 'socks5://username:password@127.0.0.1:1080',
  },
});

console.log(response.json());
response.close();
~~~

Asynchronous SOCKS5h:

~~~js
const cronet = require('cronet-request');

async function main() {
  const response = await cronet.asyncRequest(
    'GET',
    'https://httpbin.org/ip',
    {
      trust_env: false,
      proxies: {
        https: 'socks5h://username:password@127.0.0.1:1080',
      },
    },
  );

  console.log(await response.json());
  await response.close();
}

main().catch(console.error);
~~~

SOCKS5 credentials are sent in the username/password handshake, not as target HTTP headers.

Environment proxy settings:

~~~js
const cronet = require('cronet-request');

const response = cronet.get('https://httpbin.org/ip', {
  trust_env: true,
});
console.log(response.json());
response.close();
~~~

Supported environment variables are HTTP_PROXY, HTTPS_PROXY, ALL_PROXY, and NO_PROXY.

## TLS, HTTP/2, and Fingerprints

Default TLS:

~~~js
const cronet = require('cronet-request');

const response = cronet.get('https://tls.peet.ws/api/all', {
  enableHttp2: true,
});

const body = response.json();
console.log(body.http_version);
console.log(body.tls?.ja3);
console.log(body.tls?.ja3_hash);
response.close();
~~~

When tls is omitted, the bundled Cronet initialization defaults are used.

Custom profile:

~~~js
const cronet = require('cronet-request');

const chrome = cronet.tlsProfiles.chrome_144;
const customProfile = {
  tls_cipher_suites: [...chrome.tls_cipher_suites],
  tls_curves: ['X25519', 'P-256'],
  tls_extensions: [...chrome.tls_extensions],
};

const response = cronet.request(
  'GET',
  'https://tls.peet.ws/api/all',
  {
    enableHttp2: true,
    tls: {
      profile: 'customChrome',
      profiles: { customChrome: customProfile },
    },
  },
);

console.log(response.json().tls?.ja3);
response.close();
~~~

Fixed extension order:

~~~js
const cronet = require('cronet-request');

const response = cronet.request(
  'GET',
  'https://tls.peet.ws/api/all',
  {
    enableHttp2: true,
    tls: {
      profile: false,
      extensionOrder: [
        11, 35, 65037, 23, 0, 5, 43, 17613,
        51, 18, 13, 51764, 45, 10, 16, 27,
        65281, 41,
      ],
      randomizeExtensions: false,
      experimentalOptions: {
        tls_extensions: ['trust_anchors'],
        trust_anchor_ids: [],
      },
    },
  },
);

const body = response.json();
console.log(body.tls?.ja3);
console.log(body.tls?.ja3_hash);
response.close();
~~~

Set randomizeExtensions to false for a stable extension order. Set it to true to produce randomized extension orders.

Trust anchors with an empty list:

~~~js
const cronet = require('cronet-request');

const response = cronet.get('https://tls.peet.ws/api/all', {
  tls: {
    profile: false,
    experimentalOptions: {
      tls_extensions: ['trust_anchors'],
      trust_anchor_ids: [],
    },
  },
});

console.log(response.json().tls?.ja3);
response.close();
~~~

Trust anchors with identifiers:

~~~js
const cronet = require('cronet-request');

const response = cronet.get('https://tls.peet.ws/api/all', {
  tls: {
    profile: false,
    experimentalOptions: {
      tls_extensions: ['trust_anchors'],
      trust_anchor_ids: ['2a03', '2b0601'],
    },
  },
});

console.log(response.json().tls?.ja3);
response.close();
~~~

TLS is a Cronet Engine-level configuration. Set TLS, proxy, HTTP/2, QUIC, and verification options before the first request or WebSocket connection in the process.

## Streaming

~~~js
const cronet = require('cronet-request');

async function main() {
  const response = await cronet.asyncGet(
    'https://httpbin.org/stream/10',
    { stream: true, timeout: 45000 },
  );

  for await (const chunk of response.iter_content({ chunk_size: null })) {
    process.stdout.write(Buffer.from(chunk));
  }

  await response.close();
}

main().catch(console.error);
~~~

Line-oriented streaming:

~~~js
const cronet = require('cronet-request');

async function main() {
  const response = await cronet.asyncGet(
    'https://httpbin.org/stream/5',
    { stream: true },
  );

  for await (const line of response.iter_lines({ decode_unicode: true })) {
    console.log('line:', line);
  }

  await response.close();
}

main().catch(console.error);
~~~

Streaming returns the response as soon as headers arrive, reads the body asynchronously, uses pull-driven native reads, applies backpressure for slow consumers, and lets response.close cancel an unfinished request.

## WebSocket and WSS

Capability checks:

~~~js
const cronet = require('cronet-request');

console.log(cronet.websocketSupported);
console.log(cronet.tlsExtensionsSupported);
~~~

Basic WSS usage:

~~~js
const cronet = require('cronet-request');

const socket = cronet.websocket('wss://echo.websocket.org', {
  headers: { 'X-Client': 'cronet-request' },
  origin: 'https://example.com',
});

socket.onopen = () => {
  socket.send('hello cronet websocket');
};

socket.onmessage = (event) => {
  console.log(event.data);
  socket.close(1000, 'done');
};

socket.onerror = (event) => {
  console.error(event.error || event.message);
};

socket.onclose = (event) => {
  console.log(event.code, event.reason, event.wasClean);
};
~~~

The WebSocket class constructor is also available:

~~~js
const cronet = require('cronet-request');

const socket = new cronet.WebSocket('wss://echo.websocket.org');

socket.onopen = () => socket.send('hello');
socket.onmessage = (event) => {
  console.log(event.data);
  socket.close();
};
~~~

Text and binary messages:

~~~js
const cronet = require('cronet-request');

const socket = cronet.websocket('wss://echo.websocket.org');

socket.onopen = () => {
  socket.send('text message');
  socket.send(Buffer.from([0x00, 0x01, 0xff]));
};

socket.onmessage = (event) => {
  if (typeof event.data === 'string') {
    console.log('text:', event.data);
  } else {
    console.log('binary:', Buffer.from(event.data));
  }
  socket.close(1000, 'messages received');
};

socket.onerror = (event) => console.error(event.error || event.message);
socket.onclose = () => console.log('closed');
~~~

Subprotocol and backend:

~~~js
const cronet = require('cronet-request');

const socket = cronet.websocket('wss://echo.websocket.org', {
  subProtocols: ['chat', 'json'],
  backend: 'direct',
});

socket.onopen = () => {
  console.log('protocol:', socket.protocol);
  setTimeout(() => socket.close(1000, 'demo complete'), 3000);
};

socket.onclose = () => console.log('closed');
~~~

Backend values:

~~~text
auto       automatic selection, and the default
direct     Cronet_WebSocket_* exports
cronet     compatibility alias for direct
cycronet   cyCronet C ABI wrapper
~~~

WebSocket TLS configuration:

~~~js
const cronet = require('cronet-request');

const chrome = cronet.tlsProfiles.chrome_144;
cronet.init({
  tls: {
    profile: 'websocketChrome',
    profiles: {
      websocketChrome: {
        tls_cipher_suites: [...chrome.tls_cipher_suites],
        tls_curves: ['X25519', 'P-256'],
        tls_extensions: [...chrome.tls_extensions],
      },
    },
  },
});

const socket = cronet.websocket('wss://echo.websocket.org', {
  backend: 'direct',
});

socket.onopen = () => socket.send('hello');
socket.onmessage = () => socket.close(1000, 'done');
socket.onerror = (event) => console.error(event.error || event.message);
socket.onclose = () => console.log('closed');
~~~

## Hooks

Synchronous hook:

~~~js
const cronet = require('cronet-request');

const response = cronet.get('https://httpbin.org/get', {
  hooks: {
    response: (item) => {
      item.checked = true;
      return item;
    },
  },
});

console.log(response.checked);
response.close();
~~~

Asynchronous hook:

~~~js
const cronet = require('cronet-request');

async function main() {
  const response = await cronet.asyncGet('https://httpbin.org/get', {
    hooks: {
      response: [
        async (item) => {
          item.checked = true;
          return item;
        },
      ],
    },
  });

  console.log(response.checked);
  await response.close();
}

main().catch(console.error);
~~~

Synchronous hooks must not return Promises. Returning undefined keeps the current response; returning a response replaces the result passed forward.

## Adapters

A custom adapter implements sendSync for synchronous use and send for asynchronous use:

~~~js
const cronet = require('cronet-request');

class DemoAdapter extends cronet.BaseAdapter {
  sendSync(request) {
    return {
      raw: {
        status: 200,
        statusText: 'OK',
        url: request.url,
        headers: [['Content-Type', 'application/json']],
        body: Buffer.from(JSON.stringify({
          method: request.method,
          url: request.url,
        })),
      },
    };
  }

  send(request) {
    return Promise.resolve(this.sendSync(request));
  }

  close() {}
}

const session = cronet.session({
  trust_env: false,
  adapter: new DemoAdapter(),
});

const response = session.get('http://example.test/demo');
console.log(response.json());
session.closeSync();
~~~

Mount an adapter for a URL prefix:

~~~js
const cronet = require('cronet-request');

class DemoAdapter extends cronet.BaseAdapter {
  sendSync(request) {
    return {
      raw: {
        status: 204,
        statusText: 'No Content',
        url: request.url,
        headers: [],
        body: Buffer.alloc(0),
      },
    };
  }

  send(request) {
    return Promise.resolve(this.sendSync(request));
  }

  close() {}
}

const session = cronet.session();
session.mount('http://internal.example/', new DemoAdapter());
console.log(session.get_adapter('http://internal.example/api'));
session.closeSync();
~~~

## Runtime Information

~~~js
const cronet = require('cronet-request');

console.log(cronet.version);
console.log(cronet.initialized);
console.log(cronet.nativePath);
console.log(cronet.dllPath);
console.log(cronet.websocketSupported);
console.log(cronet.tlsExtensionsSupported);
~~~

Low-level functions:

~~~text
init()
close()
closeConnections()
fetch()
fetchStream()
fetchSync()
~~~

## Errors

~~~js
const cronet = require('cronet-request');

try {
  cronet.get('not-a-url');
} catch (error) {
  console.log(error.name);
  console.log(error.message);
}
~~~

Main exception classes:

~~~text
RequestException
HTTPError
ConnectionError
ProxyError
SSLError
Timeout
ConnectTimeout
ReadTimeout
URLRequired
MissingSchema
InvalidSchema
InvalidURL
InvalidProxyURL
InvalidHeader
TooManyRedirects
JSONDecodeError
StreamConsumedError
ContentDecodingError
UnrewindableBodyError
CookieConflictError
~~~

HTTP 4xx and 5xx responses do not automatically reject. Call response.raise_for_status when an HTTP exception is required.

## Utility Functions

~~~js
const cronet = require('cronet-request');

console.log(cronet.encodeParams({
  q: 'hello world',
  tag: ['a', 'b'],
}));

console.log(cronet.getAuthFromUrl(
  'https://user:pass@example.test/',
));

console.log(cronet.getEncodingFromHeaders({
  'content-type': 'text/plain; charset=utf-8',
}));

console.log(cronet.selectProxy(
  'https://example.test/',
  { https: 'http://127.0.0.1:7890' },
));
~~~

Common helpers:

~~~text
encodeParams
appendParams
normalizeUrl
pathUrl
getAuthFromUrl
urldefragauth
requoteUri
getEncodingFromHeaders
guessJsonUtf
superLen
guessFilename
iterSlices
parseListHeader
parseDictHeader
parseHeaderLinks
shouldBypassProxies
getEnvironProxies
selectProxy
resolveProxies
getNetrcAuth
rewindBody
addressInNetwork
dottedNetmask
isValidCidr
~~~

## Testing

Local build and regression:

~~~bash
npm run build
npm test
~~~

Complete feature matrix:

~~~bash
npm run test:matrix
~~~

Individual checks:

~~~bash
npm run test:platform
npm run test:readme
npm run test:tls-config
npm run test:proxy-socks5
npm run test:proxy-http
npm run test:wss
npm run test:streaming
npm run test:external
npm run test:sync-external
npm run test:ja3-matrix
~~~

The JA3 matrix covers six target JA3 values, fixed and randomized extension ordering, repeated randomized samples, empty and populated trust_anchor_ids, and session-ticket warm-up for extension 41.

The npm registry workflow creates a clean consumer project and runs these checks after npm install cronet-request. It is the release-level check for the package users actually install.

## Validation Summary

The bundled Cronet runtime has been validated for:

~~~text
synchronous request
asynchronous asyncRequest
HTTP/2 in synchronous and asynchronous modes
custom TLS profiles in synchronous and asynchronous modes
fixed JA3 extension ordering for six target values
randomized JA3 extension ordering
empty and populated trust_anchor_ids
SOCKS5 and SOCKS5h authentication
streaming chunks, backpressure, and early close
WebSocket and WSS open, message, and close events
native addon builds on all six supported targets
registry installation followed by the package test matrix
~~~

## Known Constraints

1. Synchronous requests block the Node.js main thread.
2. The Cronet Engine is a process-level shared resource. Set engine-level options before the first request.
3. WebSocket is a separate RFC 6455 API. Use websocket or WebSocket for ws and wss URLs.
4. Exact JA3 matching depends on the bundled library, extension order, GREASE, session state, and server behavior.
5. randomizeExtensions: true intentionally produces different extension orders.
6. The package supports Windows, Linux, and macOS on x64 and arm64.
