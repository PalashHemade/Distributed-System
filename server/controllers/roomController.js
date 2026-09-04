const { Room } = require('../models');
const { v4: uuidv4 } = require('uuid');

const createRoom = async (req, res) => {
  const { name, createdBy } = req.body;
  const { activeNodes } = req; // Assuming middleware adds this

  if (!activeNodes || activeNodes.length === 0) {
    return res.status(500).json({ error: 'No active nodes available to host the room' });
  }

  // Simple round-robin or random allocation
  const ownerNode = activeNodes[Math.floor(Math.random() * activeNodes.length)];
  const roomId = `DS-${Math.floor(100 + Math.random() * 900)}`;

  try {
    const newRoom = new Room({
      roomId,
      name,
      ownerNodeId: ownerNode.nodeId,
      createdBy
    });
    
    // We would normally save to MongoDB here, but for now we just return it
    // await newRoom.save();
    
    res.status(201).json(newRoom);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getRooms = async (req, res) => {
  try {
    // const rooms = await Room.find();
    // For now return an empty array if MongoDB isn't connected
    res.status(200).json([]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = { createRoom, getRooms };
