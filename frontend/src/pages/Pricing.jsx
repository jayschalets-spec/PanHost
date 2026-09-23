import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import api, { apiError } from '../api';
import { Modal, Loading, Empty, money, localDate } from '../components/ui.jsx';

const BLANK = {
  property_id: '',
  name: '',
  kind: 'seasonal',
  adjust: 'fixed',
  start_date: '',
  end_date: '',
  price: 0,
  percent: 0,
  min_stay: 1,
};

const KIND_LABEL = { seasonal: 'Seasonal', weekend: 'Weekend' };

export default function Pricing() {
  const [rules, setRules] = useState([]);
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [selProp, setSelProp] = useState('');
  const [preview, setPreview] = useState(null);

  const load = () =>
    Promise.all([api.get('/api/pricing'), api.get('/api/properties')])
      .then(([r, p]) => {
        setRules(r.data);
        setProperties(p.data);
        if (!selProp && p.data.length) setSelProp(p.data[0].id);
      })
      .catch((e) => setError(apiError(e)))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const loadPreview = (pid) => {
    if (!pid) return;
    api.get(`/api/pricing/preview?property_id=${pid}&days=45`).then((r) => setPreview(r.data)).catch(() => setPreview(null));
  };

  useEffect(() => {
    if (selProp) loadPreview(selProp);
  }, [selProp, rules]);

  const openNew = () => {
    if (!properties.length) { setError('Add a property first.'); return; }
    setForm({ ...BLANK, property_id: selProp || properties[0].id });
    setShowModal(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload = { ...form };
      if (form.kind === 'weekend') { payload.start_date = null; payload.end_date = null; }
      await api.post('/api/pricing', payload);
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
    await api.delete(`/api/pricing/${r.id}`);
    await load();
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const currentProp = useMemo(() => properties.find((p) => p.id === selProp), [properties, selProp]);
  const [smart, setSmart] = useState({ min_price: 0, demand_pricing: false, demand_strength: 20, market_anchor: false, seasonality: true });
  useEffect(() => {
    if (currentProp) {
      setSmart({
        min_price: currentProp.min_price ?? 0,
        demand_pricing: !!currentProp.demand_pricing,
        demand_strength: currentProp.demand_strength ?? 20,
        market_anchor: !!currentProp.market_anchor,
        seasonality: currentProp.seasonality !== false,
      });
    }
  }, [currentProp]);

  const saveSmart = async (patch) => {
    const next = { ...smart, ...patch };
    setSmart(next);
    try {
      await api.put(`/api/properties/${selProp}`, patch);
      await load();
      loadPreview(selProp);
    } catch (err) {
      setError(apiError(err));
    }
  };

  const propRules = useMemo(() => rules.filter((r) => !selProp || r.property_id === selProp), [rules, selProp]);
  const stats = useMemo(() => {
    if (!preview || !preview.days.length) return null;
    const open = preview.days.filter((d) => !d.booked).map((d) => d.price);
    const src = open.length ? open : preview.days.map((d) => d.price);
    return {
      avg: Math.round(src.reduce((s, p) => s + p, 0) / src.length),
      min: Math.min(...src),
      max: Math.max(...src),
    };
  }, [preview]);
  const [refreshingMkt, setRefreshingMkt] = useState(false);

  const refreshMarket = async () => {
    setRefreshingMkt(true);
    setError('');
    try {
      await api.get(`/api/market?property_id=${selProp}`);
      await load();
      loadPreview(selProp);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setRefreshingMkt(false);
    }
  };

  const ruleValue = (r) =>
    r.adjust === 'percent' ? `${Number(r.percent) > 0 ? '+' : ''}${r.percent}%` : money(r.price);

  if (loading) return <Loading />;

  return (
    <>
      <div className="page-header">
        <p className="subtitle">Dynamic pricing — seasonal rates, weekend uplift & minimum stays</p>
        <button className="btn" onClick={openNew}>+ Add rule</button>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="row wrap" style={{ marginBottom: 16 }}>
        <select style={{ width: 'auto' }} value={selProp} onChange={(e) => setSelProp(e.target.value)}>
          {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {preview && stats && (
          <span className="muted" style={{ alignSelf: 'center' }}>
            Base {money(preview.base)} · next 45 nights avg <strong>{money(stats.avg)}</strong> · range {money(stats.min)}–{money(stats.max)}
          </span>
        )}
      </div>

      {/* Smart pricing controls */}
      {currentProp && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body">
            <div className="row wrap" style={{ gap: 24, alignItems: 'center' }}>
              <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={smart.demand_pricing} onChange={(e) => saveSmart({ demand_pricing: e.target.checked })} />
                <strong>⚡ Smart demand pricing</strong>
              </label>
              <label className="row" style={{ gap: 8, cursor: 'pointer' }} title={currentProp?.market_median ? `Market median $${Math.round(currentProp.market_median)}` : 'Run Market analysis first'}>
                <input type="checkbox" style={{ width: 'auto' }} checked={smart.market_anchor} disabled={!currentProp?.market_median} onChange={(e) => saveSmart({ market_anchor: e.target.checked })} />
                <strong>📡 Anchor to market{currentProp?.market_median ? ` ($${Math.round(currentProp.market_median)})` : ''}</strong>
              </label>
              <label className="row" style={{ gap: 8, cursor: 'pointer' }} title="Ski/lake resort curve + Canadian holidays & long weekends">
                <input type="checkbox" style={{ width: 'auto' }} checked={smart.seasonality} onChange={(e) => saveSmart({ seasonality: e.target.checked })} />
                <strong>🏔️ Resort seasonality</strong>
              </label>
              {smart.demand_pricing && (
                <label className="row" style={{ gap: 8 }}>
                  <span className="muted" style={{ fontSize: 13 }}>Aggressiveness ±</span>
                  <select style={{ width: 'auto' }} value={smart.demand_strength} onChange={(e) => saveSmart({ demand_strength: Number(e.target.value) })}>
                    <option value={10}>10%</option>
                    <option value={20}>20%</option>
                    <option value={30}>30%</option>
                    <option value={40}>40%</option>
                  </select>
                </label>
              )}
              <label className="row" style={{ gap: 8 }}>
                <span className="muted" style={{ fontSize: 13 }}>Min price floor $</span>
                <input type="number" min="0" style={{ width: 90 }} value={smart.min_price}
                  onChange={(e) => setSmart({ ...smart, min_price: e.target.value })}
                  onBlur={(e) => saveSmart({ min_price: Number(e.target.value) })} />
              </label>
              <button className="btn secondary sm" onClick={refreshMarket} disabled={refreshingMkt}>
                {refreshingMkt ? 'Refreshing…' : '📡 Refresh market'}
              </button>
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              Pipeline: {smart.market_anchor ? 'market median' : 'your base price'} → demand flex (occupancy + lead time){smart.seasonality ? ' → resort seasonality (ski/lake + holidays)' : ''} → manual rules override → min-price floor.
              {currentProp?.market_updated_at && ` Market updated ${new Date(currentProp.market_updated_at).toLocaleDateString()}.`}
              {' '}Refreshes automatically every day.
            </p>
          </div>
        </div>
      )}

      {/* Price preview calendar */}
      {preview && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header"><h3>Price calendar — next 45 nights</h3>
            <div className="row" style={{ gap: 14, fontSize: 12 }}>
              <span className="muted">▮ weekend</span><span className="muted">✕ booked</span>
            </div>
          </div>
          <div className="card-body">
            <div className="price-grid">
              {preview.days.map((d) => (
                <div key={d.date} className={`price-cell ${d.weekend ? 'weekend' : ''} ${d.booked ? 'booked' : ''}`} title={`${d.date}${d.rules.length ? ' · ' + d.rules.join(', ') : ''}${d.min_stay > 1 ? ' · min ' + d.min_stay : ''}`}>
                  <div className="pc-day">{format(localDate(d.date), 'EEE d')}</div>
                  <div className="pc-price">{d.booked ? '✕' : money(d.price)}</div>
                  {!d.booked && d.demand ? (
                    <div className="pc-demand" style={{ color: d.demand > 0 ? 'var(--success)' : 'var(--danger)' }}>
                      {d.demand > 0 ? '▲' : '▼'} {Math.abs(d.demand)}%
                    </div>
                  ) : null}
                  {d.min_stay > 1 && !d.booked && <div className="pc-min">min {d.min_stay}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header"><h3>Rules</h3></div>
        {propRules.length === 0 ? (
          <Empty icon="💲" title="No pricing rules" subtitle="Add seasonal rates, a weekend uplift, or minimum stays." action={<button className="btn" onClick={openNew}>+ Add rule</button>} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Rule</th><th>Type</th><th>When</th><th>Adjustment</th><th>Min stay</th><th></th></tr>
              </thead>
              <tbody>
                {propRules.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td><span className="badge direct">{KIND_LABEL[r.kind] || r.kind}</span></td>
                    <td>
                      {r.kind === 'weekend' ? 'Fri & Sat'
                        : r.start_date ? `${format(localDate(r.start_date), 'MMM d')} – ${r.end_date ? format(localDate(r.end_date), 'MMM d') : '…'}`
                        : 'Always'}
                    </td>
                    <td style={{ fontWeight: 600 }}>{ruleValue(r)}</td>
                    <td>{r.min_stay} night{r.min_stay > 1 ? 's' : ''}</td>
                    <td><button className="btn ghost sm" onClick={() => remove(r)} style={{ color: 'var(--danger)' }}>Delete</button></td>
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
          footer={<><button className="btn secondary" onClick={() => setShowModal(false)}>Cancel</button><button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save rule'}</button></>}
        >
          <form onSubmit={save}>
            <div className="form-grid">
              <div className="field full">
                <label>Property *</label>
                <select value={form.property_id} onChange={set('property_id')} required>
                  {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Rule type</label>
                <select value={form.kind} onChange={set('kind')}>
                  <option value="seasonal">Seasonal (date range)</option>
                  <option value="weekend">Weekend uplift (Fri/Sat)</option>
                </select>
              </div>
              <div className="field">
                <label>Adjustment</label>
                <select value={form.adjust} onChange={set('adjust')}>
                  <option value="fixed">Fixed nightly price</option>
                  <option value="percent">Percent change</option>
                </select>
              </div>
              <div className="field full">
                <label>Name *</label>
                <input value={form.name} onChange={set('name')} placeholder="Summer peak / Weekend uplift" required />
              </div>
              {form.kind !== 'weekend' && (
                <>
                  <div className="field"><label>Start date</label><input type="date" value={form.start_date} onChange={set('start_date')} /></div>
                  <div className="field"><label>End date</label><input type="date" value={form.end_date} onChange={set('end_date')} /></div>
                </>
              )}
              {form.adjust === 'fixed' ? (
                <div className="field"><label>Nightly price ($) *</label><input type="number" min="0" step="0.01" value={form.price} onChange={set('price')} required /></div>
              ) : (
                <div className="field"><label>Percent change (%) *</label><input type="number" step="1" value={form.percent} onChange={set('percent')} placeholder="e.g. 20 or -10" required /></div>
              )}
              <div className="field"><label>Minimum stay (nights)</label><input type="number" min="1" value={form.min_stay} onChange={set('min_stay')} /></div>
            </div>
            <button type="submit" style={{ display: 'none' }} />
          </form>
        </Modal>
      )}
    </>
  );
}
