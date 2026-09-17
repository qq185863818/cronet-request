# cronet-request

cronet-request 是独立的 Node.js HTTP、Streaming 和 WebSocket 客户端。底层使用项目内的 Cronet native addon，并且只调用项目 `lib` 目录内与当前平台和架构匹配的 Cronet shared library。

所有示例都使用下面的导入方式：

```js
const cronet = require('cronet-request');
```

## 功能总览

| 功能 | 状态 | 主要入口 |
| --- | --- | --- |
| 同步 HTTP 请求 | 已支持 | request、get、post、put、patch、delete |
| 异步 HTTP 请求 | 已支持 | asyncRequest、asyncGet、asyncPost 等 |
| Cronet Chromium TLS | 已支持 | 默认使用内置 Cronet 配置 |
| HTTP/2 | 已支持 | enableHttp2 |
| QUIC/HTTP/3 | 已支持 | enableQuic |
| 自定义 TLS profile | 已支持 | tls、tlsProfile、tlsProfiles |
| 固定 TLS 扩展顺序 | 已支持 | tls.extensionOrder |
| 随机 TLS 扩展顺序 | 已支持 | tls.randomizeExtensions |
| trust anchors | 已支持 | tls.experimentalOptions |
| HTTP/HTTPS 代理 | 已支持 | proxies |
| SOCKS5/SOCKS5h | 已支持 | socks5://、socks5h:// |
| SOCKS5 用户名密码 | 已支持 | SOCKS5 username/password handshake |
| Streaming | 已支持 | asyncGet(..., { stream: true }) |
| WebSocket/WSS | 已支持 | WebSocket、websocket |
| Cookie Jar | 已支持 | RequestsCookieJar |
| Basic/Digest 认证 | 已支持 | HTTPBasicAuth、HTTPDigestAuth |
| multipart 文件上传 | 已支持 | files |

同步请求会阻塞当前 Node.js 线程。异步请求返回 Promise，不阻塞事件循环。

## 安装

### 从本地 npm 包安装

```powershell
cd <cronet-request-directory>
npm pack

cd <your-node-project>
npm install <path-to-cronet-request>\cronet-request-0.1.0.tgz
```

也可以直接安装本地目录：

```powershell
npm install <path-to-cronet-request>
```

### 自动编译 native addon

正常执行 `npm install` 时，包会自动识别当前的操作系统和 CPU 架构。若存在对应的预编译 addon 就直接使用，否则调用 node-gyp 编译当前平台的 `jscronet.node`。

当前支持以下六个平台：

| 平台 | Cronet shared library |
| --- | --- |
| Windows x64 | `lib/cronet.150.0.7871.63-windows-x64.dll` |
| Windows arm64 | `lib/cronet.150.0.7871.63-windows-arm64.dll` |
| Linux x64 | `lib/cronet.150.0.7871.63-linux-x64.so` |
| Linux arm64 | `lib/cronet.150.0.7871.63-linux-arm64.so` |
| macOS x64 | `lib/cronet.150.0.7871.63-macos-x64.dylib` |
| macOS arm64 | `lib/cronet.150.0.7871.63-macos-arm64.dylib` |

如需强制从源码编译：

```bash
npm install --build-from-source
```

手动编译：

```text
npm run build
```

编译结果：

```text
build/Release/jscronet.node
```

项目内已经包含 JavaScript、native addon 源码、Cronet C 头文件和六个平台的 Cronet shared library，不需要从父目录加载运行时文件。编译 Linux 或 macOS addon 需要对应平台的 C/C++ 编译工具链；Windows arm64 需要支持 arm64 目标的 Visual C++ 工具链。

### GitHub Actions 跨平台验证

仓库中的 GitHub Actions 会在以下 runner 上自动执行 `npm install --build-from-source` 和测试：

```text
ubuntu-24.04
ubuntu-24.04-arm
macos-15-intel
macos-15
windows-2022
windows-11-arm
```

这六个 runner 分别覆盖 Linux x64、Linux arm64、macOS x64、macOS arm64、Windows x64 和 Windows arm64。

## 发布到 npm

发布前先检查包内容：

```bash
npm login
npm whoami
npm pack --dry-run
```

确认包清单包含 `lib`、`src`、`include`、`scripts` 和运行时 JavaScript 文件后，发布 public package：

```bash
npm publish --access public
```

发布完成后，其他项目即可安装：

```bash
npm install cronet-request
```

安装过程会根据当前平台和架构选择 Cronet shared library，并自动使用预编译 addon或调用 node-gyp 编译 addon。没有预编译 addon 的平台需要安装 Python 和对应的 C/C++ 编译工具链。

## 同步 API

同步 API 不需要 await，响应的 text、json、bytes 和 arrayBuffer 都直接返回值。

```js
const cronet = require('cronet-request');

const response = cronet.get('https://httpbin.org/ip', {
  timeout: 45000,
});

console.log(response.status_code);
console.log(response.text());
console.log(response.json());

response.close();
```

