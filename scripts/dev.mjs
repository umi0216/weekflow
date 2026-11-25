import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { api } from '../worker/api.mjs';
import { database } from './database.mjs';
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
const DB = database(fileURLToPath(new URL('../.runtime/team.sqlite', import.meta.url)));
const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      const chunks = []; let size = 0;
      for await (const c of req) { size += c.length; if (size > 22000) { res.writeHead(413); res.end(); return; } chunks.push(c); }
      const request = new Request(url, { method: req.method, headers: req.headers, ...(!['GET', 'HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {}) });
      const response = await api(request, { DB });
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
    }
    const file = files[url.pathname];
    if (!file) { res.writeHead(404); res.end('Not found'); return; }
    const content = await readFile(new URL('../public/' + file[0], import.meta.url));
    res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-cache' }); res.end(content);
  } catch (error) { console.error(error); res.writeHead(500); res.end('Server error'); }
});
server.listen(port, host, () => console.log(`同频已启动: http://${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { DB.close(); process.exit(0); }));
