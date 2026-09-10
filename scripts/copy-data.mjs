// tsc only emits JavaScript, so the generated geo reference data has to be
// copied into dist next to the compiled services that read it.
import { cpSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(projectRoot, 'src', 'data');
const target = join(projectRoot, 'dist', 'data');

if (!existsSync(source)) {
  console.error('src/data is missing — run "npm run build:geo" first');
  process.exit(1);
}

cpSync(source, target, { recursive: true });
console.log(`✓ copied geo data to ${target}`);
