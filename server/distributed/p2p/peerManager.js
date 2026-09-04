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

  handleIncoming(req, res) {
    const { senderNode, data } = req.body;
    console.log(`[P2P] ${this.node.nodeId} received P2P data from ${senderNode}`);
    
    // Process data depending on logic later
    res.status(200).json({ success: true, receivedAt: Date.now() });
  }
}

module.exports = PeerManager;
