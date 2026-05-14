import './styles.css';

const INDEX_URL = '/data/index.json';
const MATCH_URL = '/api/match';
const MAX_SIDE = 1280;

const state = {
  index: null,
  indexStatus: 'loading',
  indexError: '',
  queryFile: null,
  queryPreviewUrl: '',
  queryDataUrl: '',
  matchStatus: 'idle',
  matchError: '',
  queryProfile: null,
  shortlist: [],
  matches: [],
  apiMessage: '대기 중',
};

const els = {};

bootstrap();

async function bootstrap() {
  mountShell();
  bindElements();
  bindEvents();
  await loadIndex();
  render();
}

function mountShell() {
  const app = document.querySelector('#app');
  app.innerHTML = `
    <main class="page">
      <section class="hero card">
        <div class="hero-copy">
          <p class="eyebrow">OPENAI MATCHER</p>
          <h1>사진만 올리면 AI가 네 물건 후보를 골라준다</h1>
          <p class="lede">
            미리 넣어둔 폴더의 물건 데이터와 사진을 기반으로, OpenAI가 먼저 사진을 읽고
            로컬 인덱스 후보를 다시 정렬한다. 단순 해시 비교보다 훨씬 덜 허술한 흐름이다.
          </p>
        </div>

        <div class="hero-stats">
          <div class="stat">
            <span class="stat-label">index</span>
            <strong id="stat-index">불러오는 중</strong>
          </div>
          <div class="stat">
            <span class="stat-label">ai</span>
            <strong id="stat-ai">대기 중</strong>
          </div>
          <div class="stat">
            <span class="stat-label">items</span>
            <strong id="stat-items">0</strong>
          </div>
          <div class="stat">
            <span class="stat-label">groups</span>
            <strong id="stat-groups">0</strong>
          </div>
        </div>
      </section>

      <section class="layout">
        <div class="main-column">
          <section class="card panel">
            <div class="section-head">
              <div>
                <p class="section-kicker">01. 사진 업로드</p>
                <h2>비교할 사진을 넣어</h2>
              </div>
              <div class="actions">
                <button class="button ghost" id="reload-index" type="button">인덱스 다시 읽기</button>
                <button class="button ghost" id="clear-query" type="button">선택 해제</button>
              </div>
            </div>

            <label class="upload-zone" for="query-file">
              <input id="query-file" type="file" accept="image/*" />
              <div class="upload-copy">
                <span class="upload-title">여기에 사진을 드롭하거나 클릭해서 고르기</span>
                <span class="upload-subtitle">
                  이미지는 서버로 보내기 전에 작게 줄여서 전송한다. 그러면 응답 속도랑 비용이 좀 덜 미친다.
                </span>
              </div>
              <img id="query-preview" class="query-preview hidden" alt="업로드한 사진 미리보기" />
            </label>
          </section>

          <section class="card panel results-panel">
            <div class="section-head">
              <div>
                <p class="section-kicker">02. AI 결과</p>
                <h2>가장 비슷한 후보들</h2>
              </div>
              <p class="section-hint" id="match-hint">사진을 올리면 결과가 나온다</p>
            </div>

            <div id="result-state" class="empty-state">
              <h3 id="empty-title">아직 매칭할 사진이 없다</h3>
              <p id="empty-copy">
                OpenAI가 먼저 업로드한 사진을 읽고, 그다음 로컬 인덱스의 후보 이미지들을 다시 정렬한다.
              </p>
            </div>

            <div id="results-grid" class="results-grid hidden"></div>
          </section>
        </div>

        <aside class="sidebar">
          <section class="card panel status-panel">
            <div class="section-head">
              <div>
                <p class="section-kicker">03. 상태</p>
                <h2>인덱스와 AI 상황</h2>
              </div>
            </div>

            <div class="status-list">
              <div class="status-row">
                <span>source</span>
                <strong id="status-source">/data/index.json</strong>
              </div>
              <div class="status-row">
                <span>index</span>
                <strong id="status-index">불러오는 중</strong>
              </div>
              <div class="status-row">
                <span>match</span>
                <strong id="status-match">대기 중</strong>
              </div>
              <div class="status-row">
                <span>model</span>
                <strong id="status-model">gpt-5.4</strong>
              </div>
              <div class="status-row">
                <span>items</span>
                <strong id="status-items">0</strong>
              </div>
              <div class="status-row">
                <span>groups</span>
                <strong id="status-groups">0</strong>
              </div>
            </div>

            <div class="summary">
              <p class="summary-title">group summary</p>
              <div id="group-summary" class="chips"></div>
            </div>

            <p class="status-note" id="status-note">
              OPENAI_API_KEY가 없으면 서버가 에러를 돌려준다. 그건 정상이다. 키를 서버 환경변수로 넣어야 한다.
            </p>
          </section>

          <section class="card panel profile-panel">
            <p class="section-kicker">04. AI 프로필</p>
            <h2>업로드 사진에서 뽑은 힌트</h2>
            <div id="profile-chips" class="chips chips-stack"></div>
          </section>
        </aside>
      </section>
    </main>
  `;
}

