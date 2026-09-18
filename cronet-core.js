'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { TLS_PROFILES } = require('./tls-profiles');
const {
  platformKey,
  bundledLibraryName,
  bundledLibraryPath,
} = require('./platform');

const PLATFORM_KEY = platformKey();
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

function loadNativeAddon() {
  const candidates = [
    path.join(__dirname, 'prebuilds', PLATFORM_KEY, 'jscronet.node'),
    path.join(__dirname, 'artifacts', `jscronet-${PLATFORM_KEY}.node`),
    path.join(__dirname, 'build', 'Release', `jscronet-${PLATFORM_KEY}.node`),
    path.join(__dirname, 'build', 'Release', 'jscronet.node'),
  ];
  const failures = [];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      return { addon: require(candidate), path: candidate };
    } catch (error) {
      failures.push(`${candidate}: ${error.message}`);
    }
  }

  const detail = failures.length > 0
    ? `\n${failures.join('\n')}`
    : `\nExpected one of:\n${candidates.join('\n')}`;
  throw new Error(`Unable to load jsCronet native addon for ${PLATFORM_KEY}.${detail}`);
}

const loadedNative = loadNativeAddon();
const native = loadedNative.addon;
const NATIVE_PATH = loadedNative.path;

function resolveDefaultLibrary() {
  const candidate = bundledLibraryPath(__dirname);
  if (!candidate) return undefined;
  return fs.existsSync(candidate) ? candidate : undefined;
}

function resolveDefaultWebSocketLibrary() {
  const configured = process.env.CRONET_CYCRONET_LIBRARY;
  if (configured) return path.resolve(configured);

  // A cyCronet Rust build is a separate C ABI wrapper, not the Cronet
  // library itself.  Keep discovery conservative: the Python extension
  // (cronet_cloak.dll/cronet_cloak.so) is deliberately not selected here
  // because a normal PyO3 build does not export cycronet_ws_*.
  const names = process.platform === 'win32' && process.arch === 'x64'
    ? [
      'cycronet-cloak.dll',
      'cycronet_cloak.dll',
      path.join('artifacts', 'cycronet-cloak.dll'),
      path.join('artifacts', 'cycronet_cloak.dll'),
    ]
    : process.platform === 'linux' && process.arch === 'x64'
      ? [
        'libcycronet-cloak.so',
        'libcycronet_cloak.so',
        path.join('artifacts', 'libcycronet-cloak.so'),
        path.join('artifacts', 'libcycronet_cloak.so'),
      ]
      : process.platform === 'linux' && process.arch === 'arm64'
        ? [
          'libcycronet-cloak-arm64.so',
          'libcycronet_cloak-arm64.so',
          path.join('artifacts', 'libcycronet-cloak-arm64.so'),
          path.join('artifacts', 'libcycronet_cloak-arm64.so'),
        ]
        : [];
  const existing = names.find((name) => {
    const candidate = path.isAbsolute(name) ? name : path.join(__dirname, name);
    return fs.existsSync(candidate);
  });
  if (!existing) return undefined;
  return path.isAbsolute(existing) ? existing : path.join(__dirname, existing);
}

const DEFAULT_LIBRARY = resolveDefaultLibrary();
const DEFAULT_WEBSOCKET_LIBRARY = resolveDefaultWebSocketLibrary();
let initialized = false;
let initOptions;

