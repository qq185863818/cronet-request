'use strict';

const { Request, PreparedRequest } = require('./request');
const { Response } = require('./response');
const { CaseInsensitiveDict } = require('./headers');
const { defaultHooks, mergeHooks, dispatchHook, dispatchHookSync } = require('./hooks');
const { SyncResponse } = require('./response');
const {
  RequestsCookieJar,
  cookiejar_from_dict,
  merge_cookies,
  extract_cookies_to_jar,
  get_cookie_header,
} = require('./cookies');
const { normalizeAuth, applyAuth, HTTPDigestAuth } = require('./auth');
const { HTTPAdapter } = require('./adapters/cronet');
const {
  appendParams,
  resolveProxies,
  selectProxy,
  getNetrcAuth,
  toBuffer,
  isBytes,
} = require('./utils');
const {
  TooManyRedirects,
  InvalidSchema,
  UnrewindableBodyError,
  UnsupportedError,
} = require('./errors');

const DEFAULT_HEADERS = {
  'User-Agent': 'python-requests/2.34.2',
  'Accept-Encoding': 'gzip, deflate, br',
  Accept: '*/*',
  Connection: 'keep-alive',
};

function hasOwn(object, property) { return Object.prototype.hasOwnProperty.call(object, property); }

function mergeSetting(requestSetting, sessionSetting, Constructor = CaseInsensitiveDict) {
  if (requestSetting == null) return sessionSetting == null ? null : cloneSetting(sessionSetting, Constructor);
  if (sessionSetting == null) return cloneSetting(requestSetting, Constructor);
  if (isMappingSetting(requestSetting) && isMappingSetting(sessionSetting)) {
    const result = cloneSetting(sessionSetting, Constructor);
    for (const [key, value] of entriesOf(requestSetting)) {
      if (value == null) result.delete ? result.delete(key) : delete result[key];
      else result.set ? result.set(key, value) : result[key] = value;
    }
    return result;
  }
  return requestSetting;
}

function isMappingSetting(value) {
  return value && typeof value === 'object' && !isBytes(value) && typeof value !== 'function';
}

function entriesOf(value) {
  if (value instanceof Map || (value && typeof value[Symbol.iterator] === 'function' && !Array.isArray(value))) return value;
  if (Array.isArray(value)) return value;
  return Object.entries(value);
}

function cloneSetting(value, Constructor) {
  if (value == null) return value;
  if (typeof value.copy === 'function') return value.copy();
  if (value instanceof Map) return new Map(value);
  if (Array.isArray(value)) return value.slice();
  if (Constructor === CaseInsensitiveDict) return new Constructor(Object.entries(value));
  return { ...value };
}

function defaultHeaders() { return new CaseInsensitiveDict(DEFAULT_HEADERS); }

async function collectIterable(value) {
  if (isBytes(value) || typeof value === 'string') return value;
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return value;
  if (typeof value[Symbol.asyncIterator] === 'function' || typeof value[Symbol.iterator] === 'function' || typeof value.on === 'function') {
    const chunks = [];
    for await (const chunk of value) chunks.push(toBuffer(chunk, 'request body'));
    return Buffer.concat(chunks);
  }
  return value;
}

async function materializeFiles(files) {
  if (!files || typeof files !== 'object') return files;
  const result = Array.isArray(files) ? [] : {};
  const entries = files instanceof Map ? [...files] : Array.isArray(files) ? files : Object.entries(files);
  for (const [name, raw] of entries) {
    const values = Array.isArray(raw) && (raw.length < 2 || typeof raw[0] === 'string') &&
      raw.length <= 4 ? [raw] : Array.isArray(raw) ? raw : [raw];
    const normalized = [];
    for (const value of values) {
      if (Array.isArray(value)) {
        const copy = value.slice();
        copy[1] = await collectIterable(copy[1]);
        normalized.push(copy);
      } else if (value && typeof value === 'object' && !isBytes(value)) {
        const copy = { ...value };
        if (copy.data !== undefined) copy.data = await collectIterable(copy.data);
        else if (copy.content !== undefined) copy.content = await collectIterable(copy.content);
        normalized.push(copy);
      } else normalized.push(await collectIterable(value));
    }
    if (Array.isArray(files)) result.push([name, normalized.length === 1 ? normalized[0] : normalized]);
    else result[name] = normalized.length === 1 ? normalized[0] : normalized;
  }
  return result;
}

