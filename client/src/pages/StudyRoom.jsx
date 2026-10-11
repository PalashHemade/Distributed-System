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

function initials(name) {
  return (name || '?').trim().split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

const ICON_PATHS = {
  back: <path d="M15 18l-6-6 6-6" />,
  hand: <><path d="M8 12V5a1.5 1.5 0 013 0v5" /><path d="M11 10V4a1.5 1.5 0 013 0v6" /><path d="M14 10V5a1.5 1.5 0 013 0v7" /><path d="M8 11l-1.8 1.8a2.2 2.2 0 000 3.1l3.3 3.3c1.3 1.3 3 2 4.9 2h1a5 5 0 005-5v-3a1.5 1.5 0 00-3 0" /></>,
  video: <><rect x="2" y="6" width="14" height="12" rx="3" /><path d="M16 10l6-4v12l-6-4" /></>,
  chat: <path d="M3 5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H9l-5 4V5z" />,
  people: <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-4 3-6 6-6s6 2 6 6" /><circle cx="17.5" cy="9" r="2.3" /><path d="M15.2 20c0-2.4 1.4-4.4 4-5" /></>,
  file: <><path d="M6 2h8l4 4v16H6V2z" /><path d="M14 2v4h4" /></>,
  settings: <><path d="M4 7h10M4 12h16M4 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></>,
  clipboard: <><rect x="5" y="4" width="14" height="17" rx="2" /><rect x="9" y="2" width="6" height="4" rx="1" /><path d="M8 11h8M8 15h5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></>,
  leave: <><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></>,
  mic: <><rect x="9" y="2" width="6" height="11" rx="3" /><path d="M5 10a7 7 0 0014 0" /><path d="M12 17v4" /></>,
  micOff: <><rect x="9" y="2" width="6" height="11" rx="3" /><path d="M5 10a7 7 0 0014 0" /><path d="M12 17v4" /><path d="M3 3l18 18" /></>,
  camOff: <><rect x="2" y="6" width="14" height="12" rx="3" /><path d="M16 10l6-4v12l-6-4" /><path d="M1 1l22 22" /></>,
  phoneOff: <><path d="M10.5 13.5a15.8 15.8 0 003.9 2.9l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.5 2.7.6a2 2 0 011.7 2v2.8a2 2 0 01-2.2 2 19.6 19.6 0 01-8.5-3 19.3 19.3 0 01-6-6 19.6 19.6 0 01-3-8.4A2 2 0 014.4 2h2.8a2 2 0 012 1.7c.1.9.3 1.8.6 2.7a2 2 0 01-.4 2.1L8.1 9.8" /><path d="M2 2l20 20" /></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 012-2h10" /></>,
  send: <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />,
  check: <path d="M20 6L9 17l-5-5" />,
  close: <path d="M18 6L6 18M6 6l12 12" />,
};

function Icon({ name, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {ICON_PATHS[name]}
    </svg>
  );
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
  const [shareRequests, setShareRequests] = useState([]); // teacher-only: pending student uploads

  const [privateTarget, setPrivateTarget] = useState(null);
  const [privateMessages, setPrivateMessages] = useState([]);
  const [privateInput, setPrivateInput] = useState('');

  const [showSettings, setShowSettings] = useState(false);
  const [showAttendance, setShowAttendance] = useState(false);
  const [showWaiting, setShowWaiting] = useState(false);
  const [attendance, setAttendance] = useState([]);

  const [callActive, setCallActive] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [callRoster, setCallRoster] = useState([]); // [{userId, name}] — who's currently in the call
  const [remoteStreams, setRemoteStreams] = useState({}); // userId -> MediaStream, for the video grid
  const localStream = useRef(null);
  const localVideoRef = useRef(null);
  // Mesh: one RTCPeerConnection per other call participant, keyed by their
  // userId — replaces the old single `peerConnection` ref, which only ever
  // supported exactly 2 people.
  const peerConnections = useRef(new Map());

  // Presentational-only state for the right panel and the copy-code affordance.
  const [activeTab, setActiveTab] = useState('chat'); // 'people' | 'chat' | 'resources'
  const [codeCopied, setCodeCopied] = useState(false);

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

  const refreshShareRequests = useCallback(async (base, classroomId) => {
    try {
      const res = await axios.get(`${base}/api/classrooms/${classroomId}/resources/pending`);
      setShareRequests(res.data);
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
          refreshShareRequests(base, cls.classroomId);
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
  }, [code, user, refreshWaitingList, refreshMembers, refreshShareRequests]);

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

    // Upsert by resourceId — this also fires when a PENDING upload of ours
    // gets approved, re-delivering the same resource with a new status.
    newSocket.on('resource_shared', (resource) => {
      setResources(prev => {
        const idx = prev.findIndex(r => r.resourceId === resource.resourceId);
        if (idx >= 0) { const next = [...prev]; next[idx] = resource; return next; }
        return [...prev, resource];
      });
    });

    newSocket.on('share_requested', () => {
      if (isTeacherOwner) refreshShareRequests(nodeBase, classroom.classroomId);
    });

    newSocket.on('share_approved', (payload) => {
      if (payload.uploaderId === user.userId) {
        setMessages(prev => [...prev, { type: 'SYSTEM', payload: { text: `Your file "${payload.originalName}" was approved and is now visible to the class.` } }]);
      }
    });

    newSocket.on('share_rejected', (payload) => {
      setResources(prev => prev.filter(r => r.resourceId !== payload.resourceId));
      if (payload.uploaderId === user.userId) {
        setMessages(prev => [...prev, { type: 'SYSTEM', payload: { text: `Your file "${payload.originalName}" was not approved for sharing.` } }]);
      }
    });

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

    // Mesh signaling — each message is keyed by fromUserId, routed to a
    // specific entry in the peerConnections map, not a single shared ref.
    newSocket.on('webrtc_offer', async (data) => {
      try {
        const pc = await ensurePeerConnection(data.fromUserId);
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        newSocket.emit('webrtc_answer', { roomId: classroom.classroomId, toUserId: data.fromUserId, answer });
      } catch (err) { console.error('Error handling webrtc_offer:', err); }
    });

    newSocket.on('webrtc_answer', async (data) => {
      try {
        const pc = peerConnections.current.get(data.fromUserId);
        if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      } catch (err) { console.error('Error handling webrtc_answer:', err); }
    });

    newSocket.on('webrtc_ice', async (data) => {
      try {
        const pc = peerConnections.current.get(data.fromUserId);
        if (pc) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (err) { console.error('Error adding ice candidate:', err); }
    });

    newSocket.on('call_participant_joined', (data) => {
      if (data.userId === user.userId) return;
      setCallRoster(prev => prev.some(p => p.userId === data.userId) ? prev : [...prev, { userId: data.userId, name: data.name }]);
    });

    newSocket.on('call_participant_left', (data) => {
      setCallRoster(prev => prev.filter(p => p.userId !== data.userId));
      const pc = peerConnections.current.get(data.userId);
      if (pc) { pc.close(); peerConnections.current.delete(data.userId); }
      setRemoteStreams(prev => { const next = { ...prev }; delete next[data.userId]; return next; });
    });

    return () => { newSocket.close(); socketRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node, classroom?.classroomId]);

  // Fetch chat/resource history once active
  useEffect(() => {
    if (phase !== 'active' || !nodeBase || !classroom) return;
    axios.get(`${nodeBase}/api/resources/room/${classroom.classroomId}`).then(res => setResources(res.data)).catch(() => {});
    axios.get(`${nodeBase}/api/chat/room/${classroom.classroomId}`).then(res => setMessages(res.data)).catch(() => {});
    if (isTeacherOwner) {
      refreshMembers(nodeBase, classroom.classroomId);
      refreshShareRequests(nodeBase, classroom.classroomId);
    }
  }, [phase, nodeBase, classroom, isTeacherOwner, refreshMembers, refreshShareRequests]);

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

  const decideShare = async (resourceId, decision) => {
    try {
      await axios.patch(`${nodeBase}/api/classrooms/${classroom.classroomId}/resources/${resourceId}/decision`, { decision });
      setShareRequests(prev => prev.filter(r => r.resourceId !== resourceId));
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
      const res = await axios.post(`${nodeBase}/api/resources/upload`, formData);
      if (res.data.resource?.status === 'PENDING') {
        alert('Your file was sent to the teacher for approval. It will appear for everyone once approved.');
        setResources(prev => [...prev, res.data.resource]);
      } else {
        alert('File successfully uploaded.');
      }
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

  // Creates (or returns the existing) RTCPeerConnection for one specific
  // call participant — the mesh replacement for the old single shared ref.
  // If we don't have local media yet (someone offered us a call before we'd
  // started our own), acquire it here so there's something to send back.
  const ensurePeerConnection = async (peerId) => {
    let pc = peerConnections.current.get(peerId);
    if (pc) return pc;

    if (!localStream.current) {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStream.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      setCallActive(true); setAudioEnabled(true); setVideoEnabled(true); setScreenSharing(false);
      socketRef.current?.emit('call_join', { roomId: classroom.classroomId });
    }

    pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    localStream.current.getTracks().forEach(track => pc.addTrack(track, localStream.current));

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('webrtc_ice', { roomId: classroom.classroomId, toUserId: peerId, candidate: event.candidate });
      }
    };
    pc.ontrack = (event) => {
      setRemoteStreams(prev => ({ ...prev, [peerId]: event.streams[0] }));
    };

    peerConnections.current.set(peerId, pc);
    return pc;
  };

  // Newcomer-initiates convention (avoids offer glare): joining the call
  // means offering to everyone already in `callRoster`; anyone who joins
  // after us will offer to us in turn via the webrtc_offer listener above.
  const startCall = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStream.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      setCallActive(true); setAudioEnabled(true); setVideoEnabled(true); setScreenSharing(false);

      socketRef.current?.emit('call_join', { roomId: classroom.classroomId });

      for (const peer of callRoster) {
        const pc = await ensurePeerConnection(peer.userId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socketRef.current.emit('webrtc_offer', { roomId: classroom.classroomId, toUserId: peer.userId, offer });
      }
    } catch (err) {
      console.error('Error starting call:', err);
      alert('Could not access camera/microphone.');
    }
  };

  const endCall = () => {
    for (const pc of peerConnections.current.values()) pc.close();
    peerConnections.current.clear();
    setRemoteStreams({});
    if (localStream.current) { localStream.current.getTracks().forEach(t => t.stop()); localStream.current = null; }
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (callActive) socketRef.current?.emit('call_leave', { roomId: classroom.classroomId });
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

  const copyCode = async () => {
    if (!classroom) return;
    try {
      await navigator.clipboard.writeText(classroom.code);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 1500);
    } catch (err) { /* clipboard unavailable — non-fatal */ }
  };

  const openPrivateChat = (p) => {
    setPrivateTarget(p);
    setPrivateMessages([]);
    setActiveTab('chat');
  };

  if (!user) return <div className="room-loading">{userChecked ? 'Redirecting...' : 'Checking session...'}</div>;

  if (phase === 'loading') return <div className="room-loading">Loading classroom...</div>;
  if (phase === 'error') return <div className="room-loading">Error: {errorMsg} — <a href="/">Go back</a></div>;
  if (phase === 'ended') return <div className="room-loading">This classroom has ended. — <a href="/">Go back</a></div>;
  if (phase === 'rejected') return <div className="room-loading">Your request to join this classroom was rejected. — <a href="/">Go back</a></div>;
  if (phase === 'removed') return <div className="room-loading">You were removed from this classroom. — <a href="/">Go back</a></div>;
  if (phase === 'waiting') return (
    <div className="room-loading waiting-screen">
      <div className="waiting-spinner" />
      <p>Waiting for the teacher to admit you to <strong>{classroom?.name}</strong>...</p>
      <span>You will automatically enter once approved.</span>
    </div>
  );

  const handRaisedSelf = raisedHands.some(p => p.userId === user.userId);
  const rosterPeople = [{ userId: user.userId, name: user.name, self: true, role: isTeacherOwner ? 'teacher' : 'student' }, ...participants.filter(p => p.userId !== user.userId)];

  return (
    <div className="classroom-shell">
      <aside className="icon-rail">
        <div className="rail-avatar" title={user.name}>{initials(user.name)}</div>

        <button className={`rail-btn ${handRaisedSelf ? 'active' : ''}`} title={handRaisedSelf ? 'Lower hand' : 'Raise hand'} onClick={toggleHand}>
          <Icon name="hand" />
        </button>
        <button className={`rail-btn ${callActive ? 'active' : ''}`} title="Video call" onClick={() => (callActive ? endCall() : startCall())}>
          <Icon name="video" />
        </button>
        <button className={`rail-btn ${activeTab === 'resources' ? 'active' : ''}`} title="Resources" onClick={() => setActiveTab('resources')}>
          <Icon name="file" />
          {isTeacherOwner && shareRequests.length > 0 && <span className="rail-badge">{shareRequests.length}</span>}
        </button>

        {isTeacherOwner && (
          <button className="rail-btn" title="Waiting room" onClick={() => setShowWaiting(true)}>
            <Icon name="clock" />
            {waitingList.length > 0 && <span className="rail-badge">{waitingList.length}</span>}
          </button>
        )}
        {isTeacherOwner && (
          <button className="rail-btn" title="Settings" onClick={() => setShowSettings(true)}>
            <Icon name="settings" />
          </button>
        )}
        {isTeacherOwner && (
          <button className="rail-btn" title="Attendance" onClick={loadAttendance}>
            <Icon name="clipboard" />
          </button>
        )}

        <div className="rail-spacer" />
        <button className="rail-btn rail-leave" title="Leave classroom" onClick={handleLeaveRoom}>
          <Icon name="leave" />
        </button>
      </aside>

      <main className="classroom-main">
        <header className="classroom-topbar">
          <button className="icon-btn-ghost" onClick={handleLeaveRoom} title="Leave"><Icon name="back" /></button>
          <div className="topbar-title">
            <h1>{classroom.name}</h1>
            <span className="topbar-meta">
              {isReconnecting ? <span className="reconnecting">Reconnecting...</span> : <>Connected via <strong>{node?.nodeId}</strong></>}
            </span>
          </div>
          <div className="topbar-pills">
            <span className="pill pill-green">Admitted {rosterPeople.length}</span>
            {isTeacherOwner && <span className="pill pill-amber">Waiting {waitingList.length}</span>}
            {isTeacherOwner && <button className="btn-secondary topbar-end" onClick={endClassroom}>End Class</button>}
          </div>
        </header>

        <div className="stage">
          {!callActive ? (
            <div className="stage-cover">
              <div className="stage-cover-mark">
                <svg width="48" height="48" viewBox="0 0 26 26" aria-hidden="true">
                  <circle cx="13" cy="5" r="3.4" fill="var(--yellow-deep)" />
                  <circle cx="4.5" cy="20" r="3.4" fill="var(--yellow-deep)" />
                  <circle cx="21.5" cy="20" r="3.4" fill="var(--yellow-deep)" />
                  <path d="M13 8.4L5.2 17M13 8.4L20.8 17M5.5 20H20.5" stroke="var(--yellow-deep)" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </div>
              <p>No active video call</p>
              <button className="btn-primary" onClick={startCall}>Start Video Call <Icon name="video" size={16} /></button>
            </div>
          ) : (
            <div className="stage-video">
              <div className="stage-badge">{isReconnecting ? 'Reconnecting...' : 'Live'}</div>
              <div className="video-grid">
                <div className="video-tile">
                  <video ref={localVideoRef} autoPlay muted className="tile-video" />
                  <span className="tile-label">You {audioEnabled ? '' : '(Muted)'}</span>
                </div>
                {Object.entries(remoteStreams).map(([peerId, stream]) => (
                  <div className="video-tile" key={peerId}>
                    <video autoPlay className="tile-video" ref={el => { if (el && el.srcObject !== stream) el.srcObject = stream; }} />
                    <span className="tile-label">{callRoster.find(p => p.userId === peerId)?.name || 'Participant'}</span>
                  </div>
                ))}
              </div>
              <div className="stage-controls">
                <button className={`stage-ctrl ${!audioEnabled ? 'off' : ''}`} onClick={toggleAudio} title={audioEnabled ? 'Mute' : 'Unmute'}>
                  <Icon name={audioEnabled ? 'mic' : 'micOff'} />
                </button>
                <button className={`stage-ctrl ${!videoEnabled ? 'off' : ''}`} onClick={toggleVideo} disabled={screenSharing} title={videoEnabled ? 'Stop video' : 'Start video'}>
                  <Icon name={videoEnabled ? 'video' : 'camOff'} />
                </button>
                <button className="stage-ctrl stage-end" onClick={endCall} title="End call">
                  <Icon name="phoneOff" />
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="roster-strip">
          {rosterPeople.slice(0, 7).map(p => (
            <div className={`roster-chip ${p.self ? 'self' : ''}`} key={p.userId} title={p.name}>
              <span className="roster-chip-initials">{initials(p.name)}</span>
              {raisedHands.some(h => h.userId === p.userId) && <span className="roster-chip-hand"><Icon name="hand" size={10} /></span>}
            </div>
          ))}
          {rosterPeople.length > 7 && <div className="roster-chip roster-overflow">+{rosterPeople.length - 7}</div>}
        </div>

        <div className="bottom-toolbar">
          <button className="btn-leave-pill" onClick={handleLeaveRoom}>Leave Room</button>
          <div className="toolbar-actions">
            <button className={`toolbar-action ${activeTab === 'people' ? 'active' : ''}`} onClick={() => setActiveTab('people')}>
              <Icon name="people" /><span>Participants</span>
            </button>
            <button className={`toolbar-action ${activeTab === 'chat' ? 'active' : ''}`} onClick={() => setActiveTab('chat')}>
              <Icon name="chat" /><span>Chat</span>
            </button>
            <button className={`toolbar-action ${activeTab === 'resources' ? 'active' : ''}`} onClick={() => setActiveTab('resources')}>
              <Icon name="file" /><span>Resources</span>
            </button>
          </div>
          <button className="code-chip" onClick={copyCode} title="Copy classroom code">
            {classroom.code} {codeCopied ? <Icon name="check" size={14} /> : <Icon name="copy" size={14} />}
          </button>
        </div>
      </main>

      <aside className="side-panel">
        <div className="side-tabs">
          <button className={activeTab === 'people' ? 'active' : ''} onClick={() => setActiveTab('people')}>People ({rosterPeople.length})</button>
          <button className={activeTab === 'chat' ? 'active' : ''} onClick={() => setActiveTab('chat')}>Chat</button>
          <button className={activeTab === 'resources' ? 'active' : ''} onClick={() => setActiveTab('resources')}>Files</button>
        </div>

        {activeTab === 'people' && (
          <div className="panel-body people-list">
            {rosterPeople.map(p => (
              <div className="people-row" key={p.userId}>
                <span className="people-avatar">{initials(p.name)}</span>
                <div className="people-meta">
                  <strong>{p.name}{p.self ? ' (you)' : ''}</strong>
                  <span>{p.role === 'teacher' ? 'Teacher' : 'Student'}</span>
                </div>
                {raisedHands.some(h => h.userId === p.userId) && <span className="people-hand"><Icon name="hand" size={14} /></span>}
                {!p.self && classroom.settings.personalMessagingEnabled && (
                  <button className="people-action" title={`Message ${p.name}`} onClick={() => openPrivateChat(p)}><Icon name="chat" size={14} /></button>
                )}
                {!p.self && isTeacherOwner && (
                  <button className="people-action danger" title={`Remove ${p.name}`} onClick={() => decideMember(p.userId, 'REMOVED')}><Icon name="close" size={14} /></button>
                )}
              </div>
            ))}
          </div>
        )}

        {activeTab === 'chat' && !privateTarget && (
          <>
            <div className="panel-body chat-thread">
              {messages.filter(m => m != null).map((m, idx) => (
                <div className={`chat-bubble-row ${m.senderUserId === user.userId ? 'mine' : ''} ${m.type === 'SYSTEM' ? 'system' : ''}`} key={idx}>
                  {m.type === 'SYSTEM' ? (
                    <em className="system-note">{m.payload.text}</em>
                  ) : (
                    <div className="chat-bubble">
                      {m.senderUserId !== user.userId && <span className="chat-sender">{m.senderUser}</span>}
                      <p>{m.payload.text}</p>
                      <span className="chat-time">{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {classroom.settings.groupChatEnabled ? (
              <form className="panel-input" onSubmit={sendMessage}>
                <input type="text" value={inputMsg} onChange={e => setInputMsg(e.target.value)} placeholder="Type your message" />
                <button type="submit" className="send-btn"><Icon name="send" size={16} /></button>
              </form>
            ) : <p className="panel-disabled-note">Group chat is disabled by the teacher.</p>}
          </>
        )}

        {activeTab === 'chat' && privateTarget && (
          <>
            <div className="panel-subheader">
              <span>Private — {privateTarget.name}</span>
              <button className="icon-btn-ghost" onClick={() => setPrivateTarget(null)}><Icon name="close" size={14} /></button>
            </div>
            <div className="panel-body chat-thread">
              {privateMessages.filter(m => [m.fromUserId, m.toUserId].includes(privateTarget.userId)).map((m, idx) => (
                <div className={`chat-bubble-row ${m.fromUserId === user.userId ? 'mine' : ''}`} key={idx}>
                  <div className="chat-bubble">
                    {m.fromUserId !== user.userId && <span className="chat-sender">{m.fromName}</span>}
                    <p>{m.text}</p>
                  </div>
                </div>
              ))}
            </div>
            <form className="panel-input" onSubmit={sendPrivateMessage}>
              <input type="text" value={privateInput} onChange={e => setPrivateInput(e.target.value)} placeholder={`Message ${privateTarget.name}...`} />
              <button type="submit" className="send-btn"><Icon name="send" size={16} /></button>
            </form>
          </>
        )}

        {activeTab === 'resources' && (
          <div className="panel-body resources-list">
            {isTeacherOwner && shareRequests.length > 0 && (
              <div className="share-requests">
                <p className="eyebrow-small">Share requests ({shareRequests.length})</p>
                {shareRequests.map(r => (
                  <div key={r.resourceId} className="resource-row">
                    <div className="resource-row-icon"><Icon name="file" size={16} /></div>
                    <div className="resource-row-meta">
                      <strong>{r.originalName}</strong>
                      <span>from {r.uploaderName || 'a student'} · {(r.size / 1024).toFixed(1)} KB</span>
                    </div>
                    <button className="people-action accept" title="Approve" onClick={() => decideShare(r.resourceId, 'APPROVED')}><Icon name="check" size={14} /></button>
                    <button className="people-action danger" title="Reject" onClick={() => decideShare(r.resourceId, 'REJECTED')}><Icon name="close" size={14} /></button>
                  </div>
                ))}
              </div>
            )}

            {resources.length === 0 ? <p className="panel-empty">No resources shared yet.</p> : null}
            {resources.map(r => (
              <div key={r.resourceId} className="resource-row">
                <div className="resource-row-icon"><Icon name="file" size={16} /></div>
                <div className="resource-row-meta">
                  <strong>{r.originalName || r.fileName}</strong>
                  <span>
                    {r.ownerNodeId} · {(r.size / 1024).toFixed(1)} KB
                    {r.status === 'PENDING' && <em className="status-pending"> · awaiting approval</em>}
                  </span>
                </div>
                <button className="people-action" title="Download via RPC" onClick={() => handleResourceDownload(r.fileName)}>↓</button>
              </div>
            ))}
            {classroom.settings.fileSharingEnabled ? (
              <>
                <form onSubmit={handleFileUpload} className="resource-upload">
                  <input type="file" onChange={e => setFile(e.target.files[0])} />
                  <button type="submit" className="btn-primary">Upload</button>
                </form>
                {!isTeacherOwner && <p className="panel-hint">Shared files need teacher approval before the class can see them.</p>}
              </>
            ) : <p className="panel-disabled-note">File sharing is disabled by the teacher.</p>}
          </div>
        )}
      </aside>

      {isTeacherOwner && showWaiting && (
        <div className="drawer-overlay" onClick={() => setShowWaiting(false)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h3>Waiting Room</h3>
              <button className="icon-btn-ghost" onClick={() => setShowWaiting(false)}><Icon name="close" /></button>
            </div>
            <div className="drawer-body">
              {waitingList.length === 0 && <p className="panel-empty">No one is waiting.</p>}
              {waitingList.map(w => (
                <div className="people-row" key={w.userId}>
                  <span className="people-avatar">{initials(w.name)}</span>
                  <div className="people-meta"><strong>{w.name}</strong><span>Requested to join</span></div>
                  <button className="people-action accept" title="Admit" onClick={() => decideMember(w.userId, 'ADMITTED')}><Icon name="check" size={14} /></button>
                  <button className="people-action danger" title="Reject" onClick={() => decideMember(w.userId, 'REJECTED')}><Icon name="close" size={14} /></button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {isTeacherOwner && showSettings && (
        <div className="drawer-overlay" onClick={() => setShowSettings(false)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h3>Classroom Settings</h3>
              <button className="icon-btn-ghost" onClick={() => setShowSettings(false)}><Icon name="close" /></button>
            </div>
            <div className="drawer-body">
              {[
                { key: 'groupChatEnabled', label: 'Group chat' },
                { key: 'personalMessagingEnabled', label: 'Private messaging' },
                { key: 'fileSharingEnabled', label: 'File sharing' },
              ].map(({ key, label }) => (
                <label className="setting-toggle" key={key}>
                  <span>{label}</span>
                  <input type="checkbox" checked={!!classroom.settings[key]} onChange={e => updateSetting(key, e.target.checked)} />
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {isTeacherOwner && showAttendance && (
        <div className="drawer-overlay" onClick={() => setShowAttendance(false)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h3>Attendance</h3>
              <button className="icon-btn-ghost" onClick={() => setShowAttendance(false)}><Icon name="close" /></button>
            </div>
            <div className="drawer-body">
              <p className="panel-hint" style={{ marginTop: 0, marginBottom: '0.8rem' }}>
                "Lamport" is the logical join-order number, not a timestamp. A "Concurrent" badge means two students'
                joins had no causal path between them — genuinely simultaneous from the system's point of view, not just close in wall-clock time.
              </p>
              <table className="attendance-table">
                <thead><tr><th>Student</th><th>Joined</th><th>Lamport</th><th>Left</th><th>Status</th></tr></thead>
                <tbody>
                  {attendance.map(a => (
                    <tr key={a.userId}>
                      <td>
                        {a.name}
                        {a.concurrentWith?.length > 0 && (
                          <span className="status-pending" title={`Concurrent with: ${a.concurrentWith.join(', ')}`}> &middot; Concurrent</span>
                        )}
                      </td>
                      <td>{a.joinedAt ? new Date(a.joinedAt).toLocaleTimeString() : '--'}</td>
                      <td>{a.lamportTs ?? '--'}</td>
                      <td>{a.leftAt ? new Date(a.leftAt).toLocaleTimeString() : '--'}</td>
                      <td><span className={`status-dot ${a.status === 'Present' ? 'present' : ''}`} />{a.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default StudyRoom;
