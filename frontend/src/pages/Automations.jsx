import { useEffect, useState } from 'react';
import api, { apiError } from '../api';
import { Modal, Loading, Empty } from '../components/ui.jsx';

const TRIGGERS = {
  manual: 'Manual (canned reply)',
  booking_confirmed: 'When booking confirmed',
  before_checkin: 'Day before check-in',
  after_checkout: 'After check-out',
};

const BLANK = { name: '', body: '', trigger: 'manual', active: true };

const STARTERS = [
  {
    name: 'Booking confirmation',
    trigger: 'booking_confirmed',
    body: 'Hi {{guest}}, thanks for booking {{property}}! Your stay is confirmed for {{checkin}}–{{checkout}}. Let me know if you have any questions.',
  },
  {
    name: 'Check-in instructions',
    trigger: 'before_checkin',
    body: "Hi {{guest}}, check-in for {{property}} is tomorrow ({{checkin}}) from {{checkin_time}}. Your door code is {{doorcode}} and Wi-Fi is {{wifi}} / {{wifi_password}}. Everything you need is on your trip page: {{trip}}",
  },
  {
    name: 'Check-out reminder',
    trigger: 'after_checkout',
    body: 'Hi {{guest}}, thanks so much for staying at {{property}}! Checkout is at 11am. Safe travels — a review would mean the world.',
  },
];

export default function Automations() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [runMsg, setRunMsg] = useState('');
  const [running, setRunning] = useState(false);

  const runNow = async () => {
    setRunning(true);
    setRunMsg('');
    try {
      const { data } = await api.post('/api/automations/run');
      setRunMsg(`✅ Sent ${data.sent} automated message${data.sent === 1 ? '' : 's'}.`);
    } catch (err) {
      setRunMsg('⚠️ ' + apiError(err));
    } finally {
      setRunning(false);
    }
  };

  const load = () =>
    api
      .get('/api/templates')
      .then((r) => setItems(r.data))
      .catch((e) => setError(apiError(e)))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const openNew = (preset) => {
    setEditing(null);
    setForm(preset ? { ...BLANK, ...preset } : BLANK);
    setShowModal(true);
  };

  const openEdit = (t) => {
    setEditing(t);
    const clean = {};
    for (const k of Object.keys(BLANK)) clean[k] = t[k] ?? BLANK[k];
    setForm(clean);
    setShowModal(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (editing) await api.put(`/api/templates/${editing.id}`, form);
      else await api.post('/api/templates', form);
      setShowModal(false);
      await load();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (t) => {
    await api.put(`/api/templates/${t.id}`, { active: !t.active });
    await load();
  };

  const remove = async (t) => {
    if (!confirm(`Delete template "${t.name}"?`)) return;
    await api.delete(`/api/templates/${t.id}`);
    await load();
  };

  const set = (k) => (e) =>
    setForm({ ...form, [k]: k === 'active' ? e.target.checked : e.target.value });

  if (loading) return <Loading />;

  return (
    <>
      <div className="page-header">
        <p className="subtitle">Saved replies & automated guest messages</p>
        <div className="row">
          <button className="btn secondary" onClick={runNow} disabled={running}>{running ? 'Running…' : '▶ Run automations now'}</button>
          <button className="btn" onClick={() => openNew()}>+ New template</button>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}
      {runMsg && <div className={`alert ${runMsg.startsWith('✅') ? 'success' : 'error'}`}>{runMsg}</div>}

      <div className="alert info">
        Variables (auto-filled): <code>{'{{guest}}'}</code> <code>{'{{property}}'}</code>{' '}
        <code>{'{{checkin}}'}</code> <code>{'{{checkout}}'}</code> <code>{'{{checkin_time}}'}</code>{' '}
        <code>{'{{wifi}}'}</code> <code>{'{{wifi_password}}'}</code> <code>{'{{doorcode}}'}</code>{' '}
        <code>{'{{guide}}'}</code> (guidebook) <code>{'{{trip}}'}</code> (guest trip page). Active templates with a trigger send automatically; all appear as one-tap chips in the Inbox.
      </div>

      {items.length === 0 ? (
        <div className="card">
          <Empty
            icon="⚡"
            title="No templates yet"
            subtitle="Start from a proven template or write your own."
            action={
              <div className="row wrap" style={{ justifyContent: 'center' }}>
                {STARTERS.map((s) => (
                  <button key={s.name} className="btn secondary" onClick={() => openNew(s)}>
                    + {s.name}
                  </button>
                ))}
              </div>
            }
          />
        </div>
      ) : (
        <div className="grid-cards">
          {items.map((t) => (
            <div className="card" key={t.id}>
              <div className="card-body">
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                  <h3 style={{ fontSize: 16 }}>{t.name}</h3>
                  <span className={`badge ${t.active ? 'confirmed' : 'cancelled'}`}>
                    {t.active ? 'Active' : 'Off'}
                  </span>
                </div>
                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                  {TRIGGERS[t.trigger] || t.trigger}
                </div>
                <p style={{ fontSize: 13, color: 'var(--text)', marginBottom: 14 }}>
                  {t.body.slice(0, 130)}{t.body.length > 130 ? '…' : ''}
                </p>
                <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                  <button className="btn ghost sm" onClick={() => toggle(t)}>
                    {t.active ? 'Disable' : 'Enable'}
                  </button>
                  <button className="btn ghost sm" onClick={() => openEdit(t)}>Edit</button>
                  <button className="btn ghost sm" onClick={() => remove(t)} style={{ color: 'var(--danger)' }}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <Modal
          title={editing ? 'Edit template' : 'New template'}
          onClose={() => setShowModal(false)}
          footer={
            <>
              <button className="btn secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </>
          }
        >
          <form onSubmit={save}>
            <div className="field">
              <label>Name *</label>
              <input value={form.name} onChange={set('name')} required placeholder="Check-in instructions" />
            </div>
            <div className="field">
              <label>Trigger</label>
              <select value={form.trigger} onChange={set('trigger')}>
                {Object.entries(TRIGGERS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Message *</label>
              <textarea value={form.body} onChange={set('body')} rows={5} required
                placeholder="Hi {{guest}}, welcome to {{property}}…" />
            </div>
            <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.active} onChange={set('active')} style={{ width: 'auto' }} />
              <span>Active</span>
            </label>
            <button type="submit" style={{ display: 'none' }} />
          </form>
        </Modal>
      )}
    </>
  );
}
