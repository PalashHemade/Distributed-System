const express = require('express');
const cors = require('cors');
const http = require('http');
const dotenv = require('dotenv');
const path = require('path');
const mongoose = require('mongoose');

// Load env vars
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = express();
const server = http.createServer(app);

// Connect to MongoDB
if (process.env.MONGODB_URI) {
  mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('[Gateway] Connected to MongoDB'))
    .catch(err => console.error('[Gateway] MongoDB connection error:', err.message));
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Basic Health Check
app.get('/health', (req, res) => {
  res.status(200).json({
    nodeId: 'gateway',
    status: 'ONLINE',
    timestamp: new Date().toISOString(),
    nodes: Array.from(registeredNodes.values())
  });
});

// Node Registry
const registeredNodes = new Map();

// Communication Monitor Endpoint
const networkEvents = [];
const io = require('socket.io')(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.post('/api/monitor/message', (req, res) => {
  const event = req.body;
  networkEvents.push(event);
  console.log(`[MONITOR] Received event:`, event.type);
  
  // Stream event to dashboard clients
  io.emit('network_event', event);

  // Keep last 100 events
  if (networkEvents.length > 100) networkEvents.shift();
  res.status(200).json({ success: true });
});

app.get('/api/monitor/events', (req, res) => {
  res.status(200).json(networkEvents);
});

// Broadcast node status to dashboard whenever a node registers or updates
const broadcastNodeStatus = () => {
  io.emit('node_status', Array.from(registeredNodes.values()));
};

// Periodically check node health and update dashboard
setInterval(() => {
  let changed = false;
  const now = Date.now();
  for (const [nodeId, node] of registeredNodes.entries()) {
    if (now - node.lastSeen > 10000 && node.status !== 'OFFLINE') {
      node.status = 'OFFLINE';
      changed = true;
    }
  }
  if (changed) broadcastNodeStatus();
}, 5000);

app.post('/api/registry/register', async (req, res) => {
  const { nodeId, host, port } = req.body;
  
  registeredNodes.set(nodeId, {
    nodeId,
    host,
    port,
    lastSeen: Date.now(),
    status: 'ONLINE',
    users: 0,
    resources: 0
  });

  console.log(`[Gateway] Registered node: ${nodeId}`);
  broadcastNodeStatus();

  // Broadcast updated peers to all nodes
  const nodes = Array.from(registeredNodes.values());
  for (const node of nodes) {
    const peers = nodes.filter(n => n.nodeId !== node.nodeId);
    try {
      await axios.post(`http://${node.host}:${node.port}/api/peers`, { peers });
    } catch (err) {
      console.log(`[Gateway] Failed to update peers for ${node.nodeId}`);
    }
  }

  res.status(200).json({ success: true });
});

// Also require axios at the top
const axios = require('axios');


const PORT = process.env.GATEWAY_PORT || 5000;

server.listen(PORT, () => {
  console.log(`Gateway server running on port ${PORT}`);
});