function bindElements() {
  const ids = [
    'stat-index',
    'stat-ai',
    'stat-items',
    'stat-groups',
    'query-file',
    'query-preview',
    'reload-index',
    'clear-query',
    'results-grid',
    'result-state',
    'empty-title',
    'empty-copy',
    'match-hint',
    'status-source',
    'status-index',
    'status-match',
    'status-model',
    'status-items',
    'status-groups',
    'group-summary',
    'status-note',
    'profile-chips',
  ];

  for (const id of ids) {
    els[id] = document.querySelector(`#${id}`);
  }
}

function bindEvents() {
  els['query-file'].addEventListener('change', onQueryChange);
  els['reload-index'].addEventListener('click', loadIndex);
  els['clear-query'].addEventListener('click', clearQuery);
}

async function readJsonResponse(response, resourceLabel) {
  const text = await response.text();
  const body = text.trim();

  if (!body) {
    throw new Error(`${resourceLabel} 응답이 비어 있어요.`);
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${resourceLabel} 응답이 JSON 형식이 아니에요.`);
  }
}

async function loadIndex() {
  state.indexStatus = 'loading';
  state.apiMessage = '인덱스 읽는 중';
  render();

  try {
    const response = await fetch(INDEX_URL, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await readJsonResponse(response, INDEX_URL);
    state.index = {
      generatedAt: String(data.generatedAt || ''),
      groupSummary: Array.isArray(data.groupSummary) ? data.groupSummary : [],
      items: Array.isArray(data.items) ? data.items : [],
    };
    state.indexStatus = 'ready';
    state.apiMessage = '인덱스 준비됨';
    state.indexError = '';
  } catch (error) {
    state.index = null;
    state.indexStatus = 'error';
    state.indexError = error instanceof Error ? error.message : '인덱스를 읽지 못했다';
    state.apiMessage = '인덱스 실패';
  }

  render();
}

async function onQueryChange(event) {
  const file = event.target.files?.[0];
  if (!file) {
    clearQuery();
    return;
  }

  state.queryFile = file;
  state.queryProfile = null;
  state.shortlist = [];
  state.matches = [];
  state.matchError = '';
  state.matchStatus = 'preparing';
  state.apiMessage = '이미지 준비 중';

  if (state.queryPreviewUrl) {
    URL.revokeObjectURL(state.queryPreviewUrl);
  }

  state.queryPreviewUrl = URL.createObjectURL(file);
  state.queryDataUrl = await resizeImageFile(file, MAX_SIDE);

  render();
  await runMatch();
}

async function runMatch() {
  if (!state.queryDataUrl) return;

  state.matchStatus = 'running';
  state.apiMessage = 'OpenAI 호출 중';
  render();

  try {
    const response = await fetch(MATCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileName: state.queryFile?.name || 'upload',
        imageDataUrl: state.queryDataUrl,
        shortlistSize: 8,
      }),
    });

    const data = await readJsonResponse(response, MATCH_URL);
    if (!response.ok || !data.ok) {
      const message = data?.error?.message || `HTTP ${response.status}`;
      throw new Error(message);
    }

    state.matchStatus = 'done';
    state.matchError = '';
    state.queryProfile = data.queryProfile || null;
    state.shortlist = Array.isArray(data.shortlist) ? data.shortlist : [];
    state.matches = Array.isArray(data.matches) ? data.matches : [];
    state.apiMessage = `${data.model || 'gpt-5.4'} 응답 완료`;
  } catch (error) {
    state.matchStatus = 'error';
    state.matchError = error instanceof Error ? error.message : '매칭 실패';
    state.apiMessage = '매칭 실패';
    state.queryProfile = null;
    state.shortlist = [];
    state.matches = [];
  }

  render();
}

function clearQuery() {
  state.queryFile = null;
  state.queryProfile = null;
  state.shortlist = [];
  state.matches = [];
  state.matchError = '';
  state.matchStatus = 'idle';
  state.apiMessage = '대기 중';
  state.queryDataUrl = '';

  if (state.queryPreviewUrl) {
    URL.revokeObjectURL(state.queryPreviewUrl);
    state.queryPreviewUrl = '';
  }

  if (els['query-file']) {
    els['query-file'].value = '';
  }

  render();
}

function render() {
  const indexReady = state.indexStatus === 'ready' && state.index;
  els['stat-index'].textContent = labelIndexState(state.indexStatus);
  els['stat-ai'].textContent = state.matchStatus === 'done' ? '응답 완료' : state.apiMessage;
  els['stat-items'].textContent = indexReady ? String(state.index.items.length) : '0';
  els['stat-groups'].textContent = indexReady ? String(state.index.groupSummary.length) : '0';

  els['status-source'].textContent = INDEX_URL;
  els['status-index'].textContent = labelIndexState(state.indexStatus);
  els['status-match'].textContent = labelMatchState(state.matchStatus);
  els['status-model'].textContent = 'gpt-5.4';
  els['status-items'].textContent = indexReady ? String(state.index.items.length) : '0';
  els['status-groups'].textContent = indexReady ? String(state.index.groupSummary.length) : '0';
  els['status-note'].textContent = buildStatusNote();

  els['match-hint'].textContent = state.matchError
    ? state.matchError
    : state.queryFile
      ? `${state.queryFile.name} 기준으로 AI가 후보를 정렬 중`
      : '사진을 올리면 결과가 나온다';

  els['profile-chips'].innerHTML = state.queryProfile
    ? [
        chip(`group: ${state.queryProfile.likely_group || '-'}`),
        chip(`search: ${state.queryProfile.search_query || '-'}`),
        chip(`shape: ${state.queryProfile.shape || '-'}`),
        chip(`material: ${state.queryProfile.material || '-'}`),
        chip(`confidence: ${formatNumber(state.queryProfile.confidence)}%`),
        ...(Array.isArray(state.queryProfile.keywords) ? state.queryProfile.keywords.slice(0, 6).map((value) => chip(value)) : []),
      ].join('')
    : '<span class="chip muted">아직 프로필 없음</span>';

  renderGroupSummary();
  renderResults();
  renderPreview();
  renderEmptyState();
}

function renderGroupSummary() {
  if (!state.index || !state.index.groupSummary.length) {
    els['group-summary'].innerHTML = '<span class="chip muted">인덱스 없음</span>';
    return;
  }

  els['group-summary'].innerHTML = state.index.groupSummary
    .map((entry) => groupChip(entry.group, entry.count))
    .join('');
}

function renderPreview() {
  if (state.queryPreviewUrl) {
    els['query-preview'].classList.remove('hidden');
    els['query-preview'].src = state.queryPreviewUrl;
    return;
  }

  els['query-preview'].classList.add('hidden');
  els['query-preview'].removeAttribute('src');
}

function renderResults() {
  if (!state.matches.length) {
    els['results-grid'].classList.add('hidden');
    els['results-grid'].innerHTML = '';
    return;
  }

  els['results-grid'].classList.remove('hidden');
  els['results-grid'].innerHTML = state.matches
    .map((match, index) => {
      const badgeClass = index === 0 ? 'exact' : 'visual';
      const badgeText = index === 0 ? 'best match' : `#${index + 1}`;
      const signals = Array.isArray(match.signals) ? match.signals.slice(0, 4) : [];
      const imageSrc = match.primaryImagePath ? encodeURI(`/${match.primaryImagePath}`) : '';

      return `
        <article class="match-card card">
          <div class="match-media">
            ${imageSrc ? `<img src="${imageSrc}" alt="${escapeHtml(match.title || match.id)}" />` : '<div class="media-fallback">no image</div>'}
          </div>
          <div class="match-body">
            <div class="match-head">
              <span class="match-rank">${index + 1}</span>
              <span class="match-score">${formatNumber(match.score || 0)}%</span>
            </div>
            <div class="match-title-row">
              <h3 class="match-title">${escapeHtml(match.title || match.id)}</h3>
              <span class="match-badge ${badgeClass}">${badgeText}</span>
            </div>
            <div class="match-meta">
              <span>${escapeHtml(match.group || '-')}</span>
              <span>${escapeHtml(String(match.number || '-'))}</span>
              <span>${escapeHtml(match.sheetName || '')}</span>
            </div>
            <p class="match-desc">${escapeHtml(match.reason || match.description || '설명 없음')}</p>
            <div class="match-signals">
              ${signals.map((signal) => `<span class="signal">${escapeHtml(signal)}</span>`).join('')}
            </div>
          </div>
        </article>
      `;
    })
    .join('');
}

