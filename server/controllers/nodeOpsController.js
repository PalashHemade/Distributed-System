// Thin delegation layer for node-to-node plumbing. Each distributed-comm
// primitive (RpcServer, MessageBus, PeerManager) already encapsulates its
// own protocol logic in server/distributed/* — this controller's only job is
// routing an HTTP request to the right one, which is why these handlers are
// one line each rather than hiding real logic behind a "thin" label.
module.exports = function nodeOpsController(node, peerDiscovery) {
  function health(req, res) {
    res.status(200).json({
      nodeId: node.nodeId,
      status: 'ONLINE',
      timestamp: new Date().toISOString(),
      users: node.users,
      resources: node.resources,
      outboxPending: node.outbox.pendingCount
    });
  }

  function updatePeers(req, res) {
    node.peers = req.body.peers;
    console.log(`[${node.nodeId}] Updated peers:`, node.peers.map(p => p.nodeId).join(', '));
    res.status(200).json({ success: true });
  }

  function rpc(req, res) {
    node.rpcServer.handleRequest(req, res);
  }

  function messagingReceive(req, res) {
    node.messageBus.handleIncoming(req.body);
    res.status(200).json({ success: true });
  }

  function p2pReceive(req, res) {
    node.peerManager.handleIncoming(req, res);
  }

  function gossip(req, res) {
    const { senderNode, peers } = req.body;
    const updatedPeers = peerDiscovery.mergeGossip(senderNode, peers);
    res.status(200).json({ success: true, peers: updatedPeers });
  }

  return { health, updatePeers, rpc, messagingReceive, p2pReceive, gossip };
};
