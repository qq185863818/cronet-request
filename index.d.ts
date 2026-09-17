export type UrlInput = string | URL;
export type Params = Record<string, unknown> | Array<[string, unknown]> | string | Uint8Array;
export type Timeout = number | { connect?: number; read?: number } | null;
export type HeaderInput = Record<string, string | Uint8Array> | Array<[string, string]> | Headers;
export type AuthInput = [string, string] | Auth | ((request: PreparedRequest) => PreparedRequest | Promise<PreparedRequest>);

export interface TLSOptions {
  profile?: string | false | null;
  profiles?: Record<string, Record<string, unknown>>;
  extensionIds?: number[];
  extensionOrder?: number[];
  randomizeExtensions?: boolean;
  experimentalOptions?: Record<string, unknown> | string;
}

export interface Auth {
  __call__(request: PreparedRequest): PreparedRequest | Promise<PreparedRequest>;
}

export interface FilePart {
  filename?: string;
  data?: string | Uint8Array | NodeJS.ReadableStream;
  content?: string | Uint8Array | NodeJS.ReadableStream;
  contentType?: string;
  headers?: Record<string, string> | Array<[string, string]>;
}

export interface RequestOptions {
  params?: Params;
  data?: unknown;
  json?: unknown;
  headers?: HeaderInput;
  cookies?: Record<string, string | null> | CookieJar;
  files?: Record<string, FilePart | unknown>;
  auth?: AuthInput;
  timeout?: Timeout;
  allow_redirects?: boolean;
  allowRedirects?: boolean;
  proxies?: Record<string, string>;
  hooks?: { response?: ResponseHook | ResponseHook[] };
  stream?: boolean;
  verify?: boolean | string;
  cert?: string | [string, string];
  tls?: TLSOptions;
  tlsProfile?: string | false | null;
  tlsProfiles?: Record<string, Record<string, unknown>>;
  tlsExtensionIds?: number[];
  tlsExtensionOrder?: number[];
  randomizeTlsExtensions?: boolean;
  experimentalOptions?: Record<string, unknown> | string;
  enableQuic?: boolean;
  enableHttp2?: boolean;
  enableBrotli?: boolean;
  priority?: number | string;
  [key: string]: unknown;
}

export type ResponseHook = (response: Response, options?: Record<string, unknown>) => Response | void | Promise<Response | void>;

export class CaseInsensitiveDict implements Iterable<[string, string]> {
  constructor(init?: HeaderInput);
  readonly size: number;
  set(name: string, value: unknown): this;
  append(name: string, value: unknown): this;
  get(name: string, defaultValue?: string | null): string | null;
  getAll(name: string): string[];
  has(name: string): boolean;
  delete(name: string): boolean;
  entries(): IterableIterator<[string, string]>;
  keys(): IterableIterator<string>;
  values(): IterableIterator<string>;
  update(value: HeaderInput): this;
  copy(): CaseInsensitiveDict;
  toObject(): Record<string, string>;
}

export class Headers extends CaseInsensitiveDict {}

export class Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  expires: number | null;
  constructor(name: string, value: string, options?: Record<string, unknown>);
}

export class CookieJar implements Iterable<Cookie> {
  constructor();
  set(name: string, value: string | null, options?: Record<string, unknown>): Cookie | null;
  get(name: string, defaultValue?: string | null, domain?: string | null, path?: string | null): string | null;
  get_dict(domain?: string | null, path?: string | null): Record<string, string>;
  set_cookie(cookie: Cookie): Cookie;
  update(value: CookieJar | Record<string, string>): this;
  copy(): CookieJar;
  keys(): string[];
  values(): string[];
  items(): Array<[string, string]>;
  clear(domain?: string | null, path?: string | null, name?: string | null): void;
}

export class Request {
  constructor(options?: RequestOptions & { method?: string; url?: UrlInput });
  method: string | null;
  url: UrlInput | null;
  prepare(): PreparedRequest;
  register_hook(event: string, hook: Function | Function[]): this;
  deregister_hook(event: string, hook: Function): boolean;
}

