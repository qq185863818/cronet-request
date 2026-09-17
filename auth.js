'use strict';

const crypto = require('node:crypto');
const { UnsupportedError } = require('./errors');

function bytesToText(value) {
  return Buffer.isBuffer(value) ? value.toString('utf8') : String(value ?? '');
}

function basic_auth_str(username, password) {
  const user = bytesToText(username);
  const pass = bytesToText(password);
  return `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`;
}

class AuthBase {
  call() { throw new Error('AuthBase.call() is not implemented'); }
  __call__(request) { return this.call(request); }
}

class HTTPBasicAuth extends AuthBase {
  constructor(username, password) { super(); this.username = username; this.password = password; }
  call(request) { request.headers.set('Authorization', basic_auth_str(this.username, this.password)); return request; }
  equals(other) { return other instanceof HTTPBasicAuth && this.username === other.username && this.password === other.password; }
  __eq__(other) { return this.equals(other); }
}

class HTTPProxyAuth extends HTTPBasicAuth {
  call(request) { request.headers.set('Proxy-Authorization', basic_auth_str(this.username, this.password)); return request; }
}

function parseChallenge(header) {
  if (!header) return null;
  const text = String(header);
  const prefix = /^\s*Digest\s+/i.exec(text);
  if (!prefix) return null;
  const result = {};
  const body = text.slice(prefix[0].length);
  for (const match of body.matchAll(/([A-Za-z][A-Za-z0-9_-]*)\s*=\s*(?:"((?:\\.|[^"])*)"|([^,\s]+))/g)) {
    const value = match[2] !== undefined ? match[2].replace(/\\([\\"])/g, '$1') : match[3];
    result[match[1].toLowerCase()] = value;
  }
  return result;
}

function normalizeAlgorithm(value) {
  return String(value || 'MD5').toUpperCase().replace(/_/g, '-');
}

function hashName(algorithm) {
  const name = normalizeAlgorithm(algorithm).replace(/-SESS$/, '').replace(/-/g, '').toLowerCase();
  if (!['md5', 'sha', 'sha256', 'sha512'].includes(name)) throw new UnsupportedError(`Unsupported Digest algorithm: ${algorithm}`);
  return name;
}

function hashHex(algorithm, value) {
  return crypto.createHash(hashName(algorithm)).update(value).digest('hex');
}

function quote(value) { return `"${String(value).replace(/([\\"])/g, '\\$1')}"`; }

class HTTPDigestAuth extends AuthBase {
  constructor(username, password) {
    super();
    this.username = username;
    this.password = password;
    this.last_nonce = '';
    this.nonce_count = 0;
    this.chal = {};
    this._cnonce = null;
    this._body = null;
  }

  init_per_thread_state() {
    if (this.last_nonce == null) this.last_nonce = '';
    if (this.nonce_count == null) this.nonce_count = 0;
  }

  call(request) {
    this.init_per_thread_state();
    if (this.last_nonce && this.chal.nonce) {
      const header = this.build_digest_header(request.method, request.url, request.body);
      if (header) request.headers.set('Authorization', header);
    }
    request._digest_auth = this;
    return request;
  }

  __call__(request) { return this.call(request); }

  build_digest_header(method, url, body = null) {
    const challenge = this.chal || {};
    if (!challenge.realm || !challenge.nonce) return null;
    const algorithm = normalizeAlgorithm(challenge.algorithm || 'MD5');
    const baseAlgorithm = hashName(algorithm);
    const qopValues = challenge.qop ? String(challenge.qop).split(',').map((value) => value.trim().toLowerCase()) : [];
    let qop = null;
    if (qopValues.length) {
      if (qopValues.includes('auth')) qop = 'auth';
      else if (qopValues.includes('auth-int')) throw new UnsupportedError('Digest qop=auth-int is not supported');
    }
    const uri = new URL(url).pathname + new URL(url).search;
    const a1 = `${bytesToText(this.username)}:${challenge.realm}:${bytesToText(this.password)}`;
    let ha1 = hashHex(baseAlgorithm, a1);
    const cnonce = this._cnonce || crypto.randomBytes(16).toString('hex');
    this._cnonce = cnonce;
    if (algorithm.endsWith('-SESS')) ha1 = hashHex(baseAlgorithm, `${ha1}:${challenge.nonce}:${cnonce}`);
    const entity = body == null ? '' : Buffer.from(body).toString('utf8');
    const ha2 = hashHex(baseAlgorithm, `${method}:${uri}${qop === 'auth-int' ? `:${hashHex(baseAlgorithm, entity)}` : ''}`);
    let response;
    let nc;
    if (qop) {
      this.nonce_count += 1;
      nc = String(this.nonce_count).padStart(8, '0');
      response = hashHex(baseAlgorithm, `${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
    } else response = hashHex(baseAlgorithm, `${ha1}:${challenge.nonce}:${ha2}`);
    const fields = [
      `username=${quote(bytesToText(this.username))}`,
      `realm=${quote(challenge.realm)}`,
      `nonce=${quote(challenge.nonce)}`,
      `uri=${quote(uri)}`,
      `response=${quote(response)}`,
    ];
    if (challenge.opaque) fields.push(`opaque=${quote(challenge.opaque)}`);
    if (algorithm) fields.push(`algorithm=${algorithm}`);
    if (qop) fields.push(`qop=${qop}`, `nc=${nc}`, `cnonce=${quote(cnonce)}`);
    return `Digest ${fields.join(', ')}`;
  }

  handle_redirect() { this._resetNonce(); }

  _resetNonce() { this.last_nonce = ''; this.nonce_count = 0; this.chal = {}; this._cnonce = null; }

  handle_401(response) {
    const challenge = parseChallenge(response.headers.get('www-authenticate'));
    if (!challenge) return null;
    if (challenge.qop && !String(challenge.qop).toLowerCase().split(',').some((value) => value.trim() === 'auth')) {
      throw new UnsupportedError('Digest challenge does not offer qop=auth');
    }
    this.chal = challenge;
    if (this.last_nonce !== challenge.nonce) this.nonce_count = 0;
    this.last_nonce = challenge.nonce;
    return this.build_digest_header(response.request.method, response.request.url, response.request.body);
  }

  __eq__(other) { return other instanceof HTTPDigestAuth && this.username === other.username && this.password === other.password; }
}

function normalizeAuth(auth) {
  if (auth == null) return null;
  if (Array.isArray(auth) && auth.length === 2) return new HTTPBasicAuth(auth[0], auth[1]);
  if (typeof auth === 'function' || (auth && (typeof auth.__call__ === 'function' || typeof auth.call === 'function'))) return auth;
  throw new TypeError('auth must be [username, password] or a callable Auth object');
}

function applyAuth(auth, request) {
  if (!auth) return request;
  const fn = typeof auth === 'function' ? auth : typeof auth.__call__ === 'function' ? auth.__call__.bind(auth) : auth.call.bind(auth);
  const result = fn(request);
  return result || request;
}

module.exports = {
  AuthBase,
  HTTPBasicAuth,
  HTTPProxyAuth,
  HTTPDigestAuth,
  basic_auth_str,
  _basic_auth_str: basic_auth_str,
  parseChallenge,
  normalizeAuth,
  applyAuth,
};
