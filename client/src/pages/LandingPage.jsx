import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { fetchCurrentUser, logout } from '../auth';
import './LandingPage.css';

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || 'http://localhost:5000';

async function pickActiveNode() {
  const res = await axios.get(`${GATEWAY_URL}/health`);
  const nodes = (res.data.nodes || []).filter(n => n.status === 'ONLINE');
  if (nodes.length === 0) throw new Error('No active nodes available');
  return nodes[Math.floor(Math.random() * nodes.length)];
}

function AuthForm({ onAuthed }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('student');
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const path = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body = mode === 'login' ? { email, password } : { email, password, name, role };
      const res = await axios.post(`${GATEWAY_URL}${path}`, body);
      onAuthed(res.data.user);
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong');
    }
  };

  return (
    <div className="landing-card">
      <h1>Distributed Online Classroom</h1>
      <p className="subtitle">{mode === 'login' ? 'Log in to continue' : 'Create an account'}</p>
      <form className="join-form" onSubmit={submit}>
        {mode === 'register' && (
          <>
            <input type="text" placeholder="Your Name" value={name} onChange={e => setName(e.target.value)} required />
            <div style={{ display: 'flex', gap: '1rem', margin: '0.5rem 0' }}>
              <label><input type="radio" checked={role === 'student'} onChange={() => setRole('student')} /> Student</label>
              <label><input type="radio" checked={role === 'teacher'} onChange={() => setRole('teacher')} /> Teacher</label>
            </div>
          </>
        )}
        <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required />
        <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required />
        {error && <p style={{ color: '#f66' }}>{error}</p>}
        <button type="submit" className="btn-primary">{mode === 'login' ? 'Log In' : 'Register'}</button>
      </form>
      <p className="distributed-subtext">
        {mode === 'login' ? (
          <>No account? <a href="#" onClick={(e) => { e.preventDefault(); setMode('register'); }}>Register</a></>
        ) : (
          <>Already have an account? <a href="#" onClick={(e) => { e.preventDefault(); setMode('login'); }}>Log in</a></>
        )}
      </p>
    </div>
  );
}

function TeacherDashboard({ user, onLogout }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const createClassroom = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const node = await pickActiveNode();
      const res = await axios.post(`http://${node.host || 'localhost'}:${node.port}/api/classrooms`, { name });
      navigate(`/classroom/${res.data.code}`);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  return (
    <div className="landing-card">
      <h1>Teacher Dashboard</h1>
      <p className="subtitle">Welcome, {user.name}</p>
      <form className="join-form" onSubmit={createClassroom}>
        <h3>Create a Classroom</h3>
        <input type="text" placeholder="Classroom Name" value={name} onChange={e => setName(e.target.value)} required />
        {error && <p style={{ color: '#f66' }}>{error}</p>}
        <button type="submit" className="btn-primary">Create Classroom</button>
      </form>
      <button className="btn-secondary" style={{ marginTop: '1rem' }} onClick={onLogout}>Log Out</button>
    </div>
  );
}

function StudentDashboard({ user, onLogout }) {
  const [code, setCode] = useState('');
  const navigate = useNavigate();

  const joinClassroom = (e) => {
    e.preventDefault();
    if (!code) return;
    navigate(`/classroom/${code.trim()}`);
  };

  return (
    <div className="landing-card">
      <h1>Student Dashboard</h1>
      <p className="subtitle">Welcome, {user.name}</p>
      <form className="join-form" onSubmit={joinClassroom}>
        <h3>Join a Classroom</h3>
        <input type="text" placeholder="Classroom Code (e.g. DS-482)" value={code} onChange={e => setCode(e.target.value)} required />
        <button type="submit" className="btn-secondary">Join Classroom</button>
      </form>
      <button className="btn-secondary" style={{ marginTop: '1rem' }} onClick={onLogout}>Log Out</button>
    </div>
  );
}

function LandingPage() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetchCurrentUser().then(u => { setUser(u); setChecking(false); });
  }, []);

  const handleLogout = async () => {
    await logout();
    setUser(null);
  };

  if (checking) return <div className="landing-container"><p style={{ color: '#aaa' }}>Loading...</p></div>;

  return (
    <div className="landing-container">
      {!user && <AuthForm onAuthed={setUser} />}
      {user && user.role === 'teacher' && <TeacherDashboard user={user} onLogout={handleLogout} />}
      {user && user.role === 'student' && <StudentDashboard user={user} onLogout={handleLogout} />}
    </div>
  );
}

export default LandingPage;
