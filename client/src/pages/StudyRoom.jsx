import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import io from 'socket.io-client';
import axios from 'axios';
import { fetchCurrentUser } from '../auth';
import './StudyRoom.css';

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || 'http://localhost:5000';

async function pickActiveNode(excludeNodeId) {
  const res = await axios.get(`${GATEWAY_URL}/health`);
  const nodes = (res.data.nodes || []).filter(n => n.status === 'ONLINE' && n.nodeId !== excludeNodeId);
  if (nodes.length === 0) throw new Error('No active nodes available');
  return nodes[Math.floor(Math.random() * nodes.length)];
}

function StudyRoom() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [userChecked, setUserChecked] = useState(false);

  const [node, setNode] = useState(null); // {nodeId, host, port}
  const [classroom, setClassroom] = useState(null);
  const [phase, setPhase] = useState('loading'); // loading | waiting | active | rejected | removed | ended | error
  const [errorMsg, setErrorMsg] = useState('');
  const [isReconnecting, setIsReconnecting] = useState(false);

  const socketRef = useRef(null);
  const [messages, setMessages] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [waitingList, setWaitingList] = useState([]);
  const [raisedHands, setRaisedHands] = useState([]);
  const [inputMsg, setInputMsg] = useState('');

  const [file, setFile] = useState(null);
  const [resources, setResources] = useState([]);

  const [privateTarget, setPrivateTarget] = useState(null);
  const [privateMessages, setPrivateMessages] = useState([]);
  const [privateInput, setPrivateInput] = useState('');

  const [showSettings, setShowSettings] = useState(false);
  const [showAttendance, setShowAttendance] = useState(false);
  const [attendance, setAttendance] = useState([]);

  const [callActive, setCallActive] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const localStream = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnection = useRef(null);

  const isTeacherOwner = classroom && user.role === 'teacher' && classroom.teacherId === user.userId;
  const nodeBase = node ? `http://${node.host || 'localhost'}:${node.port}` : null;

  useEffect(() => {
    fetchCurrentUser().then(u => {
      if (!u) { navigate('/'); return; }
      setUser(u);
      setUserChecked(true);
    });
  }, [navigate]);

  const refreshWaitingList = useCallback(async (base, classroomId) => {
    try {
      const res = await axios.get(`${base}/api/classrooms/${classroomId}/waiting`);
      setWaitingList(res.data);
    } catch (err) { /* non-fatal */ }
  }, []);

  const refreshMembers = useCallback(async (base, classroomId) => {
    try {
      const res = await axios.get(`${base}/api/classrooms/${classroomId}/members`);
      setParticipants(res.data);
    } catch (err) { /* non-fatal */ }
  }, []);

  // --- Resolve classroom + membership, then wire the socket ---
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      try {
        const activeNode = await pickActiveNode();
        if (cancelled) return;
        setNode(activeNode);
        const base = `http://${activeNode.host || 'localhost'}:${activeNode.port}`;

        const classroomRes = await axios.get(`${base}/api/classrooms/${code}`);
        const cls = classroomRes.data;
        if (cancelled) return;
        setClassroom(cls);

        if (cls.status === 'ENDED') { setPhase('ended'); return; }

        if (user.role === 'teacher') {
          if (cls.teacherId !== user.userId) { setErrorMsg('This is not your classroom'); setPhase('error'); return; }
          setPhase('active');
          refreshWaitingList(base, cls.classroomId);
          refreshMembers(base, cls.classroomId);
          return;
        }

        // student
        const statusRes = await axios.get(`${base}/api/classrooms/${cls.classroomId}/membership/status`);
        let status = statusRes.data.status;
        if (status === 'NONE') {
          await axios.post(`${base}/api/classrooms/${code}/join-request`, {});
          status = 'PENDING';
        }
        if (status === 'ADMITTED') setPhase('active');
        else if (status === 'PENDING') setPhase('waiting');
        else if (status === 'REJECTED') setPhase('rejected');
        else if (status === 'REMOVED') setPhase('removed');
      } catch (err) {
        setErrorMsg(err.response?.data?.error || err.message);
        setPhase('error');
      }
    })();

    return () => { cancelled = true; };
  }, [code, user, refreshWaitingList, refreshMembers]);

  // Student poll fallback while waiting — covers a dropped real-time push.
  useEffect(() => {
    if (phase !== 'waiting' || !nodeBase || !classroom) return;
    const interval = setInterval(async () => {
      try {
        const res = await axios.get(`${nodeBase}/api/classrooms/${classroom.classroomId}/membership/status`);
        if (res.data.status === 'ADMITTED') {
          setPhase('active');
          socketRef.current?.emit('confirm_admission', { classroomId: classroom.classroomId });
        } else if (res.data.status === 'REJECTED') setPhase('rejected');
      } catch (err) { /* keep polling */ }
    }, 3000);
    return () => clearInterval(interval);
  }, [phase, nodeBase, classroom]);

  // --- Socket connection, once we know which node and have resolved the classroom ---
  useEffect(() => {
    if (!node || !classroom || phase === 'error' || phase === 'ended') return;

    const newSocket = io(`http://${node.host || 'localhost'}:${node.port}`, { withCredentials: true });
    socketRef.current = newSocket;

    newSocket.on('connect', () => {
      setIsReconnecting(false);
      newSocket.emit('join_classroom_channel', { classroomId: classroom.classroomId });
    });

    newSocket.on('disconnect', (reason) => {
      if (reason === 'io client disconnect') return;
      setIsReconnecting(true);
      (async () => {
        try {
          const next = await pickActiveNode(node.nodeId);
          setMessages(prev => [...prev, { type: 'SYSTEM', payload: { text: `Lost connection to ${node.nodeId}. Failing over to ${next.nodeId}...` } }]);
          setNode(next);
        } catch (err) {
          setMessages(prev => [...prev, { type: 'SYSTEM', payload: { text: 'Connection lost. No backup nodes available.' } }]);
        }
      })();
    });

    newSocket.on('admitted', (payload) => {
      if (payload.userId !== user.userId) return;
      setPhase('active');
      newSocket.emit('confirm_admission', { classroomId: classroom.classroomId });
    });

    newSocket.on('rejected', (payload) => { if (payload.userId === user.userId) setPhase('rejected'); });

    newSocket.on('removed', (payload) => {
      if (payload.userId !== user.userId) return;
      setPhase('removed');
      newSocket.emit('confirm_removed', { classroomId: classroom.classroomId });
    });

    newSocket.on('join_requested', () => { if (isTeacherOwner) refreshWaitingList(nodeBase, classroom.classroomId); });

    newSocket.on('settings_changed', (payload) => {
      setClassroom(prev => prev ? { ...prev, settings: payload.settings } : prev);
    });

    newSocket.on('chat_message', (envelope) => { if (envelope) setMessages(prev => [...prev, envelope]); });

    newSocket.on('resource_shared', (resource) => { setResources(prev => [...prev, resource]); });

    newSocket.on('private_message', (envelope) => {
      setPrivateMessages(prev => (prev.some(m => m.messageId === envelope.messageId) ? prev : [...prev, envelope]));
    });

    newSocket.on('hand_raised', (payload) => {
      setRaisedHands(prev => prev.some(p => p.userId === payload.userId) ? prev : [...prev, payload]);
    });
    newSocket.on('hand_lowered', (payload) => {
      setRaisedHands(prev => prev.filter(p => p.userId !== payload.userId));
    });

    newSocket.on('error_message', (payload) => {
      setMessages(prev => [...prev, { type: 'SYSTEM', payload: { text: `Error: ${payload.error}` } }]);
    });

    newSocket.on('webrtc_offer', async (data) => {
      if (!peerConnection.current) { const started = await startWebRTC(false); if (!started) return; }
      try {
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerConnection.current.createAnswer();
        await peerConnection.current.setLocalDescription(answer);
        newSocket.emit('webrtc_answer', { roomId: classroom.classroomId, answer });
      } catch (err) { console.error('Error handling webrtc_offer:', err); }
    });

    newSocket.on('webrtc_answer', async (data) => {
      try { if (peerConnection.current) await peerConnection.current.setRemoteDescription(new RTCSessionDescription(data.answer)); }
      catch (err) { console.error('Error handling webrtc_answer:', err); }
    });

    newSocket.on('webrtc_ice', async (data) => {
      try { if (peerConnection.current) await peerConnection.current.addIceCandidate(new RTCIceCandidate(data.candidate)); }
      catch (err) { console.error('Error adding ice candidate:', err); }
    });

    return () => { newSocket.close(); socketRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node, classroom?.classroomId]);

  // Fetch chat/resource history once active
  useEffect(() => {
    if (phase !== 'active' || !nodeBase || !classroom) return;
    axios.get(`${nodeBase}/api/resources/room/${classroom.classroomId}`).then(res => setResources(res.data)).catch(() => {});
    axios.get(`${nodeBase}/api/chat/room/${classroom.classroomId}`).then(res => setMessages(res.data)).catch(() => {});
    if (isTeacherOwner) refreshMembers(nodeBase, classroom.classroomId);
  }, [phase, nodeBase, classroom, isTeacherOwner, refreshMembers]);

  const sendMessage = (e) => {
    e.preventDefault();
    if (!inputMsg.trim() || !socketRef.current) return;
    socketRef.current.emit('chat_message', { roomId: classroom.classroomId, message: { text: inputMsg } });
    setInputMsg('');
  };

  const sendPrivateMessage = (e) => {
    e.preventDefault();
    if (!privateInput.trim() || !socketRef.current || !privateTarget) return;
    socketRef.current.emit('private_message', { classroomId: classroom.classroomId, toUserId: privateTarget.userId, text: privateInput });
    setPrivateInput('');
  };

  const toggleHand = () => {
    const raised = raisedHands.some(p => p.userId === user.userId);
    socketRef.current?.emit(raised ? 'lower_hand' : 'raise_hand', { classroomId: classroom.classroomId });
  };

  const decideMember = async (userId, status) => {
    try {
      await axios.patch(`${nodeBase}/api/classrooms/${classroom.classroomId}/members/${userId}`, { status });
      refreshWaitingList(nodeBase, classroom.classroomId);
      refreshMembers(nodeBase, classroom.classroomId);
    } catch (err) { alert(err.response?.data?.error || err.message); }
  };

  const updateSetting = async (key, value) => {
    try {
      const res = await axios.patch(`${nodeBase}/api/classrooms/${classroom.classroomId}/settings`, { [key]: value });
      setClassroom(prev => ({ ...prev, settings: res.data.settings }));
    } catch (err) { alert(err.response?.data?.error || err.message); }
  };

  const loadAttendance = async () => {
    try {
      const res = await axios.get(`${nodeBase}/api/classrooms/${classroom.classroomId}/attendance`);
      setAttendance(res.data);
      setShowAttendance(true);
    } catch (err) { alert(err.response?.data?.error || err.message); }
  };

  const endClassroom = async () => {
    if (!window.confirm('End this classroom for everyone?')) return;
    await axios.patch(`${nodeBase}/api/classrooms/${classroom.classroomId}/end`, {});
    navigate('/');
  };

  const handleFileUpload = async (e) => {
    e.preventDefault();
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('roomId', classroom.classroomId);
    try {
      await axios.post(`${nodeBase}/api/resources/upload`, formData);
      alert('File successfully uploaded.');
      setFile(null);
    } catch (err) {
      alert(`Upload failed: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleResourceDownload = async (fileName) => {
    try {
      const res = await axios.get(`${nodeBase}/api/resources/find/${fileName}`, { params: { roomId: classroom.classroomId } });
      window.open(res.data.url, '_blank');
    } catch (err) {
      alert(`Download failed: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleLeaveRoom = () => {
    endCall();
    if (socketRef.current) socketRef.current.close();
    navigate('/');
  };

  const startWebRTC = async (isCaller = true) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStream.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      setCallActive(true); setAudioEnabled(true); setVideoEnabled(true); setScreenSharing(false);

      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      peerConnection.current = pc;
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      pc.onicecandidate = (event) => {
        if (event.candidate && socketRef.current) socketRef.current.emit('webrtc_ice', { roomId: classroom.classroomId, candidate: event.candidate });
      };
      pc.ontrack = (event) => { if (remoteVideoRef.current) remoteVideoRef.current.srcObject = event.streams[0]; };

      if (isCaller && socketRef.current) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socketRef.current.emit('webrtc_offer', { roomId: classroom.classroomId, offer });
      }
      return true;
    } catch (err) {
      console.error('Error starting WebRTC:', err);
      alert('Could not access camera/microphone.');
      return false;
    }
  };

  const endCall = () => {
    if (peerConnection.current) { peerConnection.current.close(); peerConnection.current = null; }
    if (localStream.current) { localStream.current.getTracks().forEach(t => t.stop()); localStream.current = null; }
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setCallActive(false); setScreenSharing(false);
  };

  const toggleAudio = () => {
    const track = localStream.current?.getAudioTracks()[0];
    if (track) { track.enabled = !track.enabled; setAudioEnabled(track.enabled); }
  };
  const toggleVideo = () => {
    const track = localStream.current?.getVideoTracks().find(t => t.kind === 'video');
    if (track && !screenSharing) { track.enabled = !track.enabled; setVideoEnabled(track.enabled); }
  };

  if (!user) return <div className="room-container"><p style={{ padding: '2rem' }}>{userChecked ? 'Redirecting...' : 'Checking session...'}</p></div>;

  if (phase === 'loading') return <div className="room-container"><p style={{ padding: '2rem' }}>Loading classroom...</p></div>;
  if (phase === 'error') return <div className="room-container"><p style={{ padding: '2rem' }}>Error: {errorMsg} — <a href="/">Go back</a></p></div>;
  if (phase === 'ended') return <div className="room-container"><p style={{ padding: '2rem' }}>This classroom has ended. — <a href="/">Go back</a></p></div>;
  if (phase === 'rejected') return <div className="room-container"><p style={{ padding: '2rem' }}>Your request to join this classroom was rejected. — <a href="/">Go back</a></p></div>;
  if (phase === 'removed') return <div className="room-container"><p style={{ padding: '2rem' }}>You were removed from this classroom. — <a href="/">Go back</a></p></div>;
  if (phase === 'waiting') return (
    <div className="room-container">
      <p style={{ padding: '2rem' }}>
        Waiting for the teacher to admit you to <strong>{classroom?.name}</strong>...<br />
        You will automatically enter once approved.
      </p>
    </div>
  );

  return (
    <div className="room-container">
      <header className="room-header">
        <div className="header-brand">
          <h1>FA-Project</h1>
          <span className="room-title">{classroom.name} ({classroom.code})</span>
        </div>
        <div className="header-controls">
          <div className="connection-info">
            {isReconnecting ? <span style={{ color: 'orange' }}>Reconnecting...</span> : <>Connected via: <span className="highlight-node">{node?.nodeId}</span></>}
          </div>
          {isTeacherOwner && <button className="btn-secondary" onClick={() => setShowSettings(s => !s)}>Settings</button>}
          {isTeacherOwner && <button className="btn-secondary" onClick={loadAttendance}>Attendance</button>}
          {isTeacherOwner && <button className="btn-danger" onClick={endClassroom}>End Class</button>}
          <button className="btn-leave" onClick={handleLeaveRoom}>Leave Room</button>
        </div>
      </header>

      {isTeacherOwner && showSettings && (
        <div style={{ background: '#222', padding: '1rem', margin: '0.5rem 1rem', borderRadius: '6px' }}>
          <h3>Classroom Settings</h3>
          {['groupChatEnabled', 'personalMessagingEnabled', 'fileSharingEnabled'].map(key => (
            <label key={key} style={{ display: 'block', margin: '0.3rem 0' }}>
              <input type="checkbox" checked={!!classroom.settings[key]} onChange={e => updateSetting(key, e.target.checked)} /> {key}
            </label>
          ))}
        </div>
      )}

      {isTeacherOwner && showAttendance && (
        <div style={{ background: '#222', padding: '1rem', margin: '0.5rem 1rem', borderRadius: '6px' }}>
          <h3>Attendance <button className="btn-secondary" onClick={() => setShowAttendance(false)}>Close</button></h3>
          <table style={{ width: '100%' }}>
            <thead><tr><th>Student</th><th>Joined</th><th>Left</th><th>Status</th></tr></thead>
            <tbody>
              {attendance.map(a => (
                <tr key={a.userId}>
                  <td>{a.name}</td>
                  <td>{a.joinedAt ? new Date(a.joinedAt).toLocaleTimeString() : '--'}</td>
                  <td>{a.leftAt ? new Date(a.leftAt).toLocaleTimeString() : '--'}</td>
                  <td>{a.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isTeacherOwner && waitingList.length > 0 && (
        <div style={{ background: '#2a2a1a', padding: '1rem', margin: '0.5rem 1rem', borderRadius: '6px' }}>
          <h3>Waiting Room</h3>
          {waitingList.map(w => (
            <div key={w.userId} style={{ display: 'flex', justifyContent: 'space-between', margin: '0.3rem 0' }}>
              <span>{w.name}</span>
              <span>
                <button className="btn-primary" onClick={() => decideMember(w.userId, 'ADMITTED')}>Admit</button>{' '}
                <button className="btn-danger" onClick={() => decideMember(w.userId, 'REJECTED')}>Reject</button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="room-grid">
        <aside className="participants-panel">
          <h3>Participants</h3>
          <ul>
            <li>{user.name} (you) {isTeacherOwner ? '- Teacher' : ''}</li>
            {participants.filter(p => p.userId !== user.userId).map(p => (
              <li key={p.userId}>
                {p.name}
                {raisedHands.some(h => h.userId === p.userId) ? ' ✋' : ''}{' '}
                {classroom.settings.personalMessagingEnabled && (
                  <button className="btn-secondary" style={{ fontSize: '0.7rem' }} onClick={() => { setPrivateTarget(p); setPrivateMessages([]); }}>Message</button>
                )}
              </li>
            ))}
            {isTeacherOwner && participants.length === 0 && <li style={{ opacity: 0.6 }}>No students admitted yet.</li>}
          </ul>

          <button className="btn-secondary" style={{ width: '100%', marginTop: '0.5rem' }} onClick={toggleHand}>
            {raisedHands.some(p => p.userId === user.userId) ? '✋ Lower Hand' : '✋ Raise Hand'}
          </button>

          <div className="webrtc-section">
            {!callActive ? (
              <button onClick={() => startWebRTC(true)} className="btn-primary" style={{ width: '100%' }}>Start Video Call</button>
            ) : (
              <div className="webrtc-active-panel">
                <div className="videos">
                  <div className="video-container"><video ref={localVideoRef} autoPlay muted className="local-video" /><span className="video-label">You {audioEnabled ? '' : '(Muted)'}</span></div>
                  <div className="video-container"><video ref={remoteVideoRef} autoPlay className="remote-video" /><span className="video-label">Remote</span></div>
                </div>
                <div className="media-controls">
                  <button onClick={toggleAudio} className={`btn-control ${!audioEnabled ? 'disabled' : ''}`}>{audioEnabled ? 'Mute' : 'Unmute'}</button>
                  <button onClick={toggleVideo} className={`btn-control ${!videoEnabled ? 'disabled' : ''}`} disabled={screenSharing}>{videoEnabled ? 'Stop Video' : 'Start Video'}</button>
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
                {m.type === 'SYSTEM' ? <em>{m.payload.text}</em> : <><br /><strong>{m.senderUser}: </strong><span>{m.payload.text}</span><span className="msg-time">{new Date(m.timestamp).toLocaleTimeString()}</span></>}
              </div>
            ))}
          </div>
          {classroom.settings.groupChatEnabled ? (
            <form className="chat-input" onSubmit={sendMessage}>
              <input type="text" value={inputMsg} onChange={e => setInputMsg(e.target.value)} placeholder="Send a message..." />
              <button type="submit">Send</button>
            </form>
          ) : <p style={{ padding: '0.5rem', opacity: 0.7 }}>Group chat is disabled.</p>}

          {privateTarget && (
            <div style={{ borderTop: '1px solid #555', marginTop: '1rem', paddingTop: '1rem' }}>
              <h4>Private Chat — {privateTarget.name} <button className="btn-secondary" onClick={() => setPrivateTarget(null)}>Close</button></h4>
              <div className="chat-messages" style={{ maxHeight: '150px' }}>
                {privateMessages.filter(m => [m.fromUserId, m.toUserId].includes(privateTarget.userId)).map((m, idx) => (
                  <div key={idx} className="message"><strong>{m.fromUserId === user.userId ? 'You' : m.fromName}: </strong>{m.text}</div>
                ))}
              </div>
              <form className="chat-input" onSubmit={sendPrivateMessage}>
                <input type="text" value={privateInput} onChange={e => setPrivateInput(e.target.value)} placeholder={`Message ${privateTarget.name}...`} />
                <button type="submit">Send</button>
              </form>
            </div>
          )}
        </main>

        <aside className="resources-panel">
          <h3>Shared Resources</h3>
          <div className="resources-list">
            {resources.length === 0 ? <p>No resources shared yet.</p> : null}
            {resources.map(r => (
              <div key={r.resourceId} className="resource-item" style={{ background: '#333', padding: '0.5rem', marginBottom: '0.5rem', borderRadius: '4px' }}>
                <p style={{ margin: '0 0 0.5rem', fontWeight: 'bold' }}>{r.originalName || r.fileName}</p>
                <p style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', color: '#aaa' }}>Node: {r.ownerNodeId} | {(r.size / 1024).toFixed(1)} KB</p>
                <button onClick={() => handleResourceDownload(r.fileName)} className="btn-primary" style={{ width: '100%', fontSize: '0.8rem' }}>RPC Download</button>
              </div>
            ))}
          </div>

          {classroom.settings.fileSharingEnabled ? (
            <form onSubmit={handleFileUpload} className="resource-form" style={{ marginTop: '2rem' }}>
              <p className="distributed-subtext" style={{ borderTop: '1px solid #555', paddingTop: '1rem' }}>Upload via Connected Node: {node?.nodeId}</p>
              <input type="file" onChange={e => setFile(e.target.files[0])} style={{ marginBottom: '0.5rem' }} />
              <button type="submit" className="btn-secondary" style={{ width: '100%' }}>Upload Resource</button>
            </form>
          ) : <p style={{ opacity: 0.7, marginTop: '1rem' }}>File sharing is disabled.</p>}
        </aside>
      </div>
    </div>
  );
}

export default StudyRoom;
