import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import api, { apiError } from '../api';
import { Loading, Empty, money, Badge, localDate } from '../components/ui.jsx';

export default function Guests() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    api
      .get('/api/bookings')
      .then((r) => setBookings(r.data))
      .catch((e) => setError(apiError(e)))
      .finally(() => setLoading(false));
  }, []);

  // Build guest profiles by grouping reservations on name (+email when present).
  const guests = useMemo(() => {
    const map = new Map();
    for (const b of bookings) {
      const key = (b.guest_email || b.guest_name || 'Guest').toLowerCase();
      if (!map.has(key)) {
        map.set(key, {
          key,
          name: b.guest_name || 'Guest',
          email: b.guest_email || null,
          stays: 0,
          nights: 0,
          spend: 0,
          platforms: new Set(),
          lastBooking: null,
          firstBookingId: b.id,
        });
      }
      const g = map.get(key);
      g.stays += 1;
      g.spend += Number(b.total_amount || 0);
      const n = Math.max(
        0,
        Math.round((localDate(b.check_out) - localDate(b.check_in)) / 86400000)
      );
      g.nights += n;
      g.platforms.add(b.platform);
      const ci = localDate(b.check_in);
      if (!g.lastBooking || ci > g.lastBooking) g.lastBooking = ci;
      if (b.guest_email && !g.email) g.email = b.guest_email;
    }
    let list = [...map.values()].sort((a, b) => b.spend - a.spend);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((g) => g.name.toLowerCase().includes(q) || (g.email || '').includes(q));
    }
    return list;
  }, [bookings, search]);

  if (loading) return <Loading />;

  const totalValue = guests.reduce((s, g) => s + g.spend, 0);
  const repeat = guests.filter((g) => g.stays > 1).length;

  return (
    <>
      <div className="page-header">
        <p className="subtitle">Guest profiles, stay history & lifetime value</p>
      </div>

      {error && <div className="alert error">{error}</div>}

      {guests.length === 0 ? (
        <div className="card">
          <Empty icon="👥" title="No guests yet" subtitle="Guests appear here once you have reservations." />
        </div>
      ) : (
        <>
          <div className="stats-grid">
            <div className="stat">
              <div className="label">👥 Total guests</div>
              <div className="value">{guests.length}</div>
            </div>
            <div className="stat">
              <div className="label">🔁 Repeat guests</div>
              <div className="value">{repeat}</div>
            </div>
            <div className="stat">
              <div className="label">💰 Lifetime value</div>
              <div className="value pos">{money(totalValue)}</div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3>All guests</h3>
              <input
                style={{ width: 220 }}
                placeholder="Search guests…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Guest</th>
                    <th>Platforms</th>
                    <th>Stays</th>
                    <th>Nights</th>
                    <th>Total spend</th>
                    <th>Last stay</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {guests.map((g) => (
                    <tr key={g.key}>
                      <td>
                        <div className="row" style={{ gap: 10 }}>
                          <div className="avatar" style={{ width: 34, height: 34, fontSize: 14, background: 'var(--primary)' }}>
                            {g.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600 }}>
                              {g.name} {g.stays > 1 && <span className="badge confirmed" style={{ marginLeft: 6 }}>VIP</span>}
                            </div>
                            {g.email && <div className="muted" style={{ fontSize: 12 }}>{g.email}</div>}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="row wrap" style={{ gap: 4 }}>
                          {[...g.platforms].map((p) => (
                            <Badge key={p} kind={p}>{p}</Badge>
                          ))}
                        </div>
                      </td>
                      <td>{g.stays}</td>
                      <td>{g.nights}</td>
                      <td style={{ fontWeight: 600 }}>{money(g.spend)}</td>
                      <td>{g.lastBooking ? format(g.lastBooking, 'MMM d, yyyy') : '—'}</td>
                      <td>
                        <Link to={`/messages?booking=${g.firstBookingId}`} className="btn ghost sm">💬 Message</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