function cloneProfile(profile) {
  const cloned = {};
  for (const [name, value] of Object.entries(profile)) {
    cloned[name] = Array.isArray(value) ? [...value] : value;
  }
  // Accept the cyCronet profile spelling as well as the raw Cronet option
  // spelling. The DLL consumes the latter.
  if (cloned.cipher_suites && !cloned.tls_cipher_suites) {
    cloned.tls_cipher_suites = cloned.cipher_suites;
    delete cloned.cipher_suites;
  }
  if (cloned.signature_algorithms && !cloned.tls_signature_algorithms) {
    cloned.tls_signature_algorithms = cloned.signature_algorithms;
    delete cloned.signature_algorithms;
  }
  if (cloned.tls_cipher_suites) {
    // BoringSSL's exact-order setter rejects duplicate IDs. Keep the first
    // occurrence so profiles copied from browser captures remain usable.
    const seen = new Set();
    cloned.tls_cipher_suites = cloned.tls_cipher_suites.filter((cipher) => {
      const key = String(cipher).trim().toUpperCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return cloned;
}

function parseExperimentalOptions(value) {
  if (value == null || value === '') return {};
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      throw new TypeError('experimentalOptions must be valid JSON object text');
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('experimentalOptions must be an object or JSON object text');
  }
  return { ...value };
}

function normalizeTlsOptions(options) {
  const result = { ...options };
  const tls = options && options.tls;
  if (tls == null) return result;
  if (!tls || typeof tls !== 'object' || Array.isArray(tls)) {
    throw new TypeError('tls must be an object');
  }
  const aliases = {
    profile: 'tlsProfile',
    profiles: 'tlsProfiles',
    extensionIds: 'tlsExtensionIds',
    extensionOrder: 'tlsExtensionOrder',
    randomizeExtensions: 'randomizeTlsExtensions',
    experimentalOptions: 'experimentalOptions',
  };
  for (const [nestedName, flatName] of Object.entries(aliases)) {
    if (result[flatName] === undefined && tls[nestedName] !== undefined) {
      result[flatName] = tls[nestedName];
    }
  }
  delete result.tls;
  return result;
}

function prepareInitOptions(options) {
  const result = normalizeTlsOptions(options);
  const customProfiles = options.tlsProfiles;
  if (customProfiles != null &&
      (!customProfiles || typeof customProfiles !== 'object' || Array.isArray(customProfiles))) {
    throw new TypeError('tlsProfiles must be an object keyed by profile name');
  }

  const profiles = { ...TLS_PROFILES, ...customProfiles };
  const profileName = options.tlsProfile === undefined ? 'chrome_144' : options.tlsProfile;
  let profile = {};
  if (profileName !== false && profileName !== null) {
    if (typeof profileName !== 'string' || !Object.hasOwn(profiles, profileName)) {
      throw new RangeError(`Unknown tlsProfile '${String(profileName)}'`);
    }
    profile = cloneProfile(profiles[profileName]);
  }

  // The patched Cronet DLL accepts an explicit TLS extension ID array through
  // a dedicated export. Keep the profile spelling separate from the legacy
  // tls_extensions control list, which only toggles named extensions.
  const extensionIds = result.tlsExtensionOrder ??
    result.tlsExtensionIds ??
    profile.tls_extension_ids ??
    profile.tls_extension_order ??
    profile.custom_extension_order;
  if (extensionIds !== undefined) {
    result.tlsExtensionIds = Array.isArray(extensionIds)
      ? extensionIds.filter((id) => Number.isInteger(id) && id >= 0 && id <= 65535)
      : extensionIds;
  }
  const randomizeExtensions = result.randomizeTlsExtensions ??
    profile.tls_extensions_randomize ??
    profile.randomize_tls_extensions ??
    profile.tls_extension_randomize;
  if (randomizeExtensions !== undefined) {
    result.randomizeTlsExtensions = Boolean(randomizeExtensions);
  }
  delete profile.tls_extension_ids;
  delete profile.tls_extension_order;
  delete profile.custom_extension_order;
  delete profile.tls_extensions_randomize;
  delete profile.randomize_tls_extensions;
  delete profile.tls_extension_randomize;

  const experimentalOptions = parseExperimentalOptions(options.experimentalOptions);
  result.experimentalOptions = JSON.stringify({ ...profile, ...experimentalOptions });

  // cyCronet's Rust C ABI accepts the TLS lists separately from Cronet's
  // experimental JSON.  Preserve the selected profile for that backend as
  // well, while leaving the normal Cronet option names untouched.
  if (result.cycronetCipherSuites == null && profile.tls_cipher_suites) {
    result.cycronetCipherSuites = [...profile.tls_cipher_suites];
  }
  if (result.cycronetTlsCurves == null && profile.tls_curves) {
    result.cycronetTlsCurves = [...profile.tls_curves];
  }
  if (result.cycronetTlsExtensions == null && profile.tls_extensions) {
    result.cycronetTlsExtensions = [...profile.tls_extensions];
  }
  delete result.tlsProfile;
  delete result.tlsProfiles;
  return result;
}

function normalizeHeaders(headers) {
  if (headers == null) return [];

  const entries = [];
  if (headers instanceof Headers) {
    for (const pair of headers) entries.push(pair);
    return entries;
  }

  if (typeof headers[Symbol.iterator] === 'function' &&
      typeof headers !== 'string' &&
      !Array.isArray(headers)) {
    for (const pair of headers) {
      if (!pair || pair.length !== 2) {
        throw new TypeError('Each header entry must contain [name, value]');
      }
      entries.push([String(pair[0]), String(pair[1])]);
    }
    return entries;
  }

  if (Array.isArray(headers)) {
    for (const pair of headers) {
      if (!Array.isArray(pair) || pair.length !== 2) {
        throw new TypeError('Each header entry must contain [name, value]');
      }
      entries.push([String(pair[0]), String(pair[1])]);
    }
    return entries;
  }

  if (typeof headers === 'object') {
    for (const [name, value] of Object.entries(headers)) {
      entries.push([name, String(value)]);
    }
    return entries;
  }

  throw new TypeError('headers must be an object or iterable');
}

const WEBSOCKET_HEADER_ORDER = [
  'pragma',
  'cache-control',
  'user-agent',
  'upgrade',
  'origin',
  'sec-websocket-version',
  'accept-encoding',
  'accept-language',
  'cookie',
];

const WEBSOCKET_CANONICAL_HEADERS = Object.freeze({
  pragma: 'Pragma',
  'cache-control': 'Cache-Control',
  'user-agent': 'User-Agent',
  upgrade: 'Upgrade',
  origin: 'Origin',
  'sec-websocket-version': 'Sec-WebSocket-Version',
  'accept-encoding': 'Accept-Encoding',
  'accept-language': 'Accept-Language',
  cookie: 'Cookie',
});

const WEBSOCKET_MANAGED_HEADERS = new Set([
  'host',
  'connection',
  'sec-websocket-key',
  'sec-websocket-extensions',
  'sec-websocket-protocol',
]);

// Match cyCronet's Python adapter.  Chromium owns the handshake-generated
// fields, while the browser-style fields are inserted in a stable order so
// the extra-header path has the same observable request shape.
function normalizeWebSocketHeaders(headers, origin) {
  const fields = new Map();
  const unknown = [];
  let selectedOrigin = origin == null ? undefined : String(origin);

  for (const [rawName, rawValue] of normalizeHeaders(headers)) {
    const name = String(rawName);
    const value = String(rawValue);
    const lower = name.toLowerCase();
    if (lower === 'origin') {
      if (selectedOrigin !== undefined && selectedOrigin !== value) {
        throw new TypeError('WebSocket origin conflicts with the Origin header');
      }
      selectedOrigin = value;
    }
    if (WEBSOCKET_MANAGED_HEADERS.has(lower)) continue;
    if (fields.has(lower)) {
      throw new TypeError(`Duplicate WebSocket header: ${name}`);
    }
    fields.set(lower, [
      WEBSOCKET_CANONICAL_HEADERS[lower] || name,
      value,
    ]);
    if (!WEBSOCKET_HEADER_ORDER.includes(lower)) unknown.push(lower);
  }

  if (!fields.has('upgrade')) fields.set('upgrade', ['Upgrade', 'websocket']);
  if (!fields.has('sec-websocket-version')) {
    fields.set('sec-websocket-version', ['Sec-WebSocket-Version', '13']);
  }
  if (selectedOrigin !== undefined) {
    fields.set('origin', ['Origin', selectedOrigin]);
  }

  const ordered = [];
  for (const name of WEBSOCKET_HEADER_ORDER) {
    if (fields.has(name)) ordered.push(fields.get(name));
  }
  for (const name of unknown) ordered.push(fields.get(name));
  return { headers: ordered, origin: selectedOrigin };
}

function bodyToBuffer(body) {
  if (body == null) return null;
  if (Buffer.isBuffer(body)) return Buffer.from(body);
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }
  throw new TypeError('body must be a string, Buffer, ArrayBuffer, or typed array');
}

function ensureInitialized(options = {}) {
  if (initialized) return initOptions && initOptions.version;
  const requestedLibrary = options.dllPath || options.libraryPath;
  const libraryPath = requestedLibrary ? path.resolve(requestedLibrary) : DEFAULT_LIBRARY;
  if (!libraryPath) {
    const bundledName = bundledLibraryName();
    throw new Error(
      `No default Cronet shared library for ${PLATFORM_KEY}; ` +
      (bundledName
        ? `expected lib/${bundledName}`
        : 'this package supports win32/linux/darwin on x64/arm64'),
    );
  }
  if (!DEFAULT_LIBRARY || path.resolve(libraryPath) !== path.resolve(DEFAULT_LIBRARY)) {
    const bundledName = bundledLibraryName();
    throw new Error(
      'cronet-request only permits the bundled '
        + (bundledName ? `lib/${bundledName}` : `library for ${PLATFORM_KEY}`),
    );
  }
  initOptions = {
    ...prepareInitOptions(options),
    userAgent: options.userAgent === undefined
      ? DEFAULT_USER_AGENT
      : options.userAgent,
    dllPath: libraryPath,
    websocketLibraryPath: options.websocketLibraryPath ||
      DEFAULT_WEBSOCKET_LIBRARY,
  };
  initOptions.version = native.init(initOptions);
  initialized = true;
  return initOptions.version;
}

function init(options = {}) {
  return ensureInitialized(options);
}

function makeAbortError() {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

function fetch(input, options = {}) {
  const url = input instanceof URL ? input.toString() : String(input);
  const method = String(options.method || 'GET').toUpperCase();
  const body = bodyToBuffer(options.body);
  if (body && (method === 'GET' || method === 'HEAD')) {
    throw new TypeError(`${method} requests cannot have a body`);
  }
  let timeoutMs;
  if (options.timeout != null) {
    timeoutMs = Number(options.timeout);
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new TypeError('timeout must be a non-negative finite number');
    }
  }

  const signal = options.signal;
  if (signal && signal.aborted) return Promise.reject(makeAbortError());

  ensureInitialized(options);
  const handle = native.request({
    url,
    method,
    headers: normalizeHeaders(options.headers),
    body,
    allowRedirects: options.allowRedirects !== false,
    disableCache: options.cache === 'no-store' || options.disableCache === true,
    priority: options.priority,
  });

  let abortListener;
  let timeout;
  let settled = false;
  const cancel = () => {
    if (!settled) native.cancel(handle.id);
  };

  if (signal && typeof signal.addEventListener === 'function') {
    abortListener = cancel;
    signal.addEventListener('abort', abortListener, { once: true });
  }
  if (timeoutMs != null) timeout = setTimeout(cancel, timeoutMs);

  return handle.promise.then((raw) => {
    settled = true;
    if (abortListener) signal.removeEventListener('abort', abortListener);
    if (timeout) clearTimeout(timeout);
    return new Response(raw);
  }, (error) => {
    settled = true;
    if (abortListener) signal.removeEventListener('abort', abortListener);
    if (timeout) clearTimeout(timeout);
    throw error;
  });
}

class StreamResponse {
  constructor(raw, body, closeBody) {
    this.status = raw.status;
    this.statusText = raw.statusText;
    this.url = raw.url;
    this.headers = new Headers(raw.headers);
    this.body = body;
    this.bodyUsed = false;
    this._closeBody = closeBody;
    this._closed = false;
  }

  get ok() { return this.status >= 200 && this.status < 300; }

  async _consume() {
    if (this.bodyUsed) throw new TypeError('Body is unusable');
    this.bodyUsed = true;
    const reader = this.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        const chunk = Buffer.from(item.value);
        chunks.push(chunk);
        total += chunk.length;
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks, total);
  }

  async arrayBuffer() {
    const body = await this._consume();
    return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
  }

  async bytes() { return new Uint8Array(await this._consume()); }
  async text() { return (await this._consume()).toString('utf8'); }
  async json() { return JSON.parse(await this.text()); }

  async close() {
    if (this._closed) return;
    this._closed = true;
    if (this._closeBody) {
      await this._closeBody();
      return;
    }
    if (this.body && typeof this.body.cancel === 'function') {
      try { await this.body.cancel(); } catch {}
    }
  }
}

