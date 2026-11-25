import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { database } from '../scripts/database.mjs';
import { createLan } from '../scripts/lan.mjs';

let DB, lan, directory;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'weekflow-lan-test-'));
  DB = database(path.join(directory, 'team.sqlite'));
  lan = createLan({ DB, filesDirectory: path.join(directory, 'files'), maxFileBytes: 1024, disconnectGraceMs: 500 });
});
afterEach(async () => { lan.close(); DB.close(); await rm(directory, { recursive: true, force: true }); });
function request(route, { method = 'GET', data, session, headers = {}, body, address = '192.168.1.10' } = {}) {
  return lan.handle(new Request('http://local/api/lan' + route, { method, headers: {
    ...(session ? { 'X-Lan-Session': session.id, Authorization: 'Bearer ' + session.token } : {}), ...headers
  }, ...(data !== undefined ? { body: JSON.stringify(data) } : body !== undefined ? { body, duplex: 'half' } : {}) }), { address });
}
async function join(address = '192.168.1.10', credentials = {}) {
  const response = await request('/sessions', { method: 'POST', data: credentials, address });
  assert.equal(response.status, 201); return response.json();
}
async function events(session) {
  const response = await request('/events', { session }); assert.equal(response.status, 200);
  const reader = response.body.getReader(); let buffer = '';
  return { reader, async next(type) {
    while (true) {
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        if (block.startsWith('event: ' + type + '\n')) return JSON.parse(block.split('\ndata: ')[1]);
      }
      const chunk = await reader.read(); assert.equal(chunk.done, false); buffer += new TextDecoder().decode(chunk.value);
    }
  } };
}
async function pair() {
  const a = await join(), b = await join('192.168.1.20'), c = await join('192.168.1.30');
  const af = await events(a), bf = await events(b), cf = await events(c);
  await af.next('ready'); await bf.next('ready'); await cf.next('ready');
  const room = await (await request('/rooms', { method: 'POST', session: a, data: { peerId: b.deviceId } })).json();
  return { a, b, c, af, bf, cf, room };
}

test('anonymous devices connect without task members; socket IP is authoritative', async () => {
  const response = await request('/sessions', { method: 'POST', data: { memberId: 'ignored', ip: 'fake' }, headers: { 'X-Forwarded-For': '1.2.3.4' }, address: '::ffff:192.168.1.42' });
  assert.equal(response.status, 201); const device = await response.json();
  assert.equal(device.ip, '192.168.1.42'); assert.match(device.label, /^192\.168\.1\.42 · /);
  assert.equal((await DB.prepare('SELECT count(*) AS n FROM members').first()).n, 0);
  assert.equal((await request('/messages')).status, 401);
  assert.equal((await request('/sessions', { method: 'POST', data: {}, headers: { Origin: 'http://other' } })).status, 403);
});

test('same-IP devices remain distinct; resuming requires the device secret', async () => {
  const a = await join(), b = await join(); assert.notEqual(a.deviceId, b.deviceId); assert.notEqual(a.label, b.label);
  assert.equal((await request('/sessions', { method: 'POST', data: { deviceId: a.deviceId, deviceToken: b.deviceToken } })).status, 401);
  const resumed = await join('192.168.1.99', { deviceId: a.deviceId, deviceToken: a.deviceToken });
  assert.equal(resumed.deviceId, a.deviceId); assert.equal(resumed.ip, '192.168.1.99');
  assert.equal((await DB.prepare('SELECT token_hash FROM lan_devices WHERE id = ?').bind(a.deviceId).first()).token_hash.includes(a.deviceToken), false);
});

test('pair rooms resolve symmetrically and only their two devices can access them', async () => {
  const { a, b, c, room } = await pair(); assert.equal(room.peer.id, b.deviceId);
  const other = await (await request('/rooms', { method: 'POST', session: b, data: { peerId: a.deviceId } })).json();
  assert.equal(other.id, room.id); assert.equal(other.peer.id, a.deviceId);
  assert.deepEqual((await (await request('/rooms', { session: c })).json()).rooms, []);
  assert.equal((await request('/messages?room=' + room.id, { session: c })).status, 404);
  assert.equal((await request('/messages', { method: 'POST', session: c, data: { roomId: room.id, requestId: 'bad', content: 'intrude' } })).status, 404);
  assert.equal((await request('/rooms', { method: 'POST', session: a, data: { peerId: a.deviceId } })).status, 400);
  assert.equal((await request('/rooms', { method: 'POST', session: a, data: { peerId: 'offline' } })).status, 404);
});

