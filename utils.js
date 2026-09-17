'use strict';

const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { InvalidHeader, InvalidURL, MissingSchema, UnrewindableBodyError } = require('./errors');

const RESERVED_UNRESERVED = /[A-Za-z0-9._~-]/;

function isBytes(value) {
  return Buffer.isBuffer(value) || value instanceof Uint8Array ||
    value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

function toBuffer(value, field = 'value') {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError(`${field} must be a string or byte sequence`);
}

function dictToSequence(value) {
  if (value == null) return [];
  if (value instanceof Map) return Array.from(value.entries());
  if (typeof value !== 'string' && value && typeof value[Symbol.iterator] === 'function' &&
      !Array.isArray(value)) return Array.from(value);
  if (Array.isArray(value)) return value.slice();
  if (typeof value === 'object') return Object.entries(value);
  throw new TypeError('value must be a mapping or key-value sequence');
}

function toKeyValList(value) {
  if (value == null) return null;
  const entries = dictToSequence(value);
  return entries.map((entry) => {
    if (!entry || entry.length !== 2) throw new TypeError('items must be [key, value] pairs');
    return [entry[0], entry[1]];
  });
}

function fromKeyValList(value) {
  if (value == null) return null;
  const result = {};
  for (const [key, item] of toKeyValList(value)) result[key] = item;
  return result;
}

function formComponent(value) {
  const text = String(value);
  const bytes = Buffer.from(text, 'utf8');
  let result = '';
  for (const byte of bytes) {
    const char = String.fromCharCode(byte);
    result += RESERVED_UNRESERVED.test(char)
      ? char
      : byte === 0x20 ? '+' : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return result;
}

function expandPairs(value) {
  const pairs = toKeyValList(value) || [];
  const result = [];
  for (const [key, raw] of pairs) {
    if (raw == null) continue;
    const values = Array.isArray(raw) || (raw && typeof raw !== 'string' &&
      !isBytes(raw) && typeof raw[Symbol.iterator] === 'function')
      ? Array.from(raw)
      : [raw];
    for (const item of values) {
      if (item == null) continue;
      result.push([String(key), String(item)]);
    }
  }
  return result;
}

function encodeParams(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (isBytes(value)) return toBuffer(value, 'params').toString('utf8');
  return expandPairs(value).map(([key, item]) => `${formComponent(key)}=${formComponent(item)}`).join('&');
}

function appendParams(url, params) {
  const encoded = encodeParams(params);
  if (!encoded) return String(url);
  const source = String(url);
  const hashIndex = source.indexOf('#');
  const fragment = hashIndex >= 0 ? source.slice(hashIndex) : '';
  const withoutFragment = hashIndex >= 0 ? source.slice(0, hashIndex) : source;
  const separator = withoutFragment.includes('?')
    ? (withoutFragment.endsWith('?') || withoutFragment.endsWith('&') ? '' : '&')
    : '?';
  return withoutFragment + separator + encoded + fragment;
}

function validateUrlInput(value) {
  if (value == null || String(value) === '') throw new MissingSchema('No URL supplied');
  const source = String(value);
  let parsed;
  try { parsed = new URL(source); } catch (error) {
    if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(source)) {
      throw new MissingSchema(`Invalid URL ${source}: No scheme supplied`);
    }
    throw new InvalidURL(`Invalid URL ${source}`, { cause: error });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new InvalidURL(`Invalid URL scheme: ${parsed.protocol}`);
  }
  if (!parsed.hostname) throw new InvalidURL(`Invalid URL ${source}: missing host`);
  if (parsed.port && (!/^\d+$/.test(parsed.port) || Number(parsed.port) > 65535)) {
    throw new InvalidURL(`Invalid URL port in ${source}`);
  }
  return parsed;
}

function normalizeUrl(value, params) {
  const parsed = validateUrlInput(value);
  const withParams = appendParams(parsed.toString(), params);
  return new URL(withParams).toString();
}

function pathUrl(value) {
  const parsed = value instanceof URL ? value : new URL(String(value));
  return `${parsed.pathname || '/'}${parsed.search || ''}`;
}

function validateHeaderPart(name, value) {
  const headerName = String(name);
  const headerValue = String(value);
  if (!headerName || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(headerName) ||
      /[\r\n]/.test(headerName) || /[\r\n]/.test(headerValue)) {
    throw new InvalidHeader(`Invalid header: ${headerName}`);
  }
  return [headerName, headerValue];
}

function getAuthFromUrl(value) {
  const parsed = validateUrlInput(value);
  if (!parsed.username && !parsed.password) return null;
  return [decodeURIComponent(parsed.username), decodeURIComponent(parsed.password)];
}

function urldefragauth(value) {
  const parsed = validateUrlInput(value);
  parsed.username = '';
  parsed.password = '';
  parsed.hash = '';
  return parsed.toString();
}

function unquoteUnreserved(value) {
  return String(value).replace(/%([0-9A-Fa-f]{2})/g, (match, hex) => {
    const char = String.fromCharCode(Number.parseInt(hex, 16));
    return RESERVED_UNRESERVED.test(char) ? char : match.toUpperCase();
  });
}

function requoteUri(value) {
  const source = unquoteUnreserved(String(value));
  return source.replace(/[^A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]/g, (char) =>
    encodeURIComponent(char));
}

function prependSchemeIfNeeded(value, scheme) {
  const source = String(value);
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(source) ? source : `${scheme}://${source}`;
}

function getEncodingFromHeaders(headers) {
  const contentType = headers && typeof headers.get === 'function'
    ? headers.get('content-type') : headers && headers['content-type'];
  if (!contentType) return null;
  const match = /(?:^|;)\s*charset\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  return (match && (match[1] || match[2]) || '').trim().toLowerCase() || null;
}

function normalizeEncoding(encoding) {
  if (!encoding) return 'utf8';
  const value = String(encoding).toLowerCase().replace(/_/g, '-');
  if (value === 'utf-8' || value === 'utf8') return 'utf8';
  if (value === 'us-ascii' || value === 'ascii') return 'ascii';
  if (value === 'iso-8859-1' || value === 'latin-1' || value === 'latin1') return 'latin1';
  if (value === 'utf-16' || value === 'utf-16le' || value === 'utf16le') return 'utf16le';
  return value;
}

function decodeBytes(value, encoding) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const normalized = normalizeEncoding(encoding);
  try { return buffer.toString(normalized); } catch { return buffer.toString('utf8'); }
}

