'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const readmePath = path.join(__dirname, '..', 'README.md');
const readme = fs.readFileSync(readmePath, 'utf8');
const englishReadmePath = path.join(__dirname, '..', 'README.en.md');
const englishReadme = fs.readFileSync(englishReadmePath, 'utf8');

function extractBlocks(source) {
  const lines = source.split(/\r?\n/);
  const blocks = [];
  let open = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!open) {
      const match = /^(`{3}|~{3})([^ ]*)\s*$/.exec(line);
      if (match) {
        open = {
          fence: match[1],
          language: match[2],
          startLine: index + 1,
          lines: [],
        };
      }
      continue;
    }
    if (line === open.fence) {
      blocks.push({
        language: open.language,
        startLine: open.startLine,
        endLine: index + 1,
        source: open.lines.join('\n'),
      });
      open = null;
      continue;
    }
    open.lines.push(line);
  }
  if (open) throw new Error(`Unclosed ${open.language} code block at line ${open.startLine}`);
  return blocks;
}

class FakeHeaders {
  constructor() { this.values = new Map(); }
  set(name, value) { this.values.set(String(name).toLowerCase(), String(value)); return this; }
  append(name, value) { return this.set(name, value); }
  get(name) { return this.values.get(String(name).toLowerCase()) || null; }
  has(name) { return this.values.has(String(name).toLowerCase()); }
  toObject() { return Object.fromEntries(this.values); }
}

class FakeCookieJar {
  constructor() { this._values = new Map(); }
  set(name, value) { this._values.set(String(name), String(value)); return value; }
  get(name, fallback = null) { return this._values.get(String(name)) || fallback; }
  keys() { return [...this._values.keys()]; }
  values() { return [...this._values.values()]; }
  items() { return [...this._values.entries()]; }
  get_dict() { return Object.fromEntries(this._values); }
  list_domains() { return []; }
  list_paths() { return []; }
}

class FakeResponse {
  constructor(url = 'https://example.test/') {
    this.status = 200;
    this.status_code = 200;
    this.statusCode = 200;
    this.statusText = 'OK';
    this.reason = 'OK';
    this.url = String(url);
    this.headers = new FakeHeaders();
    this.headers.set('content-type', 'application/json');
    this.history = [];
    this.cookies = new FakeCookieJar();
    this.request = null;
    this.next = null;
    this.ok = true;
    this.checked = false;
    this.body = Buffer.from('{}');
    this.content = this.body;
  }
  bytes() { return Promise.resolve(Buffer.from(this.body)); }
  text() { return Promise.resolve(this.body.toString('utf8')); }
  json() {
    return Promise.resolve({
      method: 'GET',
      url: this.url,
      origin: '127.0.0.1',
      json: { ok: true, mode: 'demo' },
      form: { selected: 'form' },
      files: { file: 'demo' },
      tls: { ja3: '', ja3_hash: '' },
      http_version: 'h2',
      headers: {},
    });
  }
  async *iter_content() {}
  async *iter_lines() {}
  raise_for_status() {}
  close() { return Promise.resolve(); }
}

class FakeSyncResponse extends FakeResponse {
  bytes() { return Buffer.from(this.body); }
  text() { return this.body.toString('utf8'); }
  json() {
    return {
      method: 'GET',
      url: this.url,
      origin: '127.0.0.1',
      json: { ok: true, mode: 'demo' },
      form: { selected: 'form' },
      files: { file: 'demo' },
      tls: { ja3: '', ja3_hash: '' },
      http_version: 'h2',
      headers: {},
    };
  }
  *iter_content() {}
  *iter_lines() {}
  close() {}
}

class FakePreparedRequest {
  constructor(options = {}) {
    this.method = options.method || 'GET';
    this.url = options.url || 'https://example.test/';
    this.headers = new FakeHeaders();
    this.body = Buffer.from('');
  }
  get path_url() { return '/'; }
  copy() { return new FakePreparedRequest({ method: this.method, url: this.url }); }
}

class FakeRequest {
  constructor(options = {}) { this.options = options; }
  prepare() { return new FakePreparedRequest(this.options); }
}

class FakeAdapter {
  sendSync(request) { return { raw: new FakeSyncResponse(request.url) }; }
  send(request) { return Promise.resolve({ raw: new FakeResponse(request.url) }); }
  close() {}
}

class FakeSession {
  constructor() {
    this.headers = new FakeHeaders();
    this.cookies = new FakeCookieJar();
    this.params = {};
    this.stream = false;
    this.verify = true;
    this.max_redirects = 30;
    this.trust_env = false;
  }
  request(method, url) { return new FakeSyncResponse(url); }
  get(url) { return new FakeSyncResponse(url); }
  options(url) { return new FakeSyncResponse(url); }
  head(url) { return new FakeSyncResponse(url); }
  post(url) { return new FakeSyncResponse(url); }
  put(url) { return new FakeSyncResponse(url); }
  patch(url) { return new FakeSyncResponse(url); }
  delete(url) { return new FakeSyncResponse(url); }
  asyncRequest(method, url) { return Promise.resolve(new FakeResponse(url)); }
  asyncGet(url) { return Promise.resolve(new FakeResponse(url)); }
  asyncOptions(url) { return Promise.resolve(new FakeResponse(url)); }
  asyncHead(url) { return Promise.resolve(new FakeResponse(url)); }
  asyncPost(url) { return Promise.resolve(new FakeResponse(url)); }
  asyncPut(url) { return Promise.resolve(new FakeResponse(url)); }
  asyncPatch(url) { return Promise.resolve(new FakeResponse(url)); }
  asyncDelete(url) { return Promise.resolve(new FakeResponse(url)); }
  asyncDel(url) { return Promise.resolve(new FakeResponse(url)); }
  sendSync(request) { return new FakeSyncResponse(request.url); }
  send(request) { return Promise.resolve(new FakeResponse(request.url)); }
  get_adapter() { return new FakeAdapter(); }
  mount() {}
  closeSync() {}
  close() { return Promise.resolve(); }
}

class FakeSocket {
  constructor() {
    this.readyState = 0;
    this.protocol = '';
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
  }
  send() {}
  close() { this.readyState = 3; }
  addEventListener() {}
  removeEventListener() {}
}

class FakeBaseAdapter {}
class FakeBasicAuth {}
class FakeDigestAuth {}

function createFakeCronet() {
  const profile = {
    tls_cipher_suites: ['TLS_GREASE', 'TLS_AES_128_GCM_SHA256'],
    tls_curves: ['X25519', 'P-256'],
    tls_extensions: [],
  };
  const syncResponse = (url) => new FakeSyncResponse(url);
  const asyncResponse = (url) => Promise.resolve(new FakeResponse(url));
  const api = {
    request: (method, url) => syncResponse(url),
    get: (url) => syncResponse(url),
    options: (url) => syncResponse(url),
    head: (url) => syncResponse(url),
    post: (url) => syncResponse(url),
    put: (url) => syncResponse(url),
    patch: (url) => syncResponse(url),
    delete: (url) => syncResponse(url),
    del: (url) => syncResponse(url),
    asyncRequest: (method, url) => asyncResponse(url),
    asyncGet: (url) => asyncResponse(url),
    asyncOptions: (url) => asyncResponse(url),
    asyncHead: (url) => asyncResponse(url),
    asyncPost: (url) => asyncResponse(url),
    asyncPut: (url) => asyncResponse(url),
    asyncPatch: (url) => asyncResponse(url),
    asyncDelete: (url) => asyncResponse(url),
    asyncDel: (url) => asyncResponse(url),
    session: () => new FakeSession(),
    Session: FakeSession,
    Request: FakeRequest,
    PreparedRequest: FakePreparedRequest,
    Response: FakeResponse,
    SyncResponse: FakeSyncResponse,
    BaseAdapter: FakeBaseAdapter,
    HTTPAdapter: FakeAdapter,
    CronetAdapter: FakeAdapter,
    Headers: FakeHeaders,
    CaseInsensitiveDict: FakeHeaders,
    RequestsCookieJar: FakeCookieJar,
    CookieJar: FakeCookieJar,
    HTTPBasicAuth: FakeBasicAuth,
    HTTPDigestAuth: FakeDigestAuth,
    WebSocket: FakeSocket,
    websocket: () => new FakeSocket(),
    tlsProfiles: { chrome_144: profile },
    init() {},
    close() {},
    closeConnections() {},
    fetch: (url) => asyncResponse(url),
    fetchSync: (url) => syncResponse(url),
    fetchStream: () => Promise.resolve({
      status: 200,
      statusText: 'OK',
      url: 'https://example.test/',
      body: {
        getReader() {
          return {
            async read() { return { done: true }; },
            releaseLock() {},
          };
        },
      },
    }),
    encodeParams: () => 'q=demo',
    getAuthFromUrl: () => ['user', 'pass'],
    getEncodingFromHeaders: () => 'utf-8',
    selectProxy: () => 'http://127.0.0.1:7890',
    version: '150.0.7871.63',
    initialized: true,
    nativePath: 'artifacts/jscronet-win32-x64.node',
    dllPath: 'lib/cronet.150.0.7871.63-windows-x64.dll',
    websocketSupported: true,
    tlsExtensionsSupported: true,
    HTTPError: class HTTPError extends Error {},
    MissingSchema: class MissingSchema extends Error {},
  };
  return api;
}

async function runInSmokeSandbox(source, startLine, filename = readmePath) {
  const fakeCronet = createFakeCronet();
  const sandbox = {
    require(name) {
      if (name === 'cronet-request') return fakeCronet;
      if (name === 'node:fs') return { createReadStream: () => ({}) };
      throw new Error(`README demo imported unsupported module ${name}`);
    },
    Buffer,
    URL,
    Uint8Array,
    ArrayBuffer,
    TextDecoder,
    Promise,
    setTimeout(callback) { callback(); return 0; },
    clearTimeout() {},
    console: {
      log() {},
      error(...args) { throw new Error(args.map(String).join(' ')); },
    },
    process: {
      env: {},
      stdout: { write() {} },
    },
  };
  const value = new vm.Script(source, {
    filename: `${filename}:${startLine}`,
  }).runInNewContext(sandbox, { timeout: 2000 });
  if (value && typeof value.then === 'function') await value;
  await Promise.resolve();
}

async function main() {
  const blocks = extractBlocks(readme);
  const javascriptBlocks = blocks.filter((block) => block.language === 'js');
  assert.equal(javascriptBlocks.length, 65, 'README JavaScript demo count changed; review coverage');

  for (const block of javascriptBlocks) {
    const lines = block.source.split(/\r?\n/);
    const firstLine = lines.find((line) => line.trim() !== '');
    assert.equal(
      firstLine,
      "const cronet = require('cronet-request');",
      `README demo at line ${block.startLine} must use the public import`,
    );
    assert.doesNotMatch(block.source, /(?<![A-Za-z0-9])(?:[A-Z]:[\\/]|[\\/]Users[\\/]|[\\/]home[\\/]|[\\/]Administrator[\\/])/i,
      `README demo at line ${block.startLine} contains a private path`);
    new vm.Script(block.source, {
      filename: `${readmePath}:${block.startLine}`,
    });
    await runInSmokeSandbox(block.source, block.startLine);
  }

  const englishBlocks = extractBlocks(englishReadme);
  const englishJavascriptBlocks = englishBlocks.filter((block) => block.language === 'js');
  assert.ok(englishJavascriptBlocks.length >= 40,
    'English README JavaScript demo coverage is unexpectedly small');
  for (const block of englishJavascriptBlocks) {
    const lines = block.source.split(/\r?\n/);
    const firstLine = lines.find((line) => line.trim() !== '');
    assert.equal(
      firstLine,
      "const cronet = require('cronet-request');",
      `English README demo at line ${block.startLine} must use the public import`,
    );
    assert.doesNotMatch(block.source, /(?<![A-Za-z0-9])(?:[A-Z]:[\\/]|[\\/]Users[\\/]|[\\/]home[\\/]|[\\/]Administrator[\\/])/i,
      `English README demo at line ${block.startLine} contains a private path`);
    new vm.Script(block.source, {
      filename: `${englishReadmePath}:${block.startLine}`,
    });
    await runInSmokeSandbox(block.source, block.startLine, englishReadmePath);
  }

  assert.doesNotMatch(readme, /(?<![A-Za-z0-9])(?:[A-Z]:[\\/]|[\\/]Users[\\/]|[\\/]home[\\/]|[\\/]Administrator[\\/])/i);
  assert.doesNotMatch(englishReadme, /(?<![A-Za-z0-9])(?:[A-Z]:[\\/]|[\\/]Users[\\/]|[\\/]home[\\/]|[\\/]Administrator[\\/])/i);
  assert.doesNotMatch(readme, /REQUESTS_CA_BUNDLE|CURL_CA_BUNDLE|UnsupportedError/);
  assert.doesNotMatch(readme, /自定义 CA 文件|客户端证书/);
  assert.match(readme, /\[English documentation\]\(README\.en\.md\)/);
  assert.match(englishReadme, /\[中文文档\]\(README\.md\)/);
  assert.ok(blocks.length > javascriptBlocks.length);
  console.log(JSON.stringify({
    readme: 'README.md',
    javascriptDemos: javascriptBlocks.length,
    englishReadme: 'README.en.md',
    englishJavascriptDemos: englishJavascriptBlocks.length,
    syntax: 'passed',
    runtimeSmoke: 'passed',
    privatePathScan: 'passed',
    unsupportedFeatureScan: 'passed',
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
}
