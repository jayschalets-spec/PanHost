import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import api, { apiError } from '../api';
import { Modal, Loading, Empty, money, localDate } from '../components/ui.jsx';

const BLANK = { property_id: '', name: '', start_date: '', end_date: '', price: 0, min_stay: 1 };

export default function Pricing() {
  const [rules, setRules] = useState([]);
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  const load = () =>
    Promise.all([api.get('/api/pricing'), api.get('/api/properties')])
      .then(([r, p]) => {
        setRules(r.data);
        setProperties(p.data);
      })
      .catch((e) => setError(apiError(e)))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const openNew = () => {
    if (!properties.length) {
      setError('Add a property first.');
      return;
    }
    setForm({ ...BLANK, property_id: properties[0].id });
    setShowModal(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/api/pricing', form);
      setShowModal(false);
      await load();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r) => {
    if (!confirm(`Delete pricing rule "${r.name}"?`)) return;
    try {
      await api.delete(`/api/pricing/${r.id}`);
      await load();
    } catch (err) {
      setError(apiError(err));
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  if (loading) return <Loading />;

  return (
    <>
      <div className="page-header">
        <p className="subtitle">Seasonal rates and minimum-stay rules</p>
        <button className="btn" onClick={openNew}>+ Add rule</button>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="card">
        {rules.length === 0 ? (
          <Empty
            icon="💲"
            title="No pricing rules"
            subtitle="Set seasonal rates so the right price applies automatically."
            action={<button className="btn" onClick={openNew}>+ Add rule</button>}
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Rule</th>
                  <th>Property</th>
                  <th>Dates</th>
                  <th>Price / night</th>
                  <th>Min stay</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td>{r.property_name}</td>
                    <td>
                      {r.start_date
                        ? `${format(localDate(r.start_date), 'MMM d')} – ${
                            r.end_date ? format(localDate(r.end_date), 'MMM d, yyyy') : '…'
                          }`
                        : 'Always'}
                    </td>
                    <td>{money(r.price)}</td>
                    <td>{r.min_stay} night{r.min_stay > 1 ? 's' : ''}</td>
                    <td>
                      <button className="btn ghost sm" onClick={() => remove(r)} style={{ color: 'var(--danger)' }}>
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
          title="Add pricing rule"
          onClose={() => setShowModal(false)}
          footer={
            <>
              <button className="btn secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save rule'}</button>
            </>
          }
        >
          <form onSubmit={save}>
            <div className="form-grid">
              <div className="field full">
                <label>Property *</label>
                <select value={form.property_id} onChange={set('property_id')} required>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="field full">
                <label>Rule name *</label>
                <input value={form.name} onChange={set('name')} placeholder="Summer peak" required />
              </div>
              <div className="field">
                <label>Start date</label>
                <input type="date" value={form.start_date} onChange={set('start_date')} />
              </div>
              <div className="field">
                <label>End date</label>
                <input type="date" value={form.end_date} onChange={set('end_date')} />
              </div>
              <div className="field">
                <label>Price / night ($) *</label>
                <input type="number" min="0" step="0.01" value={form.price} onChange={set('price')} required />
              </div>
              <div className="field">
                <label>Minimum stay (nights)</label>
                <input type="number" min="1" value={form.min_stay} onChange={set('min_stay')} />
              </div>
            </div>
            <button type="submit" style={{ display: 'none' }} />
          </form>
        </Modal>
      )}
    </>
  );
}
