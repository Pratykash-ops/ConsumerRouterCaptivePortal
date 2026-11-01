// services/https.js
// HTTPS Port 443 Graceful Rejector Service
// Handles client HTTPS traffic cleanly without aggressive TCP resets

const net = require('node:net');
const { PORTS } = require('../config/constants');

function createHttpsRejectorServer() {
  return net.createServer((socket) => {
    // Gracefully close connection without active socket.destroy() TCP RST
    socket.end();
  });
}

const httpsServer = createHttpsRejectorServer();

function startHttpsRejector(port = PORTS.HTTPS) {
  httpsServer.listen(port, () => console.log(`[HTTPS] Port ${port} Graceful Rejector Active`));
  httpsServer.on('error', (err) => {
    if (err.code === 'EACCES') {
      console.log(`[HTTPS] Note: Port ${port} requires elevated permissions. (Running in unprivileged mode)`);
    } else {
      console.log(`[HTTPS] Service notice: ${err.message}`);
    }
  });
}

function stopHttpsRejector() {
  try {
    httpsServer.close();
  } catch {}
}

module.exports = {
  httpsServer,
  createHttpsRejectorServer,
  startHttpsRejector,
  stopHttpsRejector
};
