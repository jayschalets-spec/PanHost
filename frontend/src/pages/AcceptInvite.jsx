import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import api, { apiError } from '../api';
import { useAuth } from '../auth.jsx';
import Logo from '../components/Logo.jsx';

export default function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const { login } = useAuth();
  const navigate = useNavigate();
  const [invite, setInvite] = useState(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('Missing invite token.');
      return;
    }
    api
      .get(`/api/auth/invite/${token}`)
      .then((r) => setInvite(r.data))
      .catch((e) => setError(apiError(e)));
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post('/api/auth/accept-invite', { token, password });
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
        {error && !invite ? (
          <>
            <h2>Invite unavailable</h2>
            <p className="auth-sub">{error}</p>
            <p className="auth-switch"><Link to="/login">Go to sign in</Link></p>
          </>
        ) : invite ? (
          <>
            <h2>Join {invite.brand}</h2>
            <p className="auth-sub">
              You're invited as <strong>{invite.role}</strong>. Set a password for <strong>{invite.email}</strong>.
            </p>
            {error && <div className="alert error">{error}</div>}
            <form onSubmit={submit}>
              <div className="field">
                <label>Choose a password</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" required />
              </div>
              <button className="btn block" disabled={busy}>{busy ? 'Setting up…' : 'Accept & log in'}</button>
            </form>
          </>
        ) : (
          <div className="loading"><div className="spinner" /></div>
        )}
      </div>
    </div>
  );
}
