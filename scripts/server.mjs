import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { api } from '../worker/api.mjs';

const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/lan.js': ['lan.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml']
};
export function createHandler({ DB, lan }) {
  return async (req, res) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    req.once('aborted', abort); res.once('close', abort);
    try {
      const protocol = req.socket.encrypted ? 'https' : 'http';
      const url = new URL(req.url, `${protocol}://${req.headers.host}`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'same-origin');
      if (url.pathname.startsWith('/api/')) {
        let body;
        if (!['GET', 'HEAD'].includes(req.method)) {
          if (url.pathname.startsWith('/api/lan/')) body = Readable.toWeb(req);
          else {
            const chunks = []; let size = 0;
            for await (const chunk of req) {
              size += chunk.length;
              if (size > 22000) { res.writeHead(413); res.end(); return; }
              chunks.push(chunk);
            }
            body = Buffer.concat(chunks);
          }
        }
        const request = new Request(url, { method: req.method, headers: req.headers, signal: controller.signal, ...(body ? { body, duplex: 'half' } : {}) });
        const response = url.pathname.startsWith('/api/lan/') ? await lan.handle(request, { address: req.socket.remoteAddress }) : await api(request, { DB });
        res.writeHead(response.status, Object.fromEntries(response.headers));
        if (response.body) await pipeline(Readable.fromWeb(response.body), res);
        else res.end();
        return;
      }
      const file = files[url.pathname];
      if (!file) { res.writeHead(404); res.end('Not found'); return; }
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
      const content = await readFile(new URL('../public/' + file[0], import.meta.url));
      res.writeHead(200, {
        'Content-Type': file[1], 'Cache-Control': 'no-cache',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'"
      });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (controller.signal.aborted || res.destroyed) return;
      console.error(error);
      if (!res.headersSent) res.writeHead(500);
      res.end('Server error');
    } finally { req.off('aborted', abort); res.off('close', abort); }
  };
}
