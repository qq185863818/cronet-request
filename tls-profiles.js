'use strict';

// Cronet 144's DLL default omits TLS 1.3 cipher suites from ClientHello.
// This Chrome 144-compatible ordering restores interoperability with
// TLS-1.3-only sites such as tls.peet.ws and common CDN endpoints.
const TLS_PROFILES = Object.freeze({
  chrome_144: Object.freeze({
    tls_cipher_suites: Object.freeze([
      'TLS_GREASE',
      'TLS_AES_128_GCM_SHA256',
      'TLS_AES_256_GCM_SHA384',
      'TLS_CHACHA20_POLY1305_SHA256',
      'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256',
      'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
      'TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384',
      'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384',
      'TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256',
      'TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256',
      'TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA',
      'TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA',
      'TLS_RSA_WITH_AES_128_GCM_SHA256',
      'TLS_RSA_WITH_AES_256_GCM_SHA384',
      'TLS_RSA_WITH_AES_128_CBC_SHA',
      'TLS_RSA_WITH_AES_256_CBC_SHA',
    ]),
    tls_curves: Object.freeze([
      'X25519MLKEM768',
      'X25519',
      'P-256',
      'P-384',
    ]),
    tls_extensions: Object.freeze([]),
  }),
  // Chrome 152 behavior from the cyCronet export: trust_anchors adds
  // extension 51764 while BoringSSL keeps its per-connection permutation.
  chrome_152: Object.freeze({
    tls_cipher_suites: Object.freeze([
      'TLS_GREASE',
      'TLS_AES_128_GCM_SHA256',
      'TLS_AES_256_GCM_SHA384',
      'TLS_CHACHA20_POLY1305_SHA256',
      'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256',
      'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
      'TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384',
      'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384',
      'TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256',
      'TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256',
      'TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA',
      'TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA',
      'TLS_RSA_WITH_AES_128_GCM_SHA256',
      'TLS_RSA_WITH_AES_256_GCM_SHA384',
      'TLS_RSA_WITH_AES_128_CBC_SHA',
      'TLS_RSA_WITH_AES_256_CBC_SHA',
    ]),
    tls_curves: Object.freeze([
      'X25519MLKEM768',
      'X25519',
      'P-256',
      'P-384',
    ]),
    tls_extensions: Object.freeze(['trust_anchors']),
    signature_algorithms: Object.freeze([
      '0x0a0a',
      '0x0904',
      '0x0905',
      '0x0906',
      'ecdsa_secp256r1_sha256',
      'rsa_pss_rsae_sha256',
      'rsa_pkcs1_sha256',
      'ecdsa_secp384r1_sha384',
      'rsa_pss_rsae_sha384',
      'rsa_pkcs1_sha384',
      'rsa_pss_rsae_sha512',
      'rsa_pkcs1_sha512',
    ]),
  }),
  // Fixed-order experiment reconstructed from one Chrome 152 capture. This is
  // intentionally separate from chrome_152 because application_settings turns
  // off BoringSSL's extension permutation.
  // tls_extensions is a Cronet patch control list: application_settings
  // selects ALPS 17613 and disables BoringSSL extension permutation. It is
  // not an arbitrary extension-order override.
  chrome_152_target: Object.freeze({
    tls_cipher_suites: Object.freeze([
      'TLS_GREASE',
      'TLS_AES_128_GCM_SHA256',
      'TLS_AES_256_GCM_SHA384',
      'TLS_CHACHA20_POLY1305_SHA256',
      'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256',
      'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
      'TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384',
      'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384',
      'TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256',
      'TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256',
      'TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA',
      'TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA',
      'TLS_RSA_WITH_AES_128_GCM_SHA256',
      'TLS_RSA_WITH_AES_256_GCM_SHA384',
      'TLS_RSA_WITH_AES_128_CBC_SHA',
      'TLS_RSA_WITH_AES_256_CBC_SHA',
    ]),
    tls_curves: Object.freeze([
      'X25519MLKEM768',
      'X25519',
      'P-256',
      'P-384',
    ]),
    // The current 150 patch DLL also contains the Chrome 152 empty
    // trust_anchors extension patch (51764). Keeping both controls enabled
    // gives the closest available profile to the captured request.
    tls_extensions: Object.freeze(['trust_anchors', 'application_settings']),
    // A GREASE value is treated as a placeholder by the patched BoringSSL;
    // each ClientHello replaces it with a fresh 0xNaNa value.
    signature_algorithms: Object.freeze([
      '0x0a0a',
      '0x0904',
      '0x0905',
      '0x0906',
      'ecdsa_secp256r1_sha256',
      'rsa_pss_rsae_sha256',
      'rsa_pkcs1_sha256',
      'ecdsa_secp384r1_sha384',
      'rsa_pss_rsae_sha384',
      'rsa_pkcs1_sha384',
      'rsa_pss_rsae_sha512',
      'rsa_pkcs1_sha512',
    ]),
  }),
});

module.exports = { TLS_PROFILES };