function fetchStream(input, options = {}) {
  const Stream = globalThis.ReadableStream;
  if (typeof Stream !== 'function') {
    throw new Error('ReadableStream is not available in this Node.js runtime');
  }

  const url = input instanceof URL ? input.toString() : String(input);
  const method = String(options.method || 'GET').toUpperCase();
  const body = bodyToBuffer(options.body);
  if (body && (method === 'GET' || method === 'HEAD')) {
    throw new TypeError(`${method} requests cannot have a body`);
  }
  const timeoutMs = options.timeout == null ? undefined : Number(options.timeout);
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs < 0)) {
    throw new TypeError('timeout must be a non-negative finite number');
  }

  const signal = options.signal;
  if (signal && signal.aborted) return Promise.reject(makeAbortError());
  ensureInitialized(options);

  let requestHandle;
  let controller;
  let headerSettled = false;
  let headersReady = false;
  let readDemand = false;
  let nativeReadPending = false;
  let terminal = false;
  let canceled = false;
  let abortListener;
  let timeout;
  let resolveTerminal;
  let terminalSettled = false;
  const terminalPromise = new Promise((resolve) => {
    resolveTerminal = resolve;
  });
  let resolveHeaders;
  let rejectHeaders;
  const headersPromise = new Promise((resolve, reject) => {
    resolveHeaders = resolve;
    rejectHeaders = reject;
  });

  const clearRequestTimers = () => {
    if (abortListener) signal.removeEventListener('abort', abortListener);
    if (timeout) clearTimeout(timeout);
    abortListener = undefined;
    timeout = undefined;
  };

  const settleTerminal = () => {
    if (terminalSettled) return;
    terminalSettled = true;
    resolveTerminal();
  };

  const tryRead = () => {
    if (!headersReady || !readDemand || nativeReadPending || terminal || canceled ||
        !requestHandle) return;
    readDemand = false;
    nativeReadPending = true;
    try {
      const accepted = native.streamRead(requestHandle.id);
      if (accepted === false) nativeReadPending = false;
    } catch (error) {
      nativeReadPending = false;
      terminal = true;
      clearRequestTimers();
      settleTerminal();
      if (!headerSettled) {
        headerSettled = true;
        rejectHeaders(error);
      }
      try { controller.error(error); } catch {}
    }
  };

  const bodyStream = new Stream({
    start(streamController) {
      controller = streamController;
      const failBeforeHeaders = (error) => {
        if (!headerSettled) {
          headerSettled = true;
          rejectHeaders(error);
        }
        try { controller.error(error); } catch {}
      };

      try {
        requestHandle = native.request({
          url,
          method,
          headers: normalizeHeaders(options.headers),
          body,
          allowRedirects: options.allowRedirects !== false,
          disableCache: options.cache === 'no-store' || options.disableCache === true,
          priority: options.priority,
          streaming: true,
          onHeaders: (raw) => {
            headersReady = true;
            if (!headerSettled) {
              headerSettled = true;
              resolveHeaders(raw);
            }
            tryRead();
          },
          onChunk: (chunk) => {
            nativeReadPending = false;
            if (!terminal && !canceled) controller.enqueue(new Uint8Array(chunk));
            tryRead();
          },
        onEnd: () => {
          terminal = true;
          nativeReadPending = false;
          clearRequestTimers();
          settleTerminal();
          if (!canceled) controller.close();
        },
        onError: (error) => {
          terminal = true;
          nativeReadPending = false;
          clearRequestTimers();
          settleTerminal();
          if (!headerSettled) {
              headerSettled = true;
              rejectHeaders(error);
            }
            if (!canceled) controller.error(error);
          },
        });
      } catch (error) {
        failBeforeHeaders(error);
        return;
      }

      const cancel = () => {
        if (!terminal && requestHandle) native.cancel(requestHandle.id);
      };
      if (signal && typeof signal.addEventListener === 'function') {
        abortListener = cancel;
        signal.addEventListener('abort', abortListener, { once: true });
      }
      if (timeoutMs !== undefined) timeout = setTimeout(cancel, timeoutMs);
      tryRead();
    },
    pull() {
      readDemand = true;
      tryRead();
    },
    cancel(reason) {
      canceled = true;
      if (!terminal && requestHandle) native.cancel(requestHandle.id);
      return reason;
    },
  });

  return headersPromise.then((raw) => new StreamResponse(raw, bodyStream, async () => {
    if (!terminal && requestHandle) {
      try { await bodyStream.cancel(); } catch {}
    }
    await terminalPromise;
  }));
}