function renderEmptyState() {
  const hasResults = state.matches.length > 0;
  const empty = els['result-state'];

  if (hasResults) {
    empty.classList.add('hidden');
    return;
  }

  empty.classList.remove('hidden');
  els['empty-title'].textContent = state.matchStatus === 'error'
    ? 'AI 매칭이 실패했다'
    : state.indexStatus === 'error'
      ? '인덱스를 못 읽었다'
      : '아직 매칭할 사진이 없다';

  els['empty-copy'].textContent = state.matchStatus === 'error'
    ? state.matchError || '서버 응답을 못 받았다.'
    : state.indexStatus === 'error'
      ? state.indexError || 'data/index.json을 읽지 못했다.'
      : '사진을 올리면 OpenAI가 먼저 읽고, 로컬 인덱스 후보를 다시 정렬한다.';
}

function labelIndexState(value) {
  switch (value) {
    case 'loading':
      return '불러오는 중';
    case 'ready':
      return '준비됨';
    case 'error':
      return '오류';
    default:
      return '대기 중';
  }
}

function labelMatchState(value) {
  switch (value) {
    case 'preparing':
      return '준비 중';
    case 'running':
      return '매칭 중';
    case 'done':
      return '완료';
    case 'error':
      return '오류';
    default:
      return '대기 중';
  }
}