function normalizeRequestOptions(options = {}) {
  const result = { ...options };
  if (result.allow_redirects === undefined && result.allowRedirects !== undefined) result.allow_redirects = result.allowRedirects;
  if (result.trust_env === undefined && result.trustEnv !== undefined) result.trust_env = result.trustEnv;
  if (result.max_redirects === undefined && result.maxRedirects !== undefined) result.max_redirects = result.maxRedirects;
  return result;
}

function cronetOptionsFromSettings(settings) {
  const result = { ...(settings.cronet || {}) };
  const tls = settings.tls;
  if (tls != null) {
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
  }
  for (const name of [
    'tlsProfile',
    'tlsProfiles',
    'tlsExtensionIds',
    'tlsExtensionOrder',
    'randomizeTlsExtensions',
    'experimentalOptions',
    'enableQuic',
    'enableHttp2',
    'enableBrotli',
    'userAgent',
    'acceptLanguage',
    'storagePath',
    'cacheMode',
    'cacheMaxSize',
    'enableCheckResult',
    'skipCertVerify',
    'proxyRules',
    'libraryPath',
    'dllPath',
    'websocketLibraryPath',
  ]) {
    if (settings[name] !== undefined) result[name] = settings[name];
  }
  return result;
}

class Session {
  constructor(options = {}) {
    const settings = normalizeRequestOptions(options);
    this.headers = new CaseInsensitiveDict(settings.headers || DEFAULT_HEADERS);
    this.auth = settings.auth == null ? null : normalizeAuth(settings.auth);
    this.proxies = { ...(settings.proxies || {}) };
    this.hooks = mergeHooks(settings.hooks, defaultHooks());
    this.params = settings.params || {};
    this.stream = Boolean(settings.stream ?? false);
    this.verify = settings.verify ?? true;
    this.cert = settings.cert ?? null;
    this.max_redirects = Number(settings.max_redirects ?? 30);
    this.trust_env = settings.trust_env !== false;
    this.cookies = settings.cookies instanceof RequestsCookieJar
      ? settings.cookies.copy() : cookiejar_from_dict(settings.cookies || {});
    this.cronet_options = cronetOptionsFromSettings(settings);
    this.adapters = {};
    this._adapterOrder = [];
    this._closed = false;
    const defaultAdapter = settings.adapter || new HTTPAdapter(this.cronet_options);
    this.mount('https://', settings.https_adapter || defaultAdapter);
    this.mount('http://', settings.http_adapter || defaultAdapter);
  }

  __enter__() { return this; }
  __exit__() { return this.close(); }

  prepare_request(request) {
    if (!(request instanceof Request)) request = new Request(request);
    let cookies = this.cookies.copy();
    if (request.cookies) merge_cookies(cookies, request.cookies);
    let auth = request.auth != null ? request.auth : this.auth;
    if (auth == null && this.trust_env && request.url) auth = getNetrcAuth(request.url);
    const preparedOptions = {
      method: request.method,
      url: request.url,
      headers: mergeSetting(request.headers, this.headers, CaseInsensitiveDict),
      files: request.files,
      data: request.data,
      params: mergeSetting(request.params, this.params, Object),
      auth,
      cookies,
      hooks: mergeHooks(request.hooks, this.hooks),
    };
    if (request.json !== undefined || hasOwn(request._options || {}, 'json')) preparedOptions.json = request.json;
    const prepared = new Request(preparedOptions).prepare();
    prepared._sessionAuth = auth;
    prepared._sessionCookies = cookies;
    return prepared;
  }

