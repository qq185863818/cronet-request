// C ABI exported by cyCronet's Rust cdll feature.
//
// This is the ABI used by the Python cyCronet WebSocket implementation. It is
// intentionally separate from Cronet_WebSocket_*: a cycronet_cloak library
// owns its Cronet engine/session and exposes WebSocket callbacks from a
// background reader thread.

#ifndef JSCRONET_CYCRONET_WEBSOCKET_C_H_
#define JSCRONET_CYCRONET_WEBSOCKET_C_H_

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct CycronetSessionConfig {
  const char* proxy_rules;
  int32_t skip_cert_verify;
  uint64_t timeout_ms;
  int32_t allow_redirects;
  const char* const* cipher_suites;
  int32_t cipher_suites_count;
  const char* const* tls_curves;
  int32_t tls_curves_count;
  const char* const* tls_extensions;
  int32_t tls_extensions_count;
} CycronetSessionConfig;

typedef void (*CycronetWsCallback)(void* user_data,
                                    int32_t event_type,
                                    int32_t is_text,
                                    int32_t code,
                                    const uint8_t* data,
                                    size_t data_len);

int32_t cycronet_init(void);
void cycronet_shutdown(void);
char* cycronet_session_create(const CycronetSessionConfig* config);
void cycronet_free_string(char* value);
int32_t cycronet_session_destroy(const char* session_id);

void* cycronet_ws_create(const char* session_id);
int32_t cycronet_ws_connect(void* websocket,
                            const char* url,
                            const char* sub_protocols,
                            const char* origin,
                            const char* extra_headers);
int32_t cycronet_ws_set_callback(void* websocket,
                                 CycronetWsCallback callback,
                                 void* user_data);
int32_t cycronet_ws_send_text(void* websocket,
                              const char* text,
                              size_t length);
int32_t cycronet_ws_send_binary(void* websocket,
                                const uint8_t* data,
                                size_t length);
int32_t cycronet_ws_close(void* websocket,
                          uint16_t code,
                          const char* reason);
void cycronet_ws_destroy(void* websocket);
const char* cycronet_version(void);

#ifdef __cplusplus
}
#endif

#endif  // JSCRONET_CYCRONET_WEBSOCKET_C_H_