同步响应读取：

```js
const cronet = require('cronet-request');

const response = cronet.request('GET', 'https://httpbin.org/json');

const bytes = response.bytes();
const text = response.text();
const data = response.json();

console.log(bytes.length);
console.log(text);
console.log(data);

response.close();
```

所有同步 wrapper：

```js
const cronet = require('cronet-request');

const url = 'https://httpbin.org/get';
const options = { trust_env: false };
const response1 = cronet.request('GET', url, options);
const response2 = cronet.get(url, options);
const response3 = cronet.options(url, options);
const response4 = cronet.head(url, options);
const response5 = cronet.post(url, options);
const response6 = cronet.put(url, options);
const response7 = cronet.patch(url, options);
const response8 = cronet.delete(url, options);
const response9 = cronet.del(url, options);

for (const response of [response1, response2, response3, response4,
  response5, response6, response7, response8, response9]) {
  response.close();
}
```

head 的默认 allow_redirects 是 false。其他同步方法默认跟随重定向。

## 异步 API

异步 API 的主入口是 asyncRequest：

```js
const cronet = require('cronet-request');

async function main() {
  const response = await cronet.asyncRequest(
    'GET',
    'https://httpbin.org/ip',
    {
      timeout: 45000,
    },
  );

  console.log(response.status_code);
  console.log(await response.text());
  console.log(await response.json());

  await response.close();
}

main().catch(console.error);
```

异步 wrapper：

```js
const cronet = require('cronet-request');

async function main() {
  const url = 'https://httpbin.org/get';
  const options = { trust_env: false };
  const response1 = await cronet.asyncGet(url, options);
  const response2 = await cronet.asyncOptions(url, options);
  const response3 = await cronet.asyncHead(url, options);
  const response4 = await cronet.asyncPost(url, { ...options, json: { method: 'post' } });
  const response5 = await cronet.asyncPut(url, { ...options, data: { method: 'put' } });
  const response6 = await cronet.asyncPatch(url, { ...options, data: { method: 'patch' } });
  const response7 = await cronet.asyncDelete(url, options);
  const response8 = await cronet.asyncDel(url, options);

  for (const response of [response1, response2, response3, response4,
    response5, response6, response7, response8]) {
    await response.close();
  }
}

main().catch(console.error);
```

异步方法名称：

```text
asyncRequest
asyncGet
asyncOptions
asyncHead
asyncPost
asyncPut
asyncPatch
asyncDelete
asyncDel
```

## 通用请求参数

request、Session.request、asyncRequest 和 Session.asyncRequest 支持以下参数：

| 参数 | 说明 |
| --- | --- |
| method | GET、POST、PUT、PATCH、DELETE、HEAD、OPTIONS 等 HTTP 方法 |
| url | http 或 https URL |
| params | query 参数 |
| headers | 请求头 |
| data | form、字符串、Buffer 或原始 body |
| json | JSON body |
| files | multipart 文件 |
| cookies | 本次请求 Cookie 或 Cookie Jar |
| auth | Basic、Digest 或自定义认证 |
| timeout | 毫秒数，或 connect/read 对象 |
| allow_redirects | 是否跟随重定向 |
| proxies | HTTP、HTTPS、SOCKS5 代理 |
| hooks | response hook |
| stream | 异步流式响应 |
| verify | true 或 false |
| tls | 嵌套 Cronet TLS 配置 |
| enableHttp2 | 是否启用 HTTP/2 |
| enableQuic | 是否启用 QUIC |
| disableCache | 是否禁用 Cronet cache |
| priority | Cronet 请求优先级 |

同时支持以下别名：

```text
allowRedirects
trustEnv
maxRedirects
tlsProfile
tlsProfiles
tlsExtensionOrder
tlsExtensionIds
randomizeTlsExtensions
```

## 请求头

### 使用 object

```js
const cronet = require('cronet-request');

const response = cronet.get('https://httpbin.org/headers', {
  headers: {
    'User-Agent': 'cronet-request-demo/1.0',
    'X-Client-Name': 'cronet-request',
    Accept: 'application/json',
  },
});

console.log(response.json());
response.close();
```

### 使用键值数组

```js
const cronet = require('cronet-request');

const response = cronet.get('https://httpbin.org/headers', {
  headers: [
    ['X-First', 'one'],
    ['X-Second', 'two'],
  ],
});

console.log(response.json());
response.close();
```

### 使用 Headers

```js
const cronet = require('cronet-request');

const headers = new cronet.Headers();
headers.set('X-Request-ID', 'request-001');
headers.set('Accept', 'application/json');
headers.append('X-Trace', 'part-1');
headers.append('X-Trace', 'part-2');

const response = cronet.get('https://httpbin.org/headers', {
  headers,
});

console.log(headers.get('x-request-id'));
console.log(response.status_code);
response.close();
```

