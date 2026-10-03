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

function ArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3 11L11 3M11 3H4.5M11 3V9.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MeshMark() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
      <circle cx="13" cy="5" r="3.4" fill="var(--black)" />
      <circle cx="4.5" cy="20" r="3.4" fill="var(--black)" />
      <circle cx="21.5" cy="20" r="3.4" fill="var(--black)" />
      <path d="M13 8.4L5.2 17M13 8.4L20.8 17M5.5 20H20.5" stroke="var(--black)" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function Nav({ onSignInClick }) {
  return (
    <nav className="nav">
      <div className="nav-brand">
        <MeshMark />
        <span>ClassMesh</span>
      </div>
      <div className="nav-links">
        <a href="#how-it-works">How it works</a>
        <a href="#platform">Platform</a>
      </div>
      <button className="btn-primary nav-cta" onClick={onSignInClick}>
        Sign In <ArrowIcon />
      </button>
    </nav>
  );
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
    <div className="auth-card" id="auth">
      <p className="eyebrow">{mode === 'login' ? 'Welcome back' : 'Create an account'}</p>
      <h3>{mode === 'login' ? 'Sign in to ClassMesh' : 'Join ClassMesh'}</h3>
      <form className="auth-form" onSubmit={submit}>
        {mode === 'register' && (
          <>
            <input type="text" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} required />
            <div className="role-toggle">
              <label className={role === 'student' ? 'active' : ''}>
                <input type="radio" checked={role === 'student'} onChange={() => setRole('student')} /> Student
              </label>
              <label className={role === 'teacher' ? 'active' : ''}>
                <input type="radio" checked={role === 'teacher'} onChange={() => setRole('teacher')} /> Teacher
              </label>
            </div>
          </>
        )}
        <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required />
        <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required />
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="btn-primary auth-submit">
          {mode === 'login' ? 'Log In' : 'Create Account'} <ArrowIcon />
        </button>
      </form>
      <p className="auth-switch">
        {mode === 'login' ? (
          <>No account yet? <a href="#" onClick={(e) => { e.preventDefault(); setMode('register'); }}>Register</a></>
        ) : (
          <>Already have an account? <a href="#" onClick={(e) => { e.preventDefault(); setMode('login'); }}>Log in</a></>
        )}
      </p>
    </div>
  );
}

function Hero({ onAuthed }) {
  return (
    <section className="hero">
      <div className="hero-grain" aria-hidden="true" />
      <span className="hero-watermark" aria-hidden="true">MESH</span>
      <div className="hero-inner">
        <div className="hero-copy">
          <h1>
            Classrooms built to <strong>connect.</strong><br />
            Built to survive a <strong>node going down.</strong>
          </h1>
          <p className="hero-sub">
            <strong>ClassMesh</strong> runs every lesson across three independent servers at once —
            waiting rooms, live chat, resource sharing, and attendance, kept in sync by{' '}
            <strong>RPC calls</strong>, a distributed message bus, and automatic failover the moment
            a server drops.
          </p>
          <div className="hero-cta-row">
            <a href="#auth" className="btn-primary">Get Started <ArrowIcon /></a>
            <div className="hero-arrow-line" aria-hidden="true">
              <span />
              <ArrowIcon />
            </div>
          </div>
          <div className="hero-stats">
            <div><strong>3</strong><span>Independent nodes</span></div>
            <div><strong>0</strong><span>Single point of failure</span></div>
            <div><strong>Real-time</strong><span>Cross-node sync</span></div>
            <div><strong>Role-based</strong><span>Teacher / student access</span></div>
          </div>
        </div>
        <AuthForm onAuthed={onAuthed} />
      </div>
    </section>
  );
}

function FeatureSection() {
  const features = [
    {
      title: 'Waiting room & roles',
      text: 'Teachers create a classroom and admit students one by one. Nobody enters a live room unannounced — every join is a deliberate decision.'
    },
    {
      title: 'Distributed by design',
      text: 'Three node processes share the same classroom through a message bus and RPC resource lookups — not one server pretending to be three.'
    },
    {
      title: 'Automatic failover',
      text: 'Lose the node you were connected to mid-class and the client quietly reconnects you to another one, without losing your place.'
    }
  ];

  return (
    <section className="features" id="how-it-works">
      <p className="eyebrow center">How it works</p>
      <h2>One classroom, three servers, zero visible seams</h2>
      <div className="feature-grid" id="platform">
        {features.map(f => (
          <div className="feature-card" key={f.title}>
            <div className="feature-index" aria-hidden="true">{features.indexOf(f) + 1}</div>
            <h3>{f.title}</h3>
            <p>{f.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function AppShell({ brandOnClick, children }) {
  return (
    <div className="app-shell">
      <nav className="nav nav-compact">
        <div className="nav-brand" onClick={brandOnClick} style={{ cursor: brandOnClick ? 'pointer' : 'default' }}>
          <MeshMark />
          <span>ClassMesh</span>
        </div>
      </nav>
      <main className="app-main">{children}</main>
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
    <AppShell>
      <div className="panel-card">
        <p className="eyebrow">Teacher dashboard</p>
        <h1>Welcome back, {user.name}</h1>
        <form className="auth-form" onSubmit={createClassroom}>
          <h3>Create a classroom</h3>
          <input type="text" placeholder="Classroom name" value={name} onChange={e => setName(e.target.value)} required />
          {error && <p className="form-error">{error}</p>}
          <button type="submit" className="btn-primary auth-submit">Create Classroom <ArrowIcon /></button>
        </form>
        <button className="btn-secondary panel-logout" onClick={onLogout}>Log Out</button>
      </div>
    </AppShell>
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
    <AppShell>
      <div className="panel-card">
        <p className="eyebrow">Student dashboard</p>
        <h1>Welcome back, {user.name}</h1>
        <form className="auth-form" onSubmit={joinClassroom}>
          <h3>Join a classroom</h3>
          <input type="text" placeholder="Classroom code (e.g. DS-482)" value={code} onChange={e => setCode(e.target.value)} required />
          <button type="submit" className="btn-primary auth-submit">Join Classroom <ArrowIcon /></button>
        </form>
        <button className="btn-secondary panel-logout" onClick={onLogout}>Log Out</button>
      </div>
    </AppShell>
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

  const scrollToAuth = () => {
    document.getElementById('auth')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  if (checking) return <div className="loading-screen" />;

  if (user && user.role === 'teacher') return <TeacherDashboard user={user} onLogout={handleLogout} />;
  if (user && user.role === 'student') return <StudentDashboard user={user} onLogout={handleLogout} />;

  return (
    <div className="site">
      <Nav onSignInClick={scrollToAuth} />
      <Hero onAuthed={setUser} />
      <FeatureSection />
      <footer className="site-footer">
        <div className="nav-brand">
          <MeshMark />
          <span>ClassMesh</span>
        </div>
        <p>A distributed-systems demonstration — RPC, message-oriented communication, P2P, and stream-oriented communication, in one classroom.</p>
      </footer>
    </div>
  );
}

export default LandingPage;