export class PreparedRequest {
  method: string | null;
  url: string | null;
  headers: CaseInsensitiveDict;
  body: Buffer | null;
  hooks: Record<string, Function[]>;
  prepare(request: Request | RequestOptions): this;
  prepare_method(method: string): void;
  prepare_url(url: UrlInput, params?: Params): void;
  prepare_headers(headers?: HeaderInput): void;
  prepare_body(data?: unknown, files?: Record<string, unknown>, json?: unknown): void;
  prepare_content_length(body?: unknown): void;
  prepare_auth(auth?: AuthInput, url?: string): void;
  prepare_cookies(cookies?: Record<string, string> | CookieJar): void;
  prepare_hooks(hooks?: Record<string, Function | Function[]>): void;
  copy(): PreparedRequest;
  readonly path_url: string;
}

export class Response {
  readonly status_code: number | null;
  readonly statusCode: number | null;
  readonly headers: CaseInsensitiveDict;
  readonly url: string;
  readonly reason: string | null;
  readonly request: PreparedRequest | null;
  readonly history: Response[];
  readonly cookies: CookieJar;
  readonly ok: boolean;
  readonly is_redirect: boolean;
  readonly is_permanent_redirect: boolean;
  encoding: string | null;
  readonly content: Buffer | null;
  readonly body: Buffer | null;
  bytes(): Promise<Buffer>;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T = unknown>(options?: { reviver?: Function } | Function): Promise<T>;
  iter_content(options?: { chunk_size?: number | null; decode_unicode?: boolean }): AsyncIterable<Buffer | string>;
  iter_lines(options?: { chunk_size?: number; decode_unicode?: boolean; delimiter?: Uint8Array | string }): AsyncIterable<Buffer | string>;
  raise_for_status(): void;
  close(): Promise<void>;
}

export class SyncResponse {
  readonly status_code: number | null;
  readonly statusCode: number | null;
  readonly headers: CaseInsensitiveDict;
  readonly url: string;
  readonly reason: string | null;
  readonly request: PreparedRequest | null;
  readonly history: SyncResponse[];
  readonly cookies: CookieJar;
  readonly ok: boolean;
  readonly is_redirect: boolean;
  readonly is_permanent_redirect: boolean;
  encoding: string | null;
  readonly content: Buffer;
  readonly body: Buffer;
  bytes(): Buffer;
  arrayBuffer(): ArrayBuffer;
  text(): string;
  json<T = unknown>(options?: { reviver?: Function } | Function): T;
  iter_content(options?: { chunk_size?: number | null; decode_unicode?: boolean }): Iterable<Buffer | string>;
  iter_lines(options?: { chunk_size?: number; decode_unicode?: boolean; delimiter?: Uint8Array | string }): Iterable<Buffer | string>;
  raise_for_status(): void;
  close(): void;
}

export class BaseAdapter {
  send(request: PreparedRequest, options?: Record<string, unknown>): Promise<unknown>;
  sendSync(request: PreparedRequest, options?: Record<string, unknown>): unknown;
  close(): Promise<void> | void;
}

export class HTTPAdapter extends BaseAdapter {}
export class CronetAdapter extends HTTPAdapter {}

export interface WebSocketEvent {
  type: 'open' | 'message' | 'error' | 'close';
  data?: string | Buffer;
  protocol?: string;
  error?: Error;
  message?: string;
  code?: number;
  reason?: string;
  wasClean?: boolean;
}

export class WebSocket {
  static readonly CONNECTING: 0;
  static readonly OPEN: 1;
  static readonly CLOSING: 2;
  static readonly CLOSED: 3;
  readonly url: string;
  readonly readyState: number;
  readonly protocol: string;
  binaryType: string;
  onopen: ((event: WebSocketEvent) => void) | null;
  onmessage: ((event: WebSocketEvent) => void) | null;
  onerror: ((event: WebSocketEvent) => void) | null;
  onclose: ((event: WebSocketEvent) => void) | null;
  constructor(url: UrlInput, options?: Record<string, unknown>);
  addEventListener(type: string, listener: (event: WebSocketEvent) => void): void;
  removeEventListener(type: string, listener: (event: WebSocketEvent) => void): void;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
}

