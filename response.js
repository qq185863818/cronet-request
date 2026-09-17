'use strict';

const { CaseInsensitiveDict } = require('./headers');
const { RequestsCookieJar } = require('./cookies');
const { HTTPError, JSONDecodeError, StreamConsumedError } = require('./errors');
const {
  decodeBytes,
  getEncodingFromHeaders,
  guessJsonUtf,
  normalizeEncoding,
  parseHeaderLinks,
} = require('./utils');

const REDIRECT_STATI = new Set([301, 302, 303, 307, 308]);
const ITER_CHUNK_SIZE = 512;

function chunkBuffer(buffer, size) {
  if (size == null) return [buffer];
  const chunks = [];
  for (let offset = 0; offset < buffer.length; offset += size) chunks.push(buffer.subarray(offset, offset + size));
  return chunks;
}

function splitLines(buffer, delimiter = null) {
  const result = [];
  const separator = delimiter == null ? null : Buffer.from(delimiter);
  let start = 0;
  if (separator && separator.length) {
    for (;;) {
      const index = buffer.indexOf(separator, start);
      if (index < 0) break;
      result.push(buffer.subarray(start, index));
      start = index + separator.length;
    }
    result.push(buffer.subarray(start));
    return result;
  }
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 0x0a && buffer[index] !== 0x0d) continue;
    result.push(buffer.subarray(start, index));
    if (buffer[index] === 0x0d && buffer[index + 1] === 0x0a) index += 1;
    start = index + 1;
  }
  if (start < buffer.length || buffer.length === 0) result.push(buffer.subarray(start));
  return result;
}

class Response {
  constructor(raw = {}, request = null, options = {}) {
    this.status_code = raw.status == null ? null : Number(raw.status);
    this.statusCode = this.status_code;
    this.headers = new CaseInsensitiveDict();
    const rawHeaders = raw.headers || [];
    if (rawHeaders instanceof CaseInsensitiveDict) this.headers = rawHeaders.copy();
    else if (rawHeaders && typeof rawHeaders.keys === 'function' && typeof rawHeaders.getAll === 'function') {
      for (const name of rawHeaders.keys()) {
        for (const value of rawHeaders.getAll(name)) this.headers.append(name, value);
      }
    }
    else if (Array.isArray(rawHeaders)) {
      for (const [name, value] of rawHeaders) this.headers.append(name, value);
    } else this.headers = new CaseInsensitiveDict(rawHeaders);
    this.url = raw.url || (request && request.url) || '';
    this.reason = raw.statusText || raw.reason || null;
    this.statusText = this.reason;
    this.request = request;
    this.history = options.history ? options.history.slice() : [];
    this.cookies = options.cookies || new RequestsCookieJar();
    this.elapsed = options.elapsed ?? 0;
    this.encoding = options.encoding || getEncodingFromHeaders(this.headers);
    this.raw = raw.raw || raw;
    this._nativeResponse = raw;
    this._bodyBuffer = raw.body != null && !raw.body.getReader ? Buffer.from(raw.body) : null;
    this._stream = raw.body && typeof raw.body.getReader === 'function' ? raw.body : null;
    this._reader = null;
    this._bodyPromise = null;
    this._bodyConsumed = false;
    this._bodyClosed = false;
    this._content = null;
    this._next = null;
    this._replacement = false;
  }

  get ok() { return this.status_code != null && this.status_code < 400; }
  get body() { return this._content; }
  get content() { return this._content; }
  get apparent_encoding() { return this.encoding || 'utf-8'; }
  get is_redirect() { return REDIRECT_STATI.has(this.status_code) && this.headers.has('location'); }
  get isRedirect() { return this.is_redirect; }
  get is_permanent_redirect() { return [301, 308].includes(this.status_code) && this.headers.has('location'); }
  get isPermanentRedirect() { return this.is_permanent_redirect; }
  get next() { return this._next; }
  set next(value) { this._next = value; }
  get links() {
    const result = {};
    for (const link of parseHeaderLinks(this.headers.get('link'))) {
      if (link.rel) result[link.rel] = link;
    }
    return result;
  }

