'use strict';

const { InvalidHeader } = require('./errors');

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function validateHeaderName(name) {
  const value = String(name);
  if (!value || !TOKEN.test(value) || /[\r\n]/.test(value)) {
    throw new InvalidHeader(`Invalid header name: ${JSON.stringify(value)}`);
  }
  return value;
}

function validateHeaderValue(value) {
  const text = String(value);
  if (/\r|\n/.test(text)) {
    throw new InvalidHeader('Invalid header value: header values cannot contain CR or LF');
  }
  return text;
}

function normalizeInput(init) {
  if (init == null) return [];
  if (init instanceof CaseInsensitiveDict) return init.entries();
  if (init instanceof Map || (typeof init !== 'string' &&
      init && typeof init[Symbol.iterator] === 'function' && !Array.isArray(init))) {
    const result = [];
    for (const item of init) {
      if (!item || item.length !== 2) throw new TypeError('Header entries must be [name, value] pairs');
      result.push([item[0], item[1]]);
    }
    return result;
  }
  if (Array.isArray(init)) {
    return init.map((item) => {
      if (!Array.isArray(item) || item.length !== 2) {
        throw new TypeError('Header entries must be [name, value] pairs');
      }
      return item;
    });
  }
  if (typeof init === 'object') return Object.entries(init);
  throw new TypeError('headers must be an object or iterable');
}

class CaseInsensitiveDict {
  constructor(init) {
    this._entries = new Map();
    this._multiple = new Map();
    for (const [name, value] of normalizeInput(init)) this.set(name, value);
  }

  set(name, value) {
    const originalName = validateHeaderName(name);
    const text = validateHeaderValue(value);
    const key = originalName.toLowerCase();
    this._entries.set(key, { name: originalName, value: text });
    this._multiple.set(key, [text]);
    return this;
  }

  append(name, value) {
    const originalName = validateHeaderName(name);
    const text = validateHeaderValue(value);
    const key = originalName.toLowerCase();
    const current = this._entries.get(key);
    const values = this._multiple.get(key) || [];
    values.push(text);
    this._multiple.set(key, values);
    this._entries.set(key, {
      name: current ? current.name : originalName,
      value: values.join(', '),
    });
    return this;
  }

  _setRaw(name, value) {
    const originalName = String(name);
    const text = String(value);
    const key = originalName.toLowerCase();
    this._entries.set(key, { name: originalName, value: text });
    this._multiple.set(key, [text]);
    return this;
  }

  get(name, defaultValue = null) {
    const item = this._entries.get(String(name).toLowerCase());
    return item ? item.value : defaultValue;
  }

  getAll(name) {
    return (this._multiple.get(String(name).toLowerCase()) || []).slice();
  }

  has(name) { return this._entries.has(String(name).toLowerCase()); }

  delete(name) {
    const key = String(name).toLowerCase();
    this._multiple.delete(key);
    return this._entries.delete(key);
  }

  clear() { this._entries.clear(); this._multiple.clear(); }

  get size() { return this._entries.size; }

  entries() {
    return Array.from(this._entries.values(), ({ name, value }) => [name, value])[Symbol.iterator]();
  }

  rawEntries() {
    return Array.from(this._entries.values(), ({ name, value }) => [name, value]);
  }

  keys() { return Array.from(this._entries.values(), (item) => item.name)[Symbol.iterator](); }

  values() { return Array.from(this._entries.values(), (item) => item.value)[Symbol.iterator](); }

  lower_items() {
    return Array.from(this._entries, ([key, item]) => [key, item.value])[Symbol.iterator]();
  }

  forEach(callback, thisArg) {
    for (const [name, value] of this.entries()) callback.call(thisArg, value, name, this);
  }

  update(other, ...rest) {
    for (const [name, value] of normalizeInput(other)) this.set(name, value);
    if (rest.length) for (const [name, value] of normalizeInput(rest[0])) this.set(name, value);
    return this;
  }

  setdefault(name, defaultValue = null) {
    if (!this.has(name)) this.set(name, defaultValue);
    return this.get(name);
  }

  pop(name, defaultValue) {
    const key = String(name).toLowerCase();
    const item = this._entries.get(key);
    if (!item) {
      if (arguments.length >= 2) return defaultValue;
      throw new Error(`Header not found: ${name}`);
    }
    this._entries.delete(key);
    this._multiple.delete(key);
    return item.value;
  }

  copy() {
    return new this.constructor(this.rawEntries());
  }

  toObject() {
    const result = {};
    for (const [name, value] of this.entries()) result[name] = value;
    return result;
  }

  [Symbol.iterator]() { return this.entries(); }

  toJSON() { return this.toObject(); }

  toString() { return JSON.stringify(this.toObject()); }
}

class Headers extends CaseInsensitiveDict {}

module.exports = {
  CaseInsensitiveDict,
  CaseInsensitiveHeaders: CaseInsensitiveDict,
  Headers,
  validateHeaderName,
  validateHeaderValue,
};
