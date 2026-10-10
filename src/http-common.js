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
      console.error(`[${name}]`, error);
      json(res, 500, { ok: false, error: 'internal_error' });
    }
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[${name}] listening on :${port}`);
  });

  return server;
}

export async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export function json(res, status, data) {
  const body = Buffer.from(JSON.stringify(data));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length
  });
  res.end(body);
}