  async _readStream() {
    if (!this._stream) return Buffer.from(this._bodyBuffer || Buffer.alloc(0));
    if (this._content) return this._content;
    if (this._bodyConsumed && !this._content) throw new StreamConsumedError('The response content has already been consumed');
    this._bodyConsumed = true;
    const reader = this._reader || this._stream.getReader();
    this._reader = reader;
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
      try { reader.releaseLock(); } catch {}
      this._reader = null;
    }
    this._content = Buffer.concat(chunks, total);
    return this._content;
  }

  async bytes() {
    if (this._content) return Buffer.from(this._content);
    this._content = await this._readStream();
    return Buffer.from(this._content);
  }

  async arrayBuffer() {
    const value = await this.bytes();
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }

  async text() {
    const body = await this.bytes();
    let encoding = this.encoding;
    if (!encoding) {
      const jsonEncoding = guessJsonUtf(body);
      encoding = jsonEncoding || 'utf-8';
    }
    return decodeBytes(body, encoding);
  }

  async json(options = {}) {
    const body = await this.bytes();
    let text = body.toString('utf8');
    if (body.length >= 3 && body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) text = body.subarray(3).toString('utf8');
    try {
      return JSON.parse(text, typeof options === 'function' ? options : options.reviver);
    } catch (error) {
      throw new JSONDecodeError(error.message, { cause: error, response: this, doc: text, position: error.position });
    }
  }

  async *_byteChunks(chunkSize = 1) {
    if (this._content || this._bodyBuffer) {
      const value = this._content || this._bodyBuffer || Buffer.alloc(0);
      for (const chunk of chunkBuffer(value, chunkSize)) yield Buffer.from(chunk);
      return;
    }
    if (!this._stream) return;
    if (this._bodyConsumed) throw new StreamConsumedError('The response content has already been consumed');
    this._bodyConsumed = true;
    const reader = this._stream.getReader();
    this._reader = reader;
    const seen = [];
    let total = 0;
    try {
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        const source = Buffer.from(item.value);
        for (const chunk of chunkBuffer(source, chunkSize)) {
          seen.push(Buffer.from(chunk));
          total += chunk.length;
          yield Buffer.from(chunk);
        }
      }
      this._content = Buffer.concat(seen, total);
    } finally {
      try { reader.releaseLock(); } catch {}
      this._reader = null;
    }
  }

  async *iter_content(options = {}) {
    const chunkSize = options.chunk_size === undefined ? 1 : options.chunk_size;
    if (chunkSize !== null && (!Number.isInteger(chunkSize) || chunkSize <= 0)) throw new TypeError('chunk_size must be a positive integer or null');
    const iterator = this._byteChunks(chunkSize);
    if (!options.decode_unicode) {
      for await (const chunk of iterator) yield chunk;
      return;
    }
    const decoder = new TextDecoder(normalizeEncoding(this.encoding || getEncodingFromHeaders(this.headers) || 'utf8'));
    for await (const chunk of iterator) {
      const value = decoder.decode(chunk, { stream: true });
      if (value) yield value;
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  }

  async *iter_lines(options = {}) {
    const delimiter = options.delimiter === undefined ? null : options.delimiter;
    const chunks = this.iter_content({ chunk_size: options.chunk_size ?? ITER_CHUNK_SIZE, decode_unicode: false });
    let pending = Buffer.alloc(0);
    for await (const chunk of chunks) {
      pending = Buffer.concat([pending, Buffer.from(chunk)]);
      for (;;) {
        let index = -1;
        let separatorLength = 0;
        if (delimiter != null) {
          const separator = Buffer.from(delimiter);
          if (separator.length === 0) throw new TypeError('delimiter must not be empty');
          index = pending.indexOf(separator);
          separatorLength = separator.length;
        } else {
          for (let cursor = 0; cursor < pending.length; cursor += 1) {
            if (pending[cursor] !== 0x0a && pending[cursor] !== 0x0d) continue;
            if (pending[cursor] === 0x0d && cursor + 1 === pending.length) break;
            index = cursor;
            separatorLength = pending[cursor] === 0x0d && pending[cursor + 1] === 0x0a ? 2 : 1;
            break;
          }
        }
        if (index < 0) break;
        const line = pending.subarray(0, index);
        pending = pending.subarray(index + separatorLength);
        yield options.decode_unicode ? decodeBytes(line, this.encoding || 'utf8') : line;
      }
    }
    if (pending.length || this._content?.length === 0) yield options.decode_unicode ? decodeBytes(pending, this.encoding || 'utf8') : pending;
  }

  raise_for_status() {
    if (this.status_code == null || this.status_code < 400) return;
    const category = this.status_code >= 500 ? 'Server Error' : 'Client Error';
    const reason = this.reason ? ` ${this.reason}` : '';
    throw new HTTPError(`${this.status_code} ${category}${reason} for url: ${this.url}`, {
      response: this,
      request: this.request,
    });
  }

  async close() {
    if (this._bodyClosed) return;
    this._bodyClosed = true;
    if (this._reader) {
      try { await this._reader.cancel(); } catch {}
      try { this._reader.releaseLock(); } catch {}
      this._reader = null;
    } else if (this._stream && typeof this._stream.cancel === 'function') {
      try { await this._stream.cancel(); } catch {}
    }
    if (this.raw && typeof this.raw.close === 'function') {
      try { await this.raw.close(); } catch {}
    }
  }

  toString() { return `<Response [${this.status_code}]>`; }
}

