import { spawnSync } from 'node:child_process';
import { networkInterfaces, hostname } from 'node:os';
import { isIP } from 'node:net';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const directory = process.env.CERT_DIR ? path.resolve(process.env.CERT_DIR) : fileURLToPath(new URL('../.runtime/certs/', import.meta.url));
const requested = process.argv.slice(2);
if (requested.some(ip => !isIP(ip))) { console.error('参数应为服务器的局域网 IP，例如 npm run cert -- 192.168.1.23'); process.exit(1); }
const addresses = new Set(['127.0.0.1', '::1', ...requested]);
for (const list of Object.values(networkInterfaces())) for (const address of list || []) if (!address.internal && !address.address.includes('%')) addresses.add(address.address);
await mkdir(directory, { recursive: true, mode: 0o700 });
const exists = async name => access(path.join(directory, name)).then(() => true, () => false);
const run = args => {
  const result = spawnSync('openssl', args, { cwd: directory, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(result.error?.code === 'ENOENT' ? '请先安装 OpenSSL。' : result.stderr || '证书生成失败');
};
try {
  const caKey = await exists('lan-ca.key'), caCert = await exists('lan-ca.crt');
  if (caKey !== caCert) throw new Error('CA 文件不完整，请恢复原有 lan-ca.key 和 lan-ca.crt，避免覆盖已信任的 CA。');
  if (!caKey) run(['req', '-x509', '-newkey', 'rsa:3072', '-nodes', '-keyout', 'lan-ca.key', '-out', 'lan-ca.crt', '-days', '3650', '-subj', '/CN=Weekflow LAN CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
  const names = ['DNS:localhost'];
  if (/^[a-zA-Z0-9.-]+$/.test(hostname())) names.push('DNS:' + hostname());
  names.push(...[...addresses].map(ip => 'IP:' + ip));
  await writeFile(path.join(directory, 'server.ext'), `subjectAltName=${names.join(',')}\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n`, { mode: 0o600 });
  run(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=Weekflow LAN']);
  run(['x509', '-req', '-in', 'server.csr', '-CA', 'lan-ca.crt', '-CAkey', 'lan-ca.key', '-CAcreateserial', '-out', 'server.crt', '-days', '365', '-extfile', 'server.ext']);
  // Ensure private keys remain owner-readable on platforms with POSIX permissions.
  const { chmod } = await import('node:fs/promises');
  await chmod(path.join(directory, 'lan-ca.key'), 0o600); await chmod(path.join(directory, 'server.key'), 0o600);
  await readFile(path.join(directory, 'server.crt'));
  console.log(`证书已生成: ${directory}\n在使用设备上将 lan-ca.crt 导入受信任的根证书，然后运行 HOST=0.0.0.0 npm run dev:https。\n只分发 lan-ca.crt；两个 .key 文件留在服务器。`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
