// Data layer. Everything is kept in this browser's localStorage, on the device
// only — nothing is ever sent to a server.

import { isDateKey, toAgorot, monthOf, daysInMonth, todayKey, pad2 } from './format.js';

const TX_KEY = 'expenses.transactions';
const META_KEY = 'expenses.meta';
const PLANS_KEY = 'expenses.plans'; // installment plans (added in version 1.1)
const BACKUP_APP_ID = 'expenses-pwa';
const BACKUP_FORMAT = 1;

export const MAX_AMOUNT = 100_000_000; // ₪100 million — a sanity limit, not a business rule
export const NOTE_MAX = 140;
export const MAX_PAYMENTS = 120;

let transactions = [];
let plans = [];
let combined = null; // transactions + installment payments, built on demand
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
  plans = readList(PLANS_KEY).map(normalizePlan).filter(Boolean);
  combined = null;
  try {
    const parsedMeta = JSON.parse(readKey(META_KEY) || '{}');
    meta = parsedMeta && typeof parsedMeta === 'object' ? parsedMeta : {};
  } catch {
    meta = {};
  }
}

function readList(key) {
  const raw = readKey(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    try { localStorage.setItem(`${key}.unreadable-${Date.now()}`, raw); } catch { /* ignore */ }
    return [];
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
  combined = null;
  emit(change);
}

function commitPlans(next, change) {
  try {
    localStorage.setItem(PLANS_KEY, JSON.stringify(next));
  } catch (err) {
    console.error('Saving failed', err);
    throw new StorageError("Couldn't save. Your device storage may be full.");
  }
  plans = next;
  combined = null;
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
  if (event.key === TX_KEY || event.key === PLANS_KEY || event.key === null) {
    load();
    emit({ type: 'external' });
  }
});

// ---------- Reading ----------

/** Everything that counts as money in or out: transactions plus every installment payment. */
export function getAll() {
  if (!combined) combined = sortTransactions([...transactions, ...plans.flatMap(planPayments)]);
  return combined;
}

/** Only the transactions you entered yourself (installment payments are worked out from plans). */
export const getTransactions = () => transactions;
export const getById = (id) => transactions.find((t) => t.id === id) || null;
export const getPlans = () => plans;
export const getPlan = (id) => plans.find((p) => p.id === id) || null;

/** True for an installment payment whose date hasn't come yet (not paid, so not in the balance). */
export const isUpcomingPayment = (t, today = todayKey()) => Boolean(t.planId) && t.date > today;

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

// ---------- Installment plans ----------

export function addPlan(input) {
  const now = Date.now();
  const plan = normalizePlan({ ...input, id: newId(), createdAt: now, updatedAt: now });
  if (!plan) throw new Error('Invalid installment plan');
  commitPlans([...plans, plan], { type: 'plan-add', plan });
  return plan;
}

export function updatePlan(id, patch) {
  const existing = getPlan(id);
  if (!existing) throw new Error('Plan not found');
  const plan = normalizePlan({ ...existing, ...patch, id, createdAt: existing.createdAt, updatedAt: Date.now() });
  if (!plan) throw new Error('Invalid installment plan');
  commitPlans(plans.map((p) => (p.id === id ? plan : p)), { type: 'plan-update', plan });
  return plan;
}

export function deletePlan(id) {
  const plan = getPlan(id);
  if (!plan) return null;
  commitPlans(plans.filter((p) => p.id !== id), { type: 'plan-delete', plan });
  return plan;
}

export function restorePlan(plan) {
  if (getPlan(plan.id)) return;
  commitPlans([...plans, plan], { type: 'plan-restore', plan });
}

/** The date of payment number `index` (0-based): same day each month, or the month's last day. */
export function paymentDate(firstDate, index) {
  const [y, m, d] = firstDate.split('-').map(Number);
  const target = new Date(y, m - 1 + index, 1);
  const monthKey = `${target.getFullYear()}-${pad2(target.getMonth() + 1)}`;
  return `${monthKey}-${pad2(Math.min(d, daysInMonth(monthKey)))}`;
}

/** Payment amounts in agorot. Any leftover agorot go on the first payment, like a card company does. */
export function splitPayments(total, count) {
  const totalAgorot = toAgorot(total);
  const base = Math.floor(totalAgorot / count);
  return Array.from({ length: count }, (_, i) => (i === 0 ? base + (totalAgorot - base * count) : base));
}

/** The monthly payments of a plan, shaped like expenses so they count in their own months. */
export function planPayments(plan) {
  return splitPayments(plan.total, plan.count).map((agorot, i) => ({
    id: `${plan.id}:${i + 1}`,
    type: 'expense',
    amount: agorot / 100,
    method: plan.method,
    note: plan.note,
    date: paymentDate(plan.firstDate, i),
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    planId: plan.id,
    payment: i + 1,
    payments: plan.count,
  }));
}

