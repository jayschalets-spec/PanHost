import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import api, { apiError } from '../api';
import { Modal, Loading, Empty, money, localDate } from '../components/ui.jsx';

const CATEGORIES = [
  'cleaning',
  'maintenance',
  'utilities',
  'supplies',
  'fees',
  'insurance',
  'other',
];

const BLANK = {
  property_id: '',
  category: 'cleaning',
  description: '',
  amount: 0,
  spent_on: new Date().toISOString().slice(0, 10),
  receipt_url: '',
};

export default function Finances() {
  const [expenses, setExpenses] = useState([]);
  const [properties, setProperties] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  const load = () =>
    Promise.all([
      api.get('/api/expenses'),
      api.get('/api/properties'),
      api.get('/api/dashboard'),
    ])
      .then(([e, p, d]) => {
        setExpenses(e.data);
        setProperties(p.data);
        setStats(d.data);
      })
      .catch((err) => setError(apiError(err)))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const byCategory = useMemo(() => {
    const totals = {};
    for (const e of expenses) {
      totals[e.category] = (totals[e.category] || 0) + Number(e.amount);
    }
    return totals;
  }, [expenses]);

  const maxCat = Math.max(1, ...Object.values(byCategory));

  const openNew = () => {
    setForm({ ...BLANK, property_id: properties[0]?.id || '' });
    setShowModal(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/api/expenses', { ...form, property_id: form.property_id || null });
      setShowModal(false);
      await load();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (x) => {
    if (!confirm('Delete this expense?')) return;
    try {
      await api.delete(`/api/expenses/${x.id}`);
      await load();
    } catch (err) {
      setError(apiError(err));
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const exportPnl = () => {
    const rows = [['Profit & Loss', new Date().toLocaleDateString()], [], ['Revenue', stats.revenue]];
    rows.push([], ['Expenses by category', '']);
    CATEGORIES.filter((c) => byCategory[c]).forEach((c) => rows.push([c, byCategory[c]]));
    rows.push(['Total expenses', stats.expenses], [], ['Net profit', stats.profit], ['Margin', `${stats.revenue > 0 ? Math.round((stats.profit / stats.revenue) * 100) : 0}%`]);
    rows.push([], ['Expense detail'], ['Date', 'Category', 'Property', 'Description', 'Amount']);
    expenses.forEach((x) => rows.push([localDate(x.spent_on).toISOString().slice(0, 10), x.category, x.property_name || '', x.description || '', x.amount]));
    const csv = rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `pnl-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <Loading />;

  return (
    <>
      <div className="page-header">
        <p className="subtitle">Revenue, expenses, and profitability</p>
        <div className="row">
          <button className="btn secondary" onClick={exportPnl} disabled={!stats}>⬇ Export P&L</button>
          <button className="btn" onClick={openNew}>+ Add expense</button>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="stats-grid">
        <div className="stat">
          <div className="label">💵 Revenue</div>
          <div className="value pos">{money(stats.revenue)}</div>
        </div>
        <div className="stat">
          <div className="label">🧾 Expenses</div>
          <div className="value">{money(stats.expenses)}</div>
        </div>
        <div className="stat">
          <div className="label">📈 Net profit</div>
          <div className={`value ${stats.profit >= 0 ? 'pos' : 'neg'}`}>{money(stats.profit)}</div>
        </div>
        <div className="stat">
          <div className="label">📊 Margin</div>
          <div className="value">
            {stats.revenue > 0 ? Math.round((stats.profit / stats.revenue) * 100) : 0}%
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header"><h3>Expenses by category</h3></div>
        <div className="card-body">
          {Object.keys(byCategory).length === 0 ? (
            <p className="muted">No expenses recorded yet.</p>
          ) : (
            CATEGORIES.filter((c) => byCategory[c]).map((c) => (
              <div key={c} style={{ marginBottom: 12 }}>
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ textTransform: 'capitalize', fontSize: 14 }}>{c}</span>
                  <span style={{ fontWeight: 600 }}>{money(byCategory[c])}</span>
                </div>
                <div style={{ height: 8, background: 'var(--surface-2)', borderRadius: 999 }}>
                  <div
                    style={{
                      width: `${(byCategory[c] / maxCat) * 100}%`,
                      height: '100%',
                      background: 'var(--primary)',
                      borderRadius: 999,
                    }}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3>All expenses</h3></div>
        {expenses.length === 0 ? (
          <Empty icon="🧾" title="No expenses" subtitle="Track cleaning, maintenance, utilities and more." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Property</th>
                  <th>Description</th>
                  <th>Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((x) => (
                  <tr key={x.id}>
                    <td>{format(localDate(x.spent_on), 'MMM d, yyyy')}</td>
                    <td style={{ textTransform: 'capitalize' }}>{x.category}</td>
                    <td>{x.property_name || '—'}</td>
                    <td>
                      {x.description || '—'}
                      {x.receipt_url && (
                        <a href={x.receipt_url} target="_blank" rel="noreferrer" title="View receipt" style={{ marginLeft: 6 }}>🧾</a>
                      )}
                    </td>
                    <td>{money(x.amount)}</td>
                    <td>
                      <button className="btn ghost sm" onClick={() => remove(x)} style={{ color: 'var(--danger)' }}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <Modal
          title="Add expense"
          onClose={() => setShowModal(false)}
          footer={
            <>
              <button className="btn secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save expense'}</button>
            </>
          }
        >
          <form onSubmit={save}>
            <div className="form-grid">
              <div className="field">
                <label>Category *</label>
                <select value={form.category} onChange={set('category')}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c} style={{ textTransform: 'capitalize' }}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Amount ($) *</label>
                <input type="number" min="0" step="0.01" value={form.amount} onChange={set('amount')} required />
              </div>
              <div className="field">
                <label>Property</label>
                <select value={form.property_id} onChange={set('property_id')}>
                  <option value="">General / unassigned</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Date</label>
                <input type="date" value={form.spent_on} onChange={set('spent_on')} />
              </div>
              <div className="field full">
                <label>Description</label>
                <input value={form.description} onChange={set('description')} placeholder="Turnover clean, plumber, etc." />
              </div>
              <div className="field full">
                <label>Receipt URL <span className="muted" style={{ fontWeight: 400 }}>(link to photo/PDF)</span></label>
                <input value={form.receipt_url} onChange={set('receipt_url')} placeholder="https://…/receipt.jpg" />
              </div>
            </div>
            <button type="submit" style={{ display: 'none' }} />
          </form>
        </Modal>
      )}
    </>
  );
}
