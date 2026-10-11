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
      resources: 0,
      leader: null,
      lamportClock: 0,
      clockOffsetMs: 0,
      activeLocks: []
    });
    console.log(`[Gateway] Registered node: ${nodeId}`);
    onChange();
    pushPeerListToAllNodes();
  }

  function heartbeat(nodeId, fields) {
    let node = registeredNodes.get(nodeId);
    if (!node) {
      // The Gateway holds this registry only in memory, so restarting it
      // (a deploy, a crash, an ASG replacement on AWS) wipes it while every
      // node keeps running and keeps heartbeating. Without this, a node
      // that registered once before the restart would heartbeat forever
      // into a registry that no longer has it, never reappearing for any
      // new client — permanently "lost" despite being perfectly healthy.
      // Re-registering here (using the host/port the heartbeat itself now
      // carries) makes the registry self-healing on the node's very next
      // heartbeat tick instead of requiring every node to be restarted too.
      if (!fields.host || !fields.port) return false;
      console.log(`[Gateway] Unknown node "${nodeId}" heartbeated — re-registering (registry was likely reset by a Gateway restart)`);
      register(nodeId, fields.host, fields.port);
      node = registeredNodes.get(nodeId);
    }
    node.lastSeen = Date.now();
    node.status = 'ONLINE';
    const { users, resources, leader, lamportClock, clockOffsetMs, activeLocks } = fields;
    if (users !== undefined) node.users = users;
    if (resources !== undefined) node.resources = resources;
    if (leader !== undefined) node.leader = leader;
    if (lamportClock !== undefined) node.lamportClock = lamportClock;
    if (clockOffsetMs !== undefined) node.clockOffsetMs = clockOffsetMs;
    if (activeLocks !== undefined) node.activeLocks = activeLocks;
    onChange();
    return true;
  }

  // Global state (Section 5 of the plan): majority vote across nodes' own
  // self-reported leader field, since there's no single authoritative source
  // during a brief post-election window where nodes disagree transiently.
  function getGlobalState() {
    const nodes = getAll();
    const counts = new Map();
    for (const n of nodes) {
      // A dead node's last-reported leader is frozen at whatever it believed
      // right before it went silent — it never gets to hear about (or vote
      // in) any election that happens after. Counting it here would let
      // stale votes from nodes that are no longer part of the cluster
      // outvote the survivors' current, correct answer (exactly what
      // happened when two dead nodes' frozen "the old leader" votes
      // outnumbered the one live node's fresh self-election).
      if (n.status !== 'ONLINE') continue;
      if (!n.leader) continue;
      counts.set(n.leader, (counts.get(n.leader) || 0) + 1);
    }
    let leader = null;
    let max = 0;
    for (const [candidate, count] of counts) {
      if (count > max) { max = count; leader = candidate; }
    }
    const clocks = {};
    const activeLocks = new Set();
    for (const n of nodes) {
      clocks[n.nodeId] = n.lamportClock;
      for (const key of n.activeLocks || []) activeLocks.add(key);
    }
    return { nodes, leader, clocks, activeLocks: Array.from(activeLocks) };
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

  return { register, heartbeat, sweepOffline, getAll, getGlobalState };
};
