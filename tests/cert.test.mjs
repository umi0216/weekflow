import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { X509Certificate, createPrivateKey } from 'node:crypto';
import { fileURLToPath } from 'node:url';

test('LAN certificates cover supplied IPs, match the key and reuse the trusted CA', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'weekflow-cert-test-'));
  try {
    const generate = address => spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/cert.mjs', import.meta.url)), address], { encoding: 'utf8', env: { ...process.env, CERT_DIR: directory } });
    const result = generate('192.168.50.10'); assert.equal(result.status, 0, result.stderr);
    const originalCA = await readFile(path.join(directory, 'lan-ca.crt'));
    const ca = new X509Certificate(originalCA), certificate = new X509Certificate(await readFile(path.join(directory, 'server.crt')));
    assert.equal(ca.ca, true); assert.equal(certificate.ca, false);
    assert.equal(certificate.checkIP('192.168.50.10'), '192.168.50.10');
    assert.equal(certificate.checkIP('127.0.0.1'), '127.0.0.1'); assert.equal(certificate.checkHost('localhost'), 'localhost');
    assert.equal(certificate.verify(ca.publicKey), true);
    assert.equal(certificate.checkPrivateKey(createPrivateKey(await readFile(path.join(directory, 'server.key')))), true);
    assert.equal(generate('192.168.50.11').status, 0);
    assert.deepEqual(await readFile(path.join(directory, 'lan-ca.crt')), originalCA);
    assert.equal(generate('bad;hostname').status, 1);
    if (process.platform !== 'win32') assert.equal((await stat(path.join(directory, 'lan-ca.key'))).mode & 0o777, 0o600);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
