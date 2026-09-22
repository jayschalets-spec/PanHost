import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import api, { apiError } from '../api';
import { Modal, Loading, Empty, Badge, localDate } from '../components/ui.jsx';

const BLANK = { property_id: '', guest_name: '', platform: 'airbnb', rating: 5, body: '', reviewed_on: new Date().toISOString().slice(0, 10) };

function Stars({ n }) {
  return <span style={{ color: '#f59e0b', letterSpacing: 1 }}>{'★'.repeat(n)}{'☆'.repeat(5 - n)}</span>;
}

export default function Reviews() {
  const [reviews, setReviews] = useState([]);
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [replyFor, setReplyFor] = useState(null);
  const [replyText, setReplyText] = useState('');

  const load = () =>
    Promise.all([api.get('/api/reviews'), api.get('/api/properties')])
      .then(([r, p]) => {
        setReviews(r.data);
        setProperties(p.data);
      })
      .catch((e) => setError(apiError(e)))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const avg = useMemo(
    () => (reviews.length ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(2) : '—'),
    [reviews]
  );

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/api/reviews', { ...form, property_id: form.property_id || null });
      setShowModal(false);
      await load();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const saveReply = async (r) => {
    await api.put(`/api/reviews/${r.id}`, { response: replyText });
    setReplyFor(null);
    setReplyText('');
    await load();
  };

  const remove = async (r) => {
    if (!confirm('Delete this review?')) return;
    await api.delete(`/api/reviews/${r.id}`);
    await load();
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  if (loading) return <Loading />;

  return (
    <>
      <div className="page-header">
        <p className="subtitle">Guest reviews across all channels</p>
        <button className="btn" onClick={() => { setForm({ ...BLANK, property_id: properties[0]?.id || '' }); setShowModal(true); }}>+ Add review</button>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="stats-grid">
        <div className="stat"><div className="label">⭐ Average rating</div><div className="value">{avg}</div></div>
        <div className="stat"><div className="label">📝 Total reviews</div><div className="value">{reviews.length}</div></div>
        <div className="stat"><div className="label">↩️ Awaiting response</div><div className="value">{reviews.filter((r) => !r.response).length}</div></div>
      </div>

      {reviews.length === 0 ? (
        <div className="card"><Empty icon="⭐" title="No reviews yet" subtitle="Log guest reviews to track ratings and respond." /></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {reviews.map((r) => (
            <div className="card" key={r.id}>
              <div className="card-body">
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                  <div className="row wrap" style={{ gap: 8 }}>
                    <strong>{r.guest_name || 'Guest'}</strong>
                    <Badge kind={r.platform}>{r.platform}</Badge>
                    {r.property_name && <span className="muted" style={{ fontSize: 13 }}>· {r.property_name}</span>}
                  </div>
                  <Stars n={r.rating} />
                </div>
                {r.body && <p style={{ fontSize: 14, marginBottom: 8 }}>{r.body}</p>}
                <div className="muted" style={{ fontSize: 12 }}>{format(localDate(r.reviewed_on), 'MMM d, yyyy')}</div>
                {r.response ? (
                  <div style={{ marginTop: 10, padding: 10, background: 'var(--primary-soft)', borderRadius: 8, fontSize: 13 }}>
                    <strong>Your response:</strong> {r.response}
                  </div>
                ) : replyFor === r.id ? (
                  <div style={{ marginTop: 10 }}>
                    <textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Write a public response…" />
                    <div className="row" style={{ marginTop: 6 }}>
                      <button className="btn sm" onClick={() => saveReply(r)}>Save response</button>
                      <button className="btn ghost sm" onClick={() => setReplyFor(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="row" style={{ marginTop: 10, gap: 6 }}>
                    <button className="btn ghost sm" onClick={() => { setReplyFor(r.id); setReplyText(''); }}>↩️ Respond</button>
                    <button className="btn ghost sm" onClick={() => remove(r)} style={{ color: 'var(--danger)' }}>Delete</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <Modal
          title="Add review"
          onClose={() => setShowModal(false)}
          footer={<><button className="btn secondary" onClick={() => setShowModal(false)}>Cancel</button><button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save review'}</button></>}
        >
          <form onSubmit={save}>
            <div className="form-grid">
              <div className="field"><label>Guest</label><input value={form.guest_name} onChange={set('guest_name')} /></div>
              <div className="field"><label>Rating</label><select value={form.rating} onChange={set('rating')}>{[5,4,3,2,1].map((n) => <option key={n} value={n}>{n} ★</option>)}</select></div>
              <div className="field"><label>Platform</label><select value={form.platform} onChange={set('platform')}><option value="airbnb">Airbnb</option><option value="vrbo">VRBO</option><option value="booking">Booking.com</option><option value="direct">Direct</option></select></div>
              <div className="field"><label>Property</label><select value={form.property_id} onChange={set('property_id')}><option value="">—</option>{properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
              <div className="field full"><label>Review</label><textarea value={form.body} onChange={set('body')} /></div>
            </div>
            <button type="submit" style={{ display: 'none' }} />
          </form>
        </Modal>
      )}
    </>
  );
}
