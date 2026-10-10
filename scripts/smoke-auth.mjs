const base = `http://127.0.0.1:${process.env.LOGIN_PORT || 19132}`;
const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const username = `smoke_${nonce.replace(/[^a-z0-9]/gi, '').slice(-18)}`.toLowerCase();
const password = 'SmokePass123!';
const deviceId = `smoke-device-${nonce}`;

async function post(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}
  return { response, data, text };
}

console.log('[auth 1/6] register local account');
const registered = await post('/auth/register', { username, password, nickname: 'SmokeLocal', deviceId, clientVersion: '1.70.0' });
if (registered.response.status !== 201 || !registered.data.token || !registered.data.account?.uid) {
  throw new Error(`local register failed: ${registered.response.status} ${registered.text}`);
}
const uid = registered.data.account.uid;

console.log('[auth 2/6] reject duplicate username');
const duplicate = await post('/auth/register', { username, password });
if (duplicate.response.status !== 409 || duplicate.data.error !== 'username_taken') {
  throw new Error(`duplicate username not rejected: ${duplicate.response.status} ${duplicate.text}`);
}

console.log('[auth 3/6] reject wrong password');
const wrong = await post('/auth/login', { username, password: 'WrongPass123!' });
if (wrong.response.status !== 401 || wrong.data.error !== 'invalid_credentials') {
  throw new Error(`wrong password not rejected: ${wrong.response.status} ${wrong.text}`);
}

console.log('[auth 4/6] login local account');
const login = await post('/auth/login', { username, password, deviceId, clientVersion: '1.70.0' });
if (!login.response.ok || login.data.account?.uid !== uid || !login.data.token) {
  throw new Error(`local login failed: ${login.response.status} ${login.text}`);
}

console.log('[auth 5/6] create guest account');
const guest1 = await post('/auth/guest', { deviceId: `${deviceId}-guest`, nickname: 'SmokeGuest', clientVersion: '1.70.0' });
if (!guest1.response.ok || !guest1.data.account?.uid || !guest1.data.token) {
  throw new Error(`guest login failed: ${guest1.response.status} ${guest1.text}`);
}

console.log('[auth 6/6] guest device is stable');
const guest2 = await post('/auth/guest', { deviceId: `${deviceId}-guest`, nickname: 'IgnoredName', clientVersion: '1.70.0' });
if (!guest2.response.ok || guest2.data.account?.uid !== guest1.data.account.uid) {
  throw new Error(`guest account changed UID: ${guest2.response.status} ${guest2.text}`);
}

console.log('local/guest auth smoke test: OK');