请求头名称不区分大小写。header 名称或值包含 CR/LF 时会抛出 InvalidHeader，防止 header 注入。

## Query 参数

```js
const cronet = require('cronet-request');

const response = cronet.get('https://httpbin.org/get?existing=1', {
  params: {
    query: 'cronet request',
    page: 2,
    tag: ['tls', 'http2'],
    ignored: null,
  },
});

console.log(response.json().url);
response.close();
```

编码规则：

```text
空格编码为 +
数组值展开成重复 key
null 和 undefined 不发送
已有 query 使用 & 追加
fragment 保留在 query 之后
字符串和字节数组按照已编码内容追加
```

传入已编码 query：

```js
const cronet = require('cronet-request');

const response = cronet.get('https://httpbin.org/get', {
  params: 'already=encoded&tag=a&tag=b',
});

console.log(response.json());
response.close();
```

## Body 编码

### 原始字符串和 Buffer

```js
const cronet = require('cronet-request');

const response = cronet.post('https://httpbin.org/post', {
  headers: {
    'Content-Type': 'application/octet-stream',
  },
  data: Buffer.from([0x00, 0x01, 0x02, 0xff]),
});

console.log(response.status_code);
response.close();
```

### JSON

```js
const cronet = require('cronet-request');

const response = cronet.post('https://httpbin.org/post', {
  json: {
    name: 'cronet',
    mode: 'json',
  },
});

console.log(response.json().json);
response.close();
```

JSON 自动设置 Content-Type: application/json，并拒绝 NaN、Infinity、BigInt、Buffer 和循环引用。

### data 和 json 的优先级

```js
const cronet = require('cronet-request');

const response = cronet.post('https://httpbin.org/post', {
  data: { selected: 'form' },
  json: { selected: 'json' },
});

console.log(response.json().form);
response.close();
```

data 有效时优先于 json。files 有效时使用 multipart。

## Multipart 文件上传

### Buffer 文件

```js
const cronet = require('cronet-request');

const response = cronet.post('https://httpbin.org/post', {
  data: {
    description: 'demo file',
  },
  files: {
    file: {
      filename: 'demo.txt',
      data: Buffer.from('hello from cronet-request'),
      contentType: 'text/plain',
      headers: {
        'X-Part-Name': 'demo',
      },
    },
  },
});

console.log(response.json().files);
response.close();
```

### 文件流

```js
const cronet = require('cronet-request');
const fs = require('node:fs');

const file = fs.createReadStream('./demo.txt');

const response = cronet.post('https://httpbin.org/post', {
  files: {
    file,
  },
});

console.log(response.status_code);
response.close();
```

文件内容会在发送前读取。超大文件的真正流式 multipart 上传不属于当前核心范围。

### tuple

```js
const cronet = require('cronet-request');

const response = cronet.post('https://httpbin.org/post', {
  files: {
    file1: ['one.txt', Buffer.from('one')],
    file2: ['two.txt', Buffer.from('two'), 'text/plain'],
    file3: ['three.txt', Buffer.from('three'), 'text/plain', {
      'X-Part': 'three',
    }],
  },
});

console.log(response.status_code);
response.close();
```

tuple 格式：

```text
[filename, content]
[filename, content, contentType]
[filename, content, contentType, partHeaders]
```

## Request 和 PreparedRequest

```js
const cronet = require('cronet-request');

const request = new cronet.Request({
  method: 'POST',
  url: 'https://example.test/upload',
  params: { source: 'demo' },
  headers: { 'X-Prepared': 'yes' },
  data: { ok: true },
});

const prepared = request.prepare();

console.log(prepared.method);
console.log(prepared.url);
console.log(prepared.path_url);
console.log(prepared.headers.toObject());
console.log(prepared.body.toString());
```

复制 PreparedRequest：

```js
const cronet = require('cronet-request');

const original = new cronet.Request({
  method: 'GET',
  url: 'https://example.test/',
}).prepare();

const copy = original.copy();
copy.headers.set('X-Copy', 'yes');

console.log(original.headers.has('X-Copy'));
console.log(copy.headers.get('X-Copy'));
```

## Response

### 常用属性

同步和异步响应都提供：

```text
status_code
statusCode
headers
url
reason
request
history
cookies
elapsed
encoding
ok
is_redirect
is_permanent_redirect
next
links
```

### 同步响应

```js
const cronet = require('cronet-request');

const response = cronet.get('https://httpbin.org/get');

console.log(response instanceof cronet.SyncResponse);
console.log(response.content);
console.log(response.body);
console.log(response.bytes());
console.log(response.text());
console.log(response.json());

response.close();
```

### 异步响应

```js
const cronet = require('cronet-request');

async function main() {
  const response = await cronet.asyncGet('https://httpbin.org/get');

  console.log(response instanceof cronet.Response);
  console.log(await response.bytes());
  console.log(await response.text());
  console.log(await response.json());

  await response.close();
}

main().catch(console.error);
```

