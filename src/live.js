import { startHttpService, json } from './http-common.js';
import { createResourceCacheHandler, resourceCacheInfo } from './resource-cache.js';

const port = Number(process.env.LIVE_PORT || 19134);
const gameVersion = process.env.GAME_VERSION || '1.70.0';
const publicHost = String(process.env.PUBLIC_HOST || '127.0.0.1').trim();
const loginPort = Number(process.env.LOGIN_PORT || 19132);
const resourceMirrorMode = String(process.env.RESOURCE_MIRROR_MODE || 'local').trim().toLowerCase();
const resourceCache = createResourceCacheHandler();
const remoteOptionVersion = String(process.env.REMOTE_OPTION_VERSION || 'optionaltrainingres:2').trim();

function normalizeBase(value, fallback) {
  const raw = String(value || fallback || '').trim();
  if (!raw) return '';
  return raw.endsWith('/') ? raw : `${raw}/`;
}

function publicHttpUrl(portValue, suffix = '') {
  const host = publicHost || '127.0.0.1';
  const base = `http://${host}:${portValue}/`;
  return suffix ? `${base}${String(suffix).replace(/^\/+/, '')}` : base;
}

const loginServerUrl = normalizeBase(
  process.env.CLIENT_LOGIN_URL,
  publicHttpUrl(loginPort)
);

const cdnUrl = normalizeBase(
  process.env.CLIENT_CDN_URL,
  publicHttpUrl(port, 'sbt/ABHotUpdates/')
);

function empty(res, status = 200) {
  res.writeHead(status, {
    'content-type': 'application/octet-stream',
    'content-length': '0',
    'cache-control': 'no-store'
  });
  res.end();
}

function text(res, status, body) {
  const data = Buffer.from(String(body), 'utf8');
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': String(data.length),
    'cache-control': 'no-store'
  });
  res.end(data);
}

function versionInfoBody() {
  return `${gameVersion}_ASTC\n${gameVersion}\n`;
}

async function hotUpdate(req, res, url, localHandler) {
  if (resourceMirrorMode === 'mirror') {
    return resourceCache(req, res, url);
  }
  localHandler();
  return true;
}

const routes = {
  'GET /status': async (_req, res) => {
    json(res, 200, {
      ok: true,
      online: true,
      gameVersion,
      loginServerUrl,
      cdnUrl,
      remoteOptionVersion,
      resourceMirrorMode,
      resourceCache: resourceCacheInfo()
    });
  },

  'GET /ver.php': async (req, res) => {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const clientIp = forwarded || req.socket.remoteAddress || '';
    json(res, 200, {
      appstore_url: 'https://play.google.com/store/apps/details?id=com.dts.freefireth',
      billboard_msg: '',
      cdn_url: cdnUrl,
      client_ip: clientIp,
      code: 0,
      country_code: process.env.CLIENT_COUNTRY_CODE || 'BR',
      force_to_restart_app: false,
      gdpr_version: 2,
      is_firewall_open: false,
      is_review_server: false,
      is_server_open: true,
      maintenance_announcement: '',
      maintenance_region: '',
      remote_option_version: remoteOptionVersion,
      remote_version: gameVersion,
      server_url: loginServerUrl
    });
  },

  'GET /sbt/ABHotUpdates/android/1.70.0/fileinfo': async (req, res, url) => hotUpdate(req, res, url, () => empty(res)),
  'GET /sbt/ABHotUpdates/android/1.70.0/versioninfo': async (req, res, url) => hotUpdate(req, res, url, () => text(res, 200, versionInfoBody())),
  'GET /live/ABHotUpdates/android/1.70.0/fileinfo': async (req, res, url) => hotUpdate(req, res, url, () => empty(res)),
  'GET /live/ABHotUpdates/android/1.70.0/versioninfo': async (req, res, url) => hotUpdate(req, res, url, () => text(res, 200, versionInfoBody())),

  'HEAD /sbt/ABHotUpdates/android/1.70.0/fileinfo': async (req, res, url) => hotUpdate(req, res, url, () => empty(res)),
  'HEAD /sbt/ABHotUpdates/android/1.70.0/versioninfo': async (req, res, url) => hotUpdate(req, res, url, () => empty(res)),
  'HEAD /live/ABHotUpdates/android/1.70.0/fileinfo': async (req, res, url) => hotUpdate(req, res, url, () => empty(res)),
  'HEAD /live/ABHotUpdates/android/1.70.0/versioninfo': async (req, res, url) => hotUpdate(req, res, url, () => empty(res))
};

startHttpService({
  name: 'live',
  port,
  routes,
  fallback: resourceMirrorMode === 'mirror' ? resourceCache : null
});
