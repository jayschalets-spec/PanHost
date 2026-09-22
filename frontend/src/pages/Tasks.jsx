import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import api, { apiError } from '../api';
import { Modal, Loading, Empty, localDate } from '../components/ui.jsx';

const TYPES = ['cleaning', 'maintenance', 'check-in', 'check-out', 'other'];
const COLUMNS = [
  { key: 'open', label: 'Open' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'done', label: 'Done' },
];
const TYPE_ICON = {
  cleaning: '🧹',
  maintenance: '🔧',
  'check-in': '🔑',
  'check-out': '👋',
  other: '📌',
};

const BLANK = { property_id: '', title: '', type: 'cleaning', assignee: '', due_date: '', notes: '' };

export default function Tasks() {
  const [tasks, setTasks] = useState([]);
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  const load = () =>
    Promise.all([api.get('/api/tasks'), api.get('/api/properties')])
      .then(([t, p]) => {
        setTasks(t.data);
        setProperties(p.data);
      })
      .catch((e) => setError(apiError(e)))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const byStatus = useMemo(() => {
    const m = { open: [], in_progress: [], done: [] };
    for (const t of tasks) (m[t.status] || m.open).push(t);
    return m;
  }, [tasks]);

  const openNew = () => {
    setForm({ ...BLANK, property_id: properties[0]?.id || '' });
    setShowModal(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/api/tasks', { ...form, property_id: form.property_id || null });
      setShowModal(false);
      await load();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const move = async (t, status) => {
    await api.put(`/api/tasks/${t.id}`, { status });
    await load();
  };

  const remove = async (t) => {
    await api.delete(`/api/tasks/${t.id}`);
    await load();
  };

  const generate = async () => {
    setBusy(true);
    try {
      const { data } = await api.post('/api/tasks/generate-turnovers');
      await load();
      if (data.created === 0) setError('No new turnovers — all check-outs already have a cleaning task.');
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  if (loading) return <Loading />;

  const nextStatus = { open: 'in_progress', in_progress: 'done', done: 'open' };
  const nextLabel = { open: 'Start →', in_progress: 'Complete ✓', done: '↺ Reopen' };

  return (
    <>
      <div className="page-header">
        <p className="subtitle">Turnovers, cleaning & maintenance</p>
        <div className="row">
          <button className="btn secondary" onClick={generate} disabled={busy}>⚡ Generate turnovers</button>
          <button className="btn" onClick={openNew}>+ New task</button>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      {tasks.length === 0 ? (
        <div className="card">
          <Empty
            icon="✅"
            title="No tasks yet"
            subtitle="Generate cleaning turnovers from your bookings, or add a task."
            action={<button className="btn" onClick={generate} disabled={busy}>⚡ Generate turnovers</button>}
          />
        </div>
      ) : (
        <div className="board">
          {COLUMNS.map((col) => (
            <div className="board-col" key={col.key}>
              <div className="board-head">
                {col.label} <span className="count">{byStatus[col.key].length}</span>
              </div>
              <div className="board-body">
                {byStatus[col.key].map((t) => (
                  <div className="task-card" key={t.id}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <span className="badge direct">{TYPE_ICON[t.type] || '📌'} {t.type}</span>
                      <button className="close-x" style={{ fontSize: 16 }} onClick={() => remove(t)}>×</button>
                    </div>
                    <div style={{ fontWeight: 600, margin: '8px 0 4px', fontSize: 14 }}>{t.title}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {t.property_name || 'General'}
                      {t.due_date && ` · due ${format(localDate(t.due_date), 'MMM d')}`}
                      {t.assignee && ` · ${t.assignee}`}
                    </div>
                    <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => move(t, nextStatus[t.status])}>
                      {nextLabel[t.status]}
                    </button>
                  </div>
                ))}
                {byStatus[col.key].length === 0 && <div className="muted" style={{ fontSize: 13, padding: 8 }}>Nothing here</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <Modal
          title="New task"
          onClose={() => setShowModal(false)}
          footer={
            <>
              <button className="btn secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save task'}</button>
            </>
          }
        >
          <form onSubmit={save}>
            <div className="form-grid">
              <div className="field full">
                <label>Title *</label>
                <input value={form.title} onChange={set('title')} required placeholder="Turnover clean" />
              </div>
              <div className="field">
                <label>Type</label>
                <select value={form.type} onChange={set('type')}>
                  {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Property</label>
                <select value={form.property_id} onChange={set('property_id')}>
                  <option value="">General</option>
                  {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Assignee</label>
                <input value={form.assignee} onChange={set('assignee')} placeholder="Cleaner name" />
              </div>
              <div className="field">
                <label>Due date</label>
                <input type="date" value={form.due_date} onChange={set('due_date')} />
              </div>
              <div className="field full">
                <label>Notes</label>
                <textarea value={form.notes} onChange={set('notes')} />
              </div>
            </div>
            <button type="submit" style={{ display: 'none' }} />
          </form>
        </Modal>
      )}
    </>
  );
}
