import { matchItemPhoto } from './openai-matcher.js';

const API_ROUTE = '/api/match';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (isApiMatchRoute(url.pathname)) {
      if (request.method !== 'POST') {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: 'method_not_allowed',
              message: 'POST only.',
            },
          },
          405,
          { Allow: 'POST' },
        );
      }

      try {
        const payload = await request.json().catch(() => ({}));
        const result = await matchItemPhoto({
          env,
          payload,
          requestUrl: url,
        });
        return jsonResponse(result);
      } catch (error) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: String(error?.code || 'internal_error'),
              message: error instanceof Error ? error.message : 'Unknown server error',
            },
          },
          Number.isFinite(error?.statusCode) ? error.statusCode : 500,
        );
      }
    }

    return env.ASSETS.fetch(request);
  },
};

function isApiMatchRoute(pathname) {
  return pathname === API_ROUTE || pathname === `${API_ROUTE}/`;
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(`${JSON.stringify(body, null, 2)}\n`, {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}
