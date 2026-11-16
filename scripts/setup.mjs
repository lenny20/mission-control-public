// Portable bootstrap: can run before node_modules exists. Never resets local data.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error('Install Node.js 24 or newer, then run this command again.');
  process.exit(1);
}
for (const args of [['ci'], ['run', 'build'], ['run', 'doctor']]) {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    cwd: root, stdio: 'inherit', shell: process.platform === 'win32',
  });
  if (result.error || result.status !== 0) {
    console.error('Setup stopped. Your saved records have not been reset.');
    process.exit(result.status || 1);
  }
}
console.log('Setup complete. Run npm start in this folder, then open http://127.0.0.1:4747.');
console.log('Windows: you can also double-click Start Mission Control.cmd. Mac: use Start Mission Control.command.');