function fetchSync(input, options = {}) {
  const url = input instanceof URL ? input.toString() : String(input);
  const method = String(options.method || 'GET').toUpperCase();
  const body = bodyToBuffer(options.body);
  if (body && (method === 'GET' || method === 'HEAD')) {
    throw new TypeError(`${method} requests cannot have a body`);
  }
  const timeoutMs = options.timeout == null ? 30000 : Number(options.timeout);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new TypeError('timeout must be a non-negative finite number');
  }
  if (options.signal && options.signal.aborted) throw makeAbortError();

  ensureInitialized(options);
  const raw = native.requestSync({
    url,
    method,
    headers: normalizeHeaders(options.headers),
    body,
    allowRedirects: options.allowRedirects !== false,
    disableCache: options.cache === 'no-store' || options.disableCache === true,
    priority: options.priority,
    timeoutMs,
  });
  return new SyncResponse(raw);
}

class Headers {
  constructor(init) {
    this._entries = new Map();
    this._all = new Map();
    for (const [name, value] of normalizeHeaders(init)) {
      this.append(name, value);
    }
  }

  append(name, value) {
    const key = String(name).toLowerCase();
    const text = String(value);
    const values = this._all.get(key) || [];
    values.push(text);
    this._all.set(key, values);
    this._entries.set(key, values.join(', '));
  }

