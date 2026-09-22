import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import api, { apiError } from '../api';
import { Modal, Loading, Empty, money, Badge, localDate } from '../components/ui.jsx';

const BLANK = { property_id: '', guest_name: '', amount: 0, due_date: '', notes: '' };

export default function Billing() {
  const [invoices, setInvoices] = useState([]);
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  const load = () =>
    Promise.all([api.get('/api/invoices'), api.get('/api/properties')])
      .then(([i, p]) => {
        setInvoices(i.data);
        setProperties(p.data);
      })
      .catch((e) => setError(apiError(e)))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const totals = useMemo(() => {
    const t = { invoiced: 0, paid: 0, outstanding: 0 };
    for (const inv of invoices) {
      if (inv.status === 'void') continue;
      t.invoiced += Number(inv.amount);
      if (inv.status === 'paid') t.paid += Number(inv.amount);
      else t.outstanding += Number(inv.amount);
    }
    return t;
  }, [invoices]);

  const generate = async () => {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/api/invoices/generate');
      await load();
      if (data.created === 0) setError('All reservations already have invoices.');
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/api/invoices', { ...form, property_id: form.property_id || null });
      setShowModal(false);
      await load();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (inv, status) => {
    await api.put(`/api/invoices/${inv.id}`, { status });
    await load();
  };

  const addPayLink = async (inv) => {
    const url = prompt('Paste a payment link for this invoice (e.g. Stripe/PayPal/Square):', inv.payment_url || '');
    if (url === null) return;
    await api.put(`/api/invoices/${inv.id}`, { payment_url: url });
    await load();
  };

  const copyPayLink = async (inv) => {
    try { await navigator.clipboard.writeText(inv.payment_url); } catch { /* blocked */ }
  };

  const remove = async (inv) => {
    if (!confirm(`Delete ${inv.number}?`)) return;
    await api.delete(`/api/invoices/${inv.id}`);
    await load();
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  if (loading) return <Loading />;

  return (
    <>
      <div className="page-header">
        <p className="subtitle">Automated billing & invoices</p>
        <div className="row">
          <button className="btn secondary" onClick={generate} disabled={busy}>⚡ Generate from reservations</button>
          <button className="btn" onClick={() => { setForm({ ...BLANK, property_id: properties[0]?.id || '' }); setShowModal(true); }}>+ New invoice</button>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="stats-grid">
        <div className="stat"><div className="label">🧾 Total invoiced</div><div className="value">{money(totals.invoiced)}</div></div>
        <div className="stat"><div className="label">✅ Paid</div><div className="value pos">{money(totals.paid)}</div></div>
        <div className="stat"><div className="label">⏳ Outstanding</div><div className="value" style={{ color: totals.outstanding > 0 ? 'var(--warning)' : 'inherit' }}>{money(totals.outstanding)}</div></div>
      </div>

      <div className="card">
        {invoices.length === 0 ? (
          <Empty icon="🧾" title="No invoices yet" subtitle="Auto-generate invoices from your reservations, or add one." action={<button className="btn" onClick={generate} disabled={busy}>⚡ Generate from reservations</button>} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Guest</th>
                  <th>Property</th>
                  <th>Amount</th>
                  <th>Issued</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const overdue = inv.status === 'unpaid' && inv.due_date && localDate(inv.due_date) < new Date();
                  return (
                    <tr key={inv.id}>
                      <td style={{ fontWeight: 600 }}>{inv.number}</td>
                      <td>{inv.guest_name || '—'}</td>
                      <td>{inv.property_name || '—'}</td>
                      <td>{money(inv.amount)}</td>
                      <td>{format(localDate(inv.issued_on), 'MMM d, yyyy')}</td>
                      <td>{inv.due_date ? format(localDate(inv.due_date), 'MMM d, yyyy') : '—'}</td>
                      <td>
                        <Badge kind={inv.status === 'paid' ? 'confirmed' : inv.status === 'void' ? 'cancelled' : overdue ? 'cancelled' : 'pending'}>
                          {inv.status === 'unpaid' && overdue ? 'overdue' : inv.status}
                        </Badge>
                      </td>
                      <td>
                        <div className="row wrap">
                          {inv.status !== 'paid' && <button className="btn ghost sm" onClick={() => setStatus(inv, 'paid')}>Mark paid</button>}
                          {inv.status === 'paid' && <button className="btn ghost sm" onClick={() => setStatus(inv, 'unpaid')}>Unpay</button>}
                          {inv.payment_url ? (
                            <>
                              <a className="btn ghost sm" href={inv.payment_url} target="_blank" rel="noreferrer">Pay ↗</a>
                              <button className="btn ghost sm" onClick={() => copyPayLink(inv)}>Copy link</button>
                            </>
                          ) : (
                            <button className="btn ghost sm" onClick={() => addPayLink(inv)}>+ Pay link</button>
                          )}
                          <button className="btn ghost sm" onClick={() => remove(inv)} style={{ color: 'var(--danger)' }}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <Modal
          title="New invoice"
          onClose={() => setShowModal(false)}
          footer={<><button className="btn secondary" onClick={() => setShowModal(false)}>Cancel</button><button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Create invoice'}</button></>}
        >
          <form onSubmit={save}>
            <div className="form-grid">
              <div className="field"><label>Guest</label><input value={form.guest_name} onChange={set('guest_name')} /></div>
              <div className="field"><label>Amount ($) *</label><input type="number" min="0" step="0.01" value={form.amount} onChange={set('amount')} required /></div>
              <div className="field"><label>Property</label><select value={form.property_id} onChange={set('property_id')}><option value="">—</option>{properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
              <div className="field"><label>Due date</label><input type="date" value={form.due_date} onChange={set('due_date')} /></div>
              <div className="field full"><label>Notes</label><textarea value={form.notes} onChange={set('notes')} /></div>
            </div>
            <button type="submit" style={{ display: 'none' }} />
          </form>
        </Modal>
      )}
    </>
  );
}
