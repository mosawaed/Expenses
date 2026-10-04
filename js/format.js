// Money and date helpers.
// Amounts are summed as whole agorot (1 ₪ = 100 agorot) so totals never drift
// the way floating-point numbers do (0.1 + 0.2 !== 0.3).

const CURRENCY_LOCALE = 'en-IL';
const DATE_LOCALE = 'en-GB'; // day before month, as used in Israel
export const MINUS = '−';

const numberFormats = new Map();
function currencyFormat(fractionDigits, compact = false) {
  const key = `${fractionDigits}-${compact}`;
  if (!numberFormats.has(key)) {
    numberFormats.set(key, new Intl.NumberFormat(CURRENCY_LOCALE, {
      style: 'currency',
      currency: 'ILS',
      minimumFractionDigits: compact ? 0 : fractionDigits,
      maximumFractionDigits: fractionDigits,
      ...(compact ? { notation: 'compact' } : {}),
    }));
  }
  return numberFormats.get(key);
}

export const toAgorot = (amount) => Math.round(Number(amount) * 100);

/** "₪1,234.50", "₪1,234" (no .00), "−₪20" — set sign to get "+₪20" for positives. */
export function money(agorot, { sign = false, cents = 'auto' } = {}) {
  const abs = Math.abs(agorot);
  const showCents = cents === 'always' || (cents === 'auto' && abs % 100 !== 0);
  const text = currencyFormat(showCents ? 2 : 0).format(abs / 100);
  if (agorot < 0) return MINUS + text;
  if (sign && agorot > 0) return '+' + text;
  return text;
}

/** Splits an amount for display with a smaller currency symbol and decimals. */
export function moneyParts(agorot) {
  const abs = Math.abs(agorot);
  const parts = currencyFormat(2).formatToParts(abs / 100);
  let symbol = '₪';
  let whole = '';
  let fraction = '';
  for (const part of parts) {
    if (part.type === 'currency') symbol = part.value;
    else if (part.type === 'integer' || part.type === 'group') whole += part.value;
    else if (part.type === 'fraction') fraction = part.value;
  }
  return { negative: agorot < 0, symbol, whole, fraction };
}

/** Short labels for chart axes: "₪950", "₪2K", "₪12.5K", "₪1.3M". */
export function compactMoney(agorot) {
  const abs = Math.abs(agorot) / 100;
  const text = abs < 1000 ? currencyFormat(0).format(abs) : currencyFormat(1, true).format(abs);
  return (agorot < 0 ? MINUS : '') + text;
}

export function percent(value) {
  if (!Number.isFinite(value)) return '—';
  if (value > 0 && value < 0.01) return '<1%';
  return `${Math.round(value * 100)}%`;
}

/**
 * Reads what the user typed into the amount field. Accepts "12.5", "12,5"
 * (comma decimal keyboards), "1,234.50" and "₪ 40". Returns NaN when invalid.
 */
export function parseAmount(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : NaN;
  let text = String(input ?? '').trim().replace(/[\s ₪]/g, '');
  if (!text) return NaN;
  if (text.includes(',') && text.includes('.')) text = text.replace(/,/g, '');
  else if ((text.match(/,/g) || []).length === 1) text = text.replace(',', '.');
  else text = text.replace(/,/g, '');
  if (!/^\d*\.?\d*$/.test(text) || text === '.') return NaN;
  return Number(text);
}

// ---------- Dates ----------
// Dates are stored as "YYYY-MM-DD" in local time. Never use toISOString() for
// this: it converts to UTC and can shift the day by one.

export const pad2 = (n) => String(n).padStart(2, '0');
export const toDateKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const todayKey = () => toDateKey(new Date());

export function fromDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  return year >= 1900 && year <= 2200 && toDateKey(fromDateKey(value)) === value;
}

export function shiftDate(key, days) {
  const d = fromDateKey(key);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

export const monthOf = (dateKey) => dateKey.slice(0, 7);
export const currentMonth = () => monthOf(todayKey());

export function shiftMonth(monthKey, delta) {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

/** Inclusive list of month keys from `from` to `to`. */
export function monthRange(from, to) {
  const months = [];
  for (let key = from; key <= to && months.length < 1200; key = shiftMonth(key, 1)) months.push(key);
  return months;
}

export function daysInMonth(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

const dateFormats = new Map();
function dateFormat(options) {
  const key = JSON.stringify(options);
  if (!dateFormats.has(key)) dateFormats.set(key, new Intl.DateTimeFormat(DATE_LOCALE, options));
  return dateFormats.get(key);
}

const monthDate = (monthKey) => fromDateKey(`${monthKey}-01`);

/** style: "long" → "October 2026", "short" → "Oct", "shortYear" → "Oct 2026", "name" → "October" */
export function monthName(monthKey, style = 'long') {
  const date = monthDate(monthKey);
  switch (style) {
    case 'short': return dateFormat({ month: 'short' }).format(date);
    case 'shortYear': return dateFormat({ month: 'short', year: 'numeric' }).format(date);
    case 'name': return dateFormat({ month: 'long' }).format(date);
    default: return dateFormat({ month: 'long', year: 'numeric' }).format(date);
  }
}

/** "4 Oct", or "4 Oct 2025" when not in the current year. */
export function shortDate(dateKey) {
  const date = fromDateKey(dateKey);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return dateFormat(sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

/** Section headings in lists: "Today", "Yesterday", "Fri 2 Oct", "Fri 2 Oct 2025". */
export function dayHeading(dateKey) {
  const today = todayKey();
  if (dateKey === today) return 'Today';
  if (dateKey === shiftDate(today, -1)) return 'Yesterday';
  if (dateKey === shiftDate(today, 1)) return 'Tomorrow';
  const date = fromDateKey(dateKey);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return dateFormat(sameYear
    ? { weekday: 'short', day: 'numeric', month: 'short' }
    : { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

/** "Sunday 4 October" */
export function longDate(dateKey) {
  return dateFormat({ weekday: 'long', day: 'numeric', month: 'long' }).format(fromDateKey(dateKey));
}

/** "4 Oct 2026, 14:05" for backup timestamps. */
export function dateTime(isoOrMs) {
  const date = new Date(isoOrMs);
  if (Number.isNaN(date.getTime())) return '';
  return dateFormat({ day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

/** "just now", "3 days ago", … for the last-backup label. */
export function relativeTime(ms) {
  const diff = Date.now() - ms;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return 'just now';
  if (diff < hour) return plural(Math.floor(diff / minute), 'minute') + ' ago';
  if (diff < day) return plural(Math.floor(diff / hour), 'hour') + ' ago';
  if (diff < 30 * day) return plural(Math.floor(diff / day), 'day') + ' ago';
  return 'on ' + dateTime(ms).split(',')[0];
}

export function plural(count, word, pluralWord = `${word}s`) {
  return `${count.toLocaleString('en-US')} ${count === 1 ? word : pluralWord}`;
}
