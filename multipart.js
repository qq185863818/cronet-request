'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const { UnsupportedError } = require('./errors');
const { dictToSequence, isBytes, toBuffer, guessFilename } = require('./utils');
const { validateHeaderPart } = require('./utils');

function quoteHeader(value) {
  return String(value).replace(/[\\\"]/g, '\\$&').replace(/[\r\n]/g, '');
}

function readContent(value) {
  if (isBytes(value)) return toBuffer(value, 'file data');
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  if (value && typeof value === 'object') {
    if (value.data !== undefined) return readContent(value.data);
    if (value.content !== undefined) return readContent(value.content);
    if (value.path) return fs.readFileSync(String(value.path));
    if (value.fd != null) return fs.readFileSync(value.fd);
    if (typeof value.read === 'function') {
      throw new UnsupportedError('Readable multipart parts must be materialized before prepare()');
    }
  }
  if (value == null) return Buffer.alloc(0);
  return Buffer.from(String(value), 'utf8');
}

function normalizeFilePart(field, value) {
  let filename;
  let contentType;
  let headers = [];
  let content = value;
  if (Array.isArray(value)) {
    if (value.length < 2 || value.length > 4) {
      throw new TypeError(`files[${field}] must contain 2, 3, or 4 tuple items`);
    }
    [filename, content, contentType] = value;
    if (value.length === 4) headers = value[3];
  } else if (value && typeof value === 'object' && !isBytes(value)) {
    filename = value.filename;
    contentType = value.contentType ?? value.content_type;
    headers = value.headers || [];
    content = value.data !== undefined ? value.data : value.content !== undefined ? value.content : value;
  }
  if (filename == null && value && typeof value === 'object') filename = guessFilename(value);
  if (filename != null) filename = String(filename);
  const contentBuffer = readContent(content);
  const partHeaders = [];
  for (const [name, headerValue] of dictToSequence(headers)) {
    const pair = validateHeaderPart(name, headerValue);
    partHeaders.push(pair);
  }
  return { field: String(field), filename, contentType: contentType == null ? null : String(contentType), contentBuffer, headers: partHeaders };
}

function fieldValues(value) {
  if (Array.isArray(value)) return value;
  return [value];
}

function fileValues(value) {
  const isTuple = Array.isArray(value) && value.length >= 2 && value.length <= 4 && typeof value[0] === 'string';
  return isTuple ? [value] : Array.isArray(value) ? value : [value];
}

function encodeMultipart(files, data, boundary = null) {
  const selectedBoundary = boundary || `--------------------------${crypto.randomBytes(12).toString('hex')}`;
  const chunks = [];
  const addField = (name, value) => {
    chunks.push(Buffer.from(`--${selectedBoundary}\r\n`, 'utf8'));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${quoteHeader(name)}"\r\n\r\n`, 'utf8'));
    chunks.push(Buffer.from(String(value == null ? '' : value), 'utf8'));
    chunks.push(Buffer.from('\r\n', 'utf8'));
  };
  for (const [name, value] of dictToSequence(data)) {
    for (const item of fieldValues(value)) addField(name, item);
  }
  for (const [name, value] of dictToSequence(files)) {
    for (const rawPart of fileValues(value)) {
      const part = normalizeFilePart(name, rawPart);
      chunks.push(Buffer.from(`--${selectedBoundary}\r\n`, 'utf8'));
      let disposition = `Content-Disposition: form-data; name="${quoteHeader(part.field)}"`;
      if (part.filename != null) disposition += `; filename="${quoteHeader(part.filename)}"`;
      chunks.push(Buffer.from(`${disposition}\r\n`, 'utf8'));
      if (part.contentType) chunks.push(Buffer.from(`Content-Type: ${part.contentType}\r\n`, 'utf8'));
      for (const [headerName, headerValue] of part.headers) chunks.push(Buffer.from(`${headerName}: ${headerValue}\r\n`, 'utf8'));
      chunks.push(Buffer.from('\r\n', 'utf8'));
      chunks.push(part.contentBuffer);
      chunks.push(Buffer.from('\r\n', 'utf8'));
    }
  }
  chunks.push(Buffer.from(`--${selectedBoundary}--\r\n`, 'utf8'));
  return {
    body: Buffer.concat(chunks),
    boundary: selectedBoundary,
    contentType: `multipart/form-data; boundary=${selectedBoundary}`,
  };
}

module.exports = { encodeMultipart, normalizeFilePart, readContent };
