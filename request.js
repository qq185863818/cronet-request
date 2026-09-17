'use strict';

const { RequestException, InvalidURL, UnsupportedError } = require('./errors');
const { CaseInsensitiveDict } = require('./headers');
const { normalizeHooks } = require('./hooks');
const { encodeMultipart } = require('./multipart');
const { normalizeAuth, applyAuth } = require('./auth');
const { cookiejar_from_dict, RequestsCookieJar, get_cookie_header } = require('./cookies');
const {
  isBytes,
  toBuffer,
  normalizeUrl,
  pathUrl,
  getAuthFromUrl,
  superLen,
} = require('./utils');

function hasOwn(object, property) { return Object.prototype.hasOwnProperty.call(object, property); }

function strictJson(value, seen = new Set()) {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError('json cannot contain NaN or Infinity');
  }
  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
    throw new TypeError(`json cannot contain ${typeof value}`);
  }
  if (value && typeof value === 'object') {
    if (seen.has(value)) throw new TypeError('json cannot contain circular references');
    seen.add(value);
    if (isBytes(value)) throw new TypeError('json cannot contain byte sequences');
    if (Array.isArray(value)) for (const item of value) strictJson(item, seen);
    else for (const item of Object.values(value)) strictJson(item, seen);
    seen.delete(value);
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError('json value is not serializable');
  return serialized;
}

function isMapping(value) {
  return value && typeof value === 'object' && !isBytes(value) &&
    !(value instanceof URL) && typeof value.read !== 'function' &&
    typeof value[Symbol.asyncIterator] !== 'function' &&
    !(typeof ReadableStream !== 'undefined' && value instanceof ReadableStream);
}

function isFileMap(value) {
  if (value instanceof Map) return value.size > 0;
  return value && typeof value === 'object' && Object.keys(value).length > 0;
}

class Request {
  constructor(options = {}) {
    if (typeof options === 'string') options = { method: options, url: arguments[1], ...(arguments[2] || {}) };
    this.method = options.method ?? null;
    this.url = options.url ?? null;
    this.headers = options.headers ?? null;
    this.files = options.files ?? null;
    this.data = options.data ?? null;
    this.params = options.params ?? null;
    this.auth = options.auth ?? null;
    this.cookies = options.cookies ?? null;
    this.hooks = options.hooks ?? null;
    this.json = hasOwn(options, 'json') ? options.json : undefined;
    this._options = { ...options };
  }

  prepare() { return new PreparedRequest().prepare(this); }

  register_hook(event, hook) {
    if (!this.hooks) this.hooks = {};
    const list = this.hooks[event] == null ? [] : Array.isArray(this.hooks[event]) ? this.hooks[event] : [this.hooks[event]];
    if (Array.isArray(hook)) list.push(...hook);
    else list.push(hook);
    this.hooks[event] = list;
    return this;
  }

  deregister_hook(event, hook) {
    const list = this.hooks && this.hooks[event];
    if (!list) return false;
    const hooks = Array.isArray(list) ? list : [list];
    const index = hooks.indexOf(hook);
    if (index < 0) return false;
    hooks.splice(index, 1);
    this.hooks[event] = hooks;
    return true;
  }

  toString() { return `<Request [${this.method || 'None'} ${this.url || 'None'}]>`; }
}

class PreparedRequest {
  constructor() {
    this.method = null;
    this.url = null;
    this.headers = new CaseInsensitiveDict();
    this.body = null;
    this.hooks = normalizeHooks();
    this._cookies = new RequestsCookieJar();
    this._bodyPosition = null;
    this._auth = null;
  }

  prepare(input = {}) {
    const source = input instanceof Request ? input : input || {};
    const method = source.method;
    const url = source.url;
    const params = source.params;
    if (method == null) throw new RequestException('method is required');
    if (url == null) throw new InvalidURL('url is required');
    this.prepare_method(method);
    this.prepare_url(url, params);
    this.prepare_headers(source.headers);
    this.prepare_body(source.data, source.files, source.json, source.json !== undefined);
    this.prepare_auth(source.auth, this.url);
    this.prepare_cookies(source.cookies);
    this.prepare_hooks(source.hooks);
    return this;
  }

  prepare_method(method) {
    const value = String(method).trim();
    if (!value) throw new RequestException('method cannot be empty');
    this.method = value.toUpperCase();
  }

