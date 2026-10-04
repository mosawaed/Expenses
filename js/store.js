// Data layer. Everything is kept in this browser's localStorage, on the device
// only — nothing is ever sent to a server.

import { isDateKey, toAgorot, monthOf, daysInMonth } from './format.js';

const TX_KEY = 'expenses.transactions';
const META_KEY = 'expenses.meta';
const BACKUP_APP_ID = 'expenses-pwa';
const BACKUP_FORMAT = 1;

export const MAX_AMOUNT = 100_000_000; // ₪100 million — a sanity limit, not a business rule
export const NOTE_MAX = 140;

let transactions = [];
let meta = {};
const listeners = new Set();

export class StorageError extends Error {}
export class BackupError extends Error {}

// ---------- Loading & saving ----------

export function load() {
  const raw = readKey(TX_KEY);
  let list = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      list = Array.isArray(parsed) ? parsed : [];
    } catch {
      // Never silently overwrite unreadable data: keep a copy aside first.
      try { localStorage.setItem(`${TX_KEY}.unreadable-${Date.now()}`, raw); } catch { /* ignore */ }
    }
  }
  transactions = sortTransactions(list.map(normalizeTransaction).filter(Boolean));
  try {
    const parsedMeta = JSON.parse(readKey(META_KEY) || '{}');
    meta = parsedMeta && typeof parsedMeta === 'object' ? parsedMeta : {};
  } catch {
    meta = {};
  }
}

function readKey(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function commit(next, change) {
  try {
    localStorage.setItem(TX_KEY, JSON.stringify(next));
  } catch (err) {
    console.error('Saving failed', err);
    throw new StorageError("Couldn't save. Your device storage may be full.");
  }
  transactions = next;
  emit(change);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(change) {
  for (const fn of listeners) fn(change);
}

// Keep several open tabs (e.g. on a computer) in sync.
window.addEventListener('storage', (event) => {
  if (event.key === TX_KEY || event.key === null) {
    load();
    emit({ type: 'external' });
  }
});

// ---------- Reading ----------

export const getAll = () => transactions;
export const getById = (id) => transactions.find((t) => t.id === id) || null;

export function getMeta() {
  return meta;
}

export function setMeta(patch) {
  meta = { ...meta, ...patch };
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    /* non-critical */
  }
}

// ---------- Writing ----------

export function addTransaction(input) {
  const now = Date.now();
  const tx = normalizeTransaction({ ...input, id: newId(), createdAt: now, updatedAt: now });
  if (!tx) throw new Error('Invalid transaction');
  commit(sortTransactions([tx, ...transactions]), { type: 'add', tx });
  return tx;
}

export function updateTransaction(id, patch) {
  const existing = getById(id);
  if (!existing) throw new Error('Transaction not found');
  const tx = normalizeTransaction({ ...existing, ...patch, id, createdAt: existing.createdAt, updatedAt: Date.now() });
  if (!tx) throw new Error('Invalid transaction');
  commit(sortTransactions(transactions.map((t) => (t.id === id ? tx : t))), { type: 'update', tx });
  return tx;
}

export function deleteTransaction(id) {
  const tx = getById(id);
  if (!tx) return null;
  commit(transactions.filter((t) => t.id !== id), { type: 'delete', tx });
  return tx;
}

/** Puts back transactions removed earlier (used by "Undo"). */
export function restoreTransactions(list) {
  const ids = new Set(transactions.map((t) => t.id));
  commit(sortTransactions([...transactions, ...list.filter((t) => !ids.has(t.id))]), { type: 'restore' });
}

export function replaceAll(list) {
  commit(sortTransactions([...list]), { type: 'replace' });
}

/** Adds transactions from a backup; for the same transaction, the newer edit wins. */
export function mergeTransactions(list) {
  const byId = new Map(transactions.map((t) => [t.id, t]));
  let added = 0;
  let updated = 0;
  for (const tx of list) {
    const current = byId.get(tx.id);
    if (!current) {
      byId.set(tx.id, tx);
      added += 1;
    } else if (tx.updatedAt > current.updatedAt) {
      byId.set(tx.id, tx);
      updated += 1;
    }
  }
  commit(sortTransactions([...byId.values()]), { type: 'merge' });
  return { added, updated };
}

// ---------- Validation ----------

export function normalizeTransaction(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = raw.type === 'income' || raw.type === 'expense' ? raw.type : null;
  const method = raw.method === 'cash' || raw.method === 'card' ? raw.method : null;
  const amount = typeof raw.amount === 'string' ? Number(raw.amount) : raw.amount;
  if (!type || !method || typeof amount !== 'number' || !Number.isFinite(amount)) return null;
  const rounded = Math.round(amount * 100) / 100;
  if (rounded <= 0 || rounded > MAX_AMOUNT) return null;
  if (!isDateKey(raw.date)) return null;
  const note = typeof raw.note === 'string' ? raw.note.replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX) : '';
  const id = typeof raw.id === 'string' && raw.id.trim() && raw.id.length <= 64 ? raw.id : newId();
  const createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now();
  const updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt;
  return { id, type, amount: rounded, method, note, date: raw.date, createdAt, updatedAt };
}

