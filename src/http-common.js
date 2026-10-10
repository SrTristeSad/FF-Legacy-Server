import http from 'node:http';

export function startHttpService({ name, port, routes = {} }) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/health') {
      return json(res, 200, {
        ok: true,
        service: name,
        version: process.env.GAME_VERSION || 'unknown',
        time: new Date().toISOString()
      });
    }

    const key = `${req.method || 'GET'} ${url.pathname}`;
    const handler = routes[key];
    if (!handler) {
      return json(res, 404, { ok: false, error: 'not_implemented', service: name, path: url.pathname });
    }

    try {
      await handler(req, res, url);
    } catch (error) {
      const status = Number(error?.status || 500);
      const code = error?.code || (status >= 500 ? 'internal_error' : 'request_failed');
      if (status >= 500) console.error(`[${name}]`, error);
      json(res, status, {
        ok: false,
        error: code,
        ...(error?.details ? { details: error.details } : {})
      });
    }
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[${name}] listening on :${port}`);
  });

  return server;
}

export async function readBody(req, maxBytes = 1024 * 1024) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error('payload_too_large');
      error.status = 413;
      error.code = 'payload_too_large';
      throw error;
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

export async function readJson(req, maxBytes = 1024 * 1024) {
  const body = await readBody(req, maxBytes);
  if (!body.length) return {};

  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    const error = new Error('invalid_json');
    error.status = 400;
    error.code = 'invalid_json';
    throw error;
  }
}

export function json(res, status, data) {
  const body = Buffer.from(JSON.stringify(data));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store'
  });
  res.end(body);
}
