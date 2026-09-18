#include <node_api.h>
#include <uv.h>

#if defined(_WIN32)
#include <windows.h>
#else
#include <dlfcn.h>
#endif

#include "cronet_c.h"
#include "cronet_websocket_c.h"
#include "cycronet_websocket_c.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cctype>
#include <condition_variable>
#include <cstdint>
#include <cstring>
#include <deque>
#include <limits>
#include <mutex>
#include <string>
#include <utility>
#include <vector>

namespace {

struct AddonState;
struct RequestState;
struct SyncRequestState;
struct WebSocketState;

#if defined(_WIN32)
using CronetModuleHandle = HMODULE;
#else
using CronetModuleHandle = void*;
#endif

#define CRONET_SYMBOLS(X) \
  X(Cronet_Buffer_Create) \
  X(Cronet_Buffer_Destroy) \
  X(Cronet_Buffer_InitWithAlloc) \
  X(Cronet_Buffer_GetSize) \
  X(Cronet_Buffer_GetData) \
  X(Cronet_Engine_Create) \
  X(Cronet_Engine_Destroy) \
  X(Cronet_Engine_StartWithParams) \
  X(Cronet_Engine_Shutdown) \
  X(Cronet_Engine_GetVersionString) \
  X(Cronet_EngineParams_Create) \
  X(Cronet_EngineParams_Destroy) \
  X(Cronet_EngineParams_enable_check_result_set) \
  X(Cronet_EngineParams_user_agent_set) \
  X(Cronet_EngineParams_accept_language_set) \
  X(Cronet_EngineParams_storage_path_set) \
  X(Cronet_EngineParams_enable_quic_set) \
  X(Cronet_EngineParams_enable_http2_set) \
  X(Cronet_EngineParams_enable_brotli_set) \
  X(Cronet_EngineParams_http_cache_mode_set) \
  X(Cronet_EngineParams_http_cache_max_size_set) \
  X(Cronet_EngineParams_experimental_options_set) \
  X(Cronet_HttpHeader_Create) \
  X(Cronet_HttpHeader_Destroy) \
  X(Cronet_HttpHeader_name_set) \
  X(Cronet_HttpHeader_value_set) \
  X(Cronet_UrlResponseInfo_url_get) \
  X(Cronet_UrlResponseInfo_http_status_code_get) \
  X(Cronet_UrlResponseInfo_http_status_text_get) \
  X(Cronet_UrlResponseInfo_all_headers_list_size) \
  X(Cronet_UrlResponseInfo_all_headers_list_at) \
  X(Cronet_UrlRequest_Create) \
  X(Cronet_UrlRequest_Destroy) \
  X(Cronet_UrlRequest_SetClientContext) \
  X(Cronet_UrlRequest_InitWithParams) \
  X(Cronet_UrlRequest_Start) \
  X(Cronet_UrlRequest_FollowRedirect) \
  X(Cronet_UrlRequest_Read) \
  X(Cronet_UrlRequest_Cancel) \
  X(Cronet_UrlRequest_IsDone) \
  X(Cronet_UrlRequestCallback_CreateWith) \
  X(Cronet_UrlRequestCallback_Destroy) \
  X(Cronet_UrlRequestCallback_GetClientContext) \
  X(Cronet_UrlRequestCallback_SetClientContext) \
  X(Cronet_Executor_CreateWith) \
  X(Cronet_Executor_Destroy) \
  X(Cronet_Runnable_Run) \
  X(Cronet_Runnable_Destroy) \
  X(Cronet_UploadDataProvider_CreateWith) \
  X(Cronet_UploadDataProvider_Destroy) \
  X(Cronet_UploadDataProvider_GetClientContext) \
  X(Cronet_UploadDataProvider_SetClientContext) \
  X(Cronet_UploadDataSink_OnReadSucceeded) \
  X(Cronet_UploadDataSink_OnReadError) \
  X(Cronet_UploadDataSink_OnRewindSucceeded) \
  X(Cronet_UploadDataSink_OnRewindError) \
  X(Cronet_UrlRequestParams_Create) \
  X(Cronet_UrlRequestParams_Destroy) \
  X(Cronet_UrlRequestParams_http_method_set) \
  X(Cronet_UrlRequestParams_request_headers_add) \
  X(Cronet_UrlRequestParams_disable_cache_set) \
  X(Cronet_UrlRequestParams_priority_set) \
  X(Cronet_UrlRequestParams_upload_data_provider_set) \
  X(Cronet_UrlRequestParams_allow_direct_executor_set) \
  X(Cronet_Error_error_code_get) \
  X(Cronet_Error_message_get) \
  X(Cronet_HttpHeader_name_get) \
  X(Cronet_HttpHeader_value_get)

struct CronetApi {
  CronetModuleHandle module = nullptr;
  using ProxyRulesSetter = void (*)(Cronet_EngineParamsPtr,
                                    const Cronet_String);
  using BoolSetter = void (*)(Cronet_EngineParamsPtr, bool);
  using ExperimentalOptionsWithTlsExtensionsSetter = void (*)(
      Cronet_EngineParamsPtr,
      const Cronet_String,
      const uint64_t*,
      uint32_t,
      bool);
  ProxyRulesSetter proxy_rules_set = nullptr;
  BoolSetter skip_cert_verify_set = nullptr;
  ExperimentalOptionsWithTlsExtensionsSetter
      experimental_options_set_with_tls_extensions = nullptr;

  using WebSocketCreate = Cronet_WebSocketPtr (*)(
      Cronet_EnginePtr, const Cronet_WebSocket_Callbacks*, void*);
  using WebSocketConnect = int (*)(Cronet_WebSocketPtr, const char*,
                                   const char*, const char*, const char*);
  using WebSocketSend = int (*)(Cronet_WebSocketPtr,
                                Cronet_WebSocket_MessageType, const void*,
                                uint64_t);
  using WebSocketClose = int (*)(Cronet_WebSocketPtr, uint16_t, const char*);
  using WebSocketDestroy = void (*)(Cronet_WebSocketPtr);
  using EngineCloseAllConnections = void (*)(Cronet_EnginePtr);
  EngineCloseAllConnections close_all_connections = nullptr;
  WebSocketCreate websocket_create = nullptr;
  WebSocketConnect websocket_connect = nullptr;
  WebSocketSend websocket_send = nullptr;
  WebSocketClose websocket_close = nullptr;
  WebSocketDestroy websocket_destroy = nullptr;

#define DECLARE_SYMBOL(name) decltype(&name) name = nullptr;
  CRONET_SYMBOLS(DECLARE_SYMBOL)
#undef DECLARE_SYMBOL

  bool Load(CronetModuleHandle loaded_module, std::string* missing) {
    module = loaded_module;
#if defined(_WIN32)
#define CRONET_GET_SYMBOL(module, name) GetProcAddress(module, name)
#else
#define CRONET_GET_SYMBOL(module, name) dlsym(module, name)
#endif
#define LOAD_SYMBOL(name)                                                     \
    name = reinterpret_cast<decltype(name)>(                                  \
        CRONET_GET_SYMBOL(module, #name));                                    \
    if (!name) {                                                              \
      if (missing) *missing = #name;                                          \
      return false;                                                           \
    }
    CRONET_SYMBOLS(LOAD_SYMBOL)
    close_all_connections = reinterpret_cast<EngineCloseAllConnections>(
        CRONET_GET_SYMBOL(module, "Cronet_Engine_CloseAllConnections"));
#undef LOAD_SYMBOL
    proxy_rules_set = reinterpret_cast<ProxyRulesSetter>(
        CRONET_GET_SYMBOL(module, "Cronet_EngineParams_proxy_rules_set"));
    skip_cert_verify_set = reinterpret_cast<BoolSetter>(
        CRONET_GET_SYMBOL(module, "Cronet_EngineParams_skip_cert_verify_set"));
    experimental_options_set_with_tls_extensions =
        reinterpret_cast<ExperimentalOptionsWithTlsExtensionsSetter>(
            CRONET_GET_SYMBOL(
                module,
                "Cronet_EngineParams_experimental_options_set_with_tls_extensions"));
    websocket_create = reinterpret_cast<WebSocketCreate>(
        CRONET_GET_SYMBOL(module, "Cronet_WebSocket_Create"));
    websocket_connect = reinterpret_cast<WebSocketConnect>(
        CRONET_GET_SYMBOL(module, "Cronet_WebSocket_Connect"));
    websocket_send = reinterpret_cast<WebSocketSend>(
        CRONET_GET_SYMBOL(module, "Cronet_WebSocket_Send"));
    websocket_close = reinterpret_cast<WebSocketClose>(
        CRONET_GET_SYMBOL(module, "Cronet_WebSocket_Close"));
    websocket_destroy = reinterpret_cast<WebSocketDestroy>(
        CRONET_GET_SYMBOL(module, "Cronet_WebSocket_Destroy"));
#undef CRONET_GET_SYMBOL
    return true;
  }

  bool HasWebSocket() const {
    return websocket_create && websocket_connect && websocket_send &&
           websocket_close && websocket_destroy;
  }

  bool HasTlsExtensionSetter() const {
    return experimental_options_set_with_tls_extensions != nullptr;
  }
};

struct CycronetApi {
  CronetModuleHandle module = nullptr;

  using Init = int32_t (*)();
  using Shutdown = void (*)();
  using SessionCreate = char* (*)(const CycronetSessionConfig*);
  using FreeString = void (*)(char*);
  using SessionDestroy = int32_t (*)(const char*);
  using WebSocketCreate = void* (*)(const char*);
  using WebSocketConnect = int32_t (*)(void*, const char*, const char*,
                                       const char*, const char*);
  using WebSocketSetCallback = int32_t (*)(void*, CycronetWsCallback, void*);
  using WebSocketSendText = int32_t (*)(void*, const char*, size_t);
  using WebSocketSendBinary = int32_t (*)(void*, const uint8_t*, size_t);
  using WebSocketClose = int32_t (*)(void*, uint16_t, const char*);
  using WebSocketDestroy = void (*)(void*);
  using Version = const char* (*)();

  Init init = nullptr;
  Shutdown shutdown = nullptr;
  SessionCreate session_create = nullptr;
  FreeString free_string = nullptr;
  SessionDestroy session_destroy = nullptr;
  WebSocketCreate websocket_create = nullptr;
  WebSocketConnect websocket_connect = nullptr;
  WebSocketSetCallback websocket_set_callback = nullptr;
  WebSocketSendText websocket_send_text = nullptr;
  WebSocketSendBinary websocket_send_binary = nullptr;
  WebSocketClose websocket_close = nullptr;
  WebSocketDestroy websocket_destroy = nullptr;
  Version version = nullptr;

  bool Load(CronetModuleHandle loaded_module, std::string* missing) {
    module = loaded_module;
#if defined(_WIN32)
#define CYCRONET_GET_SYMBOL(module, name) GetProcAddress(module, name)
#else
#define CYCRONET_GET_SYMBOL(module, name) dlsym(module, name)
#endif
#define LOAD_CYCRONET_SYMBOL(field, name)                                      \
    field = reinterpret_cast<decltype(field)>(                                \
        CYCRONET_GET_SYMBOL(module, name));                                   \
    if (!field) {                                                             \
      if (missing) *missing = name;                                           \
      return false;                                                           \
    }
    LOAD_CYCRONET_SYMBOL(init, "cycronet_init")
    LOAD_CYCRONET_SYMBOL(shutdown, "cycronet_shutdown")
    LOAD_CYCRONET_SYMBOL(session_create, "cycronet_session_create")
    LOAD_CYCRONET_SYMBOL(free_string, "cycronet_free_string")
    LOAD_CYCRONET_SYMBOL(session_destroy, "cycronet_session_destroy")
    LOAD_CYCRONET_SYMBOL(websocket_create, "cycronet_ws_create")
    LOAD_CYCRONET_SYMBOL(websocket_connect, "cycronet_ws_connect")
    LOAD_CYCRONET_SYMBOL(websocket_set_callback, "cycronet_ws_set_callback")
    LOAD_CYCRONET_SYMBOL(websocket_send_text, "cycronet_ws_send_text")
    LOAD_CYCRONET_SYMBOL(websocket_send_binary, "cycronet_ws_send_binary")
    LOAD_CYCRONET_SYMBOL(websocket_close, "cycronet_ws_close")
    LOAD_CYCRONET_SYMBOL(websocket_destroy, "cycronet_ws_destroy")
    version = reinterpret_cast<Version>(CYCRONET_GET_SYMBOL(
        module, "cycronet_version"));
#undef LOAD_CYCRONET_SYMBOL
#undef CYCRONET_GET_SYMBOL
    return true;
  }

  bool HasWebSocket() const {
    return init && shutdown && session_create && free_string &&
           session_destroy && websocket_create && websocket_connect &&
           websocket_set_callback && websocket_send_text &&
           websocket_send_binary && websocket_close && websocket_destroy;
  }
};

enum class DispatchType { kRunnable, kCleanup, kStream, kWebSocket };
enum class StreamEventType { kHeaders, kChunk, kEnd, kError };
enum class WebSocketEventType { kOpen, kMessage, kClose, kError };
enum class WebSocketBackend { kCronet, kCycronet };

struct DispatchItem {
  DispatchType type;
  Cronet_RunnablePtr runnable = nullptr;
  RequestState* request = nullptr;
  StreamEventType stream_event = StreamEventType::kEnd;
  std::vector<uint8_t> stream_data;
  int stream_error_code = 0;
  std::string stream_error;
  WebSocketState* websocket = nullptr;
  WebSocketEventType websocket_event = WebSocketEventType::kClose;
  std::vector<uint8_t> websocket_data;
  std::string websocket_protocol;
  std::string websocket_error;
  int websocket_error_code = 0;
  bool websocket_is_text = false;
  bool websocket_was_clean = false;
  uint16_t websocket_close_code = 1006;
  std::string websocket_close_reason;
};

struct AddonState {
  napi_env env = nullptr;
  uv_async_t async{};
  bool async_initialized = false;
  bool cleanup_started = false;
  std::mutex dispatch_mutex;
  std::deque<DispatchItem> dispatch_queue;
  CronetApi api;
  CronetModuleHandle module = nullptr;
  std::string module_path;
  CycronetApi cycronet_api;
  CronetModuleHandle cycronet_module = nullptr;
  std::string cycronet_module_path;
  bool cycronet_started = false;
  std::string cycronet_proxy_rules;
  bool cycronet_skip_cert_verify = false;
  uint64_t cycronet_timeout_ms = 30000;
  bool cycronet_allow_redirects = true;
  std::vector<std::string> cycronet_cipher_suites;
  std::vector<std::string> cycronet_tls_curves;
  std::vector<std::string> cycronet_tls_extensions;
  Cronet_EnginePtr engine = nullptr;
  bool engine_started = false;
  uint64_t next_request_id = 1;
  std::mutex request_mutex;
  std::vector<RequestState*> requests;
  uint64_t next_websocket_id = 1;
  std::mutex websocket_mutex;
  std::vector<WebSocketState*> websockets;
};

std::atomic<AddonState*> g_addon{nullptr};

struct RequestState {
  AddonState* owner = nullptr;
  uint64_t id = 0;
  napi_deferred deferred = nullptr;
  Cronet_UrlRequestPtr request = nullptr;
  Cronet_UrlRequestCallbackPtr callback = nullptr;
  Cronet_ExecutorPtr executor = nullptr;
  Cronet_UploadDataProviderPtr upload_provider = nullptr;
  std::string url;
  std::string method;
  std::vector<uint8_t> upload_body;
  size_t upload_offset = 0;
  int32_t status = 0;
  std::string status_text;
  std::string response_url;
  std::vector<std::pair<std::string, std::string>> response_headers;
  std::vector<uint8_t> response_body;
  bool allow_redirects = true;
  bool stopped_at_redirect = false;
  bool streaming = false;
  Cronet_BufferPtr stream_buffer = nullptr;
  std::atomic_bool stream_read_pending{false};
  napi_ref stream_on_headers = nullptr;
  napi_ref stream_on_chunk = nullptr;
  napi_ref stream_on_end = nullptr;
  napi_ref stream_on_error = nullptr;
  int error_code = 0;
  std::string error_message;
  bool forced_failure = false;
  bool finish_queued = false;
};

struct SyncRequestState {
  AddonState* owner = nullptr;
  Cronet_UrlRequestPtr request = nullptr;
  Cronet_UrlRequestCallbackPtr callback = nullptr;
  Cronet_ExecutorPtr executor = nullptr;
  Cronet_UploadDataProviderPtr upload_provider = nullptr;
  std::string url;
  std::string method;
  std::vector<uint8_t> upload_body;
  size_t upload_offset = 0;
  int32_t status = 0;
  std::string status_text;
  std::string response_url;
  std::vector<std::pair<std::string, std::string>> response_headers;
  std::vector<uint8_t> response_body;
  bool allow_redirects = true;
  bool stopped_at_redirect = false;
  int error_code = 0;
  std::string error_message;
  bool forced_failure = false;
  bool succeeded = false;
  bool done = false;
  size_t callback_depth = 0;
  std::mutex mutex;
  std::condition_variable condition;
};

struct WebSocketState {
  AddonState* owner = nullptr;
  uint64_t id = 0;
  WebSocketBackend backend = WebSocketBackend::kCronet;
  Cronet_WebSocketPtr websocket = nullptr;
  void* cycronet_websocket = nullptr;
  std::string cycronet_session_id;
  napi_ref callback = nullptr;
  std::string url;
  std::mutex mutex;
  bool terminal_queued = false;
  bool error_queued = false;
  bool close_queued = false;
};

void RemoveWebSocket(WebSocketState* websocket) {
  if (!websocket || !websocket->owner) return;
  AddonState* addon = websocket->owner;
  std::lock_guard<std::mutex> lock(addon->websocket_mutex);
  auto it = std::find(addon->websockets.begin(), addon->websockets.end(),
                      websocket);
  if (it != addon->websockets.end()) addon->websockets.erase(it);
}

void ThrowError(napi_env env, const std::string& message) {
  napi_throw_error(env, nullptr, message.c_str());
}

void ThrowTypeError(napi_env env, const std::string& message) {
  napi_throw_type_error(env, nullptr, message.c_str());
}

void QueueWebSocketEvent(WebSocketState* websocket,
                         WebSocketEventType type,
                         std::vector<uint8_t> data = {},
                         bool is_text = false,
                         std::string protocol = {},
                         int error_code = 0,
                         std::string error = {},
                         bool was_clean = false,
                         uint16_t close_code = 1006,
                         std::string close_reason = {});

bool IsWebSocketTerminal(const WebSocketState* websocket) {
  return websocket && (websocket->error_queued || websocket->close_queued);
}

bool GetRequiredCallbackReference(napi_env env,
                                  napi_value object,
                                  const char* field,
                                  napi_ref* reference) {
  napi_value value;
  if (napi_get_named_property(env, object, field, &value) != napi_ok) {
    ThrowTypeError(env, std::string("streaming request requires ") + field);
    return false;
  }
  napi_valuetype type;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_function) {
    ThrowTypeError(env, std::string(field) + " must be a function");
    return false;
  }
  if (napi_create_reference(env, value, 1, reference) != napi_ok) {
    ThrowError(env, std::string("Unable to retain streaming callback ") + field);
    return false;
  }
  return true;
}

void QueueStreamEvent(RequestState* request,
                      StreamEventType type,
                      std::vector<uint8_t> data = {},
                      int error_code = 0,
                      std::string error = {}) {
  if (!request || !request->owner || request->owner->cleanup_started) return;
  AddonState* addon = request->owner;
  DispatchItem item{};
  item.type = DispatchType::kStream;
  item.request = request;
  item.stream_event = type;
  item.stream_data = std::move(data);
  item.stream_error_code = error_code;
  item.stream_error = std::move(error);
  {
    std::lock_guard<std::mutex> lock(addon->dispatch_mutex);
    addon->dispatch_queue.push_back(std::move(item));
  }
  uv_async_send(&addon->async);
}

napi_value Undefined(napi_env env) {
  napi_value value;
  napi_get_undefined(env, &value);
  return value;
}

bool IsUndefined(napi_env env, napi_value value) {
  napi_valuetype type;
  return napi_typeof(env, value, &type) == napi_ok && type == napi_undefined;
}

bool IsNull(napi_env env, napi_value value) {
  napi_valuetype type;
  return napi_typeof(env, value, &type) == napi_ok && type == napi_null;
}

bool GetStringValue(napi_env env,
                    napi_value value,
                    const char* field,
                    std::string* result) {
  napi_valuetype type;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_string) {
    ThrowTypeError(env, std::string(field) + " must be a string");
    return false;
  }
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok) {
    ThrowTypeError(env, std::string(field) + " must be a valid UTF-8 string");
    return false;
  }
  std::string buffer(length + 1, '\0');
  if (napi_get_value_string_utf8(env, value, buffer.data(), length + 1,
                                 &length) != napi_ok) {
    ThrowTypeError(env, std::string(field) + " must be a valid UTF-8 string");
    return false;
  }
  buffer.resize(length);
  *result = std::move(buffer);
  return true;
}

