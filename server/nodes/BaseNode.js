const dotenv = require('dotenv');
const path = require('path');

// Load env vars FIRST, before any local module that might read process.env at
// module-load time (e.g. the S3 client config). server/nodes/ -> server/ ->
// FA-Project/.env.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const http = require('http');

const RpcServer = require('../distributed/rpc/rpcServer');
const RpcClient = require('../distributed/rpc/rpcClient');
const MessageBus = require('../distributed/messaging/messageBus');
const PeerManager = require('../distributed/p2p/peerManager');
const SocketManager = require('../distributed/streaming/socketManager');

const { connectRequired } = require('../config/db');
const { errorHandler } = require('../middleware/errorHandler');
const Outbox = require('../utils/outbox');
const makePeerDiscoveryService = require('../services/peerDiscoveryService');
const makeResourceService = require('../services/resourceService');

const classroomRoutes = require('../routes/classroomRoutes');
const resourceRoutes = require('../routes/resourceRoutes');
const chatRoutes = require('../routes/chatRoutes');
const nodeOpsRoutes = require('../routes/nodeOpsRoutes');

process.on('uncaughtException', (err) => {
  console.error('[CRITICAL ERROR] Node Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[CRITICAL ERROR] Node Unhandled Rejection:', reason);
});

class BaseNode {
  constructor(nodeId, port) {
    this.nodeId = nodeId;
    this.port = port;
    this.app = express();
    this.server = http.createServer(this.app);
    this.gatewayUrl = `http://localhost:${process.env.GATEWAY_PORT || 5000}`;

    this.outbox = new Outbox(this.nodeId);

    // Internal node state — not shared with the other node processes except
    // through RPC/MessageBus/P2P/Socket.IO (see CLAUDE.md).
    this.peers = [];
    this.users = 0;
    this.resources = 0;
    this.chatHistory = new Map(); // roomId -> Array of messages
    this.resourceHistory = new Map(); // roomId -> Array of resources

    // Distributed-communication primitives.
    this.rpcServer = new RpcServer(this);
    this.rpcClient = new RpcClient(this);
    this.messageBus = new MessageBus(this);
    this.peerManager = new PeerManager(this);
    this.socketManager = new SocketManager(this);

    this.peerDiscovery = makePeerDiscoveryService(this);

    this.setupMiddleware();
    this.setupRoutes();
    this.registerRpcMethods();
  }

  setupMiddleware() {
    // `origin: true, credentials: true` (not the previous wildcard "*") — the
    // JWT now travels as an httpOnly cookie, and credentialed cross-port
    // requests require a reflected, non-wildcard origin.
    this.app.use(cors({ origin: true, credentials: true }));
    this.app.use(cookieParser());
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
  }

  setupRoutes() {
    this.app.use(nodeOpsRoutes(this, this.peerDiscovery));
    this.app.use('/api/classrooms', classroomRoutes(this));
    this.app.use('/api/resources', resourceRoutes(this));
    this.app.use('/api/chat', chatRoutes(this));

    // Centralized error handler — must be registered after all routes.
    this.app.use(errorHandler);
  }

  // RPC methods resolve via Mongo + S3 now (resourceService), not local disk
  // — see services/resourceService.js and docs/distributed-concepts.md for
  // why RPC is kept even though a local Mongo query alone would also work.
  registerRpcMethods() {
    const resourceService = makeResourceService(this);
    this.rpcServer.registerMethod('findResource', (params) => resourceService.rpcFindResource(params));
    this.rpcServer.registerMethod('getResource', (params) => resourceService.rpcGetResource(params));
  }

  async start() {
    await connectRequired(this.nodeId);
    this.socketManager.initialize();
    this.server.listen(this.port, () => {
      console.log(`[${this.nodeId}] Node server running on port ${this.port}`);
      this.peerDiscovery.start();
    });
  }
}

module.exports = BaseNode;
