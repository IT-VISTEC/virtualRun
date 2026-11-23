import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { getDefaultAvatar } from '../lib/avatars';
import { Icon, RunnerIcon } from './Icons';

const LOGO = `${import.meta.env.BASE_URL}logo.webp`;

const NAV = [
  { to: '/', label: 'Home', icon: <Icon name="home" />, end: true },
  { to: '/challenges', label: 'Challenges', icon: <Icon name="award" />, end: false },
  { to: '/runs', label: 'Log Run', icon: <RunnerIcon size={22} strokeWidth={3.5} />, end: false },
  { to: '/profile', label: 'Profile', icon: <Icon name="user" />, end: false },
];

export function Layout() {
  const { profile, user } = useAuth();
  const m365Name = (user?.user_metadata?.full_name as string) || (user?.user_metadata?.name as string) || '';
  const name = profile?.display_name || m365Name || user?.email || 'Runner';

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src={LOGO} alt="VISTEC Virtual Run" />
        </div>
        <nav className="nav" aria-label="Main navigation">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}>
              {n.icon}
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-user" title={name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img
            src={profile?.avatar_url || getDefaultAvatar(user?.id || name)}
            alt={name}
            style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
          />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        </div>
      </aside>

      <main className="main">
        <Outlet />
      </main>

      <nav className="tabbar" aria-label="Main navigation (mobile)">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} aria-label={n.label}>
            {n.icon}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
