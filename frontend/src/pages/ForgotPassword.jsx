import { useState } from 'react';
import { Link } from 'react-router-dom';
import api, { apiError } from '../api';
import Logo from '../components/Logo.jsx';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/api/auth/forgot-password', { email });
      setSent(true);
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

        {sent ? (
          <>
            <h2>Check your email</h2>
            <p className="auth-sub">
              If <strong>{email}</strong> has an account, a reset link is on its way. It works once
              and expires in an hour.
            </p>
            <p className="muted" style={{ fontSize: 13 }}>
              Nothing arrived? Check spam, then try again — and make sure you used the address you
              signed up with.
            </p>
            <Link className="btn block secondary" to="/login">Back to sign in</Link>
          </>
        ) : (
          <>
            <h2>Reset your password</h2>
            <p className="auth-sub">We&rsquo;ll email you a link to choose a new one.</p>
            {error && <div className="alert error">{error}</div>}
            <form onSubmit={submit}>
              <div className="field">
                <label>Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoFocus
                />
              </div>
              <button className="btn block" disabled={busy}>
                {busy ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
            <p className="auth-switch">
              Remembered it? <Link to="/login">Sign in</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
