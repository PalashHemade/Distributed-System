import { BrowserRouter, Routes, Route } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import Classroom from './pages/StudyRoom';
import Dashboard from './pages/Dashboard';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/classroom/:code" element={<Classroom />} />
        <Route path="/admin/distributed" element={<Dashboard />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
