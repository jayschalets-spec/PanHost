// Official OTA partner-API integration layer.
//
// IMPORTANT: Airbnb and VRBO/Expedia only grant API access to APPROVED software
// partners (a business application + approval process). This module is the
// ready-to-activate client: it reads partner credentials from environment
// variables and, when present, performs the real OAuth + API calls. When they
// are absent, it reports "not configured" so the UI can guide the user to apply.
// The always-available integration path is iCal (see ical.js / /api/sync/ical).
import axios from 'axios';

export const INTEGRATIONS = {
  airbnb: {
    label: 'Airbnb',
    program: 'Airbnb Partner API (Preferred/Software Partner)',
    applyUrl: 'https://www.airbnb.com/partner',
    env: ['AIRBNB_CLIENT_ID', 'AIRBNB_CLIENT_SECRET'],
    tokenUrl: 'https://api.airbnb.com/v2/oauth2/token',
    reservationsUrl: 'https://api.airbnb.com/v2/reservations',
  },
  vrbo: {
    label: 'VRBO / Expedia',
    program: 'Expedia Group / Vrbo Connectivity Partner',
    applyUrl: 'https://partner.expediagroup.com/',
    env: ['VRBO_CLIENT_ID', 'VRBO_CLIENT_SECRET'],
    tokenUrl: 'https://api.expediapartnercentral.com/authentication/v1/token',
    reservationsUrl: 'https://api.expediapartnercentral.com/v1/reservations',
  },
  booking: {
    label: 'Booking.com',
    program: 'Booking.com Connectivity Partner',
    applyUrl: 'https://connect.booking.com/',
    env: ['BOOKING_CLIENT_ID', 'BOOKING_CLIENT_SECRET'],
    tokenUrl: 'https://connect.booking.com/oauth/token',
    reservationsUrl: 'https://connect.booking.com/v1/reservations',
  },
};

export function integrationStatus() {
  return Object.entries(INTEGRATIONS).map(([key, cfg]) => {
    const configured = cfg.env.every((v) => !!process.env[v]);
    return {
      platform: key,
      label: cfg.label,
      program: cfg.program,
      applyUrl: cfg.applyUrl,
      method: configured ? 'official-api' : 'ical',
      configured,
    };
  });
}

async function getToken(cfg) {
  const [idVar, secretVar] = cfg.env;
  const { data } = await axios.post(
    cfg.tokenUrl,
    { grant_type: 'client_credentials' },
    {
      auth: { username: process.env[idVar], password: process.env[secretVar] },
      timeout: 15000,
    }
  );
  return data.access_token;
}

// Fetch reservations via the official API (only when the partner creds exist).
export async function fetchReservationsViaApi(platform) {
  const cfg = INTEGRATIONS[platform];
  if (!cfg) throw new Error(`Unknown platform: ${platform}`);
  const configured = cfg.env.every((v) => !!process.env[v]);
  if (!configured) {
    const err = new Error(
      `${cfg.label} official API is not configured. Apply for partner access at ${cfg.applyUrl}, then set ${cfg.env.join(' and ')}.`
    );
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  const token = await getToken(cfg);
  const { data } = await axios.get(cfg.reservationsUrl, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 20000,
  });
  // Normalize to our booking shape.
  const list = Array.isArray(data) ? data : data.reservations || data.data || [];
  return list.map((r) => ({
    external_id: r.id || r.reservationId || r.confirmationCode,
    guest_name: r.guestName || r.guest?.name || 'Guest',
    guest_email: r.guestEmail || r.guest?.email || null,
    check_in: r.checkIn || r.arrival || r.startDate,
    check_out: r.checkOut || r.departure || r.endDate,
    guests: r.numberOfGuests || r.guests || 1,
    total_amount: r.total || r.totalPrice || 0,
  }));
}
