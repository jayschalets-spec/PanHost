import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api, { apiError } from '../api';
import { money } from '../components/ui.jsx';

export default function OwnerStatement() {
  const { propertyId } = useParams();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [d, setD] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get(`/api/public/owner-statement/${propertyId}?month=${month}`)
      .then((r) => {
        setD(r.data);
        if (r.data.brand_color) document.documentElement.style.setProperty('--primary', r.data.brand_color);
      })
      .catch((e) => setError(apiError(e)));
  }, [propertyId, month]);

  if (error) return <div className="auth-wrap"><div className="auth-card"><div className="alert error">{error}</div></div></div>;
  if (!d) return <div className="loading"><div className="spinner" /></div>;

  const monthLabel = (() => {
    const [y, m] = d.month.split('-');
    return new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  })();

  const Row = ({ label, value, strong, color }) => (
    <div className="row" style={{ justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontWeight: strong ? 700 : 400, color: 'var(--text)' }}>{label}</span>
      <span style={{ fontWeight: strong ? 700 : 600, color: color || 'var(--text)' }}>{value}</span>
    </div>
  );

  return (
    <div className="book-page">
      <header className="book-header">
        <h1>{d.property}</h1>
        <p>Owner statement · {d.location}</p>
      </header>
      <div className="book-container" style={{ maxWidth: 560 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <h3>{monthLabel}</h3>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 'auto' }} />
        </div>
        <div className="card">
          <div className="card-body">
            <Row label="Gross revenue" value={money(d.gross)} />
            {d.expenseBreakdown.map((e) => (
              <Row key={e.category} label={<span style={{ textTransform: 'capitalize', color: 'var(--text-muted)' }}>&nbsp;&nbsp;{e.category}</span>} value={`-${money(e.amount)}`} color="var(--danger)" />
            ))}
            <Row label="Total expenses" value={`-${money(d.expenses)}`} color="var(--danger)" />
            {d.feePct > 0 && <Row label={`Management fee (${d.feePct}%)`} value={`-${money(d.mgmtFee)}`} color="var(--danger)" />}
            <Row label="Net payout" value={money(d.net)} strong color={d.net >= 0 ? 'var(--success)' : 'var(--danger)'} />
          </div>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn secondary" onClick={() => window.print()}>🖨️ Print / Save PDF</button>
        </div>
        <p className="muted" style={{ textAlign: 'center', fontSize: 13, marginTop: 16 }}>Prepared by {d.brand} · powered by PanHost</p>
      </div>
    </div>
  );
}
