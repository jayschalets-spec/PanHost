import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api, { apiError } from '../api';
import { useAuth } from '../auth.jsx';
import Logo from '../components/Logo.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { data } = await api.post('/api/auth/login', form);
      login(data.token, data.user);
      navigate('/');
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand">
          <span className="logo"><Logo size={20} /></span>
          <span>PanHost</span>
        </div>
        <h2>Welcome back</h2>
        <p className="auth-sub">Sign in to manage your properties</p>
        {error && <div className="alert error">{error}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label>Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="you@example.com"
              required
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="••••••••"
              required
            />
          </div>
          <button className="btn block" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="auth-switch" style={{ marginBottom: 6 }}>
          <Link to="/forgot-password">Forgot your password?</Link>
        </p>
        <p className="auth-switch" style={{ marginTop: 2 }}>
          No account? <Link to="/register">Create one</Link>
        </p>
        <p className="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 2 }}>
          <Link to="/terms">Terms of Use</Link> · <Link to="/privacy">Privacy Policy</Link>
        </p>
      </div>
    </div>
  );
}