test('direct messages broadcast to the recipient, deduplicate, paginate and survive restart', async () => {
  const { a, b, room, bf } = await pair();
  const content = '<img src=x onerror=alert(1)>\n两行文字';
  const send = () => request('/messages', { method: 'POST', session: a, data: { roomId: room.id, content, requestId: 'retry-1' } });
  const replies = await Promise.all([send(), send()]); assert.deepEqual(replies.map(r => r.status).sort(), [200, 201]);
  assert.equal((await replies[0].json()).id, (await replies[1].json()).id);
  const message = await bf.next('message'); assert.equal(message.content, content); assert.equal(message.senderId, a.deviceId); assert.equal(message.roomId, room.id);
  assert.equal((await request('/messages', { method: 'POST', session: b, data: { roomId: room.id, content, requestId: 'retry-1' } })).status, 409);
  assert.equal((await request('/messages?room=' + room.id + '&before=NaN', { session: b })).status, 400);
  for (let i = 0; i < 103; i++) await DB.prepare('INSERT INTO lan_messages (request_id, room_id, sender_device_id, sender_name, content, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind('page-' + i, room.id, a.deviceId, a.label, String(i), new Date().toISOString()).run();
  const latest = await (await request('/messages?room=' + room.id, { session: b })).json();
  assert.equal(latest.messages.length, 100); assert.equal(latest.hasMore, true);
  const older = await (await request('/messages?room=' + room.id + '&before=' + latest.messages[0].id, { session: b })).json();
  assert.equal(older.messages.length, 4); assert.equal(older.hasMore, false);
  lan.close(); DB.close(); DB = database(path.join(directory, 'team.sqlite')); lan = createLan({ DB, filesDirectory: path.join(directory, 'files') });
  assert.equal((await request('/rooms', { session: a })).status, 401);
  const resumed = await join('192.168.1.10', { deviceId: a.deviceId, deviceToken: a.deviceToken });
  assert.equal((await (await request('/rooms', { session: resumed })).json()).rooms[0].id, room.id);
  assert.equal((await (await request('/messages?room=' + room.id, { session: resumed })).json()).messages.length, 100);
});

test('files arrive intact only in their pair room and cannot be downloaded by a third device', async () => {
  const { a, b, c, room } = await pair(), bytes = new Uint8Array([0, 1, 2, 255, 10, 13, 50]);
  const response = await request('/files', { method: 'POST', session: a, headers: { 'X-Lan-Room': room.id, 'X-File-Name': encodeURIComponent('../../报告.html'), 'Content-Type': 'text/html' }, body: bytes });
  assert.equal(response.status, 201); const message = await response.json();
  assert.equal(message.file.name, '报告.html'); assert.equal(message.roomId, room.id);
  const download = await request('/files/' + message.file.id, { session: b });
  assert.equal(download.headers.get('Content-Type'), 'application/octet-stream'); assert.match(download.headers.get('Content-Disposition'), /^attachment;/);
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()), bytes);
  assert.equal((await request('/files/' + message.file.id, { session: c })).status, 404);
  assert.equal((await request('/files', { method: 'POST', session: c, headers: { 'X-Lan-Room': room.id, 'X-File-Name': 'bad' }, body: bytes })).status, 404);
  const head = await request('/files/' + message.file.id, { method: 'HEAD', session: b }); assert.equal(head.body, null); assert.equal(head.headers.get('Content-Length'), String(bytes.length));
});

test('oversized and interrupted uploads leave neither partial files nor messages', async () => {
  const { a, room } = await pair(), headers = { 'X-Lan-Room': room.id, 'X-File-Name': 'large.bin' };
  assert.equal((await request('/files', { method: 'POST', session: a, headers: { ...headers, 'Content-Length': '1025' }, body: new Uint8Array(1025) })).status, 413);
  assert.equal((await request('/files', { method: 'POST', session: a, headers, body: new Uint8Array(1025) })).status, 413);
  const interrupted = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(12)); c.error(new Error('connection lost')); } });
  const originalError = console.error; console.error = () => {};
  try { assert.equal((await request('/files', { method: 'POST', session: a, headers, body: interrupted })).status, 500); }
  finally { console.error = originalError; }
  assert.deepEqual(await readdir(path.join(directory, 'files')), []);
  assert.deepEqual((await (await request('/messages?room=' + room.id, { session: a })).json()).messages, []);
});

