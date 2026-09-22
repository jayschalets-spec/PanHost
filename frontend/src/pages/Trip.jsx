import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { format, differenceInCalendarDays } from 'date-fns';
import api, { apiError } from '../api';
import { localDate } from '../components/ui.jsx';

export default function Trip() {
  const { bookingId } = useParams();
  const [t, setT] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get(`/api/public/reservation/${bookingId}`)
      .then((r) => {
        setT(r.data);
        if (r.data.brand_color) document.documentElement.style.setProperty('--primary', r.data.brand_color);
      })
      .catch((e) => setError(apiError(e)));
  }, [bookingId]);

  if (error) return <div className="auth-wrap"><div className="auth-card"><div className="alert error">{error}</div></div></div>;
  if (!t) return <div className="loading"><div className="spinner" /></div>;

  const photos = (t.photos || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const brand = t.brand_name || t.company || 'Your host';
  const daysUntil = Math.max(0, differenceInCalendarDays(localDate(t.check_in), new Date()));
  const first = (t.guest_name || 'Guest').split(' ')[0];

  return (
    <div className="book-page">
      <header className="book-header">
        <h1>Welcome, {first} 👋</h1>
        <p>Your stay at {t.property_name}</p>
      </header>
      <div className="book-container" style={{ maxWidth: 680 }}>
        {photos[0] && (
          <img src={photos[0]} alt={t.property_name} style={{ width: '100%', height: 240, objectFit: 'cover', borderRadius: 'var(--radius)', marginBottom: 16 }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        )}

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body" style={{ textAlign: 'center' }}>
            {daysUntil > 0 ? (
              <>
                <div className="countdown">{daysUntil}<span> days to go</span></div>
                <p className="muted" style={{ marginTop: 6 }}>until check-in</p>
              </>
            ) : (
              <h3>Enjoy your stay! 🎉</h3>
            )}
          </div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body">
            <div className="row wrap" style={{ gap: 24 }}>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Check-in</div>
                <strong>{format(localDate(t.check_in), 'EEE, MMM d')} · {t.checkin_time || '4:00 PM'}</strong>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Check-out</div>
                <strong>{format(localDate(t.check_out), 'EEE, MMM d')} · {t.checkout_time || '11:00 AM'}</strong>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Guests</div>
                <strong>{t.guests}</strong>
              </div>
            </div>
          </div>
        </div>

        {(t.door_code || t.wifi_name) && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-body">
              <h3 style={{ marginBottom: 10 }}>🔑 Access</h3>
              {t.address && <p style={{ marginBottom: 8 }}><span className="muted">Address: </span>{t.address}</p>}
              {t.door_code && <p style={{ marginBottom: 8 }}><span className="muted">Door code: </span><strong style={{ fontFamily: 'monospace', fontSize: 18 }}>{t.door_code}</strong></p>}
              {t.wifi_name && <p style={{ marginBottom: 4 }}><span className="muted">Wi-Fi: </span><strong>{t.wifi_name}</strong>{t.wifi_password && <> · <span style={{ fontFamily: 'monospace' }}>{t.wifi_password}</span></>}</p>}
            </div>
          </div>
        )}

        {t.guidebook && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-body">
              <h3 style={{ marginBottom: 8 }}>🧭 Guidebook</h3>
              <div style={{ fontSize: 14, whiteSpace: 'pre-line' }}>{t.guidebook}</div>
            </div>
          </div>
        )}

        {t.house_rules && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-body">
              <h3 style={{ marginBottom: 8 }}>📋 House rules</h3>
              <div style={{ fontSize: 14, whiteSpace: 'pre-line' }}>{t.house_rules}</div>
            </div>
          </div>
        )}

        <p className="muted" style={{ textAlign: 'center', fontSize: 13 }}>Hosted by {brand} · powered by PanHost</p>
      </div>
    </div>
  );
}
