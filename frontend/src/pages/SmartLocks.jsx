import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import api, { apiError } from '../api';
import { Loading, Empty, Badge, localDate } from '../components/ui.jsx';

export default function SmartLocks() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = () =>
    api
      .get('/api/bookings')
      .then((r) => setBookings(r.data.filter((b) => b.status !== 'cancelled')))
      .catch((e) => setError(apiError(e)))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const now = new Date();
  const upcoming = bookings
    .filter((b) => localDate(b.check_out) >= now)
    .sort((a, z) => localDate(a.check_in) - localDate(z.check_in));

  const generate = async (b) => {
    setBusyId(b.id);
    try {
      await api.post(`/api/bookings/${b.id}/lockcode`);
      await load();
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <Loading />;

  return (
    <>
      <div className="page-header">
        <p className="subtitle">Auto-generate door codes for each reservation</p>
      </div>

      {error && <div className="alert error">{error}</div>}
      <div className="alert info">
        Generate a unique entry code per stay. Connect a smart-lock provider (August, Yale, Seam) to push
        codes automatically — for now codes are managed here and shared with guests via the Inbox.
      </div>

      <div className="card">
        <div className="card-header"><h3>Upcoming stays</h3></div>
        {upcoming.length === 0 ? (
          <Empty icon="🔐" title="No upcoming stays" subtitle="Door codes appear here for upcoming reservations." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Guest</th>
                  <th>Property</th>
                  <th>Check-in</th>
                  <th>Check-out</th>
                  <th>Door code</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((b) => (
                  <tr key={b.id}>
                    <td>{b.guest_name}</td>
                    <td>{b.property_name}</td>
                    <td>{format(localDate(b.check_in), 'MMM d')}</td>
                    <td>{format(localDate(b.check_out), 'MMM d')}</td>
                    <td>
                      {b.door_code ? (
                        <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 16, letterSpacing: 2 }}>🔑 {b.door_code}</span>
                      ) : (
                        <Badge kind="pending">Not set</Badge>
                      )}
                    </td>
                    <td>
                      <button className="btn ghost sm" onClick={() => generate(b)} disabled={busyId === b.id}>
                        {busyId === b.id ? '…' : b.door_code ? 'Regenerate' : 'Generate'}
                      </button>
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