### HTTP 状态错误

4xx/5xx 默认返回响应，不会自动抛出网络异常：

```js
const cronet = require('cronet-request');

const response = cronet.get('https://httpbin.org/status/404');

console.log(response.status_code);
console.log(response.ok);

try {
  response.raise_for_status();
} catch (error) {
  console.log(error instanceof cronet.HTTPError);
  console.log(error.response.status_code);
}

response.close();
```

### iter_content 和 iter_lines

同步：

```js
const cronet = require('cronet-request');

const response = cronet.get('https://httpbin.org/stream/3');

for (const chunk of response.iter_content({ chunk_size: 128 })) {
  console.log(Buffer.from(chunk).toString('utf8'));
}

for (const line of response.iter_lines({ decode_unicode: true })) {
  console.log(line);
}

response.close();
```

异步：

```js
const cronet = require('cronet-request');

async function main() {
  const response = await cronet.asyncGet('https://httpbin.org/stream/3');

  for await (const chunk of response.iter_content({ chunk_size: 128 })) {
    console.log(Buffer.from(chunk).toString('utf8'));
  }

  await response.close();
}

main().catch(console.error);
```

## Session

Session 用于复用 Cookie、默认请求头、代理和 Cronet Engine。

### 同步 Session

```js
const cronet = require('cronet-request');

const session = cronet.session({
  trust_env: false,
  enableHttp2: true,
  headers: {
    'X-Client': 'cronet-session',
  },
});

try {
  const response = session.get('https://httpbin.org/headers');
  console.log(response.status_code);
  console.log(response.json());
} finally {
  session.closeSync();
}
```

### 异步 Session

```js
const cronet = require('cronet-request');

async function main() {
  const session = cronet.session({
    trust_env: false,
    enableHttp2: true,
    headers: {
      'X-Client': 'cronet-async-session',
    },
  });

  try {
    const response = await session.asyncGet('https://httpbin.org/headers');
    console.log(await response.json());
    await response.close();
  } finally {
    await session.close();
  }
}

main().catch(console.error);
```

### Session Cookie、默认参数和 hook

```js
const cronet = require('cronet-request');

const session = cronet.session({
  trust_env: false,
  headers: {
    'X-Session-Header': 'default-value',
  },
});

session.params = {
  source: 'session',
};

session.cookies.set('sid', 'abc123', {
  domain: 'httpbin.org',
  path: '/',
});

const response = session.get('https://httpbin.org/cookies');
console.log(response.json());

session.closeSync();
```

### Session.send

同步：

```js
const cronet = require('cronet-request');

const session = cronet.session({ trust_env: false });
const request = new cronet.Request({
  method: 'GET',
  url: 'https://httpbin.org/get',
}).prepare();

const response = session.sendSync(request);
console.log(response.status_code);

session.closeSync();
```

异步：

```js
const cronet = require('cronet-request');

async function main() {
  const session = cronet.session({ trust_env: false });
  const request = new cronet.Request({
    method: 'GET',
    url: 'https://httpbin.org/get',
  }).prepare();

  const response = await session.send(request);
  console.log(await response.json());

  await response.close();
  await session.close();
}

main().catch(console.error);
```

## Cookie

### Cookie Jar

```js
const cronet = require('cronet-request');

const jar = new cronet.RequestsCookieJar();

jar.set('root', 'yes', {
  domain: 'example.test',
  path: '/',
});

jar.set('private', 'yes', {
  domain: 'example.test',
  path: '/private',
});

jar.set('secure', 'yes', {
  domain: 'example.test',
  path: '/',
  secure: true,
});

console.log(jar.keys());
console.log(jar.values());
console.log(jar.items());
console.log(jar.get_dict());
console.log(jar.list_domains());
console.log(jar.list_paths());
```

### Cookie 持久化

```js
const cronet = require('cronet-request');

const session = cronet.session({ trust_env: false });

const setResponse = session.get(
  'https://httpbin.org/cookies/set/session/value',
);
console.log(setResponse.status_code);

const checkResponse = session.get('https://httpbin.org/cookies');
console.log(checkResponse.json());

session.closeSync();
```

Cookie 会根据 domain、path、secure 和 expires 过滤。公开 Cookie 工具包括：

```text
create_cookie
cookiejar_from_dict
merge_cookies
get_cookie_header
extract_cookies_to_jar
remove_cookie_by_name
morsel_to_cookie
RequestsCookieJar
CookieConflictError
```

## 重定向

### 跟随和禁止跟随

```js
const cronet = require('cronet-request');

const followed = cronet.get('https://httpbin.org/redirect/2');
console.log(followed.status_code);
console.log(followed.url);
console.log(followed.history.length);
followed.close();

const notFollowed = cronet.get('https://httpbin.org/redirect/1', {
  allow_redirects: false,
});
console.log(notFollowed.status_code);
console.log(notFollowed.headers.get('location'));
notFollowed.close();
```

