import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { paths } from './config.ts';
import { UserError } from './errors.ts';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic']);

function hashFile(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16);
}

function checkImage(file: string): string {
  if (!existsSync(file)) throw new UserError(`No file at ${file}`);
  const ext = path.extname(file).toLowerCase();
  if (!IMAGE_EXTS.has(ext)) throw new UserError(`${path.basename(file)} isn't an image this dashboard can store (jpg, png, webp or heic).`);
  return ext === '.jpeg' ? '.jpg' : ext;
}

/**
 * Copy an image into the data folder under a content hash, so the same
 * screenshot sent twice is stored once. Returns the path relative to the files folder.
 */
export function storeImage(file: string, kind: 'sources' | 'photos', prefix = ''): string {
  const ext = checkImage(file);
  const dir = kind === 'sources' ? paths.sources : paths.photos;
  mkdirSync(dir, { recursive: true });
  const name = `${prefix}${hashFile(file)}${ext}`;
  const dest = path.join(dir, name);
  if (!existsSync(dest)) copyFileSync(file, dest);
  return `${kind}/${name}`;
}

export function fileUrl(relative: string | null): string | null {
  return relative ? `/files/${relative}` : null;
}

/** Width and height from a JPEG or PNG header; null for anything else. */
export function imageSize(file: string): { width: number; height: number } | null {
  const buf = readFileSync(file);
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1]!;
      const len = buf.readUInt16BE(i + 2);
      // SOF0..SOF15, excluding DHT (C4), JPG (C8) and DAC (CC)
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}
