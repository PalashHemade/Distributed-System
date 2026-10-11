const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { vcIncrement, vcMerge } = require('../../services/logicalClocks');

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
    // Lamport/vector clocks ride every cross-node message this bus already
    // sends — one hook point here covers chat, admission, resources, raise
    // hand, attendance, election, locks, everything, rather than stamping
    // each feature individually.
    this.node.vectorClock = vcIncrement(this.node.vectorClock, this.node.nodeId);
    const message = {
      messageId: uuidv4(),
      type,
      senderNode: this.node.nodeId,
      timestamp: Date.now(),
      lamportTs: this.node.lamportClock.send(),
      vectorClock: { ...this.node.vectorClock },
      payload
    };

    console.log(`[MSG BUS] Publishing ${type} message (ID: ${message.messageId})`);

    // Deliver to this node's own local subscribers immediately. publish()
    // below only reaches OTHER nodes over HTTP — without this, anyone
    // connected to the SAME node that triggered the event (e.g. a teacher
    // and the student requesting to join both happening to land on node-A)
    // would never see it in real time, only after some unrelated action
    // forces a refetch. This is not a receive() — our own clock was already
    // ticked by send() above, so we dispatch the already-stamped message
    // as-is rather than merging/incrementing a second time.
    this._dispatchLocal(message);

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

    this.node.lamportClock.receive(message.lamportTs || 0);
    if (message.vectorClock) {
      this.node.vectorClock = vcIncrement(vcMerge(this.node.vectorClock, message.vectorClock), this.node.nodeId);
    }

    this._dispatchLocal(message);
  }

  _dispatchLocal(message) {
    if (this.listeners.has(message.type)) {
      const callbacks = this.listeners.get(message.type);
      callbacks.forEach(cb => cb(message));
    }
  }
}

module.exports = MessageBus;