方法规则：

```text
301: POST 转换为 GET
302: 除 HEAD 外转换为 GET
303: 除 HEAD 外转换为 GET
307: 保留 method 和 body
308: 保留 method 和 body
```

跨 host 重定向会删除 Authorization。每一跳会重新计算 Cookie 和代理。

## 认证

### Basic tuple

```js
const cronet = require('cronet-request');

const response = cronet.get(
  'https://httpbin.org/basic-auth/demo/password',
  {
    auth: ['demo', 'password'],
  },
);

console.log(response.status_code);
console.log(response.json());
response.close();
```

### Basic 认证类

```js
const cronet = require('cronet-request');

const auth = new cronet.HTTPBasicAuth('demo', 'password');
const response = cronet.get(
  'https://httpbin.org/basic-auth/demo/password',
  { auth },
);

console.log(response.json());
response.close();
```

### Digest 认证

```js
const cronet = require('cronet-request');

const auth = new cronet.HTTPDigestAuth('user', 'password');
const response = cronet.get(
  'https://httpbin.org/digest-auth/auth/user/password',
  { auth },
);

console.log(response.status_code);
console.log(response.json());
response.close();
```

### 自定义认证

```js
const cronet = require('cronet-request');

const auth = (prepared) => {
  prepared.headers.set('X-Custom-Auth', 'demo-token');
  return prepared;
};

const response = cronet.get('https://httpbin.org/headers', { auth });
console.log(response.json());
response.close();
```

## 代理

### HTTP/HTTPS 代理

```js
const cronet = require('cronet-request');

const response = cronet.get('https://httpbin.org/ip', {
  trust_env: false,
  proxies: {
    http: 'http://127.0.0.1:7890',
    https: 'http://127.0.0.1:7890',
  },
});

console.log(response.status_code);
console.log(response.json());
response.close();
```

HTTPS 目标通过 HTTP proxy 使用 CONNECT 隧道。

### SOCKS5 认证

```js
const cronet = require('cronet-request');

const response = cronet.get('https://httpbin.org/ip', {
  trust_env: false,
  proxies: {
    https: 'socks5://username:password@127.0.0.1:1080',
  },
});

console.log(response.json());
response.close();
```

异步 SOCKS5h：

```js
const cronet = require('cronet-request');

async function main() {
  const response = await cronet.asyncRequest(
    'GET',
    'https://httpbin.org/ip',
    {
      trust_env: false,
      proxies: {
        https: 'socks5h://username:password@127.0.0.1:1080',
      },
    },
  );

  console.log(await response.json());
  await response.close();
}

main().catch(console.error);
```

账号密码会在 SOCKS5 username/password 握手中发送，不会作为目标 HTTP header 发送。

### 环境代理

```js
const cronet = require('cronet-request');

const response = cronet.get('https://httpbin.org/ip', {
  trust_env: false,
});

console.log(response.json());
response.close();
```

支持 HTTP_PROXY、HTTPS_PROXY、ALL_PROXY 和 NO_PROXY。

## TLS、HTTP/2 和自定义指纹

### 默认不配置 TLS

```js
const cronet = require('cronet-request');

const response = cronet.get('https://tls.peet.ws/api/all', {
  enableHttp2: true,
});

const body = response.json();

console.log(body.http_version);
console.log(body.tls?.ja3);
console.log(body.tls?.ja3_hash);

response.close();
```

不提供 tls 时可以正常工作，使用项目内置 Cronet 初始化配置。

### 关闭内置 profile

```js
const cronet = require('cronet-request');

const response = cronet.get('https://tls.peet.ws/api/all', {
  tlsProfile: false,
});

console.log(response.status_code);
response.close();
```

### 自定义 TLS profile

```js
const cronet = require('cronet-request');

const chrome = cronet.tlsProfiles.chrome_144;

const customProfile = {
  tls_cipher_suites: [...chrome.tls_cipher_suites],
  tls_curves: ['X25519', 'P-256'],
  tls_extensions: [...chrome.tls_extensions],
};

const response = cronet.request(
  'GET',
  'https://tls.peet.ws/api/all',
  {
    enableHttp2: true,
    tls: {
      profile: 'customChrome',
      profiles: {
        customChrome: customProfile,
      },
    },
  },
);

const body = response.json();

console.log(body.http_version);
console.log(body.tls?.ja3);
response.close();
```

异步使用：

```js
const cronet = require('cronet-request');

async function main() {
  const chrome = cronet.tlsProfiles.chrome_144;

  const response = await cronet.asyncRequest(
    'GET',
    'https://tls.peet.ws/api/all',
    {
      enableHttp2: true,
      tls: {
        profile: 'customChrome',
        profiles: {
          customChrome: {
            tls_cipher_suites: [...chrome.tls_cipher_suites],
            tls_curves: ['X25519', 'P-256'],
            tls_extensions: [...chrome.tls_extensions],
          },
        },
      },
    },
  );

  console.log((await response.json()).tls?.ja3_hash);
  await response.close();
}

main().catch(console.error);
```

