import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format, formatDistanceToNow } from 'date-fns';
import api, { apiError } from '../api';
import { Loading, Empty, Badge, localDate } from '../components/ui.jsx';

// Build a thread key from a message or booking.
const threadKeyOf = (m) => m.booking_id || `guest:${(m.guest_name || 'Guest').toLowerCase()}`;

export default function Inbox() {
  const [messages, setMessages] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeKey, setActiveKey] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [search, setSearch] = useState('');
  const [params, setParams] = useSearchParams();
  const endRef = useRef(null);

  const load = () =>
    Promise.all([
      api.get('/api/messages'),
      api.get('/api/bookings'),
      api.get('/api/templates').catch(() => ({ data: [] })),
    ])
      .then(([m, b, t]) => {
        setMessages(m.data);
        setBookings(b.data);
        setTemplates(t.data);
      })
      .catch((e) => setError(apiError(e)))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  // Assemble threads: one per booking (a guest) + any message-only threads.
  const threads = useMemo(() => {
    const map = new Map();
    for (const b of bookings) {
      const key = b.id;
      map.set(key, {
        key,
        booking: b,
        guest_name: b.guest_name,
        guest_email: b.guest_email,
        platform: b.platform,
        property_name: b.property_name,
        messages: [],
        lastAt: localDate(b.check_in),
      });
    }
    for (const m of messages) {
      const key = threadKeyOf(m);
      if (!map.has(key)) {
        map.set(key, {
          key,
          booking: null,
          guest_name: m.guest_name || 'Guest',
          guest_email: null,
          platform: m.platform,
          property_name: m.property_name,
          messages: [],
          lastAt: new Date(m.created_at),
        });
      }
      const t = map.get(key);
      t.messages.push(m);
      const at = new Date(m.created_at);
      if (at > t.lastAt) t.lastAt = at;
    }
    let list = [...map.values()].sort((a, b) => b.lastAt - a.lastAt);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.guest_name.toLowerCase().includes(q) ||
          (t.property_name || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [messages, bookings, search]);

  // Preselect from ?booking= or first thread.
  useEffect(() => {
    if (activeKey) return;
    const wanted = params.get('booking');
    if (wanted && threads.some((t) => t.key === wanted)) setActiveKey(wanted);
    else if (threads.length) setActiveKey(threads[0].key);
  }, [threads, activeKey, params]);

  const active = threads.find((t) => t.key === activeKey) || null;
  const activeMessages = useMemo(
    () => (active ? [...active.messages].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)) : []),
    [active]
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeMessages.length, activeKey]);

  const send = async (e) => {
    e?.preventDefault();
    if (!draft.trim() || !active) return;
    setBusy(true);
    try {
      await api.post('/api/messages', {
        property_id: active.booking?.property_id || null,
        booking_id: active.booking?.id || null,
        guest_name: active.guest_name,
        platform: active.platform,
        direction: 'outgoing',
        body: draft.trim(),
      });
      setDraft('');
      await load();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const suggestReply = async () => {
    if (!active) return;
    setSuggesting(true);
    try {
      const lastIncoming = [...activeMessages].reverse().find((m) => m.direction === 'incoming');
      const { data } = await api.post('/api/ai/suggest-reply', {
        guest_name: active.guest_name,
        property_name: active.property_name,
        last_message: lastIncoming?.body || '',
        check_in: active.booking?.check_in,
      });
      setDraft(data.suggestion);
    } catch {
      /* ignore */
    } finally {
      setSuggesting(false);
    }
  };

  const applyTemplate = (tpl) => {
    let body = tpl.body;
    if (active) {
      body = body
        .replace(/\{\{guest\}\}/gi, active.guest_name || 'there')
        .replace(/\{\{property\}\}/gi, active.property_name || 'the property')
        .replace(
          /\{\{checkin\}\}/gi,
          active.booking ? format(localDate(active.booking.check_in), 'MMM d') : ''
        )
        .replace(
          /\{\{checkout\}\}/gi,
          active.booking ? format(localDate(active.booking.check_out), 'MMM d') : ''
        );
    }
    setDraft(body);
  };

  if (loading) return <Loading />;

  return (
    <>
      <div className="page-header">
        <p className="subtitle">Unified guest inbox across all platforms</p>
      </div>
      {error && <div className="alert error">{error}</div>}

      <div className="inbox card">
        <div className="inbox-list">
          <div className="inbox-search">
            <input
              placeholder="Search guests…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {threads.length === 0 ? (
            <div className="empty" style={{ padding: 24 }}>
              <div className="icon">💬</div>
              <p className="muted">No conversations yet. Add a booking to start.</p>
            </div>
          ) : (
            threads.map((t) => (
              <button
                key={t.key}
                className={`thread ${t.key === activeKey ? 'active' : ''}`}
                onClick={() => setActiveKey(t.key)}
              >
                <div className="avatar" style={{ background: `var(--${t.platform})` }}>
                  {(t.guest_name || 'G').charAt(0).toUpperCase()}
                </div>
                <div className="thread-info">
                  <div className="thread-top">
                    <span className="thread-name">{t.guest_name}</span>
                    <span className="thread-time">
                      {t.messages.length
                        ? formatDistanceToNow(t.lastAt, { addSuffix: false })
                        : ''}
                    </span>
                  </div>
                  <div className="thread-sub">
                    {t.messages.length
                      ? t.messages[t.messages.length - 1].body.slice(0, 38)
                      : t.property_name || 'No messages yet'}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        <div className="inbox-conversation">
          {!active ? (
            <div className="empty" style={{ margin: 'auto' }}>
              <div className="icon">✉️</div>
              <p className="muted">Select a conversation</p>
            </div>
          ) : (
            <>
              <div className="conv-header">
                <div>
                  <div className="row" style={{ gap: 8 }}>
                    <strong>{active.guest_name}</strong>
                    <Badge kind={active.platform}>{active.platform}</Badge>
                  </div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {active.property_name}
                    {active.booking &&
                      ` · ${format(localDate(active.booking.check_in), 'MMM d')} – ${format(
                        localDate(active.booking.check_out),
                        'MMM d'
                      )}`}
                  </div>
                </div>
                {active.guest_email && (
                  <a
                    className="btn secondary sm"
                    href={`mailto:${active.guest_email}?subject=${encodeURIComponent(
                      `Regarding your stay at ${active.property_name || 'our place'}`
                    )}`}
                  >
                    ✉️ Email guest
                  </a>
                )}
              </div>

              <div className="conv-body">
                {active.platform !== 'direct' && (
                  <div className="alert info" style={{ margin: '0 0 12px' }}>
                    {active.platform === 'airbnb' ? 'Airbnb' : 'VRBO'} delivers guest messages on
                    its own platform. Messages here are logged for your records; email works for
                    direct guests.
                  </div>
                )}
                {activeMessages.length === 0 ? (
                  <p className="muted" style={{ textAlign: 'center', marginTop: 24 }}>
                    No messages yet — say hello 👋
                  </p>
                ) : (
                  activeMessages.map((m) => (
                    <div key={m.id} className={`bubble ${m.direction}`}>
                      <div>{m.body}</div>
                      <div className="bubble-time">
                        {format(new Date(m.created_at), 'MMM d, h:mm a')}
                      </div>
                    </div>
                  ))
                )}
                <div ref={endRef} />
              </div>

              <div className="template-row">
                <button className="chip" style={{ borderColor: 'var(--primary)', color: 'var(--primary)', fontWeight: 600 }} onClick={suggestReply} disabled={suggesting}>
                  {suggesting ? '✨ Thinking…' : '✨ Suggest reply'}
                </button>
                {templates.map((t) => (
                  <button key={t.id} className="chip" onClick={() => applyTemplate(t)}>
                    {t.name}
                  </button>
                ))}
              </div>

              <form className="composer" onSubmit={send}>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Type a message…"
                  rows={2}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(e);
                  }}
                />
                <button className="btn" disabled={busy || !draft.trim()}>
                  {busy ? 'Sending…' : 'Send'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </>
  );
}
