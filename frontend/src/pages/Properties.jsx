import { useEffect, useState } from 'react';
import api, { apiError } from '../api';
import { Modal, Loading, Empty, money } from '../components/ui.jsx';

const BLANK = {
  name: '',
  address: '',
  city: '',
  country: '',
  bedrooms: 1,
  bathrooms: 1,
  max_guests: 2,
  base_price: 0,
  cleaning_fee: 0,
  description: '',
  amenities: '',
  photos: '',
  airbnb_ical_url: '',
  vrbo_ical_url: '',
  booking_com_ical_url: '',
  airbnb_listing_id: '',
  wifi_name: '',
  wifi_password: '',
  checkin_time: '',
  checkout_time: '',
  house_rules: '',
  guidebook: '',
  notes: '',
};

export default function Properties() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [gallery, setGallery] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState('');

  const pullFromAirbnb = async () => {
    setImportBusy(true);
    setImportMsg('');
    try {
      const { data } = await api.post('/api/import/airbnb', {
        listing_id: form.airbnb_listing_id || undefined,
        url: form.airbnb_ical_url || undefined,
      });
      setForm((f) => ({
        ...f,
        name: data.title || f.name,
        description: data.description || f.description,
        amenities: (data.amenities && data.amenities.length ? data.amenities.join(', ') : f.amenities),
        photos: (data.photos && data.photos.length ? data.photos.join('\n') : f.photos),
        bedrooms: data.bedrooms ?? f.bedrooms,
        bathrooms: data.bathrooms ?? f.bathrooms,
        max_guests: data.max_guests ?? f.max_guests,
        airbnb_listing_id: data.listing_id || f.airbnb_listing_id,
      }));
      setImportMsg(`✅ Pulled ${data.photos?.length || 0} photos, ${data.amenities?.length || 0} amenities. Review & Save.`);
    } catch (err) {
      setImportMsg('⚠️ ' + apiError(err));
    } finally {
      setImportBusy(false);
    }
  };

  const load = () =>
    api
      .get('/api/properties')
      .then((r) => setItems(r.data))
      .catch((e) => setError(apiError(e)))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const openNew = () => {
    setEditing(null);
    setForm(BLANK);
    setImportMsg('');
    setShowModal(true);
  };

  const openEdit = (p) => {
    setEditing(p);
    // Coalesce nulls from the DB to '' so inputs stay controlled.
    const clean = {};
    for (const k of Object.keys(BLANK)) clean[k] = p[k] ?? BLANK[k];
    setForm(clean);
    setImportMsg('');
    setShowModal(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (editing) {
        await api.put(`/api/properties/${editing.id}`, form);
      } else {
        await api.post('/api/properties', form);
      }
      setShowModal(false);
      await load();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p) => {
    if (!confirm(`Delete "${p.name}"? This also removes its bookings.`)) return;
    try {
      await api.delete(`/api/properties/${p.id}`);
      await load();
    } catch (err) {
      setError(apiError(err));
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  if (loading) return <Loading />;

  return (
    <>
      <div className="page-header">
        <p className="subtitle">Manage your rental listings</p>
        <button className="btn" onClick={openNew}>
          + Add property
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}

      {items.length === 0 ? (
        <div className="card">
          <Empty
            icon="🏠"
            title="No properties yet"
            subtitle="Add your first rental to start tracking bookings."
            action={
              <button className="btn" onClick={openNew}>
                + Add property
              </button>
            }
          />
        </div>
      ) : (
        <div className="grid-cards">
          {items.map((p) => {
            const photoList = (p.photos || '').split('\n').map((s) => s.trim()).filter(Boolean);
            const amenityList = (p.amenities || '').split(',').map((s) => s.trim()).filter(Boolean);
            return (
            <div className="card property-card" key={p.id}>
              {photoList[0] && (
                <div style={{ position: 'relative', cursor: 'pointer' }} onClick={() => setGallery(p)}>
                  <img
                    src={photoList[0]}
                    alt={p.name}
                    style={{ width: '100%', height: 160, objectFit: 'cover', borderTopLeftRadius: 'var(--radius)', borderTopRightRadius: 'var(--radius)', display: 'block' }}
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                  {photoList.length > 1 && (
                    <span style={{ position: 'absolute', bottom: 8, right: 8, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 12, padding: '3px 8px', borderRadius: 999 }}>
                      📷 {photoList.length} photos
                    </span>
                  )}
                </div>
              )}
              <div className="card-body">
                <h3>{p.name}</h3>
                <div className="meta">
                  {[p.city, p.country].filter(Boolean).join(', ') || p.address || '—'}
                </div>
                {p.description && (
                  <p className="muted" style={{ fontSize: 13, marginBottom: 12, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {p.description}
                  </p>
                )}
                <div className="specs">
                  <span>🛏️ {p.bedrooms} bd</span>
                  <span>🛁 {p.bathrooms} ba</span>
                  <span>👥 {p.max_guests}</span>
                </div>
                {amenityList.length > 0 && (
                  <div className="row wrap" style={{ gap: 6, marginBottom: 12 }}>
                    {amenityList.slice(0, 4).map((a) => (
                      <span key={a} className="badge direct" style={{ fontWeight: 500 }}>{a}</span>
                    ))}
                    {amenityList.length > 4 && <span className="muted" style={{ fontSize: 12 }}>+{amenityList.length - 4}</span>}
                  </div>
                )}
                {(p.airbnb_ical_url || p.vrbo_ical_url) && (
                  <div className="row wrap" style={{ gap: 6, marginBottom: 12 }}>
                    {p.airbnb_ical_url && <span className="badge airbnb">📅 Airbnb calendar</span>}
                    {p.vrbo_ical_url && <span className="badge vrbo">📅 VRBO calendar</span>}
                  </div>
                )}
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="price">{money(p.base_price)}<span className="muted" style={{ fontWeight: 400, fontSize: 13 }}> /night</span></span>
                  <div className="row">
                    <a className="btn ghost sm" href={`/guide/${p.id}`} target="_blank" rel="noreferrer" title="Open guest guidebook">📖</a>
                    <button className="btn ghost sm" onClick={() => openEdit(p)}>
                      Edit
                    </button>
                    <button className="btn ghost sm" onClick={() => remove(p)} style={{ color: 'var(--danger)' }}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {gallery && (
        <Modal title={gallery.name} onClose={() => setGallery(null)}>
          {(() => {
            const photos = (gallery.photos || '').split('\n').map((s) => s.trim()).filter(Boolean);
            const amenities = (gallery.amenities || '').split(',').map((s) => s.trim()).filter(Boolean);
            return (
              <>
                <div className="muted" style={{ marginBottom: 12 }}>
                  {[gallery.city, gallery.country].filter(Boolean).join(', ')} · {gallery.bedrooms} bd · {gallery.bathrooms} ba · up to {gallery.max_guests} guests
                </div>
                {photos.length > 0 && (
                  <div className="gallery-grid">
                    {photos.map((src, i) => (
                      <img key={i} src={src} alt={`${gallery.name} ${i + 1}`} loading="lazy"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                    ))}
                  </div>
                )}
                {gallery.description && (
                  <>
                    <h4 style={{ margin: '18px 0 6px' }}>About this space</h4>
                    <p style={{ fontSize: 14, whiteSpace: 'pre-line' }}>{gallery.description}</p>
                  </>
                )}
                {amenities.length > 0 && (
                  <>
                    <h4 style={{ margin: '18px 0 8px' }}>Amenities</h4>
                    <div className="row wrap" style={{ gap: 6 }}>
                      {amenities.map((a) => (
                        <span key={a} className="badge direct" style={{ fontWeight: 500 }}>{a}</span>
                      ))}
                    </div>
                  </>
                )}
              </>
            );
          })()}
        </Modal>
      )}

      {showModal && (
        <Modal
          title={editing ? 'Edit property' : 'Add property'}
          onClose={() => setShowModal(false)}
          footer={
            <>
              <button className="btn secondary" onClick={() => setShowModal(false)}>
                Cancel
              </button>
              <button className="btn" onClick={save} disabled={busy}>
                {busy ? 'Saving…' : 'Save property'}
              </button>
            </>
          }
        >
          <form onSubmit={save}>
            <div className="form-grid">
              <div className="field full">
                <label>Name *</label>
                <input value={form.name} onChange={set('name')} required placeholder="Mountain Cabin" />
              </div>
              <div className="field full">
                <label>Address</label>
                <input value={form.address} onChange={set('address')} placeholder="645 Mountain Rd" />
              </div>
              <div className="field">
                <label>City</label>
                <input value={form.city} onChange={set('city')} />
              </div>
              <div className="field">
                <label>Country</label>
                <input value={form.country} onChange={set('country')} />
              </div>
              <div className="field">
                <label>Bedrooms</label>
                <input type="number" min="0" value={form.bedrooms} onChange={set('bedrooms')} />
              </div>
              <div className="field">
                <label>Bathrooms</label>
                <input type="number" min="0" step="0.5" value={form.bathrooms} onChange={set('bathrooms')} />
              </div>
              <div className="field">
                <label>Max guests</label>
                <input type="number" min="1" value={form.max_guests} onChange={set('max_guests')} />
              </div>
              <div className="field">
                <label>Base price / night ($)</label>
                <input type="number" min="0" step="0.01" value={form.base_price} onChange={set('base_price')} />
              </div>
              <div className="field">
                <label>Cleaning fee ($)</label>
                <input type="number" min="0" step="0.01" value={form.cleaning_fee} onChange={set('cleaning_fee')} />
              </div>
              <div className="field full">
                <label>Description</label>
                <textarea value={form.description} onChange={set('description')} placeholder="Cozy cabin with mountain views…" />
              </div>
              <div className="field full">
                <label>Amenities <span className="muted" style={{ fontWeight: 400 }}>(comma-separated)</span></label>
                <input value={form.amenities} onChange={set('amenities')} placeholder="WiFi, Hot tub, Parking, Kitchen" />
              </div>
              <div className="field full">
                <label>Photos <span className="muted" style={{ fontWeight: 400 }}>(one image URL per line)</span></label>
                <textarea value={form.photos} onChange={set('photos')} placeholder="https://…/photo1.jpg&#10;https://…/photo2.jpg" />
              </div>
              <div className="field full">
                <label>Airbnb listing ID or URL <span className="muted" style={{ fontWeight: 400 }}>(for pulling live content)</span></label>
                <div className="row">
                  <input value={form.airbnb_listing_id} onChange={set('airbnb_listing_id')} placeholder="e.g. 1775471491350334520 or airbnb.com/rooms/…" />
                  <button type="button" className="btn secondary nav-btn" onClick={pullFromAirbnb} disabled={importBusy}>
                    {importBusy ? 'Pulling…' : '⬇ Pull from Airbnb'}
                  </button>
                </div>
                {importMsg && (
                  <div className={`alert ${importMsg.startsWith('✅') ? 'success' : 'error'}`} style={{ marginTop: 8, marginBottom: 0 }}>
                    {importMsg}
                  </div>
                )}
                <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                  Pulls title, photos, amenities & description from your <strong>public</strong> Airbnb listing page.
                </p>
              </div>
              <div className="field full">
                <label>Airbnb iCal URL <span className="muted" style={{ fontWeight: 400 }}>(Listing → Availability → Sync calendars → Export)</span></label>
                <input value={form.airbnb_ical_url} onChange={set('airbnb_ical_url')} placeholder="https://www.airbnb.com/calendar/ical/….ics?t=…" />
              </div>
              <div className="field full">
                <label>VRBO iCal URL</label>
                <input value={form.vrbo_ical_url} onChange={set('vrbo_ical_url')} placeholder="https://www.vrbo.com/icalendar/….ics" />
              </div>
              <div className="field full">
                <label>Booking.com iCal URL</label>
                <input value={form.booking_com_ical_url} onChange={set('booking_com_ical_url')} placeholder="https://admin.booking.com/hotel/…/ical…" />
              </div>
              <div className="field">
                <label>Check-in time</label>
                <input value={form.checkin_time} onChange={set('checkin_time')} placeholder="4:00 PM" />
              </div>
              <div className="field">
                <label>Check-out time</label>
                <input value={form.checkout_time} onChange={set('checkout_time')} placeholder="11:00 AM" />
              </div>
              <div className="field">
                <label>Wi-Fi network</label>
                <input value={form.wifi_name} onChange={set('wifi_name')} />
              </div>
              <div className="field">
                <label>Wi-Fi password</label>
                <input value={form.wifi_password} onChange={set('wifi_password')} />
              </div>
              <div className="field full">
                <label>Guest guidebook <span className="muted" style={{ fontWeight: 400 }}>(local tips, directions, appliance how-tos)</span></label>
                <textarea value={form.guidebook} onChange={set('guidebook')} placeholder="Nearest grocery is 5 min away…" />
              </div>
              <div className="field full">
                <label>House rules</label>
                <textarea value={form.house_rules} onChange={set('house_rules')} placeholder="No smoking. Quiet hours after 10pm…" />
              </div>
              <div className="field full">
                <label>Notes <span className="muted" style={{ fontWeight: 400 }}>(private)</span></label>
                <textarea value={form.notes} onChange={set('notes')} placeholder="Access codes, quirks, etc." />
              </div>
            </div>
            <button type="submit" style={{ display: 'none' }} />
          </form>
        </Modal>
      )}
    </>
  );
}