bool GetOptionalString(napi_env env,
                       napi_value object,
                       const char* field,
                       std::string* result) {
  bool has_property = false;
  if (napi_has_named_property(env, object, field, &has_property) != napi_ok ||
      !has_property) {
    return true;
  }
  napi_value value;
  if (napi_get_named_property(env, object, field, &value) != napi_ok ||
      IsUndefined(env, value)) {
    return true;
  }
  return GetStringValue(env, value, field, result);
}

bool GetOptionalBool(napi_env env,
                     napi_value object,
                     const char* field,
                     bool* result) {
  bool has_property = false;
  if (napi_has_named_property(env, object, field, &has_property) != napi_ok ||
      !has_property) {
    return true;
  }
  napi_value value;
  napi_valuetype type;
  if (napi_get_named_property(env, object, field, &value) != napi_ok ||
      napi_typeof(env, value, &type) != napi_ok || type == napi_undefined) {
    return true;
  }
  if (type != napi_boolean || napi_get_value_bool(env, value, result) != napi_ok) {
    ThrowTypeError(env, std::string(field) + " must be a boolean");
    return false;
  }
  return true;
}

bool GetOptionalInt64(napi_env env,
                      napi_value object,
                      const char* field,
                      int64_t* result) {
  bool has_property = false;
  if (napi_has_named_property(env, object, field, &has_property) != napi_ok ||
      !has_property) {
    return true;
  }
  napi_value value;
  napi_valuetype type;
  if (napi_get_named_property(env, object, field, &value) != napi_ok ||
      napi_typeof(env, value, &type) != napi_ok || type == napi_undefined) {
    return true;
  }
  if (type != napi_number || napi_get_value_int64(env, value, result) != napi_ok) {
    ThrowTypeError(env, std::string(field) + " must be an integer");
    return false;
  }
  return true;
}

bool GetOptionalStringArray(napi_env env,
                            napi_value object,
                            const char* field,
                            std::vector<std::string>* result) {
  bool has_property = false;
  if (napi_has_named_property(env, object, field, &has_property) != napi_ok ||
      !has_property) {
    return true;
  }
  napi_value value;
  if (napi_get_named_property(env, object, field, &value) != napi_ok ||
      IsUndefined(env, value) || IsNull(env, value)) {
    return true;
  }
  bool is_array = false;
  if (napi_is_array(env, value, &is_array) != napi_ok || !is_array) {
    ThrowTypeError(env, std::string(field) + " must be an array of strings");
    return false;
  }
  uint32_t length = 0;
  if (napi_get_array_length(env, value, &length) != napi_ok) {
    ThrowTypeError(env, std::string(field) + " must be an array of strings");
    return false;
  }
  result->clear();
  result->reserve(length);
  for (uint32_t i = 0; i < length; ++i) {
    napi_value item;
    if (napi_get_element(env, value, i, &item) != napi_ok) {
      ThrowTypeError(env, std::string(field) + " must be an array of strings");
      return false;
    }
    std::string text;
    if (!GetStringValue(env, item, field, &text)) return false;
    result->push_back(std::move(text));
  }
  return true;
}

bool GetOptionalTlsExtensionArray(napi_env env,
                                  napi_value object,
                                  const char* field,
                                  std::vector<uint64_t>* result) {
  bool has_property = false;
  if (napi_has_named_property(env, object, field, &has_property) != napi_ok ||
      !has_property) {
    return true;
  }
  napi_value value;
  if (napi_get_named_property(env, object, field, &value) != napi_ok ||
      IsUndefined(env, value) || IsNull(env, value)) {
    return true;
  }
  bool is_array = false;
  if (napi_is_array(env, value, &is_array) != napi_ok || !is_array) {
    ThrowTypeError(env, std::string(field) + " must be an array of integers");
    return false;
  }
  uint32_t length = 0;
  if (napi_get_array_length(env, value, &length) != napi_ok) {
    ThrowTypeError(env, std::string(field) + " must be an array of integers");
    return false;
  }
  result->clear();
  result->reserve(length);
  for (uint32_t i = 0; i < length; ++i) {
    napi_value item;
    if (napi_get_element(env, value, i, &item) != napi_ok) {
      ThrowTypeError(env, std::string(field) + " must be an array of integers");
      return false;
    }
    napi_valuetype type;
    int64_t id = 0;
    if (napi_typeof(env, item, &type) != napi_ok || type != napi_number ||
        napi_get_value_int64(env, item, &id) != napi_ok || id < 0 ||
        id > UINT16_MAX) {
      ThrowTypeError(env, std::string(field) +
                              " values must be integers from 0 to 65535");
      return false;
    }
    result->push_back(static_cast<uint64_t>(id));
  }
  return true;
}

bool GetOptionalPriority(napi_env env,
                         napi_value object,
                         const char* field,
                         Cronet_UrlRequestParams_REQUEST_PRIORITY* result) {
  bool has_property = false;
  if (napi_has_named_property(env, object, field, &has_property) != napi_ok ||
      !has_property) {
    return true;
  }
  napi_value value;
  napi_valuetype type;
  if (napi_get_named_property(env, object, field, &value) != napi_ok ||
      napi_typeof(env, value, &type) != napi_ok || type == napi_undefined) {
    return true;
  }
  if (type == napi_number) {
    int32_t priority;
    if (napi_get_value_int32(env, value, &priority) != napi_ok || priority < 0 ||
        priority > 4) {
      ThrowTypeError(env, "priority must be an integer from 0 to 4");
      return false;
    }
    *result = static_cast<Cronet_UrlRequestParams_REQUEST_PRIORITY>(priority);
    return true;
  }
  std::string name;
  if (!GetStringValue(env, value, field, &name)) return false;
  if (name == "idle") {
    *result = Cronet_UrlRequestParams_REQUEST_PRIORITY_REQUEST_PRIORITY_IDLE;
  } else if (name == "lowest") {
    *result = Cronet_UrlRequestParams_REQUEST_PRIORITY_REQUEST_PRIORITY_LOWEST;
  } else if (name == "low") {
    *result = Cronet_UrlRequestParams_REQUEST_PRIORITY_REQUEST_PRIORITY_LOW;
  } else if (name == "medium") {
    *result = Cronet_UrlRequestParams_REQUEST_PRIORITY_REQUEST_PRIORITY_MEDIUM;
  } else if (name == "highest") {
    *result = Cronet_UrlRequestParams_REQUEST_PRIORITY_REQUEST_PRIORITY_HIGHEST;
  } else {
    ThrowTypeError(env, "priority must be idle, lowest, low, medium, highest, or 0-4");
    return false;
  }
  return true;
}

#if defined(_WIN32)
std::wstring Utf8ToWide(const std::string& value) {
  if (value.empty()) return std::wstring();
  int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(),
                                  static_cast<int>(value.size()), nullptr, 0);
  if (length <= 0) return std::wstring();
  std::wstring result(length, L'\0');
  MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(),
                      static_cast<int>(value.size()), result.data(), length);
  return result;
}
#endif

std::string CronetString(Cronet_String value) {
  return value ? std::string(value) : std::string();
}

std::string LoadError(const std::string& path) {
#if defined(_WIN32)
  return "Unable to load Cronet DLL '" + path + "' (Win32 error " +
         std::to_string(GetLastError()) + ")";
#else
  const char* error = dlerror();
  return "Unable to load Cronet shared library '" + path + "' (" +
         (error ? std::string(error) : std::string("unknown dlopen error")) +
         ")";
#endif
}

RequestState* StateFromCallback(Cronet_UrlRequestCallbackPtr callback) {
  AddonState* addon = g_addon.load();
  if (!addon || !callback) return nullptr;
  return reinterpret_cast<RequestState*>(
      addon->api.Cronet_UrlRequestCallback_GetClientContext(callback));
}

RequestState* StateFromProvider(Cronet_UploadDataProviderPtr provider) {
  AddonState* addon = g_addon.load();
  if (!addon || !provider) return nullptr;
  return reinterpret_cast<RequestState*>(
      addon->api.Cronet_UploadDataProvider_GetClientContext(provider));
}

SyncRequestState* SyncStateFromCallback(
    Cronet_UrlRequestCallbackPtr callback) {
  AddonState* addon = g_addon.load();
  if (!addon || !callback) return nullptr;
  return reinterpret_cast<SyncRequestState*>(
      addon->api.Cronet_UrlRequestCallback_GetClientContext(callback));
}

SyncRequestState* SyncStateFromProvider(
    Cronet_UploadDataProviderPtr provider) {
  AddonState* addon = g_addon.load();
  if (!addon || !provider) return nullptr;
  return reinterpret_cast<SyncRequestState*>(
      addon->api.Cronet_UploadDataProvider_GetClientContext(provider));
}

struct SyncCallbackGuard {
  explicit SyncCallbackGuard(SyncRequestState* state) : state(state) {
    if (!state) return;
    std::lock_guard<std::mutex> lock(state->mutex);
    ++state->callback_depth;
  }

  ~SyncCallbackGuard() {
    if (!state) return;
    std::lock_guard<std::mutex> lock(state->mutex);
    --state->callback_depth;
    state->condition.notify_all();
  }

  SyncRequestState* state;
};

void SyncComplete(SyncRequestState* state,
                  bool succeeded,
                  bool canceled = false) {
  if (!state) return;
  {
    std::lock_guard<std::mutex> lock(state->mutex);
    if (state->done) return;
    state->succeeded = succeeded;
    if (canceled && !state->forced_failure) {
      state->error_message = "The operation was aborted";
    }
    state->done = true;
  }
  state->condition.notify_all();
}

void SyncFail(SyncRequestState* state,
              const std::string& message,
              int error_code = -1) {
  if (!state || !state->owner) return;
  bool cancel = false;
  {
    std::lock_guard<std::mutex> lock(state->mutex);
    if (state->done) return;
    state->forced_failure = true;
    state->error_code = error_code;
    state->error_message = message;
    cancel = state->request != nullptr;
  }
  if (cancel) state->owner->api.Cronet_UrlRequest_Cancel(state->request);
}

