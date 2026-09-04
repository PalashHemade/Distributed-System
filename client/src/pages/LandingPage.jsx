import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import './LandingPage.css';

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || 'http://localhost:5000';

function LandingPage() {
  const [nodes, setNodes] = useState([]);
  const [userName, setUserName] = useState('');
  const [roomName, setRoomName] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    // Fetch available nodes from gateway health check
    const fetchNodes = async () => {
      try {
        const res = await axios.get(`${GATEWAY_URL}/health`);
        if (res.data.nodes) {
          setNodes(res.data.nodes.filter(n => n.status === 'ONLINE'));
        }
      } catch (err) {
        console.error('Failed to fetch nodes from Gateway:', err);
      }
    };
    fetchNodes();
  }, []);

  const handleCreateRoom = async (e) => {
    e.preventDefault();
    if (!userName || !roomName) return alert('Please enter name and room name');
    
    // In FA-1, we can either call Gateway to create, or pick a node directly.
    // Let's assume gateway has a route /api/rooms/create to assign a node
    // Wait, we didn't add /api/rooms/create to Gateway yet, let's just pick a random node from client for simplicity,
    // OR I will add that route to Gateway next.
    
    if (nodes.length === 0) return alert('No active nodes available');
    
    const randomNode = nodes[Math.floor(Math.random() * nodes.length)];
    const roomId = `DS-${Math.floor(100 + Math.random() * 900)}`;

    navigate(`/room/${roomId}?node=${randomNode.nodeId}&user=${userName}&port=${randomNode.port}`);
  };

  const handleJoinRoom = (e) => {
    e.preventDefault();
    if (!userName || !roomName) return alert('Please enter name and room ID (e.g. DS-101)');
    
    if (nodes.length === 0) return alert('No active nodes available');
    
    // Just pick a random node to connect through (Distributed System feature!)
    const randomNode = nodes[Math.floor(Math.random() * nodes.length)];
    
    navigate(`/room/${roomName}?node=${randomNode.nodeId}&user=${userName}&port=${randomNode.port}`);
  };

  return (
    <div className="landing-container">
      <div className="landing-card">
        <h1>Distributed Collaborative Study Room</h1>
        <p className="subtitle">Connect to the MERN distributed network</p>
        
        <div className="node-status">
          <p>Active Network Nodes: {nodes.length}</p>
          <div className="node-list">
            {nodes.map(n => (
              <span key={n.nodeId} className="node-badge">{n.nodeId}</span>
            ))}
          </div>
        </div>

        <div className="forms-container">
          <form className="join-form" onSubmit={handleCreateRoom}>
            <h3>Create a Room</h3>
            <input 
              type="text" 
              placeholder="Your Name" 
              value={userName} 
              onChange={e => setUserName(e.target.value)} 
              required
            />
            <input 
              type="text" 
              placeholder="New Room Name" 
              value={roomName} 
              onChange={e => setRoomName(e.target.value)} 
            />
            <button type="submit" className="btn-primary">Create Study Room</button>
          </form>

          <form className="join-form" onSubmit={handleJoinRoom}>
            <h3>Join a Room</h3>
            <input 
              type="text" 
              placeholder="Your Name" 
              value={userName} 
              onChange={e => setUserName(e.target.value)} 
              required
            />
            <input 
              type="text" 
              placeholder="Room ID (e.g. DS-101)" 
              value={roomName} 
              onChange={e => setRoomName(e.target.value)} 
            />
            <button type="submit" className="btn-secondary">Join Study Room</button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default LandingPage;
