import { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { getDefaultAvatar } from '../lib/avatars';
import { Icon, RunnerIcon } from './Icons';

const LOGO = `${import.meta.env.BASE_URL}logo.webp`;

type NavItem = { to: string; label: string; icon: ReactNode; end?: boolean };

const HOME: NavItem = { to: '/', label: 'Home', icon: <Icon name="home" />, end: true };
const BOARD: NavItem = { to: '/leaderboard', label: 'Leaderboard', icon: <Icon name="trophy" /> };
const LOG: NavItem = { to: '/log', label: 'Log Run', icon: <RunnerIcon size={22} strokeWidth={3.5} /> };
const TEAM: NavItem = { to: '/team', label: 'Group & Team', icon: <Icon name="users" /> };
const PROFILE: NavItem = { to: '/profile', label: 'Profile', icon: <Icon name="user" /> };
const ADMIN: NavItem = { to: '/admin', label: 'Admin', icon: <Icon name="shield" /> };

export function Layout() {
  const { profile, user, isAdmin } = useAuth();
  const m365Name = (user?.user_metadata?.full_name as string) || (user?.user_metadata?.name as string) || '';
  const name = profile?.display_name || m365Name || user?.email || 'Runner';
  const side = isAdmin ? [HOME, BOARD, LOG, TEAM, PROFILE, ADMIN] : [HOME, BOARD, LOG, TEAM, PROFILE];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src={LOGO} alt="VISTEC Virtual Run" />
        </div>
        <nav className="nav" aria-label="Main navigation">
          {side.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}>
              {n.icon}
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <NavLink to="/profile" className="sidebar-user" title={name}>
          <img src={profile?.avatar_url || getDefaultAvatar(user?.id || name)} alt="" />
          <span className="sidebar-user-name">{name}</span>
          {profile?.team && <span className="team-tag">{profile.team}</span>}
        </NavLink>
      </aside>

      <main className="main">
        <Outlet />
      </main>

      <nav className="tabbar" aria-label="Main navigation (mobile)">
        {[HOME, BOARD].map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} aria-label={n.label} title={n.label}>
            {n.icon}
          </NavLink>
        ))}
        <NavLink to="/log" className="tab-plus" aria-label="Log Run" title="Log Run">
          <Icon name="plus" size={30} strokeWidth={2.6} />
        </NavLink>
        {[TEAM, PROFILE].map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} aria-label={n.label} title={n.label}>
            {n.icon}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
