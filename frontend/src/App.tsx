import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { Brief } from './pages/Brief';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { MorningCheck } from './pages/MorningCheck';
import { Portfolio } from './pages/Portfolio';

export function App() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/" element={user ? <Dashboard /> : <Navigate to="/login" replace />} />
      <Route path="/brief" element={user ? <Brief /> : <Navigate to="/login" replace />} />
      <Route path="/portfolio" element={user ? <Portfolio /> : <Navigate to="/login" replace />} />
      <Route path="/morning" element={user ? <MorningCheck /> : <Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
