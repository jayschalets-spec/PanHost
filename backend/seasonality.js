// Free, data-less seasonality model for a Canadian ski + lake resort town.
// Combines a month curve (winter ski peak + summer lake peak) with Canadian
// statutory holidays and long weekends. No external API — pure calendar math.

function nthMonday(year, month, n) {
  // month: 0-indexed. Returns the date of the nth Monday.
  const first = new Date(year, month, 1);
  const offset = (8 - first.getDay()) % 7; // days until first Monday
  return new Date(year, month, 1 + offset + (n - 1) * 7);
}

function mondayBefore(year, month, day) {
  const d = new Date(year, month, day);
  // Days since the last Monday; when the date IS a Monday we still want the
  // *preceding* one (Victoria Day is the Monday before May 25, so if May 25 is
  // itself a Monday the holiday is May 18 — not May 25).
  const back = (d.getDay() + 6) % 7 || 7;
  return new Date(year, month, day - back);
}

function easterSunday(year) {
  // Anonymous Gregorian computus.
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=March, 4=April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// Canadian statutory holidays (ON) for a year → Map iso -> name.
export function canadianHolidays(year) {
  const map = new Map();
  const add = (d, name) => map.set(iso(d), name);
  add(new Date(year, 0, 1), "New Year's Day");
  add(nthMonday(year, 1, 3), 'Family Day'); // 3rd Mon Feb (ON)
  const easter = easterSunday(year);
  add(addDays(easter, -2), 'Good Friday');
  add(addDays(easter, 1), 'Easter Monday');
  add(mondayBefore(year, 4, 25), 'Victoria Day'); // Mon before May 25
  add(new Date(year, 6, 1), 'Canada Day');
  add(nthMonday(year, 7, 1), 'Civic Holiday'); // 1st Mon Aug
  add(nthMonday(year, 8, 1), 'Labour Day'); // 1st Mon Sep
  add(new Date(year, 8, 30), 'Truth & Reconciliation');
  add(nthMonday(year, 9, 2), 'Thanksgiving'); // 2nd Mon Oct
  add(new Date(year, 10, 11), 'Remembrance Day');
  add(new Date(year, 11, 25), 'Christmas Day');
  add(new Date(year, 11, 26), 'Boxing Day');
  return map;
}

// Resort month curve (% uplift/discount vs base): winter ski + summer lake peaks.
const MONTH_PCT = [18, 24, 14, -8, 2, 12, 26, 26, 6, -4, -12, 20];
//                 Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec

const CAP = 45; // max combined seasonal uplift %

// Returns { pct, labels[] } for a given Date, combining month + holiday/long-weekend.
export function seasonalityFactor(dt) {
  const labels = [];
  let pct = MONTH_PCT[dt.getMonth()];
  if (pct >= 12) labels.push(dt.getMonth() >= 5 && dt.getMonth() <= 8 ? 'Summer peak' : 'Winter/ski peak');

  const holidays = canadianHolidays(dt.getFullYear());
  const key = iso(dt);
  const dow = dt.getDay();

  // Holiday itself, or a long-weekend day adjacent to a Monday/Friday holiday.
  let holidayName = holidays.get(key);
  let longWeekend = false;
  if (!holidayName) {
    // Sat/Sun before a Monday holiday, or Sat/Sun after a Friday holiday.
    if (dow === 6 && holidays.has(iso(addDays(dt, 2)))) { longWeekend = true; holidayName = holidays.get(iso(addDays(dt, 2))); }
    else if (dow === 0 && holidays.has(iso(addDays(dt, 1)))) { longWeekend = true; holidayName = holidays.get(iso(addDays(dt, 1))); }
    else if (dow === 6 && holidays.has(iso(addDays(dt, -1)))) { longWeekend = true; holidayName = holidays.get(iso(addDays(dt, -1))); }
    else if (dow === 0 && holidays.has(iso(addDays(dt, -2)))) { longWeekend = true; holidayName = holidays.get(iso(addDays(dt, -2))); }
  }
  if (holidayName) {
    pct += longWeekend ? 15 : 22;
    labels.push(longWeekend ? `${holidayName} long weekend` : holidayName);
  }

  pct = Math.max(-CAP, Math.min(CAP, Math.round(pct)));
  return { pct, labels };
}