  set(name, value) {
    const key = String(name).toLowerCase();
    const text = String(value);
    this._all.set(key, [text]);
    this._entries.set(key, text);
  }
  get(name) { return this._entries.get(String(name).toLowerCase()) ?? null; }
  getAll(name) { return (this._all.get(String(name).toLowerCase()) || []).slice(); }
  has(name) { return this._entries.has(String(name).toLowerCase()); }
  delete(name) {
    const key = String(name).toLowerCase();
    this._all.delete(key);
    return this._entries.delete(key);
  }
  entries() { return this._entries.entries(); }
  keys() { return this._entries.keys(); }
  values() { return this._entries.values(); }
  forEach(callback, thisArg) {
    this._entries.forEach((value, name) => callback.call(thisArg, value, name, this));
  }
  [Symbol.iterator]() { return this.entries(); }
}

class Response {
  constructor(raw) {
    this.status = raw.status;
    this.statusText = raw.statusText;
    this.url = raw.url;
    this.headers = new Headers(raw.headers);
    this._body = Buffer.from(raw.body);
    this.bodyUsed = false;
  }

  get ok() { return this.status >= 200 && this.status < 300; }
  get body() { return this._body; }

  _consume() {
    if (this.bodyUsed) return Promise.reject(new TypeError('Body is unusable'));
    this.bodyUsed = true;
    return Promise.resolve(this._body);
  }

