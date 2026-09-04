import { useState, useEffect } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import './Dashboard.css';

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || 'http://localhost:5000';

function Dashboard() {
  const [nodes, setNodes] = useState([]);
  const [events, setEvents] = useState([]);
  const [filter, setFilter] = useState('All');

  useEffect(() => {
    // Initial fetch
    const fetchStats = async () => {
      try {
        const healthRes = await axios.get(`${GATEWAY_URL}/health`);
        if (healthRes.data.nodes) setNodes(healthRes.data.nodes);

        const eventsRes = await axios.get(`${GATEWAY_URL}/api/monitor/events`);
        setEvents(eventsRes.data);
      } catch (err) {
        console.error('Failed to fetch dashboard stats', err);
      }
    };
    fetchStats();

    // Stream updates via Socket.IO
    const socket = io(GATEWAY_URL);

    socket.on('node_status', (updatedNodes) => {
      setNodes(updatedNodes);
    });

    socket.on('network_event', (event) => {
      setEvents(prev => [...prev, event].slice(-100)); // Keep last 100
    });

    return () => socket.close();
  }, []);

  const filteredEvents = filter === 'All' ? events : events.filter(e => e.type === filter);

  return (
    <div className="dashboard-container">
      <h1>Distributed System Dashboard</h1>
      
      <div className="nodes-section">
        <h2>Network Topology</h2>
        
        <div className="network-visualization">
          <svg width="100%" height="300" className="topology-svg">
            <defs>
              <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#888" />
              </marker>
              <marker id="arrowhead-active" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#4caf50" />
              </marker>
            </defs>
            {nodes.map((n, i) => {
              const angle = (i / nodes.length) * 2 * Math.PI - Math.PI / 2;
              const x = 300 + Math.cos(angle) * 120;
              const y = 150 + Math.sin(angle) * 100;
              n.x = x;
              n.y = y;
              return null;
            })}
            
            {/* Draw lines */}
            {nodes.map(n1 => 
              nodes.map(n2 => {
                if (n1.nodeId >= n2.nodeId) return null;
                return (
                  <line 
                    key={`${n1.nodeId}-${n2.nodeId}`} 
                    x1={n1.x} y1={n1.y} x2={n2.x} y2={n2.y} 
                    stroke="#444" strokeWidth="1" strokeDasharray="5,5" 
                  />
                );
              })
            )}

            {/* Draw active events (last 3 seconds) */}
            {events.filter(e => Date.now() - new Date(e.timestamp).getTime() < 3000).map((ev, idx) => {
              const sNode = nodes.find(n => n.nodeId === ev.sender);
              const rNode = nodes.find(n => n.nodeId === ev.receiver);
              if (sNode && rNode) {
                return (
                  <g key={`ev-${idx}`}>
                    <line 
                      x1={sNode.x} y1={sNode.y} x2={rNode.x} y2={rNode.y} 
                      stroke="#4caf50" strokeWidth="2" markerEnd="url(#arrowhead-active)" 
                      className="animated-line"
                    />
                    <circle 
                      cx={sNode.x} cy={sNode.y} r="4" fill="#4caf50" 
                      className="pulsing-dot"
                    >
                      <animateMotion path={`M 0 0 L ${rNode.x - sNode.x} ${rNode.y - sNode.y}`} dur="1s" fill="freeze" />
                    </circle>
                    <text 
                      x={(sNode.x + rNode.x)/2} y={(sNode.y + rNode.y)/2 - 10} 
                      fill="#fff" fontSize="10" textAnchor="middle" className="event-label"
                    >
                      {ev.operation || ev.type}
                    </text>
                  </g>
                );
              }
              return null;
            })}

            {/* Draw nodes */}
            {nodes.map((n) => (
              <g key={n.nodeId} transform={`translate(${n.x}, ${n.y})`}>
                <circle r="30" fill={n.status === 'ONLINE' ? '#252525' : '#444'} stroke={n.status === 'ONLINE' ? '#4caf50' : '#f44336'} strokeWidth="3" />
                <text x="0" y="5" fill="#fff" fontSize="12" textAnchor="middle" fontWeight="bold">{n.nodeId}</text>
              </g>
            ))}
          </svg>
        </div>

        <div className="nodes-grid">
          {nodes.map(node => (
            <div key={node.nodeId} className={`node-card ${node.status.toLowerCase()}`}>
              <h3>{node.nodeId}</h3>
              <p>{node.host || 'localhost'}:{node.port}</p>
              <p>Status: <strong className={node.status.toLowerCase()}>{node.status}</strong></p>
              <p>Users: {node.users || 0}</p>
              <p>Resources: {node.resources || 0}</p>
              <p className="last-seen">Last contact: {new Date(node.lastSeen).toLocaleTimeString()}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="events-section">
        <div className="events-header">
          <h2>Communication Monitor</h2>
          <div className="filters">
            {['All', 'RPC', 'MESSAGE', 'P2P', 'STREAM'].map(f => (
              <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>{f}</button>
            ))}
          </div>
        </div>

        <table className="events-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Type</th>
              <th>Sender</th>
              <th>Receiver</th>
              <th>Operation</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredEvents.slice().reverse().map((ev, idx) => (
              <tr key={idx}>
                <td>{new Date(ev.timestamp).toLocaleTimeString()}</td>
                <td><span className={`event-type ${ev.type ? ev.type.toLowerCase() : ''}`}>{ev.type}</span></td>
                <td>{ev.sender}</td>
                <td>{ev.receiver}</td>
                <td>{ev.operation}</td>
                <td>{ev.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default Dashboard;
