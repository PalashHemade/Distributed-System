const axios = require('axios');

// Optional static seed list for the gossip fallback, so a node doesn't have
// to assume every peer lives on "localhost" at ports 5001-5003 (true only
// when every process happens to share one machine, as in local dev). Format:
// "node-A@10.0.1.5:5001,node-B@10.0.1.6:5002,node-C@10.0.1.7:5003". Optional —
// local dev works with none of this set, same as before.
function parsePeerNodesEnv() {
  const raw = process.env.PEER_NODES;
  if (!raw) return [];
  return raw.split(',').map(entry => {
    const [nodeId, hostPort] = entry.trim().split('@');
    const [host, port] = (hostPort || '').split(':');
    return { nodeId, host, port };
  }).filter(p => p.nodeId && p.host && p.port);
}

// Factory: wraps the two peer-discovery paths every node already relies on —
// Gateway-mediated registration/heartbeat, and the gossip fallback — so
// BaseNode.js only has to call start() instead of owning this logic inline.
module.exports = function peerDiscoveryService(node) {
  let heartbeatInterval = null;
  const staticPeers = parsePeerNodesEnv().filter(p => p.nodeId !== node.nodeId);

  async function registerWithGateway() {
    try {
      await axios.post(`${node.gatewayUrl}/api/registry/register`, {
        nodeId: node.nodeId,
        host: node.selfHost,
        port: node.port
      });
      console.log(`[${node.nodeId}] Registered with Gateway successfully.`);

      if (!heartbeatInterval) {
        heartbeatInterval = setInterval(() => {
          axios.post(`${node.gatewayUrl}/api/registry/heartbeat`, {
            nodeId: node.nodeId,
            // host/port ride along on every heartbeat (not just the initial
            // register call) so the Gateway can re-register this node on
            // the spot if its registry was wiped by a Gateway restart —
            // see registryService.heartbeat's self-heal path.
            host: node.selfHost,
            port: node.port,
            users: node.users,
            resources: node.resources,
            // Piggybacked on the existing heartbeat write path rather than a
            // new polling mechanism — see global-state plan section.
            leader: node.leaderElection.currentLeader,
            lamportClock: node.lamportClock.value,
            clockOffsetMs: node.clockOffsetMs,
            activeLocks: node.leaderElection.getActiveLocks()
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
          senderNode: { nodeId: node.nodeId, host: node.selfHost, port: node.port },
          peers: node.peers
        }).catch(() => {});
      } else if (staticPeers.length > 0) {
        // PEER_NODES is set — use it instead of guessing localhost ports,
        // so gossip can still find peers on separate hosts even before the
        // Gateway has pushed a peer list (e.g. right after boot, or if the
        // Gateway is down — see registryService's self-heal note).
        for (const peer of staticPeers) {
          axios.post(`http://${peer.host}:${peer.port}/api/p2p/gossip`, {
            senderNode: { nodeId: node.nodeId, host: node.selfHost, port: node.port },
            peers: node.peers
          }).catch(() => {});
        }
      } else {
        // No peers known yet and no static seed list — last-resort guess
        // that every process shares this machine (true for local dev only).
        const fallbackPorts = [5001, 5002, 5003].filter(p => p !== node.port);
        for (const port of fallbackPorts) {
          axios.post(`http://localhost:${port}/api/p2p/gossip`, {
            senderNode: { nodeId: node.nodeId, host: node.selfHost, port: node.port },
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
