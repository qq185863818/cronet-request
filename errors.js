'use strict';

class RequestException extends Error {
  constructor(message = '', options = {}) {
    super(String(message));
    this.name = this.constructor.name;
    if (options.cause !== undefined) this.cause = options.cause;
    if (options.request !== undefined) this.request = options.request;
    if (options.response !== undefined) this.response = options.response;
    if (options.code !== undefined) this.code = options.code;
  }
}

class InvalidJSONError extends RequestException {}
class HTTPError extends RequestException {}
class ConnectionError extends RequestException {}
class ProxyError extends ConnectionError {}
class SSLError extends ConnectionError {}
class Timeout extends ConnectionError {}
class ConnectTimeout extends Timeout {}
class ReadTimeout extends Timeout {}
class URLRequired extends RequestException {}
class TooManyRedirects extends RequestException {}
class MissingSchema extends RequestException {}
class InvalidSchema extends RequestException {}
class InvalidURL extends RequestException {}
class InvalidProxyURL extends InvalidURL {}
class InvalidHeader extends RequestException {}
class ChunkedEncodingError extends RequestException {}
class ContentDecodingError extends RequestException {}
class StreamConsumedError extends RequestException {}
class RetryError extends RequestException {}
class UnrewindableBodyError extends RequestException {}
class UnsupportedError extends RequestException {}
class CookieConflictError extends RequestException {}

class JSONDecodeError extends InvalidJSONError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'JSONDecodeError';
    this.position = options.position;
    this.doc = options.doc;
  }
}

class RequestsWarning extends Error {
  constructor(message) {
    super(String(message));
    this.name = this.constructor.name;
  }
}

class FileModeWarning extends RequestsWarning {}
class RequestsDependencyWarning extends RequestsWarning {}

function makeAbortError(message = 'The operation was aborted') {
  const error = new ConnectionError(message);
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

function fromTransportError(error, context = {}) {
  if (error instanceof RequestException) {
    if (context.request && !error.request) error.request = context.request;
    return error;
  }
  if (error && (error.name === 'AbortError' || error.code === 'ABORT_ERR')) {
    return makeAbortError(error.message);
  }
  const message = error && error.message ? error.message : String(error);
  const code = error && error.code;
  if (typeof code === 'string' && code.includes('CERT')) {
    return new SSLError(message, { ...context, cause: error, code });
  }
  if (code === 'ETIMEDOUT' || /timed? out|timeout/i.test(message)) {
    return new ReadTimeout(message, { ...context, cause: error, code });
  }
  if (code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'ECONNRESET') {
    return new ConnectionError(message, { ...context, cause: error, code });
  }
  return new ConnectionError(message, { ...context, cause: error, code });
}

module.exports = {
  RequestException,
  InvalidJSONError,
  JSONDecodeError,
  HTTPError,
  ConnectionError,
  ProxyError,
  SSLError,
  Timeout,
  ConnectTimeout,
  ReadTimeout,
  URLRequired,
  TooManyRedirects,
  MissingSchema,
  InvalidSchema,
  InvalidURL,
  InvalidProxyURL,
  InvalidHeader,
  ChunkedEncodingError,
  ContentDecodingError,
  StreamConsumedError,
  RetryError,
  UnrewindableBodyError,
  UnsupportedError,
  CookieConflictError,
  RequestsWarning,
  FileModeWarning,
  RequestsDependencyWarning,
  makeAbortError,
  fromTransportError,
};
