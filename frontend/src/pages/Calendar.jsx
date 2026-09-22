import { useEffect, useMemo, useState } from 'react';
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  addMonths,
  addDays,
  format,
  isSameMonth,
  isSameDay,
  isWithinInterval,
  differenceInCalendarDays,
  parseISO,
} from 'date-fns';
import { useNavigate } from 'react-router-dom';
import api, { apiError } from '../api';
import { Loading, localDate } from '../components/ui.jsx';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PLATFORM_BG = { airbnb: 'var(--airbnb)', vrbo: 'var(--vrbo)', booking: '#003580', direct: 'var(--primary)' };
const DAY_W = 40;
const TL_DAYS = 24;

function MonthView({ cursor, setCursor, visible }) {
  const days = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(cursor));
    const gridEnd = endOfWeek(endOfMonth(cursor));
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [cursor]);

  const eventsFor = (day) =>
    visible.filter((b) =>
      isWithinInterval(day, {
        start: localDate(b.check_in),
        end: new Date(localDate(b.check_out).getTime() - 1),
      })
    );

  return (
    <div className="card">
      <div className="card-header">
        <div className="row">
          <button className="btn secondary sm" onClick={() => setCursor(addMonths(cursor, -1))}>←</button>
          <h3 style={{ minWidth: 160, textAlign: 'center' }}>{format(cursor, 'MMMM yyyy')}</h3>
          <button className="btn secondary sm" onClick={() => setCursor(addMonths(cursor, 1))}>→</button>
        </div>
        <button className="btn ghost sm" onClick={() => setCursor(startOfMonth(new Date()))}>Today</button>
      </div>
      <div className="card-body">
        <div className="calendar">
          {DOW.map((d) => <div className="dow" key={d}>{d}</div>)}
          {days.map((day) => {
            const events = eventsFor(day);
            const inMonth = isSameMonth(day, cursor);
            const today = isSameDay(day, new Date());
            return (
              <div key={day.toISOString()} className={`cal-cell ${today ? 'today' : ''}`} style={{ opacity: inMonth ? 1 : 0.4 }}>
                <div className="day-num">{format(day, 'd')}</div>
                {events.slice(0, 3).map((e) => (
                  <div className={`cal-event ${e.platform}`} key={e.id} title={`${e.guest_name} · ${e.property_name}`}>{e.guest_name}</div>
                ))}
                {events.length > 3 && <div className="muted" style={{ fontSize: 11 }}>+{events.length - 3} more</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TimelineView({ start, setStart, properties, bookings, onCreate }) {
  const days = useMemo(() => Array.from({ length: TL_DAYS }, (_, i) => addDays(start, i)), [start]);

  return (
    <div className="card">
      <div className="card-header">
        <div className="row">
          <button className="btn secondary sm" onClick={() => setStart(addDays(start, -7))}>←</button>
          <h3 style={{ minWidth: 200, textAlign: 'center' }}>
            {format(days[0], 'MMM d')} – {format(days[days.length - 1], 'MMM d, yyyy')}
          </h3>
          <button className="btn secondary sm" onClick={() => setStart(addDays(start, 7))}>→</button>
        </div>
        <button className="btn ghost sm" onClick={() => setStart(new Date())}>Today</button>
      </div>
      <div className="card-body" style={{ overflowX: 'auto', padding: 0 }}>
        <div className="tl" style={{ minWidth: 180 + TL_DAYS * DAY_W }}>
          {/* Header row */}
          <div className="tl-row tl-head">
            <div className="tl-name">Listing</div>
            <div className="tl-track">
              {days.map((d) => (
                <div key={d.toISOString()} className={`tl-daycol ${isSameDay(d, new Date()) ? 'today' : ''}`} style={{ width: DAY_W }}>
                  <div className="tl-dow">{format(d, 'EEEEE')}</div>
                  <div className="tl-dnum">{format(d, 'd')}</div>
                </div>
              ))}
            </div>
          </div>
          {/* Property rows */}
          {properties.map((p) => {
            const rowBookings = bookings.filter((b) => b.property_id === p.id);
            return (
              <div className="tl-row" key={p.id}>
                <div className="tl-name" title={p.name}>{p.name}</div>
                <div className="tl-track" style={{ position: 'relative' }}>
                  {days.map((d) => (
                    <div
                      key={d.toISOString()}
                      className={`tl-cell ${isSameDay(d, new Date()) ? 'today' : ''}`}
                      style={{ width: DAY_W, cursor: 'pointer' }}
                      title={`New booking · ${format(d, 'MMM d')}`}
                      onClick={() => onCreate(p.id, format(d, 'yyyy-MM-dd'))}
                    />
                  ))}
                  {rowBookings.map((b) => {
                    const ci = localDate(b.check_in);
                    const co = localDate(b.check_out);
                    const startOffset = differenceInCalendarDays(ci, start);
                    const endOffset = differenceInCalendarDays(co, start);
                    const from = Math.max(0, startOffset);
                    const to = Math.min(TL_DAYS, endOffset);
                    if (to <= 0 || from >= TL_DAYS) return null;
                    const left = from * DAY_W + (startOffset >= 0 ? DAY_W / 2 : 0);
                    const width = (to - from) * DAY_W - (startOffset >= 0 ? DAY_W / 2 : 0) - (endOffset <= TL_DAYS ? DAY_W / 2 : 0);
                    return (
                      <div
                        key={b.id}
                        className="tl-bar"
                        title={`${b.guest_name} · ${format(ci, 'MMM d')}–${format(co, 'MMM d')}`}
                        style={{ left, width: Math.max(width, 12), background: PLATFORM_BG[b.platform] || 'var(--primary)' }}
                      >
                        {b.guest_name}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {properties.length === 0 && <div className="muted" style={{ padding: 20 }}>Add a listing to see the timeline.</div>}
        </div>
      </div>
    </div>
  );
}

export default function Calendar() {
  const navigate = useNavigate();
  const [bookings, setBookings] = useState([]);
  const [properties, setProperties] = useState([]);
  const [propFilter, setPropFilter] = useState('');
  const [cursor, setCursor] = useState(startOfMonth(new Date()));
  const [tlStart, setTlStart] = useState(new Date());
  const [view, setView] = useState('timeline');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.get('/api/bookings'), api.get('/api/properties')])
      .then(([b, p]) => {
        setBookings(b.data);
        setProperties(p.data);
      })
      .catch((e) => setError(apiError(e)))
      .finally(() => setLoading(false));
  }, []);

  const visible = useMemo(
    () => bookings.filter((b) => b.status !== 'cancelled' && (!propFilter || b.property_id === propFilter)),
    [bookings, propFilter]
  );
  const shownProps = useMemo(
    () => (propFilter ? properties.filter((p) => p.id === propFilter) : properties),
    [properties, propFilter]
  );

  if (loading) return <Loading />;

  return (
    <>
      <div className="page-header">
        <p className="subtitle">Unified availability across all channels</p>
        <div className="row wrap">
          <div className="seg">
            <button className={`seg-btn ${view === 'timeline' ? 'active' : ''}`} onClick={() => setView('timeline')}>Timeline</button>
            <button className={`seg-btn ${view === 'month' ? 'active' : ''}`} onClick={() => setView('month')}>Month</button>
          </div>
          <select style={{ width: 'auto' }} value={propFilter} onChange={(e) => setPropFilter(e.target.value)}>
            <option value="">All listings</option>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      {view === 'month' ? (
        <MonthView cursor={cursor} setCursor={setCursor} visible={visible} />
      ) : (
        <TimelineView
          start={tlStart}
          setStart={setTlStart}
          properties={shownProps}
          bookings={visible}
          onCreate={(propertyId, date) => navigate(`/bookings?property=${propertyId}&check_in=${date}`)}
        />
      )}

      <div className="row wrap" style={{ marginTop: 16, gap: 16 }}>
        <span className="badge airbnb">Airbnb</span>
        <span className="badge vrbo">VRBO</span>
        <span className="badge booking">Booking.com</span>
        <span className="badge direct">Direct</span>
      </div>
    </>
  );
}