void SyncCopyResponseInfo(SyncRequestState* state,
                          Cronet_UrlResponseInfoPtr info) {
  if (!state || !info || !state->owner) return;
  AddonState* addon = state->owner;
  state->status = addon->api.Cronet_UrlResponseInfo_http_status_code_get(info);
  state->status_text = CronetString(
      addon->api.Cronet_UrlResponseInfo_http_status_text_get(info));
  state->response_url = CronetString(
      addon->api.Cronet_UrlResponseInfo_url_get(info));
  if (state->response_url.empty()) state->response_url = state->url;
  state->response_headers.clear();
  uint32_t count =
      addon->api.Cronet_UrlResponseInfo_all_headers_list_size(info);
  for (uint32_t i = 0; i < count; ++i) {
    Cronet_HttpHeaderPtr header =
        addon->api.Cronet_UrlResponseInfo_all_headers_list_at(info, i);
    if (!header) continue;
    state->response_headers.emplace_back(
        CronetString(addon->api.Cronet_HttpHeader_name_get(header)),
        CronetString(addon->api.Cronet_HttpHeader_value_get(header)));
  }
}

void SyncExecutorExecute(Cronet_ExecutorPtr,
                         Cronet_RunnablePtr runnable) {
  AddonState* addon = g_addon.load();
  if (!addon || addon->cleanup_started || !runnable) return;
  addon->api.Cronet_Runnable_Run(runnable);
  addon->api.Cronet_Runnable_Destroy(runnable);
}

WebSocketState* WebSocketFromCallback(void* user_data) {
  return static_cast<WebSocketState*>(user_data);
}

void CycronetWebSocketOnEvent(void* user_data,
                              int32_t event_type,
                              int32_t is_text,
                              int32_t code,
                              const uint8_t* data,
                              size_t length) {
  WebSocketState* websocket = static_cast<WebSocketState*>(user_data);
  if (!websocket || (length > 0 && !data)) return;

  constexpr int32_t kOpen = 0;
  constexpr int32_t kMessage = 1;
  constexpr int32_t kClose = 2;
  constexpr int32_t kError = 3;
  if (event_type == kOpen) {
    std::string protocol;
    if (data && length > 0) {
      protocol.assign(reinterpret_cast<const char*>(data), length);
    }
    QueueWebSocketEvent(websocket, WebSocketEventType::kOpen, {}, false,
                        std::move(protocol));
  } else if (event_type == kMessage) {
    std::vector<uint8_t> message;
    if (data && length > 0) message.assign(data, data + length);
    QueueWebSocketEvent(websocket, WebSocketEventType::kMessage,
                        std::move(message), is_text != 0);
  } else if (event_type == kClose) {
    const uint16_t close_code =
        code >= 0 && code <= std::numeric_limits<uint16_t>::max()
            ? static_cast<uint16_t>(code)
            : 1006;
    std::string reason;
    if (data && length > 0) {
      reason.assign(reinterpret_cast<const char*>(data), length);
    }
    QueueWebSocketEvent(websocket, WebSocketEventType::kClose, {}, false, {},
                        0, {}, true, close_code, std::move(reason));
  } else if (event_type == kError) {
    std::string message;
    if (data && length > 0) {
      message.assign(reinterpret_cast<const char*>(data), length);
    }
    QueueWebSocketEvent(websocket, WebSocketEventType::kError, {}, false, {},
                        code, std::move(message));
  }
}

void WebSocketOnOpen(Cronet_WebSocketPtr,
                     void* user_data,
                     const char* protocol) {
  WebSocketState* websocket = WebSocketFromCallback(user_data);
  if (!websocket) return;
  QueueWebSocketEvent(websocket, WebSocketEventType::kOpen, {}, false,
                      protocol ? protocol : "");
}

void WebSocketOnMessage(Cronet_WebSocketPtr,
                        void* user_data,
                        Cronet_WebSocket_MessageType type,
                        const void* data,
                        uint64_t length) {
  WebSocketState* websocket = WebSocketFromCallback(user_data);
  if (!websocket || (length > 0 && !data)) return;
  const auto* bytes = static_cast<const uint8_t*>(data);
  std::vector<uint8_t> copied(bytes, bytes + length);
  QueueWebSocketEvent(websocket, WebSocketEventType::kMessage,
                      std::move(copied),
                      type == Cronet_WebSocket_MESSAGE_TEXT);
}

void WebSocketOnClose(Cronet_WebSocketPtr,
                      void* user_data,
                      int was_clean,
                      uint16_t code,
                      const char* reason) {
  WebSocketState* websocket = WebSocketFromCallback(user_data);
  if (!websocket) return;
  QueueWebSocketEvent(websocket, WebSocketEventType::kClose, {}, false, {}, 0,
                      {}, was_clean != 0, code, reason ? reason : "");
}

void WebSocketOnError(Cronet_WebSocketPtr,
                      void* user_data,
                      int net_error,
                      const char* message) {
  WebSocketState* websocket = WebSocketFromCallback(user_data);
  if (!websocket) return;
  QueueWebSocketEvent(websocket, WebSocketEventType::kError, {}, false, {},
                      net_error, message ? message : "");
}

const Cronet_WebSocket_Callbacks kWebSocketCallbacks = {
    WebSocketOnOpen,
    WebSocketOnMessage,
    WebSocketOnClose,
    WebSocketOnError};

bool HasCycronetWebSocket(const AddonState* addon) {
  return addon && addon->cycronet_started &&
         addon->cycronet_api.HasWebSocket();
}

void QueueWebSocketEvent(WebSocketState* websocket,
                         WebSocketEventType type,
                         std::vector<uint8_t> data,
                         bool is_text,
                         std::string protocol,
                         int error_code,
                         std::string error,
                         bool was_clean,
                         uint16_t close_code,
                         std::string close_reason) {
  if (!websocket || !websocket->owner) return;
  AddonState* addon = websocket->owner;
  if (addon->cleanup_started) return;
  {
    std::lock_guard<std::mutex> state_lock(websocket->mutex);
    if (type == WebSocketEventType::kError) {
      if (websocket->error_queued || websocket->close_queued) return;
      websocket->error_queued = true;
    } else if (type == WebSocketEventType::kClose) {
      if (websocket->close_queued) return;
      websocket->close_queued = true;
    } else if (websocket->error_queued || websocket->close_queued) {
      return;
    }
    websocket->terminal_queued = websocket->error_queued || websocket->close_queued;
  }
  DispatchItem item{};
  item.type = DispatchType::kWebSocket;
  item.websocket = websocket;
  item.websocket_event = type;
  item.websocket_data = std::move(data);
  item.websocket_is_text = is_text;
  item.websocket_protocol = std::move(protocol);
  item.websocket_error_code = error_code;
  item.websocket_error = std::move(error);
  item.websocket_was_clean = was_clean;
  item.websocket_close_code = close_code;
  item.websocket_close_reason = std::move(close_reason);
  {
    std::lock_guard<std::mutex> lock(addon->dispatch_mutex);
    addon->dispatch_queue.push_back(std::move(item));
  }
  uv_async_send(&addon->async);
}

void QueueCleanup(RequestState* request);
void ExecutorExecute(Cronet_ExecutorPtr, Cronet_RunnablePtr runnable) {
  AddonState* addon = g_addon.load();
  if (!addon || addon->cleanup_started) return;
  {
    std::lock_guard<std::mutex> lock(addon->dispatch_mutex);
    addon->dispatch_queue.push_back(
        {DispatchType::kRunnable, runnable, nullptr});
  }
  uv_async_send(&addon->async);
}

void CopyResponseInfo(RequestState* request, Cronet_UrlResponseInfoPtr info) {
  if (!request || !info) return;
  AddonState* addon = request->owner;
  request->status = addon->api.Cronet_UrlResponseInfo_http_status_code_get(info);
  request->status_text = CronetString(
      addon->api.Cronet_UrlResponseInfo_http_status_text_get(info));
  request->response_url = CronetString(
      addon->api.Cronet_UrlResponseInfo_url_get(info));
  if (request->response_url.empty()) request->response_url = request->url;
  request->response_headers.clear();
  uint32_t count =
      addon->api.Cronet_UrlResponseInfo_all_headers_list_size(info);
  for (uint32_t i = 0; i < count; ++i) {
    Cronet_HttpHeaderPtr header =
        addon->api.Cronet_UrlResponseInfo_all_headers_list_at(info, i);
    if (!header) continue;
    request->response_headers.emplace_back(
        CronetString(addon->api.Cronet_HttpHeader_name_get(header)),
        CronetString(addon->api.Cronet_HttpHeader_value_get(header)));
  }
}

napi_value MakeError(napi_env env,
                     const std::string& message,
                     const char* name,
                     const char* code) {
  napi_value message_value;
  napi_value error;
  napi_create_string_utf8(env, message.c_str(), message.size(), &message_value);
  napi_create_error(env, nullptr, message_value, &error);
  napi_value name_value;
  napi_create_string_utf8(env, name, NAPI_AUTO_LENGTH, &name_value);
  napi_set_named_property(env, error, "name", name_value);
  if (code) {
    napi_value code_value;
    napi_create_string_utf8(env, code, NAPI_AUTO_LENGTH, &code_value);
    napi_set_named_property(env, error, "code", code_value);
  }
  return error;
}

napi_value MakeResponse(RequestState* request) {
  napi_env env = request->owner->env;
  napi_value response;
  napi_create_object(env, &response);

  napi_value status;
  napi_create_int32(env, request->status, &status);
  napi_set_named_property(env, response, "status", status);

  napi_value status_text;
  napi_create_string_utf8(env, request->status_text.c_str(),
                          request->status_text.size(), &status_text);
  napi_set_named_property(env, response, "statusText", status_text);

  napi_value url;
  napi_create_string_utf8(env, request->response_url.c_str(),
                          request->response_url.size(), &url);
  napi_set_named_property(env, response, "url", url);

  napi_value headers;
  napi_create_array_with_length(env, request->response_headers.size(), &headers);
  for (size_t i = 0; i < request->response_headers.size(); ++i) {
    napi_value pair;
    napi_create_array_with_length(env, 2, &pair);
    napi_value name;
    napi_value value;
    napi_create_string_utf8(env, request->response_headers[i].first.c_str(),
                            request->response_headers[i].first.size(), &name);
    napi_create_string_utf8(env, request->response_headers[i].second.c_str(),
                            request->response_headers[i].second.size(), &value);
    napi_set_element(env, pair, 0, name);
    napi_set_element(env, pair, 1, value);
    napi_set_element(env, headers, i, pair);
  }
  napi_set_named_property(env, response, "headers", headers);

  napi_value body;
  void* body_data = nullptr;
  napi_create_buffer_copy(env, request->response_body.size(),
                          request->response_body.data(), &body_data, &body);
  napi_set_named_property(env, response, "body", body);
  return response;
}

napi_value MakeStreamMetadata(RequestState* request) {
  napi_env env = request->owner->env;
  napi_value response;
  napi_create_object(env, &response);

  napi_value status;
  napi_create_int32(env, request->status, &status);
  napi_set_named_property(env, response, "status", status);

  napi_value status_text;
  napi_create_string_utf8(env, request->status_text.c_str(),
                          request->status_text.size(), &status_text);
  napi_set_named_property(env, response, "statusText", status_text);

  napi_value url;
  napi_create_string_utf8(env, request->response_url.c_str(),
                          request->response_url.size(), &url);
  napi_set_named_property(env, response, "url", url);

  napi_value headers;
  napi_create_array_with_length(env, request->response_headers.size(), &headers);
  for (size_t i = 0; i < request->response_headers.size(); ++i) {
    napi_value pair;
    napi_create_array_with_length(env, 2, &pair);
    napi_value name;
    napi_value value;
    napi_create_string_utf8(env, request->response_headers[i].first.c_str(),
                            request->response_headers[i].first.size(), &name);
    napi_create_string_utf8(env, request->response_headers[i].second.c_str(),
                            request->response_headers[i].second.size(), &value);
    napi_set_element(env, pair, 0, name);
    napi_set_element(env, pair, 1, value);
    napi_set_element(env, headers, i, pair);
  }
  napi_set_named_property(env, response, "headers", headers);
  return response;
}

void DispatchStreamEvent(RequestState* request, const DispatchItem& item) {
  if (!request || !request->owner) return;
  napi_env env = request->owner->env;
  napi_ref callback_ref = nullptr;
  switch (item.stream_event) {
    case StreamEventType::kHeaders: callback_ref = request->stream_on_headers; break;
    case StreamEventType::kChunk: callback_ref = request->stream_on_chunk; break;
    case StreamEventType::kEnd: callback_ref = request->stream_on_end; break;
    case StreamEventType::kError: callback_ref = request->stream_on_error; break;
  }
  if (!callback_ref) return;

  napi_value callback;
  if (napi_get_reference_value(env, callback_ref, &callback) != napi_ok) return;
  napi_value argv[1];
  size_t argc = 0;
  if (item.stream_event == StreamEventType::kHeaders) {
    argv[0] = MakeStreamMetadata(request);
    argc = 1;
  } else if (item.stream_event == StreamEventType::kChunk) {
    void* data = nullptr;
    napi_create_buffer_copy(env, item.stream_data.size(),
                            item.stream_data.data(), &data, &argv[0]);
    argc = 1;
  } else if (item.stream_event == StreamEventType::kError) {
    std::string message = item.stream_error.empty()
                              ? "Cronet streaming request failed"
                              : item.stream_error;
    argv[0] = MakeError(env, message, "CronetError", nullptr);
    argc = 1;
  }

  napi_value global;
  napi_get_global(env, &global);
  napi_value result;
  napi_call_function(env, global, callback, argc, argc ? argv : nullptr, &result);
}

napi_value MakeSyncResponse(SyncRequestState* request) {
  napi_env env = request->owner->env;
  napi_value response;
  napi_create_object(env, &response);

  napi_value status;
  napi_create_int32(env, request->status, &status);
  napi_set_named_property(env, response, "status", status);

  napi_value status_text;
  napi_create_string_utf8(env, request->status_text.c_str(),
                          request->status_text.size(), &status_text);
  napi_set_named_property(env, response, "statusText", status_text);

  napi_value url;
  napi_create_string_utf8(env, request->response_url.c_str(),
                          request->response_url.size(), &url);
  napi_set_named_property(env, response, "url", url);

  napi_value headers;
  napi_create_array_with_length(env, request->response_headers.size(), &headers);
  for (size_t i = 0; i < request->response_headers.size(); ++i) {
    napi_value pair;
    napi_create_array_with_length(env, 2, &pair);
    napi_value name;
    napi_value value;
    napi_create_string_utf8(env, request->response_headers[i].first.c_str(),
                            request->response_headers[i].first.size(), &name);
    napi_create_string_utf8(env, request->response_headers[i].second.c_str(),
                            request->response_headers[i].second.size(), &value);
    napi_set_element(env, pair, 0, name);
    napi_set_element(env, pair, 1, value);
    napi_set_element(env, headers, i, pair);
  }
  napi_set_named_property(env, response, "headers", headers);

  napi_value body;
  void* body_data = nullptr;
  napi_create_buffer_copy(env, request->response_body.size(),
                          request->response_body.data(), &body_data, &body);
  napi_set_named_property(env, response, "body", body);
  return response;
}

