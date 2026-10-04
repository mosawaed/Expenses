// Data layer. Everything is kept in this browser's localStorage, on the device
// only — nothing is ever sent to a server.

import { isDateKey, toAgorot, monthOf, daysInMonth, todayKey, pad2 } from './format.js';

const TX_KEY = 'expenses.transactions';
const META_KEY = 'expenses.meta';
const PLANS_KEY = 'expenses.plans'; // installment plans (added in version 1.1)
const CATEGORIES_KEY = 'expenses.categories'; // only written once you change a category (version 1.2)
const BACKUP_APP_ID = 'expenses-pwa';
const BACKUP_FORMAT = 1;

export const MAX_AMOUNT = 100_000_000; // ₪100 million — a sanity limit, not a business rule
export const NOTE_MAX = 140;
export const MAX_PAYMENTS = 120;

let transactions = [];
let plans = [];
let storedCategories = null; // null = the built-in defaults
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
  storedCategories = readKey(CATEGORIES_KEY) === null ? null : readList(CATEGORIES_KEY).map(normalizeCategory).filter(Boolean);
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
  if (event.key === TX_KEY || event.key === PLANS_KEY || event.key === CATEGORIES_KEY || event.key === null) {
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

// ---------- Categories ----------

export const OTHER = 'other';
export const CATEGORY_COLORS = ['orange', 'blue', 'aqua', 'yellow', 'magenta', 'green', 'violet', 'red', 'gray'];
export const CATEGORY_ICONS = ['food', 'study', 'impulse', 'essentials', 'other', 'car', 'bus', 'home', 'health', 'coffee', 'gift', 'shirt', 'plane', 'game', 'film', 'pet', 'phone', 'bolt'];
export const CATEGORY_NAME_MAX = 24;

const DEFAULT_CATEGORIES = [
  { id: 'food', name: 'Food', color: 'orange', icon: 'food' },
  { id: 'study', name: 'Study', color: 'blue', icon: 'study' },
  { id: 'impulse', name: 'Impulse buys', color: 'magenta', icon: 'impulse' },
  { id: 'essentials', name: 'Essentials', color: 'aqua', icon: 'essentials' },
  { id: OTHER, name: 'Other', color: 'gray', icon: 'other' },
].map((c) => ({ ...c, createdAt: 0, updatedAt: 0 }));

/** Your categories, in order. "Other" always exists: it catches anything without a category. */
export function getCategories() {
  const list = storedCategories || DEFAULT_CATEGORIES;
  return list.some((c) => c.id === OTHER) ? list : [...list, DEFAULT_CATEGORIES[DEFAULT_CATEGORIES.length - 1]];
}

export function getCategory(id) {
  const list = getCategories();
  return list.find((c) => c.id === id) || list.find((c) => c.id === OTHER);
}

/** The category an expense counts under: unknown or missing categories count as Other. */
export function categoryOf(t) {
  return getCategory(t.category);
}

function commitCategories(next, change) {
  try {
    localStorage.setItem(CATEGORIES_KEY, JSON.stringify(next));
  } catch (err) {
    console.error('Saving failed', err);
    throw new StorageError("Couldn't save. Your device storage may be full.");
  }
  storedCategories = next;
  combined = null;
  emit(change);
}

export function addCategory(input) {
  const now = Date.now();
  const category = normalizeCategory({ ...input, id: newId(), createdAt: now, updatedAt: now });
  if (!category) throw new Error('Invalid category');
  const list = getCategories();
  const otherIndex = list.findIndex((c) => c.id === OTHER);
  commitCategories([...list.slice(0, otherIndex), category, ...list.slice(otherIndex)], { type: 'category-add', category });
  return category;
}

export function updateCategory(id, patch) {
  const existing = getCategories().find((c) => c.id === id);
  if (!existing) throw new Error('Category not found');
  const category = normalizeCategory({ ...existing, ...patch, id, createdAt: existing.createdAt, updatedAt: Date.now() });
  if (!category) throw new Error('Invalid category');
  commitCategories(getCategories().map((c) => (c.id === id ? category : c)), { type: 'category-update', category });
  return category;
}

/** Removes a category. Its expenses keep their link and simply count as Other, so Undo restores everything. */
export function deleteCategory(id) {
  const list = getCategories();
  const index = list.findIndex((c) => c.id === id);
  if (index < 0 || id === OTHER) return null;
  commitCategories(list.filter((c) => c.id !== id), { type: 'category-delete' });
  return { category: list[index], index };
}

export function restoreCategory({ category, index }) {
  const list = getCategories();
  if (list.some((c) => c.id === category.id)) return;
  commitCategories([...list.slice(0, index), category, ...list.slice(index)], { type: 'category-restore' });
}

export function isCategoryNameTaken(name, exceptId = null) {
  const key = name.trim().toLowerCase();
  return getCategories().some((c) => c.id !== exceptId && c.name.toLowerCase() === key);
}

export function normalizeCategory(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' && raw.id.trim() && raw.id.length <= 64 ? raw.id : null;
  const name = typeof raw.name === 'string' ? raw.name.replace(/\s+/g, ' ').trim().slice(0, CATEGORY_NAME_MAX) : '';
  if (!id || !name) return null;
  const color = CATEGORY_COLORS.includes(raw.color) ? raw.color : 'gray';
  const icon = CATEGORY_ICONS.includes(raw.icon) ? raw.icon : 'other';
  const createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : 0;
  const updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt;
  return { id, name, color, icon, createdAt, updatedAt };
}

/** Adds categories from a backup; for the same category, the newer edit wins. */
export function mergeCategories(list) {
  const current = getCategories();
  const byId = new Map(current.map((c) => [c.id, c]));
  let changed = 0;
  for (const category of list) {
    const existing = byId.get(category.id);
    if (!existing || category.updatedAt > existing.updatedAt) {
      byId.set(category.id, category);
      changed += 1;
    }
  }
  if (!changed) return 0;
  const order = [...current.map((c) => c.id), ...list.map((c) => c.id).filter((id) => !current.some((c) => c.id === id))];
  const merged = order.map((id) => byId.get(id));
  // Keep "Other" last.
  commitCategories([...merged.filter((c) => c.id !== OTHER), ...merged.filter((c) => c.id === OTHER)], { type: 'merge' });
  return changed;
}

/** Spending per category, biggest first (amounts in agorot). */
export function categoryBreakdown(list) {
  const totals = new Map();
  for (const t of list) {
    if (t.type !== 'expense') continue;
    const category = categoryOf(t);
    const row = totals.get(category.id) || { category, amount: 0, count: 0 };
    row.amount += toAgorot(t.amount);
    row.count += 1;
    totals.set(category.id, row);
  }
  return [...totals.values()].sort((a, b) => b.amount - a.amount);
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
    ...(plan.category ? { category: plan.category } : {}),
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
  const plan = { id, total: rounded, count, firstDate: raw.firstDate, method, note, createdAt, updatedAt };
  if (validCategoryId(raw.category)) plan.category = raw.category;
  return plan;
}

// ---------- Everything at once (delete all, import, undo) ----------

export const snapshot = () => ({ transactions: [...transactions], plans: [...plans], categories: [...getCategories()] });

/** Replaces all saved data; if the second write fails, the first is put back. */
export function restoreSnapshot(data) {
  const previous = snapshot();
  commit(sortTransactions([...data.transactions]), { type: 'replace' });
  try {
    commitPlans([...data.plans], { type: 'replace' });
    if (data.categories) commitCategories([...data.categories], { type: 'replace' });
  } catch (err) {
    commit(previous.transactions, { type: 'replace' });
    try { commitPlans(previous.plans, { type: 'replace' }); } catch { /* already reported */ }
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
  const tx = { id, type, amount: rounded, method, note, date: raw.date, createdAt, updatedAt };
  // Only expenses have a category; older transactions simply have none and count as Other.
  if (type === 'expense' && validCategoryId(raw.category)) tx.category = raw.category;
  return tx;
}

function validCategoryId(value) {
  return typeof value === 'string' && value.trim() !== '' && value.length <= 64;
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
    categories: getCategories(),
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
  const hasCategories = Boolean(data && !Array.isArray(data) && Array.isArray(data.categories));
  const categories = hasCategories ? data.categories.map(normalizeCategory).filter(Boolean) : [];
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
    categories,
    hasCategories: hasCategories && categories.length > 0,
    skipped,
    exportedAt: data && typeof data.exportedAt === 'string' ? data.exportedAt : null,
  };
}

// ---------- Calculations (all results in agorot) ----------

export function filterTransactions(list, { month = 'all', method = 'all', type = 'all', category = 'all' } = {}) {
  return list.filter((t) =>
    (month === 'all' || monthOf(t.date) === month) &&
    (method === 'all' || t.method === method) &&
    (type === 'all' || t.type === type) &&
    (category === 'all' || (t.type === 'expense' && categoryOf(t).id === category)));
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
