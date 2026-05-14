import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(rootDir, 'dist');
const dataDir = path.join(rootDir, 'data');
const imagesDir = path.join(rootDir, 'images');

async function main() {
  await fs.mkdir(distDir, { recursive: true });
  await copyIfExists(dataDir, path.join(distDir, 'data'));
  await copyIfExists(imagesDir, path.join(distDir, 'images'));
  console.log('copied Cloudflare static assets into dist/');
}

async function copyIfExists(source, destination) {
  try {
    await fs.access(source);
  } catch {
    return;
  }

  await fs.cp(source, destination, { recursive: true });
}

main().catch((error) => {
  console.error(`FATAL copy-cloudflare-assets failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
