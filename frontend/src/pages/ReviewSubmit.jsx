import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api, { apiError } from '../api';

export default function ReviewSubmit() {
  const { bookingId } = useParams();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [rating, setRating] = useState(5);
  const [hover, setHover] = useState(0);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api
      .get(`/api/public/review/${bookingId}`)
      .then((r) => {
        setInfo(r.data);
        if (r.data.brand_color) document.documentElement.style.setProperty('--primary', r.data.brand_color);
        if (r.data.already) setDone(true);
      })
      .catch((e) => setError(apiError(e)));
  }, [bookingId]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post(`/api/public/review/${bookingId}`, { rating, body });
      setDone(true);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  if (error && !info) return <div className="auth-wrap"><div className="auth-card"><div className="alert error">{error}</div></div></div>;
  if (!info) return <div className="loading"><div className="spinner" /></div>;

  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ maxWidth: 460 }}>
        {done ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🌟</div>
            <h2>Thank you!</h2>
            <p className="auth-sub">Your review helps {info.brand} so much. Safe travels!</p>
          </div>
        ) : (
          <>
            <h2 style={{ textAlign: 'center' }}>How was your stay?</h2>
            <p className="auth-sub">{info.property_name} · hosted by {info.brand}</p>
            {error && <div className="alert error">{error}</div>}
            <form onSubmit={submit}>
              <div style={{ textAlign: 'center', fontSize: 40, margin: '12px 0', cursor: 'pointer' }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <span
                    key={n}
                    onMouseEnter={() => setHover(n)}
                    onMouseLeave={() => setHover(0)}
                    onClick={() => setRating(n)}
                    style={{ color: n <= (hover || rating) ? '#f59e0b' : 'var(--border)' }}
                  >
                    ★
                  </span>
                ))}
              </div>
              <div className="field">
                <label>Tell us about it (optional)</label>
                <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="What did you love? Anything we can improve?" />
              </div>
              <button className="btn block" disabled={busy}>{busy ? 'Submitting…' : 'Submit review'}</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
