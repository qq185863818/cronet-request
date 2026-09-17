'use strict';

const { CookieConflictError } = require('./errors');
const { CaseInsensitiveDict } = require('./headers');

function defaultPath(url) {
  const pathname = new URL(url).pathname || '/';
  if (!pathname.startsWith('/')) return '/';
  const index = pathname.lastIndexOf('/');
  return index <= 0 ? '/' : pathname.slice(0, index);
}

function domainMatches(host, domain, initialDot = false, specified = false) {
  const normalizedHost = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  const normalizedDomain = String(domain || '').toLowerCase().replace(/^\./, '');
  if (!normalizedDomain) return true;
  return normalizedHost === normalizedDomain ||
    ((initialDot || specified) && normalizedHost.endsWith(`.${normalizedDomain}`));
}

function pathMatches(requestPath, cookiePath) {
  const path = requestPath || '/';
  const stored = cookiePath || '/';
  if (path === stored) return true;
  if (!path.startsWith(stored)) return false;
  return stored.endsWith('/') || path[stored.length] === '/';
}

class Cookie {
  constructor(name, value, options = {}) {
    this.name = String(name);
    this.value = value == null ? '' : String(value);
    this.version = options.version ?? 0;
    this.port = options.port ?? null;
    this.port_specified = Boolean(options.port_specified ?? false);
    this.domain = options.domain ?? '';
    this.domain_specified = Boolean(options.domain_specified ?? Boolean(this.domain));
    this.domain_initial_dot = Boolean(options.domain_initial_dot ?? String(this.domain).startsWith('.'));
    this.path = options.path ?? '/';
    this.path_specified = Boolean(options.path_specified ?? true);
    this.secure = Boolean(options.secure ?? false);
    this.expires = options.expires == null ? null : Number(options.expires);
    this.discard = Boolean(options.discard ?? this.expires == null);
    this.comment = options.comment ?? null;
    this.comment_url = options.comment_url ?? null;
    this.rest = { HttpOnly: null, ...(options.rest || {}) };
    this.rfc2109 = Boolean(options.rfc2109 ?? false);
    this.sameSite = options.sameSite ?? options.samesite ?? null;
    this.creationIndex = options.creationIndex ?? 0;
  }

  get expired() { return this.expires != null && this.expires <= Math.floor(Date.now() / 1000); }

  toString() { return `${this.name}=${this.value}`; }

  toJSON() {
    return {
      name: this.name,
      value: this.value,
      domain: this.domain,
      path: this.path,
      secure: this.secure,
      expires: this.expires,
      rest: { ...this.rest },
    };
  }
}

let cookieSequence = 0;

function create_cookie(name, value, options = {}) {
  return new Cookie(name, value, { ...options, creationIndex: cookieSequence++ });
}

function cookieFromInput(name, value, options = {}) {
  if (value instanceof Cookie) return value;
  return create_cookie(name, value, options);
}

class RequestsCookieJar {
  constructor() { this._cookies = []; }

  _iter() { return this._cookies[Symbol.iterator](); }

  [Symbol.iterator]() { return this._iter(); }

  _findAll(name, domain, path) {
    return this._cookies.filter((cookie) => cookie.name === String(name) &&
      (domain == null || cookie.domain === domain) && (path == null || cookie.path === path));
  }

  _find(name, domain = null, path = null) {
    const matches = this._findAll(name, domain, path);
    if (!matches.length) throw new Error(`Cookie not found: ${name}`);
    if (matches.length > 1) throw new CookieConflictError(`There are multiple cookies with name ${name}`);
    return matches[0].value;
  }

  _find_no_duplicates(name, domain = null, path = null) { return this._find(name, domain, path); }

  set_cookie(cookie) {
    if (!(cookie instanceof Cookie)) cookie = cookieFromInput(cookie.name, cookie.value, cookie);
    this._cookies = this._cookies.filter((item) => !(item.name === cookie.name &&
      item.domain === cookie.domain && item.path === cookie.path));
    if (!cookie.expired) this._cookies.push(cookie);
    return cookie;
  }

  set(name, value, options = {}) {
    const domain = options.domain ?? '';
    const path = options.path ?? '/';
    if (value == null) {
      this._cookies = this._cookies.filter((cookie) => !(cookie.name === String(name) &&
        (options.domain == null || cookie.domain === domain) &&
        (options.path == null || cookie.path === path)));
      return null;
    }
    return this.set_cookie(cookieFromInput(name, value, { ...options, domain, path }));
  }

