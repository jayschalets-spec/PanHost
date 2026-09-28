import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api, { apiError } from '../api';
import { useAuth } from '../auth.jsx';
import Logo from '../components/Logo.jsx';

// Latest date of birth that is still 18 years ago today — used to cap the picker.
function maxDobToday() {
  const d = new Date();
  return new Date(d.getFullYear() - 18, d.getMonth(), d.getDate()).toISOString().slice(0, 10);
}

export default function Register() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    date_of_birth: '',
    accept_terms: false,
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password.length < 10) {
      setError('Password must be at least 10 characters');
      return;
    }
    if (!form.date_of_birth) {
      setError('Please enter your date of birth');
      return;
    }
    if (form.date_of_birth > maxDobToday()) {
      setError('You must be at least 18 years old to create an account');
      return;
    }
    if (!form.accept_terms) {
      setError('Please accept the Terms of Use and Privacy Policy');
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post('/api/auth/register', form);
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
        <h2>Create your account</h2>
        <p className="auth-sub">Start managing properties in minutes</p>
        {error && <div className="alert error">{error}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label>Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Jane Host"
            />
          </div>
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
              placeholder="At least 10 characters"
              required
            />
          </div>
          <div className="field">
            <label>Date of birth</label>
            <input
              type="date"
              value={form.date_of_birth}
              max={maxDobToday()}
              onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })}
              required
            />
            <small className="muted">You must be 18 or older to use PanHost.</small>
          </div>
          <label className="row" style={{ gap: 10, alignItems: 'flex-start', margin: '14px 0' }}>
            <input
              type="checkbox"
              style={{ width: 'auto', marginTop: 3 }}
              checked={form.accept_terms}
              onChange={(e) => setForm({ ...form, accept_terms: e.target.checked })}
            />
            <span style={{ fontSize: 13, lineHeight: 1.5 }}>
              I confirm I am at least 18 years old and I agree to the{' '}
              <Link to="/terms" target="_blank">Terms of Use</Link> and{' '}
              <Link to="/privacy" target="_blank">Privacy Policy</Link>.
            </span>
          </label>
          <button className="btn block" disabled={busy}>
            {busy ? 'Creating account…' : 'Create account'}
          </button>
        </form>
        <p className="auth-switch">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