/** Where a plan stands today (amounts in agorot). */
export function planStatus(plan, today = todayKey()) {
  const payments = planPayments(plan);
  const upcoming = payments.filter((p) => p.date > today);
  return {
    plan,
    payments,
    monthly: toAgorot(payments[payments.length - 1].amount),
    first: toAgorot(payments[0].amount),
    paidCount: payments.length - upcoming.length,
    leftCount: upcoming.length,
    leftAmount: upcoming.reduce((sum, p) => sum + toAgorot(p.amount), 0),
    nextDate: upcoming.length ? upcoming[0].date : null,
    lastDate: payments[payments.length - 1].date,
  };
}

/** Totals across all plans: what is still owed, and what falls due this month and next. */
export function installmentOverview(today = todayKey()) {
  const thisMonth = monthOf(today);
  const [y, m] = thisMonth.split('-').map(Number);
  const next = new Date(y, m, 1);
  const nextMonth = `${next.getFullYear()}-${pad2(next.getMonth() + 1)}`;
  const statuses = plans.map((p) => planStatus(p, today));
  const sumIn = (month) => statuses.reduce((sum, s) => sum + s.payments
    .filter((p) => monthOf(p.date) === month)
    .reduce((a, p) => a + toAgorot(p.amount), 0), 0);
  return {
    owed: statuses.reduce((sum, s) => sum + s.leftAmount, 0),
    thisMonth,
    nextMonth,
    dueThisMonth: sumIn(thisMonth),
    dueNextMonth: sumIn(nextMonth),
    active: statuses.filter((s) => s.leftCount > 0).sort((a, b) => (a.nextDate < b.nextDate ? -1 : 1)),
    finished: statuses.filter((s) => s.leftCount === 0).sort((a, b) => (a.lastDate < b.lastDate ? 1 : -1)),
  };
}

export function normalizePlan(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const method = raw.method === 'cash' || raw.method === 'card' ? raw.method : null;
  const total = typeof raw.total === 'string' ? Number(raw.total) : raw.total;
  const count = typeof raw.count === 'string' ? Number(raw.count) : raw.count;
  if (!method || typeof total !== 'number' || !Number.isFinite(total)) return null;
  if (!Number.isInteger(count) || count < 2 || count > MAX_PAYMENTS) return null;
  const rounded = Math.round(total * 100) / 100;
  if (rounded <= 0 || rounded > MAX_AMOUNT || toAgorot(rounded) < count) return null;
  if (!isDateKey(raw.firstDate)) return null;
  const note = typeof raw.note === 'string' ? raw.note.replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX) : '';
  const id = typeof raw.id === 'string' && raw.id.trim() && raw.id.length <= 64 && !raw.id.includes(':') ? raw.id : newId();
  const createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now();
  const updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt;
  return { id, total: rounded, count, firstDate: raw.firstDate, method, note, createdAt, updatedAt };
}

// ---------- Everything at once (delete all, import, undo) ----------

export const snapshot = () => ({ transactions: [...transactions], plans: [...plans] });

/** Replaces all saved data; if the second write fails, the first is put back. */
export function restoreSnapshot(data) {
  const previous = snapshot();
  commit(sortTransactions([...data.transactions]), { type: 'replace' });
  try {
    commitPlans([...data.plans], { type: 'replace' });
  } catch (err) {
    commit(previous.transactions, { type: 'replace' });
    throw err;
  }
}

/** Adds plans from a backup; for the same plan, the newer edit wins. */
export function mergePlans(list) {
  const byId = new Map(plans.map((p) => [p.id, p]));
  let added = 0;
  let updated = 0;
  for (const plan of list) {
    const current = byId.get(plan.id);
    if (!current) {
      byId.set(plan.id, plan);
      added += 1;
    } else if (plan.updatedAt > current.updatedAt) {
      byId.set(plan.id, plan);
      updated += 1;
    }
  }
  if (added || updated) commitPlans([...byId.values()], { type: 'merge' });
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
    plans,
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
  const rawPlans = data && !Array.isArray(data) && Array.isArray(data.plans) ? data.plans : [];
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
  const validPlans = [];
  const seenPlans = new Set();
  for (const raw of rawPlans) {
    const plan = normalizePlan(raw);
    if (!plan || seenPlans.has(plan.id)) {
      skipped += 1;
      continue;
    }
    seenPlans.add(plan.id);
    validPlans.push(plan);
  }
  if (!valid.length && !validPlans.length) {
    throw new BackupError(list.length || rawPlans.length ? "Nothing in this file could be read." : 'This backup is empty.');
  }
  return {
    transactions: valid,
    plans: validPlans,
    hasPlans: Boolean(data && !Array.isArray(data) && Array.isArray(data.plans)),
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
