import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { database } from './database.mjs';
import { createLan } from './lan.mjs';
import { createHandler } from './server.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const secure = process.argv.includes('--https') || Boolean(process.env.TLS_CERT || process.env.TLS_KEY);
let tls;
if (secure) {
  try {
    tls = {
      cert: await readFile(process.env.TLS_CERT || resolve(root, '.runtime/certs/server.crt')),
      key: await readFile(process.env.TLS_KEY || resolve(root, '.runtime/certs/server.key'))
    };
  } catch { console.error('未找到 HTTPS 证书。先运行 npm run cert -- 服务器的局域网IP，或设置 TLS_CERT 和 TLS_KEY。'); process.exit(1); }
}
const port = Number(process.env.PORT || 4173), host = process.env.HOST || '127.0.0.1';
const DB = database(process.env.DB_PATH || resolve(root, '.runtime/team.sqlite'));
const lan = createLan({ DB, filesDirectory: process.env.FILES_DIR || resolve(root, '.runtime/files') });
const handler = createHandler({ DB, lan });
const server = secure ? createSecureServer(tls, handler) : createServer(handler);
// Large uploads stream to disk; slow or interrupted transfers never create a message.
server.requestTimeout = 10 * 60 * 1000;
server.listen(port, host, () => console.log(`同频已启动: ${secure ? 'https' : 'http'}://${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  lan.close();
  server.close(() => { DB.close(); process.exit(0); });
  server.closeAllConnections();
});