  prepare_url(url, params) {
    const source = url instanceof URL ? url.toString() : String(url);
    const urlAuth = getAuthFromUrl(source);
    this._urlAuth = urlAuth;
    const parsed = new URL(normalizeUrl(source, params));
    parsed.username = '';
    parsed.password = '';
    this.url = parsed.toString();
    if (!this.url) throw new InvalidURL('url cannot be empty');
  }

  prepare_headers(headers) {
    this.headers = new CaseInsensitiveDict(headers);
  }

  prepare_body(data, files, json, hasJson = json !== undefined) {
    const hasFiles = isFileMap(files);
    let body = null;
    if (hasFiles) {
      const existingType = this.headers.get('content-type');
      const boundaryMatch = existingType && /(?:^|;)\s*boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(existingType);
      const boundary = boundaryMatch && (boundaryMatch[1] || boundaryMatch[2]);
      const encoded = encodeMultipart(files, data, boundary);
      body = encoded.body;
      if (!existingType || !/^multipart\/form-data\b/i.test(existingType) || !boundary) {
        this.headers.set('Content-Type', encoded.contentType);
      }
    } else if (hasJson && data == null) {
      body = Buffer.from(strictJson(json), 'utf8');
      if (!this.headers.has('content-type')) this.headers.set('Content-Type', 'application/json');
    } else if (data != null) {
      if (isMapping(data) && !(typeof data === 'string')) {
        const { encodeParams } = require('./utils');
        body = Buffer.from(encodeParams(data), 'utf8');
        if (!this.headers.has('content-type')) this.headers.set('Content-Type', 'application/x-www-form-urlencoded');
      } else if (isBytes(data) || typeof data === 'string') body = toBuffer(data, 'data');
      else if (data && data._materializedBody) body = Buffer.from(data._materializedBody);
      else throw new UnsupportedError('Readable or iterable request bodies must be materialized before prepare()');
    }
    if ((this.method === 'GET' || this.method === 'HEAD') && body && body.length > 0) {
      throw new RequestException(`${this.method} requests cannot have a body`);
    }
    this.body = body;
    this.prepare_content_length(body);
  }

  prepare_content_length(body) {
    if (body == null || this.headers.has('content-length')) return;
    const length = superLen(body);
    if (length != null && length > 0) this.headers.set('Content-Length', String(length));
  }

  prepare_auth(auth, url = '') {
    let selected = auth;
    if (selected == null && this._urlAuth) selected = this._urlAuth;
    if (selected == null) return;
    this._auth = normalizeAuth(selected);
    const result = applyAuth(this._auth, this);
    if (result && typeof result.then === 'function') {
      throw new UnsupportedError('Async auth callbacks must be applied by Session.asyncRequest()');
    }
    this.prepare_content_length(this.body);
  }

  prepare_cookies(cookies) {
    if (cookies == null || this.headers.has('cookie')) return;
    const jar = cookies instanceof RequestsCookieJar ? cookies : cookiejar_from_dict(cookies || {});
    this._cookies = jar.copy();
    const header = get_cookie_header(jar, this);
    if (header) this.headers.set('Cookie', header);
  }

  prepare_hooks(hooks) { this.hooks = normalizeHooks(hooks); }

  copy() {
    const result = new PreparedRequest();
    result.method = this.method;
    result.url = this.url;
    result.headers = this.headers.copy();
    result.body = Buffer.isBuffer(this.body) ? Buffer.from(this.body) : this.body;
    result.hooks = Object.fromEntries(Object.entries(this.hooks).map(([key, value]) => [key, value.slice()]));
    result._cookies = this._cookies.copy();
    result._bodyPosition = this._bodyPosition;
    result._auth = this._auth;
    result._urlAuth = this._urlAuth;
    result._digest_auth = this._digest_auth;
    return result;
  }

  get path_url() { return pathUrl(this.url); }
  pathUrl() { return this.path_url; }

  register_hook(event, hook) {
    const list = this.hooks[event] || [];
    if (Array.isArray(hook)) list.push(...hook); else list.push(hook);
    this.hooks[event] = list;
    return this;
  }

  deregister_hook(event, hook) {
    const list = this.hooks[event] || [];
    const index = list.indexOf(hook);
    if (index < 0) return false;
    list.splice(index, 1);
    return true;
  }

  toString() { return `<PreparedRequest [${this.method} ${this.url}]>`; }
}

module.exports = { Request, PreparedRequest, strictJson };
