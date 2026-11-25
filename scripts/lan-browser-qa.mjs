import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, readFile, access, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { database } from './database.mjs';
import { createLan } from './lan.mjs';
import { createHandler } from './server.mjs';

const argument = name => process.argv.find(value => value.startsWith('--' + name + '='))?.split('=').slice(1).join('=');
const candidates = [argument('browser'), process.env.BROWSER_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
if (!executable) { console.error('设置 BROWSER_PATH 为本机 Chrome / Chromium / Edge 可执行文件，再运行 npm run test:browser。'); process.exit(1); }
const directory = await mkdtemp(path.join(tmpdir(), 'weekflow-browser-'));
const DB = database(path.join(directory, 'test.sqlite'));
const lan = createLan({ DB, filesDirectory: path.join(directory, 'files') });
let server;
const secure = process.argv.includes('--https');
let browser, socket, next = 0;
const pending = new Map(), errors = [];
const delay = ms => new Promise(r => setTimeout(r, ms));
const cdp = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++next;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15000);
  pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
  socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
async function page(url) {
  const { browserContextId } = await cdp('Target.createBrowserContext');
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  const command = (method, params) => cdp(method, params, sessionId);
  await command('Runtime.enable'); await command('Page.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await command('Page.navigate', { url });
  const evaluate = async expression => {
    const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const until = async (expression, label) => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(100); }
    throw new Error('Timed out: ' + label);
  };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const fill = (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  return { command, evaluate, until, click, fill };
}
try {
  const handler = createHandler({ DB, lan });
  if (secure) {
    const certificates = path.join(directory, 'certs');
    const generated = spawnSync(process.execPath, [fileURLToPath(new URL('./cert.mjs', import.meta.url)), '127.0.0.1'], { env: { ...process.env, CERT_DIR: certificates }, encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr);
    server = createSecureServer({ cert: await readFile(path.join(certificates, 'server.crt')), key: await readFile(path.join(certificates, 'server.key')) }, handler);
  } else server = createServer(handler);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = (secure ? 'https' : 'http') + '://127.0.0.1:' + server.address().port;
  for (const [id, name] of [['a', '甲'], ['b', '乙'], ['c', '丙']]) await DB.prepare('INSERT INTO members(id,name,color,created_at) VALUES(?,?,?,?)').bind(id, name, 'sage', new Date().toISOString()).run();
  browser = spawn(executable, ['--headless=new', ...(secure ? ['--ignore-certificate-errors'] : []), '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + path.join(directory, 'browser'), 'about:blank'], { stdio: 'ignore' });
  let portFile;
  for (let i = 0; i < 100; i++) { try { portFile = await readFile(path.join(directory, 'browser/DevToolsActivePort'), 'utf8'); break; } catch {} await delay(100); }
  assert.ok(portFile, 'browser did not start');
  const [port, endpoint] = portFile.trim().split('\n');
  socket = new WebSocket('ws://127.0.0.1:' + port + endpoint);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) { const task = pending.get(message.id); pending.delete(message.id); if (message.error) task?.reject(new Error(JSON.stringify(message.error))); else task?.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  };
  const a = await page(origin), b = await page(origin), c = await page(origin);
  for (const client of [a, b, c]) {
    await client.until(`!!document.querySelector('.column') && document.querySelector('.lan-connection').classList.contains('connected')`, 'automatic device connection');
    await client.click('[data-action="messages"]');
    await client.until(`document.querySelectorAll('[data-peer]').length===2`, 'device discovery');
    assert.equal(await client.evaluate(`!!document.querySelector('#lan-identity')`), false);
    assert.equal(await client.evaluate(`document.querySelector('.lan-room').hidden`), true);
  }
  const deviceId = client => client.evaluate(`JSON.parse(localStorage.getItem('weekflow.lan.device')).deviceId`);
  const ids = { a: await deviceId(a), b: await deviceId(b), c: await deviceId(c) };
  assert.equal(new Set(Object.values(ids)).size, 3);
  assert.equal(await a.evaluate(`document.querySelector('#lan-self').textContent.includes('127.0.0.1')`), true);
  const select = async (client, id) => {
    await client.click('[data-peer="' + id + '"]');
    await client.until(`!document.querySelector('.lan-room').hidden && document.querySelector('#lan-title').textContent.includes(${JSON.stringify(id.slice(0, 6))})`, 'explicit recipient');
  };
  const send = async (client, content) => {
    await client.fill('.lan-compose textarea', content); await client.evaluate(`document.querySelector('.lan-compose').requestSubmit()`);
    await client.until(`document.querySelector('.lan-compose textarea').value===''`, 'sent');
  };
  await select(a, ids.b); await select(b, ids.a);
  console.log('PASS: automatic anonymous discovery, unique devices on the same IP, explicit recipients');
  await b.click('[data-lan="close"]');
  await send(a, '<img src=x onerror=alert(1)>\n只给 B 的消息');
  await b.until(`document.querySelector('[data-action="messages"]').classList.contains('has-unread')`, 'direct unread');
  await b.click('[data-action="messages"]');
  await b.until(`document.querySelector('.lan-messages').textContent.includes('只给 B 的消息')`, 'direct message received');
  assert.equal(await b.evaluate(`!!document.querySelector('.lan-bubble img')`), false);
  assert.equal(await c.evaluate(`document.querySelector('[data-action="messages"]').classList.contains('has-unread')`), false);
  assert.equal(await c.evaluate(`document.querySelector('.lan-messages').textContent`), '');
  await a.evaluate(`(()=>{const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array([0,1,255,50])],'报告.txt',{type:'text/plain'}));document.querySelector('.lan-panel').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));})()`);
  await b.until(`!!document.querySelector('[data-file]')`, 'direct file received');
  assert.equal(await c.evaluate(`!!document.querySelector('[data-file]')`), false);
  assert.equal((await DB.prepare('SELECT size FROM lan_files').first()).size, 4);
  await a.until(`document.querySelector('.lan-upload').hidden`, 'upload complete');
  await a.fill('.lan-compose textarea', '给 B 的草稿'); await a.click('[data-lan="back"]'); await select(a, ids.c);
  assert.equal(await a.evaluate(`document.querySelector('.lan-compose textarea').value`), '');
  await send(a, '只给 C 的消息'); await select(c, ids.a);
  await c.until(`document.querySelector('.lan-messages').textContent.includes('只给 C 的消息')`, 'second recipient');
  assert.equal(await b.evaluate(`document.querySelector('.lan-messages').textContent.includes('只给 C 的消息')`), false);
  await a.click('[data-lan="back"]'); await select(a, ids.b);
  assert.equal(await a.evaluate(`document.querySelector('.lan-compose textarea').value`), '给 B 的草稿');
  await a.fill('.lan-compose textarea', '');
  await a.until(`document.querySelector('.lan-messages').textContent.includes('报告.txt')`, 'room history restored');
  assert.equal(await a.evaluate(`document.querySelector('.lan-messages').textContent.includes('只给 C 的消息')`), false);
  console.log('PASS: A→B and A→C are isolated, attachments are direct, drafts stay with their recipient');
  // Replace only the capture picker. Real ICE, media encoding, transport and decoding remain enabled.
  await a.evaluate(`(()=>{navigator.mediaDevices.getDisplayMedia=async()=>{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const context=canvas.getContext('2d');let frame=0;const timer=setInterval(()=>{context.fillStyle=frame++%2?'#326c59':'#5a9077';context.fillRect(0,0,640,360);context.fillStyle='white';context.fillText('Weekflow '+frame,40,40)},60);const stream=canvas.captureStream(15);stream.getVideoTracks()[0].addEventListener('ended',()=>clearInterval(timer));return stream;};})()`);
  await a.click('[data-lan="back"]');
  await a.click('[data-lan="share"]');
  for (const client of [b, c]) {
    await client.until(`!!document.querySelector('[data-watch]')`, 'screen advertised');
    assert.equal(await client.evaluate(`document.querySelector('.lan-stage').hidden`), true);
    assert.equal(await client.evaluate(`document.querySelector('[data-watch]').textContent`), '观看');
    await client.click('[data-watch]');
    await client.until(`document.querySelector('.lan-stage video').videoWidth===640 && document.querySelector('.lan-stage video').currentTime>0`, 'opt-in real peer video');
    assert.equal(await client.evaluate(`document.querySelector('#lan-video-status').textContent.includes(${JSON.stringify(ids.a.slice(0, 6))})`), true);
  }
  await a.until(`document.querySelector('.lan-shares').textContent.includes('2 人观看')`, 'viewer count');
  await send(b, '共享时私信 A'); await select(a, ids.b);
  await a.until(`document.querySelector('.lan-messages').textContent.includes('共享时私信 A')`, 'private chat while sharing');
  assert.equal(await c.evaluate(`document.querySelector('.lan-messages').textContent.includes('共享时私信 A')`), false);
  await c.click('[data-lan="leave"]');
  await a.until(`document.querySelector('.lan-shares').textContent.includes('1 人观看')`, 'viewer leaves');
  await c.click('[data-watch]');
  await c.until(`document.querySelector('.lan-stage video').videoWidth===640 && document.querySelector('.lan-stage video').currentTime>0`, 'rewatch');
  if (argument('screenshots')) {
    await mkdir(argument('screenshots'), { recursive: true });
    for (const [client, name] of [[a, 'sharing-owner'], [b, 'sharing-viewer']]) {
      const screenshot = await client.command('Page.captureScreenshot', { format: 'png' });
      await writeFile(path.join(argument('screenshots'), name + '.png'), Buffer.from(screenshot.data, 'base64'));
    }
  }
  await a.click('[data-lan="stop"]');
  for (const client of [b, c]) await client.until(`document.querySelector('.lan-stage').hidden && document.querySelector('.lan-shares').hidden`, 'stop closes all viewers');
  console.log('PASS: screen is opt-in for both peers, viewer count, private chat during sharing, leave, rejoin, stop');
  await b.command('Page.reload'); await b.until(`!!document.querySelector('.lan-connection') && document.querySelector('.lan-connection').classList.contains('connected')`, 'device resumed');
  assert.equal(await deviceId(b), ids.b);
  await b.click('[data-action="messages"]');
  await b.until(`document.querySelector('.lan-messages').textContent.includes('报告.txt') && document.querySelector('.lan-messages').textContent.includes('只给 B 的消息')`, 'private history resumed');
  assert.equal(await b.evaluate(`document.querySelector('.lan-messages').textContent.includes('只给 C 的消息')`), false);
  await b.command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await b.evaluate(`document.documentElement.scrollWidth>window.innerWidth`), false);
  assert.equal(await b.evaluate(`document.querySelector('.lan-panel').getBoundingClientRect().width`), 390);
  if (argument('screenshots')) {
    const screenshot = await b.command('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(argument('screenshots'), 'mobile.png'), Buffer.from(screenshot.data, 'base64'));
    await c.click('[data-lan="back"]');
    const devicesScreenshot = await c.command('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(argument('screenshots'), 'devices.png'), Buffer.from(devicesScreenshot.data, 'base64'));
  }
  await b.click('[data-lan="close"]');
  await b.evaluate(`document.querySelector('.todo .task-stack').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}))`);
  await b.until(`!!document.querySelector('#task-form')`, 'blank-space task creation');
  await b.fill('#task-form [name="title"]', '原看板仍可用'); await b.evaluate(`document.querySelector('#task-form').requestSubmit()`);
  await b.until(`!!document.querySelector('.task-card')`, 'task created');
  assert.deepEqual(errors, []);
  console.log('PASS: device and pair history survive reload; mobile and board remain functional; no browser exceptions');
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  if (browser && browser.exitCode === null) {
    const exited = new Promise(resolve => browser.once('exit', resolve));
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: ++next, method: 'Browser.close' }));
    else browser.kill();
    await Promise.race([exited, delay(3000)]);
    if (browser.exitCode === null && browser.signalCode === null) browser.kill();
  }
  socket?.close();
  lan.close(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } DB.close();
  await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
