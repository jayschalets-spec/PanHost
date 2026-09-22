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

const LINKS = [
  { to: '/', label: 'Dashboard', icon: '📊', end: true },
  { to: '/messages', label: 'Inbox', icon: '💬' },
  { to: '/properties', label: 'Listings', icon: '🏠' },
  { to: '/bookings', label: 'Reservations', icon: '📅' },
  { to: '/guests', label: 'Guests', icon: '👥' },
  { to: '/calendar', label: 'Calendar', icon: '🗓️' },
  { to: '/channels', label: 'Channel Manager', icon: '🔌' },
  { to: '/reviews', label: 'Reviews', icon: '⭐' },
  { to: '/tasks', label: 'Tasks', icon: '✅' },
  { to: '/smart-locks', label: 'Smart Locks', icon: '🔐' },
  { to: '/team', label: 'Team', icon: '🧑‍🤝‍🧑' },
  { to: '/pricing', label: 'Pricing', icon: '💲' },
  { to: '/finances', label: 'Finances', icon: '💰' },
  { to: '/billing', label: 'Billing', icon: '💳' },
  { to: '/statements', label: 'Statements', icon: '🧾' },
  { to: '/analytics', label: 'Analytics', icon: '📈' },
  { to: '/automations', label: 'Automations', icon: '⚡' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
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
        {LINKS.map((l) => (
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
        <div className="email">{user?.name || user?.email}</div>
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
