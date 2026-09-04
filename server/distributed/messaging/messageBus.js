const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

class MessageBus {
  constructor(node) {
    this.node = node;
    this.listeners = new Map(); // Event -> Array of callbacks
  }

  // Subscribe to local message events
  subscribe(type, callback) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(callback);
  }

  // Publish message to all known peers (and Gateway if needed)
  async publish(type, payload, targetNodeId = null) {
    const message = {
      messageId: uuidv4(),
      type,
      senderNode: this.node.nodeId,
      timestamp: Date.now(),
      payload
    };

    console.log(`[MSG BUS] Publishing ${type} message (ID: ${message.messageId})`);

    let targets = [];
    if (targetNodeId) {
      const peer = this.node.peers.find(p => p.nodeId === targetNodeId);
      if (peer) targets.push(peer);
    } else {
      targets = this.node.peers;
      // Also send to gateway for monitor if required
      targets.push({ host: 'localhost', port: process.env.GATEWAY_PORT || 5000, isGateway: true });
    }

    const promises = targets.map(target => {
      const url = target.isGateway 
        ? `http://${target.host}:${target.port}/api/monitor/message` 
        : `http://${target.host}:${target.port}/api/messaging/receive`;
      
      return axios.post(url, message).catch(err => {
        console.warn(`[MSG BUS] Failed to send message to ${target.nodeId || 'gateway'}`);
      });
    });

    await Promise.all(promises);
  }

  // Handle incoming message from another node
  handleIncoming(message) {
    console.log(`[MSG BUS] Received ${message.type} from ${message.senderNode} (ID: ${message.messageId})`);
    
    if (this.listeners.has(message.type)) {
      const callbacks = this.listeners.get(message.type);
      callbacks.forEach(cb => cb(message));
    }
  }
}

module.exports = MessageBus;