  async arrayBuffer() {
    const body = await this._consume();
    return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
  }

  async bytes() { return new Uint8Array(await this._consume()); }
  async text() { return (await this._consume()).toString('utf8'); }
  async json() { return JSON.parse(await this.text()); }
}

class SyncResponse {
  constructor(raw) {
    this.status = raw.status;
    this.statusText = raw.statusText;
    this.url = raw.url;
    this.headers = new Headers(raw.headers);
    this._body = Buffer.from(raw.body);
  }

  get ok() { return this.status >= 200 && this.status < 300; }
  arrayBuffer() {
    return this._body.buffer.slice(
      this._body.byteOffset,
      this._body.byteOffset + this._body.byteLength,
    );
  }
  bytes() { return new Uint8Array(this._body); }
  text() { return this._body.toString('utf8'); }
  json() { return JSON.parse(this.text()); }
}

function close() {
  if (!initialized) return;
  native.close();
  initialized = false;
  initOptions = undefined;
}

// Close pooled TCP/HTTP2 connections while keeping the Cronet Engine alive.
// This allows a later request to perform a new TLS handshake and gives
// Cronet's external SSL session cache a chance to offer a real PSK ticket.
function closeConnections() {
  if (!initialized) return;
  native.closeConnections();
}

function normalizeWebSocketProtocols(protocols) {
  if (protocols == null) return undefined;
  if (typeof protocols === 'string') return protocols;
  if (Array.isArray(protocols)) {
    return protocols.map((protocol) => {
      if (typeof protocol !== 'string' || protocol.length === 0) {
        throw new TypeError('WebSocket subProtocols must contain non-empty strings');
      }
      return protocol;
    }).join(', ');
  }
  throw new TypeError('WebSocket subProtocols must be a string or an array of strings');
}

