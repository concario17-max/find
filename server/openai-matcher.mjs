import fs from 'node:fs/promises';
import path from 'node:path';

const INDEX_RELATIVE_PATH = 'data/index.json';
const MODEL = process.env.OPENAI_MATCH_MODEL || 'gpt-5.4';
const MAX_SHORTLIST = 8;
const MAX_FINAL_MATCHES = 5;

const queryProfileSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    likely_group: { type: 'string' },
    search_query: { type: 'string' },
    keywords: { type: 'array', items: { type: 'string' } },
    visible_text: { type: 'array', items: { type: 'string' } },
    observed_colors: { type: 'array', items: { type: 'string' } },
    shape: { type: 'string' },
    material: { type: 'string' },
    confidence: { type: 'number' },
  },
  required: ['likely_group', 'search_query', 'keywords', 'visible_text', 'observed_colors', 'shape', 'material', 'confidence'],
};

const rerankSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    best_match_id: { type: 'string' },
    best_match_reason: { type: 'string' },
    confidence: { type: 'number' },
    matches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          score: { type: 'number' },
          reason: { type: 'string' },
          signals: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'score', 'reason', 'signals'],
      },
    },
  },
  required: ['best_match_id', 'best_match_reason', 'confidence', 'matches'],
};

const indexCache = {
  mtimeMs: 0,
  data: null,
};

const imageCache = new Map();

export async function matchItemPhoto({ projectRoot, payload }) {
  const index = await loadIndex(projectRoot);
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return buildErrorResponse(index, 'OPENAI_API_KEY_MISSING', 'OPENAI_API_KEY가 설정되지 않았어.');
  }

  const imageDataUrl = normalizeImageDataUrl(payload?.imageDataUrl);
  if (!imageDataUrl) {
    return buildErrorResponse(index, 'INVALID_INPUT', 'imageDataUrl이 필요해.');
  }

  const startedAt = Date.now();
  let queryProfile;
  let shortlist;
  let shortlistWithImages;
  let finalMatches;

  try {
    queryProfile = await describeQueryPhoto(apiKey, imageDataUrl, payload?.fileName || 'upload');
    shortlist = buildShortlist(index.items, queryProfile, Math.max(4, Number(payload?.shortlistSize) || MAX_SHORTLIST));
    shortlistWithImages = await Promise.all(shortlist.map(async (candidate) => ({
      ...candidate,
      imageDataUrl: candidate.primaryImagePath
        ? await readImageDataUrl(projectRoot, candidate.primaryImagePath).catch(() => '')
        : '',
    })));
    finalMatches = await rerankCandidates(apiKey, imageDataUrl, shortlistWithImages);
  } catch (error) {
    const response = buildErrorResponse(index, 'OPENAI_API_ERROR', 'OpenAI 호출에 실패했어.');
    response.meta.elapsedMs = Date.now() - startedAt;
    return response;
  }

  return {
    ok: true,
    model: MODEL,
    elapsedMs: Date.now() - startedAt,
    queryProfile,
    shortlist: shortlistWithImages.map(toClientCandidate),
    matches: finalMatches,
    meta: {
      items: index.items.length,
      groups: index.groupSummary.length,
      generatedAt: index.generatedAt,
    },
  };
}

function buildErrorResponse(index, code, message) {
  return {
    ok: false,
    error: { code, message },
    meta: {
      model: MODEL,
      items: index.items.length,
      groups: index.groupSummary.length,
      generatedAt: index.generatedAt,
    },
  };
}

async function loadIndex(projectRoot) {
  const absolutePath = path.join(projectRoot, INDEX_RELATIVE_PATH);
  const stat = await fs.stat(absolutePath);
  if (indexCache.data && indexCache.mtimeMs === stat.mtimeMs) {
    return indexCache.data;
  }

  const raw = await fs.readFile(absolutePath, 'utf8');
  const parsed = JSON.parse(raw);
  const items = Array.isArray(parsed.items) ? parsed.items.map(normalizeItem).filter(Boolean) : [];
  const groupSummary = Array.isArray(parsed.groupSummary) ? parsed.groupSummary : [];
  const data = {
    generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : '',
    groupSummary,
    items,
  };

  indexCache.data = data;
  indexCache.mtimeMs = stat.mtimeMs;
  return data;
}

