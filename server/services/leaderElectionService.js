// Bully leader election, using the existing RpcClient for both legs of the
// protocol instead of inventing a new transport:
//   - failure detection: a `ping` RPC against the current leader, reusing
//     RpcClient's existing circuit breaker (opens after 2 consecutive
//     failures) rather than a second, hand-rolled threshold. This IS the
//     project's beacon/heartbeat protocol item — no separate mechanism.
//   - ELECTION / OK: an `electionPing` RPC call to each higher-ranked peer —
//     RPC already gives a timeout and a reply for free, so there's no need
//     to hand-roll correlation/timeout bookkeeping on top of MessageBus
//     (which has no request/response concept at all).
//   - COORDINATOR: a genuine fire-and-forget broadcast, exactly the shape
//     MessageBus is already used for elsewhere (RAISE_HAND, etc).
//
// The same leader also coordinates a small distributed mutex (Section 4 of
// the plan) — acquireLock/releaseLock, used by resourceService.decideShareRequest
// to prevent a share-approval decision from racing across two sessions.
const PING_INTERVAL_MS = 5000;
const ELECTION_BOOTSTRAP_DELAY_MS = 4000;
const ELECTION_OK_WAIT_MS = 3000;

function rank(nodeId, forcedLeaderId) {
  if (forcedLeaderId && nodeId === forcedLeaderId) return Infinity;
  const match = /-(\w)$/.exec(nodeId);
  return match ? match[1].toUpperCase().charCodeAt(0) : 0;
}

module.exports = function leaderElectionService(node) {
  const forcedLeaderId = process.env.LEADER_ID || null;
  let currentLeader = null;
  let electionInProgress = false;
  let pingTimer = null;

  // resourceKey -> { holder: nodeId|null, queue: string[] } — leader-only state.
  const locks = new Map();

  function myRank() {
    return rank(node.nodeId, forcedLeaderId);
  }

  async function startElection() {
    if (electionInProgress) return;
    electionInProgress = true;
    console.log(`[ELECTION] ${node.nodeId} starting an election`);

    const higherPeers = node.peers.filter(p => rank(p.nodeId, forcedLeaderId) > myRank());

    if (higherPeers.length === 0) {
      becomeLeader();
      electionInProgress = false;
      return;
    }

    const results = await Promise.allSettled(
      higherPeers.map(p => node.rpcClient.call(p.nodeId, 'electionPing'))
    );
    const anyoneHigherAlive = results.some(r => r.status === 'fulfilled');

    if (!anyoneHigherAlive) {
      becomeLeader();
    } else {
      // Someone higher-ranked is alive and will run their own election; wait
      // for their COORDINATOR broadcast rather than declaring prematurely.
      setTimeout(() => {
        if (!currentLeader) startElection();
      }, ELECTION_OK_WAIT_MS);
    }
    electionInProgress = false;
  }

  function becomeLeader() {
    currentLeader = node.nodeId;
    console.log(`[ELECTION] ${node.nodeId} declares itself LEADER`);
    node.messageBus.publish('COORDINATOR', { leaderId: node.nodeId });
    logElectionEvent('LEADER');
  }

  function logElectionEvent(status) {
    require('axios').post(`${node.gatewayUrl}/api/monitor/message`, {
      timestamp: Date.now(),
      type: 'ELECTION',
      sender: node.nodeId,
      operation: 'COORDINATOR',
      status
    }).catch(() => {});
  }

  // Called when a lower-ranked peer pings us during their election — the RPC
  // reply itself is the "OK"; we also start our own election afterward,
  // per standard Bully (a higher node hearing from a lower one means it's
  // time to check whether *it* should be leader too).
  function onElectionPing() {
    setTimeout(() => startElection(), 0);
    return { ok: true };
  }

  function onCoordinator(payload, senderNode) {
    const announced = payload.leaderId || senderNode;
    currentLeader = announced;
    electionInProgress = false;
    console.log(`[ELECTION] ${node.nodeId} acknowledges leader: ${announced}`);
  }

  // --- Failure detection against the current leader ---
  function startLeaderPing() {
    pingTimer = setInterval(async () => {
      if (!currentLeader || currentLeader === node.nodeId) return;
      try {
        await node.rpcClient.call(currentLeader, 'ping');
      } catch (err) {
        console.warn(`[ELECTION] Leader ${currentLeader} unreachable, starting election`);
        currentLeader = null;
        startElection();
      }
    }, PING_INTERVAL_MS);
  }

  // --- Distributed mutual exclusion, coordinated by whichever node is leader ---
  function acquireLock(resourceKey) {
    if (currentLeader !== node.nodeId) return { granted: false, error: 'Not the current leader' };
    let lock = locks.get(resourceKey);
    if (!lock) {
      lock = { holder: null, queue: [] };
      locks.set(resourceKey, lock);
    }
    if (!lock.holder) {
      lock.holder = 'held';
      return { granted: true };
    }
    return { granted: false, queued: true };
  }

  function releaseLock(resourceKey) {
    locks.delete(resourceKey);
    return { released: true };
  }

  function getActiveLocks() {
    return Array.from(locks.keys());
  }

  function start() {
    node.messageBus.subscribe('COORDINATOR', (msg) => onCoordinator(msg.payload, msg.senderNode));
    setTimeout(() => startElection(), ELECTION_BOOTSTRAP_DELAY_MS);
    startLeaderPing();
  }

  return {
    start,
    startElection,
    onElectionPing,
    acquireLock,
    releaseLock,
    getActiveLocks,
    get currentLeader() { return currentLeader; }
  };
};
