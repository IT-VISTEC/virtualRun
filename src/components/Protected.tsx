import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Layout } from './Layout';

export function Protected() {
  const { loading, session } = useAuth();
  if (loading) return <div className="center-screen" role="status">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  return <Layout />;
}
