const BaseNode = require('../BaseNode');

const nodeId = process.env.NODE_ID || 'node-C';
const port = process.env.NODE_PORT || 5003;

const node = new BaseNode(nodeId, port);
node.start();