function websocketInitOptions(options) {
  if (!options || typeof options !== 'object') return {};
  if (options.cronet && typeof options.cronet !== 'object') {
    throw new TypeError('WebSocket cronet option must be an object');
  }
  const cronetOptions = options.cronet || {};
  const result = { ...cronetOptions };
  for (const name of [
    'libraryPath', 'dllPath', 'websocketLibraryPath', 'proxyRules',
    'skipCertVerify', 'userAgent', 'acceptLanguage', 'tlsProfile',
    'tlsProfiles', 'experimentalOptions', 'tlsExtensionIds',
    'tlsExtensionOrder', 'randomizeTlsExtensions', 'timeoutMs', 'allowRedirects',
  ]) {
    if (result[name] === undefined && options[name] !== undefined) {
      result[name] = options[name];
    }
  }
  if (options.websocketLibraryPath && !result.websocketLibraryPath) {
    result.websocketLibraryPath = options.websocketLibraryPath;
  }
  return result;
}

class CronetWebSocket {
  constructor(url, options = {}) {
    if (typeof url !== 'string' && !(url instanceof URL)) {
      throw new TypeError('WebSocket URL must be a string or URL');
    }
    const address = String(url);
    const parsed = new URL(address);
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
      throw new TypeError('WebSocket URL must use ws:// or wss://');
    }
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('WebSocket options must be an object');
    }

    const requestedBackend = options.backend == null ? 'auto' : options.backend;
    ensureInitialized(websocketInitOptions(options));
    if (!native.websocketSupported()) {
      if (requestedBackend === 'direct' || requestedBackend === 'cronet') {
        throw new Error(
          'The direct Cronet WebSocket backend was requested, but the ' +
          'selected Cronet library has no Cronet_WebSocket_* exports',
        );
      }
      if (requestedBackend === 'cycronet') {
        throw new Error(
          'The cycronet WebSocket backend was requested, but no cycronet ' +
          'C ABI WebSocket library is loaded',
        );
      }
      throw new Error(
        'The selected Cronet library does not include WebSocket support; ' +
        'use a patched Cronet library with Cronet_WebSocket_* exports or ' +
        'pass websocketLibraryPath to a cyCronet C ABI wrapper',
      );
    }

    this.url = address;
    this.readyState = CronetWebSocket.CONNECTING;
    this.protocol = '';
    this.binaryType = 'nodebuffer';
    this.bufferedAmount = 0;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this._listeners = new Map();
    this._native = null;
    this._closeRequested = false;

    const origin = options.origin == null ? undefined : String(options.origin);
    const normalizedWebSocketHeaders = normalizeWebSocketHeaders(
      options.headers,
      origin,
    );
    const subProtocols = normalizeWebSocketProtocols(
      options.subProtocols ?? options.subprotocols ?? options.protocols,
    );
    const handle = native.websocketOpen({
      url: address,
      headers: normalizedWebSocketHeaders.headers,
      origin: normalizedWebSocketHeaders.origin,
      subProtocols,
      backend: options.backend,
      callback: (event) => this._handleNativeEvent(event),
    });
    this._native = handle;
  }

  addEventListener(type, listener) {
    if (typeof listener !== 'function') return;
    let listeners = this._listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this._listeners.set(type, listeners);
    }
    listeners.add(listener);
  }

  removeEventListener(type, listener) {
    const listeners = this._listeners.get(type);
    if (listeners) listeners.delete(listener);
  }

  _dispatch(event) {
    const handler = this[`on${event.type}`];
    if (typeof handler === 'function') handler.call(this, event);
    const listeners = this._listeners.get(event.type);
    if (listeners) {
      for (const listener of [...listeners]) listener.call(this, event);
    }
  }

  _handleNativeEvent(raw) {
    if (!raw || typeof raw.type !== 'string') return;
    if (raw.type === 'open') {
      if (this.readyState !== CronetWebSocket.CONNECTING) return;
      this.readyState = CronetWebSocket.OPEN;
      this.protocol = raw.protocol || '';
      this._dispatch({ type: 'open', target: this });
      return;
    }
    if (raw.type === 'message') {
      if (this.readyState !== CronetWebSocket.OPEN) return;
      const data = raw.isText ? Buffer.from(raw.data).toString('utf8') : Buffer.from(raw.data);
      this._dispatch({ type: 'message', data, target: this });
      return;
    }
    if (raw.type === 'error') {
      if (this.readyState === CronetWebSocket.CLOSED) return;
      this.readyState = CronetWebSocket.CLOSED;
      const error = new Error(raw.message || 'Cronet WebSocket error');
      error.code = raw.netError;
      this._dispatch({ type: 'error', message: error.message, error, target: this });
      return;
    }
    if (raw.type === 'close') {
      this.readyState = CronetWebSocket.CLOSED;
      this._dispatch({
        type: 'close',
        code: raw.code,
        reason: raw.reason || '',
        wasClean: Boolean(raw.wasClean),
        target: this,
      });
    }
  }

  send(data) {
    if (this.readyState !== CronetWebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
    let buffer;
    let type;
    if (typeof data === 'string') {
      buffer = Buffer.from(data, 'utf8');
      type = 'text';
    } else if (Buffer.isBuffer(data)) {
      buffer = Buffer.from(data);
      type = 'binary';
    } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      buffer = bodyToBuffer(data);
      type = 'binary';
    } else {
      throw new TypeError('WebSocket data must be a string, Buffer, ArrayBuffer, or typed array');
    }
    native.websocketSend(this._native.id, buffer, type);
  }

  close(code = 1000, reason = '') {
    if (this.readyState === CronetWebSocket.CLOSED ||
        this.readyState === CronetWebSocket.CLOSING) return;
    if (!Number.isInteger(code) || code < 1000 || code > 4999) {
      throw new RangeError('WebSocket close code must be an integer from 1000 to 4999');
    }
    if (typeof reason !== 'string') throw new TypeError('WebSocket close reason must be a string');
    if (Buffer.byteLength(reason, 'utf8') > 123) {
      throw new RangeError('WebSocket close reason must be at most 123 UTF-8 bytes');
    }
    native.websocketClose(this._native.id, code, reason);
    this.readyState = CronetWebSocket.CLOSING;
    this._closeRequested = true;
  }
}

