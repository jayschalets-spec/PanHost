import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, differenceInCalendarDays } from 'date-fns';
import api, { apiError } from '../api';
import { Loading, Empty, money, Badge, localDate } from '../components/ui.jsx';
import Onboarding from '../components/Onboarding.jsx';

const PLATFORM_COLORS = { airbnb: 'var(--airbnb)', vrbo: 'var(--vrbo)', direct: 'var(--primary)' };

function StatCard({ to, label, value, cls, sub }) {
  return (
    <Link to={to} className="stat stat-link">
      <div className="label">{label}</div>
      <div className={`value ${cls || ''}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </Link>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.get('/api/dashboard'), api.get('/api/bookings')])
      .then(([d, b]) => {
        setStats(d.data);
        setBookings(b.data);
      })
      .catch((err) => setError(apiError(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading />;
  if (error) return <div className="alert error">{error}</div>;

  const now = new Date();
  const upcoming = bookings
    .filter((x) => x.status !== 'cancelled' && localDate(x.check_in) >= now)
    .sort((a, z) => localDate(a.check_in) - localDate(z.check_in));

  const active = bookings.filter((b) => b.status !== 'cancelled');

  // Operational "today" metrics (Hostaway-style overview).
  const todayStr = now.toISOString().slice(0, 10);
  const dayOf = (d) => new Date(d).toISOString().slice(0, 10);
  const checkinsToday = active.filter((b) => dayOf(b.check_in) === todayStr);
  const checkoutsToday = active.filter((b) => dayOf(b.check_out) === todayStr);
  const stayingNow = active.filter((b) => dayOf(b.check_in) <= todayStr && dayOf(b.check_out) > todayStr);
  const needsApproval = bookings.filter((b) => b.status === 'pending');

  const platformTotals = active.reduce((acc, b) => {
    acc[b.platform] = (acc[b.platform] || 0) + Number(b.total_amount || 0);
    return acc;
  }, {});
  const maxPlatform = Math.max(1, ...Object.values(platformTotals));
  const margin = stats.revenue > 0 ? Math.round((stats.profit / stats.revenue) * 100) : 0;

  return (
    <>
      <div className="hero">
        <div>
          <h2>Welcome back 👋</h2>
          <p>Here's how your portfolio is performing.</p>
        </div>
        <Link to="/bookings" className="btn hero-btn">+ Add booking</Link>
      </div>

      <Onboarding />

      <h3 style={{ marginBottom: 12 }}>Today at a glance</h3>
      <div className="ops-grid">
        <div className="ops-card">
          <div className="ops-head">🛬 Today's check-ins</div>
          <div className="ops-count">{checkinsToday.length}</div>
          {checkinsToday.slice(0, 2).map((b) => (
            <div key={b.id} className="ops-item">{b.guest_name} · {b.property_name}</div>
          ))}
          {checkinsToday.length === 0 && <div className="ops-empty">No arrivals today</div>}
        </div>
        <div className="ops-card">
          <div className="ops-head">🛫 Today's check-outs</div>
          <div className="ops-count">{checkoutsToday.length}</div>
          {checkoutsToday.slice(0, 2).map((b) => (
            <div key={b.id} className="ops-item">{b.guest_name} · {b.property_name}</div>
          ))}
          {checkoutsToday.length === 0 && <div className="ops-empty">No departures today</div>}
        </div>
        <div className="ops-card">
          <div className="ops-head">🏠 Currently staying</div>
          <div className="ops-count">{stayingNow.length}</div>
          {stayingNow.slice(0, 2).map((b) => (
            <div key={b.id} className="ops-item">{b.guest_name} · {b.property_name}</div>
          ))}
          {stayingNow.length === 0 && <div className="ops-empty">No in-house guests</div>}
        </div>
        <Link to="/bookings?status=pending" className="ops-card" style={{ display: 'block' }}>
          <div className="ops-head">⏳ Needs approval</div>
          <div className="ops-count" style={{ color: needsApproval.length ? 'var(--warning)' : 'inherit' }}>{needsApproval.length}</div>
          {needsApproval.slice(0, 2).map((b) => (
            <div key={b.id} className="ops-item">{b.guest_name} · {b.property_name}</div>
          ))}
          {needsApproval.length === 0 && <div className="ops-empty">Nothing pending</div>}
        </Link>
      </div>

      <div className="stats-grid">
        <StatCard to="/properties" label="🏠 Properties" value={stats.properties} sub="Manage listings" />
        <StatCard to="/bookings" label="📅 Bookings" value={stats.bookings} sub={`${stats.upcoming} upcoming`} />
        <StatCard to="/calendar" label="🌙 Nights booked" value={stats.nightsBooked} sub="View calendar" />
        <StatCard to="/finances" label="💵 Revenue" value={money(stats.revenue)} cls="pos" sub="Finances" />
        <StatCard to="/finances" label="🧾 Expenses" value={money(stats.expenses)} sub="Finances" />
        <StatCard
          to="/finances"
          label="📈 Profit"
          value={money(stats.profit)}
          cls={stats.profit >= 0 ? 'pos' : 'neg'}
          sub={`${margin}% margin`}
        />
      </div>

      <div className="dash-grid">
        <div className="card">
          <div className="card-header">
            <h3>Revenue by platform</h3>
            <Link to="/finances" className="btn ghost sm">Details →</Link>
          </div>
          <div className="card-body">
            {Object.keys(platformTotals).length === 0 ? (
              <p className="muted">No revenue recorded yet.</p>
            ) : (
              Object.entries(platformTotals)
                .sort((a, b) => b[1] - a[1])
                .map(([platform, total]) => (
                  <div key={platform} style={{ marginBottom: 14 }}>
                    <div className="row" style={{ justifyContent: 'space-between', marginBottom: 5 }}>
                      <Badge kind={platform}>{platform}</Badge>
                      <span style={{ fontWeight: 700 }}>{money(total)}</span>
                    </div>
                    <div className="bar-track">
                      <div
                        className="bar-fill"
                        style={{ width: `${(total / maxPlatform) * 100}%`, background: PLATFORM_COLORS[platform] }}
                      />
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Next check-in</h3>
          </div>
          <div className="card-body">
            {upcoming.length === 0 ? (
              <p className="muted">Nothing scheduled yet.</p>
            ) : (
              <>
                <div className="countdown">
                  {Math.max(0, differenceInCalendarDays(localDate(upcoming[0].check_in), now))}
                  <span> days</span>
                </div>
                <div style={{ marginTop: 8 }}>
                  <strong>{upcoming[0].guest_name}</strong> · {upcoming[0].property_name}
                </div>
                <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                  {format(localDate(upcoming[0].check_in), 'EEE, MMM d')} →{' '}
                  {format(localDate(upcoming[0].check_out), 'EEE, MMM d')}
                </div>
                <div style={{ marginTop: 10 }}>
                  <Badge kind={upcoming[0].platform}>{upcoming[0].platform}</Badge>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>Upcoming check-ins</h3>
          <Link to="/bookings" className="btn ghost sm">View all →</Link>
        </div>
        {upcoming.length === 0 ? (
          <Empty
            icon="🗓️"
            title="No upcoming bookings"
            subtitle="Add a booking manually or sync calendars in Settings."
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
                  <th>Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {upcoming.slice(0, 6).map((b) => (
                  <tr key={b.id}>
                    <td>{b.guest_name}</td>
                    <td>{b.property_name}</td>
                    <td><Badge kind={b.platform}>{b.platform}</Badge></td>
                    <td>{format(localDate(b.check_in), 'MMM d, yyyy')}</td>
                    <td>{format(localDate(b.check_out), 'MMM d, yyyy')}</td>
                    <td>{money(b.total_amount)}</td>
                    <td>
                      <Link to={`/messages?booking=${b.id}`} className="btn ghost sm">💬 Message</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