function buildStatusNote() {
  if (state.matchStatus === 'error' && state.matchError) {
    return state.matchError;
  }

  if (state.indexStatus === 'error' && state.indexError) {
    return state.indexError;
  }

  if (state.indexStatus !== 'ready') {
    return 'data/index.json을 먼저 읽는 중이다.';
  }

  if (state.matchStatus === 'done') {
    return 'OpenAI가 사진을 읽고, 로컬 후보를 다시 정렬했다.';
  }

  return 'OPENAI_API_KEY가 없으면 서버가 바로 에러를 준다. 그건 정상이다.';
}

function chip(text) {
  return `<span class="chip">${escapeHtml(text)}</span>`;
}

function groupChip(group, count) {
  return `<span class="chip">${escapeHtml(group)} · <strong>${escapeHtml(String(count))}</strong></span>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return number.toFixed(1).replace(/\.0$/, '');
}

async function resizeImageFile(file, maxSide) {
  if (!('createImageBitmap' in window)) {
    return readFileAsDataUrl(file);
  }

  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) {
      return readFileAsDataUrl(file);
    }

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    return canvas.toDataURL(file.type || 'image/jpeg', 0.9);
  } finally {
    bitmap.close();
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('이미지 읽기 실패'));
    reader.readAsDataURL(file);
  });
}
