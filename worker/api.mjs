const STATUSES = ['todo', 'progress', 'review', 'done'];
const PRIORITIES = ['low', 'normal', 'high'];
const COLORS = ['sage', 'blue', 'rose', 'amber', 'violet', 'slate'];
class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
function text(value, label, max, required = false) {
  if (typeof value !== 'string' || value.length > max) throw new ApiError(400, `${label}格式不正确，最多 ${max} 个字符`);
  const result = value.trim();
  if (required && !result) throw new ApiError(400, `请填写${label}`);
  return result;
}
async function body(request) {
  if (Number(request.headers.get('content-length')) > 20000) throw new ApiError(413, '内容过长');
  const raw = await request.text();
  if (raw.length > 20000) throw new ApiError(413, '内容过长');
  try { const value = JSON.parse(raw); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
  catch { throw new ApiError(400, '请求格式不正确'); }
}
const memberRow = r => ({ id: r.id, name: r.name, role: r.role, color: r.color, createdAt: r.created_at });
const taskRow = r => ({ id: r.id, memberId: r.member_id, title: r.title, description: r.description, status: r.status, priority: r.priority, createdAt: r.created_at, updatedAt: r.updated_at, completedAt: r.completed_at, version: r.version });
export async function api(request, env) {
  try {
    const url = new URL(request.url);
    if (['POST', 'PATCH', 'DELETE'].includes(request.method)) {
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) throw new ApiError(403, '请在本站内操作');
      if (request.headers.get('sec-fetch-site') === 'cross-site') throw new ApiError(403, '请在本站内操作');
    }
    if (!env.DB) throw new ApiError(503, '数据库尚未连接，请稍后重试');
    const db = env.DB;
    const path = url.pathname;
    if (path === '/api/state' && request.method === 'GET') {
      const [members, tasks] = await db.batch([
        db.prepare('SELECT * FROM members ORDER BY created_at, id'),
        db.prepare('SELECT * FROM tasks ORDER BY created_at DESC, id')
      ]);
      return json({ members: members.results.map(memberRow), tasks: tasks.results.map(taskRow) });
    }
    if (path === '/api/members' && request.method === 'POST') {
      const b = await body(request);
      const row = { id: crypto.randomUUID(), name: text(b.name, '成员姓名', 30, true), role: text(b.role ?? '', '角色', 40), color: b.color, createdAt: new Date().toISOString() };
      if (!COLORS.includes(row.color)) throw new ApiError(400, '请选择头像颜色');
      try { await db.prepare('INSERT INTO members (id, name, role, color, created_at) VALUES (?, ?, ?, ?, ?)').bind(row.id, row.name, row.role, row.color, row.createdAt).run(); }
      catch (error) { if (/unique/i.test(error.message)) throw new ApiError(409, '这个成员已存在，请换一个姓名'); throw error; }
      return json(row, 201);
    }
    const memberMatch = path.match(/^\/api\/members\/([a-zA-Z0-9-]+)$/);
    if (memberMatch && request.method === 'PATCH') {
      const b = await body(request), id = memberMatch[1];
      if (!await db.prepare('SELECT id FROM members WHERE id = ?').bind(id).first()) throw new ApiError(404, '成员不存在');
      const name = text(b.name, '成员姓名', 30, true), role = text(b.role ?? '', '角色', 40);
      if (!COLORS.includes(b.color)) throw new ApiError(400, '请选择头像颜色');
      try { await db.prepare('UPDATE members SET name = ?, role = ?, color = ? WHERE id = ?').bind(name, role, b.color, id).run(); }
      catch (error) { if (/unique/i.test(error.message)) throw new ApiError(409, '这个成员姓名已被使用'); throw error; }
      return json(memberRow(await db.prepare('SELECT * FROM members WHERE id = ?').bind(id).first()));
    }
    if (memberMatch && request.method === 'DELETE') {
      const result = await db.prepare('DELETE FROM members WHERE id = ?').bind(memberMatch[1]).run();
      if (!result.meta.changes) throw new ApiError(404, '成员不存在');
      return json({ ok: true });
    }
    if (path === '/api/tasks' && request.method === 'POST') {
      const b = await body(request);
      const title = text(b.title, '任务标题', 120, true), description = text(b.description ?? '', '任务描述', 4000);
      if (!PRIORITIES.includes(b.priority ?? 'normal')) throw new ApiError(400, '优先级不正确');
      if (!await db.prepare('SELECT id FROM members WHERE id = ?').bind(b.memberId ?? '').first()) throw new ApiError(404, '请先选择一个成员');
      const id = crypto.randomUUID(), now = new Date().toISOString();
      await db.prepare("INSERT INTO tasks (id, member_id, title, description, status, priority, created_at, updated_at, version) VALUES (?, ?, ?, ?, 'todo', ?, ?, ?, 1)").bind(id, b.memberId, title, description, b.priority ?? 'normal', now, now).run();
      return json(taskRow(await db.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first()), 201);
    }
    const taskMatch = path.match(/^\/api\/tasks\/([a-zA-Z0-9-]+)$/);
    if (taskMatch && ['PATCH', 'DELETE'].includes(request.method)) {
      const id = taskMatch[1], existing = await db.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
      if (!existing) throw new ApiError(404, '任务已被删除');
      const b = await body(request);
      if (!Number.isInteger(b.version)) throw new ApiError(400, '请刷新任务后重试');
      if (b.version !== existing.version) throw new ApiError(409, '任务刚刚被更新，已为你刷新，请重试');
      if (request.method === 'DELETE') {
        const result = await db.prepare('DELETE FROM tasks WHERE id = ? AND version = ?').bind(id, b.version).run();
        if (!result.meta.changes) throw new ApiError(409, '任务刚刚被更新，请刷新后重试');
        return json({ ok: true });
      }
      const title = text(b.title ?? existing.title, '任务标题', 120, true);
      const description = text(b.description ?? existing.description, '任务描述', 4000);
      const status = b.status ?? existing.status, priority = b.priority ?? existing.priority;
      if (!STATUSES.includes(status) || !PRIORITIES.includes(priority)) throw new ApiError(400, '任务状态或优先级不正确');
      const completedAt = status === 'done' ? (existing.status === 'done' ? existing.completed_at : new Date().toISOString()) : null;
      const result = await db.prepare('UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?, updated_at = ?, completed_at = ?, version = version + 1 WHERE id = ? AND version = ?').bind(title, description, status, priority, new Date().toISOString(), completedAt, id, b.version).run();
      if (!result.meta.changes) throw new ApiError(409, '任务刚刚被更新，请刷新后重试');
      return json(taskRow(await db.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first()));
    }
    throw new ApiError(404, '接口不存在');
  } catch (error) {
    if (!(error instanceof ApiError)) console.error('API error:', error.message);
    return json({ error: error instanceof ApiError ? error.message : '保存暂时失败，请稍后重试' }, error.status ?? 500);
  }
}