export class Session {
  headers: CaseInsensitiveDict;
  auth: AuthInput | null;
  proxies: Record<string, string>;
  hooks: Record<string, Function[]>;
  params: Params;
  stream: boolean;
  verify: boolean | string;
  cert: string | [string, string] | null;
  max_redirects: number;
  trust_env: boolean;
  cookies: CookieJar;
  constructor(options?: RequestOptions & Record<string, unknown>);
  request(method: string, url: UrlInput, options?: RequestOptions): SyncResponse;
  asyncRequest(method: string, url: UrlInput, options?: RequestOptions): Promise<Response>;
  get(url: UrlInput, options?: RequestOptions): SyncResponse;
  options(url: UrlInput, options?: RequestOptions): SyncResponse;
  head(url: UrlInput, options?: RequestOptions): SyncResponse;
  post(url: UrlInput, options?: RequestOptions): SyncResponse;
  put(url: UrlInput, options?: RequestOptions): SyncResponse;
  patch(url: UrlInput, options?: RequestOptions): SyncResponse;
  delete(url: UrlInput, options?: RequestOptions): SyncResponse;
  asyncGet(url: UrlInput, options?: RequestOptions): Promise<Response>;
  asyncOptions(url: UrlInput, options?: RequestOptions): Promise<Response>;
  asyncHead(url: UrlInput, options?: RequestOptions): Promise<Response>;
  asyncPost(url: UrlInput, options?: RequestOptions): Promise<Response>;
  asyncPut(url: UrlInput, options?: RequestOptions): Promise<Response>;
  asyncPatch(url: UrlInput, options?: RequestOptions): Promise<Response>;
  asyncDelete(url: UrlInput, options?: RequestOptions): Promise<Response>;
  prepare_request(request: Request): PreparedRequest;
  send(request: PreparedRequest, options?: Record<string, unknown>): Promise<Response>;
  sendSync(request: PreparedRequest, options?: Record<string, unknown>): SyncResponse;
  merge_environment_settings(url: string, proxies: Record<string, string> | null, stream: boolean | null, verify: boolean | string | null, cert: unknown): Record<string, unknown>;
  get_adapter(url: string): BaseAdapter;
  mount(prefix: string, adapter: BaseAdapter): void;
  closeSync(): void;
  close(): Promise<void>;
}

export function session(options?: Record<string, unknown>): Session;
export function request(method: string, url: UrlInput, options?: RequestOptions): SyncResponse;
export function asyncRequest(method: string, url: UrlInput, options?: RequestOptions): Promise<Response>;
export function get(url: UrlInput, options?: RequestOptions): SyncResponse;
export function options(url: UrlInput, options?: RequestOptions): SyncResponse;
export function head(url: UrlInput, options?: RequestOptions): SyncResponse;
export function post(url: UrlInput, options?: RequestOptions): SyncResponse;
export function put(url: UrlInput, options?: RequestOptions): SyncResponse;
export function patch(url: UrlInput, options?: RequestOptions): SyncResponse;
export function del(url: UrlInput, options?: RequestOptions): SyncResponse;
export { del as delete };
export function asyncGet(url: UrlInput, options?: RequestOptions): Promise<Response>;
export function asyncOptions(url: UrlInput, options?: RequestOptions): Promise<Response>;
export function asyncHead(url: UrlInput, options?: RequestOptions): Promise<Response>;
export function asyncPost(url: UrlInput, options?: RequestOptions): Promise<Response>;
export function asyncPut(url: UrlInput, options?: RequestOptions): Promise<Response>;
export function asyncPatch(url: UrlInput, options?: RequestOptions): Promise<Response>;
export function asyncDel(url: UrlInput, options?: RequestOptions): Promise<Response>;
export { asyncDel as asyncDelete };
export function websocket(url: UrlInput, options?: Record<string, unknown>): WebSocket;
export const codes: Record<string, number>;
export const auth: Record<string, unknown>;
export const cookies: Record<string, unknown>;
export const errors: Record<string, unknown>;
export const utils: Record<string, unknown>;