CronetWebSocket.CONNECTING = 0;
CronetWebSocket.OPEN = 1;
CronetWebSocket.CLOSING = 2;
CronetWebSocket.CLOSED = 3;

module.exports = {
  fetch,
  fetchStream,
  fetchSync,
  requestSync: fetchSync,
  init,
  close,
  closeConnections,
  Headers,
  Response,
  SyncResponse,
  WebSocket: CronetWebSocket,
  websocket: (url, options) => new CronetWebSocket(url, options),
  tlsProfiles: TLS_PROFILES,
  // Lazily initialize the default engine so the DLL version is available
  // immediately after requiring the module.
  get version() { return ensureInitialized(); },
  get initialized() { return initialized; },
  get dllPath() { return initOptions && initOptions.dllPath; },
  get libraryPath() { return initOptions && initOptions.dllPath; },
  get engineOptions() { return initOptions ? { ...initOptions } : undefined; },
  get nativePath() { return NATIVE_PATH; },
  get websocketSupported() {
    ensureInitialized();
    return typeof native.websocketSupported === 'function' &&
      native.websocketSupported();
  },
  get tlsExtensionsSupported() {
    ensureInitialized();
    return typeof native.tlsExtensionsSupported === 'function' &&
      native.tlsExtensionsSupported();
  },
};