### 固定扩展顺序

```js
const cronet = require('cronet-request');

const response = cronet.request(
  'GET',
  'https://tls.peet.ws/api/all',
  {
    enableHttp2: true,
    tls: {
      profile: false,
      extensionOrder: [
        11, 35, 65037, 23, 0, 5, 43, 17613,
        51, 18, 13, 51764, 45, 10, 16, 27,
        65281, 41,
      ],
      randomizeExtensions: false,
      experimentalOptions: {
        tls_extensions: ['trust_anchors'],
        trust_anchor_ids: [],
      },
    },
  },
);

const body = response.json();
console.log(body.tls?.ja3);
console.log(body.tls?.ja3_hash);

response.close();
```

randomizeExtensions: false 用于固定复现一个 JA3。true 用于产生随机扩展顺序。

### trust anchors

空列表：

```js
const cronet = require('cronet-request');

const response = cronet.get('https://tls.peet.ws/api/all', {
  tls: {
    profile: false,
    experimentalOptions: {
      tls_extensions: ['trust_anchors'],
      trust_anchor_ids: [],
    },
  },
});

console.log(response.json().tls?.ja3);
response.close();
```

传入数据：

```js
const cronet = require('cronet-request');

const response = cronet.get('https://tls.peet.ws/api/all', {
  tls: {
    profile: false,
    experimentalOptions: {
      tls_extensions: ['trust_anchors'],
      trust_anchor_ids: ['2a03', '2b0601'],
    },
  },
});

console.log(response.json().tls?.ja3);
response.close();
```

### 扁平配置

```js
const cronet = require('cronet-request');

const response = cronet.request(
  'GET',
  'https://tls.peet.ws/api/all',
  {
    tlsProfile: 'custom',
    tlsProfiles: {
      custom: {
        tls_cipher_suites: [
          'TLS_GREASE',
          'TLS_AES_128_GCM_SHA256',
          'TLS_AES_256_GCM_SHA384',
        ],
        tls_curves: ['X25519', 'P-256'],
        tls_extensions: [],
      },
    },
    tlsExtensionOrder: [23, 65037, 45, 27, 65281, 17613, 11, 0],
    randomizeTlsExtensions: false,
    experimentalOptions: {
      tls_extensions: [],
    },
  },
);

console.log(response.json().tls?.ja3_hash);
response.close();
```

TLS 配置是 Cronet Engine 级配置，必须在当前进程第一个请求或 WebSocket 连接之前确定。同步和异步请求都使用 Cronet Chromium/BoringSSL 栈。

### JA3 矩阵测试

```powershell
cd <cronet-request-directory>
npm run test:ja3-matrix
```

矩阵包含 6 组目标 JA3、randomize=false、randomize=true 多次采样、空 trust_anchor_ids、非空 trust_anchor_ids 和扩展 41 的 session ticket 暖机。原始响应保存在项目 logs 目录。

## Streaming

真正的流式响应使用异步 API：

```js
const cronet = require('cronet-request');

async function main() {
  const response = await cronet.asyncGet(
    'https://httpbin.org/stream/10',
    {
      stream: true,
      timeout: 45000,
    },
  );

  for await (const chunk of response.iter_content({ chunk_size: null })) {
    process.stdout.write(Buffer.from(chunk));
  }

  await response.close();
}

main().catch(console.error);
```

按行读取：

```js
const cronet = require('cronet-request');

async function main() {
  const response = await cronet.asyncGet(
    'https://httpbin.org/stream/5',
    { stream: true },
  );

  for await (const line of response.iter_lines({
    decode_unicode: true,
  })) {
    console.log('line:', line);
  }

  await response.close();
}

main().catch(console.error);
```

Streaming 特性：

```text
响应头到达后立即返回 Response
body 使用异步读取，不提前完整缓冲
native Cronet read 由 stream pull 驱动
慢消费者不会让 addon 无限预读
response.close() 会取消未完成请求并等待清理
```

## WebSocket 和 WSS

### 能力检查

```js
const cronet = require('cronet-request');

console.log(cronet.websocketSupported);
console.log(cronet.tlsExtensionsSupported);
```

### WSS 基本用法

```js
const cronet = require('cronet-request');

const socket = cronet.websocket('wss://echo.websocket.org', {
  headers: {
    'X-Client': 'cronet-request',
  },
  origin: 'https://example.com',
});

socket.onopen = () => {
  socket.send('hello cronet websocket');
};

socket.onmessage = (event) => {
  console.log(event.data);
  socket.close(1000, 'done');
};

socket.onerror = (event) => {
  console.error(event.error || event.message);
};

socket.onclose = (event) => {
  console.log(event.code, event.reason, event.wasClean);
};
```

