import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(rootDir, '.env.local');
const devVarsFile = path.join(rootDir, '.dev.vars');

const pushSecret = process.argv.includes('--push-secret');
const deploy = process.argv.includes('--deploy');

async function main() {
  const env = await readDotenv(envFile);
  const apiKey = env.OPENAI_API_KEY?.trim();
  const model = env.OPENAI_MATCH_MODEL?.trim();

  if (!apiKey) {
    throw new Error('.env.local is missing required OPENAI_API_KEY.');
  }

  const devVars = {
    OPENAI_API_KEY: apiKey,
  };

  if (model) {
    devVars.OPENAI_MATCH_MODEL = model;
  }

  await fs.writeFile(devVarsFile, formatDotenv(devVars), 'utf8');
  console.log(`wrote ${path.relative(rootDir, devVarsFile).split(path.sep).join('/')}`);

  if (pushSecret) {
    await runWranglerSecretPut('OPENAI_API_KEY', apiKey);
    console.log('updated Cloudflare secret OPENAI_API_KEY');
  }

  if (deploy) {
    await runWranglerDeploy(model || 'gpt-5.4');
  }
}

async function readDotenv(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  const result = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex < 0) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

function formatDotenv(entries) {
  return `${Object.entries(entries)
    .map(([key, value]) => `${key}=${escapeDotenvValue(value)}`)
    .join('\n')}\n`;
}

function escapeDotenvValue(value) {
  const text = String(value);
  if (/[\s#"'=]/.test(text)) {
    return JSON.stringify(text);
  }
  return text;
}

function runWranglerSecretPut(name, value) {
  return new Promise((resolve, reject) => {
    const child = spawn('wrangler', ['secret', 'put', name], {
      cwd: rootDir,
      stdio: ['pipe', 'inherit', 'inherit'],
      shell: process.platform === 'win32',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`wrangler secret put exited with code ${code}`));
    });

    child.stdin.end(`${value}\n`);
  });
}

function runWranglerDeploy(model) {
  return new Promise((resolve, reject) => {
    const child = spawn('wrangler', ['deploy', '--var', `OPENAI_MATCH_MODEL=${model}`], {
      cwd: rootDir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`wrangler deploy exited with code ${code}`));
    });
  });
}

main().catch((error) => {
  console.error(`FATAL sync-cloudflare-env failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
