import { timingSafeEqual } from 'node:crypto';
import { startHttpService, readBody, json } from './http-common.js';
import { adjustWalletByUid, listAccounts, setAccountBannedByUid } from './account-store.js';

const port = Number(process.env.ADMIN_PORT || 19136);
const adminUser = String(process.env.ADMIN_USER || 'admin');
const adminPassword = String(process.env.ADMIN_PASSWORD || '');

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function requireAdmin(req, res) {
  if (!adminPassword) {
    json(res, 503, { ok: false, error: 'admin_password_not_configured' });
    return false;
  }
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Basic ')) {
    res.writeHead(401, { 'www-authenticate': 'Basic realm="FF Legacy Admin"', 'content-length': '0' });
    res.end();
    return false;
  }
  let decoded = '';
  try { decoded = Buffer.from(header.slice(6), 'base64').toString('utf8'); } catch {}
  const index = decoded.indexOf(':');
  const user = index >= 0 ? decoded.slice(0, index) : decoded;
  const pass = index >= 0 ? decoded.slice(index + 1) : '';
  if (!safeEqual(user, adminUser) || !safeEqual(pass, adminPassword)) {
    res.writeHead(401, { 'www-authenticate': 'Basic realm="FF Legacy Admin"', 'content-length': '0' });
    res.end();
    return false;
  }
  return true;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function page(accounts) {
  const rows = accounts.map((account) => `
    <tr>
      <td>${account.uid}</td>
      <td>${escapeHtml(account.username || account.openIdType || '-')}</td>
      <td>${escapeHtml(account.nickname)}</td>
      <td>${account.level}</td>
      <td>${account.coins}</td>
      <td>${account.gems}</td>
      <td>${account.banned ? '<strong>SIM</strong>' : 'não'}</td>
      <td>${account.lastLoginAt ? new Date(account.lastLoginAt).toISOString() : '-'}</td>
      <td>
        <form method="post" action="/account/ban">
          <input type="hidden" name="uid" value="${account.uid}">
          <input type="hidden" name="banned" value="${account.banned ? '0' : '1'}">
          <button>${account.banned ? 'Desbanir' : 'Banir'}</button>
        </form>
      </td>
      <td>
        <form method="post" action="/account/wallet">
          <input type="hidden" name="uid" value="${account.uid}">
          <input name="coins" type="number" value="0" style="width:85px" title="Delta de moedas">
          <input name="gems" type="number" value="0" style="width:85px" title="Delta de diamantes">
          <button>Aplicar</button>
        </form>
      </td>
    </tr>`).join('');

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FF Legacy Admin</title>
<style>
body{font-family:system-ui,sans-serif;margin:24px;background:#111;color:#eee}a{color:#9cf}table{border-collapse:collapse;width:100%;background:#181818}th,td{border:1px solid #333;padding:8px;text-align:left}th{background:#222}input,button{background:#252525;color:#eee;border:1px solid #555;padding:6px}button{cursor:pointer}code{background:#222;padding:2px 5px}.muted{color:#aaa}
</style></head><body>
<h1>FF Legacy Admin</h1>
<p class="muted">Contas: ${accounts.length} · versão ${escapeHtml(process.env.GAME_VERSION || 'unknown')}</p>
<p><a href="/api/accounts">API JSON de contas</a></p>
<table><thead><tr><th>UID</th><th>Usuário/tipo</th><th>Nick</th><th>Nível</th><th>Moedas</th><th>Diamantes</th><th>Ban</th><th>Último login</th><th>Ação</th><th>Carteira (delta)</th></tr></thead><tbody>${rows}</tbody></table>
</body></html>`;
}

function sendHtml(res, body) {
  const data = Buffer.from(body, 'utf8');
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': String(data.length), 'cache-control': 'no-store' });
  res.end(data);
}

function redirect(res) {
  res.writeHead(303, { location: '/', 'content-length': '0' });
  res.end();
}

async function form(req) {
  const body = await readBody(req, 64 * 1024);
  return new URLSearchParams(body.toString('utf8'));
}

startHttpService({
  name: 'admin',
  port,
  routes: {
    'GET /': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      sendHtml(res, page(listAccounts()));
    },
    'GET /api/accounts': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      json(res, 200, { ok: true, accounts: listAccounts() });
    },
    'POST /account/ban': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      const data = await form(req);
      const account = setAccountBannedByUid(data.get('uid'), data.get('banned') === '1');
      if (!account) return json(res, 404, { ok: false, error: 'account_not_found' });
      redirect(res);
    },
    'POST /account/wallet': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      const data = await form(req);
      const account = adjustWalletByUid(data.get('uid'), { coins: data.get('coins'), gems: data.get('gems') });
      if (!account) return json(res, 404, { ok: false, error: 'account_not_found' });
      redirect(res);
    }
  }
});
