import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { Protected } from './components/Protected';
import Login from './pages/Login';
import Home from './pages/Home';
import Challenges from './pages/Challenges';
import Runs from './pages/Runs';
import Profile from './pages/Profile';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      {/* HashRouter: ใช้บน GitHub Pages ได้โดยไม่ต้องตั้งค่า rewrite */}
      <HashRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Protected />}>
            <Route index element={<Home />} />
            <Route path="challenges" element={<Challenges />} />
            <Route path="runs" element={<Runs />} />
            <Route path="profile" element={<Profile />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  </StrictMode>,
);
