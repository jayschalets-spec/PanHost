import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import Logo from './Logo.jsx';
import Icon from './Icon.jsx';

function readTheme() {
  try {
    return localStorage.getItem('theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

// roles omitted = visible to everyone. Otherwise restricted to listed roles.
const OPS = ['owner', 'co-host', 'cleaner', 'maintenance'];
const MGMT = ['owner', 'co-host'];
const LINKS = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/messages', label: 'Inbox', icon: 'inbox', roles: MGMT },
  { to: '/properties', label: 'Listings', icon: 'home', roles: MGMT },
  { to: '/bookings', label: 'Reservations', icon: 'calendarCheck', roles: MGMT },
  { to: '/guests', label: 'Guests', icon: 'users', roles: MGMT },
  { to: '/calendar', label: 'Calendar', icon: 'calendar', roles: OPS },
  { to: '/channels', label: 'Channel Manager', icon: 'plug', roles: MGMT },
  { to: '/reviews', label: 'Reviews', icon: 'star', roles: MGMT },
  { to: '/tasks', label: 'Tasks', icon: 'check', roles: OPS },
  { to: '/smart-locks', label: 'Smart Locks', icon: 'lock', roles: OPS },
  { to: '/team', label: 'Team', icon: 'users', roles: MGMT },
  { to: '/pricing', label: 'Pricing', icon: 'tag', roles: MGMT },
  { to: '/market', label: 'Market', icon: 'radar', roles: MGMT },
  { to: '/finances', label: 'Finances', icon: 'wallet', roles: ['owner'] },
  { to: '/billing', label: 'Billing', icon: 'card', roles: ['owner'] },
  { to: '/statements', label: 'Statements', icon: 'file', roles: ['owner'] },
  { to: '/analytics', label: 'Analytics', icon: 'chart', roles: MGMT },
  { to: '/automations', label: 'Automations', icon: 'bolt', roles: MGMT },
  { to: '/settings', label: 'Settings', icon: 'gear', roles: ['owner'] },
];

export default function Sidebar({ open, onClose }) {
  const { user, logout } = useAuth();
  const [theme, setTheme] = useState(readTheme);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try {
      localStorage.setItem('theme', next);
    } catch {
      /* ignore */
    }
    if (next === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
  };
  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="brand">
        <span className="logo"><Logo size={20} /></span>
        <span>{user?.brand_name || 'PanHost'}</span>
      </div>
      <nav>
        {LINKS.filter((l) => !l.roles || l.roles.includes(user?.role || 'owner')).map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            onClick={onClose}
          >
            <span className="icon"><Icon name={l.icon} /></span>
            <span>{l.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="email">
          {user?.name || user?.email}
          {user && !user.is_owner && user.role && (
            <span className="badge direct" style={{ marginLeft: 6, textTransform: 'capitalize' }}>{user.role}</span>
          )}
        </div>
        <button className="btn secondary sm block" onClick={toggleTheme} style={{ marginBottom: 8 }}>
          {theme === 'dark' ? '☀️ Light mode' : '🌙 Dark mode'}
        </button>
        <button className="btn secondary sm block" onClick={logout}>
          Log out
        </button>
      </div>
    </aside>
  );
}