function guessJsonUtf(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (buffer.length >= 4 && buffer[0] === 0 && buffer[1] === 0 && buffer[2] === 0) return 'utf-32be';
  if (buffer.length >= 4 && buffer[0] === 0 && buffer[1] === 0 && buffer[2] !== 0) return 'utf-32be';
  if (buffer.length >= 4 && buffer[0] !== 0 && buffer[1] === 0 && buffer[2] === 0) return 'utf-32le';
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return 'utf-16le';
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return 'utf-16be';
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return 'utf-8';
  return null;
}

function superLen(value) {
  if (value == null) return 0;
  if (typeof value === 'string') return Buffer.byteLength(value);
  if (isBytes(value)) return toBuffer(value).length;
  if (typeof value.length === 'number' && Number.isFinite(value.length)) return value.length;
  if (typeof value.byteLength === 'number' && Number.isFinite(value.byteLength)) return value.byteLength;
  if (typeof value.statSync === 'function') {
    try { return value.statSync().size; } catch {}
  }
  if (value.path) {
    try { return fs.statSync(value.path).size; } catch {}
  }
  return null;
}

function guessFilename(value) {
  if (!value || value.name == null) return null;
  const name = String(value.name);
  if (!name || name === '<stdin>') return null;
  return path.basename(name);
}

function iterSlices(value, sliceLength) {
  const buffer = toBuffer(value, 'value');
  const size = Number(sliceLength);
  if (!Number.isInteger(size) || size <= 0) throw new TypeError('slice_length must be a positive integer');
  const output = [];
  for (let offset = 0; offset < buffer.length; offset += size) output.push(buffer.subarray(offset, offset + size));
  return output;
}