function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Newest date first; same day → most recently added first. */
function sortTransactions(list) {
  return list.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return b.createdAt - a.createdAt;
  });
}

// ---------- Backup ----------

export function buildBackup() {
  return {
    app: BACKUP_APP_ID,
    format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    currency: 'ILS',
    count: transactions.length,
    transactions,
  };
}

export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupError("This file isn't an Expenses backup. Choose the .json file you exported.");
  }
  const list = Array.isArray(data) ? data : data && Array.isArray(data.transactions) ? data.transactions : null;
  if (!list) throw new BackupError("This file doesn't contain any transactions.");
  const seen = new Set();
  const valid = [];
  let skipped = 0;
  for (const raw of list) {
    const tx = normalizeTransaction(raw);
    if (!tx || seen.has(tx.id)) {
      skipped += 1;
      continue;
    }
    seen.add(tx.id);
    valid.push(tx);
  }
  if (!valid.length) {
    throw new BackupError(list.length ? "None of the transactions in this file could be read." : 'This backup is empty.');
  }
  return {
    transactions: valid,
    skipped,
    exportedAt: data && typeof data.exportedAt === 'string' ? data.exportedAt : null,
  };
}

// ---------- Calculations (all results in agorot) ----------

export function filterTransactions(list, { month = 'all', method = 'all', type = 'all' } = {}) {
  return list.filter((t) =>
    (month === 'all' || monthOf(t.date) === month) &&
    (method === 'all' || t.method === method) &&
    (type === 'all' || t.type === type));
}

export function summarize(list) {
  const sum = {
    income: 0,
    expense: 0,
    count: list.length,
    incomeCount: 0,
    expenseCount: 0,
    cash: { income: 0, expense: 0 },
    card: { income: 0, expense: 0 },
  };
  for (const t of list) {
    const value = toAgorot(t.amount);
    sum[t.type] += value;
    sum[`${t.type}Count`] += 1;
    sum[t.method][t.type] += value;
  }
  sum.net = sum.income - sum.expense;
  sum.cash.net = sum.cash.income - sum.cash.expense;
  sum.card.net = sum.card.income - sum.card.expense;
  return sum;
}

/** Map of "YYYY-MM" → { income, expense, count }. */
export function monthlyTotals(list) {
  const map = new Map();
  for (const t of list) {
    const key = monthOf(t.date);
    let month = map.get(key);
    if (!month) map.set(key, (month = { income: 0, expense: 0, count: 0 }));
    month[t.type] += toAgorot(t.amount);
    month.count += 1;
  }
  return map;
}

/** Spending per day of a month: index 0 is the 1st. */
export function dailyExpenses(list, monthKey) {
  const perDay = new Array(daysInMonth(monthKey)).fill(0);
  for (const t of list) {
    if (t.type === 'expense' && monthOf(t.date) === monthKey) {
      perDay[Number(t.date.slice(8, 10)) - 1] += toAgorot(t.amount);
    }
  }
  return perDay;
}

/** First and last month that have transactions, or null when empty. */
export function dataMonthBounds(list) {
  if (!list.length) return null;
  // The list is sorted newest first.
  return { first: monthOf(list[list.length - 1].date), last: monthOf(list[0].date) };
}

/** Recent distinct notes, for suggestions while typing. */
export function recentNotes(limit = 12) {
  const notes = [];
  const seen = new Set();
  for (const t of transactions) {
    const key = t.note.toLowerCase();
    if (t.note && !seen.has(key)) {
      seen.add(key);
      notes.push(t.note);
      if (notes.length >= limit) break;
    }
  }
  return notes;
}