class SyncResponse extends Response {
  constructor(raw = {}, request = null, options = {}) {
    const body = raw.body !== undefined ? raw.body : raw._body;
    super({ ...raw, body }, request, options);
    this._content = Buffer.from(body || Buffer.alloc(0));
    this._bodyBuffer = this._content;
    this._stream = null;
  }

  bytes() { return Buffer.from(this._content); }

  arrayBuffer() {
    const value = this._content;
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }

  text() {
    let encoding = this.encoding;
    if (!encoding) encoding = guessJsonUtf(this._content) || 'utf-8';
    return decodeBytes(this._content, encoding);
  }

  json(options = {}) {
    let text = this._content.toString('utf8');
    if (this._content.length >= 3 && this._content[0] === 0xef &&
        this._content[1] === 0xbb && this._content[2] === 0xbf) {
      text = this._content.subarray(3).toString('utf8');
    }
    try {
      return JSON.parse(text, typeof options === 'function' ? options : options.reviver);
    } catch (error) {
      throw new JSONDecodeError(error.message, {
        cause: error,
        response: this,
        doc: text,
        position: error.position,
      });
    }
  }

  *iter_content(options = {}) {
    const chunkSize = options.chunk_size === undefined ? 1 : options.chunk_size;
    if (chunkSize !== null && (!Number.isInteger(chunkSize) || chunkSize <= 0)) {
      throw new TypeError('chunk_size must be a positive integer or null');
    }
    const decoder = options.decode_unicode
      ? new TextDecoder(normalizeEncoding(this.encoding || getEncodingFromHeaders(this.headers) || 'utf8'))
      : null;
    for (const chunk of chunkBuffer(this._content, chunkSize)) {
      if (!decoder) yield Buffer.from(chunk);
      else {
        const value = decoder.decode(chunk, { stream: true });
        if (value) yield value;
      }
    }
    if (decoder) {
      const tail = decoder.decode();
      if (tail) yield tail;
    }
  }

  *iter_lines(options = {}) {
    const delimiter = options.delimiter === undefined ? null : options.delimiter;
    let pending = Buffer.alloc(0);
    for (const chunk of this.iter_content({
      chunk_size: options.chunk_size ?? ITER_CHUNK_SIZE,
      decode_unicode: false,
    })) {
      pending = Buffer.concat([pending, Buffer.from(chunk)]);
      for (;;) {
        let index = -1;
        let separatorLength = 0;
        if (delimiter != null) {
          const separator = Buffer.from(delimiter);
          if (separator.length === 0) throw new TypeError('delimiter must not be empty');
          index = pending.indexOf(separator);
          separatorLength = separator.length;
        } else {
          for (let cursor = 0; cursor < pending.length; cursor += 1) {
            if (pending[cursor] !== 0x0a && pending[cursor] !== 0x0d) continue;
            index = cursor;
            separatorLength = pending[cursor] === 0x0d && pending[cursor + 1] === 0x0a ? 2 : 1;
            break;
          }
        }
        if (index < 0) break;
        const line = pending.subarray(0, index);
        pending = pending.subarray(index + separatorLength);
        yield options.decode_unicode ? decodeBytes(line, this.encoding || 'utf8') : line;
      }
    }
    if (pending.length || this._content.length === 0) {
      yield options.decode_unicode ? decodeBytes(pending, this.encoding || 'utf8') : pending;
    }
  }

  close() {
    this._bodyClosed = true;
  }
}

module.exports = { Response, SyncResponse, REDIRECT_STATI, ITER_CHUNK_SIZE };
