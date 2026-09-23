import { Routes, Route, Navigate, useLocation, useNavigate, Link } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth.jsx';
import Sidebar from './components/Sidebar.jsx';
import SearchBar from './components/SearchBar.jsx';
import Notifications from './components/Notifications.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Properties from './pages/Properties.jsx';
import Bookings from './pages/Bookings.jsx';
import Calendar from './pages/Calendar.jsx';
import Pricing from './pages/Pricing.jsx';
import Finances from './pages/Finances.jsx';
import Messages from './pages/Messages.jsx';
import Settings from './pages/Settings.jsx';
import Tasks from './pages/Tasks.jsx';
import Analytics from './pages/Analytics.jsx';
import Automations from './pages/Automations.jsx';
import Guests from './pages/Guests.jsx';
import Channels from './pages/Channels.jsx';
import Reviews from './pages/Reviews.jsx';
import Team from './pages/Team.jsx';
import SmartLocks from './pages/SmartLocks.jsx';
import Statements from './pages/Statements.jsx';
import Market from './pages/Market.jsx';
import Billing from './pages/Billing.jsx';
import Book from './pages/Book.jsx';
import Guide from './pages/Guide.jsx';
import Trip from './pages/Trip.jsx';
import AcceptInvite from './pages/AcceptInvite.jsx';
import ReviewSubmit from './pages/ReviewSubmit.jsx';
import OwnerStatement from './pages/OwnerStatement.jsx';
import { useState } from 'react';

const PAGE_TITLES = {
  '/': 'Dashboard',
  '/properties': 'Listings',
  '/bookings': 'Reservations',
  '/guests': 'Guests',
  '/calendar': 'Calendar',
  '/channels': 'Channel Manager',
  '/reviews': 'Reviews',
  '/tasks': 'Tasks',
  '/smart-locks': 'Smart Locks',
  '/team': 'Team',
  '/pricing': 'Pricing',
  '/market': 'Market',
  '/finances': 'Finances',
  '/billing': 'Billing',
  '/statements': 'Statements',
  '/analytics': 'Analytics',
  '/automations': 'Automations',
  '/messages': 'Inbox',
  '/settings': 'Settings',
};

function Shell({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const title = PAGE_TITLES[location.pathname] || 'Property Manager';
  const isHome = location.pathname === '/';
  return (
    <div className="app-shell">
      <Sidebar open={open} onClose={() => setOpen(false)} />
      {open && <div className="sidebar-backdrop show" onClick={() => setOpen(false)} />}
      <div className="main">
        <div className="topbar">
          <div className="row">
            <button className="menu-toggle" onClick={() => setOpen(true)}>
              ☰
            </button>
            <button
              className="btn secondary sm nav-btn"
              onClick={() => navigate(-1)}
              title="Go back"
            >
              ← Back
            </button>
            {!isHome && (
              <Link to="/" className="btn secondary sm nav-btn" title="Go to dashboard">
                🏠 Home
              </Link>
            )}
            <h1>{title}</h1>
          </div>
          <div className="row" style={{ gap: 12 }}>
            <SearchBar />
            <Notifications />
          </div>
        </div>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}

function Protected({ children }) {
  const { user, ready } = useAuth();
  if (!ready) {
    return (
      <div className="loading">
        <div className="spinner" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Shell>{children}</Shell>;
}

function PublicOnly({ children }) {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (user) return <Navigate to="/" replace />;
  return children;
}

function Router() {
  return (
    <Routes>
      <Route path="/book/:hostId" element={<Book />} />
      <Route path="/guide/:propertyId" element={<Guide />} />
      <Route path="/trip/:bookingId" element={<Trip />} />
      <Route path="/accept-invite" element={<AcceptInvite />} />
      <Route path="/review/:bookingId" element={<ReviewSubmit />} />
      <Route path="/owner/:propertyId" element={<OwnerStatement />} />
      <Route
        path="/login"
        element={
          <PublicOnly>
            <Login />
          </PublicOnly>
        }
      />
      <Route
        path="/register"
        element={
          <PublicOnly>
            <Register />
          </PublicOnly>
        }
      />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/properties" element={<Protected><Properties /></Protected>} />
      <Route path="/bookings" element={<Protected><Bookings /></Protected>} />
      <Route path="/calendar" element={<Protected><Calendar /></Protected>} />
      <Route path="/guests" element={<Protected><Guests /></Protected>} />
      <Route path="/channels" element={<Protected><Channels /></Protected>} />
      <Route path="/reviews" element={<Protected><Reviews /></Protected>} />
      <Route path="/tasks" element={<Protected><Tasks /></Protected>} />
      <Route path="/team" element={<Protected><Team /></Protected>} />
      <Route path="/smart-locks" element={<Protected><SmartLocks /></Protected>} />
      <Route path="/pricing" element={<Protected><Pricing /></Protected>} />
      <Route path="/market" element={<Protected><Market /></Protected>} />
      <Route path="/finances" element={<Protected><Finances /></Protected>} />
      <Route path="/billing" element={<Protected><Billing /></Protected>} />
      <Route path="/statements" element={<Protected><Statements /></Protected>} />
      <Route path="/analytics" element={<Protected><Analytics /></Protected>} />
      <Route path="/automations" element={<Protected><Automations /></Protected>} />
      <Route path="/messages" element={<Protected><Messages /></Protected>} />
      <Route path="/settings" element={<Protected><Settings /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Router />
    </AuthProvider>
  );
}
