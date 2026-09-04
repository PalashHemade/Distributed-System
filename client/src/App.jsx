import { BrowserRouter, Routes, Route } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import StudyRoom from './pages/StudyRoom';
import Dashboard from './pages/Dashboard';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/room/:roomId" element={<StudyRoom />} />
        <Route path="/admin/distributed" element={<Dashboard />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
