'use strict';

const cronet = require('../cronet-core');
const { BaseAdapter } = require('./base');
const {
  InvalidProxyURL,
  ProxyError,
  SSLError,
  UnsupportedError,
  ReadTimeout,
  fromTransportError,
} = require('../errors');
const { selectProxy } = require('../utils');

function timeoutValue(value) {
  if (value == null) return undefined;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) throw new TypeError('timeout must be a non-negative finite number');
    return value;
  }
  if (typeof value !== 'object') throw new TypeError('timeout must be a number or { connect, read }');
  const values = [value.connect, value.read].filter((item) => item != null).map(Number);
  if (values.some((item) => !Number.isFinite(item) || item < 0)) throw new TypeError('timeout values must be non-negative finite numbers');
  return values.length ? Math.max(...values) : undefined;
}

function proxyDetails(proxy) {
  if (!proxy) return { rule: '', authorization: null, key: '' };
  let parsed;
  try { parsed = new URL(String(proxy)); } catch (error) {
    throw new InvalidProxyURL(`Invalid proxy URL: ${proxy}`, { cause: error });
  }
  if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(parsed.protocol)) {
    throw new InvalidProxyURL(`Unsupported proxy scheme: ${parsed.protocol}`);
  }
  const hasCredentials = Boolean(parsed.username || parsed.password);
  const auth = hasCredentials
    ? [decodeURIComponent(parsed.username), decodeURIComponent(parsed.password)]
    : null;
  const isSocks = parsed.protocol === 'socks5:' || parsed.protocol === 'socks5h:';
  const socksScheme = parsed.protocol === 'socks5h:' ? 'socks5:' : parsed.protocol;
  const credentials = hasCredentials ? `${parsed.username}:${parsed.password}@` : '';
  const rule = `${socksScheme}//${isSocks ? credentials : ''}${parsed.host}`;
  parsed.username = '';
  parsed.password = '';
  parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';
  return {
    rule,
    authorization: !isSocks && auth
      ? `Basic ${Buffer.from(`${auth[0]}:${auth[1]}`, 'utf8').toString('base64')}`
      : null,
    key: rule,
    isSocks,
  };
}

class CronetAdapter extends BaseAdapter {
  constructor(options = {}) {
    super();
    this.options = { ...options };
    this._engineKey = null;
    this._closed = false;
    CronetAdapter._openAdapters += 1;
  }

  _ensureEngine(options, proxy) {
    const tls = options.tls && typeof options.tls === 'object' && !Array.isArray(options.tls)
      ? options.tls : {};
    const tlsProfile = options.tlsProfile !== undefined
      ? options.tlsProfile : tls.profile;
    const tlsProfiles = options.tlsProfiles !== undefined
      ? options.tlsProfiles : tls.profiles;
    const tlsExtensionIds = options.tlsExtensionIds !== undefined
      ? options.tlsExtensionIds : tls.extensionIds;
    const tlsExtensionOrder = options.tlsExtensionOrder !== undefined
      ? options.tlsExtensionOrder : tls.extensionOrder;
    const randomizeTlsExtensions = options.randomizeTlsExtensions !== undefined
      ? options.randomizeTlsExtensions : tls.randomizeExtensions;
    const experimentalOptions = options.experimentalOptions !== undefined
      ? options.experimentalOptions : tls.experimentalOptions;
    const verify = options.verify === undefined ? true : options.verify;
    if (typeof verify === 'string') throw new UnsupportedError('verify CA paths are not supported by this Cronet patch3 addon');
    if (options.cert != null) throw new UnsupportedError('client certificates are not supported by this Cronet patch3 addon');
    const details = proxyDetails(proxy);
    const configuredProxy = details.rule || options.proxyRules || '';
    const key = JSON.stringify({
      proxy: configuredProxy,
      verify: verify !== false,
      skipCertVerify: options.skipCertVerify === true || verify === false,
      tlsProfile: tlsProfile === undefined ? '__cronet_default__' : tlsProfile,
      tlsProfiles: tlsProfiles || null,
      tlsExtensionIds: tlsExtensionIds || tlsExtensionOrder || null,
      randomizeTlsExtensions,
      experimentalOptions: experimentalOptions || null,
    });
    if (!cronet.initialized) {
      const cronetOptions = {
        enableQuic: options.enableQuic !== false,
        enableHttp2: options.enableHttp2 !== false,
        enableBrotli: options.enableBrotli !== false,
        proxyRules: configuredProxy,
        skipCertVerify: options.skipCertVerify === true || verify === false,
        userAgent: options.userAgent,
        acceptLanguage: options.acceptLanguage,
        __cronetRequestEngineKey: key,
      };
      if (tlsProfile !== undefined) cronetOptions.tlsProfile = tlsProfile;
      for (const name of [
        'storagePath',
        'cacheMode',
        'cacheMaxSize',
        'enableCheckResult',
      ]) {
        if (options[name] !== undefined) cronetOptions[name] = options[name];
      }
      if (tlsProfiles !== undefined) cronetOptions.tlsProfiles = tlsProfiles;
      if (tlsExtensionIds !== undefined) cronetOptions.tlsExtensionIds = tlsExtensionIds;
      if (tlsExtensionOrder !== undefined) cronetOptions.tlsExtensionOrder = tlsExtensionOrder;
      if (randomizeTlsExtensions !== undefined) {
        cronetOptions.randomizeTlsExtensions = randomizeTlsExtensions;
      }
      if (experimentalOptions !== undefined) {
        cronetOptions.experimentalOptions = experimentalOptions;
      }
      Object.assign(cronetOptions, options.cronet || {});
      cronet.init(cronetOptions);
      this._engineKey = key;
      CronetAdapter._sharedEngineKey = key;
      if (verify === false && !CronetAdapter._warnedInsecure) {
        CronetAdapter._warnedInsecure = true;
        process.emitWarning('TLS certificate verification is disabled for cronet-request', 'SecurityWarning');
      }
    } else if (CronetAdapter._sharedEngineKey && CronetAdapter._sharedEngineKey !== key) {
      throw new UnsupportedError('Cronet engine settings cannot change while the shared engine is initialized');
    } else if (!CronetAdapter._sharedEngineKey) {
      const current = cronet.engineOptions || {};
      const currentProxy = current.proxyRules || '';
      const currentVerify = current.skipCertVerify ? false : true;
      const currentKey = current.__cronetRequestEngineKey;
      if ((currentKey && currentKey !== key) ||
          currentProxy !== configuredProxy ||
          currentVerify !== (verify !== false)) {
        throw new UnsupportedError('Cronet engine settings do not match this request');
      }
      CronetAdapter._sharedEngineKey = key;
      this._engineKey = key;
    } else this._engineKey = key;
    return details;
  }