napi_value MakeRequestHandle(napi_env env,
                             RequestState* request,
                             napi_value promise) {
  napi_value handle;
  napi_create_object(env, &handle);
  napi_value id;
  napi_create_bigint_uint64(env, request->id, &id);
  napi_set_named_property(env, handle, "id", id);
  if (promise) napi_set_named_property(env, handle, "promise", promise);
  return handle;
}

void FinishRequest(RequestState* request, bool success, bool canceled) {
  if (!request || request->finish_queued) return;
  request->finish_queued = true;
  napi_env env = request->owner->env;

  if (request->streaming) {
    if (success && !request->forced_failure) {
      QueueStreamEvent(request, StreamEventType::kEnd);
    } else {
      std::string message = request->error_message;
      if (message.empty()) {
        message = canceled ? "The operation was aborted"
                           : "Cronet streaming request failed";
      }
      QueueStreamEvent(request, StreamEventType::kError, {},
                       request->error_code, std::move(message));
    }
    return;
  }

  if (success && !request->forced_failure) {
    napi_value response = MakeResponse(request);
    napi_resolve_deferred(env, request->deferred, response);
  } else {
    std::string message = request->error_message;
    if (message.empty()) {
      message = canceled ? "The operation was aborted" : "Cronet request failed";
    }
    if (canceled && !request->forced_failure) {
      napi_value error = MakeError(env, message, "AbortError", "ABORT_ERR");
      napi_reject_deferred(env, request->deferred, error);
    } else {
      std::string code = "CRONET_" + std::to_string(request->error_code);
      napi_value error = MakeError(env, message, "CronetError", code.c_str());
      napi_reject_deferred(env, request->deferred, error);
    }
  }
  QueueCleanup(request);
}

void SetReadFailure(RequestState* request, const std::string& message) {
  request->forced_failure = true;
  request->error_code = -1;
  request->error_message = message;
  request->owner->api.Cronet_UrlRequest_Cancel(request->request);
}

void OnRedirectReceived(Cronet_UrlRequestCallbackPtr callback,
                        Cronet_UrlRequestPtr request_ptr,
                        Cronet_UrlResponseInfoPtr info,
                        Cronet_String) {
  RequestState* request = StateFromCallback(callback);
  if (!request) return;
  CopyResponseInfo(request, info);
  if (!request->allow_redirects) {
    request->stopped_at_redirect = true;
    if (request->streaming) QueueStreamEvent(request, StreamEventType::kHeaders);
    request->owner->api.Cronet_UrlRequest_Cancel(request_ptr);
    return;
  }
  Cronet_RESULT result =
      request->owner->api.Cronet_UrlRequest_FollowRedirect(request_ptr);
  if (result != Cronet_RESULT_SUCCESS) {
    request->forced_failure = true;
    request->error_code = result;
    request->error_message = "Cronet failed to follow a redirect";
    request->owner->api.Cronet_UrlRequest_Cancel(request_ptr);
  }
}

void OnResponseStarted(Cronet_UrlRequestCallbackPtr callback,
                       Cronet_UrlRequestPtr request_ptr,
                       Cronet_UrlResponseInfoPtr info) {
  RequestState* request = StateFromCallback(callback);
  if (!request) return;
  CopyResponseInfo(request, info);
  AddonState* addon = request->owner;
  Cronet_BufferPtr buffer = addon->api.Cronet_Buffer_Create();
  if (!buffer) {
    SetReadFailure(request, "Cronet could not allocate a response buffer");
    return;
  }
  addon->api.Cronet_Buffer_InitWithAlloc(buffer, 32 * 1024);
  if (request->streaming) {
    QueueStreamEvent(request, StreamEventType::kHeaders);
    request->stream_buffer = buffer;
    return;
  }
  Cronet_RESULT result = addon->api.Cronet_UrlRequest_Read(request_ptr, buffer);
  if (result != Cronet_RESULT_SUCCESS) {
    if (!addon->api.Cronet_UrlRequest_IsDone(request_ptr)) {
      addon->api.Cronet_Buffer_Destroy(buffer);
    }
    SetReadFailure(request, "Cronet failed to start reading the response");
  }
}

void OnReadCompleted(Cronet_UrlRequestCallbackPtr callback,
                     Cronet_UrlRequestPtr request_ptr,
                     Cronet_UrlResponseInfoPtr info,
                     Cronet_BufferPtr buffer,
                     uint64_t bytes_read) {
  RequestState* request = StateFromCallback(callback);
  if (!request || !buffer) return;
  AddonState* addon = request->owner;
  if (request->streaming) request->stream_read_pending = false;
  CopyResponseInfo(request, info);
  uint64_t capacity = addon->api.Cronet_Buffer_GetSize(buffer);
  uint64_t count = std::min(bytes_read, capacity);
  auto* data = static_cast<const uint8_t*>(addon->api.Cronet_Buffer_GetData(buffer));
  if (count > 0 && !data) {
    SetReadFailure(request, "Cronet returned an invalid response buffer");
    addon->api.Cronet_Buffer_Destroy(buffer);
    return;
  }
  if (count > 0) {
    if (request->streaming) {
      QueueStreamEvent(request, StreamEventType::kChunk,
                       std::vector<uint8_t>(data, data + count));
    } else {
      request->response_body.insert(request->response_body.end(), data,
                                    data + count);
    }
  }

  // Streaming reads are advanced by the JS ReadableStream pull callback.
  // Do not issue the next Cronet read here; that is what provides backpressure.
  if (request->streaming) return;

  Cronet_RESULT result = addon->api.Cronet_UrlRequest_Read(request_ptr, buffer);
  if (result != Cronet_RESULT_SUCCESS) {
    if (!addon->api.Cronet_UrlRequest_IsDone(request_ptr)) {
      addon->api.Cronet_Buffer_Destroy(buffer);
    }
    SetReadFailure(request, "Cronet failed to continue reading the response");
  }
}

void OnSucceeded(Cronet_UrlRequestCallbackPtr callback,
                 Cronet_UrlRequestPtr,
                 Cronet_UrlResponseInfoPtr info) {
  RequestState* request = StateFromCallback(callback);
  if (!request) return;
  CopyResponseInfo(request, info);
  FinishRequest(request, true, false);
}

void OnFailed(Cronet_UrlRequestCallbackPtr callback,
              Cronet_UrlRequestPtr,
              Cronet_UrlResponseInfoPtr info,
              Cronet_ErrorPtr error) {
  RequestState* request = StateFromCallback(callback);
  if (!request) return;
  CopyResponseInfo(request, info);
  if (error) {
    request->error_code = request->owner->api.Cronet_Error_error_code_get(error);
    request->error_message =
        CronetString(request->owner->api.Cronet_Error_message_get(error));
  }
  FinishRequest(request, false, false);
}

void OnCanceled(Cronet_UrlRequestCallbackPtr callback,
                Cronet_UrlRequestPtr,
                Cronet_UrlResponseInfoPtr info) {
  RequestState* request = StateFromCallback(callback);
  if (!request) return;
  CopyResponseInfo(request, info);
  if (request->stopped_at_redirect) {
    FinishRequest(request, true, false);
    return;
  }
  FinishRequest(request, false, true);
}

int64_t UploadGetLength(Cronet_UploadDataProviderPtr provider) {
  RequestState* request = StateFromProvider(provider);
  if (!request || request->upload_body.size() >
                     static_cast<size_t>(std::numeric_limits<int64_t>::max())) {
    return -1;
  }
  return static_cast<int64_t>(request->upload_body.size());
}

void UploadRead(Cronet_UploadDataProviderPtr provider,
                Cronet_UploadDataSinkPtr sink,
                Cronet_BufferPtr buffer) {
  RequestState* request = StateFromProvider(provider);
  if (!request || !buffer) return;
  AddonState* addon = request->owner;
  uint64_t capacity = addon->api.Cronet_Buffer_GetSize(buffer);
  size_t remaining = request->upload_body.size() - request->upload_offset;
  size_t count = std::min<size_t>(remaining, static_cast<size_t>(capacity));
  if (count == 0) {
    addon->api.Cronet_UploadDataSink_OnReadError(
        sink, "Cronet requested an empty upload buffer");
    return;
  }
  void* data = addon->api.Cronet_Buffer_GetData(buffer);
  if (!data) {
    addon->api.Cronet_UploadDataSink_OnReadError(
        sink, "Cronet returned an invalid upload buffer");
    return;
  }
  std::memcpy(data, request->upload_body.data() + request->upload_offset, count);
  request->upload_offset += count;
  addon->api.Cronet_UploadDataSink_OnReadSucceeded(sink, count, false);
}

void UploadRewind(Cronet_UploadDataProviderPtr provider,
                  Cronet_UploadDataSinkPtr sink) {
  RequestState* request = StateFromProvider(provider);
  if (!request) return;
  request->upload_offset = 0;
  request->owner->api.Cronet_UploadDataSink_OnRewindSucceeded(sink);
}

void UploadClose(Cronet_UploadDataProviderPtr) {}

int64_t SyncUploadGetLength(Cronet_UploadDataProviderPtr provider) {
  SyncRequestState* state = SyncStateFromProvider(provider);
  if (!state || state->upload_body.size() >
                    static_cast<size_t>(std::numeric_limits<int64_t>::max())) {
    return -1;
  }
  return static_cast<int64_t>(state->upload_body.size());
}

void SyncUploadRead(Cronet_UploadDataProviderPtr provider,
                    Cronet_UploadDataSinkPtr sink,
                    Cronet_BufferPtr buffer) {
  SyncRequestState* state = SyncStateFromProvider(provider);
  if (!state || !state->owner || !buffer) return;
  AddonState* addon = state->owner;
  uint64_t capacity = addon->api.Cronet_Buffer_GetSize(buffer);
  size_t remaining = state->upload_body.size() - state->upload_offset;
  size_t count = std::min<size_t>(remaining, static_cast<size_t>(capacity));
  if (count == 0) {
    addon->api.Cronet_UploadDataSink_OnReadError(
        sink, "Cronet requested an empty upload buffer");
    return;
  }
  void* data = addon->api.Cronet_Buffer_GetData(buffer);
  if (!data) {
    addon->api.Cronet_UploadDataSink_OnReadError(
        sink, "Cronet returned an invalid upload buffer");
    return;
  }
  std::memcpy(data, state->upload_body.data() + state->upload_offset, count);
  state->upload_offset += count;
  addon->api.Cronet_UploadDataSink_OnReadSucceeded(sink, count, false);
}

void SyncUploadRewind(Cronet_UploadDataProviderPtr provider,
                      Cronet_UploadDataSinkPtr sink) {
  SyncRequestState* state = SyncStateFromProvider(provider);
  if (!state || !state->owner) return;
  state->upload_offset = 0;
  state->owner->api.Cronet_UploadDataSink_OnRewindSucceeded(sink);
}

void SyncUploadClose(Cronet_UploadDataProviderPtr) {}

void SyncOnRedirectReceived(Cronet_UrlRequestCallbackPtr callback,
                            Cronet_UrlRequestPtr request_ptr,
                            Cronet_UrlResponseInfoPtr info,
                            Cronet_String) {
  SyncRequestState* state = SyncStateFromCallback(callback);
  SyncCallbackGuard guard(state);
  if (!state || !state->owner) return;
  SyncCopyResponseInfo(state, info);
  if (!state->allow_redirects) {
    state->stopped_at_redirect = true;
    state->owner->api.Cronet_UrlRequest_Cancel(request_ptr);
    return;
  }
  Cronet_RESULT result =
      state->owner->api.Cronet_UrlRequest_FollowRedirect(request_ptr);
  if (result != Cronet_RESULT_SUCCESS) {
    SyncFail(state, "Cronet failed to follow a redirect", result);
  }
}

void SyncOnResponseStarted(Cronet_UrlRequestCallbackPtr callback,
                           Cronet_UrlRequestPtr request_ptr,
                           Cronet_UrlResponseInfoPtr info) {
  SyncRequestState* state = SyncStateFromCallback(callback);
  SyncCallbackGuard guard(state);
  if (!state || !state->owner) return;
  SyncCopyResponseInfo(state, info);
  AddonState* addon = state->owner;
  Cronet_BufferPtr buffer = addon->api.Cronet_Buffer_Create();
  if (!buffer) {
    SyncFail(state, "Cronet could not allocate a response buffer");
    return;
  }
  addon->api.Cronet_Buffer_InitWithAlloc(buffer, 32 * 1024);
  Cronet_RESULT result = addon->api.Cronet_UrlRequest_Read(request_ptr, buffer);
  if (result != Cronet_RESULT_SUCCESS) {
    if (!addon->api.Cronet_UrlRequest_IsDone(request_ptr)) {
      addon->api.Cronet_Buffer_Destroy(buffer);
    }
    SyncFail(state, "Cronet failed to start reading the response", result);
  }
}

void SyncOnReadCompleted(Cronet_UrlRequestCallbackPtr callback,
                         Cronet_UrlRequestPtr request_ptr,
                         Cronet_UrlResponseInfoPtr info,
                         Cronet_BufferPtr buffer,
                         uint64_t bytes_read) {
  SyncRequestState* state = SyncStateFromCallback(callback);
  SyncCallbackGuard guard(state);
  if (!state || !state->owner || !buffer) return;
  AddonState* addon = state->owner;
  SyncCopyResponseInfo(state, info);
  uint64_t capacity = addon->api.Cronet_Buffer_GetSize(buffer);
  uint64_t count = std::min(bytes_read, capacity);
  auto* data = static_cast<const uint8_t*>(addon->api.Cronet_Buffer_GetData(buffer));
  if (count > 0 && !data) {
    SyncFail(state, "Cronet returned an invalid response buffer");
    addon->api.Cronet_Buffer_Destroy(buffer);
    return;
  }
  if (count > 0) {
    state->response_body.insert(state->response_body.end(), data, data + count);
  }
  Cronet_RESULT result = addon->api.Cronet_UrlRequest_Read(request_ptr, buffer);
  if (result != Cronet_RESULT_SUCCESS) {
    if (!addon->api.Cronet_UrlRequest_IsDone(request_ptr)) {
      addon->api.Cronet_Buffer_Destroy(buffer);
    }
    SyncFail(state, "Cronet failed to continue reading the response", result);
  }
}

void SyncOnSucceeded(Cronet_UrlRequestCallbackPtr callback,
                     Cronet_UrlRequestPtr,
                     Cronet_UrlResponseInfoPtr info) {
  SyncRequestState* state = SyncStateFromCallback(callback);
  SyncCallbackGuard guard(state);
  if (!state) return;
  SyncCopyResponseInfo(state, info);
  SyncComplete(state, true);
}

void SyncOnFailed(Cronet_UrlRequestCallbackPtr callback,
                  Cronet_UrlRequestPtr,
                  Cronet_UrlResponseInfoPtr info,
                  Cronet_ErrorPtr error) {
  SyncRequestState* state = SyncStateFromCallback(callback);
  SyncCallbackGuard guard(state);
  if (!state || !state->owner) return;
  SyncCopyResponseInfo(state, info);
  if (error) {
    state->error_code = state->owner->api.Cronet_Error_error_code_get(error);
    state->error_message =
        CronetString(state->owner->api.Cronet_Error_message_get(error));
  }
  SyncComplete(state, false);
}

void SyncOnCanceled(Cronet_UrlRequestCallbackPtr callback,
                    Cronet_UrlRequestPtr,
                    Cronet_UrlResponseInfoPtr info) {
  SyncRequestState* state = SyncStateFromCallback(callback);
  SyncCallbackGuard guard(state);
  if (!state) return;
  SyncCopyResponseInfo(state, info);
  if (state->stopped_at_redirect) {
    SyncComplete(state, true, false);
    return;
  }
  SyncComplete(state, false, true);
}

