import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';

const cacheRoot = path.resolve(process.env.RESOURCE_CACHE_DIR || '/resource-cache');
const originBase = new URL(process.env.RESOURCE_ORIGIN_BASE || 'https://freefiremobile-a.akamaihd.net');

function mapOriginPath(pathname) {
  let mapped = String(pathname || '');
  if (mapped.startsWith('/live/ABHotUpdates/')) {
    mapped = `/sbt/ABHotUpdates/${mapped.slice('/live/ABHotUpdates/'.length)}`;
  }
  if (!mapped.startsWith('/sbt/ABHotUpdates/')) return null;

  let decoded;
  try {
    decoded = decodeURIComponent(mapped);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.split('/').includes('..')) return null;
  return mapped;
}

function cacheFileFor(originPath) {
  const relative = originPath.replace(/^\/+/, '');
  const target = path.resolve(cacheRoot, relative);
  if (target !== cacheRoot && !target.startsWith(`${cacheRoot}${path.sep}`)) return null;
  return target;
}

// Some legacy manifests request the same logical AssetBundle with a different
// hash suffix. The historical 1.70.x server matched by the base name before
// the first dot, e.g. loc_pt-br.HASH_A -> loc_pt-br.HASH_B.
function findLegacyBundleAlias(filePath) {
  if (!filePath.includes(`${path.sep}gameassetbundles${path.sep}`)) return null;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) return null;

  const requested = path.basename(filePath);
  const dot = requested.indexOf('.');
  if (dot <= 0) return null;
  const base = requested.slice(0, dot);

  try {
    const match = fs.readdirSync(dir).find((name) => {
      if (!name.startsWith(`${base}.`)) return false;
      const candidate = path.join(dir, name);
      return fs.statSync(candidate).isFile();
    });
    return match ? path.join(dir, match) : null;
  } catch {
    return null;
  }
}

function contentType(filePath) {
  const name = path.basename(filePath).toLowerCase();
  if (name === 'versioninfo' || name === 'fileinfo' || name.endsWith('.txt')) return 'text/plain; charset=utf-8';
  if (name.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(header || '').trim());
  if (!match) return null;
  let start;
  let end;
  if (!match[1] && match[2]) {
    const suffix = Number(match[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

function serveCached(req, res, filePath, cacheState = 'HIT') {
  const stat = fs.statSync(filePath);
  const range = parseRange(req.headers.range, stat.size);
  const headers = {
    'content-type': contentType(filePath),
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=31536000, immutable',
    'x-ff-resource-cache': cacheState
  };

  if (range) {
    headers['content-range'] = `bytes ${range.start}-${range.end}/${stat.size}`;
    headers['content-length'] = String(range.end - range.start + 1);
    res.writeHead(206, headers);
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(filePath, { start: range.start, end: range.end }).pipe(res);
  }

  headers['content-length'] = String(stat.size);
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  return fs.createReadStream(filePath).pipe(res);
}

function filteredHeaders(upstream) {
  const headers = {
    'x-ff-resource-cache': 'MISS'
  };
  for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified', 'cache-control']) {
    const value = upstream.headers[name];
    if (value !== undefined) headers[name] = value;
  }
  return headers;
}

function requestOrigin(originUrl, req, res, filePath, redirects = 0) {
  return new Promise((resolve, reject) => {
    const transport = originUrl.protocol === 'http:' ? http : https;
    const headers = {
      'user-agent': String(req.headers['user-agent'] || 'FF-Legacy-Resource-Mirror/1.0'),
      accept: String(req.headers.accept || '*/*')
    };
    if (req.headers.range) headers.range = String(req.headers.range);

    const upstreamReq = transport.request(originUrl, { method: req.method, headers }, (upstream) => {
      const status = Number(upstream.statusCode || 502);
      const location = upstream.headers.location;
      if (status >= 300 && status < 400 && location && redirects < 5) {
        upstream.resume();
        const next = new URL(location, originUrl);
        requestOrigin(next, req, res, filePath, redirects + 1).then(resolve, reject);
        return;
      }

      res.writeHead(status, filteredHeaders(upstream));

      if (req.method === 'HEAD') {
        upstream.resume();
        res.end();
        resolve(true);
        return;
      }

      const shouldCache = status === 200 && !req.headers.range;
      let tempPath = '';
      let fileStream = null;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve(true);
      };

      if (shouldCache) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        tempPath = `${filePath}.part-${process.pid}-${Date.now()}`;
        fileStream = fs.createWriteStream(tempPath);
        fileStream.on('close', () => {
          try {
            fs.renameSync(tempPath, filePath);
            console.log(`[resources] cached ${originUrl.pathname}`);
          } catch (error) {
            try { fs.rmSync(tempPath, { force: true }); } catch {}
            console.error('[resources] cache commit failed:', error.message);
          }
          finish();
        });
        fileStream.on('error', reject);
        upstream.pipe(fileStream);
      }

      upstream.pipe(res);
      upstream.on('end', () => {
        if (!fileStream) finish();
      });
      upstream.on('error', reject);
    });

    upstreamReq.on('error', reject);
    upstreamReq.end();
  });
}

export function createResourceCacheHandler() {
  return async function resourceCacheHandler(req, res, url) {
    if (!['GET', 'HEAD'].includes(String(req.method || 'GET').toUpperCase())) return false;
    const originPath = mapOriginPath(url.pathname);
    if (!originPath) return false;

    const filePath = cacheFileFor(originPath);
    if (!filePath) return false;

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      serveCached(req, res, filePath);
      return true;
    }

    const aliasPath = findLegacyBundleAlias(filePath);
    if (aliasPath) {
      console.log(`[resources] ALIAS ${originPath} -> ${path.basename(aliasPath)}`);
      serveCached(req, res, aliasPath, 'ALIAS');
      return true;
    }

    const originUrl = new URL(originPath + (url.search || ''), originBase);
    console.log(`[resources] MISS ${originPath} -> ${originUrl.href}`);
    await requestOrigin(originUrl, req, res, filePath);
    return true;
  };
}

export function resourceCacheInfo() {
  return {
    cacheRoot,
    origin: originBase.origin
  };
}
