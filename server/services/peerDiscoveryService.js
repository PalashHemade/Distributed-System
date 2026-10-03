const axios = require('axios');

// Factory: wraps the two peer-discovery paths every node already relies on —
// Gateway-mediated registration/heartbeat, and the gossip fallback — so
// BaseNode.js only has to call start() instead of owning this logic inline.
module.exports = function peerDiscoveryService(node) {
  let heartbeatInterval = null;

  async function registerWithGateway() {
    try {
      await axios.post(`${node.gatewayUrl}/api/registry/register`, {
        nodeId: node.nodeId,
        host: 'localhost',
        port: node.port
      });
      console.log(`[${node.nodeId}] Registered with Gateway successfully.`);

      if (!heartbeatInterval) {
        heartbeatInterval = setInterval(() => {
          axios.post(`${node.gatewayUrl}/api/registry/heartbeat`, {
            nodeId: node.nodeId,
            users: node.users,
            resources: node.resources
          }).catch(() => {});
        }, 5000);
      }
    } catch (error) {
      console.error(`[${node.nodeId}] Failed to register with Gateway:`, error.message);
      setTimeout(registerWithGateway, 5000);
    }
  }

  function startGossip() {
    setInterval(() => {
      if (node.peers.length > 0) {
        const peer = node.peers[Math.floor(Math.random() * node.peers.length)];
        axios.post(`http://${peer.host}:${peer.port}/api/p2p/gossip`, {
          senderNode: { nodeId: node.nodeId, host: 'localhost', port: node.port },
          peers: node.peers
        }).catch(() => {});
      } else {
        const fallbackPorts = [5001, 5002, 5003].filter(p => p !== node.port);
        for (const port of fallbackPorts) {
          axios.post(`http://localhost:${port}/api/p2p/gossip`, {
            senderNode: { nodeId: node.nodeId, host: 'localhost', port: node.port },
            peers: node.peers
          }).catch(() => {});
        }
      }
    }, 10000);
  }

  // Merge logic for an incoming gossip payload — additive only (never drops
  // a peer we already know about), which is what makes gossip safe to run
  // independently of the Gateway's own (replace-wholesale) peer push.
  function mergeGossip(senderNode, incomingPeers) {
    let changed = false;
    if (senderNode && !node.peers.find(p => p.nodeId === senderNode.nodeId)) {
      node.peers.push(senderNode);
      changed = true;
    }
    if (Array.isArray(incomingPeers)) {
      for (const p of incomingPeers) {
        if (p.nodeId !== node.nodeId && !node.peers.find(existing => existing.nodeId === p.nodeId)) {
          node.peers.push(p);
          changed = true;
        }
      }
    }
    if (changed) console.log(`[${node.nodeId}] Updated peers via GOSSIP protocol:`, node.peers.map(p => p.nodeId).join(', '));
    return node.peers;
  }

  function start() {
    registerWithGateway();
    startGossip();
  }

  return { start, mergeGossip };
};