function parseListHeader(value) {
  if (value == null || value === '') return [];
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function parseDictHeader(value) {
  const result = {};
  for (const item of parseListHeader(value)) {
    const index = item.indexOf('=');
    if (index < 0) result[item] = null;
    else result[item.slice(0, index).trim()] = item.slice(index + 1).trim().replace(/^"|"$/g, '');
  }
  return result;
}

function unquoteHeaderValue(value) {
  const text = String(value);
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).replace(/\\([\\"])/g, '$1');
  }
  return text;
}

function parseHeaderLinks(value) {
  const result = [];
  if (!value) return result;
  for (const item of String(value).split(/,(?=\s*<)/)) {
    const match = /^\s*<([^>]+)>\s*(.*)$/.exec(item);
    if (!match) continue;
    const link = { url: match[1] };
    for (const part of match[2].split(';')) {
      const index = part.indexOf('=');
      if (index < 0) continue;
      link[part.slice(0, index).trim()] = unquoteHeaderValue(part.slice(index + 1).trim());
    }
    result.push(link);
  }
  return result;
}

function isIpv4(value) { return net.isIP(String(value)) === 4; }
function isIpv6(value) { return net.isIP(String(value).replace(/^\[|\]$/g, '')) === 6; }

function ipv4ToNumber(value) {
  return String(value).split('.').reduce((result, octet) => (result * 256) + Number(octet), 0) >>> 0;
}

function addressInNetwork(ip, network) {
  const [address, prefixText] = String(network).split('/');
  const prefix = Number(prefixText);
  if (isIpv4(ip) && isIpv4(address) && Number.isInteger(prefix) && prefix >= 0 && prefix <= 32) {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (ipv4ToNumber(ip) & mask) === (ipv4ToNumber(address) & mask);
  }
  return false;
}

function dottedNetmask(mask) {
  const prefix = Number(mask);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) throw new TypeError('mask must be between 0 and 32');
  const number = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return [24, 16, 8, 0].map((shift) => (number >>> shift) & 255).join('.');
}

function isValidCidr(value) {
  const [address, prefix] = String(value).split('/');
  const number = Number(prefix);
  return isIpv4(address) && Number.isInteger(number) && number >= 0 && number <= 32;
}

function hostPort(value) {
  const parsed = new URL(value);
  return { host: parsed.hostname.toLowerCase().replace(/^\[|\]$/g, ''), port: parsed.port || (parsed.protocol === 'https:' ? '443' : '80') };
}

function shouldBypassProxies(url, noProxy) {
  if (!noProxy) return false;
  const { host, port } = hostPort(url);
  const entries = String(noProxy).split(',').map((item) => item.trim()).filter(Boolean);
  for (const raw of entries) {
    if (raw === '*') return true;
    let item = raw.toLowerCase();
    if (item.startsWith('[')) {
      const closing = item.indexOf(']');
      if (closing >= 0) item = item.slice(1, closing) + item.slice(closing + 1);
    }
    let itemPort = null;
    const portMatch = /:(\d+)$/.exec(item);
    if (portMatch) {
      itemPort = portMatch[1];
      item = item.slice(0, -portMatch[0].length);
    }
    if (itemPort && itemPort !== port) continue;
    if (isValidCidr(item) && addressInNetwork(host, item)) return true;
    if (item === host) return true;
    if (item.startsWith('.') && host.endsWith(item)) return true;
    if (!item.startsWith('.') && host.endsWith(`.${item}`)) return true;
  }
  return false;
}

function envValue(name) {
  return process.env[name] ?? process.env[name.toLowerCase()];
}

function getEnvironProxies(url, noProxy = envValue('NO_PROXY')) {
  if (shouldBypassProxies(url, noProxy)) return {};
  const parsed = new URL(url);
  const result = {};
  const schemeName = parsed.protocol.slice(0, -1);
  const proxy = envValue(`${schemeName.toUpperCase()}_PROXY`) || envValue('ALL_PROXY');
  if (proxy) result[schemeName] = proxy;
  return result;
}

function selectProxy(url, proxies = {}) {
  if (!proxies || typeof proxies !== 'object') return null;
  if (shouldBypassProxies(url, proxies.no_proxy || proxies.NO_PROXY)) return null;
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const candidates = [
    `${parsed.protocol}//${host}`,
    `${parsed.protocol.slice(0, -1)}://${host}`,
    parsed.protocol.slice(0, -1),
    'all',
  ];
  for (const key of candidates) {
    if (proxies[key] != null && proxies[key] !== '') return String(proxies[key]);
  }
  return null;
}

function resolveProxies(requestOrUrl, proxies, trustEnv = true) {
  const url = typeof requestOrUrl === 'string' ? requestOrUrl : requestOrUrl.url;
  const result = {};
  if (proxies && typeof proxies === 'object') Object.assign(result, proxies);
  if (trustEnv) {
    const environment = getEnvironProxies(url, result.no_proxy || result.NO_PROXY);
    for (const [key, value] of Object.entries(environment)) {
      if (result[key] == null) result[key] = value;
    }
  }
  return result;
}

function getNetrcAuth(url, raiseErrors = false) {
  let filename = envValue('NETRC');
  if (!filename) filename = process.platform === 'win32'
    ? path.join(process.env.USERPROFILE || os.homedir(), '_netrc')
    : path.join(os.homedir(), '.netrc');
  let text;
  try { text = fs.readFileSync(filename, 'utf8'); } catch (error) {
    if (raiseErrors) throw error;
    return null;
  }
  const host = new URL(url).hostname.toLowerCase();
  const tokens = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] !== 'machine' || tokens[index + 1] !== host) continue;
    let login;
    let password;
    let account;
    for (let cursor = index + 2; cursor < tokens.length && tokens[cursor] !== 'machine'; cursor += 2) {
      const key = tokens[cursor];
      const value = tokens[cursor + 1];
      if (key === 'login') login = value;
      if (key === 'password') password = value;
      if (key === 'account') account = value;
    }
    if (login != null && password != null) return [login, password, account];
  }
  return null;
}

