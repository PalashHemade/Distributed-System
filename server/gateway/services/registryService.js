const axios = require('axios');

const OFFLINE_AFTER_MS = 10000;

// Factory so the registry's state (the Map of known nodes) and its "tell
// everyone about everyone" push both live behind one object instead of
// module-level globals — gateway/server.js owns the single instance.
module.exports = function registryService(onChange) {
  const registeredNodes = new Map();

  function register(nodeId, host, port) {
    registeredNodes.set(nodeId, {
      nodeId, host, port,
      lastSeen: Date.now(),
      status: 'ONLINE',
      users: 0,
      resources: 0
    });
    console.log(`[Gateway] Registered node: ${nodeId}`);
    onChange();
    pushPeerListToAllNodes();
  }

  function heartbeat(nodeId, users, resources) {
    const node = registeredNodes.get(nodeId);
    if (!node) return false;
    node.lastSeen = Date.now();
    node.status = 'ONLINE';
    if (users !== undefined) node.users = users;
    if (resources !== undefined) node.resources = resources;
    onChange();
    return true;
  }

  function sweepOffline() {
    let changed = false;
    const now = Date.now();
    for (const node of registeredNodes.values()) {
      if (now - node.lastSeen > OFFLINE_AFTER_MS && node.status !== 'OFFLINE') {
        node.status = 'OFFLINE';
        changed = true;
      }
    }
    if (changed) onChange();
  }

  function getAll() {
    return Array.from(registeredNodes.values());
  }

  // Whenever the registry changes, every node gets the full peer list (minus
  // itself) pushed to it — this is the "Gateway-mediated" half of the
  // dual-path peer discovery (the other half being the nodes' own gossip).
  async function pushPeerListToAllNodes() {
    const nodes = getAll();
    for (const node of nodes) {
      const peers = nodes.filter(n => n.nodeId !== node.nodeId);
      try {
        await axios.post(`http://${node.host}:${node.port}/api/peers`, { peers });
      } catch (err) {
        console.log(`[Gateway] Failed to update peers for ${node.nodeId}`);
      }
    }
  }

  return { register, heartbeat, sweepOffline, getAll };
};