  get(name, defaultValue = null, domain = null, path = null) {
    if (defaultValue && typeof defaultValue === 'object' && !(defaultValue instanceof Cookie)) {
      domain = defaultValue.domain ?? null;
      path = defaultValue.path ?? null;
      defaultValue = null;
    }
    if (domain && typeof domain === 'object') {
      path = domain.path ?? null;
      domain = domain.domain ?? null;
    }
    const matches = this._findAll(name, domain, path).filter((cookie) => !cookie.expired);
    if (!matches.length) return defaultValue;
    if (matches.length > 1 && domain == null && path == null) {
      throw new CookieConflictError(`There are multiple cookies with name ${name}`);
    }
    return matches[0].value;
  }

  has(name) { return this._cookies.some((cookie) => cookie.name === String(name) && !cookie.expired); }

  keys() { return this._cookies.map((cookie) => cookie.name); }
  values() { return this._cookies.map((cookie) => cookie.value); }
  items() { return this._cookies.map((cookie) => [cookie.name, cookie.value]); }
  iterkeys() { return this.keys()[Symbol.iterator](); }
  itervalues() { return this.values()[Symbol.iterator](); }
  iteritems() { return this.items()[Symbol.iterator](); }

  list_domains() { return [...new Set(this._cookies.map((cookie) => cookie.domain))]; }
  list_paths() { return [...new Set(this._cookies.map((cookie) => cookie.path))]; }
  multiple_domains() { return this.list_domains().length > 1; }

  get_dict(domain = null, path = null) {
    const result = {};
    for (const cookie of this._cookies) {
      if (cookie.expired) continue;
      if (domain != null && cookie.domain !== domain) continue;
      if (path != null && cookie.path !== path) continue;
      result[cookie.name] = cookie.value;
    }
    return result;
  }

  update(other) {
    if (!other) return this;
    if (other instanceof RequestsCookieJar || other instanceof CookieJar) {
      for (const cookie of other) this.set_cookie(new Cookie(cookie.name, cookie.value, { ...cookie }));
      return this;
    }
    if (other instanceof Map) {
      for (const [name, value] of other) this.set(name, value);
      return this;
    }
    if (typeof other === 'object') {
      for (const [name, value] of Object.entries(other)) {
        if (value != null) this.set(name, value);
      }
    }
    return this;
  }

  copy() {
    const jar = new RequestsCookieJar();
    for (const cookie of this) jar.set_cookie(new Cookie(cookie.name, cookie.value, { ...cookie, rest: { ...cookie.rest } }));
    return jar;
  }

  clear(domain = null, path = null, name = null) {
    if (domain == null && path == null && name == null) {
      this._cookies = [];
      return;
    }
    this._cookies = this._cookies.filter((cookie) => {
      if (domain != null && cookie.domain !== domain) return true;
      if (path != null && cookie.path !== path) return true;
      if (name != null && cookie.name !== name) return true;
      return false;
    });
  }

  clear_expired_cookies() { this._cookies = this._cookies.filter((cookie) => !cookie.expired); }
  clear_session_cookies() { this._cookies = this._cookies.filter((cookie) => !cookie.discard); }

  add_cookie_header(request) {
    const header = get_cookie_header(this, request);
    if (header && request.headers && !request.headers.has('cookie')) request.headers.set('Cookie', header);
    return header;
  }

  extract_cookies(response, request) { extract_cookies_to_jar(this, request, response); }

  get_policy() { return null; }
  set_policy() {}

  [Symbol.toStringTag]() { return 'RequestsCookieJar'; }
}

const CookieJar = RequestsCookieJar;

function cookiejar_from_dict(cookieDict, jar = null, overwrite = true) {
  const result = jar || new RequestsCookieJar();
  for (const [name, value] of Object.entries(cookieDict || {})) {
    if (!overwrite && result.has(name)) continue;
    result.set(name, value);
  }
  return result;
}

function merge_cookies(jar, cookies) {
  if (!(jar instanceof RequestsCookieJar) && !(jar instanceof CookieJar)) {
    throw new ValueError('first argument must be a CookieJar');
  }
  if (cookies instanceof RequestsCookieJar || cookies instanceof CookieJar) jar.update(cookies);
  else if (cookies && typeof cookies === 'object') jar.update(cookies);
  return jar;
}

class ValueError extends Error {}

function get_cookie_header(jar, request) {
  if (!jar || !request || !request.url) return null;
  const parsed = new URL(request.url);
  const matches = [...jar].filter((cookie) => !cookie.expired &&
    domainMatches(parsed.hostname, cookie.domain, cookie.domain_initial_dot, cookie.domain_specified) &&
    pathMatches(parsed.pathname || '/', cookie.path) &&
    (!cookie.secure || parsed.protocol === 'https:'))
    .sort((left, right) => (right.path.length - left.path.length) || (left.creationIndex - right.creationIndex));
  return matches.length ? matches.map((cookie) => cookie.toString()).join('; ') : null;
}

