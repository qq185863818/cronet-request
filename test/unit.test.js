'use strict';

const assert = require('node:assert/strict');
const {
  Request,
  PreparedRequest,
  Response,
  Session,
  Headers,
  CaseInsensitiveDict,
  RequestsCookieJar,
  HTTPBasicAuth,
  HTTPDigestAuth,
  codes,
  utils,
  errors,
} = require('..');

async function main() {
  assert.equal(utils.encodeParams({ q: 'a b', tag: ['a', 'b'], skip: null }), 'q=a+b&tag=a&tag=b');
  assert.equal(utils.appendParams('https://example.test/a?x=1#part', 'y=2'), 'https://example.test/a?x=1&y=2#part');

  const headers = new Headers([['X-Test', 'one'], ['x-test', 'two']]);
  assert.equal(headers.get('X-TEST'), 'two');
  headers.append('Set-Cookie', 'a=1');
  headers.append('set-cookie', 'b=2');
  assert.deepEqual(headers.getAll('set-cookie'), ['a=1', 'b=2']);
  assert.throws(() => headers.set('Bad\nName', 'value'), errors.InvalidHeader);

  const form = new Request({
    method: 'post',
    url: 'https://example.test/submit?old=1#fragment',
    params: { q: 'hello world' },
    data: { a: '1', repeated: ['x', 'y'] },
    headers: { 'X-Case': 'ok' },
  }).prepare();
  assert.equal(form.method, 'POST');
  assert.equal(form.url, 'https://example.test/submit?old=1&q=hello+world#fragment');
  assert.equal(form.headers.get('content-type'), 'application/x-www-form-urlencoded');
  assert.equal(form.headers.get('content-length'), String(Buffer.byteLength('a=1&repeated=x&repeated=y')));
  assert.equal(form.body.toString(), 'a=1&repeated=x&repeated=y');

  const json = new Request({ method: 'POST', url: 'https://example.test/', json: { ok: true } }).prepare();
  assert.equal(json.headers.get('content-type'), 'application/json');
  assert.deepEqual(JSON.parse(json.body.toString()), { ok: true });
  assert.throws(() => new Request({ method: 'POST', url: 'https://example.test/', json: NaN }).prepare(), /NaN/);

  const multipart = new Request({
    method: 'POST',
    url: 'https://example.test/upload',
    data: { note: 'demo' },
    files: {
      file: { filename: 'demo.txt', data: Buffer.from('hello'), contentType: 'text/plain', headers: { 'X-Part': 'yes' } },
    },
  }).prepare();
  assert.match(multipart.headers.get('content-type'), /^multipart\/form-data; boundary=/);
  assert.match(multipart.body.toString(), /filename="demo\.txt"/);
  assert.match(multipart.body.toString(), /X-Part: yes/);
  assert.match(multipart.body.toString(), /hello/);

  const tupleMultipart = new Request({
    method: 'POST',
    url: 'https://example.test/upload',
    files: { file: ['tuple.txt', Buffer.from('tuple body'), 'text/plain'] },
  }).prepare();
  assert.match(tupleMultipart.body.toString(), /filename="tuple\.txt"/);
  assert.match(tupleMultipart.body.toString(), /Content-Type: text\/plain/);
  const fixedBoundary = new Request({
    method: 'POST',
    url: 'https://example.test/upload',
    headers: { 'Content-Type': 'multipart/form-data; boundary=fixed-boundary' },
    files: { file: Buffer.from('fixed') },
  }).prepare();
  assert.equal(fixedBoundary.headers.get('content-type'), 'multipart/form-data; boundary=fixed-boundary');
  assert.match(fixedBoundary.body.toString(), /--fixed-boundary/);

  const jar = new RequestsCookieJar();
  jar.set('root', 'yes', { domain: 'example.test', path: '/' });
  jar.set('private', 'yes', { domain: 'example.test', path: '/private' });
  jar.set('secure', 'yes', { domain: 'example.test', path: '/', secure: true });
  const prepared = new Request({ method: 'GET', url: 'https://example.test/private/a' }).prepare();
  prepared.prepare_cookies(jar);
  assert.match(prepared.headers.get('cookie'), /private=yes/);
  assert.match(prepared.headers.get('cookie'), /root=yes/);
  assert.match(prepared.headers.get('cookie'), /secure=yes/);
  const insecure = new Request({ method: 'GET', url: 'http://example.test/' }).prepare();
  insecure.prepare_cookies(jar);
  assert.doesNotMatch(insecure.headers.get('cookie') || '', /secure=yes/);
  jar.set('same', 'one', { domain: 'a.example.test', path: '/' });
  jar.set('same', 'two', { domain: 'b.example.test', path: '/' });
  assert.throws(() => jar.get('same'), errors.CookieConflictError);

  const basic = new Request({ method: 'GET', url: 'https://example.test/', auth: ['u', 'p'] }).prepare();
  assert.equal(basic.headers.get('authorization'), `Basic ${Buffer.from('u:p').toString('base64')}`);
  assert.ok(new HTTPBasicAuth('u', 'p').equals(new HTTPBasicAuth('u', 'p')));

  const digest = new HTTPDigestAuth('Mufasa', 'Circle Of Life');
  digest.chal = { realm: 'testrealm@host.com', nonce: 'dcd98b7102dd2f0e8b11d0f600bfb0c093', qop: 'auth', opaque: '5ccc069c403ebaf9f0171e9517f40e41', algorithm: 'MD5' };
  digest.last_nonce = digest.chal.nonce;
  digest._cnonce = '0a4f113b';
  digest.nonce_count = 0;
  const digestHeader = digest.build_digest_header('GET', 'http://www.example.com/dir/index.html');
  assert.match(digestHeader, /^Digest username="Mufasa"/);
  assert.match(digestHeader, /realm="testrealm@host\.com"/);
  assert.match(digestHeader, /response="[0-9a-f]{32}"/);
  assert.match(digestHeader, /response="6629fae49393a05397450978507c4ef1"/);

  const response = new Response({ status: 404, statusText: 'Not Found', url: 'https://example.test/', headers: [['Content-Type', 'text/plain']], body: Buffer.from('missing') });
  assert.equal(response.ok, false);
  assert.equal(await response.text(), 'missing');
  assert.equal(await response.text(), 'missing');
  assert.throws(() => response.raise_for_status(), errors.HTTPError);
  assert.equal(String(response), '<Response [404]>');

  const lineResponse = new Response({ status: 200, url: 'https://example.test/', headers: [], body: Buffer.from('a\r\nb\nc') });
  const lines = [];
  for await (const line of lineResponse.iter_lines({ decode_unicode: true })) lines.push(line);
  assert.deepEqual(lines, ['a', 'b', 'c']);

  const mock = {
    calls: [],
    async send(request) {
      this.calls.push(request);
      if (request.url.endsWith('/first')) return { raw: { status: 302, statusText: 'Found', url: request.url, headers: [['Location', '/second'], ['Set-Cookie', 'sid=abc; Path=/']], body: Buffer.alloc(0) } };
      return { raw: { status: 200, statusText: 'OK', url: request.url, headers: [['Content-Type', 'application/json']], body: Buffer.from(JSON.stringify({ method: request.method, cookie: request.headers.get('cookie') })) } };
    },
    close() {},
  };
  const session = new Session({ trust_env: false });
  session.mount('http://', mock);
  session.mount('https://', mock);
  let hookCount = 0;
  const final = await session.asyncGet('http://example.test/first', { hooks: { response: (item) => { hookCount += 1; return item; } } });
  assert.equal(final.status_code, 200);
  assert.equal(final.history.length, 1);
  assert.equal(final.url, 'http://example.test/second');
  assert.equal((await final.json()).cookie, 'sid=abc');
  assert.equal(hookCount, 2);
  assert.equal(mock.calls[1].method, 'GET');
  assert.equal(session.cookies.get('sid'), 'abc');
  await session.close();

  assert.equal(codes.ok, 200);
  assert.equal(codes['temporary_redirect'], 307);
  assert.ok(new PreparedRequest());
  console.log('unit tests passed');
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
