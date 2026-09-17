// C API added by the cyCronet Cronet WebSocket patch.

#ifndef JSCRONET_CRONET_WEBSOCKET_C_H_
#define JSCRONET_CRONET_WEBSOCKET_C_H_

#include <stdint.h>

#include "cronet_export.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct Cronet_WebSocket Cronet_WebSocket;
typedef Cronet_WebSocket* Cronet_WebSocketPtr;
typedef struct Cronet_Engine Cronet_Engine;
typedef Cronet_Engine* Cronet_EnginePtr;

typedef enum Cronet_WebSocket_MessageType {
  Cronet_WebSocket_MESSAGE_TEXT = 1,
  Cronet_WebSocket_MESSAGE_BINARY = 2,
} Cronet_WebSocket_MessageType;

typedef struct Cronet_WebSocket_Callbacks {
  void (*on_open)(Cronet_WebSocketPtr ws, void* user_data,
                  const char* protocol);
  void (*on_message)(Cronet_WebSocketPtr ws, void* user_data,
                     Cronet_WebSocket_MessageType type,
                     const void* data, uint64_t len);
  void (*on_close)(Cronet_WebSocketPtr ws, void* user_data,
                   int was_clean, uint16_t code, const char* reason);
  void (*on_error)(Cronet_WebSocketPtr ws, void* user_data,
                   int net_error, const char* message);
} Cronet_WebSocket_Callbacks;

CRONET_EXPORT Cronet_WebSocketPtr Cronet_WebSocket_Create(
    Cronet_EnginePtr engine,
    const Cronet_WebSocket_Callbacks* callbacks,
    void* user_data);

CRONET_EXPORT int Cronet_WebSocket_Connect(
    Cronet_WebSocketPtr ws,
    const char* url,
    const char* sub_protocols,
    const char* origin,
    const char* extra_headers);

CRONET_EXPORT int Cronet_WebSocket_Send(
    Cronet_WebSocketPtr ws,
    Cronet_WebSocket_MessageType type,
    const void* data,
    uint64_t len);

CRONET_EXPORT int Cronet_WebSocket_Close(
    Cronet_WebSocketPtr ws,
    uint16_t code,
    const char* reason);

CRONET_EXPORT void Cronet_WebSocket_Destroy(Cronet_WebSocketPtr ws);

#ifdef __cplusplus
}
#endif

#endif  // JSCRONET_CRONET_WEBSOCKET_C_H_
