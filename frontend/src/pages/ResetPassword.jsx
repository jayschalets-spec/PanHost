import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api, { apiError } from '../api';
import { useAuth } from '../auth.jsx';
import Logo from '../components/Logo.jsx';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const { login } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 10) {
      setError('Password must be at least 10 characters');
      return;
    }
    if (password !== confirm) {
      setError('Those passwords do not match');
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post('/api/auth/reset-password', { token, password });
      login(data.token, data.user);
      navigate('/');
    } catch (err) {
      setError(apiError(err));
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

        {!token ? (
          <>
            <h2>Link incomplete</h2>
            <div className="alert error">
              This reset link is missing its token. Open the link from your email exactly as sent,
              or request a new one.
            </div>
            <Link className="btn block secondary" to="/forgot-password">Request a new link</Link>
          </>
        ) : (
          <>
            <h2>Choose a new password</h2>
            <p className="auth-sub">
              Setting a new password signs you out on every other device.
            </p>
            {error && <div className="alert error">{error}</div>}
            <form onSubmit={submit}>
              <div className="field">
                <label>New password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 10 characters"
                  autoComplete="new-password"
                  required
                  autoFocus
                />
              </div>
              <div className="field">
                <label>Confirm new password</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>
              <button className="btn block" disabled={busy}>
                {busy ? 'Updating…' : 'Set new password'}
              </button>
            </form>
            <p className="auth-switch">
              <Link to="/login">Back to sign in</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