也可以使用类构造：

```js
const cronet = require('cronet-request');

const socket = new cronet.WebSocket('wss://echo.websocket.org');

socket.onopen = () => {
  socket.send('hello');
};

socket.onmessage = (event) => {
  console.log(event.data);
  socket.close();
};
```

### 文本和二进制消息

```js
const cronet = require('cronet-request');

const socket = cronet.websocket('wss://echo.websocket.org');

socket.onopen = () => {
  socket.send('text message');
  socket.send(Buffer.from([0x00, 0x01, 0xff]));
};

socket.onmessage = (event) => {
  if (typeof event.data === 'string') {
    console.log('text:', event.data);
  } else {
    console.log('binary:', Buffer.from(event.data));
  }
  socket.close(1000, 'messages received');
};

socket.onerror = (event) => console.error(event.error || event.message);
socket.onclose = () => console.log('closed');
```

### subprotocol 和 backend

```js
const cronet = require('cronet-request');

const socket = cronet.websocket('wss://echo.websocket.org', {
  subProtocols: ['chat', 'json'],
  backend: 'direct',
});

socket.onopen = () => {
  console.log('protocol:', socket.protocol);
  setTimeout(() => socket.close(1000, 'demo complete'), 3000);
};

socket.onclose = () => {
  console.log('closed');
};
```

backend 取值：

```text
auto       自动选择，默认
direct     patch3 Cronet_WebSocket_* 导出
cronet     direct 兼容别名
cycronet   cyCronet C ABI wrapper
```

### WebSocket TLS 配置

```js
const cronet = require('cronet-request');

const chrome = cronet.tlsProfiles.chrome_144;

cronet.init({
  tls: {
    profile: 'websocketChrome',
    profiles: {
      websocketChrome: {
        tls_cipher_suites: [...chrome.tls_cipher_suites],
        tls_curves: ['X25519', 'P-256'],
        tls_extensions: [...chrome.tls_extensions],
      },
    },
  },
});

const socket = cronet.websocket('wss://echo.websocket.org', {
  backend: 'direct',
});

socket.onopen = () => socket.send('hello');
socket.onmessage = () => socket.close(1000, 'demo complete');
socket.onerror = (event) => console.error(event.error || event.message);
socket.onclose = () => console.log('closed');
```

## Hooks

### 同步 hook

```js
const cronet = require('cronet-request');

const response = cronet.get('https://httpbin.org/get', {
  hooks: {
    response: (item) => {
      item.checked = true;
      return item;
    },
  },
});

console.log(response.checked);
response.close();
```

### 异步 hook

```js
const cronet = require('cronet-request');

async function main() {
  const response = await cronet.asyncGet('https://httpbin.org/get', {
    hooks: {
      response: [
        async (item) => {
          item.checked = true;
          return item;
        },
      ],
    },
  });

  console.log(response.checked);
  await response.close();
}

main().catch(console.error);
```

同步 hook 不能返回 Promise。hook 返回 undefined 时保留原 Response，返回 Response 时替换后续结果。

## Adapter

### 自定义同步 Adapter

```js
const cronet = require('cronet-request');

class DemoAdapter extends cronet.BaseAdapter {
  sendSync(request) {
    return {
      raw: {
        status: 200,
        statusText: 'OK',
        url: request.url,
        headers: [
          ['Content-Type', 'application/json'],
        ],
        body: Buffer.from(JSON.stringify({
          method: request.method,
          url: request.url,
        })),
      },
    };
  }

  send(request) {
    return Promise.resolve(this.sendSync(request));
  }

  close() {}
}

const session = cronet.session({
  trust_env: false,
  adapter: new DemoAdapter(),
});

const response = session.get('http://example.test/demo');
console.log(response.json());

session.closeSync();
```

注册自定义 URL 前缀：

```js
const cronet = require('cronet-request');

class DemoAdapter extends cronet.BaseAdapter {
  sendSync(request) {
    return {
      raw: {
        status: 204,
        statusText: 'No Content',
        url: request.url,
        headers: [],
        body: Buffer.alloc(0),
      },
    };
  }

  send(request) {
    return Promise.resolve(this.sendSync(request));
  }

  close() {}
}

const session = cronet.session();
session.mount('http://internal.example/', new DemoAdapter());

console.log(session.get_adapter('http://internal.example/api'));
session.closeSync();
```

同步 Adapter 需要 sendSync，异步 Adapter 需要 send。

## 运行时信息和低层 API

```js
const cronet = require('cronet-request');

console.log(cronet.version);
console.log(cronet.initialized);
console.log(cronet.nativePath);
console.log(cronet.dllPath);
console.log(cronet.websocketSupported);
console.log(cronet.tlsExtensionsSupported);
```

低层函数：