  async send(request, options = {}) {
    if (!request || !request.url || !request.method) throw new TypeError('CronetAdapter.send() requires a PreparedRequest');
    const proxy = selectProxy(request.url, options.proxies || {});
    const details = this._ensureEngine(options, proxy);
    const headers = request.headers.rawEntries();
    if (details.authorization && !headers.some(([name]) => name.toLowerCase() === 'proxy-authorization')) {
      headers.push(['Proxy-Authorization', details.authorization]);
    }
    const nativeOptions = {
      method: request.method,
      headers,
      body: request.body == null ? null : Buffer.from(request.body),
      timeout: timeoutValue(options.timeout),
      allowRedirects: false,
      disableCache: options.disableCache === true,
      priority: options.priority,
    };
    try {
      const raw = options.stream
        ? await cronet.fetchStream(request.url, nativeOptions)
        : await cronet.fetch(request.url, nativeOptions);
      return { raw, elapsed: 0, proxy: details.rule };
    } catch (error) {
      if (error && error.name === 'AbortError' && timeoutValue(options.timeout) !== undefined) {
        throw new ReadTimeout('Cronet request timed out', { cause: error, request });
      }
      if (details.rule && (/proxy|tunnel/i.test(error.message || '') ||
          /TUNNEL/i.test(error.code || ''))) {
        throw new ProxyError(error.message, { cause: error, request });
      }
      if (/certificate|tls|ssl/i.test(error.message || '')) throw new SSLError(error.message, { cause: error, request });
      throw fromTransportError(error, { request });
    }
  }

  sendSync(request, options = {}) {
    if (!request || !request.url || !request.method) {
      throw new TypeError('CronetAdapter.sendSync() requires a PreparedRequest');
    }
    if (options.stream) {
      throw new UnsupportedError('Synchronous requests do not support stream=true');
    }
    const proxy = selectProxy(request.url, options.proxies || {});
    const details = this._ensureEngine(options, proxy);
    const headers = request.headers.rawEntries();
    if (details.authorization && !headers.some(([name]) => name.toLowerCase() === 'proxy-authorization')) {
      headers.push(['Proxy-Authorization', details.authorization]);
    }
    const nativeOptions = {
      method: request.method,
      headers,
      body: request.body == null ? null : Buffer.from(request.body),
      timeout: timeoutValue(options.timeout),
      allowRedirects: false,
      disableCache: options.disableCache === true,
      priority: options.priority,
    };
    try {
      const raw = cronet.fetchSync(request.url, nativeOptions);
      return { raw, elapsed: 0, proxy: details.rule };
    } catch (error) {
      if (details.rule && (/proxy|tunnel/i.test(error.message || '') ||
          /TUNNEL/i.test(error.code || ''))) {
        throw new ProxyError(error.message, { cause: error, request });
      }
      if (/certificate|tls|ssl/i.test(error.message || '')) {
        throw new SSLError(error.message, { cause: error, request });
      }
      throw fromTransportError(error, { request });
    }
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    CronetAdapter._openAdapters = Math.max(0, CronetAdapter._openAdapters - 1);
    if (CronetAdapter._openAdapters === 0 && cronet.initialized) {
      cronet.close();
      CronetAdapter._sharedEngineKey = null;
    }
  }

  request_url(request, proxies) {
    return selectProxy(request.url, proxies || {}) ? request.url : request.path_url;
  }

  add_headers() {}
  proxy_headers(proxy) {
    const details = proxyDetails(proxy);
    return details.authorization ? [['Proxy-Authorization', details.authorization]] : [];
  }
  get_connection(url, proxies) { return { url, proxy: selectProxy(url, proxies || {}) }; }
  get_connection_with_tls_context(request, verify, proxies, cert) {
    return this.get_connection(request.url, proxies, verify, cert);
  }
  build_connection_pool_key_attributes(request, verify, cert = null) {
    return { url: request.url, verify, cert };
  }
  cert_verify() {}
  build_response(request, raw) { return { request, raw }; }
}

CronetAdapter._warnedInsecure = false;
CronetAdapter._openAdapters = 0;
CronetAdapter._sharedEngineKey = null;

class HTTPAdapter extends CronetAdapter {}

module.exports = { CronetAdapter, HTTPAdapter, proxyDetails, timeoutValue };