void QueueCleanup(RequestState* request) {
  if (!request || !request->owner) return;
  AddonState* addon = request->owner;
  {
    std::lock_guard<std::mutex> lock(addon->dispatch_mutex);
    addon->dispatch_queue.push_back(
        {DispatchType::kCleanup, nullptr, request});
  }
  uv_async_send(&addon->async);
}

void CleanupRequest(RequestState* request) {
  if (!request || !request->owner) return;
  AddonState* addon = request->owner;
  if (request->request) {
    addon->api.Cronet_UrlRequest_Destroy(request->request);
    request->request = nullptr;
  }
  if (request->callback) {
    addon->api.Cronet_UrlRequestCallback_Destroy(request->callback);
    request->callback = nullptr;
  }
  if (request->executor) {
    addon->api.Cronet_Executor_Destroy(request->executor);
    request->executor = nullptr;
  }
  if (request->upload_provider) {
    addon->api.Cronet_UploadDataProvider_Destroy(request->upload_provider);
    request->upload_provider = nullptr;
  }
  // Cronet owns the response buffer after UrlRequest_Read; keep the same
  // ownership rule as the buffered request path and do not destroy it here.
  request->stream_buffer = nullptr;
  if (request->stream_on_headers) {
    napi_delete_reference(addon->env, request->stream_on_headers);
    request->stream_on_headers = nullptr;
  }
  if (request->stream_on_chunk) {
    napi_delete_reference(addon->env, request->stream_on_chunk);
    request->stream_on_chunk = nullptr;
  }
  if (request->stream_on_end) {
    napi_delete_reference(addon->env, request->stream_on_end);
    request->stream_on_end = nullptr;
  }
  if (request->stream_on_error) {
    napi_delete_reference(addon->env, request->stream_on_error);
    request->stream_on_error = nullptr;
  }
  bool no_requests = false;
  {
    std::lock_guard<std::mutex> lock(addon->request_mutex);
    auto it = std::find(addon->requests.begin(), addon->requests.end(), request);
    if (it != addon->requests.end()) addon->requests.erase(it);
    no_requests = addon->requests.empty();
  }
  bool no_websockets = false;
  {
    std::lock_guard<std::mutex> lock(addon->websocket_mutex);
    no_websockets = addon->websockets.empty();
  }
  if (no_requests && no_websockets) {
    uv_unref(reinterpret_cast<uv_handle_t*>(&addon->async));
  }
  delete request;
}

void ReleaseWebSocketHandle(WebSocketState* websocket) {
  if (!websocket || !websocket->owner) return;
  AddonState* addon = websocket->owner;
  if (websocket->backend == WebSocketBackend::kCycronet) {
    if (websocket->cycronet_websocket) {
      addon->cycronet_api.websocket_destroy(websocket->cycronet_websocket);
      websocket->cycronet_websocket = nullptr;
    }
    if (!websocket->cycronet_session_id.empty()) {
      addon->cycronet_api.session_destroy(
          websocket->cycronet_session_id.c_str());
      websocket->cycronet_session_id.clear();
    }
  } else if (websocket->websocket) {
    addon->api.websocket_destroy(websocket->websocket);
    websocket->websocket = nullptr;
  }
  bool no_activity = false;
  {
    std::lock_guard<std::mutex> lock(addon->websocket_mutex);
    auto it = std::find(addon->websockets.begin(), addon->websockets.end(),
                        websocket);
    if (it != addon->websockets.end()) addon->websockets.erase(it);
    no_activity = addon->websockets.empty();
  }
  {
    std::lock_guard<std::mutex> lock(addon->request_mutex);
    no_activity = no_activity && addon->requests.empty();
  }
  if (no_activity) uv_unref(reinterpret_cast<uv_handle_t*>(&addon->async));
}

void DestroyWebSocketState(WebSocketState* websocket) {
  if (!websocket || !websocket->owner) return;
  AddonState* addon = websocket->owner;
  if (websocket->callback) {
    napi_delete_reference(addon->env, websocket->callback);
    websocket->callback = nullptr;
  }
  delete websocket;
}

void DispatchWebSocketEvent(WebSocketState* websocket,
                            const DispatchItem& item) {
  if (!websocket || !websocket->owner || !websocket->callback) return;
  napi_env env = websocket->owner->env;
  napi_value callback;
  if (napi_get_reference_value(env, websocket->callback, &callback) != napi_ok) {
    return;
  }
  napi_value event;
  napi_create_object(env, &event);
  const char* type = "close";
  switch (item.websocket_event) {
    case WebSocketEventType::kOpen: type = "open"; break;
    case WebSocketEventType::kMessage: type = "message"; break;
    case WebSocketEventType::kError: type = "error"; break;
    case WebSocketEventType::kClose: type = "close"; break;
  }
  napi_value type_value;
  napi_create_string_utf8(env, type, NAPI_AUTO_LENGTH, &type_value);
  napi_set_named_property(env, event, "type", type_value);

  if (item.websocket_event == WebSocketEventType::kOpen) {
    napi_value protocol;
    napi_create_string_utf8(env, item.websocket_protocol.c_str(),
                            item.websocket_protocol.size(), &protocol);
    napi_set_named_property(env, event, "protocol", protocol);
  } else if (item.websocket_event == WebSocketEventType::kMessage) {
    napi_value data;
    void* data_ptr = nullptr;
    napi_create_buffer_copy(env, item.websocket_data.size(),
                            item.websocket_data.data(), &data_ptr, &data);
    napi_set_named_property(env, event, "data", data);
    napi_value is_text;
    napi_get_boolean(env, item.websocket_is_text, &is_text);
    napi_set_named_property(env, event, "isText", is_text);
  } else if (item.websocket_event == WebSocketEventType::kError) {
    napi_value message;
    napi_create_string_utf8(env, item.websocket_error.c_str(),
                            item.websocket_error.size(), &message);
    napi_set_named_property(env, event, "message", message);
    napi_value error_code;
    napi_create_int32(env, item.websocket_error_code, &error_code);
    napi_set_named_property(env, event, "netError", error_code);
  } else {
    napi_value code;
    napi_create_uint32(env, item.websocket_close_code, &code);
    napi_set_named_property(env, event, "code", code);
    napi_value reason;
    napi_create_string_utf8(env, item.websocket_close_reason.c_str(),
                            item.websocket_close_reason.size(), &reason);
    napi_set_named_property(env, event, "reason", reason);
    napi_value was_clean;
    napi_get_boolean(env, item.websocket_was_clean, &was_clean);
    napi_set_named_property(env, event, "wasClean", was_clean);
  }

  napi_value global;
  napi_get_global(env, &global);
  napi_value result;
  napi_call_function(env, global, callback, 1, &event, &result);
}

void ProcessDispatch(uv_async_t* async) {
  AddonState* addon = static_cast<AddonState*>(async->data);
  if (!addon) return;
  napi_handle_scope scope = nullptr;
  napi_open_handle_scope(addon->env, &scope);
  for (;;) {
    DispatchItem item;
    {
      std::lock_guard<std::mutex> lock(addon->dispatch_mutex);
      if (addon->dispatch_queue.empty()) break;
      item = addon->dispatch_queue.front();
      addon->dispatch_queue.pop_front();
    }
    if (item.type == DispatchType::kRunnable) {
      addon->api.Cronet_Runnable_Run(item.runnable);
      addon->api.Cronet_Runnable_Destroy(item.runnable);
    } else if (item.type == DispatchType::kCleanup) {
      CleanupRequest(item.request);
    } else if (item.type == DispatchType::kStream) {
      const bool terminal = item.stream_event == StreamEventType::kEnd ||
                            item.stream_event == StreamEventType::kError;
      DispatchStreamEvent(item.request, item);
      if (terminal) CleanupRequest(item.request);
    } else if (item.type == DispatchType::kWebSocket) {
      // The cyCronet callback reader terminates after reporting an error, so
      // its opaque handle can be released at once. The direct Cronet API can
      // report error followed by close; keep that state alive until close so
      // the second callback cannot dereference freed memory.
      const bool terminal_event =
          item.websocket_event == WebSocketEventType::kClose ||
          (item.websocket_event == WebSocketEventType::kError &&
           item.websocket &&
           item.websocket->backend == WebSocketBackend::kCycronet);
      if (terminal_event) {
        // Release the native handle before invoking user JavaScript. Promise
        // continuations scheduled by the callback can then close the engine
        // without observing this already-terminal socket as active.
        ReleaseWebSocketHandle(item.websocket);
      }
      DispatchWebSocketEvent(item.websocket, item);
      if (terminal_event) DestroyWebSocketState(item.websocket);
    }
  }
  napi_close_handle_scope(addon->env, scope);
}

void AsyncClosed(uv_handle_t*) {}

void CleanupEnvironment(void* data) {
  AddonState* addon = static_cast<AddonState*>(data);
  if (!addon) return;
  addon->cleanup_started = true;
  g_addon.store(nullptr);

  std::vector<WebSocketState*> websockets;
  {
    std::lock_guard<std::mutex> lock(addon->websocket_mutex);
    websockets.swap(addon->websockets);
  }
  for (WebSocketState* websocket : websockets) {
    if (websocket->backend == WebSocketBackend::kCycronet) {
      if (websocket->cycronet_websocket) {
        addon->cycronet_api.websocket_destroy(websocket->cycronet_websocket);
        websocket->cycronet_websocket = nullptr;
      }
      if (!websocket->cycronet_session_id.empty()) {
        addon->cycronet_api.session_destroy(
            websocket->cycronet_session_id.c_str());
        websocket->cycronet_session_id.clear();
      }
    } else if (websocket->websocket) {
      addon->api.websocket_destroy(websocket->websocket);
      websocket->websocket = nullptr;
    }
    if (websocket->callback) {
      napi_delete_reference(addon->env, websocket->callback);
      websocket->callback = nullptr;
    }
    delete websocket;
  }

  if (addon->cycronet_started) {
    addon->cycronet_api.shutdown();
    addon->cycronet_started = false;
  }

  if (addon->async_initialized && !uv_is_closing(
                                    reinterpret_cast<uv_handle_t*>(&addon->async))) {
    uv_close(reinterpret_cast<uv_handle_t*>(&addon->async), AsyncClosed);
  }
}

bool ParseHeaders(napi_env env,
                  napi_value options,
                  std::vector<std::pair<std::string, std::string>>* headers) {
  napi_value value;
  if (napi_get_named_property(env, options, "headers", &value) != napi_ok ||
      IsUndefined(env, value)) {
    return true;
  }
  bool is_array = false;
  if (napi_is_array(env, value, &is_array) != napi_ok || !is_array) {
    ThrowTypeError(env, "headers must be an array of [name, value] pairs");
    return false;
  }
  uint32_t length = 0;
  napi_get_array_length(env, value, &length);
  for (uint32_t i = 0; i < length; ++i) {
    napi_value pair;
    napi_get_element(env, value, i, &pair);
    bool pair_array = false;
    napi_is_array(env, pair, &pair_array);
    uint32_t pair_length = 0;
    if (!pair_array || napi_get_array_length(env, pair, &pair_length) != napi_ok ||
        pair_length != 2) {
      ThrowTypeError(env, "each header must be a [name, value] pair");
      return false;
    }
    napi_value name_value;
    napi_value header_value;
    napi_get_element(env, pair, 0, &name_value);
    napi_get_element(env, pair, 1, &header_value);
    std::string name;
    std::string header;
    if (!GetStringValue(env, name_value, "header name", &name) ||
        !GetStringValue(env, header_value, "header value", &header)) {
      return false;
    }
    headers->emplace_back(std::move(name), std::move(header));
  }
  return true;
}

std::string SerializeWebSocketHeaders(
    const std::vector<std::pair<std::string, std::string>>& headers) {
  std::string result;
  for (const auto& entry : headers) {
    if (entry.first.empty()) continue;
    result.append(entry.first);
    result.append(": ");
    result.append(entry.second);
    result.append("\r\n");
  }
  return result;
}

bool ParseBody(napi_env env,
               napi_value options,
               std::vector<uint8_t>* body) {
  napi_value value;
  if (napi_get_named_property(env, options, "body", &value) != napi_ok ||
      IsUndefined(env, value) || IsNull(env, value)) {
    return true;
  }
  bool is_buffer = false;
  if (napi_is_buffer(env, value, &is_buffer) != napi_ok || !is_buffer) {
    ThrowTypeError(env, "body must be a Buffer");
    return false;
  }
  void* data = nullptr;
  size_t length = 0;
  if (napi_get_buffer_info(env, value, &data, &length) != napi_ok) {
    ThrowTypeError(env, "body must be a valid Buffer");
    return false;
  }
  const auto* bytes = static_cast<const uint8_t*>(data);
  if (length > 0) body->assign(bytes, bytes + length);
  return true;
}

Cronet_EngineParams_HTTP_CACHE_MODE ParseCacheMode(const std::string& mode,
                                                   bool* valid) {
  *valid = true;
  if (mode.empty() || mode == "disabled") {
    return Cronet_EngineParams_HTTP_CACHE_MODE_DISABLED;
  }
  if (mode == "memory" || mode == "in-memory") {
    return Cronet_EngineParams_HTTP_CACHE_MODE_IN_MEMORY;
  }
  if (mode == "disk-no-http") {
    return Cronet_EngineParams_HTTP_CACHE_MODE_DISK_NO_HTTP;
  }
  if (mode == "disk") return Cronet_EngineParams_HTTP_CACHE_MODE_DISK;
  *valid = false;
  return Cronet_EngineParams_HTTP_CACHE_MODE_DISABLED;
}

