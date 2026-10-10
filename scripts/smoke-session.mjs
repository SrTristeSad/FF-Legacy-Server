import net from 'node:net';
import { randomUUID } from 'node:crypto';

const loginBase = `http://127.0.0.1:${process.env.LOGIN_PORT || 19132}`;
const mainBase = `http://127.0.0.1:${process.env.MAIN_PORT || 19133}`;
const gatewayPort = Number(process.env.TCP_PORT || 8084);
const openId = `smoke-${randomUUID()}`;

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(`${options.method || 'GET'} ${url} -> ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

function post(url, body, token = '') {
  return jsonRequest(url, {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: JSON.stringify(body)
  });
}

console.log('[1/6] register');
await post(`${loginBase}/register`, {
  openId,
  nickname: 'SmokeSession',
  region: 'BR',
  language: 'pt-br',
  clientVersion: process.env.GAME_VERSION || '1.70.4'
});

console.log('[2/6] login');
const login = await post(`${loginBase}/login`, { openId });
if (!login.token) throw new Error('login did not return a token');

console.log('[3/6] profile');
const profile = await jsonRequest(`${mainBase}/profile`, {
  headers: { authorization: `Bearer ${login.token}` }
});
if (profile.profile?.nickname !== 'SmokeSession') throw new Error('profile mismatch');

console.log('[4/6] lobby');
const lobby = await jsonRequest(`${mainBase}/lobby`, {
  headers: { authorization: `Bearer ${login.token}` }
});
if (!lobby.realtime?.notificationChannel) throw new Error('lobby realtime data missing');

console.log('[5/6] gateway auth');
const gatewayReply = await new Promise((resolve, reject) => {
  const socket = net.createConnection({ host: '127.0.0.1', port: gatewayPort });
  let buffer = '';
  const timer = setTimeout(() => {
    socket.destroy();
    reject(new Error('gateway timeout'));
  }, 3000);

  socket.once('error', reject);
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    if (!buffer.includes('\n')) return;
    clearTimeout(timer);
    socket.end();
    resolve(buffer.trim());
  });
  socket.once('connect', () => socket.write(`AUTH ${login.token}\n`));
});
if (!gatewayReply.startsWith('OK ')) throw new Error(`gateway auth failed: ${gatewayReply}`);

console.log('[6/6] logout');
await post(`${loginBase}/logout`, {}, login.token);

console.log('session smoke test: OK');
