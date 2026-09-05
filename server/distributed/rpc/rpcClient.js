const axios = require('axios');
const RpcProtocol = require('./rpcProtocol');

class RpcClient {
  constructor(node) {
    this.node = node; // Reference to the BaseNode
    this.timeout = 1500; // Fast timeout (1.5s) to avoid cascading hangs
    this.circuitBreakers = new Map(); // targetNodeId -> { failures: 0, cooldownUntil: 0 }
  }

  getCircuitState(nodeId) {
    if (!this.circuitBreakers.has(nodeId)) {
      this.circuitBreakers.set(nodeId, { failures: 0, cooldownUntil: 0 });
    }
    return this.circuitBreakers.get(nodeId);
  }

  async call(targetNodeId, method, params = {}) {
    const cbState = this.getCircuitState(targetNodeId);
    
    // Fast-fail if circuit breaker is OPEN
    if (Date.now() < cbState.cooldownUntil) {
      console.warn(`[CIRCUIT BREAKER] Fast-failing RPC to ${targetNodeId}. Circuit is OPEN.`);
      throw new Error(`Circuit Breaker OPEN for node ${targetNodeId}`);
    }
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
      
      // Success: Reset circuit breaker failures
      cbState.failures = 0;
      
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
      
      // Failure: Trip circuit breaker if threshold reached
      cbState.failures += 1;
      if (cbState.failures >= 2) {
        cbState.cooldownUntil = Date.now() + 10000; // 10 seconds cooldown
        console.warn(`[CIRCUIT BREAKER] Tripped for ${targetNodeId}. Cooldown: 10s`);
      }
      
      throw error;
    }
  }
}

module.exports = RpcClient;
