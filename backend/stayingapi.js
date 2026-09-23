// StayingAPI integration — reliable public listing data (photos, amenities,
// details) across Airbnb/VRBO/Booking. Unofficial third-party service that does
// the fetching server-side, so PanHost doesn't get blocked. The user supplies a
// free API key (STAYINGAPI_KEY); when absent, callers fall back to direct scrape.
import axios from 'axios';

const BASE = process.env.STAYINGAPI_BASE || 'https://api.stayingapi.com/v1';

export const stayingApiConfigured = () => !!process.env.STAYINGAPI_KEY;

// Fetch a listing and normalize to PanHost's property shape.
export async function fetchListingViaStayingApi(platform, id) {
  const key = process.env.STAYINGAPI_KEY;
  if (!key) {
    const err = new Error('StayingAPI is not configured. Get a free key at stayingapi.com and set STAYINGAPI_KEY.');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  const { data } = await axios.get(`${BASE}/listing/${platform}/${id}`, {
    headers: { Authorization: `Bearer ${key}` },
    timeout: 20000,
  });
  const d = data?.data || data || {};
  const loc = d.location || {};
  const photos = Array.isArray(d.images) ? d.images.filter(Boolean) : [];
  const amenities = Array.isArray(d.amenities)
    ? d.amenities.map((a) => (typeof a === 'string' ? a : a?.name)).filter(Boolean)
    : [];
  return {
    listing_id: String(id),
    title: d.name || '',
    photos,
    amenities,
    bedrooms: d.bedrooms ?? undefined,
    bathrooms: d.bathrooms ?? undefined,
    max_guests: d.maxOccupancy ?? d.guests ?? undefined,
    city: loc.city || undefined,
    address: loc.address || undefined,
    description: d.description || d.summary || '',
    rating: d.guestRating ?? undefined,
    review_count: d.reviewCount ?? undefined,
    lat: loc.lat ?? undefined,
    lng: loc.lng ?? undefined,
    source: 'stayingapi',
  };
}

// Search comparable listings near a location (city / region / address).
export async function searchMarket({ location, checkIn, checkOut, adults, limit }) {
  const key = process.env.STAYINGAPI_KEY;
  if (!key) {
    const err = new Error('StayingAPI is not configured. Get a free key at stayingapi.com and set STAYINGAPI_KEY.');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  const { data } = await axios.get(`${BASE}/search`, {
    headers: { Authorization: `Bearer ${key}` },
    params: {
      location,
      checkIn: checkIn || undefined,
      checkOut: checkOut || undefined,
      adults: adults || undefined,
      limit: Math.min(40, limit || 30),
      sort: 'recommended',
    },
    timeout: 25000,
  });
  const rows = data?.data || [];
  return rows.map((r) => {
    const loc = r.location || {};
    const price = r.price || {};
    return {
      id: r.id,
      platform: r.platform,
      name: r.name,
      url: r.url,
      nightly: price.nightlyPrice ?? null,
      currency: price.currency || 'USD',
      bedrooms: r.bedrooms ?? null,
      bathrooms: r.bathrooms ?? null,
      maxOccupancy: r.maxOccupancy ?? null,
      rating: r.guestRating ?? null,
      reviewCount: r.reviewCount ?? null,
      propertyType: r.propertyType || null,
      city: loc.city || null,
      address: loc.address || null,
      lat: loc.lat ?? null,
      lng: loc.lng ?? null,
      image: Array.isArray(r.images) ? r.images[0] : null,
    };
  });
}

// Day-by-day public availability for a listing over a date window.
export async function fetchAvailabilityViaStayingApi(platform, id, startDate, endDate) {
  const key = process.env.STAYINGAPI_KEY;
  if (!key) {
    const err = new Error('StayingAPI is not configured. Get a free key at stayingapi.com and set STAYINGAPI_KEY.');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  const { data } = await axios.get(`${BASE}/availability`, {
    headers: { Authorization: `Bearer ${key}` },
    params: { platform, id, start_date: startDate, end_date: endDate },
    timeout: 20000,
  });
  const rows = data?.data || data || [];
  // Normalize to [{ date, available }]
  return (Array.isArray(rows) ? rows : rows.days || []).map((r) => ({
    date: r.date || r.day,
    available: r.available ?? r.isAvailable ?? !r.booked,
    price: r.price ?? r.rate ?? null,
    minStay: r.minStay ?? r.min_nights ?? null,
  }));
}
