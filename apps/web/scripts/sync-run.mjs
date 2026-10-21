import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.cwd());
const src = join(root, '../../runs/latest.json');
const destDir = join(root, 'public/runs');
const dest = join(destDir, 'latest.json');

await mkdir(destDir, { recursive: true });
if (existsSync(src)) {
  await copyFile(src, dest);
  console.log('synced runs/latest.json');
} else {
  console.warn('no runs/latest.json yet — run `pnpm fetch && pnpm pipeline` first');
}