napi_value NativeInit(napi_env env, napi_callback_info info) {
  AddonState* addon = g_addon.load();
  if (!addon) {
    ThrowError(env, "Cronet addon is not available");
    return nullptr;
  }
  if (addon->engine_started) return Undefined(env);

  size_t argc = 1;
  napi_value argv[1];
  napi_value this_value;
  napi_get_cb_info(env, info, &argc, argv, &this_value, nullptr);
  napi_value options = argc == 1 ? argv[0] : nullptr;
  if (!options || IsUndefined(env, options)) {
    napi_create_object(env, &options);
  }

  std::string dll_path;
  std::string user_agent;
  std::string accept_language;
  std::string storage_path;
  std::string cache_mode;
  std::string proxy_rules;
  std::string websocket_library_path;
  std::vector<std::string> cycronet_cipher_suites;
  std::vector<std::string> cycronet_tls_curves;
  std::vector<std::string> cycronet_tls_extensions;
  std::vector<uint64_t> tls_extension_ids;
  bool skip_cert_verify = false;
  bool randomize_tls_extensions = true;
  bool cycronet_allow_redirects = true;
  int64_t cycronet_timeout_ms = 30000;
  std::string experimental_options;
  bool enable_check_result = false;
  bool enable_quic = true;
  bool enable_http2 = true;
  bool enable_brotli = true;
  int64_t cache_max_size = 0;
  if (!GetOptionalString(env, options, "dllPath", &dll_path) ||
      !GetOptionalString(env, options, "userAgent", &user_agent) ||
      !GetOptionalString(env, options, "acceptLanguage", &accept_language) ||
      !GetOptionalString(env, options, "storagePath", &storage_path) ||
      !GetOptionalString(env, options, "cacheMode", &cache_mode) ||
      !GetOptionalString(env, options, "proxyRules", &proxy_rules) ||
      !GetOptionalString(env, options, "websocketLibraryPath",
                         &websocket_library_path) ||
      !GetOptionalStringArray(env, options, "cycronetCipherSuites",
                              &cycronet_cipher_suites) ||
      !GetOptionalStringArray(env, options, "cycronetTlsCurves",
                              &cycronet_tls_curves) ||
      !GetOptionalStringArray(env, options, "cycronetTlsExtensions",
                              &cycronet_tls_extensions) ||
      !GetOptionalTlsExtensionArray(env, options, "tlsExtensionIds",
                                    &tls_extension_ids) ||
      !GetOptionalBool(env, options, "skipCertVerify", &skip_cert_verify) ||
      !GetOptionalBool(env, options, "randomizeTlsExtensions",
                       &randomize_tls_extensions) ||
      !GetOptionalBool(env, options, "allowRedirects",
                       &cycronet_allow_redirects) ||
      !GetOptionalInt64(env, options, "timeoutMs", &cycronet_timeout_ms) ||
      !GetOptionalString(env, options, "experimentalOptions",
                         &experimental_options) ||
      !GetOptionalBool(env, options, "enableCheckResult", &enable_check_result) ||
      !GetOptionalBool(env, options, "enableQuic", &enable_quic) ||
      !GetOptionalBool(env, options, "enableHttp2", &enable_http2) ||
      !GetOptionalBool(env, options, "enableBrotli", &enable_brotli) ||
      !GetOptionalInt64(env, options, "cacheMaxSize", &cache_max_size)) {
    return nullptr;
  }
  if (cycronet_timeout_ms < 0) {
    ThrowTypeError(env, "timeoutMs must be a non-negative integer");
    return nullptr;
  }
  if (dll_path.empty()) {
    ThrowTypeError(env, "dllPath must be a non-empty path to a Cronet shared library");
    return nullptr;
  }
  bool cache_mode_valid = false;
  Cronet_EngineParams_HTTP_CACHE_MODE parsed_cache_mode =
      ParseCacheMode(cache_mode, &cache_mode_valid);
  if (!cache_mode_valid) {
    ThrowTypeError(env, "cacheMode must be disabled, memory, disk-no-http, or disk");
    return nullptr;
  }
  if (!addon->module) {
#if defined(_WIN32)
    std::wstring wide_path = Utf8ToWide(dll_path);
    if (wide_path.empty()) {
      ThrowTypeError(env, "dllPath must be valid UTF-8");
      return nullptr;
    }
    addon->module = LoadLibraryW(wide_path.c_str());
#else
    addon->module = dlopen(dll_path.c_str(), RTLD_NOW | RTLD_LOCAL);
#endif
    if (!addon->module) {
      ThrowError(env, LoadError(dll_path));
      return nullptr;
    }
    std::string missing;
    if (!addon->api.Load(addon->module, &missing)) {
#if defined(_WIN32)
      FreeLibrary(addon->module);
#else
      dlclose(addon->module);
#endif
      addon->module = nullptr;
      ThrowError(env, "Cronet shared library is missing exported symbol '" +
                          missing + "'");
      return nullptr;
    }
    addon->module_path = dll_path;
  } else if (addon->module_path != dll_path) {
    ThrowError(env, "Only one Cronet DLL path can be used by this addon instance");
    return nullptr;
  }

  if (!tls_extension_ids.empty() && !addon->api.HasTlsExtensionSetter()) {
    ThrowError(
        env,
        "The selected Cronet DLL does not export "
        "Cronet_EngineParams_experimental_options_set_with_tls_extensions");
    return nullptr;
  }

  // Optional cyCronet Rust C ABI backend. It owns its own Cronet
  // engine/session and is loaded separately from the ordinary Cronet C API.
  bool loaded_cycronet_module = false;
  if (!websocket_library_path.empty() && !addon->cycronet_module) {
#if defined(_WIN32)
    std::wstring wide_websocket_path = Utf8ToWide(websocket_library_path);
    if (wide_websocket_path.empty()) {
      ThrowTypeError(env, "websocketLibraryPath must be valid UTF-8");
      return nullptr;
    }
    addon->cycronet_module = LoadLibraryW(wide_websocket_path.c_str());
#else
    addon->cycronet_module =
        dlopen(websocket_library_path.c_str(), RTLD_NOW | RTLD_LOCAL);
#endif
    if (!addon->cycronet_module) {
      ThrowError(env, LoadError(websocket_library_path));
      return nullptr;
    }
    std::string missing;
    if (!addon->cycronet_api.Load(addon->cycronet_module, &missing)) {
#if defined(_WIN32)
      FreeLibrary(addon->cycronet_module);
#else
      dlclose(addon->cycronet_module);
#endif
      addon->cycronet_module = nullptr;
      ThrowError(env, "cycronet WebSocket library is missing exported symbol '" +
                          missing + "'");
      return nullptr;
    }
    addon->cycronet_module_path = websocket_library_path;
    loaded_cycronet_module = true;
  } else if (!websocket_library_path.empty() &&
             addon->cycronet_module_path != websocket_library_path) {
    ThrowError(env,
               "Only one cycronet WebSocket library path can be used by this "
               "addon instance");
    return nullptr;
  }

  if (!websocket_library_path.empty() || loaded_cycronet_module) {
    addon->cycronet_cipher_suites = std::move(cycronet_cipher_suites);
    addon->cycronet_tls_curves = std::move(cycronet_tls_curves);
    addon->cycronet_tls_extensions = std::move(cycronet_tls_extensions);
    addon->cycronet_proxy_rules = proxy_rules;
    addon->cycronet_skip_cert_verify = skip_cert_verify;
    addon->cycronet_timeout_ms = static_cast<uint64_t>(cycronet_timeout_ms);
    addon->cycronet_allow_redirects = cycronet_allow_redirects;
  }
  if (addon->cycronet_module && !addon->cycronet_started) {
    if (addon->cycronet_api.init() != 0) {
      if (loaded_cycronet_module) {
#if defined(_WIN32)
        FreeLibrary(addon->cycronet_module);
#else
        dlclose(addon->cycronet_module);
#endif
        addon->cycronet_module = nullptr;
        addon->cycronet_module_path.clear();
      }
      ThrowError(env, "cycronet_init failed");
      return nullptr;
    }
    addon->cycronet_started = true;
  }

  addon->engine = addon->api.Cronet_Engine_Create();
  if (!addon->engine) {
    ThrowError(env, "Cronet_Engine_Create failed");
    return nullptr;
  }
  Cronet_EngineParamsPtr params = addon->api.Cronet_EngineParams_Create();
  if (!params) {
    addon->api.Cronet_Engine_Destroy(addon->engine);
    addon->engine = nullptr;
    ThrowError(env, "Cronet_EngineParams_Create failed");
    return nullptr;
  }
  if (user_agent.empty()) {
    user_agent =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/150.0.0.0 Safari/537.36";
  }
  addon->api.Cronet_EngineParams_enable_check_result_set(params,
                                                         enable_check_result);
  addon->api.Cronet_EngineParams_user_agent_set(params, user_agent.c_str());
  if (!accept_language.empty()) {
    addon->api.Cronet_EngineParams_accept_language_set(params,
                                                       accept_language.c_str());
  }
  if (!storage_path.empty()) {
    addon->api.Cronet_EngineParams_storage_path_set(params, storage_path.c_str());
  }
  if (!proxy_rules.empty()) {
    if (!addon->api.proxy_rules_set) {
      addon->api.Cronet_EngineParams_Destroy(params);
      addon->api.Cronet_Engine_Destroy(addon->engine);
      addon->engine = nullptr;
      ThrowError(env, "This Cronet DLL does not export proxy_rules_set");
      return nullptr;
    }
    addon->api.proxy_rules_set(params, proxy_rules.c_str());
  }
  if (skip_cert_verify) {
    if (!addon->api.skip_cert_verify_set) {
      addon->api.Cronet_EngineParams_Destroy(params);
      addon->api.Cronet_Engine_Destroy(addon->engine);
      addon->engine = nullptr;
      ThrowError(env, "This Cronet DLL does not export skip_cert_verify_set");
      return nullptr;
    }
    addon->api.skip_cert_verify_set(params, true);
  }
  addon->api.Cronet_EngineParams_enable_quic_set(params, enable_quic);
  addon->api.Cronet_EngineParams_enable_http2_set(params, enable_http2);
  addon->api.Cronet_EngineParams_enable_brotli_set(params, enable_brotli);
  addon->api.Cronet_EngineParams_http_cache_mode_set(params, parsed_cache_mode);
  addon->api.Cronet_EngineParams_http_cache_max_size_set(params, cache_max_size);
  if (!tls_extension_ids.empty()) {
    addon->api.experimental_options_set_with_tls_extensions(
        params,
        experimental_options.c_str(),
        tls_extension_ids.data(),
        static_cast<uint32_t>(tls_extension_ids.size()),
        randomize_tls_extensions);
  } else if (!experimental_options.empty()) {
    addon->api.Cronet_EngineParams_experimental_options_set(
        params, experimental_options.c_str());
  }
  Cronet_RESULT result = addon->api.Cronet_Engine_StartWithParams(addon->engine,
                                                                  params);
  addon->api.Cronet_EngineParams_Destroy(params);
  if (result != Cronet_RESULT_SUCCESS) {
    addon->api.Cronet_Engine_Destroy(addon->engine);
    addon->engine = nullptr;
    ThrowError(env, "Cronet_Engine_StartWithParams failed with result " +
                        std::to_string(result));
    return nullptr;
  }
  addon->engine_started = true;
  napi_value version;
  napi_create_string_utf8(
      env, addon->api.Cronet_Engine_GetVersionString(addon->engine),
      NAPI_AUTO_LENGTH, &version);
  return version;
}

napi_value NativeRequest(napi_env env, napi_callback_info info) {
  AddonState* addon = g_addon.load();
  if (!addon || !addon->engine_started) {
    ThrowError(env, "Cronet engine is not initialized");
    return nullptr;
  }
  size_t argc = 1;
  napi_value argv[1];
  napi_value this_value;
  napi_get_cb_info(env, info, &argc, argv, &this_value, nullptr);
  if (argc != 1) {
    ThrowTypeError(env, "request requires an options object");
    return nullptr;
  }
  napi_valuetype options_type;
  napi_typeof(env, argv[0], &options_type);
  if (options_type != napi_object) {
    ThrowTypeError(env, "request options must be an object");
    return nullptr;
  }

  RequestState parsed;
  parsed.owner = addon;
  napi_value url_value;
  if (napi_get_named_property(env, argv[0], "url", &url_value) != napi_ok ||
      !GetStringValue(env, url_value, "url", &parsed.url)) {
    return nullptr;
  }
  if (parsed.url.empty()) {
    ThrowTypeError(env, "url must be a non-empty string");
    return nullptr;
  }
  parsed.method = "GET";
  if (!GetOptionalString(env, argv[0], "method", &parsed.method)) return nullptr;
  std::transform(parsed.method.begin(), parsed.method.end(), parsed.method.begin(),
                 [](unsigned char c) { return static_cast<char>(std::toupper(c)); });
  if (parsed.method.empty()) parsed.method = "GET";

  std::vector<std::pair<std::string, std::string>> request_headers;
  if (!ParseHeaders(env, argv[0], &request_headers) ||
      !ParseBody(env, argv[0], &parsed.upload_body)) {
    return nullptr;
  }
  if (!parsed.upload_body.empty() &&
      (parsed.method == "GET" || parsed.method == "HEAD")) {
    ThrowTypeError(env, parsed.method + " requests cannot have a body");
    return nullptr;
  }
  bool disable_cache = false;
  if (!GetOptionalBool(env, argv[0], "disableCache", &disable_cache)) {
    return nullptr;
  }
  Cronet_UrlRequestParams_REQUEST_PRIORITY priority =
      Cronet_UrlRequestParams_REQUEST_PRIORITY_REQUEST_PRIORITY_MEDIUM;
  if (!GetOptionalPriority(env, argv[0], "priority", &priority)) return nullptr;

  bool streaming = false;
  if (!GetOptionalBool(env, argv[0], "streaming", &streaming)) return nullptr;
  bool allow_redirects = true;
  if (!GetOptionalBool(env, argv[0], "allowRedirects", &allow_redirects)) {
    return nullptr;
  }

  napi_value promise = nullptr;
  napi_deferred deferred = nullptr;
  if (!streaming && napi_create_promise(env, &deferred, &promise) != napi_ok) {
    return nullptr;
  }
  auto* request = new RequestState();
  request->owner = addon;
  request->url = std::move(parsed.url);
  request->method = std::move(parsed.method);
  request->upload_body = std::move(parsed.upload_body);
  request->deferred = deferred;
  request->allow_redirects = allow_redirects;
  request->streaming = streaming;
  if (streaming) {
    auto release_stream_refs = [&]() {
      if (request->stream_on_headers) {
        napi_delete_reference(env, request->stream_on_headers);
        request->stream_on_headers = nullptr;
      }
      if (request->stream_on_chunk) {
        napi_delete_reference(env, request->stream_on_chunk);
        request->stream_on_chunk = nullptr;
      }
      if (request->stream_on_end) {
        napi_delete_reference(env, request->stream_on_end);
        request->stream_on_end = nullptr;
      }
      if (request->stream_on_error) {
        napi_delete_reference(env, request->stream_on_error);
        request->stream_on_error = nullptr;
      }
    };
    if (!GetRequiredCallbackReference(env, argv[0], "onHeaders",
                                      &request->stream_on_headers) ||
        !GetRequiredCallbackReference(env, argv[0], "onChunk",
                                      &request->stream_on_chunk) ||
        !GetRequiredCallbackReference(env, argv[0], "onEnd",
                                      &request->stream_on_end) ||
        !GetRequiredCallbackReference(env, argv[0], "onError",
                                      &request->stream_on_error)) {
      release_stream_refs();
      delete request;
      return nullptr;
    }
  }
  {
    std::lock_guard<std::mutex> lock(addon->request_mutex);
    request->id = addon->next_request_id++;
    if (addon->requests.empty()) uv_ref(reinterpret_cast<uv_handle_t*>(&addon->async));
    addon->requests.push_back(request);
  }

  Cronet_UrlRequestParamsPtr params = addon->api.Cronet_UrlRequestParams_Create();
  request->callback = addon->api.Cronet_UrlRequestCallback_CreateWith(
      OnRedirectReceived, OnResponseStarted, OnReadCompleted, OnSucceeded,
      OnFailed, OnCanceled);
  request->executor = addon->api.Cronet_Executor_CreateWith(ExecutorExecute);
  if (!params || !request->callback || !request->executor) {
    if (params) addon->api.Cronet_UrlRequestParams_Destroy(params);
    request->error_message = "Cronet request object allocation failed";
    request->error_code = -1;
    FinishRequest(request, false, false);
    return MakeRequestHandle(env, request, promise);
  }
  addon->api.Cronet_UrlRequestCallback_SetClientContext(request->callback, request);

  addon->api.Cronet_UrlRequestParams_http_method_set(params, request->method.c_str());
  addon->api.Cronet_UrlRequestParams_disable_cache_set(params, disable_cache);
  addon->api.Cronet_UrlRequestParams_priority_set(params, priority);
  addon->api.Cronet_UrlRequestParams_allow_direct_executor_set(params, false);
  for (const auto& entry : request_headers) {
    Cronet_HttpHeaderPtr header = addon->api.Cronet_HttpHeader_Create();
    if (!header) {
      addon->api.Cronet_UrlRequestParams_Destroy(params);
      request->error_code = -1;
      request->error_message = "Cronet request header allocation failed";
      FinishRequest(request, false, false);
      return MakeRequestHandle(env, request, promise);
    }
    addon->api.Cronet_HttpHeader_name_set(header, entry.first.c_str());
    addon->api.Cronet_HttpHeader_value_set(header, entry.second.c_str());
    addon->api.Cronet_UrlRequestParams_request_headers_add(params, header);
    addon->api.Cronet_HttpHeader_Destroy(header);
  }
  if (!request->upload_body.empty()) {
    request->upload_provider = addon->api.Cronet_UploadDataProvider_CreateWith(
        UploadGetLength, UploadRead, UploadRewind, UploadClose);
    if (!request->upload_provider) {
      addon->api.Cronet_UrlRequestParams_Destroy(params);
      request->error_code = -1;
      request->error_message = "Cronet upload provider allocation failed";
      FinishRequest(request, false, false);
      return MakeRequestHandle(env, request, promise);
    }
    addon->api.Cronet_UploadDataProvider_SetClientContext(request->upload_provider,
                                                          request);
    addon->api.Cronet_UrlRequestParams_upload_data_provider_set(
        params, request->upload_provider);
  }

  request->request = addon->api.Cronet_UrlRequest_Create();
  if (!request->request) {
    addon->api.Cronet_UrlRequestParams_Destroy(params);
    request->error_code = -1;
    request->error_message = "Cronet URL request allocation failed";
    FinishRequest(request, false, false);
    return MakeRequestHandle(env, request, promise);
  }
  addon->api.Cronet_UrlRequest_SetClientContext(request->request, request);
  Cronet_RESULT result = addon->api.Cronet_UrlRequest_InitWithParams(
      request->request, addon->engine, request->url.c_str(), params,
      request->callback, request->executor);
  addon->api.Cronet_UrlRequestParams_Destroy(params);
  if (result != Cronet_RESULT_SUCCESS) {
    request->error_code = result;
    request->error_message = "Cronet_UrlRequest_InitWithParams failed";
    FinishRequest(request, false, false);
  } else {
    result = addon->api.Cronet_UrlRequest_Start(request->request);
    if (result != Cronet_RESULT_SUCCESS) {
      request->error_code = result;
      request->error_message = "Cronet_UrlRequest_Start failed";
      FinishRequest(request, false, false);
    }
  }

  return MakeRequestHandle(env, request, promise);
}

