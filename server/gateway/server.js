const dotenv = require('dotenv');
const path = require('path');

// Load env vars first — before any local module that reads process.env at
// module-load time.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const http = require('http');

const { connectRequired } = require('../config/db');
const { errorHandler } = require('../middleware/errorHandler');
const makeRegistryService = require('./services/registryService');
const makeMonitorService = require('./services/monitorService');
const registryRoutes = require('./routes/registryRoutes');
const monitorRoutes = require('./routes/monitorRoutes');
const authRoutes = require('./routes/authRoutes');

process.on('uncaughtException', (err) => {
  console.error('[CRITICAL ERROR] Gateway Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[CRITICAL ERROR] Gateway Unhandled Rejection:', reason);
});

const app = express();
const server = http.createServer(app);
// `origin: true` reflects the request's own Origin header back — required
// instead of the previous wildcard "*" because a wildcard origin is
// incompatible with credentialed (cookie-carrying) requests/sockets.
const io = require('socket.io')(server, {
  cors: { origin: true, credentials: true, methods: ["GET", "POST"] }
});

const registryService = makeRegistryService(() => {
  io.emit('node_status', registryService.getAll());
});
const monitorService = makeMonitorService((event) => {
  io.emit('network_event', event);
});

app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(registryRoutes(registryService));
app.use(monitorRoutes(monitorService));
app.use(authRoutes());

app.use(errorHandler);

// Periodically mark silent nodes OFFLINE (registry heartbeat timeout).
setInterval(() => registryService.sweepOffline(), 5000);

const PORT = process.env.GATEWAY_PORT || 5000;

connectRequired('Gateway').then(() => {
  server.listen(PORT, () => {
    console.log(`Gateway server running on port ${PORT}`);
  });
});
