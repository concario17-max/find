const DEFAULT_MODEL = 'gpt-5.4';
const MAX_SHORTLIST = 8;
const MAX_FINAL_MATCHES = 5;
const RERANK_IMAGE_LIMIT = 3;
const OPENAI_RETRY_LIMIT = 3;

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

let indexCache = null;
let indexCachePromise = null;
const imageCache = new Map();

export async function matchItemPhoto({ env, payload, requestUrl }) {
  const model = env.OPENAI_MATCH_MODEL || DEFAULT_MODEL;
  const index = await loadIndex(env, requestUrl);
  const apiKey = env.OPENAI_API_KEY;

  if (!apiKey) {
    return buildErrorResponse(index, model, 'OPENAI_API_KEY_MISSING', 'OPENAI_API_KEY is not configured.');
  }

  const imageDataUrl = normalizeImageDataUrl(payload?.imageDataUrl);
  if (!imageDataUrl) {
    return buildErrorResponse(index, model, 'INVALID_INPUT', 'imageDataUrl is required.');
  }

  const startedAt = Date.now();
  let queryProfile;
  let shortlist;
  let shortlistWithImages;

  try {
    queryProfile = await describeQueryPhoto(apiKey, model, imageDataUrl, payload?.fileName || 'upload');
    shortlist = buildShortlist(index.items, queryProfile, Math.max(4, Number(payload?.shortlistSize) || MAX_SHORTLIST));
    shortlistWithImages = await Promise.all(
      shortlist.map(async (candidate, index) => ({
        ...candidate,
        imageDataUrl:
          index < RERANK_IMAGE_LIMIT && candidate.primaryImagePath
            ? await readImageDataUrl(env, requestUrl, candidate.primaryImagePath).catch(() => '')
            : '',
      })),
    );
  } catch (error) {
    const response = buildErrorResponse(index, model, 'OPENAI_API_ERROR', 'OpenAI request failed.');
    response.meta.elapsedMs = Date.now() - startedAt;
    return response;
  }

  try {
    const finalMatches = await rerankCandidates(apiKey, model, imageDataUrl, shortlistWithImages);

    return {
      ok: true,
      model,
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
  } catch (error) {
    return buildFallbackResponse(index, model, startedAt, queryProfile, shortlistWithImages, {
      code: 'OPENAI_RERANK_FALLBACK',
      message: 'OpenAI rerank failed; returning shortlist fallback.',
    });
  }
}

function buildErrorResponse(index, model, code, message) {
  return {
    ok: false,
    error: { code, message },
    meta: {
      model,
      items: index.items.length,
      groups: index.groupSummary.length,
      generatedAt: index.generatedAt,
    },
  };
}

function buildFallbackResponse(index, model, startedAt, queryProfile, shortlist, warning) {
  const fallbackMatches = shortlist.slice(0, MAX_FINAL_MATCHES).map((candidate) => ({
    ...toClientCandidate(candidate),
    reason: 'Rerank failed; returning shortlist fallback.',
    signals: ['fallback'],
  }));

  return {
    ok: true,
    fallback: true,
    warning,
    model,
    elapsedMs: Date.now() - startedAt,
    queryProfile,
    shortlist: shortlist.map(toClientCandidate),
    matches: fallbackMatches,
    meta: {
      items: index.items.length,
      groups: index.groupSummary.length,
      generatedAt: index.generatedAt,
      fallback: true,
      warning,
    },
  };
}

async function loadIndex(env, requestUrl) {
  if (indexCache) {
    return indexCache;
  }

  if (!indexCachePromise) {
    indexCachePromise = (async () => {
      const response = await env.ASSETS.fetch(new URL('/data/index.json', requestUrl));
      if (!response.ok) {
        throw new Error(`Failed to load index.json: ${response.status}`);
      }

      const parsed = await response.json();
      const items = Array.isArray(parsed.items) ? parsed.items.map(normalizeItem).filter(Boolean) : [];
      const groupSummary = Array.isArray(parsed.groupSummary) ? parsed.groupSummary : [];
      return {
        generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : '',
        groupSummary,
        items,
      };
    })().then(
      (data) => {
        indexCache = data;
        return data;
      },
      (error) => {
        indexCachePromise = null;
        throw error;
      },
    );
  }

  return indexCachePromise;
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

async function describeQueryPhoto(apiKey, model, imageDataUrl, fileName) {
  const response = await callResponsesApi(apiKey, {
    model,
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
            text: 'Look at the image and produce a compact query profile for item matching. Return JSON only.',
          },
          {
            type: 'input_text',
            text: `file name: ${fileName}`,
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

async function rerankCandidates(apiKey, model, imageDataUrl, shortlist) {
  const userContent = [
    {
      type: 'input_text',
      text: 'Compare the query image against the candidate images and choose the best overall match. Return JSON only.',
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
        `candidate ${index + 1}`,
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
    model,
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
  let lastError;

  for (let attempt = 1; attempt <= OPENAI_RETRY_LIMIT; attempt += 1) {
    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = new Error(`OpenAI API error: ${response.status}`);
        error.status = response.status;
        error.retryAfter = response.headers.get('retry-after');
        throw error;
      }

      return response.json();
    } catch (error) {
      lastError = error;
      if (attempt >= OPENAI_RETRY_LIMIT || !isRetryableOpenAIError(error)) {
        break;
      }

      await sleep(getOpenAIRetryDelayMs(error, attempt));
    }
  }

  throw lastError;
}

function isRetryableOpenAIError(error) {
  if (!error) return false;

  if (typeof error.status === 'number' && isRetryableOpenAIStatus(error.status)) {
    return true;
  }

  return error.name === 'TypeError' || error.name === 'AbortError' || /fetch|network/i.test(String(error.message || ''));
}

function isRetryableOpenAIStatus(status) {
  return status === 429 || status >= 500;
}

function getOpenAIRetryDelayMs(error, attempt) {
  const retryAfter = parseRetryAfterMs(error?.retryAfter);
  if (retryAfter !== null) {
    return retryAfter;
  }

  return 250 * (2 ** (attempt - 1));
}

function parseRetryAfterMs(value) {
  if (typeof value !== 'string' || !value.trim()) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, 5000);
  }

  const targetTime = Date.parse(value);
  if (Number.isFinite(targetTime)) {
    return Math.max(0, Math.min(targetTime - Date.now(), 5000));
  }

  return null;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseStructuredJson(response, label) {
  const text = extractOutputText(response);
  if (!text) {
    throw new Error(`${label} response was empty.`);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} JSON parse failed: ${error.message}`);
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
  const queryTerms = tokenize(
    [
      queryProfile.search_query,
      ...(Array.isArray(queryProfile.keywords) ? queryProfile.keywords : []),
      ...(Array.isArray(queryProfile.visible_text) ? queryProfile.visible_text : []),
      ...(Array.isArray(queryProfile.observed_colors) ? queryProfile.observed_colors : []),
      queryProfile.shape,
      queryProfile.material,
      queryProfile.likely_group,
    ].join(' '),
  );

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
  const itemTokens = tokenize(
    [item.id, item.group, item.title, item.description, item.searchText, item.sheetName, item.sourceFile].join(' '),
  );

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

async function readImageDataUrl(env, requestUrl, relativePath) {
  const cacheKey = relativePath;
  if (imageCache.has(cacheKey)) {
    return imageCache.get(cacheKey);
  }

  const normalizedPath = normalizeAssetPath(relativePath);
  if (!normalizedPath) {
    throw new Error('Invalid image path.');
  }

  const response = await env.ASSETS.fetch(new URL(`/${normalizedPath}`, requestUrl));
  if (!response.ok) {
    throw new Error(`Failed to load image asset: ${response.status}`);
  }

  const mimeType = response.headers.get('content-type') || getMimeType(normalizedPath);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const dataUrl = `data:${mimeType};base64,${bytesToBase64(bytes)}`;
  imageCache.set(cacheKey, dataUrl);
  return dataUrl;
}

function normalizeImageDataUrl(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.startsWith('data:image/') ? trimmed : '';
}

function normalizeAssetPath(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) {
    return '';
  }
  return normalized;
}

function getMimeType(filePath) {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
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
