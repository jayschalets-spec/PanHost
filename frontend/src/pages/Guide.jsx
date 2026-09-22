import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api, { apiError } from '../api';

export default function Guide() {
  const { propertyId } = useParams();
  const [g, setG] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get(`/api/public/guide/${propertyId}`)
      .then((r) => {
        setG(r.data);
        if (r.data.brand_color) document.documentElement.style.setProperty('--primary', r.data.brand_color);
      })
      .catch((e) => setError(apiError(e)));
  }, [propertyId]);

  if (error) return <div className="auth-wrap"><div className="auth-card"><div className="alert error">{error}</div></div></div>;
  if (!g) return <div className="loading"><div className="spinner" /></div>;

  const photos = (g.photos || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const amenities = (g.amenities || '').split(',').map((s) => s.trim()).filter(Boolean);
  const brand = g.brand_name || g.company || 'Your host';

  const Section = ({ icon, title, children }) =>
    children ? (
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body">
          <h3 style={{ marginBottom: 8 }}>{icon} {title}</h3>
          <div style={{ fontSize: 14, whiteSpace: 'pre-line', color: 'var(--text)' }}>{children}</div>
        </div>
      </div>
    ) : null;

  return (
    <div className="book-page">
      <header className="book-header">
        <h1>{g.name}</h1>
        <p>Guest guidebook · {[g.city, g.country].filter(Boolean).join(', ')}</p>
      </header>
      <div className="book-container" style={{ maxWidth: 720 }}>
        {photos[0] && (
          <img src={photos[0]} alt={g.name} style={{ width: '100%', height: 260, objectFit: 'cover', borderRadius: 'var(--radius)', marginBottom: 16 }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        )}

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body">
            <div className="row wrap" style={{ gap: 20 }}>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Check-in</div>
                <div style={{ fontWeight: 700 }}>{g.checkin_time || '4:00 PM'}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Check-out</div>
                <div style={{ fontWeight: 700 }}>{g.checkout_time || '11:00 AM'}</div>
              </div>
              {g.wifi_name && (
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>Wi-Fi network</div>
                  <div style={{ fontWeight: 700 }}>{g.wifi_name}</div>
                </div>
              )}
              {g.wifi_password && (
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>Wi-Fi password</div>
                  <div style={{ fontWeight: 700, fontFamily: 'monospace' }}>{g.wifi_password}</div>
                </div>
              )}
            </div>
          </div>
        </div>

        <Section icon="📖" title="About the space">{g.description}</Section>
        <Section icon="🧭" title="Guidebook & local tips">{g.guidebook}</Section>
        <Section icon="📋" title="House rules">{g.house_rules}</Section>

        {amenities.length > 0 && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-body">
              <h3 style={{ marginBottom: 10 }}>✨ Amenities</h3>
              <div className="row wrap" style={{ gap: 6 }}>
                {amenities.map((a) => <span key={a} className="badge direct" style={{ fontWeight: 500 }}>{a}</span>)}
              </div>
            </div>
          </div>
        )}

        <p className="muted" style={{ textAlign: 'center', fontSize: 13 }}>Hosted by {brand} · powered by PanHost</p>
      </div>
    </div>
  );
}