```text
init()
close()
closeConnections()
fetch()
fetchStream()
fetchSync()
```

低层同步和异步示例：

```js
const cronet = require('cronet-request');

async function main() {
cronet.init({
  enableHttp2: true,
  enableQuic: true,
});

const asyncResponse = await cronet.fetch('https://httpbin.org/ip');
console.log(await asyncResponse.json());

const syncResponse = cronet.fetchSync('https://httpbin.org/ip');
console.log(syncResponse.json());

cronet.close();
}

main().catch(console.error);
```

## 错误处理

```js
const cronet = require('cronet-request');

try {
  cronet.get('not-a-url');
} catch (error) {
  console.log(error.name);
  console.log(error.message);
}
```

主要异常：

```text
RequestException
HTTPError
ConnectionError
ProxyError
SSLError
Timeout
ConnectTimeout
ReadTimeout
URLRequired
MissingSchema
InvalidSchema
InvalidURL
InvalidProxyURL
InvalidHeader
TooManyRedirects
JSONDecodeError
StreamConsumedError
ContentDecodingError
UnrewindableBodyError
CookieConflictError
```

HTTP 4xx/5xx 不会自动 reject。需要异常时调用 response.raise_for_status()。

## 工具函数

```js
const cronet = require('cronet-request');

console.log(cronet.encodeParams({
  q: 'hello world',
  tag: ['a', 'b'],
}));

console.log(cronet.getAuthFromUrl(
  'https://user:pass@example.test/',
));

console.log(cronet.getEncodingFromHeaders({
  'content-type': 'text/plain; charset=utf-8',
}));

console.log(cronet.selectProxy(
  'https://example.test/',
  { https: 'http://127.0.0.1:7890' },
));
```

常用工具：

```text
encodeParams
appendParams
normalizeUrl
pathUrl
getAuthFromUrl
urldefragauth
requoteUri
getEncodingFromHeaders
guessJsonUtf
superLen
guessFilename
iterSlices
parseListHeader
parseDictHeader
parseHeaderLinks
shouldBypassProxies
getEnvironProxies
selectProxy
resolveProxies
getNetrcAuth
rewindBody
addressInNetwork
dottedNetmask
isValidCidr
```

## 测试命令

### 本地回归

```powershell
cd <cronet-request-directory>
npm run build
npm test
```

本地测试包含 README demo 校验、纯 JS 单元测试、同步 API、asyncRequest、Cronet HTTP 集成、Streaming 背压和顶层 API 矩阵。

单独验证 README 中的全部 JavaScript demo：

```powershell
npm run test:readme
```

该测试会提取 README 中的 64 个 JavaScript 代码块，逐个检查代码围栏、公共导入、CommonJS 语法、未定义的 demo 依赖、私有路径和已移除的功能说明，并在隔离的 mock transport 中执行每个 demo。真实网络行为由下面的外部和功能测试验证。

### 外部站点

```powershell
npm run test:external
npm run test:sync-external
```

访问：

```text
https://tls.peet.ws/api/all
https://httpbin.org/ip
https://httpbin.org/
```

### TLS、代理和 WebSocket

```powershell
npm run test:tls-config
npm run test:proxy-socks5
npm run test:wss
```

### Streaming

```powershell
npm run test:streaming
```

### JA3

```powershell
npm run test:ja3-matrix
```

### HTTP 代理

```powershell
node test\proxy-tls.test.js 127.0.0.1:7890
node test\proxy-tls.test.js 127.0.0.1:9999
```

测试报告保存在：

```text
logs
```

## 当前验证结论

patch3 DLL 已验证：

```text
同步 request：成功
异步 asyncRequest：成功
HTTP/2：同步和异步均成功
自定义 TLS profile：同步和异步均成功
固定 JA3 扩展顺序：提供的 6 组全部精确复现
随机 JA3 扩展顺序：每组观察到多个不同顺序
trust_anchor_ids：空列表和非空列表均通过
SOCKS5/SOCKS5h：同步和异步认证均通过
Streaming：分块、背压、提前关闭均通过
WebSocket/WSS：打开、消息、关闭均通过
```

## 已知限制

1. 同步请求阻塞 Node.js 主线程。不要在同一进程中启动本地 HTTP server 后再用同步请求访问它。
2. Cronet Engine 是进程级共享资源。TLS、代理、HTTP/2、QUIC 和证书校验配置应在第一个请求前确定。
3. WebSocket 是独立的 RFC 6455 API，不能使用 fetch 发送 wss URL。
4. 精确 JA3 依赖 patch3 DLL、扩展顺序、GREASE、TLS session 状态和服务端行为。
5. randomizeExtensions: true 会随机扩展顺序，不会固定命中一个目标 JA3。
6. 当前发布物支持 Windows、Linux、macOS 的 x64 和 arm64；npm 安装时按当前平台选择对应的 Cronet shared library，并自动准备 native addon。
