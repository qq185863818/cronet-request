'use strict';

const core = require('./cronet-core');
const { Request, PreparedRequest } = require('./request');
const { Response, SyncResponse } = require('./response');
const { Session, session, mergeSetting, defaultHeaders } = require('./session');
const { BaseAdapter } = require('./adapters/base');
const { CronetAdapter, HTTPAdapter } = require('./adapters/cronet');
const auth = require('./auth');
const cookies = require('./cookies');
const errors = require('./errors');
const headers = require('./headers');
const hooks = require('./hooks');
const status = require('./status-codes');
const utils = require('./utils');

async function withTemporaryAsyncSession(method, url, options = {}) {
  const currentSession = new Session(options.session || options);
  const response = await currentSession.asyncRequest(method, url, options);
  if (!options.stream) await currentSession.close();
  else {
    const close = response.close.bind(response);
    let closed = false;
    response.close = async () => {
      if (closed) return;
      closed = true;
      await close();
      await currentSession.close();
    };
  }
  return response;
}

function withTemporarySyncSession(method, url, options = {}) {
  const currentSession = new Session(options.session || options);
  try {
    return currentSession.request(method, url, options);
  } finally {
    currentSession.closeSync();
  }
}

function request(method, url, options = {}) { return withTemporarySyncSession(method, url, options); }
function asyncRequest(method, url, options = {}) {
  return withTemporaryAsyncSession(method, url, options);
}
function get(url, options = {}) { return request('GET', url, options); }
function options(url, options = {}) { return request('OPTIONS', url, options); }
function head(url, options = {}) { return request('HEAD', url, { allow_redirects: false, ...options }); }
function del(url, options = {}) { return request('DELETE', url, options); }
function post(url, options = {}) { return request('POST', url, options); }
function put(url, options = {}) { return request('PUT', url, options); }
function patch(url, options = {}) { return request('PATCH', url, options); }
function asyncGet(url, options = {}) { return asyncRequest('GET', url, options); }
function asyncOptions(url, options = {}) { return asyncRequest('OPTIONS', url, options); }
function asyncHead(url, options = {}) { return asyncRequest('HEAD', url, { allow_redirects: false, ...options }); }
function asyncDel(url, options = {}) { return asyncRequest('DELETE', url, options); }
function asyncPost(url, options = {}) { return asyncRequest('POST', url, options); }
function asyncPut(url, options = {}) { return asyncRequest('PUT', url, options); }
function asyncPatch(url, options = {}) { return asyncRequest('PATCH', url, options); }

const api = {
  request,
  asyncRequest,
  get,
  options,
  head,
  post,
  put,
  patch,
  delete: del,
  del,
  asyncGet,
  asyncOptions,
  asyncHead,
  asyncPost,
  asyncPut,
  asyncPatch,
  asyncDelete: asyncDel,
  asyncDel,
  session,
  Session,
  Request,
  PreparedRequest,
  Response,
  SyncResponse,
  WebSocket: core.WebSocket,
  websocket: core.websocket,
  BaseAdapter,
  CronetAdapter,
  HTTPAdapter,
  Headers: headers.Headers,
  CaseInsensitiveDict: headers.CaseInsensitiveDict,
  CaseInsensitiveHeaders: headers.CaseInsensitiveHeaders,
  RequestsCookieJar: cookies.RequestsCookieJar,
  CookieJar: cookies.CookieJar,
  Cookie: cookies.Cookie,
  auth,
  cookies,
  errors,
  hooks,
  utils,
  codes: status.codes,
  statusCodes: status.statusCodes,
  defaultHeaders,
  tlsProfiles: core.tlsProfiles,
  mergeSetting,
  init: core.init,
  close: core.close,
  closeConnections: core.closeConnections,
  fetch: core.fetch,
  fetchStream: core.fetchStream,
  fetchSync: core.fetchSync,
  cronet: core,
};

Object.assign(api, {
  ...errors,
  ...auth,
  ...cookies,
  ...utils,
});

Object.defineProperties(api, {
  version: { enumerable: true, get: () => core.version },
  initialized: { enumerable: true, get: () => core.initialized },
  nativePath: { enumerable: true, get: () => core.nativePath },
  dllPath: { enumerable: true, get: () => core.dllPath },
  libraryPath: { enumerable: true, get: () => core.libraryPath },
  websocketSupported: { enumerable: true, get: () => core.websocketSupported },
  tlsExtensionsSupported: { enumerable: true, get: () => core.tlsExtensionsSupported },
});

module.exports = api;
module.exports.default = api;
