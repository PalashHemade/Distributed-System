import { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import io from 'socket.io-client';
import axios from 'axios';
import './StudyRoom.css';

function StudyRoom() {
  const { roomId } = useParams();
  const [searchParams] = useSearchParams();
  const userName = searchParams.get('user');
  const nodeId = searchParams.get('node');
  const nodePort = searchParams.get('port');

  const [socket, setSocket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [inputMsg, setInputMsg] = useState('');
  
  // Resources
  const [file, setFile] = useState(null);
  const [resources, setResources] = useState([]);

  // WebRTC
  const [callActive, setCallActive] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const localStream = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnection = useRef(null);

  useEffect(() => {
    if (!nodePort) return;
    
    // Fetch initial resources from local node DB (or memory)
    axios.get(`http://localhost:${nodePort}/api/resources/room/${roomId}`)
      .then(res => setResources(res.data))
      .catch(err => console.log('Failed to fetch resources', err));
      
    // Fetch initial chat history from local node memory
    axios.get(`http://localhost:${nodePort}/api/chat/room/${roomId}`)
      .then(res => setMessages(res.data))
      .catch(err => console.log('Failed to fetch chat history', err));
      
    const newSocket = io(`http://localhost:${nodePort}`);
    
    newSocket.on('connect', () => {
      newSocket.emit('join_room', { roomId, user: { name: userName } });
    });

    newSocket.on('chat_message', (envelope) => {
      if (!envelope) return;
      setMessages(prev => [...prev, envelope]);
    });
    
    newSocket.on('user_joined', (user) => {
      if (!user) return;
      setParticipants(prev => [...prev, { ...user, status: 'Online' }]);
      setMessages(prev => [...prev, { type: 'SYSTEM', payload: { text: `${user.name} joined from ${user.nodeId}` } }]);
    });

    newSocket.on('user_left', (user) => {
      if (!user) return;
      setParticipants(prev => prev.filter(p => p.socketId !== user.socketId));
      setMessages(prev => [...prev, { type: 'SYSTEM', payload: { text: `${user.name} left` } }]);
    });

    newSocket.on('resource_shared', (resource) => {
      setResources(prev => [...prev, resource]);
    });

    // WebRTC Signaling Handlers
    newSocket.on('webrtc_offer', async (data) => {
      if (!peerConnection.current) {
        await startWebRTC(false);
      }
      try {
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerConnection.current.createAnswer();
        await peerConnection.current.setLocalDescription(answer);
        newSocket.emit('webrtc_answer', { roomId, answer });
      } catch (err) {
        console.error('Error handling webrtc_offer:', err);
      }
    });

    newSocket.on('webrtc_answer', async (data) => {
      try {
        if (peerConnection.current) {
          await peerConnection.current.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
      } catch (err) {
        console.error('Error handling webrtc_answer:', err);
      }
    });

    newSocket.on('webrtc_ice', async (data) => {
      try {
        if (peerConnection.current) {
          await peerConnection.current.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      } catch (err) {
        console.error('Error adding ice candidate:', err);
      }
    });

    setSocket(newSocket);
    return () => newSocket.close();
  }, [roomId, userName, nodeId, nodePort]);

  const sendMessage = (e) => {
    e.preventDefault();
    if (!inputMsg.trim() || !socket) return;
    
    const msgData = { text: inputMsg };
    socket.emit('chat_message', { roomId, message: msgData, senderUser: userName });
    
    setMessages(prev => [...prev, {
      type: "CHAT_MESSAGE",
      senderUser: userName,
      timestamp: Date.now(),
      payload: msgData
    }]);
    
    setInputMsg('');
  };

  const handleFileUpload = async (e) => {
    e.preventDefault();
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('roomId', roomId);
    try {
      await axios.post(`http://localhost:${nodePort}/api/resources/upload`, formData);
      alert('File successfully uploaded to the distributed network.');
      setFile(null);
    } catch (err) {
      alert(`Upload failed: The connected node (${nodeId}) appears to be unreachable or offline.`);
    }
  };

  const handleResourceDownload = async (fileName) => {
    try {
      const res = await axios.get(`http://localhost:${nodePort}/api/resources/find/${fileName}`);
      window.open(res.data.url, '_blank');
    } catch (err) {
      alert(`Download failed: Could not locate '${fileName}' across the distributed network or RPC timed out.`);
    }
  };

  const handleLeaveRoom = () => {
    endCall();
    if (socket) socket.close();
    window.location.href = '/';
  };

  const startWebRTC = async (isCaller = true) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStream.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      setCallActive(true);
      setAudioEnabled(true);
      setVideoEnabled(true);
      setScreenSharing(false);

      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      peerConnection.current = pc;

      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      pc.onicecandidate = (event) => {
        if (event.candidate && socket) {
          socket.emit('webrtc_ice', { roomId, candidate: event.candidate });
        }
      };

      pc.ontrack = (event) => {
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = event.streams[0];
      };

      if (isCaller && socket) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('webrtc_offer', { roomId, offer });
      }
    } catch (err) {
      console.error('Error starting WebRTC:', err);
      alert('Could not access camera/microphone.');
    }
  };

  const endCall = () => {
    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }
    if (localStream.current) {
      localStream.current.getTracks().forEach(track => track.stop());
      localStream.current = null;
    }
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setCallActive(false);
    setScreenSharing(false);
  };

  const toggleAudio = () => {
    if (localStream.current) {
      const audioTrack = localStream.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setAudioEnabled(audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (localStream.current && !screenSharing) {
      const videoTrack = localStream.current.getVideoTracks().find(t => t.kind === 'video');
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setVideoEnabled(videoTrack.enabled);
      }
    }
  };

  const toggleScreenShare = async () => {
    if (!callActive || !peerConnection.current) return;

    try {
      if (!screenSharing) {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = screenStream.getVideoTracks()[0];
        
        screenTrack.onended = () => {
          stopScreenShare();
        };

        const sender = peerConnection.current.getSenders().find(s => s.track.kind === 'video');
        if (sender) {
          sender.replaceTrack(screenTrack);
        }
        
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream;
        }
        setScreenSharing(true);
      } else {
        stopScreenShare();
      }
    } catch (err) {
      console.error("Error sharing screen:", err);
    }
  };

  const stopScreenShare = () => {
    if (localVideoRef.current && localVideoRef.current.srcObject && localVideoRef.current.srcObject !== localStream.current) {
       const tracks = localVideoRef.current.srcObject.getTracks();
       tracks.forEach(track => track.stop());
    }

    const videoTrack = localStream.current.getVideoTracks()[0];
    const sender = peerConnection.current.getSenders().find(s => s.track && s.track.kind === 'video');
    
    if (sender && videoTrack) {
      sender.replaceTrack(videoTrack);
    }
    
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream.current;
    }
    setScreenSharing(false);
  };

  return (
    <div className="room-container">
      <header className="room-header">
        <div className="header-brand">
          <h1>FA-Project</h1>
          <span className="room-title">Study Room: {roomId}</span>
        </div>
        <div className="header-controls">
          <div className="connection-info">
            Connected via: <span className="highlight-node">{nodeId}</span>
          </div>
          <button className="btn-leave" onClick={handleLeaveRoom}>Leave Room</button>
        </div>
      </header>

      <div className="room-grid">
        <aside className="participants-panel">
          <h3>Participants</h3>
          <ul>
            <li>{userName} - {nodeId} - Online</li>
            {participants.map((p, idx) => <li key={idx}>{p.name} - {p.nodeId} - {p.status || 'Online'}</li>)}
          </ul>
          
          <div className="webrtc-section">
            {!callActive ? (
              <button onClick={() => startWebRTC(true)} className="btn-primary" style={{width: '100%'}}>Start Video Call</button>
            ) : (
              <div className="webrtc-active-panel">
                <div className="videos">
                  <div className="video-container">
                    <video ref={localVideoRef} autoPlay muted className="local-video" />
                    <span className="video-label">You {audioEnabled ? '' : '(Muted)'}</span>
                  </div>
                  <div className="video-container">
                    <video ref={remoteVideoRef} autoPlay className="remote-video" />
                    <span className="video-label">Remote</span>
                  </div>
                </div>
                <div className="media-controls">
                  <button onClick={toggleAudio} className={`btn-control ${!audioEnabled ? 'disabled' : ''}`}>
                    {audioEnabled ? 'Mute' : 'Unmute'}
                  </button>
                  <button onClick={toggleVideo} className={`btn-control ${!videoEnabled ? 'disabled' : ''}`} disabled={screenSharing}>
                    {videoEnabled ? 'Stop Video' : 'Start Video'}
                  </button>
                  <button onClick={toggleScreenShare} className={`btn-control ${screenSharing ? 'active' : ''}`}>
                    {screenSharing ? 'Stop Sharing' : 'Share Screen'}
                  </button>
                  <button onClick={endCall} className="btn-danger">End Call</button>
                </div>
              </div>
            )}
          </div>
        </aside>

        <main className="chat-panel">
          <div className="chat-messages">
            {messages.filter(m => m != null).map((m, idx) => (
              <div key={idx} className={`message ${m.type === 'SYSTEM' ? 'system' : ''}`}>
                {m.type === 'SYSTEM' ? <em>{m.payload.text}</em> : <><br/><strong>{m.senderUser}: </strong><span>{m.payload.text}</span><span className="msg-time">{new Date(m.timestamp).toLocaleTimeString()}</span></>}
              </div>
            ))}
          </div>
          <form className="chat-input" onSubmit={sendMessage}>
            <input type="text" value={inputMsg} onChange={e => setInputMsg(e.target.value)} placeholder="Send a message..."/>
            <button type="submit">Send</button>
          </form>
        </main>

        <aside className="resources-panel">
          <h3>Distributed Resources</h3>
          
          <div className="resources-list">
            {resources.length === 0 ? <p>No resources shared yet.</p> : null}
            {resources.map(r => (
              <div key={r.resourceId} className="resource-item" style={{background: '#333', padding: '0.5rem', marginBottom: '0.5rem', borderRadius: '4px'}}>
                <p style={{margin: '0 0 0.5rem', fontWeight: 'bold'}}>{r.fileName}</p>
                <p style={{margin: '0 0 0.5rem', fontSize: '0.8rem', color: '#aaa'}}>Node: {r.ownerNodeId} | {(r.size/1024).toFixed(1)} KB</p>
                <button onClick={() => handleResourceDownload(r.fileName)} className="btn-primary" style={{width: '100%', fontSize: '0.8rem'}}>RPC Download</button>
              </div>
            ))}
          </div>

          <form onSubmit={handleFileUpload} className="resource-form" style={{marginTop: '2rem'}}>
            <p className="distributed-subtext" style={{borderTop: '1px solid #555', paddingTop: '1rem'}}>
              Upload via Connected Node: {nodeId}
            </p>
            <input type="file" onChange={e => setFile(e.target.files[0])} style={{marginBottom: '0.5rem'}} />
            <button type="submit" className="btn-secondary" style={{width: '100%'}}>Upload Resource</button>
          </form>
        </aside>
      </div>
    </div>
  );
}

export default StudyRoom;
