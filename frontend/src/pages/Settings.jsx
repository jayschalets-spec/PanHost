import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import api, { apiError } from '../api';
import { Loading } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';

function PlatformCard({ platform, label, color, connected, onConnect, onSync }) {
  const [form, setForm] = useState({ property_ref: '', access_token: '' });
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState('');

  const connect = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      await onConnect(platform, form);
      setForm({ property_ref: '', access_token: '' });
      setMsg('✅ Credentials saved');
    } catch (err) {
      setMsg('⚠️ ' + apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    setSyncing(true);
    setMsg('');
    try {
      const res = await onSync(platform);
      setMsg(`✅ Synced: ${res.imported} new of ${res.fetched} fetched`);
    } catch (err) {
      setMsg('⚠️ ' + apiError(err));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h3 style={{ color }}>{label}</h3>
        <span className={`badge ${connected ? 'confirmed' : 'pending'}`}>
          {connected ? 'Connected' : 'Not connected'}
        </span>
      </div>
      <div className="card-body">
        {connected && (
          <p className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
            Connected {format(new Date(connected.created_at), 'MMM d, yyyy')}
            {connected.property_ref ? ` · listing ${connected.property_ref}` : ''}
          </p>
        )}
        <form onSubmit={connect}>
          <div className="field">
            <label>Property / listing ID</label>
            <input
              value={form.property_ref}
              onChange={(e) => setForm({ ...form, property_ref: e.target.value })}
              placeholder="e.g. 123456"
            />
          </div>
          <div className="field">
            <label>Access token</label>
            <input
              type="password"
              value={form.access_token}
              onChange={(e) => setForm({ ...form, access_token: e.target.value })}
              placeholder="Paste API access token"
              required
            />
          </div>
          <div className="row">
            <button className="btn" disabled={busy}>
              {busy ? 'Saving…' : connected ? 'Update credentials' : 'Connect'}
            </button>
            <button type="button" className="btn secondary" onClick={sync} disabled={!connected || syncing}>
              {syncing ? 'Syncing…' : 'Sync bookings'}
            </button>
          </div>
        </form>
        {msg && (
          <div className={`alert ${msg.startsWith('✅') ? 'success' : 'error'}`} style={{ marginTop: 14, marginBottom: 0 }}>
            {msg}
          </div>
        )}
      </div>
    </div>
  );
}

function IcalSyncCard() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  const sync = async () => {
    setBusy(true);
    setErr('');
    setResult(null);
    try {
      const { data } = await api.post('/api/sync/ical');
      setResult(data);
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-header">
        <h3>📅 Calendar sync (iCal)</h3>
        <button className="btn" onClick={sync} disabled={busy}>
          {busy ? 'Syncing…' : 'Sync all calendars'}
        </button>
      </div>
      <div className="card-body">
        <p className="muted" style={{ fontSize: 14 }}>
          The real, no-approval way to import reservations. Add each listing's iCal URL on the
          property (Airbnb: <em>Listing → Availability → Sync calendars → Export</em>), then sync.
          Imports booked date ranges; guest names and payouts aren't exposed by iCal.
        </p>
        {err && <div className="alert error" style={{ marginTop: 12, marginBottom: 0 }}>{err}</div>}
        {result && (
          <div className="alert success" style={{ marginTop: 12, marginBottom: 0 }}>
            ✅ Fetched {result.fetched}, imported {result.imported} new booking(s)
            {result.detail?.length ? ` across ${result.detail.length} calendar(s).` : '.'}
            {result.errors?.length ? ` ${result.errors.length} calendar(s) errored.` : ''}
          </div>
        )}
      </div>
    </div>
  );
}

function BrandingCard() {
  const { user, updateUser } = useAuth();
  const [form, setForm] = useState({
    name: user?.name || '',
    company: user?.company || '',
    brand_name: user?.brand_name || '',
    brand_color: user?.brand_color || '#4f46e5',
    mgmt_fee_pct: user?.mgmt_fee_pct ?? 0,
    currency: user?.currency || 'USD',
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      const { data } = await api.put('/api/branding', form);
      updateUser({ ...user, ...data });
      setMsg('✅ Saved');
    } catch (err) {
      setMsg('⚠️ ' + apiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-header"><h3>🎨 Branding & white-label</h3></div>
      <div className="card-body">
        <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
          Rebrand the app for your company or clients. The name and accent color apply instantly across PanHost.
        </p>
        <form onSubmit={save}>
          <div className="form-grid">
            <div className="field">
              <label>Your name</label>
              <input value={form.name} onChange={set('name')} />
            </div>
            <div className="field">
              <label>Company</label>
              <input value={form.company} onChange={set('company')} placeholder="Jay's Chalets" />
            </div>
            <div className="field">
              <label>Brand name (sidebar)</label>
              <input value={form.brand_name} onChange={set('brand_name')} placeholder="PanHost" />
            </div>
            <div className="field">
              <label>Accent color</label>
              <div className="row">
                <input type="color" value={form.brand_color} onChange={set('brand_color')} style={{ width: 52, padding: 4, height: 42 }} />
                <input value={form.brand_color} onChange={set('brand_color')} placeholder="#4f46e5" />
              </div>
            </div>
            <div className="field">
              <label>Management fee (%)</label>
              <input type="number" min="0" max="100" step="0.5" value={form.mgmt_fee_pct} onChange={set('mgmt_fee_pct')} />
            </div>
            <div className="field">
              <label>Currency</label>
              <select value={form.currency} onChange={set('currency')}>
                {['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'NZD', 'MXN'].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save branding'}</button>
            {msg && <span className={msg.startsWith('✅') ? 'muted' : ''} style={{ color: msg.startsWith('✅') ? 'var(--success)' : 'var(--danger)' }}>{msg}</span>}
          </div>
        </form>
      </div>
    </div>
  );
}

function DirectBookingCard() {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/book/${user?.id}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-header"><h3>🔗 Direct booking link</h3></div>
      <div className="card-body">
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          Share this public page so guests can browse your listings and request a stay — commission-free.
          Requests arrive as pending reservations in your Inbox.
        </p>
        <div className="row wrap">
          <input readOnly value={url} onClick={(e) => e.target.select()} style={{ flex: 1, minWidth: 220 }} />
          <button className="btn secondary" onClick={copy}>{copied ? '✅ Copied' : 'Copy'}</button>
          <a className="btn" href={url} target="_blank" rel="noreferrer">Open</a>
        </div>
      </div>
    </div>
  );
}

function WebhookCard() {
  const [info, setInfo] = useState(null);
  const [copied, setCopied] = useState(false);
  const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';

  const load = () => api.get('/api/webhook-info').then((r) => setInfo(r.data)).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  const url = info ? `${apiBase}${info.path}` : '';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };
  const rotate = async () => {
    if (!confirm('Rotate the webhook URL? The old one will stop working.')) return;
    const { data } = await api.post('/api/webhook-info/rotate');
    setInfo(data);
  };

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-header"><h3>⚡ Zapier / automation webhook</h3></div>
      <div className="card-body">
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          Airbnb has no Zapier app, but you can still auto-import reservations: have Zapier (or Make)
          parse your Airbnb/VRBO notification <strong>emails</strong> and POST them to this URL.
        </p>
        <div className="row wrap" style={{ marginBottom: 12 }}>
          <input readOnly value={url} onClick={(e) => e.target.select()} style={{ flex: 1, minWidth: 220 }} />
          <button className="btn secondary" onClick={copy}>{copied ? '✅ Copied' : 'Copy'}</button>
          <button className="btn ghost" onClick={rotate}>Rotate</button>
        </div>
        <div style={{ fontSize: 13, color: 'var(--text)' }}>
          <strong>Set it up in Zapier:</strong>
          <ol style={{ margin: '8px 0 0 18px', lineHeight: 1.7 }}>
            <li>Trigger: <em>Email Parser by Zapier</em> (or Gmail → new Airbnb email).</li>
            <li>Action: <em>Webhooks by Zapier → POST</em> to the URL above.</li>
            <li>Send JSON fields: <code>guest_name</code>, <code>check_in</code>, <code>check_out</code>, <code>platform</code>, <code>total_amount</code>, <code>property</code>, <code>external_id</code>.</li>
            <li>Dates as <code>YYYY-MM-DD</code>. New reservations appear instantly in PanHost.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

function EmailCard() {
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api.get('/api/email-log').then((r) => setData(r.data)).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  const test = async () => {
    setBusy(true);
    setMsg('');
    try {
      const { data: r } = await api.post('/api/email/test');
      setMsg(r.status === 'sent' ? '✅ Test email sent — check your inbox.' : 'ℹ️ Logged (add SMTP to deliver for real).');
      await load();
    } catch {
      setMsg('⚠️ Failed to send test.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-header">
        <h3>✉️ Email notifications</h3>
        <span className={`badge ${data?.configured ? 'confirmed' : 'pending'}`}>
          {data?.configured ? 'SMTP connected' : 'Log-only (no SMTP)'}
        </span>
      </div>
      <div className="card-body">
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          PanHost sends welcome emails to new accounts, confirmations to added team members, and can
          email guests. To deliver for real, set <code>SMTP_HOST</code>, <code>SMTP_PORT</code>,{' '}
          <code>SMTP_USER</code>, <code>SMTP_PASS</code>, <code>EMAIL_FROM</code> on the backend
          (any SMTP works — Gmail, Resend, SendGrid, Mailgun). Until then, every email is recorded below so you can verify the flow.
        </p>
        <div className="row" style={{ marginBottom: 12 }}>
          <button className="btn secondary" onClick={test} disabled={busy}>{busy ? 'Sending…' : 'Send test email'}</button>
          {msg && <span style={{ fontSize: 13 }}>{msg}</span>}
        </div>
        {data?.log?.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>To</th><th>Subject</th><th>Status</th></tr></thead>
              <tbody>
                {data.log.slice(0, 8).map((e, i) => (
                  <tr key={i}>
                    <td>{e.recipient}</td>
                    <td>{e.subject}</td>
                    <td><span className={`badge ${e.status === 'sent' ? 'confirmed' : e.status === 'failed' ? 'cancelled' : 'pending'}`}>{e.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Settings() {
  const { user } = useAuth();
  const [creds, setCreds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () =>
    api
      .get('/api/credentials')
      .then((r) => setCreds(r.data))
      .catch((e) => setError(apiError(e)))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const onConnect = async (platform, form) => {
    await api.post(`/api/credentials/${platform}`, form);
    await load();
  };

  const onSync = async (platform) => {
    const { data } = await api.post(`/api/sync/${platform}`);
    return data;
  };

  const find = (p) => creds.find((c) => c.platform === p);

  if (loading) return <Loading />;

  return (
    <>
      <div className="page-header">
        <p className="subtitle">Account and platform integrations</p>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header"><h3>Account</h3></div>
        <div className="card-body">
          <div className="row wrap" style={{ gap: 32 }}>
            <div>
              <div className="muted" style={{ fontSize: 13 }}>Name</div>
              <div style={{ fontWeight: 600 }}>{user?.name || '—'}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 13 }}>Email</div>
              <div style={{ fontWeight: 600 }}>{user?.email}</div>
            </div>
          </div>
        </div>
      </div>

      <BrandingCard />

      <DirectBookingCard />

      <EmailCard />

      <WebhookCard />

      <IcalSyncCard />

      <div className="alert info">
        Airbnb and VRBO require partner API access. Once you paste real credentials and set
        <code style={{ margin: '0 4px' }}>AIRBNB_SYNC_URL</code>/<code style={{ margin: '0 4px' }}>VRBO_SYNC_URL</code>
        on the backend, syncing pulls live reservations. Without those env vars, "Sync" imports sample bookings so you can try the flow.
      </div>

      <div className="grid-cards">
        <PlatformCard
          platform="airbnb"
          label="🅰️ Airbnb"
          color="var(--airbnb)"
          connected={find('airbnb')}
          onConnect={onConnect}
          onSync={onSync}
        />
        <PlatformCard
          platform="vrbo"
          label="🆅 VRBO"
          color="var(--vrbo)"
          connected={find('vrbo')}
          onConnect={onConnect}
          onSync={onSync}
        />
      </div>
    </>
  );
}
