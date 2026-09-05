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
       const resourceData = message.payload;
       
       // Attempt to replicate the file from the sender
       const senderPeer = this.node.peers.find(p => p.nodeId === senderNodeId);
       if (senderPeer) {
         try {
           const fs = require('fs');
           const path = require('path');
           
           // The URL to download from the original node
           const url = `http://${senderPeer.host}:${senderPeer.port}/uploads/${senderNodeId}/${resourceData.fileName}`;
           const response = await require('axios').get(url, { responseType: 'stream' });
           
           // Ensure local upload directory exists
           const dir = path.resolve(__dirname, `../../../../uploads/${this.node.nodeId}`);
           if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
           
           const destPath = path.join(dir, resourceData.fileName);
           const writer = fs.createWriteStream(destPath);
           response.data.pipe(writer);
           
           await new Promise((resolve, reject) => {
             writer.on('finish', resolve);
             writer.on('error', reject);
           });
           
           console.log(`[REPLICATION] Node ${this.node.nodeId} successfully replicated ${resourceData.fileName}`);
         } catch (error) {
           console.error(`[REPLICATION ERROR] Failed to replicate from ${senderNodeId}:`, error.message);
         }
       }
    }
    
    res.status(200).json({ success: true, receivedAt: Date.now() });
  }
}

module.exports = PeerManager;
