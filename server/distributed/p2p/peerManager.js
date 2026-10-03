const axios = require('axios');

class PeerManager {
  constructor(node) {
    this.node = node; // Reference to BaseNode
  }

  // Direct P2P send to a peer bypassing the Gateway
  async sendToPeer(targetNodeId, message) {
    const targetPeer = this.node.peers.find(p => p.nodeId === targetNodeId);
    if (!targetPeer) throw new Error(`Peer ${targetNodeId} not found`);

    try {
      require('axios').post(this.node.gatewayUrl + '/api/monitor/message', {
        timestamp: Date.now(),
        type: 'P2P',
        sender: this.node.nodeId,
        receiver: targetNodeId,
        operation: message.type,
        status: 'DELIVERED'
      }).catch(()=>{});

      await axios.post(`http://${targetPeer.host}:${targetPeer.port}/api/p2p/receive`, {
        senderNodeId: this.node.nodeId,
        message
      });
    } catch (error) {
      require('axios').post(this.node.gatewayUrl + '/api/monitor/message', {
        timestamp: Date.now(),
        type: 'P2P',
        sender: this.node.nodeId,
        receiver: targetNodeId,
        operation: message.type,
        status: 'FAILED'
      }).catch(()=>{});
      console.error(`[P2P ERROR] ${this.node.nodeId} -> ${targetNodeId} | Failed to send data: ${error.message}`);
      throw error;
    }
  }

  async handleIncoming(req, res) {
    const { senderNodeId, message } = req.body;
    console.log(`[P2P] ${this.node.nodeId} received P2P message from ${senderNodeId}: ${message.type}`);

    if (message.type === 'RESOURCE_SHARED') {
      // Files live centrally in S3 now (see BaseNode.js upload route) — there is no
      // local file to copy anymore. This P2P notification is kept purely to
      // demonstrate the node-to-node channel; the metadata itself also arrives via
      // the MessageBus broadcast, which is what actually updates resourceHistory/UI.
      console.log(`[P2P] ${this.node.nodeId} notified of resource "${message.payload.originalName}" from ${senderNodeId} (stored in S3, no local replication needed)`);
    }

    res.status(200).json({ success: true, receivedAt: Date.now() });
  }
}

module.exports = PeerManager;
