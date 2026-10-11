const dotenv = require('dotenv');
const path = require('path');

// Load env vars FIRST, before any local module that might read process.env at
// module-load time. server/nodes/ -> server/ -> FA-Project/.env.
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
const { LamportClock } = require('../services/logicalClocks');
const makeLeaderElectionService = require('../services/leaderElectionService');
const makeClockSyncService = require('../services/clockSyncService');

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
    // GATEWAY_URL wins outright when set (the real multi-host case — the
    // Gateway is a different machine). Otherwise fall back to the
    // single-machine dev shape (same host, GATEWAY_PORT).
    this.gatewayUrl = process.env.GATEWAY_URL || `http://localhost:${process.env.GATEWAY_PORT || 5000}`;
    // What this node tells the Gateway/peers to reach IT at. Defaults to
    // localhost so local dev (all processes on one machine) is unchanged;
    // on separate hosts this MUST be set to this instance's real
    // address (its private IP on AWS, reachable from the Gateway and peers).
    this.selfHost = process.env.NODE_HOST || 'localhost';

    this.outbox = new Outbox(this.nodeId);

    // Internal node state — not shared with the other node processes except
    // through RPC/MessageBus/P2P/Socket.IO (see CLAUDE.md).
    this.peers = [];
    this.users = 0;
    this.resources = 0;
    this.chatHistory = new Map(); // roomId -> Array of messages
    this.resourceHistory = new Map(); // roomId -> Array of resources
    // resourceId -> { buffer, mimeType, originalName }. Files are session-only —
    // never downloaded again after a classroom ends — so bytes live purely in
    // this process's memory on whichever node received the upload, not on disk
    // or in any cloud store. A different node serving a download request for
    // this file fetches it over RPC (see resourceService.resolveDownload).
    this.fileStore = new Map();

    // Logical clocks — neither is persisted or gossip-synced; a restart
    // resets this node's own components to zero while peers keep climbing.
    // That's an accepted limitation (components only need to be monotonic
    // within one process's lifetime for correctness), not a bug.
    this.lamportClock = new LamportClock();
    this.vectorClock = {}; // nodeId -> count, grows lazily as peers are seen

    // Cristian's-algorithm physical clock offset estimate — display only,
    // never adjusts the real system clock. Unrelated to the logical clocks
    // above; kept as a separate field so the two are never confused.
    this.clockOffsetMs = 0;

    // Distributed-communication primitives.
    this.rpcServer = new RpcServer(this);
    this.rpcClient = new RpcClient(this);
    this.messageBus = new MessageBus(this);
    this.peerManager = new PeerManager(this);
    this.socketManager = new SocketManager(this);

    this.peerDiscovery = makePeerDiscoveryService(this);
    this.leaderElection = makeLeaderElectionService(this);
    this.clockSync = makeClockSyncService(this);

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

  // findResource/getResource are the actual cross-node file transfer: a
  // file's bytes only ever live in the uploading node's process memory
  // (node.fileStore), so another node fetches them over RPC rather than
  // through any shared storage — see services/resourceService.js.
  registerRpcMethods() {
    const resourceService = makeResourceService(this);
    this.rpcServer.registerMethod('findResource', (params) => resourceService.rpcFindResource(params));
    this.rpcServer.registerMethod('getResource', (params) => resourceService.rpcGetResource(params));

    // A synchronous RPC round-trip is exactly the failure-detection primitive
    // Bully leader election needs — reusing RpcClient's existing circuit
    // breaker instead of building a second, separate heartbeat mechanism.
    // This `ping` doubles as the project's beacon/heartbeat protocol item.
    this.rpcServer.registerMethod('ping', () => ({ ok: true, nodeId: this.nodeId }));
    this.rpcServer.registerMethod('electionPing', () => this.leaderElection.onElectionPing());

    this.rpcServer.registerMethod('acquireLock', (params) => this.leaderElection.acquireLock(params.resourceKey));
    this.rpcServer.registerMethod('releaseLock', (params) => this.leaderElection.releaseLock(params.resourceKey));
  }

  async start() {
    await connectRequired(this.nodeId);
    this.socketManager.initialize();
    this.server.listen(this.port, () => {
      console.log(`[${this.nodeId}] Node server running on port ${this.port}`);
      this.peerDiscovery.start();
      this.leaderElection.start();
      this.clockSync.start();
    });
  }
}

module.exports = BaseNode;
