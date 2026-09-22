import { useEffect, useState } from 'react';
import api, { apiError } from '../api';
import { Loading, money } from '../components/ui.jsx';

function RevenueChart({ series }) {
  const max = Math.max(1, ...series.map((s) => Math.max(s.revenue, s.expenses)));
  const H = 200;
  const barW = 26;
  const gap = 46;
  const left = 44;
  const width = left + series.length * gap + 20;

  return (
    <svg viewBox={`0 0 ${width} ${H + 40}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="Revenue vs expenses">
      {[0, 0.5, 1].map((f) => {
        const y = 10 + (H - 10) * (1 - f);
        return (
          <g key={f}>
            <line x1={left} y1={y} x2={width - 10} y2={y} stroke="var(--border)" strokeWidth="1" />
            <text x={left - 8} y={y + 4} textAnchor="end" fontSize="10" fill="var(--text-muted)">
              {Math.round((max * f) / 1000)}k
            </text>
          </g>
        );
      })}
      {series.map((s, i) => {
        const x = left + i * gap + 6;
        const rh = ((H - 10) * s.revenue) / max;
        const eh = ((H - 10) * s.expenses) / max;
        const baseY = H;
        return (
          <g key={s.month}>
            <rect x={x} y={baseY - rh} width={barW / 2 - 1} height={rh} rx="2" fill="var(--primary)" />
            <rect x={x + barW / 2 + 1} y={baseY - eh} width={barW / 2 - 1} height={eh} rx="2" fill="#f59e0b" />
            <text x={x + barW / 2} y={H + 16} textAnchor="middle" fontSize="10" fill="var(--text-muted)">
              {s.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function Analytics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/api/analytics')
      .then((r) => setData(r.data))
      .catch((e) => setError(apiError(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading />;
  if (error) return <div className="alert error">{error}</div>;

  const kpis = [
    { label: '📊 Occupancy (next 90d)', value: `${data.occupancy}%`, hint: 'Booked ÷ available nights' },
    { label: '💰 ADR', value: money(data.adr), hint: 'Average daily rate' },
    { label: '📈 RevPAR', value: money(data.revpar), hint: 'Revenue per available night' },
    { label: '🌙 Nights sold', value: data.totalNights, hint: 'All confirmed stays' },
  ];

  return (
    <>
      <div className="page-header">
        <p className="subtitle">Performance metrics across your portfolio</p>
      </div>

      <div className="stats-grid">
        {kpis.map((k) => (
          <div className="stat" key={k.label}>
            <div className="label">{k.label}</div>
            <div className="value">{k.value}</div>
            <div className="stat-sub">{k.hint}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-header">
          <h3>Revenue vs expenses — last 6 months</h3>
          <div className="row" style={{ gap: 16 }}>
            <span className="row" style={{ gap: 6, fontSize: 13 }}>
              <span style={{ width: 12, height: 12, background: 'var(--primary)', borderRadius: 3, display: 'inline-block' }} /> Revenue
            </span>
            <span className="row" style={{ gap: 6, fontSize: 13 }}>
              <span style={{ width: 12, height: 12, background: '#f59e0b', borderRadius: 3, display: 'inline-block' }} /> Expenses
            </span>
          </div>
        </div>
        <div className="card-body">
          {data.series.every((s) => s.revenue === 0 && s.expenses === 0) ? (
            <p className="muted">No revenue or expense data yet.</p>
          ) : (
            <RevenueChart series={data.series} />
          )}
        </div>
      </div>

      {data.byListing && data.byListing.length > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="card-header"><h3>Performance by listing</h3></div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Listing</th>
                  <th style={{ textAlign: 'right' }}>Revenue</th>
                  <th style={{ textAlign: 'right' }}>Nights</th>
                  <th style={{ textAlign: 'right' }}>Occupancy (90d)</th>
                </tr>
              </thead>
              <tbody>
                {data.byListing.map((l) => (
                  <tr key={l.id}>
                    <td>{l.name}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{money(l.revenue)}</td>
                    <td style={{ textAlign: 'right' }}>{l.nights}</td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                        <span style={{ width: 60, height: 8, background: 'var(--surface-2)', borderRadius: 999, overflow: 'hidden', display: 'inline-block' }}>
                          <span style={{ display: 'block', width: `${Math.min(100, l.occupancy)}%`, height: '100%', background: 'var(--primary)' }} />
                        </span>
                        {l.occupancy}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
