import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchItemPhoto } from './openai-matcher.mjs';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_ROUTE = '/api/match';

export function matchApiPlugin(options = {}) {
  const route = normalizeRoute(options.route || API_ROUTE);

  return {
    name: 'match-api',
    configureServer(server) {
      server.middlewares.use(createMiddleware(route));
    },
    configurePreviewServer(server) {
      server.middlewares.use(createMiddleware(route));
    },
  };
}

function createMiddleware(route) {
  return async (req, res, next) => {
    try {
      const pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
      if (!isRouteMatch(pathname, route)) {
        next();
        return;
      }

      if ((req.method || 'GET').toUpperCase() !== 'POST') {
        writeJson(res, 405, {
          ok: false,
          error: {
            code: 'method_not_allowed',
            message: 'POST only.',
          },
        });
        return;
      }

      const payload = await readJsonBody(req);
      const result = await matchItemPhoto({
        projectRoot: ROOT_DIR,
        payload,
      });
      writeJson(res, 200, result);
    } catch (error) {
      writeJson(res, Number.isFinite(error?.statusCode) ? error.statusCode : 500, {
        ok: false,
        error: {
          code: String(error?.code || 'internal_error'),
          message: error instanceof Error ? error.message : 'Unknown server error',
        },
      });
    }
  };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk));
    });

    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });

    req.on('error', reject);
  });
}

function writeJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function normalizeRoute(route) {
  if (!route.startsWith('/')) return `/${route}`;
  return route.replace(/\/+$/, '') || '/';
}

function isRouteMatch(pathname, route) {
  return pathname === route || pathname === `${route}/`;
}
