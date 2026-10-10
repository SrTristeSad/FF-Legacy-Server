const liveBase = `http://127.0.0.1:${process.env.LIVE_PORT || 19134}`;

async function get(path) {
  const response = await fetch(`${liveBase}${path}`);
  const body = await response.text();
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${body}`);
  return { response, body };
}

console.log('[live 1/4] status');
const status = await get('/status');
const statusJson = JSON.parse(status.body);
if (!statusJson.ok) throw new Error(`live status not ok: ${status.body}`);

console.log('[live 2/4] legacy ver.php');
const version = await get('/ver.php');
const versionJson = JSON.parse(version.body);
if (versionJson.code !== 0 || versionJson.is_server_open !== true) {
  throw new Error(`invalid ver.php payload: ${version.body}`);
}
if (!String(versionJson.server_url || '').includes(':19132')) {
  throw new Error(`ver.php missing login server_url: ${version.body}`);
}
if (!String(versionJson.cdn_url || '').includes('ABHotUpdates')) {
  throw new Error(`ver.php missing cdn_url: ${version.body}`);
}

console.log('[live 3/4] versioninfo');
const versionInfo = await get('/sbt/ABHotUpdates/android/1.70.0/versioninfo');
if (!versionInfo.body.includes('1.70.0')) {
  throw new Error(`unexpected versioninfo: ${JSON.stringify(versionInfo.body)}`);
}

console.log('[live 4/4] empty fileinfo');
const fileInfo = await get('/sbt/ABHotUpdates/android/1.70.0/fileinfo');
if (fileInfo.body.length !== 0) {
  throw new Error(`fileinfo should be empty, got ${fileInfo.body.length} bytes`);
}

console.log('live bootstrap smoke test: OK');
