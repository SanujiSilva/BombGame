import {spawn} from 'node:child_process';
import {readFile, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve, sep} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const root = resolve(import.meta.dirname);
const profile = resolve(root, '.chrome_cdp_probe');
if (!profile.startsWith(root + sep)) throw new Error('Invalid browser profile path');
let server;
let target = process.argv[2] || 'https://roaring-froyo-54c853.netlify.app/';
if (target === '--local') {
  server = createServer(async (request, response) => {
    const file = ['trystero.bundle.mjs', 'metered.bundle.mjs', 'realtime-config.mjs'].find(name => request.url === '/' + name) || 'index.html';
    response.setHeader('Content-Type', file.endsWith('.mjs') ? 'application/javascript' : 'text/html');
    response.end(await readFile(resolve(root, file)));
  }).listen(0, '127.0.0.1');
  await new Promise(ok => server.once('listening', ok));
  target = `http://127.0.0.1:${server.address().port}/`;
}
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'
], {windowsHide: true, stdio: 'ignore'});

let ws;
try {
  let port;
  for (let i = 0; i < 100; i++) {
    try { port = (await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
    catch { await delay(100); }
  }
  if (!port) throw new Error('Chrome did not start');
  const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = ({data}) => {
    const msg = JSON.parse(data);
    if (msg.id) {
      const entry = pending.get(msg.id);
      if (entry) { pending.delete(msg.id); msg.error ? entry.reject(Error(msg.error.message)) : entry.resolve(msg.result); }
    } else if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text + ': ' + (msg.params.exceptionDetails.exception?.description || ''));
    else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push(msg.params.entry.text);
  };
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, {resolve, reject}); ws.send(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}));
  });
  async function tab(browserContextId) {
    const {targetId} = await call('Target.createTarget', {url: target, ...(browserContextId ? {browserContextId} : {})});
    const {sessionId} = await call('Target.attachToTarget', {targetId, flatten: true});
    await call('Runtime.enable', {}, sessionId);
    await call('Log.enable', {}, sessionId);
    return sessionId;
  }
  async function evaluate(session, expression) {
    const result = await call('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true}, session);
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  const {browserContextId} = await call('Target.createBrowserContext');
  const first = await tab(), second = await tab(browserContextId);
  let connected = false;
  for (let i = 0; i < 20; i++) {
    if (await evaluate(first, "typeof document.getElementById('create')?.onclick==='function'") && await evaluate(second, "typeof document.getElementById('create')?.onclick==='function'")) break;
    if (i === 19) throw Error('Game script did not load in both contexts: ' + JSON.stringify(errors));
    await delay(1000);
  }
  await evaluate(first, "document.getElementById('name').value='Alice';document.getElementById('capacity').value='2';document.getElementById('create').click()");
  let code = '';
  for (let i = 0; i < 20; i++) {
    code = await evaluate(first, "document.getElementById('gamecode').value");
    if (code) break;
    if (i === 19) throw Error('Creator did not connect: ' + await evaluate(first, "document.getElementById('lobbystatus').textContent"));
    await delay(1000);
  }
  console.log('Code:', code);
  await evaluate(second, `document.getElementById('name').value='Bob';document.getElementById('joincode').value=${JSON.stringify(code)};document.getElementById('join').click()`);
  for (let i = 0; i < 20; i++) {
    await delay(1000);
    const a = await evaluate(first, "({joined:document.getElementById('roster-count').textContent,status:document.getElementById('gamestatus').textContent})");
    const b = await evaluate(second, "({joined:document.getElementById('roster-count').textContent,status:document.getElementById('gamestatus').textContent,lobby:document.getElementById('lobbystatus').textContent})");
    if (i % 3 === 0 || a.joined === '2 / 2 joined' || b.joined === '2 / 2 joined') console.log('Rooms:', JSON.stringify({a,b}));
    if (a.joined === '2 / 2 joined' && b.joined === '2 / 2 joined') { connected = true; break; }
  }
  if (!connected) throw Error('The two browsers did not reach one room');
  await evaluate(first, "document.querySelectorAll('#board button')[0].click();document.getElementById('action').click()");
  await delay(500);
  await evaluate(second, "document.querySelectorAll('#board button')[1].click();document.getElementById('action').click()");
  let started = false;
  for (let i = 0; i < 10; i++) {
    if (await evaluate(first, "document.getElementById('turnpill').textContent") === 'YOUR TURN') { started = true; break; }
    await delay(500);
  }
  if (!started) throw Error('Round did not start after both bombs were locked');
  await evaluate(first, "document.querySelectorAll('#board button')[2].click()");
  let synced = false;
  for (let i = 0; i < 10; i++) {
    if (await evaluate(second, "document.getElementById('opscore').textContent") === '1') { synced = true; break; }
    await delay(500);
  }
  if (!synced) throw Error('Safe move score did not reach the other browser');
  console.log('Game:', 'bombs locked, round started, turn and score synchronized');
  console.log('Errors:', JSON.stringify(errors));
} finally {
  ws?.close();
  chrome.kill();
  await delay(1000);
  await rm(profile, {recursive: true, force: true});
  if (server) await new Promise(ok => server.close(ok));
}
