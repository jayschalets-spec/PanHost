import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import api, { apiError } from '../api';
import { useAuth } from '../auth.jsx';
import Logo from '../components/Logo.jsx';

// Latest date of birth that is still 18 years ago today.
function maxDobToday() {
  const d = new Date();
  return new Date(d.getFullYear() - 18, d.getMonth(), d.getDate()).toISOString().slice(0, 10);
}

export default function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const { login } = useAuth();
  const navigate = useNavigate();
  const [invite, setInvite] = useState(null);
  const [password, setPassword] = useState('');
  const [dob, setDob] = useState('');
  const [accepted, setAccepted] = useState(false);
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
    if (password.length < 10) {
      setError('Password must be at least 10 characters');
      return;
    }
    if (!dob) {
      setError('Please enter your date of birth');
      return;
    }
    if (dob > maxDobToday()) {
      setError('You must be at least 18 years old to use PanHost');
      return;
    }
    if (!accepted) {
      setError('Please accept the Terms of Use and Privacy Policy');
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post('/api/auth/accept-invite', {
        token,
        password,
        date_of_birth: dob,
        accept_terms: accepted,
      });
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
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 10 characters" required />
              </div>
              <div className="field">
                <label>Date of birth</label>
                <input type="date" value={dob} max={maxDobToday()} onChange={(e) => setDob(e.target.value)} required />
                <small className="muted">You must be 18 or older to use PanHost.</small>
              </div>
              <label className="row" style={{ gap: 10, alignItems: 'flex-start', margin: '14px 0' }}>
                <input type="checkbox" style={{ width: 'auto', marginTop: 3 }} checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
                <span style={{ fontSize: 13, lineHeight: 1.5 }}>
                  I confirm I am at least 18 years old and I agree to the{' '}
                  <Link to="/terms" target="_blank">Terms of Use</Link> and{' '}
                  <Link to="/privacy" target="_blank">Privacy Policy</Link>.
                </span>
              </label>
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
