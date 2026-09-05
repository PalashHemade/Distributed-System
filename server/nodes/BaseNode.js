const express = require('express');
const cors = require('cors');
const http = require('http');
const dotenv = require('dotenv');
const path = require('path');
const axios = require('axios');

const RpcServer = require('../distributed/rpc/rpcServer');
const RpcClient = require('../distributed/rpc/rpcClient');
const MessageBus = require('../distributed/messaging/messageBus');
const PeerManager = require('../distributed/p2p/peerManager');
const SocketManager = require('../distributed/streaming/socketManager');
const mongoose = require('mongoose');

// Load env vars
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

class BaseNode {
  constructor(nodeId, port) {
    this.nodeId = nodeId;
    this.port = port;
    this.app = express();
    this.server = http.createServer(this.app);
    this.gatewayUrl = `http://localhost:${process.env.GATEWAY_PORT || 5000}`;

    // Connect to MongoDB
    if (process.env.MONGODB_URI && mongoose.connection.readyState === 0) {
      mongoose.connect(process.env.MONGODB_URI)
        .then(() => console.log(`[${this.nodeId}] Connected to MongoDB`))
        .catch(err => console.error(`[${this.nodeId}] MongoDB error:`, err.message));
    }
    
    // Internal node state
    this.peers = [];
    this.users = 0;
    this.resources = 0;

    // Distributed Components
    this.rpcServer = new RpcServer(this);
    this.rpcClient = new RpcClient(this);
    this.messageBus = new MessageBus(this);
    this.peerManager = new PeerManager(this);
    this.socketManager = new SocketManager(this);
    
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
  }

  setupRoutes() {

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.status(200).json({
        nodeId: this.nodeId,
        status: 'ONLINE',
        timestamp: new Date().toISOString(),
        users: this.users,
        resources: this.resources
      });
    });

    // Endpoint for node registry to assign peers
    this.app.post('/api/peers', (req, res) => {
      this.peers = req.body.peers;
      console.log(`[${this.nodeId}] Updated peers:`, this.peers.map(p => p.nodeId).join(', '));
      res.status(200).json({ success: true });
    });

    // RPC Endpoint
    this.app.post('/api/rpc', (req, res) => this.rpcServer.handleRequest(req, res));

    // Messaging Endpoint
    this.app.post('/api/messaging/receive', (req, res) => {
      this.messageBus.handleIncoming(req.body);
      res.status(200).json({ success: true });
    });

    // P2P Endpoint
    this.app.post('/api/p2p/receive', (req, res) => this.peerManager.handleIncoming(req, res));

    // File Upload (Multer)
    const multer = require('multer');
    const fs = require('fs');
    
    const storage = multer.diskStorage({
      destination: (req, file, cb) => {
        const dir = path.resolve(__dirname, `../../../uploads/${this.nodeId}`);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
      }
    });
    
    const upload = multer({ storage });
    this.app.post('/api/resources/upload', upload.single('file'), async (req, res) => {
      console.log(`[FILE] Resource uploaded to ${this.nodeId}: ${req.file.filename}`);
      this.resources++;
      const { v4: uuidv4 } = require('uuid');
      
      const resourceData = {
        resourceId: uuidv4(),
        fileName: req.file.filename,
        fileType: req.file.mimetype,
        size: req.file.size,
        roomId: req.body.roomId,
        ownerNodeId: this.nodeId,
        path: req.file.path,
        createdAt: Date.now()
      };

      // Save to MongoDB
      if (mongoose.connection.readyState === 1) {
        const { Resource } = require('../../models');
        try { await new Resource(resourceData).save(); } catch(e) {}
      }

      // Notify other nodes directly via P2P (Part 17 requirement)
      for (const peer of this.peers) {
        try {
          await this.peerManager.sendToPeer(peer.nodeId, {
            type: 'RESOURCE_SHARED',
            payload: resourceData
          });
        } catch(e) {}
      }

      // We still use Message Bus for the client UI update
      this.messageBus.publish('RESOURCE_SHARED', resourceData);
      
      // Local Broadcast
      this.socketManager.io.to(resourceData.roomId).emit('resource_shared', resourceData);
      
      res.status(200).json({ success: true, resource: resourceData });
    });

    this.app.get('/api/resources/room/:roomId', async (req, res) => {
      if (mongoose.connection.readyState === 1) {
        const { Resource } = require('../../models');
        const resources = await Resource.find({ roomId: req.params.roomId });
        return res.status(200).json(resources);
      }
      res.status(200).json([]);
    });

    // Register RPC Methods
    this.rpcServer.registerMethod('findResource', async (params, senderNode) => {
      const { fileName } = params;
      console.log(`[RPC SERVER] Node ${this.nodeId} received findResource from ${senderNode}`);
      const dir = path.resolve(__dirname, `../../../uploads/${this.nodeId}`);
      const filePath = path.join(dir, fileName);
      const exists = require('fs').existsSync(filePath);
      return { found: exists, nodeId: this.nodeId };
    });

    this.rpcServer.registerMethod('getResource', async (params, senderNode) => {
      const { fileName } = params;
      console.log(`[RPC SERVER] Node ${this.nodeId} received getResource from ${senderNode}`);
      return { url: `http://localhost:${this.port}/uploads/${this.nodeId}/${fileName}` };
    });

    // Client endpoint to find and get a resource across the network
    this.app.get('/api/resources/find/:fileName', async (req, res) => {
      const { fileName } = req.params;
      
      // First check locally
      const dir = path.resolve(__dirname, `../../../uploads/${this.nodeId}`);
      if (fs.existsSync(path.join(dir, fileName))) {
        return res.status(200).json({ found: true, url: `http://localhost:${this.port}/uploads/${this.nodeId}/${fileName}` });
      }

      // If not local, use RPC to ask peers
      console.log(`[RPC] Node ${this.nodeId} searching for ${fileName} on peers`);
      for (const peer of this.peers) {
        try {
          const result = await this.rpcClient.call(peer.nodeId, 'findResource', { fileName });
          if (result && result.found) {
            console.log(`[RPC] Resource found on ${peer.nodeId}`);
            const getResult = await this.rpcClient.call(peer.nodeId, 'getResource', { fileName });
            return res.status(200).json({ found: true, url: getResult.url });
          }
        } catch (err) {
          console.warn(`[RPC WARN] Peer ${peer.nodeId} search failed: ${err.message}`);
        }
      }

      res.status(404).json({ error: 'Resource not found on any node' });
    });

    // Serve static files
    this.app.use('/uploads', express.static(path.resolve(__dirname, '../../../uploads')));
  }

  async registerWithGateway() {
    try {
      await axios.post(`${this.gatewayUrl}/api/registry/register`, {
        nodeId: this.nodeId,
        host: 'localhost',
        port: this.port
      });
      console.log(`[${this.nodeId}] Registered with Gateway successfully.`);
      
      // Start heartbeat
      if (!this.heartbeatInterval) {
        this.heartbeatInterval = setInterval(() => {
          axios.post(`${this.gatewayUrl}/api/registry/heartbeat`, {
            nodeId: this.nodeId,
            users: this.users,
            resources: this.resources
          }).catch(() => {});
        }, 5000);
      }
    } catch (error) {
      console.error(`[${this.nodeId}] Failed to register with Gateway:`, error.message);
      // Retry after some time
      setTimeout(() => this.registerWithGateway(), 5000);
    }
  }

  start() {
    this.socketManager.initialize();
    this.server.listen(this.port, () => {
      console.log(`[${this.nodeId}] Node server running on port ${this.port}`);
      this.registerWithGateway();
    });
  }
}

module.exports = BaseNode;
