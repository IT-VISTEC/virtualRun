import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Layout } from './Layout';

const Loading = () => <div className="center-screen" role="status">Loading…</div>;

/** Signed-in only (no layout). Used for /welcome. */
export function RequireSession() {
  const { loading, session, profileLoading } = useAuth();
  if (loading || profileLoading) return <Loading />;
  if (!session) return <Navigate to="/login" replace />;
  return <Outlet />;
}

/** Signed-in AND registered; renders the app shell. Unregistered users go to /welcome. */
export function Protected() {
  const { loading, session, profile, profileLoading } = useAuth();
  if (loading || profileLoading) return <Loading />;
  if (!session) return <Navigate to="/login" replace />;
  if (profile && !profile.registered_at) return <Navigate to="/welcome" replace />;
  return <Layout />;
}

/** Admin-only child routes. */
export function AdminOnly() {
  const { isAdmin, profileLoading } = useAuth();
  if (profileLoading) return <Loading />;
  if (!isAdmin) return <Navigate to="/" replace />;
  return <Outlet />;
}