function normalizeItem(item) {
  if (!item || typeof item !== 'object') return null;
  return {
    id: String(item.id || ''),
    group: String(item.group || ''),
    number: Number(item.number || 0),
    title: String(item.title || ''),
    description: String(item.description || ''),
    imagePaths: Array.isArray(item.imagePaths) ? item.imagePaths.map((value) => String(value)).filter(Boolean) : [],
    primaryImagePath: String(item.primaryImagePath || ''),
    sheetName: String(item.sheetName || ''),
    sourceFile: String(item.sourceFile || ''),
    searchText: String(item.searchText || ''),
  };
}

async function describeQueryPhoto(apiKey, imageDataUrl, fileName) {
  const response = await callResponsesApi(apiKey, {
    model: MODEL,
    max_output_tokens: 300,
    text: {
      format: {
        type: 'json_schema',
        name: 'query_profile',
        schema: queryProfileSchema,
        strict: true,
      },
    },
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text:
              '이 이미지를 보고 물건 식별에 도움이 되는 검색 프로필을 만들어줘. 브랜드명, 라벨, 형태, 색, 재질, 보이는 텍스트를 최대한 잡아서 JSON만 출력해.',
          },
          {
            type: 'input_text',
            text: `파일명: ${fileName}`,
          },
          {
            type: 'input_image',
            image_url: imageDataUrl,
          },
        ],
      },
    ],
  });

  return parseStructuredJson(response, 'query_profile');
}