function rewindBody(preparedRequest) {
  if (preparedRequest._bodyPosition == null || !preparedRequest.body) return;
  const body = preparedRequest.body;
  try {
    if (typeof body.seek === 'function') body.seek(preparedRequest._bodyPosition);
    else if (typeof body.position === 'number') body.position = preparedRequest._bodyPosition;
    else if (Buffer.isBuffer(body)) return;
    else throw new Error('body is not seekable');
  } catch (error) {
    throw new UnrewindableBodyError('Unable to rewind request body', { request: preparedRequest, cause: error });
  }
}

function streamDecodeResponseUnicode(iterator, response) {
  const encoding = response.encoding || getEncodingFromHeaders(response.headers) || 'utf8';
  return (async function* decode() {
    const decoder = new TextDecoder(normalizeEncoding(encoding), { fatal: false });
    for await (const chunk of iterator) yield decoder.decode(Buffer.from(chunk), { stream: true });
    const tail = decoder.decode();
    if (tail) yield tail;
  }());
}

function setEnviron(name, value, callback) {
  const previous = process.env[name];
  if (value == null) delete process.env[name];
  else process.env[name] = String(value);
  try { return callback(); } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

module.exports = {
  isBytes,
  toBuffer,
  dictToSequence,
  toKeyValList,
  fromKeyValList,
  formComponent,
  encodeParams,
  appendParams,
  validateUrlInput,
  normalizeUrl,
  pathUrl,
  validateHeaderPart,
  getAuthFromUrl,
  urldefragauth,
  unquoteUnreserved,
  requoteUri,
  prependSchemeIfNeeded,
  getEncodingFromHeaders,
  normalizeEncoding,
  decodeBytes,
  guessJsonUtf,
  superLen,
  guessFilename,
  iterSlices,
  parseListHeader,
  parseDictHeader,
  unquoteHeaderValue,
  parseHeaderLinks,
  isIpv4Address: isIpv4,
  isIpv6Address: isIpv6,
  addressInNetwork,
  dottedNetmask,
  isValidCidr,
  shouldBypassProxies,
  getEnvironProxies,
  selectProxy,
  resolveProxies,
  getNetrcAuth,
  rewindBody,
  streamDecodeResponseUnicode,
  setEnviron,
};
