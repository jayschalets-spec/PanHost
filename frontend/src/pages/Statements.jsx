import { useEffect, useState } from 'react';
import api, { apiError } from '../api';
import { Loading, Empty, money } from '../components/ui.jsx';

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

export default function Statements() {
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = (m) => {
    setLoading(true);
    api
      .get(`/api/statements?month=${m}`)
      .then((r) => setData(r.data))
      .catch((e) => setError(apiError(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(month);
  }, [month]);

  const exportCsv = () => {
    if (!data) return;
    const rows = [['Property', 'Gross revenue', 'Expenses', 'Mgmt fee', 'Net payout']];
    data.rows.forEach((r) => rows.push([r.property, r.gross, r.expenses, r.mgmtFee, r.net]));
    rows.push(['TOTAL', data.totals.gross, data.totals.expenses, data.totals.mgmtFee, data.totals.net]);
    const csv = rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `statement-${data.month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const monthLabel = (m) => {
    const [y, mo] = m.split('-');
    return new Date(Number(y), Number(mo) - 1, 1).toLocaleString('en-US', {
      month: 'long',
      year: 'numeric',
    });
  };

  return (
    <>
      <div className="page-header">
        <p className="subtitle">Owner payout statements by property</p>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          style={{ width: 'auto' }}
        />
      </div>

      {error && <div className="alert error">{error}</div>}

      {loading ? (
        <Loading />
      ) : !data || data.rows.length === 0 ? (
        <div className="card">
          <Empty icon="🧾" title="No properties" subtitle="Add a property to generate statements." />
        </div>
      ) : (
        <div className="card">
          <div className="card-header">
            <h3>{monthLabel(data.month)}</h3>
            <span className="muted" style={{ fontSize: 13 }}>
              Management fee: {data.feePct}%
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Property</th>
                  <th style={{ textAlign: 'right' }}>Gross revenue</th>
                  <th style={{ textAlign: 'right' }}>Expenses</th>
                  <th style={{ textAlign: 'right' }}>Mgmt fee</th>
                  <th style={{ textAlign: 'right' }}>Net payout</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.property_id}>
                    <td>{r.property}</td>
                    <td style={{ textAlign: 'right' }}>{money(r.gross)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--danger)' }}>-{money(r.expenses)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--danger)' }}>-{money(r.mgmtFee)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: r.net >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                      {money(r.net)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                  <td>Total</td>
                  <td style={{ textAlign: 'right' }}>{money(data.totals.gross)}</td>
                  <td style={{ textAlign: 'right' }}>-{money(data.totals.expenses)}</td>
                  <td style={{ textAlign: 'right' }}>-{money(data.totals.mgmtFee)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--success)' }}>{money(data.totals.net)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="card-body row" style={{ gap: 10 }}>
            <button className="btn secondary" onClick={() => window.print()}>🖨️ Print / Save PDF</button>
            <button className="btn secondary" onClick={exportCsv}>⬇ Export CSV</button>
          </div>
        </div>
      )}
    </>
  );
}
