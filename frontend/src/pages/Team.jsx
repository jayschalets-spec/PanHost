import { useEffect, useState } from 'react';
import api, { apiError } from '../api';
import { Modal, Loading, Empty, Badge } from '../components/ui.jsx';

const ROLES = ['cleaner', 'co-host', 'maintenance', 'owner'];
const ROLE_ICON = { cleaner: '🧹', 'co-host': '🤝', maintenance: '🔧', owner: '👑' };
const BLANK = { name: '', email: '', phone: '', role: 'cleaner' };

export default function Team() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api.get('/api/team').then((r) => setMembers(r.data)).catch((e) => setError(apiError(e))).finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (editing) await api.put(`/api/team/${editing.id}`, form);
      else await api.post('/api/team', form);
      setShowModal(false);
      await load();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (m) => {
    if (!confirm(`Remove ${m.name} from the team?`)) return;
    await api.delete(`/api/team/${m.id}`);
    await load();
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  if (loading) return <Loading />;

  return (
    <>
      <div className="page-header">
        <p className="subtitle">Cleaners, co-hosts & maintenance staff</p>
        <button className="btn" onClick={() => { setEditing(null); setForm(BLANK); setShowModal(true); }}>+ Add member</button>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="alert info">
        Assign team members to tasks. Scoped staff logins are on the roadmap — for now the roster powers task assignment and contact info.
      </div>

      {members.length === 0 ? (
        <div className="card"><Empty icon="👥" title="No team members" subtitle="Add cleaners and co-hosts to assign turnovers and tasks." /></div>
      ) : (
        <div className="grid-cards">
          {members.map((m) => (
            <div className="card" key={m.id}>
              <div className="card-body">
                <div className="row" style={{ gap: 12 }}>
                  <div className="avatar" style={{ background: 'var(--primary)' }}>{m.name.charAt(0).toUpperCase()}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{m.name}</div>
                    <Badge kind="direct">{ROLE_ICON[m.role] || ''} {m.role}</Badge>
                  </div>
                </div>
                <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>
                  {m.email && <div>✉️ {m.email}</div>}
                  {m.phone && <div>📞 {m.phone}</div>}
                </div>
                <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10, gap: 6 }}>
                  <button className="btn ghost sm" onClick={() => { setEditing(m); setForm({ ...BLANK, ...m }); setShowModal(true); }}>Edit</button>
                  <button className="btn ghost sm" onClick={() => remove(m)} style={{ color: 'var(--danger)' }}>Remove</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <Modal
          title={editing ? 'Edit member' : 'Add member'}
          onClose={() => setShowModal(false)}
          footer={<><button className="btn secondary" onClick={() => setShowModal(false)}>Cancel</button><button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}
        >
          <form onSubmit={save}>
            <div className="form-grid">
              <div className="field"><label>Name *</label><input value={form.name} onChange={set('name')} required /></div>
              <div className="field"><label>Role</label><select value={form.role} onChange={set('role')}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
              <div className="field"><label>Email</label><input type="email" value={form.email} onChange={set('email')} /></div>
              <div className="field"><label>Phone</label><input value={form.phone} onChange={set('phone')} /></div>
            </div>
            <button type="submit" style={{ display: 'none' }} />
          </form>
        </Modal>
      )}
    </>
  );
}
