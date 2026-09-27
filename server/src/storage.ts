import { mkdir, open, unlink, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
export interface Storage {
  put(key: string, bytes: Uint8Array): Promise<void>;
  read(key: string): Promise<Readable>;
  remove(key: string): Promise<void>;
}
/** Only this concrete local implementation is currently supported. */
export class LocalStorage implements Storage {
  constructor(private root: string) { this.root = resolve(root); }
  private path(key: string) {
    if (!/^[a-f0-9-]{36}\.(png|jpg|webp|pdf|txt)$/.test(key)) throw new Error('Invalid storage key');
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep)) throw new Error('Invalid storage path');
    return path;
  }
  async put(key: string, bytes: Uint8Array) {
    await mkdir(this.root, { recursive: true });
    const file = await open(this.path(key), 'wx', 0o600);
    try { await file.writeFile(bytes); } finally { await file.close(); }
  }
  async read(key: string) { const path = this.path(key); await stat(path); return createReadStream(path); }
  async remove(key: string) { await unlink(this.path(key)); }
}
