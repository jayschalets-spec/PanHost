import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import Logo from './Logo.jsx';

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
  { to: '/', label: 'Dashboard', icon: '📊', end: true },
  { to: '/messages', label: 'Inbox', icon: '💬', roles: MGMT },
  { to: '/properties', label: 'Listings', icon: '🏠', roles: MGMT },
  { to: '/bookings', label: 'Reservations', icon: '📅', roles: MGMT },
  { to: '/guests', label: 'Guests', icon: '👥', roles: MGMT },
  { to: '/calendar', label: 'Calendar', icon: '🗓️', roles: OPS },
  { to: '/channels', label: 'Channel Manager', icon: '🔌', roles: MGMT },
  { to: '/reviews', label: 'Reviews', icon: '⭐', roles: MGMT },
  { to: '/tasks', label: 'Tasks', icon: '✅', roles: OPS },
  { to: '/smart-locks', label: 'Smart Locks', icon: '🔐', roles: OPS },
  { to: '/team', label: 'Team', icon: '🧑‍🤝‍🧑', roles: MGMT },
  { to: '/pricing', label: 'Pricing', icon: '💲', roles: MGMT },
  { to: '/finances', label: 'Finances', icon: '💰', roles: ['owner'] },
  { to: '/billing', label: 'Billing', icon: '💳', roles: ['owner'] },
  { to: '/statements', label: 'Statements', icon: '🧾', roles: ['owner'] },
  { to: '/analytics', label: 'Analytics', icon: '📈', roles: MGMT },
  { to: '/automations', label: 'Automations', icon: '⚡', roles: MGMT },
  { to: '/settings', label: 'Settings', icon: '⚙️', roles: ['owner'] },
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
            <span className="icon">{l.icon}</span>
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