  _sendOptions(settings) {
    return {
      stream: settings.stream ?? this.stream,
      timeout: settings.timeout,
      verify: settings.verify ?? this.verify,
      cert: settings.cert ?? this.cert,
      proxies: settings.proxies ?? this.proxies,
      allow_redirects: settings.allow_redirects ?? true,
      max_redirects: settings.max_redirects ?? this.max_redirects,
      priority: settings.priority,
      disableCache: settings.disableCache,
      ...this.cronet_options,
    };
  }

  request(method, url, options = {}) {
    const settings = normalizeRequestOptions(options);
    const request = new Request({ method, url, ...settings });
    const prepared = this.prepare_request(request);
    return this.sendSync(prepared, this._sendOptions(settings));
  }

  async asyncRequest(method, url, options = {}) {
    const settings = normalizeRequestOptions(options);
    const request = new Request({ method, url, ...settings });
    request.data = await collectIterable(request.data);
    request.files = await materializeFiles(request.files);
    const prepared = this.prepare_request(request);
    return this.send(prepared, this._sendOptions(settings));
  }

  get(url, options = {}) { return this.request('GET', url, options); }
  options(url, options = {}) { return this.request('OPTIONS', url, options); }
  head(url, options = {}) { return this.request('HEAD', url, { allow_redirects: false, ...options }); }
  delete(url, options = {}) { return this.request('DELETE', url, options); }
  post(url, options = {}) { return this.request('POST', url, options); }
  put(url, options = {}) { return this.request('PUT', url, options); }
  patch(url, options = {}) { return this.request('PATCH', url, options); }

  asyncGet(url, options = {}) { return this.asyncRequest('GET', url, options); }
  asyncOptions(url, options = {}) { return this.asyncRequest('OPTIONS', url, options); }
  asyncHead(url, options = {}) { return this.asyncRequest('HEAD', url, { allow_redirects: false, ...options }); }
  asyncDelete(url, options = {}) { return this.asyncRequest('DELETE', url, options); }
  asyncPost(url, options = {}) { return this.asyncRequest('POST', url, options); }
  asyncPut(url, options = {}) { return this.asyncRequest('PUT', url, options); }
  asyncPatch(url, options = {}) { return this.asyncRequest('PATCH', url, options); }

  async_request(method, url, options = {}) { return this.asyncRequest(method, url, options); }

  async send(prepared, options = {}) {
    if (!(prepared instanceof PreparedRequest)) throw new TypeError('Session.send() requires a PreparedRequest');
    const settings = {
      stream: options.stream ?? this.stream,
      timeout: options.timeout,
      verify: options.verify ?? this.verify,
      cert: options.cert ?? this.cert,
      proxies: options.proxies ?? this.proxies,
      allow_redirects: options.allow_redirects ?? true,
      max_redirects: options.max_redirects ?? this.max_redirects,
      ...options,
    };
    let currentRequest = prepared;
    let history = [];
    let redirectCount = 0;
    for (;;) {
      let response = await this._send_once(currentRequest, settings);
      response.history = history.slice();
      const auth = currentRequest._auth || currentRequest._sessionAuth;
      if (response.status_code === 401 && auth instanceof HTTPDigestAuth && !currentRequest._digestRetried) {
        const digestHeader = auth.handle_401(response);
        if (digestHeader) {
          currentRequest = currentRequest.copy();
          currentRequest.headers.set('Authorization', digestHeader);
          currentRequest._digestRetried = true;
          await response.close();
          continue;
        }
      }
      if (!settings.allow_redirects || !response.is_redirect) return response;
      if (redirectCount >= settings.max_redirects) {
        throw new TooManyRedirects(`Exceeded ${settings.max_redirects} redirects.`, {
          response,
          request: currentRequest,
        });
      }
      const nextRequest = this.build_redirect_request(response, currentRequest);
      response.next = nextRequest;
      history.push(response);
      await response.close();
      currentRequest = nextRequest;
      redirectCount += 1;
    }
  }

