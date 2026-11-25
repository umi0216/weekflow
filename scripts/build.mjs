import { readFile, mkdir, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
const assets = {};
for (const [route, [file, type]] of Object.entries(files)) assets[route] = { body: await readFile(new URL('public/' + file, root), 'utf8'), type };
const source = await readFile(new URL('worker/api.mjs', root), 'utf8');
const worker = source.replace('export async function api', 'async function api') + '\nconst assets = ' + JSON.stringify(assets) + `;
export default { async fetch(request, env) {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) return api(request, env);
  const asset = assets[url.pathname];
  if (!asset) return new Response('Not found', {status:404});
  if (!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed', {status:405});
  return new Response(request.method === 'HEAD' ? null : asset.body, {headers: {
    'Content-Type':asset.type,
    'Cache-Control':'no-cache',
    'X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'same-origin',
    'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'"
  }});
}};
`;
await mkdir(new URL('dist/server/', root), { recursive: true });
await mkdir(new URL('dist/.openai/', root), { recursive: true });
await writeFile(new URL('dist/server/index.js', root), worker);
await writeFile(new URL('dist/.openai/hosting.json', root), await readFile(new URL('.openai/hosting.json', root)));
console.log('Worker built, including frontend assets.');