napi_value NativeRequestSync(napi_env env, napi_callback_info info) {
  AddonState* addon = g_addon.load();
  if (!addon || !addon->engine_started) {
    ThrowError(env, "Cronet engine is not initialized");
    return nullptr;
  }

  size_t argc = 1;
  napi_value argv[1];
  napi_value this_value;
  napi_get_cb_info(env, info, &argc, argv, &this_value, nullptr);
  if (argc != 1) {
    ThrowTypeError(env, "requestSync requires an options object");
    return nullptr;
  }
  napi_valuetype options_type;
  napi_typeof(env, argv[0], &options_type);
  if (options_type != napi_object) {
    ThrowTypeError(env, "requestSync options must be an object");
    return nullptr;
  }

  auto* state = new SyncRequestState();
  state->owner = addon;
  if (napi_get_named_property(env, argv[0], "url", &this_value) != napi_ok ||
      !GetStringValue(env, this_value, "url", &state->url)) {
    delete state;
    return nullptr;
  }
  if (state->url.empty()) {
    delete state;
    ThrowTypeError(env, "url must be a non-empty string");
    return nullptr;
  }

  state->method = "GET";
  if (!GetOptionalString(env, argv[0], "method", &state->method)) {
    delete state;
    return nullptr;
  }
  std::transform(state->method.begin(), state->method.end(), state->method.begin(),
                 [](unsigned char c) { return static_cast<char>(std::toupper(c)); });
  if (state->method.empty()) state->method = "GET";

  std::vector<std::pair<std::string, std::string>> request_headers;
  if (!ParseHeaders(env, argv[0], &request_headers) ||
      !ParseBody(env, argv[0], &state->upload_body)) {
    delete state;
    return nullptr;
  }
  if (!state->upload_body.empty() &&
      (state->method == "GET" || state->method == "HEAD")) {
    std::string invalid_method = state->method;
    delete state;
    ThrowTypeError(env, invalid_method + " requests cannot have a body");
    return nullptr;
  }

  bool disable_cache = false;
  if (!GetOptionalBool(env, argv[0], "disableCache", &disable_cache)) {
    delete state;
    return nullptr;
  }
  bool allow_redirects = true;
  if (!GetOptionalBool(env, argv[0], "allowRedirects", &allow_redirects)) {
    delete state;
    return nullptr;
  }
  state->allow_redirects = allow_redirects;
  Cronet_UrlRequestParams_REQUEST_PRIORITY priority =
      Cronet_UrlRequestParams_REQUEST_PRIORITY_REQUEST_PRIORITY_MEDIUM;
  if (!GetOptionalPriority(env, argv[0], "priority", &priority)) {
    delete state;
    return nullptr;
  }
  int64_t timeout_ms = 30000;
  if (!GetOptionalInt64(env, argv[0], "timeoutMs", &timeout_ms)) {
    delete state;
    return nullptr;
  }
  if (timeout_ms < 0) {
    delete state;
    ThrowTypeError(env, "timeoutMs must be a non-negative integer");
    return nullptr;
  }

  auto cleanup = [&]() {
    if (state->request) {
      addon->api.Cronet_UrlRequest_Destroy(state->request);
      state->request = nullptr;
    }
    if (state->callback) {
      addon->api.Cronet_UrlRequestCallback_Destroy(state->callback);
      state->callback = nullptr;
    }
    if (state->executor) {
      addon->api.Cronet_Executor_Destroy(state->executor);
      state->executor = nullptr;
    }
    if (state->upload_provider) {
      addon->api.Cronet_UploadDataProvider_Destroy(state->upload_provider);
      state->upload_provider = nullptr;
    }
  };

  Cronet_UrlRequestParamsPtr params = addon->api.Cronet_UrlRequestParams_Create();
  state->callback = addon->api.Cronet_UrlRequestCallback_CreateWith(
      SyncOnRedirectReceived, SyncOnResponseStarted, SyncOnReadCompleted,
      SyncOnSucceeded, SyncOnFailed, SyncOnCanceled);
  state->executor = addon->api.Cronet_Executor_CreateWith(SyncExecutorExecute);
  if (!params || !state->callback || !state->executor) {
    if (params) addon->api.Cronet_UrlRequestParams_Destroy(params);
    cleanup();
    delete state;
    ThrowError(env, "Cronet synchronous request object allocation failed");
    return nullptr;
  }

  addon->api.Cronet_UrlRequestCallback_SetClientContext(state->callback, state);
  addon->api.Cronet_UrlRequestParams_http_method_set(params, state->method.c_str());
  addon->api.Cronet_UrlRequestParams_disable_cache_set(params, disable_cache);
  addon->api.Cronet_UrlRequestParams_priority_set(params, priority);
  addon->api.Cronet_UrlRequestParams_allow_direct_executor_set(params, false);
  for (const auto& entry : request_headers) {
    Cronet_HttpHeaderPtr header = addon->api.Cronet_HttpHeader_Create();
    if (!header) {
      addon->api.Cronet_UrlRequestParams_Destroy(params);
      cleanup();
      delete state;
      ThrowError(env, "Cronet synchronous request header allocation failed");
      return nullptr;
    }
    addon->api.Cronet_HttpHeader_name_set(header, entry.first.c_str());
    addon->api.Cronet_HttpHeader_value_set(header, entry.second.c_str());
    addon->api.Cronet_UrlRequestParams_request_headers_add(params, header);
    addon->api.Cronet_HttpHeader_Destroy(header);
  }
  if (!state->upload_body.empty()) {
    state->upload_provider = addon->api.Cronet_UploadDataProvider_CreateWith(
        SyncUploadGetLength, SyncUploadRead, SyncUploadRewind, SyncUploadClose);
    if (!state->upload_provider) {
      addon->api.Cronet_UrlRequestParams_Destroy(params);
      cleanup();
      delete state;
      ThrowError(env, "Cronet synchronous upload provider allocation failed");
      return nullptr;
    }
    addon->api.Cronet_UploadDataProvider_SetClientContext(
        state->upload_provider, state);
    addon->api.Cronet_UrlRequestParams_upload_data_provider_set(
        params, state->upload_provider);
  }

  state->request = addon->api.Cronet_UrlRequest_Create();
  if (!state->request) {
    addon->api.Cronet_UrlRequestParams_Destroy(params);
    cleanup();
    delete state;
    ThrowError(env, "Cronet synchronous URL request allocation failed");
    return nullptr;
  }
  addon->api.Cronet_UrlRequest_SetClientContext(state->request, state);
  Cronet_RESULT result = addon->api.Cronet_UrlRequest_InitWithParams(
      state->request, addon->engine, state->url.c_str(), params,
      state->callback, state->executor);
  addon->api.Cronet_UrlRequestParams_Destroy(params);
  params = nullptr;
  if (result != Cronet_RESULT_SUCCESS) {
    cleanup();
    delete state;
    ThrowError(env, "Cronet synchronous UrlRequest initialization failed with result " +
                         std::to_string(result));
    return nullptr;
  }

  result = addon->api.Cronet_UrlRequest_Start(state->request);
  if (result != Cronet_RESULT_SUCCESS) {
    cleanup();
    delete state;
    ThrowError(env, "Cronet synchronous UrlRequest start failed with result " +
                         std::to_string(result));
    return nullptr;
  }

  auto completed = [state]() {
    return state->done && state->callback_depth == 0;
  };
  bool timed_out = false;
  {
    std::unique_lock<std::mutex> lock(state->mutex);
    if (timeout_ms == 0) {
      timed_out = !state->condition.wait_for(lock, std::chrono::milliseconds(0),
                                             completed);
    } else {
      timed_out = !state->condition.wait_for(
          lock, std::chrono::milliseconds(timeout_ms), completed);
    }
  }
  if (timed_out) {
    SyncFail(state, "Cronet synchronous request timed out", -7);
    std::unique_lock<std::mutex> lock(state->mutex);
    state->condition.wait(lock, completed);
  }

  bool succeeded = false;
  std::string error_message;
  int error_code = 0;
  napi_value response = nullptr;
  {
    std::lock_guard<std::mutex> lock(state->mutex);
    succeeded = state->succeeded && !state->forced_failure;
    error_message = state->error_message;
    error_code = state->error_code;
    if (succeeded) response = MakeSyncResponse(state);
  }
  cleanup();
  if (!succeeded) {
    delete state;
    if (error_message.empty()) error_message = "Cronet synchronous request failed";
    ThrowError(env, error_message + " (error " + std::to_string(error_code) + ")");
    return nullptr;
  }
  delete state;
  return response;
}

bool GetIdValue(napi_env env, napi_value value, uint64_t* id,
                const char* field) {
  napi_valuetype type;
  if (napi_typeof(env, value, &type) != napi_ok) return false;
  if (type == napi_bigint) {
    bool lossless = false;
    if (napi_get_value_bigint_uint64(env, value, id, &lossless) != napi_ok ||
        !lossless) {
      ThrowTypeError(env, std::string(field) + " must be a non-negative integer");
      return false;
    }
    return true;
  }
  if (type == napi_number) {
    uint32_t number_id = 0;
    if (napi_get_value_uint32(env, value, &number_id) != napi_ok) {
      ThrowTypeError(env, std::string(field) + " must be a non-negative integer");
      return false;
    }
    *id = number_id;
    return true;
  }
  ThrowTypeError(env, std::string(field) + " must be a bigint or number");
  return false;
}

WebSocketState* FindWebSocket(AddonState* addon, uint64_t id) {
  if (!addon) return nullptr;
  std::lock_guard<std::mutex> lock(addon->websocket_mutex);
  for (WebSocketState* websocket : addon->websockets) {
    if (websocket->id == id) return websocket;
  }
  return nullptr;
}

napi_value NativeStreamRead(napi_env env, napi_callback_info info) {
  AddonState* addon = g_addon.load();
  size_t argc = 1;
  napi_value argv[1];
  napi_value this_value;
  napi_get_cb_info(env, info, &argc, argv, &this_value, nullptr);
  if (!addon || argc != 1) {
    ThrowTypeError(env, "streamRead requires a request id");
    return nullptr;
  }
  uint64_t id = 0;
  if (!GetIdValue(env, argv[0], &id, "stream request id")) return nullptr;

  RequestState* request = nullptr;
  {
    std::lock_guard<std::mutex> lock(addon->request_mutex);
    for (RequestState* candidate : addon->requests) {
      if (candidate->id == id) {
        request = candidate;
        break;
      }
    }
  }
  if (!request || !request->streaming || !request->request ||
      !request->stream_buffer || request->finish_queued) {
    ThrowError(env, "Streaming request is no longer active");
    return nullptr;
  }
  napi_value accepted;
  if (request->stream_read_pending) {
    napi_get_boolean(env, false, &accepted);
    return accepted;
  }

  request->stream_read_pending = true;
  Cronet_RESULT result = addon->api.Cronet_UrlRequest_Read(
      request->request, request->stream_buffer);
  if (result != Cronet_RESULT_SUCCESS) {
    request->stream_read_pending = false;
    SetReadFailure(request, "Cronet failed to continue streaming the response");
    napi_get_boolean(env, false, &accepted);
    return accepted;
  }
  napi_get_boolean(env, true, &accepted);
  return accepted;
}

