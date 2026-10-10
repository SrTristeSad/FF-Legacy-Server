import net from 'node:net';

const port = Number(process.env.TCP_PORT || 8084);

const server = net.createServer((socket) => {
  const remote = `${socket.remoteAddress || '?'}:${socket.remotePort || '?'}`;
  console.log(`[gateway] client connected ${remote}`);

  socket.setKeepAlive(true, 30_000);
  socket.setNoDelay(true);

  socket.on('data', (data) => {
    // Clean-room bootstrap behavior only. Do not interpret proprietary packets here
    // until their wire format has been independently documented.
    if (data.toString('utf8').trim() === 'PING') {
      socket.write('PONG\n');
      return;
    }

    console.log(`[gateway] ${remote} -> ${data.length} bytes`);
  });

  socket.on('error', (error) => {
    console.error(`[gateway] ${remote}`, error.message);
  });

  socket.on('close', () => {
    console.log(`[gateway] client disconnected ${remote}`);
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[gateway] listening on :${port}/tcp`);
});
