import net from 'node:net';
import { getAccountByToken } from './account-store.js';

const port = Number(process.env.TCP_PORT || 8084);
const maxBuffer = 8192;

const server = net.createServer((socket) => {
  const remote = `${socket.remoteAddress || '?'}:${socket.remotePort || '?'}`;
  console.log(`[gateway] client connected ${remote}`);

  socket.setKeepAlive(true, 30_000);
  socket.setNoDelay(true);

  let buffered = '';
  let account = null;
  const authTimer = setTimeout(() => {
    if (!account) socket.end('ERR auth_timeout\n');
  }, 10_000);

  function handleLine(line) {
    const value = line.trim();
    if (!value) return;

    if (value === 'PING') {
      socket.write('PONG\n');
      return;
    }

    if (value.startsWith('AUTH ')) {
      const token = value.slice(5).trim();
      const resolved = getAccountByToken(token);
      if (!resolved || resolved.banned) {
        socket.end('ERR invalid_session\n');
        return;
      }
      account = resolved;
      clearTimeout(authTimer);
      socket.write(`OK ${account.uid}\n`);
      console.log(`[gateway] authenticated uid=${account.uid} ${remote}`);
      return;
    }

    if (!account) {
      socket.write('ERR auth_required\n');
      return;
    }

    if (value === 'WHOAMI') {
      socket.write(`${JSON.stringify({ uid: account.uid, nickname: account.nickname, region: account.region })}\n`);
      return;
    }

    if (value === 'QUIT') {
      socket.end('BYE\n');
      return;
    }

    socket.write('ERR unknown_command\n');
  }

  socket.on('data', (data) => {
    // This text protocol is only the internal clean-room session bridge. The
    // independently documented legacy binary adapter will replace this parser.
    buffered += data.toString('utf8');
    if (Buffer.byteLength(buffered, 'utf8') > maxBuffer) {
      socket.end('ERR frame_too_large\n');
      return;
    }

    let index;
    while ((index = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, index);
      buffered = buffered.slice(index + 1);
      handleLine(line);
      if (socket.destroyed) return;
    }
  });

  socket.on('error', (error) => {
    console.error(`[gateway] ${remote}`, error.message);
  });

  socket.on('close', () => {
    clearTimeout(authTimer);
    console.log(`[gateway] client disconnected ${remote}`);
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[gateway] listening on :${port}/tcp`);
});