napi_value NativeWebSocketOpen(napi_env env, napi_callback_info info) {
  AddonState* addon = g_addon.load();
  if (!addon || !addon->engine_started) {
    ThrowError(env, "Cronet engine is not initialized");
    return nullptr;
  }
  size_t argc = 1;
  napi_value argv[1];
  napi_value this_value;
  napi_get_cb_info(env, info, &argc, argv, &this_value, nullptr);
  if (argc != 1) {
    ThrowTypeError(env, "websocketOpen requires an options object");
    return nullptr;
  }
  napi_valuetype options_type;
  napi_typeof(env, argv[0], &options_type);
  if (options_type != napi_object) {
    ThrowTypeError(env, "websocketOpen options must be an object");
    return nullptr;
  }

  std::string backend_name;
  if (!GetOptionalString(env, argv[0], "backend", &backend_name)) {
    return nullptr;
  }
  const bool has_direct = addon->api.HasWebSocket();
  const bool has_cycronet = HasCycronetWebSocket(addon);
  bool use_cycronet = false;
  if (backend_name.empty() || backend_name == "auto") {
    // Prefer the cyCronet C ABI when it is explicitly available. It mirrors
    // the Python implementation and owns a session per WebSocket, including
    // its TLS profile and proxy configuration.
    use_cycronet = has_cycronet;
  } else if (backend_name == "cycronet") {
    if (!has_cycronet) {
      ThrowError(env,
                 "The cycronet WebSocket backend was requested, but "
                 "websocketLibraryPath does not expose the complete "
                 "cycronet C ABI");
      return nullptr;
    }
    use_cycronet = true;
  } else if (backend_name == "direct" || backend_name == "cronet") {
    if (!has_direct) {
      ThrowError(env,
                 "The direct Cronet WebSocket backend was requested, but "
                 "the selected library has no Cronet_WebSocket_* exports");
      return nullptr;
    }
    use_cycronet = false;
  } else {
    ThrowTypeError(env, "backend must be auto, cycronet, or direct");
    return nullptr;
  }
  if (!has_direct && !has_cycronet) {
    ThrowError(env,
               "No Cronet WebSocket backend is available; use a Cronet library "
               "rebuilt with cronet-patches 0002-0005 or set "
               "websocketLibraryPath to a cycronet cdll library");
    return nullptr;
  }

  napi_value url_value;
  napi_value callback_value;
  std::string url;
  if (napi_get_named_property(env, argv[0], "url", &url_value) != napi_ok ||
      !GetStringValue(env, url_value, "url", &url)) {
    return nullptr;
  }
  if (napi_get_named_property(env, argv[0], "callback", &callback_value) != napi_ok) {
    ThrowTypeError(env, "callback is required");
    return nullptr;
  }
  napi_valuetype callback_type;
  napi_typeof(env, callback_value, &callback_type);
  if (callback_type != napi_function) {
    ThrowTypeError(env, "callback must be a function");
    return nullptr;
  }

  std::string origin;
  std::string sub_protocols;
  if (!GetOptionalString(env, argv[0], "origin", &origin) ||
      !GetOptionalString(env, argv[0], "subProtocols", &sub_protocols)) {
    return nullptr;
  }
  std::vector<std::pair<std::string, std::string>> headers;
  if (!ParseHeaders(env, argv[0], &headers)) return nullptr;

  auto* websocket = new WebSocketState();
  websocket->owner = addon;
  websocket->backend = use_cycronet ? WebSocketBackend::kCycronet
                                    : WebSocketBackend::kCronet;
  websocket->url = url;
  if (napi_create_reference(env, callback_value, 1, &websocket->callback) != napi_ok) {
    delete websocket;
    ThrowError(env, "Unable to retain WebSocket callback");
    return nullptr;
  }
  if (use_cycronet) {
    std::vector<const char*> cipher_suites;
    cipher_suites.reserve(addon->cycronet_cipher_suites.size());
    for (const auto& value : addon->cycronet_cipher_suites) {
      cipher_suites.push_back(value.c_str());
    }
    std::vector<const char*> tls_curves;
    tls_curves.reserve(addon->cycronet_tls_curves.size());
    for (const auto& value : addon->cycronet_tls_curves) {
      tls_curves.push_back(value.c_str());
    }
    std::vector<const char*> tls_extensions;
    tls_extensions.reserve(addon->cycronet_tls_extensions.size());
    for (const auto& value : addon->cycronet_tls_extensions) {
      tls_extensions.push_back(value.c_str());
    }
    CycronetSessionConfig config{};
    config.proxy_rules = addon->cycronet_proxy_rules.empty()
                             ? nullptr
                             : addon->cycronet_proxy_rules.c_str();
    config.skip_cert_verify = addon->cycronet_skip_cert_verify ? 1 : 0;
    config.timeout_ms = addon->cycronet_timeout_ms;
    config.allow_redirects = addon->cycronet_allow_redirects ? 1 : 0;
    config.cipher_suites = cipher_suites.empty() ? nullptr : cipher_suites.data();
    config.cipher_suites_count = static_cast<int32_t>(cipher_suites.size());
    config.tls_curves = tls_curves.empty() ? nullptr : tls_curves.data();
    config.tls_curves_count = static_cast<int32_t>(tls_curves.size());
    config.tls_extensions =
        tls_extensions.empty() ? nullptr : tls_extensions.data();
    config.tls_extensions_count =
        static_cast<int32_t>(tls_extensions.size());
    char* session_id = addon->cycronet_api.session_create(&config);
    if (!session_id) {
      napi_delete_reference(env, websocket->callback);
      delete websocket;
      ThrowError(env, "cycronet_session_create failed");
      return nullptr;
    }
    websocket->cycronet_session_id.assign(session_id);
    addon->cycronet_api.free_string(session_id);
    websocket->cycronet_websocket = addon->cycronet_api.websocket_create(
        websocket->cycronet_session_id.c_str());
    if (!websocket->cycronet_websocket) {
      addon->cycronet_api.session_destroy(
          websocket->cycronet_session_id.c_str());
      websocket->cycronet_session_id.clear();
      napi_delete_reference(env, websocket->callback);
      delete websocket;
      ThrowError(env, "cycronet_ws_create failed");
      return nullptr;
    }
  } else {
    websocket->websocket = addon->api.websocket_create(
        addon->engine, &kWebSocketCallbacks, websocket);
    if (!websocket->websocket) {
      napi_delete_reference(env, websocket->callback);
      delete websocket;
      ThrowError(env, "Cronet_WebSocket_Create failed");
      return nullptr;
    }
  }
  {
    std::lock_guard<std::mutex> lock(addon->websocket_mutex);
    websocket->id = addon->next_websocket_id++;
    if (addon->websockets.empty() && addon->requests.empty()) {
      uv_ref(reinterpret_cast<uv_handle_t*>(&addon->async));
    }
    addon->websockets.push_back(websocket);
  }

  const std::string extra_headers = SerializeWebSocketHeaders(headers);
  const char* protocols_ptr = sub_protocols.empty() ? nullptr : sub_protocols.c_str();
  const char* origin_ptr = origin.empty() ? nullptr : origin.c_str();
  const char* headers_ptr = extra_headers.empty() ? nullptr : extra_headers.c_str();
  int result = 0;
  if (use_cycronet) {
    result = addon->cycronet_api.websocket_connect(
        websocket->cycronet_websocket, websocket->url.c_str(), protocols_ptr,
        origin_ptr, headers_ptr);
    if (result == 0) {
      result = addon->cycronet_api.websocket_set_callback(
          websocket->cycronet_websocket, CycronetWebSocketOnEvent, websocket);
    }
  } else {
    result = addon->api.websocket_connect(
        websocket->websocket, websocket->url.c_str(), protocols_ptr,
        origin_ptr, headers_ptr);
  }
  if (result != 0) {
    QueueWebSocketEvent(websocket, WebSocketEventType::kError, {}, false, {},
                        result, "Cronet_WebSocket_Connect failed");
  }

  napi_value handle;
  napi_create_object(env, &handle);
  napi_value id;
  napi_create_bigint_uint64(env, websocket->id, &id);
  napi_set_named_property(env, handle, "id", id);
  return handle;
}

napi_value NativeWebSocketSupported(napi_env env, napi_callback_info info) {
  AddonState* addon = g_addon.load();
  napi_value result;
  napi_get_boolean(env,
                  addon && (addon->api.HasWebSocket() ||
                            HasCycronetWebSocket(addon)),
                  &result);
  return result;
}

napi_value NativeTlsExtensionsSupported(napi_env env,
                                       napi_callback_info info) {
  AddonState* addon = g_addon.load();
  napi_value result;
  napi_get_boolean(env, addon && addon->api.HasTlsExtensionSetter(), &result);
  return result;
}

napi_value NativeWebSocketSend(napi_env env, napi_callback_info info) {
  AddonState* addon = g_addon.load();
  size_t argc = 3;
  napi_value argv[3];
  napi_value this_value;
  napi_get_cb_info(env, info, &argc, argv, &this_value, nullptr);
  if (!addon || argc != 3) {
    ThrowTypeError(env, "websocketSend requires id, data, and type");
    return nullptr;
  }
  uint64_t id = 0;
  if (!GetIdValue(env, argv[0], &id, "websocket id")) return nullptr;
  bool is_buffer = false;
  if (napi_is_buffer(env, argv[1], &is_buffer) != napi_ok || !is_buffer) {
    ThrowTypeError(env, "WebSocket data must be a Buffer");
    return nullptr;
  }
  std::string type;
  if (!GetStringValue(env, argv[2], "type", &type)) return nullptr;
  Cronet_WebSocket_MessageType message_type;
  if (type == "text") {
    message_type = Cronet_WebSocket_MESSAGE_TEXT;
  } else if (type == "binary") {
    message_type = Cronet_WebSocket_MESSAGE_BINARY;
  } else {
    ThrowTypeError(env, "WebSocket type must be text or binary");
    return nullptr;
  }
  void* data = nullptr;
  size_t length = 0;
  napi_get_buffer_info(env, argv[1], &data, &length);
  WebSocketState* websocket = FindWebSocket(addon, id);
  if (!websocket ||
      (websocket->backend == WebSocketBackend::kCronet &&
       !websocket->websocket) ||
      (websocket->backend == WebSocketBackend::kCycronet &&
       !websocket->cycronet_websocket)) {
    ThrowError(env, "WebSocket is no longer active");
    return nullptr;
  }
  int result = 0;
  if (websocket->backend == WebSocketBackend::kCycronet) {
    if (message_type == Cronet_WebSocket_MESSAGE_TEXT) {
      result = addon->cycronet_api.websocket_send_text(
          websocket->cycronet_websocket, static_cast<const char*>(data), length);
    } else {
      result = addon->cycronet_api.websocket_send_binary(
          websocket->cycronet_websocket, static_cast<const uint8_t*>(data),
          length);
    }
  } else {
    result = addon->api.websocket_send(websocket->websocket, message_type,
                                       data, static_cast<uint64_t>(length));
  }
  if (result != 0) {
    ThrowError(env, "Cronet WebSocket send failed with error " +
                         std::to_string(result));
    return nullptr;
  }
  return Undefined(env);
}

napi_value NativeWebSocketClose(napi_env env, napi_callback_info info) {
  AddonState* addon = g_addon.load();
  size_t argc = 3;
  napi_value argv[3];
  napi_value this_value;
  napi_get_cb_info(env, info, &argc, argv, &this_value, nullptr);
  if (!addon || argc < 1 || argc > 3) {
    ThrowTypeError(env, "websocketClose requires id and optional code/reason");
    return nullptr;
  }
  uint64_t id = 0;
  if (!GetIdValue(env, argv[0], &id, "websocket id")) return nullptr;
  int32_t code = 1000;
  if (argc >= 2 && !IsUndefined(env, argv[1])) {
    napi_get_value_int32(env, argv[1], &code);
  }
  std::string reason;
  if (argc >= 3 && !IsUndefined(env, argv[2]) &&
      !GetStringValue(env, argv[2], "reason", &reason)) return nullptr;
  WebSocketState* websocket = FindWebSocket(addon, id);
  if (!websocket ||
      (websocket->backend == WebSocketBackend::kCronet &&
       !websocket->websocket) ||
      (websocket->backend == WebSocketBackend::kCycronet &&
       !websocket->cycronet_websocket)) return Undefined(env);
  int result = websocket->backend == WebSocketBackend::kCycronet
                   ? addon->cycronet_api.websocket_close(
                         websocket->cycronet_websocket,
                         static_cast<uint16_t>(code), reason.c_str())
                   : addon->api.websocket_close(
                         websocket->websocket, static_cast<uint16_t>(code),
                         reason.c_str());
  if (result != 0) {
    ThrowError(env, "Cronet WebSocket close failed with error " +
                         std::to_string(result));
    return nullptr;
  }
  return Undefined(env);
}

napi_value NativeCancel(napi_env env, napi_callback_info info) {
  AddonState* addon = g_addon.load();
  size_t argc = 1;
  napi_value argv[1];
  napi_value this_value;
  napi_get_cb_info(env, info, &argc, argv, &this_value, nullptr);
  if (!addon || argc != 1) return Undefined(env);
  uint64_t id = 0;
  napi_valuetype type;
  napi_typeof(env, argv[0], &type);
  if (type == napi_bigint) {
    bool lossless = false;
    napi_get_value_bigint_uint64(env, argv[0], &id, &lossless);
  } else if (type == napi_number) {
    uint32_t number_id = 0;
    napi_get_value_uint32(env, argv[0], &number_id);
    id = number_id;
  } else {
    ThrowTypeError(env, "request id must be a bigint");
    return nullptr;
  }
  RequestState* found = nullptr;
  {
    std::lock_guard<std::mutex> lock(addon->request_mutex);
    for (RequestState* request : addon->requests) {
      if (request->id == id) {
        found = request;
        break;
      }
    }
  }
  if (found && found->request && !found->finish_queued) {
    addon->api.Cronet_UrlRequest_Cancel(found->request);
  }
  return Undefined(env);
}

napi_value NativeClose(napi_env env, napi_callback_info info) {
  AddonState* addon = g_addon.load();
  if (!addon) return Undefined(env);
  {
    std::lock_guard<std::mutex> lock(addon->request_mutex);
    if (!addon->requests.empty()) {
      ThrowError(env, "Cannot close Cronet while requests are active");
      return nullptr;
    }
  }
  {
    std::lock_guard<std::mutex> lock(addon->websocket_mutex);
    if (!addon->websockets.empty()) {
      ThrowError(env, "Cannot close Cronet while WebSockets are active");
      return nullptr;
    }
  }
  if (addon->engine_started) {
    Cronet_RESULT result = addon->api.Cronet_Engine_Shutdown(addon->engine);
    if (result != Cronet_RESULT_SUCCESS) {
      ThrowError(env, "Cronet_Engine_Shutdown failed with result " +
                          std::to_string(result));
      return nullptr;
    }
    addon->api.Cronet_Engine_Destroy(addon->engine);
    addon->engine = nullptr;
    addon->engine_started = false;
  }
  if (addon->cycronet_started) {
    addon->cycronet_api.shutdown();
    addon->cycronet_started = false;
  }
  return Undefined(env);
}

napi_value NativeCloseConnections(napi_env env, napi_callback_info info) {
  AddonState* addon = g_addon.load();
  if (!addon || !addon->engine_started) return Undefined(env);
  if (!addon->api.close_all_connections) {
    ThrowError(env, "The selected Cronet DLL does not export "
                      "Cronet_Engine_CloseAllConnections");
    return nullptr;
  }
  addon->api.close_all_connections(addon->engine);
  return Undefined(env);
}

napi_value Init(napi_env env, napi_value exports) {
  auto* addon = new AddonState();
  addon->env = env;
  napi_get_uv_event_loop(env, &addon->async.loop);
  addon->async.data = addon;
  if (uv_async_init(addon->async.loop, &addon->async, ProcessDispatch) != 0) {
    delete addon;
    ThrowError(env, "Unable to initialize the Node event loop bridge");
  return Undefined(env);
  }
  addon->async_initialized = true;
  uv_unref(reinterpret_cast<uv_handle_t*>(&addon->async));
  g_addon.store(addon);
  napi_add_env_cleanup_hook(env, CleanupEnvironment, addon);

  napi_property_descriptor properties[] = {
      {"init", nullptr, NativeInit, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"request", nullptr, NativeRequest, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"requestSync", nullptr, NativeRequestSync, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"websocketSupported", nullptr, NativeWebSocketSupported, nullptr,
       nullptr, nullptr, napi_default, nullptr},
      {"tlsExtensionsSupported", nullptr, NativeTlsExtensionsSupported,
       nullptr, nullptr, nullptr, napi_default, nullptr},
      {"websocketOpen", nullptr, NativeWebSocketOpen, nullptr, nullptr,
       nullptr, napi_default, nullptr},
      {"streamRead", nullptr, NativeStreamRead, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"websocketSend", nullptr, NativeWebSocketSend, nullptr, nullptr,
       nullptr, napi_default, nullptr},
      {"websocketClose", nullptr, NativeWebSocketClose, nullptr, nullptr,
       nullptr, napi_default, nullptr},
      {"cancel", nullptr, NativeCancel, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"close", nullptr, NativeClose, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"closeConnections", nullptr, NativeCloseConnections, nullptr, nullptr,
       nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports,
                         sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
