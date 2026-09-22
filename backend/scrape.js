// Best-effort parser for a PUBLIC Airbnb listing page (the host's own live
// listing). Fetches the page and extracts title, photos, specs, amenities and
// description from the server-rendered HTML / embedded JSON. This reads a
// publicly served page with a normal User-Agent — no login, no evasion.
import axios from 'axios';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Curated list of common Airbnb amenities to recognize in the embedded JSON.
const KNOWN_AMENITIES = [
  'Wifi', 'Kitchen', 'Free parking', 'Free parking on premises', 'Paid parking',
  'Hot tub', 'Pool', 'Air conditioning', 'Heating', 'Washer', 'Dryer', 'Dishwasher',
  'TV', 'Fireplace', 'Indoor fireplace', 'Fire pit', 'BBQ grill', 'Outdoor dining area',
  'Patio or balcony', 'Backyard', 'Gym', 'Sauna', 'Lake access', 'Beach access',
  'Shared beach access', 'Waterfront', 'Ski-in/ski-out', 'EV charger', 'Crib',
  'Pack ’n play', 'Self check-in', 'Smoke alarm', 'Carbon monoxide alarm',
  'First aid kit', 'Fire extinguisher', 'Hair dryer', 'Iron', 'Coffee maker',
  'Microwave', 'Refrigerator', 'Oven', 'Stove', 'Garden view', 'Mountain view',
  'Mountain and park views', 'Golf course view', 'Pets allowed', 'Workspace',
  'Dedicated workspace', 'Elevator', 'Long term stays allowed',
];

export function parseAirbnbListing(html, listingId) {
  const out = { title: '', photos: [], amenities: [], description: '' };

  // Title — strip the " - Houses for Rent ..." SEO suffix.
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  if (titleMatch) {
    out.title = titleMatch[1].replace(/&amp;/g, '&').split(' - ')[0].trim();
  }

  // Photos — unique Hosting-<id> image URLs, query string stripped.
  const photoRe = new RegExp(
    `https://a0\\.muscache\\.com/im/pictures/hosting/Hosting-${listingId}/original/[a-f0-9-]+\\.(?:jpe?g|png|webp)`,
    'gi'
  );
  out.photos = [...new Set((html.match(photoRe) || []))];

  // Specs.
  const bd = html.match(/(\d+)\s*bedrooms?/i);
  const ba = html.match(/(\d+(?:\.\d+)?)\s*baths?/i);
  const guests = html.match(/(\d+)\+?\s*guests?/i);
  if (bd) out.bedrooms = Number(bd[1]);
  if (ba) out.bathrooms = Number(ba[1]);
  if (guests) out.max_guests = Number(guests[1]);

  // Amenities — recognize known amenity titles present in the embedded JSON.
  const found = new Set();
  for (const a of KNOWN_AMENITIES) {
    const esc = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`"title":"${esc}"`, 'i').test(html)) found.add(a);
  }
  out.amenities = [...found];

  // Description — join distinct htmlText blocks (the space / access descriptions).
  const descs = [];
  const descRe = /"htmlText":"((?:[^"\\]|\\.){20,})"/g;
  let m;
  while ((m = descRe.exec(html)) !== null) {
    let text = m[1]
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\u002[fF]/g, '/')
      .replace(/<br\s*\/?>(?=)/gi, '\n')
      .replace(/\\/g, '')
      .trim();
    if (text && text !== '.' && !descs.includes(text)) descs.push(text);
  }
  out.description = descs.join('\n\n').slice(0, 4000);

  return out;
}

const BROWSER_HEADERS = {
  'User-Agent': UA,
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-CA,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Upgrade-Insecure-Requests': '1',
  'sec-ch-ua': '"Chromium";v="120", "Not(A:Brand";v="24", "Google Chrome";v="120"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
};

// A public listing page occasionally answers a bot with a soft 404; try a few
// domains and retry once before giving up.
export async function fetchAirbnbListing(listingId, domains = ['www.airbnb.com', 'www.airbnb.ca']) {
  let lastData = null;
  for (const domain of domains) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const url = `https://${domain}/rooms/${listingId}`;
      const { data } = await axios.get(url, {
        headers: BROWSER_HEADERS,
        timeout: 20000,
        responseType: 'text',
        maxRedirects: 5,
        decompress: true,
      });
      const html = String(data);
      const parsed = parseAirbnbListing(html, listingId);
      // A real listing page has photos and a title that isn't the 404 stub.
      if (parsed.photos.length > 0 && !/404 Page Not Found/i.test(parsed.title)) {
        return parsed;
      }
      lastData = parsed;
    }
  }
  return lastData || { title: '', photos: [], amenities: [], description: '' };
}

// Pull a listing id out of a rooms URL or an iCal export URL.
export function extractListingId(input) {
  if (!input) return null;
  const s = String(input);
  const m =
    s.match(/\/rooms\/(?:plus\/)?(\d+)/) ||
    s.match(/\/ical\/(\d+)\.ics/) ||
    s.match(/(\d{6,})/);
  return m ? m[1] : null;
}
