import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { AdminOnly, Protected, RequireSession } from './components/Protected';
import Login from './pages/Login';
import Onboarding from './pages/Onboarding';
import Home from './pages/Home';
import Leaderboard from './pages/Leaderboard';
import LogRun from './pages/LogRun';
import Team from './pages/Team';
import Profile from './pages/Profile';
import Admin from './pages/Admin';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      {/* HashRouter works on GitHub Pages without rewrites */}
      <HashRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<RequireSession />}>
            <Route path="welcome" element={<Onboarding />} />
          </Route>
          <Route element={<Protected />}>
            <Route index element={<Home />} />
            <Route path="leaderboard" element={<Leaderboard />} />
            <Route path="log" element={<LogRun />} />
            <Route path="team" element={<Team />} />
            <Route path="profile" element={<Profile />} />
            <Route element={<AdminOnly />}>
              <Route path="admin" element={<Admin />} />
            </Route>
          </Route>
          <Route path="runs" element={<Navigate to="/log" replace />} />
          <Route path="challenges" element={<Navigate to="/leaderboard" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  </StrictMode>,
);
