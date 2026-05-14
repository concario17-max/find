import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(rootDir, '.env.local');
const rl = readline.createInterface({ input, output });

try {
  const existing = await readExistingEnv();
  const currentKey = existing.OPENAI_API_KEY || '';
  const currentModel = existing.OPENAI_MATCH_MODEL || 'gpt-5.4';

  const rawKey = await promptKey(currentKey);
  const key = normalizeKey(rawKey) || normalizeKey(currentKey);
  if (!key) {
    throw new Error('OPENAI_API_KEY가 비어 있어.');
  }

  const rawModel = await promptModel(currentModel);
  const model = normalizeModel(rawModel) || normalizeModel(currentModel);
  const content = [
    `OPENAI_API_KEY=${key}`,
    `OPENAI_MATCH_MODEL=${model}`,
  ].join('\n');

  await fs.writeFile(envPath, `${content}\n`, 'utf8');

  output.write(`\n완료: ${path.relative(rootDir, envPath)} 저장됨\n`);
  output.write('이제 dev 서버를 다시 켜면 바로 읽힌다.\n');
} finally {
  rl.close();
}

async function readExistingEnv() {
  try {
    const raw = await fs.readFile(envPath, 'utf8');
    return parseEnv(raw);
  } catch {
    return {};
  }
}

async function promptKey(currentKey) {
  const suffix = currentKey ? ' [기존값 유지하려면 엔터]' : '';
  return rl.question(`OPENAI API 키를 입력해${suffix}: `);
}

async function promptModel(currentModel) {
  const answer = await rl.question(`모델명 입력 [기본 ${currentModel}]: `);
  return answer.trim() || currentModel;
}

function normalizeKey(value) {
  return String(value || '').trim().replace(/^["']|["']$/g, '');
}

function normalizeModel(value) {
  const model = String(value || '').trim();
  return model || 'gpt-5.4';
}

function parseEnv(text) {
  const env = {};
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return env;
}
