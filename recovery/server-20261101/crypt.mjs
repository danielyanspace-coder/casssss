// Node.js 20+. Key file contains 64 hexadecimal characters (32 random bytes).
// Format: CASSBACKUP1\n | 12-byte nonce | ciphertext | 16-byte GCM tag.
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, open, stat, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
const [action, input, output, keyFile] = process.argv.slice(2);
if (!['encrypt', 'decrypt'].includes(action) || !keyFile) {
  console.error('Usage: node crypt.mjs encrypt|decrypt INPUT OUTPUT KEY_FILE');
  process.exit(2);
}
const hex = (await readFile(keyFile, 'utf8')).trim();
if (!/^[a-f0-9]{64}$/i.test(hex)) throw new Error('Expected a 256-bit hexadecimal recovery key');
const key = Buffer.from(hex, 'hex');
const magic = Buffer.from('CASSBACKUP1\n');
let created = false;
try {
  if (action === 'encrypt') {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(magic);
    const handle = await open(output, 'wx', 0o600); created = true;
    try { await handle.write(Buffer.concat([magic, nonce])); } finally { await handle.close(); }
    await pipeline(createReadStream(input), cipher, createWriteStream(output, { flags: 'a' }));
    const tail = await open(output, 'a');
    try { await tail.write(cipher.getAuthTag()); } finally { await tail.close(); }
  } else {
    const size = (await stat(input)).size;
    const offset = magic.length + 12;
    if (size < offset + 16) throw new Error('Truncated backup');
    const handle = await open(input, 'r');
    const header = Buffer.alloc(offset), tag = Buffer.alloc(16);
    try {
      await handle.read(header, 0, offset, 0);
      await handle.read(tag, 0, 16, size - 16);
    } finally { await handle.close(); }
    if (!header.subarray(0, magic.length).equals(magic)) throw new Error('Unsupported backup format');
    const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(magic.length));
    decipher.setAAD(magic); decipher.setAuthTag(tag);
    const handleOut = await open(output, 'wx', 0o600); created = true; await handleOut.close();
    await pipeline(createReadStream(input, { start: offset, end: size - 17 }), decipher,
      createWriteStream(output, { flags: 'r+' }));
  }
} catch (error) {
  if (created) await unlink(output).catch(() => {});
  throw error;
} finally { key.fill(0); }
const hash = createHash('sha256');
for await (const chunk of createReadStream(output)) hash.update(chunk);
console.log(`${hash.digest('hex')}  ${output}`);
