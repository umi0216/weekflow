import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

export const MAX_FILE_BYTES = 100 * 1024 * 1024;
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
class LanError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
async function readJSON(request) {
  const chunks = []; let size = 0;
  if (request.body) for await (const chunk of request.body) {
    size += chunk.byteLength;
    if (size > 100000) throw new LanError(413, '内容过长');
    chunks.push(Buffer.from(chunk));
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new LanError(400, '请求格式不正确'); }
}
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const rowSQL = `SELECT m.*, f.name AS file_name, f.size AS file_size FROM lan_messages m LEFT JOIN lan_files f ON f.id = m.file_id`;
const messageRow = r => ({ id: r.id, roomId: r.room_id, senderId: r.sender_device_id, senderName: r.sender_name, content: r.content, createdAt: r.created_at, file: r.file_id ? { id: r.file_id, name: r.file_name, size: r.file_size } : null });
const label = (address, id) => `${address} · ${id.slice(0, 6)}`;

export function createLan({ DB, filesDirectory, maxFileBytes = MAX_FILE_BYTES, disconnectGraceMs = 30000 }) {
  const sessions = new Map(), shares = new Map();
  const encoder = new TextEncoder();
  function emit(session, type, data) {
    if (!session?.controller) return;
    try { session.controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)); }
    catch { detach(session); }
  }
  const broadcast = (type, data) => { for (const session of sessions.values()) emit(session, type, data); };
  const isOnline = id => [...sessions.values()].some(s => s.deviceId === id && s.controller);
  const presence = () => [...new Map([...sessions.values()].filter(s => s.controller).map(s => [s.deviceId, { id: s.deviceId, ip: s.address, label: label(s.address, s.deviceId), online: true }])).values()];
  const shareState = id => {
    const share = shares.get(id);
    return share ? { id: share.id, ownerId: share.ownerId, deviceId: share.deviceId, name: share.name, viewers: share.watchers.size } : null;
  };
  const shareList = () => [...shares.keys()].map(shareState);
  function notifyRoom(room, type, data) {
    for (const session of sessions.values()) if (session.deviceId === room.device_a || session.deviceId === room.device_b) emit(session, type, data);
  }
  async function getRoom(id, session) {
    if (!validId(id)) throw new LanError(400, '请选择设备');
    const room = await DB.prepare('SELECT * FROM lan_rooms WHERE id = ? AND (device_a = ? OR device_b = ?)').bind(id, session.deviceId, session.deviceId).first();
    if (!room) throw new LanError(404, '房间不存在');
    return room;
  }
  function endShare(id) {
    if (!shares.delete(id)) return;
    broadcast('shares', shareList());
  }
  function remove(session) {
    sessions.delete(session.id);
    const controller = session.controller; session.controller = null;
    try { controller?.close(); } catch {}
    for (const [id, share] of shares) {
      if (share.ownerId === session.id) endShare(id);
      else if (share.watchers.delete(session.id)) emit(sessions.get(share.ownerId), 'signal', { from: session.id, type: 'leave', shareId: share.id });
    }
    broadcast('presence', presence()); broadcast('shares', shareList());
  }
  function detach(session) { session.controller = null; session.disconnectedAt = Date.now(); broadcast('presence', presence()); }
  const heartbeat = setInterval(() => {
    for (const session of sessions.values()) {
      if (!session.controller && Date.now() - session.disconnectedAt > disconnectGraceMs) { remove(session); continue; }
      if (session.controller) {
        try { session.controller.enqueue(encoder.encode(': heartbeat\n\n')); } catch { detach(session); }
      }
    }
  }, Math.min(10000, disconnectGraceMs));
  heartbeat.unref();
  const getMessage = async id => messageRow(await DB.prepare(rowSQL + ' WHERE m.id = ?').bind(id).first());
  async function roomInfo(room, session) {
    const id = room.device_a === session.deviceId ? room.device_b : room.device_a;
    const device = await DB.prepare('SELECT id, address FROM lan_devices WHERE id = ?').bind(id).first();
    return { id: room.id, peer: { id, ip: device.address, label: label(device.address, id), online: isOnline(id) } };
  }
  async function roomList(session) {
    const rows = await DB.prepare('SELECT * FROM lan_rooms WHERE device_a = ? OR device_b = ? ORDER BY created_at DESC').bind(session.deviceId, session.deviceId).all();
    return Promise.all(rows.results.map(room => roomInfo(room, session)));
  }
  function authenticate(request, url) {
    const id = request.headers.get('X-Lan-Session') || url.searchParams.get('session');
    const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') || url.searchParams.get('token');
    const session = sessions.get(id);
    if (!session || session.token !== token) throw new LanError(401, '请重新连接');
    return session;
  }
  async function handle(request, { address = '127.0.0.1' } = {}) {
    const url = new URL(request.url), route = url.pathname;
    if (!route.startsWith('/api/lan/')) return null;
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        const origin = request.headers.get('Origin');
        if ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') throw new LanError(403, '请在本站内操作');
      }
      if (route === '/api/lan/info' && request.method === 'GET') return json({ maxFileBytes });
      if (route === '/api/lan/sessions' && request.method === 'POST') {
        if (sessions.size >= 200) throw new LanError(503, '连接过多，请稍后重试');
        const b = await readJSON(request);
        // The socket address comes from Node, never from a client-supplied or forwarded header.
        address = address.replace(/^::ffff:/, '');
        if (!isIP(address)) throw new LanError(400, '无法识别设备地址');
        let deviceId = b.deviceId, deviceToken = b.deviceToken;
        if (deviceId || deviceToken) {
          if (!validId(deviceId) || typeof deviceToken !== 'string' || !/^[a-f0-9]{64}$/.test(deviceToken)) throw new LanError(401, '设备凭据已失效');
          const device = await DB.prepare('SELECT token_hash FROM lan_devices WHERE id = ?').bind(deviceId).first();
          if (!device || device.token_hash !== hash(deviceToken)) throw new LanError(401, '设备凭据已失效');
          await DB.prepare('UPDATE lan_devices SET address = ? WHERE id = ?').bind(address, deviceId).run();
          for (const current of sessions.values()) if (current.deviceId === deviceId) current.address = address;
        } else {
          deviceId = randomUUID(); deviceToken = randomBytes(32).toString('hex');
          await DB.prepare('INSERT INTO lan_devices (id, token_hash, address, created_at) VALUES (?, ?, ?, ?)').bind(deviceId, hash(deviceToken), address, new Date().toISOString()).run();
        }
        const session = { id: randomUUID(), token: randomBytes(32).toString('hex'), deviceId, address, controller: null, disconnectedAt: Date.now() };
        sessions.set(session.id, session);
        return json({ id: session.id, token: session.token, deviceId, deviceToken, ip: address, label: label(address, deviceId), maxFileBytes }, 201);
      }
      const session = authenticate(request, url);
      if (route === '/api/lan/session' && request.method === 'DELETE') { remove(session); return json({ ok: true }); }
      if (route === '/api/lan/events' && request.method === 'GET') {
        const rooms = await roomList(session), oldController = session.controller;
        let currentController;
        const stream = new ReadableStream({
          start(controller) {
            currentController = controller; session.controller = controller;
            try { oldController?.close(); } catch {}
            emit(session, 'ready', { clients: presence(), rooms, shares: shareList() }); broadcast('presence', presence());
            const abort = () => { if (session.controller === controller) { try { controller.close(); } catch {} detach(session); } };
            request.signal.addEventListener('abort', abort, { once: true });
          },
          cancel() { if (session.controller === currentController) detach(session); }
        });
        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' } });
      }
      if (route === '/api/lan/rooms' && request.method === 'GET') return json({ rooms: await roomList(session) });
      if (route === '/api/lan/rooms' && request.method === 'POST') {
        const b = await readJSON(request);
        if (!validId(b.peerId) || b.peerId === session.deviceId) throw new LanError(400, '请选择另一台设备');
        if (!isOnline(b.peerId)) throw new LanError(404, '设备已离线');
        const [a, bId] = [session.deviceId, b.peerId].sort();
        await DB.prepare('INSERT INTO lan_rooms (id, device_a, device_b, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(device_a, device_b) DO NOTHING').bind(randomUUID(), a, bId, new Date().toISOString()).run();
        const room = await DB.prepare('SELECT * FROM lan_rooms WHERE device_a = ? AND device_b = ?').bind(a, bId).first();
        for (const current of sessions.values()) if (current.deviceId === a || current.deviceId === bId) emit(current, 'room', await roomInfo(room, current));
        return json(await roomInfo(room, session));
      }
      if (route === '/api/lan/messages' && request.method === 'GET') {
        const room = await getRoom(url.searchParams.get('room'), session), before = url.searchParams.get('before');
        if (before && (!/^\d+$/.test(before) || !Number.isSafeInteger(Number(before)))) throw new LanError(400, '分页格式不正确');
        const rows = await DB.prepare(rowSQL + ' WHERE m.room_id = ?' + (before ? ' AND m.id < ?' : '') + ' ORDER BY m.id DESC LIMIT 101').bind(room.id, ...(before ? [Number(before)] : [])).all();
        return json({ messages: rows.results.slice(0, 100).reverse().map(messageRow), hasMore: rows.results.length > 100 });
      }
      if (route === '/api/lan/messages' && request.method === 'POST') {
        const b = await readJSON(request), room = await getRoom(b.roomId, session);
        if (!validId(b.requestId) || typeof b.content !== 'string' || !b.content.trim() || b.content.length > 4000) throw new LanError(400, '消息限 4000 字');
        const result = await DB.prepare('INSERT INTO lan_messages (request_id, room_id, sender_device_id, sender_name, content, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(request_id) DO NOTHING RETURNING id').bind(b.requestId, room.id, session.deviceId, label(session.address, session.deviceId), b.content.trim(), new Date().toISOString()).first();
        if (!result) {
          const duplicate = await DB.prepare('SELECT id, sender_device_id, room_id FROM lan_messages WHERE request_id = ?').bind(b.requestId).first();
          if (duplicate.sender_device_id !== session.deviceId || duplicate.room_id !== room.id) throw new LanError(409, '消息标识重复');
          return json(await getMessage(duplicate.id));
        }
        const message = await getMessage(result.id); notifyRoom(room, 'message', message);
        return json(message, 201);
      }
      if (route === '/api/lan/files' && request.method === 'POST') {
        const room = await getRoom(request.headers.get('X-Lan-Room'), session);
        let name;
        try { name = decodeURIComponent(request.headers.get('X-File-Name') || '').split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f]/g, '').trim(); }
        catch { throw new LanError(400, '文件名不正确'); }
        if (!name || name.length > 200 || name === '.' || name === '..') throw new LanError(400, '文件名不正确');
        if (Number(request.headers.get('Content-Length')) > maxFileBytes) throw new LanError(413, '文件过大');
        const id = randomUUID(), target = path.join(filesDirectory, id), temporary = target + '.part';
        await mkdir(filesDirectory, { recursive: true });
        let size = 0, saved = false;
        try {
          const limiter = new Transform({ transform(chunk, encoding, done) { size += chunk.length; done(size > maxFileBytes ? new LanError(413, '文件过大') : null, chunk); } });
          await pipeline(request.body ? Readable.fromWeb(request.body) : Readable.from([]), limiter, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
          await rename(temporary, target);
          const now = new Date().toISOString();
          await DB.batch([
            DB.prepare('INSERT INTO lan_files (id, name, size, created_at) VALUES (?, ?, ?, ?)').bind(id, name, size, now),
            DB.prepare('INSERT INTO lan_messages (request_id, room_id, sender_device_id, sender_name, file_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, room.id, session.deviceId, label(session.address, session.deviceId), id, now)
          ]);
          saved = true;
          const message = messageRow(await DB.prepare(rowSQL + ' WHERE m.file_id = ?').bind(id).first());
          notifyRoom(room, 'message', message); return json(message, 201);
        } finally {
          await rm(temporary, { force: true }); if (!saved) await rm(target, { force: true });
        }
      }
      const fileMatch = route.match(/^\/api\/lan\/files\/([a-zA-Z0-9-]+)$/);
      if (fileMatch && ['GET', 'HEAD'].includes(request.method)) {
        const file = await DB.prepare('SELECT f.* FROM lan_files f JOIN lan_messages m ON m.file_id = f.id JOIN lan_rooms r ON r.id = m.room_id WHERE f.id = ? AND (r.device_a = ? OR r.device_b = ?)').bind(fileMatch[1], session.deviceId, session.deviceId).first();
        if (!file) throw new LanError(404, '文件不存在');
        const filename = path.join(filesDirectory, file.id);
        try { await stat(filename); } catch { throw new LanError(404, '文件已移走'); }
        return new Response(request.method === 'HEAD' ? null : Readable.toWeb(createReadStream(filename)), { headers: {
          'Content-Type': 'application/octet-stream', 'Content-Length': String(file.size),
          'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16))}`,
          'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store'
        } });
      }
      if (route === '/api/lan/share' && request.method === 'POST') {
        if (!session.controller) throw new LanError(409, '请先连接');
        let share = [...shares.values()].find(s => s.deviceId === session.deviceId);
        if (share && share.ownerId !== session.id) throw new LanError(409, '本设备已有共享');
        if (!share) {
          share = { id: randomUUID(), ownerId: session.id, deviceId: session.deviceId, name: label(session.address, session.deviceId), watchers: new Set() };
          shares.set(share.id, share);
        }
        broadcast('shares', shareList()); return json(shareState(share.id));
      }
      if (route === '/api/lan/share' && request.method === 'DELETE') {
        const id = url.searchParams.get('share'), share = shares.get(id);
        if (share && share.ownerId !== session.id) throw new LanError(403, '只能停止自己的共享');
        endShare(id); return json({ ok: true });
      }
      if (route === '/api/lan/signal' && request.method === 'POST') {
        const b = await readJSON(request), share = shares.get(b.shareId);
        if (!share) throw new LanError(409, '共享已结束');
        const target = sessions.get(b.to);
        if (!target?.controller || target.id === session.id) throw new LanError(404, '对方已离线');
        const fromOwner = session.id === share.ownerId, toOwner = target.id === share.ownerId;
        if (b.type === 'watch') {
          if (!toOwner || fromOwner) throw new LanError(400, '共享请求不正确');
          share.watchers.add(session.id);
        } else {
          const viewerId = fromOwner ? target.id : session.id;
          if ((!fromOwner && !toOwner) || !share.watchers.has(viewerId)) throw new LanError(403, '请先加入观看');
          if (b.type === 'offer' && (!fromOwner || b.data?.type !== 'offer' || typeof b.data.sdp !== 'string')) throw new LanError(400, '共享请求不正确');
          if (b.type === 'answer' && (!toOwner || b.data?.type !== 'answer' || typeof b.data.sdp !== 'string')) throw new LanError(400, '共享请求不正确');
          if (b.type === 'ice' && (!b.data || typeof b.data.candidate !== 'string')) throw new LanError(400, '共享请求不正确');
          if (b.type === 'leave') share.watchers.delete(viewerId);
          else if (!['offer', 'answer', 'ice'].includes(b.type)) throw new LanError(400, '共享请求不正确');
        }
        emit(target, 'signal', { from: session.id, type: b.type, data: b.data, shareId: share.id });
        if (b.type === 'watch' || b.type === 'leave') broadcast('shares', shareList());
        return json({ ok: true });
      }
      throw new LanError(404, '接口不存在');
    } catch (error) {
      if (!(error instanceof LanError)) console.error('LAN error:', error.message);
      return json({ error: error instanceof LanError ? error.message : '操作失败，请重试' }, error instanceof LanError ? error.status : 500);
    }
  }
  return { handle, close() { clearInterval(heartbeat); for (const session of [...sessions.values()]) remove(session); } };
}