test('screen shares are advertised independently of chat; viewers explicitly join and leave', async () => {
  const { a, b, c, af, bf, cf } = await pair();
  const share = await (await request('/share', { method: 'POST', session: a, data: {} })).json();
  assert.equal((await cf.next('shares'))[0].ownerId, a.id);
  assert.equal((await request('/share?share=' + share.id, { method: 'DELETE', session: b })).status, 403);
  const signal = (session, to, type, data) => request('/signal', { method: 'POST', session, data: { shareId: share.id, to, type, data } });
  assert.equal((await signal(a, c.id, 'offer', { type: 'offer', sdp: 'not-invited' })).status, 403);
  for (const viewer of [b, c]) { assert.equal((await signal(viewer, a.id, 'watch')).status, 200); assert.equal((await af.next('signal')).type, 'watch'); }
  assert.equal((await signal(a, b.id, 'offer', { type: 'offer', sdp: 'sdp-offer' })).status, 200);
  assert.equal((await bf.next('signal')).data.sdp, 'sdp-offer');
  assert.equal((await signal(b, a.id, 'answer', { type: 'answer', sdp: 'sdp-answer' })).status, 200);
  assert.equal((await af.next('signal')).data.sdp, 'sdp-answer');
  assert.equal((await signal(b, c.id, 'ice', { candidate: 'bad' })).status, 403);
  assert.equal((await signal(b, a.id, 'leave')).status, 200); assert.equal((await af.next('signal')).type, 'leave');
  assert.equal((await signal(a, b.id, 'ice', { candidate: 'after-leave' })).status, 403);
  const second = await (await request('/share', { method: 'POST', session: b, data: {} })).json(); assert.notEqual(second.id, share.id);
  await request('/share?share=' + share.id, { method: 'DELETE', session: a });
  assert.equal((await signal(a, c.id, 'offer', { type: 'offer', sdp: 'old' })).status, 409);
});

test('SSE replacement preserves presence; disconnect expiry removes abandoned screen shares', async () => {
  const a = await join(), b = await join('192.168.1.20');
  const old = await events(a); await old.next('ready'); const replacement = await events(a); await replacement.next('ready'); await old.reader.cancel();
  const viewer = await events(b); await viewer.next('ready');
  const share = await (await request('/share', { method: 'POST', session: a, data: {} })).json();
  assert.equal((await request('/signal', { method: 'POST', session: b, data: { shareId: share.id, to: a.id, type: 'watch' } })).status, 200);
  assert.equal((await replacement.next('signal')).type, 'watch');
  await replacement.reader.cancel(); await new Promise(r => setTimeout(r, 1100));
  const probe = await events(b), data = await probe.next('ready'); assert.deepEqual(data.shares, []); assert.equal(data.clients.length, 1);
});

test('v1 tasks survive migration; legacy public messages are not exposed to anonymous pair rooms', async () => {
  const file = path.join(directory, 'v1.sqlite'), sqlite = new DatabaseSync(file);
  sqlite.exec(await readFile(new URL('../drizzle/0000_team.sql', import.meta.url), 'utf8'));
  sqlite.exec('CREATE TABLE _local_migrations (name TEXT PRIMARY KEY)'); sqlite.prepare('INSERT INTO _local_migrations VALUES (?)').run('0000_team');
  sqlite.prepare('INSERT INTO members(id,name,color,created_at) VALUES(?,?,?,?)').run('old', '原成员', 'sage', '2026-01-01');
  sqlite.prepare('INSERT INTO tasks(id,member_id,title,created_at,updated_at) VALUES(?,?,?,?,?)').run('old-task', 'old', '原任务', '2026-01-01', '2026-01-01'); sqlite.close();
  const upgraded = database(file);
  try { assert.equal((await upgraded.prepare('SELECT title FROM tasks').first()).title, '原任务'); assert.equal((await upgraded.prepare('SELECT count(*) AS n FROM lan_devices').first()).n, 0); } finally { upgraded.close(); }
  await DB.prepare('INSERT INTO lan_messages(request_id,sender_name,content,created_at) VALUES(?,?,?,?)').bind('legacy', '旧署名', '旧公共消息', '2026-01-01').run();
  const { a, room } = await pair(); assert.deepEqual((await (await request('/messages?room=' + room.id, { session: a })).json()).messages, []);
  assert.equal((await DB.prepare('SELECT count(*) AS n FROM lan_messages WHERE room_id IS NULL').first()).n, 1);
});
