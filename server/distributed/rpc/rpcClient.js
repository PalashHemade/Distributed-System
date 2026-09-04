const axios = require('axios');
const RpcProtocol = require('./rpcProtocol');

class RpcClient {
  constructor(node) {
    this.node = node; // Reference to the BaseNode
    this.timeout = 5000;
  }

  async call(targetNodeId, method, params = {}) {
    const messageId = require('uuid').v4();
    const payload = {
      messageId,
      method,
      params,
      senderNodeId: this.node.nodeId,
    };

    const targetNode = this.node.peers.find((p) => p.nodeId === targetNodeId);
    if (!targetNode) throw new Error(`Target node ${targetNodeId} not found`);

    try {
      // Log outgoing RPC
      require('axios').post(this.node.gatewayUrl + '/api/monitor/message', {
        timestamp: Date.now(),
        type: 'RPC',
        sender: this.node.nodeId,
        receiver: targetNodeId,
        operation: method,
        status: 'REQUEST'
      }).catch(()=>{});

      const response = await axios.post(`http://${targetNode.host}:${targetNode.port}/api/rpc`, payload, { timeout: this.timeout });
      
      // Log successful RPC
      require('axios').post(this.node.gatewayUrl + '/api/monitor/message', {
        timestamp: Date.now(),
        type: 'RPC',
        sender: targetNodeId,
        receiver: this.node.nodeId,
        operation: `${method}_RESPONSE`,
        status: 'SUCCESS'
      }).catch(()=>{});

      if (response.data.error) throw new Error(response.data.error);
      return response.data.result;
    } catch (error) {
      // Log failed RPC
      require('axios').post(this.node.gatewayUrl + '/api/monitor/message', {
        timestamp: Date.now(),
        type: 'RPC',
        sender: targetNodeId,
        receiver: this.node.nodeId,
        operation: `${method}_RESPONSE`,
        status: 'FAILED'
      }).catch(()=>{});

      console.error(`[RPC Client] Call to ${targetNodeId} failed:`, error.message);
      throw error;
    }
  }
}

module.exports = RpcClient;