async function rerankCandidates(apiKey, imageDataUrl, shortlist) {
  const userContent = [
    {
      type: 'input_text',
      text:
        '이 사진과 후보 참조 이미지를 비교해서 가장 비슷한 물건을 골라줘. 후보는 1개만 고르지 말고 상위 후보도 함께 점수화해. JSON만 출력해.',
    },
    {
      type: 'input_image',
      image_url: imageDataUrl,
    },
  ];

  shortlist.forEach((candidate, index) => {
    userContent.push({
      type: 'input_text',
      text: [
        `후보 ${index + 1}`,
        `id: ${candidate.id}`,
        `group: ${candidate.group}`,
        `title: ${candidate.title}`,
        candidate.description ? `description: ${candidate.description}` : '',
        candidate.sheetName ? `sheet: ${candidate.sheetName}` : '',
        candidate.searchText ? `searchText: ${candidate.searchText}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    });

    if (candidate.imageDataUrl) {
      userContent.push({
        type: 'input_image',
        image_url: candidate.imageDataUrl,
      });
    }
  });

  const response = await callResponsesApi(apiKey, {
    model: MODEL,
    max_output_tokens: 500,
    text: {
      format: {
        type: 'json_schema',
        name: 'rerank_candidates',
        schema: rerankSchema,
        strict: true,
      },
    },
    input: [
      {
        role: 'user',
        content: userContent,
      },
    ],
  });

  const parsed = parseStructuredJson(response, 'rerank_candidates');
  const byId = new Map(shortlist.map((candidate) => [candidate.id, candidate]));

  return parsed.matches
    .slice(0, MAX_FINAL_MATCHES)
    .map((entry) => {
      const candidate = byId.get(entry.id);
      if (!candidate) {
        return null;
      }

      return {
        ...toClientCandidate(candidate),
        score: clamp(entry.score, 0, 100),
        reason: String(entry.reason || ''),
        signals: Array.isArray(entry.signals) ? entry.signals.map((signal) => String(signal)).filter(Boolean) : [],
      };
    })
    .filter(Boolean);
}

async function callResponsesApi(apiKey, body) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API 오류: ${response.status}`);
  }

  return response.json();
}

function parseStructuredJson(response, label) {
  const text = extractOutputText(response);
  if (!text) {
    throw new Error(`${label} 응답이 비어 있어.`);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} JSON 파싱 실패: ${error.message}`);
  }
}

function extractOutputText(response) {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const chunks = [];
  for (const output of response.output || []) {
    for (const content of output.content || []) {
      if (content.type === 'output_text' || content.type === 'text') {
        chunks.push(String(content.text || content.value || ''));
      }
    }
  }

  return chunks.join('').trim();
}

function buildShortlist(items, queryProfile, limit) {
  const queryTerms = tokenize([
    queryProfile.search_query,
    ...(Array.isArray(queryProfile.keywords) ? queryProfile.keywords : []),
    ...(Array.isArray(queryProfile.visible_text) ? queryProfile.visible_text : []),
    ...(Array.isArray(queryProfile.observed_colors) ? queryProfile.observed_colors : []),
    queryProfile.shape,
    queryProfile.material,
    queryProfile.likely_group,
  ].join(' '));

  const scored = items.map((item) => ({
    ...item,
    score: scoreItem(item, queryTerms, queryProfile),
  }));

  const sorted = scored.sort((a, b) => b.score - a.score);
  const shortlist = [];
  const seenIds = new Set();

  for (const item of sorted) {
    if (shortlist.length >= limit) break;
    if (seenIds.has(item.id)) continue;
    shortlist.push(item);
    seenIds.add(item.id);
  }

  for (const item of sorted) {
    if (shortlist.length >= limit) break;
    if (!item.group || seenIds.has(item.id)) continue;
    if (shortlist.some((candidate) => candidate.group === item.group)) continue;
    shortlist.push(item);
    seenIds.add(item.id);
  }

  return shortlist.slice(0, limit);
}

function scoreItem(item, queryTerms, queryProfile) {
  const itemTokens = tokenize([
    item.id,
    item.group,
    item.title,
    item.description,
    item.searchText,
    item.sheetName,
    item.sourceFile,
  ].join(' '));

  let overlap = 0;
  const tokenSet = new Set(itemTokens);
  for (const token of queryTerms) {
    if (tokenSet.has(token)) {
      overlap += 1;
    }
  }

  let score = overlap * 12;
  if (queryProfile.likely_group && normalizeGroup(queryProfile.likely_group) === normalizeGroup(item.group)) {
    score += 18;
  }

  if (queryProfile.search_query) {
    score += textSimilarity(queryProfile.search_query, item.searchText) * 0.5;
  }

  if (queryProfile.visible_text?.length) {
    score += textSimilarity(queryProfile.visible_text.join(' '), item.searchText) * 0.25;
  }

  if (queryProfile.keywords?.length) {
    score += textSimilarity(queryProfile.keywords.join(' '), item.searchText) * 0.25;
  }

  return score;
}

function toClientCandidate(candidate) {
  return {
    id: candidate.id,
    group: candidate.group,
    number: candidate.number,
    title: candidate.title,
    description: candidate.description,
    sheetName: candidate.sheetName,
    sourceFile: candidate.sourceFile,
    imagePaths: candidate.imagePaths,
    primaryImagePath: candidate.primaryImagePath,
    score: candidate.score || 0,
  };
}

async function readImageDataUrl(projectRoot, relativePath) {
  const cacheKey = relativePath;
  if (imageCache.has(cacheKey)) {
    return imageCache.get(cacheKey);
  }

  const absolutePath = resolveProjectPath(projectRoot, relativePath);
  const bytes = await fs.readFile(absolutePath);
  const mimeType = getMimeType(absolutePath);
  const dataUrl = `data:${mimeType};base64,${bytes.toString('base64')}`;
  imageCache.set(cacheKey, dataUrl);
  return dataUrl;
}

function normalizeImageDataUrl(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.startsWith('data:image/') ? trimmed : '';
}

function resolveProjectPath(projectRoot, relativePath) {
  const normalized = String(relativePath || '').replace(/^\/+/, '');
  const root = path.resolve(projectRoot);
  const target = path.resolve(root, normalized.split('/').join(path.sep));
  const rootWithSep = `${root}${path.sep}`;
  if (target !== root && !target.startsWith(rootWithSep)) {
    throw new Error('Invalid image path.');
  }
  return target;
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[_/\\|()[\]{}.,:;"'`~!?=+-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function textSimilarity(left, right) {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (!leftTokens.size || !rightTokens.size) return 0;

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return (overlap / Math.max(leftTokens.size, rightTokens.size)) * 100;
}

function normalizeGroup(value) {
  return String(value || '').toLowerCase().trim();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