function parseSetCookie(value, requestUrl) {
  const pieces = String(value).split(';');
  const first = pieces.shift();
  const split = first.indexOf('=');
  if (split <= 0) return null;
  const name = first.slice(0, split).trim();
  const cookieValue = first.slice(split + 1).trim();
  const request = new URL(requestUrl);
  const options = {
    domain: request.hostname,
    domain_specified: false,
    domain_initial_dot: false,
    path: defaultPath(requestUrl),
    path_specified: false,
    discard: true,
    rest: { HttpOnly: null },
  };
  for (const rawPart of pieces) {
    const part = rawPart.trim();
    if (!part) continue;
    const index = part.indexOf('=');
    const key = (index < 0 ? part : part.slice(0, index)).trim().toLowerCase();
    const attributeValue = index < 0 ? true : part.slice(index + 1).trim();
    if (key === 'domain') {
      options.domain = String(attributeValue).toLowerCase();
      options.domain_initial_dot = options.domain.startsWith('.');
      options.domain_specified = true;
    } else if (key === 'path') {
      options.path = attributeValue || '/';
      options.path_specified = true;
    } else if (key === 'secure') options.secure = true;
    else if (key === 'httponly') options.rest.HttpOnly = null;
    else if (key === 'samesite') options.sameSite = attributeValue;
    else if (key === 'max-age') {
      const seconds = Number(attributeValue);
      if (Number.isFinite(seconds)) options.expires = Math.floor(Date.now() / 1000) + seconds;
      options.discard = false;
    } else if (key === 'expires') {
      const timestamp = Date.parse(attributeValue);
      if (!Number.isNaN(timestamp)) options.expires = Math.floor(timestamp / 1000);
      options.discard = false;
    } else if (index >= 0) options.rest[part.slice(0, index).trim()] = attributeValue;
  }
  return create_cookie(name, cookieValue, options);
}

function responseHeaders(response) {
  if (!response) return [];
  if (response.headers && typeof response.headers.getAll === 'function') {
    return response.headers.getAll('set-cookie');
  }
  if (response.headers && typeof response.headers.get === 'function') {
    const value = response.headers.get('set-cookie');
    return value ? [value] : [];
  }
  return [];
}

function extract_cookies_to_jar(jar, request, response) {
  if (!jar || !request || !request.url) return;
  for (const value of responseHeaders(response)) {
    const cookie = parseSetCookie(value, request.url);
    if (cookie) jar.set_cookie(cookie);
  }
}

function remove_cookie_by_name(jar, name, domain = null, path = null) {
  jar._cookies = jar._cookies.filter((cookie) => !(cookie.name === String(name) &&
    (domain == null || cookie.domain === domain) && (path == null || cookie.path === path)));
}

function morsel_to_cookie(morsel) {
  const options = {};
  for (const [key, value] of Object.entries(morsel || {})) {
    if (key === 'secure') options.secure = Boolean(value);
    else if (key === 'path' || key === 'domain') options[key] = value;
    else if (key === 'expires') {
      const timestamp = Date.parse(value);
      if (!Number.isNaN(timestamp)) options.expires = Math.floor(timestamp / 1000);
    } else if (key !== 'value' && key !== 'coded_value') options.rest = { ...(options.rest || {}), [key]: value };
  }
  return create_cookie(morsel.key, morsel.value, options);
}

class MockRequest {
  constructor(request) { this.request = request; this.headers = new CaseInsensitiveDict(); }
  get_type() { return new URL(this.request.url).protocol.slice(0, -1); }
  get_host() { return new URL(this.request.url).host; }
  get_origin_req_host() { return new URL(this.request.url).hostname; }
  get_full_url() { return this.request.url; }
  is_unverifiable() { return true; }
  has_header(name) { return this.headers.has(name) || this.request.headers.has(name); }
  get_header(name, defaultValue = null) { return this.headers.get(name, this.request.headers.get(name, defaultValue)); }
  add_header() { throw new Error('Cookie headers must be set through the cookie jar'); }
  add_unredirected_header(name, value) { this.headers.set(name, value); }
  get_new_headers() { return this.headers.toObject(); }
  get unverifiable() { return true; }
  get origin_req_host() { return this.get_origin_req_host(); }
  get host() { return this.get_host(); }
}

class MockResponse {
  constructor(headers) { this.headers = headers; }
  info() { return this.headers; }
  getheaders(name) { return this.headers.getAll ? this.headers.getAll(name) : [this.headers.get(name)]; }
}

module.exports = {
  Cookie,
  CookieJar,
  RequestsCookieJar,
  CookieConflictError,
  create_cookie,
  cookiejar_from_dict,
  merge_cookies,
  get_cookie_header,
  extract_cookies_to_jar,
  remove_cookie_by_name,
  morsel_to_cookie,
  MockRequest,
  MockResponse,
};
