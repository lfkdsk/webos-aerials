import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {createCache} = require('../service/cache.js');

const BODY = Buffer.alloc(300 * 1024, 7);
let failFirst = false;
const server = http.createServer((req, res) => {
  const range = /^bytes=(\d+)-$/.exec(req.headers.range || '');
  const start = range ? +range[1] : 0;
  if (failFirst) { failFirst = false; res.socket.destroy(); return; }
  res.writeHead(range ? 206 : 200, {'content-length': BODY.length - start});
  // Trickle the body so the client sees several chunks and the test can interrupt it.
  let i = start; const push = () => { if (i >= BODY.length) { res.end(); return; } res.write(BODY.subarray(i, i + 64 * 1024)); i += 64 * 1024; setTimeout(push, 300); };
  push();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const ID1 = '83C65C90-270C-4490-9C69-F51FE03D7F06', ID2 = '009BA758-7060-4479-8EE8-FB9B40C8FB97';
// cache.js only accepts sylvan.apple.com URLs; the test's fake https maps them onto the local server.
const fakeHttps = {get: (url, opts, cb) => http.get(url.replace('https://sylvan.apple.com', `http://127.0.0.1:${port}`), opts, cb)};
const wait = (cache, pred) => new Promise(r => { const off = cache.subscribe(s => { if (pred(s)) { off(); r(s); } }); if (pred(cache.status())) { off(); r(cache.status()); } });
const done = s => !s.downloading && s.files.filter(f => f.complete).length >= 1;

test('downloads wanted clips, resumes, prunes and clears', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aerials-'));
  const cache = createCache({dir, https: fakeHttps});
  const want = [{id: ID1, quality: '4K-SDR', url: 'https://sylvan.apple.com/a.mov'}];
  assert.equal(cache.sync([{id: 'bad', quality: '4K-SDR', url: 'https://sylvan.apple.com/x'}, {id: ID1, quality: '4K-SDR', url: 'https://evil.example/x'}]).wanted, 0, 'rejects bad ids and foreign hosts');
  // First attempt gets cut off mid-stream; the retry must resume from the partial file.
  failFirst = false;
  cache.sync(want);
  await wait(cache, s => (s.downloading && s.downloading.received > 0) || s.files.length > 0);
  cache.clear();
  assert.equal(fs.readdirSync(dir).length, 0, 'clear removes partials');
  fs.writeFileSync(path.join(dir, `${ID1}.4K-SDR.mov.part`), BODY.subarray(0, 100 * 1024));
  cache.sync(want);
  const s1 = await wait(cache, done);
  assert.equal(s1.files[0].size, BODY.length);
  assert.deepEqual(fs.readFileSync(s1.files[0].path), BODY, 'resumed file is byte-identical');
  // Changing the wanted set drops the old file and fetches the new one.
  cache.sync([{id: ID2, quality: '1080-SDR', url: 'https://sylvan.apple.com/b.mov'}]);
  const s2 = await wait(cache, s => done(s) && s.files.some(f => f.id === ID2));
  assert.deepEqual(s2.files.map(f => f.id), [ID2]);
  assert.equal(cache.clear().files.length, 0);
  fs.rmSync(dir, {recursive: true});
});

test.after(() => server.close());