  async _send_once(prepared, settings) {
    const adapter = this.get_adapter(prepared.url);
    const proxies = resolveProxies(prepared, settings.proxies, this.trust_env);
    const started = Date.now();
    const transport = await adapter.send(prepared, {
      ...settings,
      proxies,
      stream: Boolean(settings.stream),
    });
    const response = new Response(transport.raw || transport, prepared, {
      elapsed: Date.now() - started,
      stream: Boolean(settings.stream),
      cookies: new RequestsCookieJar(),
    });
    extract_cookies_to_jar(response.cookies, prepared, response);
    extract_cookies_to_jar(this.cookies, prepared, response);
    const hooked = await dispatchHook('response', prepared.hooks, response, settings);
    return hooked || response;
  }

  sendSync(prepared, options = {}) {
    if (!(prepared instanceof PreparedRequest)) {
      throw new TypeError('Session.sendSync() requires a PreparedRequest');
    }
    const settings = {
      stream: options.stream ?? this.stream,
      timeout: options.timeout,
      verify: options.verify ?? this.verify,
      cert: options.cert ?? this.cert,
      proxies: options.proxies ?? this.proxies,
      allow_redirects: options.allow_redirects ?? true,
      max_redirects: options.max_redirects ?? this.max_redirects,
      ...options,
    };
    if (settings.stream) throw new UnsupportedError('Synchronous requests do not support stream=true');

    let currentRequest = prepared;
    const history = [];
    let redirectCount = 0;
    for (;;) {
      let response = this._send_onceSync(currentRequest, settings);
      response.history = history.slice();
      const auth = currentRequest._auth || currentRequest._sessionAuth;
      if (response.status_code === 401 && auth instanceof HTTPDigestAuth && !currentRequest._digestRetried) {
        const digestHeader = auth.handle_401(response);
        if (digestHeader) {
          currentRequest = currentRequest.copy();
          currentRequest.headers.set('Authorization', digestHeader);
          currentRequest._digestRetried = true;
          response.close();
          continue;
        }
      }
      if (!settings.allow_redirects || !response.is_redirect) return response;
      if (redirectCount >= settings.max_redirects) {
        throw new TooManyRedirects(`Exceeded ${settings.max_redirects} redirects.`, {
          response,
          request: currentRequest,
        });
      }
      const nextRequest = this.build_redirect_request(response, currentRequest);
      response.next = nextRequest;
      history.push(response);
      response.close();
      currentRequest = nextRequest;
      redirectCount += 1;
    }
  }

  _send_onceSync(prepared, settings) {
    const adapter = this.get_adapter(prepared.url);
    const proxies = resolveProxies(prepared, settings.proxies, this.trust_env);
    if (!adapter || typeof adapter.sendSync !== 'function') {
      throw new UnsupportedError('The selected adapter does not support synchronous requests');
    }
    const started = Date.now();
    const transport = adapter.sendSync(prepared, {
      ...settings,
      proxies,
      stream: false,
    });
    const response = new SyncResponse(transport.raw || transport, prepared, {
      elapsed: Date.now() - started,
      cookies: new RequestsCookieJar(),
    });
    extract_cookies_to_jar(response.cookies, prepared, response);
    extract_cookies_to_jar(this.cookies, prepared, response);
    const hooked = dispatchHookSync('response', prepared.hooks, response, settings);
    return hooked || response;
  }

  build_redirect_request(response, request) {
    const location = response.headers.get('location');
    const nextUrl = new URL(location, response.url || request.url).toString();
    const next = request.copy();
    const oldMethod = next.method;
    if ([301, 302].includes(response.status_code) && oldMethod !== 'HEAD' && (response.status_code === 302 || oldMethod === 'POST')) next.method = 'GET';
    if (response.status_code === 303 && oldMethod !== 'HEAD') next.method = 'GET';
    if (next.method !== oldMethod) {
      next.body = null;
      next.headers.delete('Content-Length');
      next.headers.delete('Content-Type');
      next.headers.delete('Transfer-Encoding');
    } else if (next.body && !Buffer.isBuffer(next.body)) {
      throw new UnrewindableBodyError('Cannot rewind request body for redirect', { request: next, response });
    }
    if (this.should_strip_auth(request.url, nextUrl)) next.headers.delete('Authorization');
    next.headers.delete('Proxy-Authorization');
    next.headers.delete('Cookie');
    next.url = nextUrl;
    const cookie = get_cookie_header(this.cookies, next);
    if (cookie) next.headers.set('Cookie', cookie);
    return next;
  }

