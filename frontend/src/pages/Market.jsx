import { useEffect, useState } from 'react';
import api, { apiError } from '../api';
import { Loading, Empty, money, Badge } from '../components/ui.jsx';

export default function Market() {
  const [properties, setProperties] = useState([]);
  const [selProp, setSelProp] = useState('');
  const [dates, setDates] = useState({ checkin: '', checkout: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/api/properties')
      .then((r) => {
        setProperties(r.data);
        if (r.data.length) setSelProp(r.data[0].id);
      })
      .catch((e) => setError(apiError(e)))
      .finally(() => setLoading(false));
  }, []);

  const [applied, setApplied] = useState(false);

  const applySuggested = async () => {
    if (!data?.suggested) return;
    try {
      await api.put(`/api/properties/${selProp}`, { base_price: data.suggested });
      setApplied(true);
      setTimeout(() => setApplied(false), 2500);
    } catch (err) {
      setError(apiError(err));
    }
  };

  const analyze = async () => {
    setAnalyzing(true);
    setError('');
    setData(null);
    try {
      const qs = new URLSearchParams({ property_id: selProp });
      if (dates.checkin) qs.set('checkin', dates.checkin);
      if (dates.checkout) qs.set('checkout', dates.checkout);
      const { data: d } = await api.get(`/api/market?${qs}`);
      setData(d);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setAnalyzing(false);
    }
  };

  if (loading) return <Loading />;

  return (
    <>
      <div className="page-header">
        <p className="subtitle">Live comparable listings near your property (via StayingAPI)</p>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-body">
          <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
            <div className="field" style={{ margin: 0 }}>
              <label>Listing</label>
              <select value={selProp} onChange={(e) => setSelProp(e.target.value)} style={{ width: 'auto', minWidth: 220 }}>
                {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Check-in (optional)</label>
              <input type="date" value={dates.checkin} onChange={(e) => setDates({ ...dates, checkin: e.target.value })} style={{ width: 'auto' }} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Check-out (optional)</label>
              <input type="date" value={dates.checkout} onChange={(e) => setDates({ ...dates, checkout: e.target.value })} style={{ width: 'auto' }} />
            </div>
            <button className="btn" onClick={analyze} disabled={analyzing || !selProp}>
              {analyzing ? 'Analyzing…' : '🔍 Analyze market'}
            </button>
          </div>
        </div>
      </div>

      {data && (
        <>
          <p className="muted" style={{ marginBottom: 12 }}>
            📍 Comps near <strong>{data.location}</strong> · {data.stats.count} comparable listings
            {!data.hasCoords && ' · add the listing’s Airbnb ID for exact proximity sorting'}
          </p>
          <div className="stats-grid">
            <div className="stat"><div className="label">📊 Market median</div><div className="value">{money(data.stats.median)}</div></div>
            <div className="stat"><div className="label">📈 Market avg</div><div className="value">{money(data.stats.avg)}</div></div>
            <div className="stat"><div className="label">↕️ Range</div><div className="value" style={{ fontSize: 20 }}>{money(data.stats.min)}–{money(data.stats.max)}</div></div>
            <div className="stat">
              <div className="label">🏷️ Your base price</div>
              <div className="value">{money(data.ourPrice)}</div>
              {data.percentile != null && <div className="stat-sub">cheaper than {100 - data.percentile}% of comps</div>}
            </div>
          </div>

          <div className="alert info" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span>
              💡 Suggested nightly rate for this market: <strong>{money(data.suggested)}</strong>
              {data.ourPrice > 0 && data.suggested > 0 && (
                <> — you're currently {data.ourPrice < data.suggested ? `${Math.round((1 - data.ourPrice / data.suggested) * 100)}% below` : `${Math.round((data.ourPrice / data.suggested - 1) * 100)}% above`} the market median.</>
              )}
            </span>
            {data.suggested > 0 && (
              <button className="btn sm" onClick={applySuggested} disabled={applied}>
                {applied ? '✅ Applied' : 'Set as base price'}
              </button>
            )}
          </div>

          <div className="card">
            <div className="card-header"><h3>Comparable listings</h3></div>
            {data.comps.length === 0 ? (
              <Empty icon="🔍" title="No comps found" subtitle="Try a broader location or different dates." />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Listing</th><th>Platform</th><th>Distance</th><th>Beds</th><th>Rating</th><th style={{ textAlign: 'right' }}>Nightly</th></tr>
                  </thead>
                  <tbody>
                    {data.comps.map((c) => (
                      <tr key={c.id}>
                        <td>
                          {c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.name}</a> : c.name}
                          {c.city && <div className="muted" style={{ fontSize: 12 }}>{c.city}</div>}
                        </td>
                        <td><Badge kind={c.platform === 'airbnb' ? 'airbnb' : c.platform === 'vrbo' ? 'vrbo' : c.platform === 'booking' ? 'booking' : 'direct'}>{c.platform}</Badge></td>
                        <td>{c.distance_km != null ? `${c.distance_km} km` : '—'}</td>
                        <td>{c.bedrooms ?? '—'}</td>
                        <td>{c.rating != null ? `★ ${c.rating}` : '—'}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{c.nightly != null ? money(c.nightly) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
