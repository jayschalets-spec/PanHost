import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api, { apiError } from '../api';
import { money } from '../components/ui.jsx';

export default function Book() {
  const { hostId } = useParams();
  const [host, setHost] = useState(null);
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({
    guest_name: '',
    guest_email: '',
    check_in: '',
    check_out: '',
    guests: 1,
    message: '',
  });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api
      .get(`/api/public/host/${hostId}`)
      .then((r) => {
        setHost(r.data.host);
        setProperties(r.data.properties);
        if (r.data.host.brand_color) {
          document.documentElement.style.setProperty('--primary', r.data.host.brand_color);
        }
      })
      .catch((e) => setError(apiError(e)))
      .finally(() => setLoading(false));
  }, [hostId]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/api/public/bookings', {
        host_id: hostId,
        property_id: selected.id,
        ...form,
      });
      setDone(true);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="loading"><div className="spinner" /></div>;
  if (error && !host) return <div className="auth-wrap"><div className="auth-card"><div className="alert error">{error}</div></div></div>;

  const brand = host?.brand_name || host?.company || 'Book your stay';

  if (done) {
    return (
      <div className="auth-wrap">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
          <h2>Request sent!</h2>
          <p className="auth-sub">
            Thanks {form.guest_name.split(' ')[0]} — {brand} received your request for{' '}
            {selected.name} and will be in touch shortly.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="book-page">
      <header className="book-header">
        <h1>{brand}</h1>
        <p>Browse listings and request your stay</p>
      </header>

      <div className="book-container">
        {!selected ? (
          <div className="grid-cards">
            {properties.map((p) => {
              const photos = (p.photos || '').split('\n').map((s) => s.trim()).filter(Boolean);
              return (
                <div className="card property-card" key={p.id}>
                  {photos[0] && (
                    <img src={photos[0]} alt={p.name} style={{ width: '100%', height: 180, objectFit: 'cover', borderTopLeftRadius: 'var(--radius)', borderTopRightRadius: 'var(--radius)' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                  )}
                  <div className="card-body">
                    <h3>{p.name}</h3>
                    <div className="meta">{[p.city, p.country].filter(Boolean).join(', ')}</div>
                    <div className="specs">
                      <span>🛏️ {p.bedrooms} bd</span>
                      <span>🛁 {p.bathrooms} ba</span>
                      <span>👥 {p.max_guests}</span>
                    </div>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <span className="price">{money(p.base_price)}<span className="muted" style={{ fontWeight: 400, fontSize: 13 }}> /night</span></span>
                      <button className="btn" onClick={() => setSelected(p)}>Request to book</button>
                    </div>
                  </div>
                </div>
              );
            })}
            {properties.length === 0 && <p className="muted">No listings available right now.</p>}
          </div>
        ) : (
          <div className="card" style={{ maxWidth: 560, margin: '0 auto' }}>
            <div className="card-header">
              <h3>Request: {selected.name}</h3>
              <button className="btn ghost sm" onClick={() => setSelected(null)}>← Back</button>
            </div>
            <div className="card-body">
              {error && <div className="alert error">{error}</div>}
              <form onSubmit={submit}>
                <div className="form-grid">
                  <div className="field">
                    <label>Your name *</label>
                    <input value={form.guest_name} onChange={set('guest_name')} required />
                  </div>
                  <div className="field">
                    <label>Email *</label>
                    <input type="email" value={form.guest_email} onChange={set('guest_email')} required />
                  </div>
                  <div className="field">
                    <label>Check-in *</label>
                    <input type="date" value={form.check_in} onChange={set('check_in')} required />
                  </div>
                  <div className="field">
                    <label>Check-out *</label>
                    <input type="date" value={form.check_out} onChange={set('check_out')} required />
                  </div>
                  <div className="field">
                    <label>Guests</label>
                    <input type="number" min="1" max={selected.max_guests} value={form.guests} onChange={set('guests')} />
                  </div>
                  <div className="field full">
                    <label>Message to host</label>
                    <textarea value={form.message} onChange={set('message')} placeholder="Tell the host about your trip…" />
                  </div>
                </div>
                <button className="btn block" disabled={busy}>{busy ? 'Sending…' : 'Send booking request'}</button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
