import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import api, { apiError } from '../api';
import { Modal, Loading, Empty, money, Badge, localDate } from '../components/ui.jsx';

const BLANK = {
  property_id: '',
  guest_name: '',
  guest_email: '',
  platform: 'direct',
  check_in: '',
  check_out: '',
  guests: 1,
  total_amount: 0,
  status: 'confirmed',
};

export default function Bookings() {
  const [items, setItems] = useState([]);
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [params] = useSearchParams();
  const [filter, setFilter] = useState({ platform: '', status: params.get('status') || '' });
  const [detail, setDetail] = useState(null);

  const nightsOf = (b) => Math.max(0, Math.round((localDate(b.check_out) - localDate(b.check_in)) / 86400000));

  const genDoorCode = async () => {
    const { data } = await api.post(`/api/bookings/${detail.id}/lockcode`);
    setDetail(data);
    await load();
  };

  const load = () =>
    Promise.all([api.get('/api/bookings'), api.get('/api/properties')])
      .then(([b, p]) => {
        setItems(b.data);
        setProperties(p.data);
      })
      .catch((e) => setError(apiError(e)))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  // Prefill + open the modal when arriving from the calendar (click-to-create).
  useEffect(() => {
    const propId = params.get('property');
    const checkIn = params.get('check_in');
    if (propId && checkIn && properties.length && !showModal) {
      const co = new Date(checkIn);
      co.setDate(co.getDate() + 1);
      setEditing(null);
      setForm({
        ...BLANK,
        property_id: properties.some((p) => p.id === propId) ? propId : properties[0].id,
        check_in: checkIn,
        check_out: co.toISOString().slice(0, 10),
      });
      setShowModal(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [properties]);

  const filtered = useMemo(
    () =>
      items.filter(
        (b) =>
          (!filter.platform || b.platform === filter.platform) &&
          (!filter.status || b.status === filter.status)
      ),
    [items, filter]
  );

  const summary = useMemo(() => {
    const active = items.filter((b) => b.status !== 'cancelled');
    const now = new Date();
    return {
      total: items.length,
      upcoming: active.filter((b) => localDate(b.check_in) >= now).length,
      revenue: active.reduce((s, b) => s + Number(b.total_amount || 0), 0),
    };
  }, [items]);

  const openNew = () => {
    if (!properties.length) {
      setError('Add a property first before creating bookings.');
      return;
    }
    setEditing(null);
    setForm({ ...BLANK, property_id: properties[0].id });
    setShowModal(true);
  };

  const openEdit = (b) => {
    setEditing(b);
    const clean = {};
    for (const k of Object.keys(BLANK)) clean[k] = b[k] ?? BLANK[k];
    clean.check_in = b.check_in ? b.check_in.slice(0, 10) : '';
    clean.check_out = b.check_out ? b.check_out.slice(0, 10) : '';
    setForm(clean);
    setShowModal(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (editing) {
        const { property_id, ...rest } = form; // property is fixed on edit
        await api.put(`/api/bookings/${editing.id}`, rest);
      } else {
        await api.post('/api/bookings', form);
      }
      setShowModal(false);
      await load();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (b) => {
    if (!confirm(`Delete booking for ${b.guest_name}?`)) return;
    try {
      await api.delete(`/api/bookings/${b.id}`);
      await load();
    } catch (err) {
      setError(apiError(err));
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const [importing, setImporting] = useState(false);

  const parseCsv = (text) => {
    // Minimal CSV parser handling quoted fields.
    const rows = [];
    let row = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < text.length; i += 1) {
      const c = text[i];
      if (inQ) {
        if (c === '"' && text[i + 1] === '"') { cur += '"'; i += 1; }
        else if (c === '"') inQ = false;
        else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (cur !== '' || row.length) { row.push(cur); rows.push(row); row = []; cur = ''; }
        if (c === '\r' && text[i + 1] === '\n') i += 1;
      } else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
  };

  const importCsv = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    setError('');
    try {
      const text = await file.text();
      const rows = parseCsv(text).filter((r) => r.some((c) => c.trim()));
      if (rows.length < 2) throw new Error('CSV has no data rows.');
      const header = rows[0].map((h) => h.trim().toLowerCase());
      const idx = (name) => header.indexOf(name);
      const propByName = Object.fromEntries(properties.map((p) => [p.name.toLowerCase(), p.id]));
      let ok = 0;
      let failed = 0;
      for (const r of rows.slice(1)) {
        const get = (n) => (idx(n) >= 0 ? r[idx(n)]?.trim() : '');
        const propId =
          get('property_id') ||
          propByName[(get('property_name') || get('property') || '').toLowerCase()] ||
          properties[0]?.id;
        if (!propId || !get('guest_name') || !get('check_in') || !get('check_out')) { failed += 1; continue; }
        try {
          await api.post('/api/bookings', {
            property_id: propId,
            guest_name: get('guest_name'),
            guest_email: get('guest_email') || null,
            platform: get('platform') || 'direct',
            check_in: get('check_in'),
            check_out: get('check_out'),
            guests: Number(get('guests')) || 1,
            total_amount: Number(get('total_amount')) || 0,
            status: get('status') || 'confirmed',
          });
          ok += 1;
        } catch { failed += 1; }
      }
      await load();
      setError(`✅ Imported ${ok} reservation${ok === 1 ? '' : 's'}${failed ? `, ${failed} skipped` : ''}.`);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setImporting(false);
    }
  };

  const exportCsv = () => {
    const cols = ['guest_name', 'guest_email', 'property_name', 'platform', 'check_in', 'check_out', 'guests', 'total_amount', 'status'];
    const header = cols.join(',');
    const lines = filtered.map((b) =>
      cols
        .map((c) => {
          const v = b[c] ?? '';
          const s = String(v).replace(/"/g, '""');
          return /[",\n]/.test(s) ? `"${s}"` : s;
        })
        .join(',')
    );
    const csv = [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reservations-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <Loading />;

  return (
    <>
      <div className="page-header">
        <p className="subtitle">All reservations across platforms</p>
        <div className="row wrap">
          <label className="btn secondary" style={{ cursor: 'pointer' }}>
            {importing ? 'Importing…' : '⬆ Import CSV'}
            <input type="file" accept=".csv" onChange={importCsv} style={{ display: 'none' }} disabled={importing} />
          </label>
          <button className="btn secondary" onClick={exportCsv} disabled={!items.length}>⬇ Export CSV</button>
          <button className="btn" onClick={openNew}>+ Add booking</button>
        </div>
      </div>

      {error && <div className={`alert ${error.startsWith('✅') ? 'success' : 'error'}`}>{error}</div>}

      {items.length > 0 && (
        <div className="stats-grid">
          <div className="stat">
            <div className="label">📅 Total reservations</div>
            <div className="value">{summary.total}</div>
          </div>
          <div className="stat">
            <div className="label">⏭️ Upcoming</div>
            <div className="value">{summary.upcoming}</div>
          </div>
          <div className="stat">
            <div className="label">💵 Booked revenue</div>
            <div className="value pos">{money(summary.revenue)}</div>
          </div>
        </div>
      )}

      <div className="row wrap" style={{ marginBottom: 16 }}>
        <select
          style={{ width: 'auto' }}
          value={filter.platform}
          onChange={(e) => setFilter({ ...filter, platform: e.target.value })}
        >
          <option value="">All platforms</option>
          <option value="airbnb">Airbnb</option>
          <option value="vrbo">VRBO</option>
          <option value="booking">Booking.com</option>
          <option value="direct">Direct</option>
        </select>
        <select
          style={{ width: 'auto' }}
          value={filter.status}
          onChange={(e) => setFilter({ ...filter, status: e.target.value })}
        >
          <option value="">All statuses</option>
          <option value="confirmed">Confirmed</option>
          <option value="pending">Pending</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div className="card">
        {filtered.length === 0 ? (
          <Empty
            icon="📅"
            title="No bookings"
            subtitle="Add one manually or sync from a connected platform."
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Guest</th>
                  <th>Property</th>
                  <th>Platform</th>
                  <th>Check-in</th>
                  <th>Check-out</th>
                  <th>Guests</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <div>{b.guest_name}</div>
                      {b.guest_email && <div className="muted" style={{ fontSize: 12 }}>{b.guest_email}</div>}
                    </td>
                    <td>{b.property_name}</td>
                    <td><Badge kind={b.platform}>{b.platform}</Badge></td>
                    <td>{format(localDate(b.check_in), 'MMM d, yyyy')}</td>
                    <td>{format(localDate(b.check_out), 'MMM d, yyyy')}</td>
                    <td>{b.guests}</td>
                    <td>{money(b.total_amount)}</td>
                    <td><Badge kind={b.status}>{b.status}</Badge></td>
                    <td>
                      <div className="row">
                        <button className="btn ghost sm" onClick={() => setDetail(b)}>View</button>
                        <Link to={`/messages?booking=${b.id}`} className="btn ghost sm">💬</Link>
                        <button className="btn ghost sm" onClick={() => openEdit(b)}>Edit</button>
                        <button className="btn ghost sm" onClick={() => remove(b)} style={{ color: 'var(--danger)' }}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detail && (
        <Modal
          title={`${detail.guest_name} · ${detail.property_name}`}
          onClose={() => setDetail(null)}
          footer={
            <>
              <Link to={`/messages?booking=${detail.id}`} className="btn secondary">💬 Message</Link>
              <button className="btn" onClick={() => { const b = detail; setDetail(null); openEdit(b); }}>Edit</button>
            </>
          }
        >
          <div className="detail-grid">
            <div><div className="muted">Platform</div><Badge kind={detail.platform}>{detail.platform}</Badge></div>
            <div><div className="muted">Status</div><Badge kind={detail.status}>{detail.status}</Badge></div>
            <div><div className="muted">Check-in</div><strong>{format(localDate(detail.check_in), 'EEE, MMM d, yyyy')}</strong></div>
            <div><div className="muted">Check-out</div><strong>{format(localDate(detail.check_out), 'EEE, MMM d, yyyy')}</strong></div>
            <div><div className="muted">Nights</div><strong>{nightsOf(detail)}</strong></div>
            <div><div className="muted">Guests</div><strong>{detail.guests}</strong></div>
            <div><div className="muted">Total</div><strong>{money(detail.total_amount)}</strong></div>
            {detail.guest_email && <div><div className="muted">Email</div><a href={`mailto:${detail.guest_email}`}>{detail.guest_email}</a></div>}
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-body">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>🔐 Door code</div>
                  <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 18 }}>
                    {detail.door_code || '— not set —'}
                  </div>
                </div>
                <button className="btn secondary sm" onClick={genDoorCode}>
                  {detail.door_code ? 'Regenerate' : 'Generate'}
                </button>
              </div>
            </div>
          </div>

          <div className="row wrap" style={{ marginTop: 14, gap: 10 }}>
            <a className="btn secondary" href={`/trip/${detail.id}`} target="_blank" rel="noreferrer">🧳 Guest trip page</a>
            <a className="btn secondary" href={`/guide/${detail.property_id}`} target="_blank" rel="noreferrer">📖 Guidebook</a>
            <button
              className="btn ghost"
              onClick={() => { try { navigator.clipboard.writeText(`${window.location.origin}/trip/${detail.id}`); } catch { /* */ } }}
            >
              🔗 Copy trip link
            </button>
          </div>
        </Modal>
      )}

      {showModal && (
        <Modal
          title={editing ? 'Edit booking' : 'Add booking'}
          onClose={() => setShowModal(false)}
          footer={
            <>
              <button className="btn secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save booking'}</button>
            </>
          }
        >
          <form onSubmit={save}>
            <div className="form-grid">
              <div className="field full">
                <label>Property *</label>
                <select value={form.property_id} onChange={set('property_id')} disabled={!!editing} required>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Guest name *</label>
                <input value={form.guest_name} onChange={set('guest_name')} required />
              </div>
              <div className="field">
                <label>Guest email</label>
                <input type="email" value={form.guest_email} onChange={set('guest_email')} />
              </div>
              <div className="field">
                <label>Platform</label>
                <select value={form.platform} onChange={set('platform')}>
                  <option value="direct">Direct</option>
                  <option value="airbnb">Airbnb</option>
                  <option value="vrbo">VRBO</option>
                  <option value="booking">Booking.com</option>
                </select>
              </div>
              <div className="field">
                <label>Status</label>
                <select value={form.status} onChange={set('status')}>
                  <option value="confirmed">Confirmed</option>
                  <option value="pending">Pending</option>
                  <option value="cancelled">Cancelled</option>
                </select>
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
                <input type="number" min="1" value={form.guests} onChange={set('guests')} />
              </div>
              <div className="field">
                <label>Total amount ($)</label>
                <input type="number" min="0" step="0.01" value={form.total_amount} onChange={set('total_amount')} />
              </div>
            </div>
            <button type="submit" style={{ display: 'none' }} />
          </form>
        </Modal>
      )}
    </>
  );
}
