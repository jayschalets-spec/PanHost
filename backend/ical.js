// Minimal, dependency-free iCalendar (RFC 5545) parser for booking feeds.
// Handles Airbnb / VRBO / Google calendar exports: line unfolding, VEVENT
// blocks, DATE and DATE-TIME values, and common properties.

function unfold(text) {
  // Folded lines are continued with a leading space or tab.
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

function parseICalDate(value) {
  // value like 20261005 (DATE) or 20261005T140000Z (DATE-TIME)
  const m = value.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return `${y}-${mo}-${d}`; // normalize to YYYY-MM-DD (checkout is exclusive in Airbnb feeds)
}

// Parse a property line into { name, params, value }.
function parseLine(line) {
  const idx = line.indexOf(':');
  if (idx === -1) return null;
  const left = line.slice(0, idx);
  const value = line.slice(idx + 1);
  const [name, ...paramParts] = left.split(';');
  const params = {};
  for (const p of paramParts) {
    const [k, v] = p.split('=');
    if (k) params[k.toUpperCase()] = v;
  }
  return { name: name.toUpperCase(), params, value };
}

export function parseICS(text) {
  const lines = unfold(text).split('\n');
  const events = [];
  let cur = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line === 'BEGIN:VEVENT') {
      cur = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (cur && cur.start && cur.end) events.push(cur);
      cur = null;
      continue;
    }
    if (!cur) continue;

    const parsed = parseLine(line);
    if (!parsed) continue;
    const { name, value } = parsed;
    switch (name) {
      case 'UID':
        cur.uid = value;
        break;
      case 'DTSTART':
        cur.start = parseICalDate(value);
        break;
      case 'DTEND':
        cur.end = parseICalDate(value);
        break;
      case 'SUMMARY':
        cur.summary = value.replace(/\\,/g, ',').replace(/\\n/gi, ' ').trim();
        break;
      case 'DESCRIPTION':
        cur.description = value.replace(/\\,/g, ',').replace(/\\n/gi, '\n').trim();
        break;
      default:
        break;
    }
  }
  return events;
}

// Airbnb marks unavailable-but-not-booked ranges with a summary like
// "Airbnb (Not available)". Treat only genuine reservations as bookings.
export function isRealReservation(event) {
  const s = (event.summary || '').toLowerCase();
  if (!s) return true;
  if (s.includes('not available') || s.includes('unavailable') || s.includes('blocked')) {
    return false;
  }
  return true;
}
