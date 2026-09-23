import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import api, { apiError } from '../api';
import { Loading, Empty, Badge, localDate } from '../components/ui.jsx';

const CHANNEL_ICON = { airbnb: '🅰️', vrbo: '🆅', booking: '🅱️', direct: '🔗' };
const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function Channels() {
  const [data, setData] = useState(null);
  const [conflicts, setConflicts] = useState([]);
  const [integrations, setIntegrations] = useState([]);
  const [listingData, setListingData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  const load = () =>
    Promise.all([api.get('/api/channels'), api.get('/api/conflicts'), api.get('/api/integrations')])
      .then(([c, cf, ig]) => {
        setData(c.data);
        setConflicts(cf.data.conflicts);
        setIntegrations(ig.data.integrations);
        setListingData(ig.data.listingData);
      })
      .catch((e) => setError(apiError(e)))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const syncAll = async () => {
    setSyncing(true);
    setSyncMsg('');
    try {
      const { data: r } = await api.post('/api/sync/ical');
      setSyncMsg(`✅ Synced ${r.fetched} reservations, ${r.imported} new.`);
      await load();
    } catch (e) {
      setSyncMsg('⚠️ ' + apiError(e));
    } finally {
      setSyncing(false);
    }
  };

  if (loading) return <Loading />;

  return (
    <>
      <div className="page-header">
        <p className="subtitle">Connect and sync every booking channel from one place</p>
        <button className="btn" onClick={syncAll} disabled={syncing}>
          {syncing ? 'Syncing…' : '🔄 Sync all channels'}
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}
      {syncMsg && <div className={`alert ${syncMsg.startsWith('✅') ? 'success' : 'error'}`}>{syncMsg}</div>}

      {conflicts.length > 0 && (
        <div className="alert error" style={{ display: 'block' }}>
          <strong>⚠️ {conflicts.length} double-booking conflict{conflicts.length > 1 ? 's' : ''} detected!</strong>
          <div style={{ marginTop: 8 }}>
            {conflicts.slice(0, 5).map((c, i) => (
              <div key={i} style={{ fontSize: 13, marginTop: 4 }}>
                <strong>{c.property_name}</strong>: {c.a.guest} ({c.a.platform}, {format(localDate(c.a.check_in), 'MMM d')}–{format(localDate(c.a.check_out), 'MMM d')})
                {' '}overlaps {c.b.guest} ({c.b.platform}, {format(localDate(c.b.check_in), 'MMM d')}–{format(localDate(c.b.check_out), 'MMM d')})
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="stats-grid">
        <div className="stat"><div className="label">🏠 Listings</div><div className="value">{data.listings.length}</div></div>
        <div className="stat"><div className="label">🔌 OTA connections</div><div className="value">{data.totalConnections}</div></div>
        <div className="stat"><div className="label">⚠️ Conflicts</div><div className="value" style={{ color: conflicts.length ? 'var(--danger)' : 'var(--success)' }}>{conflicts.length}</div></div>
      </div>

      {data.listings.length === 0 ? (
        <div className="card">
          <Empty icon="🔌" title="No listings" subtitle="Add a listing, then connect its channels via iCal URLs." action={<Link to="/properties" className="btn">Go to Listings</Link>} />
        </div>
      ) : (
        <div className="grid-cards">
          {data.listings.map((l) => (
            <div className="card" key={l.id}>
              <div className="card-header"><h3 style={{ fontSize: 15 }}>{l.name}</h3></div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {l.channels.map((ch) => (
                  <div key={ch.key} className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="row" style={{ gap: 8 }}>
                      <span>{CHANNEL_ICON[ch.key]}</span>
                      <span style={{ fontWeight: 500 }}>{ch.label}</span>
                    </span>
                    <span className="row" style={{ gap: 8 }}>
                      <span className="muted" style={{ fontSize: 12 }}>{ch.reservations} res.</span>
                      <Badge kind={ch.connected ? 'confirmed' : 'cancelled'}>
                        {ch.connected ? 'Connected' : 'Off'}
                      </Badge>
                    </span>
                  </div>
                ))}
                <div style={{ marginTop: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
                    📤 Availability feed (paste into OTAs to block these dates)
                  </label>
                  <input
                    readOnly
                    onClick={(e) => e.target.select()}
                    value={`${apiBase}/api/public/ical/${l.id}.ics`}
                    style={{ fontSize: 12, marginTop: 4 }}
                  />
                </div>
                <Link to="/properties" className="btn secondary sm" style={{ marginTop: 8 }}>Manage connections →</Link>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header"><h3>Official API integrations</h3></div>
        <div className="card-body">
          <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
            Two-way API sync (rates, availability, reservations, guest details) requires becoming an
            approved partner with each platform. Once approved, add your credentials and PanHost
            activates the official API automatically. Until then, use <strong>iCal sync</strong> above
            (works today, no approval).
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Channel</th><th>Program</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {integrations.map((ig) => (
                  <tr key={ig.platform}>
                    <td style={{ fontWeight: 600 }}>{ig.label}</td>
                    <td className="muted" style={{ fontSize: 13 }}>{ig.program}</td>
                    <td>
                      <Badge kind={ig.configured ? 'confirmed' : 'pending'}>
                        {ig.configured ? 'API connected' : 'iCal (apply for API)'}
                      </Badge>
                    </td>
                    <td>
                      {!ig.configured && (
                        <a className="btn ghost sm" href={ig.applyUrl} target="_blank" rel="noreferrer">Apply for access ↗</a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {listingData && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="card-header">
            <h3>📥 Listing data import ({listingData.provider})</h3>
            <span className={`badge ${listingData.configured ? 'confirmed' : 'pending'}`}>
              {listingData.configured ? 'Connected' : 'Not connected'}
            </span>
          </div>
          <div className="card-body">
            <p className="muted" style={{ fontSize: 13 }}>
              Reliably import a listing's photos, amenities & details from Airbnb/VRBO/Booking via
              StayingAPI (Airbnb blocks direct scraping). Grab a free key, then set{' '}
              <code>STAYINGAPI_KEY</code> on the backend — the <strong>Pull from Airbnb</strong> button
              on each listing then works reliably.
            </p>
            {!listingData.configured && (
              <a className="btn secondary sm" href={listingData.signupUrl} target="_blank" rel="noreferrer" style={{ marginTop: 8 }}>
                Get a free StayingAPI key ↗
              </a>
            )}
          </div>
        </div>
      )}

      <div className="alert info" style={{ marginTop: 20 }}>
        Connect a channel by adding its iCal export URL on the listing (Listings → Edit). PanHost
        imports reservations from every connected channel and flags any date overlaps as conflicts.
      </div>
    </>
  );
}