  get_redirect_target(response) { return response && response.headers.get('location'); }

  should_strip_auth(oldUrl, newUrl) {
    const oldValue = new URL(oldUrl);
    const newValue = new URL(newUrl);
    if (oldValue.hostname.toLowerCase() !== newValue.hostname.toLowerCase()) return true;
    const oldPort = oldValue.port || (oldValue.protocol === 'https:' ? '443' : '80');
    const newPort = newValue.port || (newValue.protocol === 'https:' ? '443' : '80');
    if (oldValue.protocol === 'http:' && newValue.protocol === 'https:' && oldPort === '80' && newPort === '443') return false;
    return oldValue.protocol !== newValue.protocol || oldPort !== newPort;
  }

  rebuild_auth(preparedRequest, response) {
    if (this.should_strip_auth(response.request.url, preparedRequest.url)) preparedRequest.headers.delete('Authorization');
    return preparedRequest;
  }

  rebuild_proxies(preparedRequest, proxies) {
    preparedRequest.headers.delete('Proxy-Authorization');
    return preparedRequest;
  }

  rebuild_method(preparedRequest, response) { return this.build_redirect_request(response, preparedRequest); }

  async *resolve_redirects(response, request, options = {}) {
    let currentResponse = response;
    let currentRequest = request;
    let count = 0;
    while (currentResponse && currentResponse.is_redirect) {
      if (count++ >= (options.max_redirects ?? this.max_redirects)) throw new TooManyRedirects('Exceeded redirect limit', { response: currentResponse, request: currentRequest });
      const next = this.build_redirect_request(currentResponse, currentRequest);
      if (options.yield_requests) yield next;
      else {
        await currentResponse.close();
        currentResponse = await this.send(next, { ...options, allow_redirects: false });
        currentResponse.history = [...(response.history || []), response];
        yield currentResponse;
      }
      currentRequest = next;
    }
  }

  merge_environment_settings(url, proxies, stream, verify, cert) {
    return {
      proxies: resolveProxies(url, proxies, this.trust_env),
      stream: stream ?? this.stream,
      verify: verify ?? this.verify,
      cert: cert ?? this.cert,
    };
  }

  get_adapter(url) {
    const match = this._adapterOrder.find((prefix) => String(url).startsWith(prefix));
    if (!match) throw new InvalidSchema(`No connection adapters were found for '${url}'`);
    return this.adapters[match];
  }

  mount(prefix, adapter) {
    const key = String(prefix);
    const previous = this.adapters[key];
    if (previous && previous !== adapter && typeof previous.close === 'function') previous.close();
    this.adapters[key] = adapter;
    this._adapterOrder = Object.keys(this.adapters).sort((left, right) => right.length - left.length);
  }

  closeSync() {
    if (this._closed) return;
    this._closed = true;
    const seen = new Set();
    for (const adapter of Object.values(this.adapters)) {
      if (seen.has(adapter)) continue;
      seen.add(adapter);
      const result = adapter.close();
      if (result && typeof result.then === 'function') {
        throw new UnsupportedError('Synchronous Session.closeSync() cannot close an asynchronous adapter');
      }
    }
  }

  close() {
    return Promise.resolve().then(() => {
      this.closeSync();
    });
  }
}

function session(options) { return new Session(options); }

module.exports = {
  Session,
  session,
  mergeSetting,
  mergeHooks,
  defaultHeaders,
};
