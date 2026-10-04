import * as store from './store.js';
import { h, icon, prefersReducedMotion } from './dom.js';
import {
  money, moneyParts, toAgorot, parseAmount, percent, plural, MINUS,
  todayKey, shiftDate, isDateKey, currentMonth, shiftMonth, monthName, monthRange,
  dayHeading, longDate, relativeTime, dateTime, shortDate,
} from './format.js';
import {
  openLayer, actionSheet, alertDialog, toast, segmented, haptic, isIOS,
  summonKeyboard, handOverKeyboard, onPresentationChange,
} from './ui.js';
import { attachSwipe } from './swipe.js';
import {
  createMonthlyBars, createSpendingLine, createMethodSplit, dailySpendingData, monthlySpendingData,
} from './charts.js';
import { APP_VERSION, BUILD } from './version.js';

const THEME_KEY = 'expenses.theme';
const UI_KEY = 'expenses.ui';
const PAGE_SIZE = 60;
const DAY = 24 * 60 * 60 * 1000;
const METHOD_LABEL = { cash: 'Cash', card: 'Card' };
const VIEWS = ['home', 'activity', 'insights', 'settings'];

const state = {
  view: 'home',
  filter: { month: currentMonth(), method: 'all' }, // shared by Activity and Insights
  homeMonth: currentMonth(),
  theme: readTheme(),
  dirty: new Set(VIEWS),
  activityLimit: PAGE_SIZE,
  flashId: null,
  lastNet: null,
  renderedDay: todayKey(),
  installPrompt: null,
  waitingWorker: null,
  sheetPresented: false,
  showFinishedPlans: false,
};

let ui = readUi();

// ---------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------

function init() {
  store.load();
  applyTheme(state.theme);
  setupTabs();
  setupScrollEffects();
  setupKeyboardInset();
  setupImport();
  document.getElementById('quick-add').addEventListener('click', () => openEditor());
  attachSwipe(document.getElementById('home-recent'), { onDelete: deleteWithUndo, onOpen: openFromRow });
  attachSwipe(document.getElementById('activity-list'), { onDelete: deleteWithUndo, onOpen: openFromRow });
  store.subscribe(() => {
    markDirty(...VIEWS);
    render();
  });
  onPresentationChange((presented) => {
    state.sheetPresented = presented;
    syncThemeColor();
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', syncThemeColor);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkDayChange();
  });
  // Lets :active styles work on iPhone.
  document.addEventListener('touchstart', () => {}, { passive: true });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.installPrompt = event;
    markDirty('home', 'settings');
    render();
  });

  render();
  registerServiceWorker();
  handleLaunchAction();
}

function handleLaunchAction() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('action') === 'add') {
    window.history.replaceState(null, '', window.location.pathname);
    openEditor();
  }
}

function checkDayChange() {
  const today = todayKey();
  if (today === state.renderedDay) return;
  // The app stayed open past midnight: refresh "Today" labels and month defaults.
  const previousMonth = state.renderedDay.slice(0, 7);
  state.renderedDay = today;
  if (state.homeMonth === previousMonth) state.homeMonth = currentMonth();
  if (state.filter.month === previousMonth) state.filter.month = currentMonth();
  markDirty(...VIEWS);
  render();
}

// ---------------------------------------------------------------------------
// Rendering & navigation
// ---------------------------------------------------------------------------

const renderers = {
  home: renderHome,
  activity: renderActivity,
  insights: renderInsights,
  settings: renderSettings,
};

function markDirty(...views) {
  views.forEach((v) => state.dirty.add(v));
}

function render() {
  if (!state.dirty.has(state.view)) return;
  state.dirty.delete(state.view);
  renderers[state.view]();
  state.flashId = null;
}

const viewEl = (name) => document.getElementById(`view-${name}`);

function setupTabs() {
  document.getElementById('tabbar-tabs').addEventListener('click', (event) => {
    const tab = event.target.closest('.tab');
    if (tab) switchView(tab.dataset.tab);
  });
  document.addEventListener('click', (event) => {
    const link = event.target.closest('[data-goto]');
    if (link) switchView(link.dataset.goto);
  });
}

function switchView(name) {
  if (!VIEWS.includes(name)) return;
  if (name === state.view) {
    // Like iOS: tapping the current tab scrolls back to the top.
    viewEl(name).scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    return;
  }
  viewEl(state.view).hidden = true;
  state.view = name;
  const next = viewEl(name);
  next.hidden = false;
  next.classList.remove('view-enter');
  void next.offsetWidth;
  next.classList.add('view-enter');
  const tabs = document.getElementById('tabbar-tabs');
  tabs.style.setProperty('--tab-index', String(VIEWS.indexOf(name)));
  tabs.querySelectorAll('.tab').forEach((tab) => {
    if (tab.dataset.tab === name) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
  render();
}

function setupScrollEffects() {
  document.querySelectorAll('.view').forEach((view) => {
    const title = view.querySelector('.large-title');
    let queued = false;
    view.addEventListener('scroll', () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        const threshold = title ? title.offsetTop + title.offsetHeight - 40 : 8;
        view.classList.toggle('is-scrolled', view.scrollTop > threshold);
      });
    }, { passive: true });
  });
}

// When the iPhone keyboard is open, sheets get extra room at the bottom so
// every field can be scrolled into view.
function setupKeyboardInset() {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => {
    const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--keyboard-inset', `${Math.round(inset)}px`);
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function txRow(tx, { showDate = false } = {}) {
  if (tx.planId) return paymentRow(tx, { showDate });
  const value = toAgorot(tx.amount);
  const isIncome = tx.type === 'income';
  const title = tx.note || (isIncome ? 'Income' : 'Expense');
  const signed = money(isIncome ? value : -value, { sign: true });
  return h('li', { class: `tx-row${tx.id === state.flashId ? ' is-new' : ''}`, dataset: { id: tx.id } },
    h('div', { class: 'tx-actions', 'aria-hidden': 'true' },
      h('button', { type: 'button', class: 'tx-delete', tabindex: '-1' }, icon('trash'), h('span', null, 'Delete'))),
    h('div', {
      class: 'tx-content',
      role: 'button',
      tabindex: '0',
      'aria-label': `${title}, ${isIncome ? 'income' : 'expense'} ${signed}, ${METHOD_LABEL[tx.method]}, ${dayHeading(tx.date)}. Opens the editor.`,
    },
    h('span', { class: `tx-icon is-${tx.type}`, 'aria-hidden': 'true' }, icon(isIncome ? 'income' : 'expense')),
    h('span', { class: 'tx-main' },
      h('span', { class: 'tx-title', dir: 'auto' }, title),
      h('span', { class: 'tx-sub' },
        icon(tx.method, 'tx-method-icon'),
        METHOD_LABEL[tx.method],
        showDate ? ` · ${dayHeading(tx.date)}` : '')),
    h('span', { class: `tx-amount is-${tx.type}` }, signed)));
}

/** One monthly payment of an installment plan. Tapping it opens the plan; it can't be swiped away on its own. */
function paymentRow(tx, { showDate = false } = {}) {
  const value = toAgorot(tx.amount);
  const title = tx.note || 'Installment';
  const upcoming = store.isUpcomingPayment(tx);
  return h('li', { class: `tx-row is-payment${upcoming ? ' is-upcoming' : ''}${tx.planId === state.flashId ? ' is-new' : ''}`, dataset: { id: tx.id, plan: tx.planId } },
    h('div', {
      class: 'tx-content',
      role: 'button',
      tabindex: '0',
      'aria-label': `${title}, installment payment ${tx.payment} of ${tx.payments}, ${money(-value, { sign: true })}, ${METHOD_LABEL[tx.method]}, ${dayHeading(tx.date)}${upcoming ? ', upcoming' : ''}. Opens the installment plan.`,
    },
    h('span', { class: 'tx-icon is-expense', 'aria-hidden': 'true' }, icon('installments')),
    h('span', { class: 'tx-main' },
      h('span', { class: 'tx-title', dir: 'auto' }, title),
      h('span', { class: 'tx-sub' },
        icon(tx.method, 'tx-method-icon'),
        `${METHOD_LABEL[tx.method]} · Payment ${tx.payment} of ${tx.payments}`,
        showDate ? ` · ${dayHeading(tx.date)}` : '',
        upcoming ? h('span', { class: 'tx-badge' }, 'Upcoming') : null)),
    h('span', { class: 'tx-amount is-expense' }, money(-value, { sign: true }))));
}

function openFromRow(id) {
  const planId = id.includes(':') ? id.split(':')[0] : null;
  if (planId) openPlanEditor(planId);
  else openEditor(id);
}

function emptyState({ title, text, actions = [] }) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-art', 'aria-hidden': 'true' }, icon('wallet')),
    h('p', { class: 'empty-title' }, title),
    text && h('p', { class: 'empty-text' }, text),
    actions.length ? h('div', { class: 'empty-actions' }, actions) : null);
}

function noDataYet() {
  return emptyState({
    title: 'No transactions yet',
    text: 'Tap + to add your first income or expense. Tip: add the cash in your wallet and the money on your card as income first, so your balances match real life.',
    actions: [h('button', { type: 'button', class: 'btn btn-primary', onClick: () => openEditor() }, icon('plus'), 'Add transaction')],
  });
}

/** "‹ October 2026 ›" control with a month list behind the label. */
function createMonthStepper({ onChange, allowAll }) {
  const prev = h('button', { type: 'button', class: 'stepper-btn', 'aria-label': 'Previous month' }, icon('chevronLeft'));
  const next = h('button', { type: 'button', class: 'stepper-btn', 'aria-label': 'Next month' }, icon('chevronRight'));
  const label = h('button', { type: 'button', class: 'stepper-label', 'aria-haspopup': 'dialog' });
  const el = h('div', { class: 'stepper' }, prev, label, next);
  let value = null;

  prev.addEventListener('click', () => onChange(shiftMonth(value, -1)));
  next.addEventListener('click', () => onChange(shiftMonth(value, 1)));
  label.addEventListener('click', () => openMonthPicker({ value, allowAll, onChange }));

  function set(nextValue) {
    value = nextValue;
    const { first, last } = monthLimits();
    label.replaceChildren(h('span', null, value === 'all' ? 'All months' : monthName(value, 'shortYear')), icon('chevronDown', 'stepper-caret'));
    label.setAttribute('aria-label', `${value === 'all' ? 'All months' : monthName(value)}. Choose a month`);
    prev.disabled = value === 'all' || value <= first;
    next.disabled = value === 'all' || value >= last;
  }
  return { el, set };
}

function monthLimits() {
  const bounds = store.dataMonthBounds(store.getAll());
  const now = currentMonth();
  if (!bounds) return { first: shiftMonth(now, -1), last: now };
  return {
    first: bounds.first < now ? bounds.first : shiftMonth(now, -1),
    last: bounds.last > now ? bounds.last : now,
  };
}

function openMonthPicker({ value, allowAll, onChange }) {
  const all = store.getAll();
  const totals = store.monthlyTotals(all);
  const { first, last } = monthLimits();
  const keys = [...(allowAll ? ['all'] : []), ...monthRange(first, last).reverse()];
  let layer;
  const options = keys.map((key) => {
    const selected = key === value;
    const info = key === 'all' ? null : totals.get(key);
    const meta = key === 'all' ? plural(all.length, 'transaction') : info ? plural(info.count, 'transaction') : 'No transactions';
    return h('button', {
      type: 'button',
      class: `picker-option${selected ? ' is-selected' : ''}`,
      'aria-pressed': String(selected),
      onClick: () => {
        layer.close();
        if (key !== value) onChange(key);
      },
    },
    h('span', { class: 'picker-name' }, key === 'all' ? 'All months' : monthName(key)),
    h('span', { class: 'picker-meta' }, meta),
    selected ? icon('check', 'picker-check') : null);
  });
  const list = h('div', { class: 'picker-list' }, options);
  const content = h('div', { class: 'action-sheet' },
    h('div', { class: 'action-group' },
      h('div', { class: 'action-header' }, h('p', { class: 'action-title' }, 'Choose a month')),
      list),
    h('button', { type: 'button', class: 'action-button action-cancel', onClick: () => layer.close() }, 'Cancel'));
  layer = openLayer({ kind: 'action', content, label: 'Choose a month' });
  const selected = list.querySelector('.is-selected');
  if (selected) {
    selected.scrollIntoView({ block: 'center' });
    setTimeout(() => selected.focus({ preventScroll: true }), 0);
  }
}

// Filter bars on Activity and Insights share one filter.
const filterBars = {};

function getFilterBar(scope) {
  if (filterBars[scope]) return filterBars[scope];
  const stepper = createMonthStepper({ allowAll: true, onChange: (month) => setFilter({ month }) });
  const method = segmented({
    label: 'Payment method',
    className: 'segmented-filter',
    options: [
      { value: 'all', label: 'All' },
      { value: 'cash', label: 'Cash' },
      { value: 'card', label: 'Card' },
    ],
    value: state.filter.method,
    onChange: (value) => setFilter({ method: value }),
  });
  document.getElementById(`${scope}-filters`).replaceChildren(h('div', { class: 'filter-row' }, stepper.el, method.el));
  filterBars[scope] = { stepper, method };
  return filterBars[scope];
}

function syncFilterBar(scope) {
  const bar = getFilterBar(scope);
  bar.stepper.set(state.filter.month);
  bar.method.set(state.filter.method);
}

function setFilter(patch) {
  state.filter = { ...state.filter, ...patch };
  state.activityLimit = PAGE_SIZE;
  markDirty('activity', 'insights');
  render();
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

let homeStepper = null;

function renderHome() {
  const all = store.getAll();
  const today = todayKey();
  // Installment payments that aren't due yet are owed, not spent: keep them out of the balance.
  const settled = all.filter((t) => !store.isUpcomingPayment(t, today));
  const totals = store.summarize(settled);
  document.getElementById('today-label').textContent = longDate(today);
  renderBalance(totals);
  renderNotices(store.getTransactions());

  if (!homeStepper) {
    homeStepper = createMonthStepper({
      allowAll: false,
      onChange: (month) => {
        state.homeMonth = month;
        markDirty('home');
        render();
      },
    });
    document.getElementById('home-month-nav').append(homeStepper.el);
  }
  homeStepper.set(state.homeMonth);
  renderMonthSummary(all);
  renderInstallments();

  const recent = document.getElementById('home-recent');
  if (!settled.length) {
    recent.replaceChildren(noDataYet());
  } else {
    recent.replaceChildren(h('ul', { class: 'list-card' }, settled.slice(0, 5).map((tx) => txRow(tx, { showDate: true }))));
  }
  document.querySelector('#view-home [data-goto="activity"]').hidden = !all.length;
}

// ---------- Installment plans (Home) ----------

function renderInstallments() {
  const root = document.getElementById('home-installments');
  if (!store.getPlans().length) {
    root.replaceChildren(h('div', { class: 'card plans-empty' },
      h('span', { class: 'notice-icon', 'aria-hidden': 'true' }, icon('installments')),
      h('p', { class: 'notice-text' },
        'Bought something in monthly payments? When you add an expense, turn on ',
        h('strong', null, 'Pay in installments'), '. Each payment then counts in its own month.')));
    return;
  }
  const o = store.installmentOverview();
  const blocks = [
    h('div', { class: 'card stat-strip plans-strip' },
      stripStat('Left to pay', money(o.owed)),
      stripStat(`Due in ${monthName(o.thisMonth, 'short')}`, money(o.dueThisMonth)),
      stripStat(`Due in ${monthName(o.nextMonth, 'short')}`, money(o.dueNextMonth))),
  ];
  if (o.active.length) {
    blocks.push(h('ul', { class: 'list-card plan-list' }, o.active.map(planRow)));
  } else {
    blocks.push(h('p', { class: 'plans-note' }, 'All your plans are paid off.'));
  }
  if (o.finished.length) {
    blocks.push(h('button', {
      type: 'button',
      class: 'link-btn plans-toggle',
      'aria-expanded': String(state.showFinishedPlans),
      onClick: () => {
        state.showFinishedPlans = !state.showFinishedPlans;
        markDirty('home');
        render();
      },
    }, `${state.showFinishedPlans ? 'Hide' : 'Show'} paid-off plans (${o.finished.length})`));
    if (state.showFinishedPlans) blocks.push(h('ul', { class: 'list-card plan-list' }, o.finished.map(planRow)));
  }
  root.replaceChildren(...blocks);
}

function planRow(s) {
  const { plan } = s;
  const title = plan.note || 'Installment plan';
  const done = s.leftCount === 0;
  const sub = done
    ? `Paid off · ${plan.count} payments`
    : `${money(s.monthly)}/month · ${s.leftCount} of ${plan.count} left`;
  return h('li', { class: `plan-row${plan.id === state.flashId ? ' is-new' : ''}` },
    h('button', {
      type: 'button',
      class: 'plan-content',
      'aria-label': `${title}: ${sub}, ${money(s.leftAmount)} left to pay. Opens the plan.`,
      onClick: () => openPlanEditor(plan.id),
    },
    h('span', { class: 'tx-icon is-expense', 'aria-hidden': 'true' }, icon('installments')),
    h('span', { class: 'tx-main' },
      h('span', { class: 'tx-title', dir: 'auto' }, title),
      h('span', { class: 'tx-sub' }, icon(plan.method, 'tx-method-icon'), sub),
      h('span', { class: 'plan-progress', 'aria-hidden': 'true' },
        h('span', { class: 'plan-progress-fill', style: { '--fill': (s.paidCount / plan.count).toFixed(4) } }))),
    h('span', { class: 'plan-amount' },
      h('span', { class: 'plan-left' }, money(s.leftAmount)),
      h('span', { class: 'plan-left-label' }, done ? 'done' : 'left')),
    icon('chevronRight', 'row-chevron')));
}

function openPlanEditor(planId) {
  openEditor(null, { planId });
}

function deletePlanWithUndo(id) {
  let plan;
  try {
    plan = store.deletePlan(id);
  } catch (err) {
    showError(err);
    return;
  }
  if (!plan) return;
  haptic();
  toast('Installment plan deleted', {
    iconName: 'trash',
    actionLabel: 'Undo',
    onAction: () => {
      try {
        store.restorePlan(plan);
      } catch (err) {
        showError(err);
      }
    },
  });
}

function renderBalance(totals) {
  const root = document.getElementById('home-balance');
  let amount = root.querySelector('.balance-amount');
  if (!amount) {
    amount = h('p', { class: 'balance-amount' });
    root.replaceChildren(h('section', { class: 'balance-card', 'aria-labelledby': 'balance-label' },
      h('div', { class: 'balance-glow', 'aria-hidden': 'true' }),
      h('p', { class: 'balance-label', id: 'balance-label' }, 'Total balance'),
      amount,
      h('div', { class: 'balance-split' })));
  }
  const from = state.lastNet;
  state.lastNet = totals.net;
  if (from === null || from === totals.net || prefersReducedMotion()) paintAmount(amount, totals.net);
  else countTo(amount, from, totals.net);
  amount.setAttribute('aria-label', money(totals.net, { cents: 'always' }));

  root.querySelector('.balance-split').replaceChildren(
    balanceTile('cash', totals.cash.net),
    balanceTile('card', totals.card.net));
}

function paintAmount(el, agorot) {
  const { negative, symbol, whole, fraction } = moneyParts(agorot);
  const parts = [
    h('span', { class: 'amount-symbol', 'aria-hidden': 'true' }, symbol),
    h('span', { class: 'amount-whole', 'aria-hidden': 'true' }, whole),
    h('span', { class: 'amount-fraction', 'aria-hidden': 'true' }, `.${fraction}`),
  ];
  if (negative) parts.unshift(h('span', { class: 'amount-minus', 'aria-hidden': 'true' }, MINUS));
  el.replaceChildren(...parts);
}

function countTo(el, from, to) {
  const start = performance.now();
  const duration = 650;
  const token = Symbol('count');
  el.countToken = token;
  const step = (now) => {
    if (el.countToken !== token) return;
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - t) ** 3;
    paintAmount(el, Math.round(from + (to - from) * eased));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function balanceTile(method, value) {
  return h('div', { class: 'balance-tile' },
    h('span', { class: 'balance-tile-head' },
      h('span', { class: 'balance-tile-icon', 'aria-hidden': 'true' }, icon(method)),
      h('span', { class: 'balance-tile-label' }, METHOD_LABEL[method])),
    h('span', { class: 'balance-tile-value' }, money(value)));
}

const isStandalone = () => window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

function renderNotices(all) {
  const notices = [];
  if (!isStandalone() && !ui.installHintDismissed && (isIOS || state.installPrompt)) notices.push(installNotice());
  if (needsBackupReminder(all)) notices.push(backupNotice());
  document.getElementById('home-notices').replaceChildren(...notices);
}

function installNotice() {
  const dismiss = () => {
    saveUi({ installHintDismissed: true });
    markDirty('home');
    render();
  };
  const body = state.installPrompt && !isIOS
    ? [h('p', { class: 'notice-text' }, 'Open it like a regular app — it works offline too.'),
      h('div', { class: 'notice-actions' }, h('button', { type: 'button', class: 'btn btn-small btn-primary', onClick: promptInstall }, 'Install app'))]
    : [h('p', { class: 'notice-text' },
      'In Safari, tap Share ', h('span', { class: 'inline-icon' }, icon('share')), ' (or ••• then Share), then ',
      h('strong', null, 'Add to Home Screen'), '.'),
      h('div', { class: 'notice-actions' }, h('button', { type: 'button', class: 'btn btn-small btn-tinted', 'data-goto': 'settings' }, 'Show me how'))];
  return h('section', { class: 'notice', 'aria-label': 'Install the app' },
    h('span', { class: 'notice-icon', 'aria-hidden': 'true' }, icon('phone')),
    h('div', { class: 'notice-body' }, h('p', { class: 'notice-title' }, 'Install on your iPhone'), ...body),
    h('button', { type: 'button', class: 'notice-close', 'aria-label': 'Dismiss', onClick: dismiss }, icon('close')));
}

async function promptInstall() {
  const event = state.installPrompt;
  if (!event) return;
  state.installPrompt = null;
  event.prompt();
  await event.userChoice.catch(() => null);
  markDirty('home', 'settings');
  render();
}

function needsBackupReminder(all) {
  if (all.length < 10) return false;
  const meta = store.getMeta();
  const now = Date.now();
  if (meta.backupSnoozedUntil && now < meta.backupSnoozedUntil) return false;
  return !meta.lastBackupAt || now - meta.lastBackupAt > 30 * DAY;
}

function backupNotice() {
  const meta = store.getMeta();
  return h('section', { class: 'notice', 'aria-label': 'Backup reminder' },
    h('span', { class: 'notice-icon is-accent', 'aria-hidden': 'true' }, icon('export')),
    h('div', { class: 'notice-body' },
      h('p', { class: 'notice-title' }, 'Time for a backup'),
      h('p', { class: 'notice-text' }, meta.lastBackupAt
        ? `Your last backup was ${relativeTime(meta.lastBackupAt)}. Your data lives only on this phone, so keep a copy somewhere safe.`
        : 'Your data lives only on this phone. Export a backup and keep it somewhere safe, like iCloud Drive.'),
      h('div', { class: 'notice-actions' },
        h('button', { type: 'button', class: 'btn btn-small btn-primary', onClick: exportBackup }, 'Back up now'),
        h('button', {
          type: 'button',
          class: 'btn btn-small btn-plain',
          onClick: () => {
            store.setMeta({ backupSnoozedUntil: Date.now() + 14 * DAY });
            markDirty('home');
            render();
          },
        }, 'Later'))));
}

function renderMonthSummary(all) {
  const month = state.homeMonth;
  const s = store.summarize(store.filterTransactions(all, { month }));
  const isCurrent = month === currentMonth();
  const card = h('div', { class: 'card summary-card' },
    h('div', { class: 'summary-stats' },
      summaryStat('income', 'Income', s.income, s.incomeCount),
      summaryStat('expense', 'Spent', s.expense, s.expenseCount)),
    spendMeter(s, month),
    s.count ? h('div', { class: 'summary-foot' },
      h('p', { class: 'summary-net' },
        h('span', null, s.net >= 0 ? (isCurrent ? 'Saved so far' : 'Saved') : 'Overspent'),
        h('strong', { class: s.net >= 0 ? 'is-positive' : 'is-negative' }, money(s.net, { sign: true }))),
      spendComparison(all, month, s.expense)) : null);
  document.getElementById('home-summary').replaceChildren(card);
}

function summaryStat(type, label, value, count) {
  return h('div', { class: 'summary-stat' },
    h('span', { class: `summary-stat-icon is-${type}`, 'aria-hidden': 'true' }, icon(type)),
    h('span', { class: 'summary-stat-label' }, label),
    h('span', { class: 'summary-stat-value' }, money(value)),
    h('span', { class: 'summary-stat-count' }, plural(count, 'transaction')));
}

function spendMeter(s, month) {
  if (!s.income && !s.expense) {
    return h('p', { class: 'meter-label is-empty' }, `No transactions in ${monthName(month, 'name')}.`);
  }
  if (!s.income) {
    return h('p', { class: 'meter-label' }, 'No income recorded this month.');
  }
  const ratio = s.expense / s.income;
  return h('div', { class: `meter${ratio > 1 ? ' is-over' : ''}` },
    h('div', { class: 'meter-track', 'aria-hidden': 'true' },
      h('div', { class: 'meter-fill', style: { '--fill': Math.min(1, ratio).toFixed(4) } })),
    h('p', { class: 'meter-label' }, ratio > 1
      ? `You spent ${money(s.expense - s.income)} more than came in`
      : `${percent(ratio)} of your income spent`));
}

/** "12% less than this time in September" — compares like with like for the running month. */
function spendComparison(all, month, spent) {
  const prevKey = shiftMonth(month, -1);
  const isCurrent = month === currentMonth();
  const cutoffDay = todayKey().slice(8, 10);
  const prevList = store.filterTransactions(all, { month: prevKey, type: 'expense' })
    .filter((t) => !isCurrent || t.date.slice(8, 10) <= cutoffDay);
  const prev = prevList.reduce((sum, t) => sum + toAgorot(t.amount), 0);
  if (!prev || !spent) return null;
  const change = (spent - prev) / prev;
  if (Math.abs(change) < 0.005) {
    return h('p', { class: 'summary-compare' }, `Spending about the same as ${isCurrent ? 'this time in ' : ''}${monthName(prevKey, 'name')}`);
  }
  const less = change < 0;
  return h('p', { class: `summary-compare ${less ? 'is-good' : 'is-bad'}` },
    icon(less ? 'arrowDown' : 'arrowUp'),
    `${percent(Math.abs(change))} ${less ? 'less' : 'more'} spent than ${isCurrent ? 'this time in ' : ''}${monthName(prevKey, 'name')}`);
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

let loadMoreObserver = null;

function renderActivity() {
  syncFilterBar('activity');
  const all = store.getAll();
  const list = store.filterTransactions(all, state.filter);
  const summary = document.getElementById('activity-summary');
  const root = document.getElementById('activity-list');
  loadMoreObserver?.disconnect();

  if (!all.length) {
    summary.replaceChildren();
    root.replaceChildren(noDataYet());
    return;
  }

  const s = store.summarize(list);
  summary.replaceChildren(h('div', { class: 'card stat-strip' },
    stripStat('In', money(s.income), 'is-positive'),
    stripStat('Out', money(s.expense)),
    stripStat('Net', money(s.net, { sign: true }), s.net < 0 ? 'is-negative' : '')));

  if (!list.length) {
    const actions = [];
    if (state.filter.month !== 'all') {
      actions.push(h('button', { type: 'button', class: 'btn btn-small btn-tinted', onClick: () => setFilter({ month: 'all' }) }, 'Show all months'));
    }
    if (state.filter.method !== 'all') {
      actions.push(h('button', { type: 'button', class: 'btn btn-small btn-tinted', onClick: () => setFilter({ method: 'all' }) }, 'Show cash and card'));
    }
    const where = state.filter.month === 'all' ? '' : ` in ${monthName(state.filter.month)}`;
    const how = state.filter.method === 'all' ? '' : ` paid by ${state.filter.method}`;
    root.replaceChildren(emptyState({ title: 'Nothing here', text: `No transactions${how}${where}.`, actions }));
    return;
  }

  const dayNet = new Map();
  for (const tx of list) {
    const v = toAgorot(tx.amount) * (tx.type === 'income' ? 1 : -1);
    dayNet.set(tx.date, (dayNet.get(tx.date) || 0) + v);
  }
  const shown = list.slice(0, state.activityLimit);
  const groups = [];
  let ul = null;
  let date = null;
  for (const tx of shown) {
    if (tx.date !== date) {
      date = tx.date;
      ul = h('ul', { class: 'list-card' });
      groups.push(h('section', { class: 'day-group', 'aria-label': dayHeading(date) },
        h('h3', { class: 'day-head' },
          h('span', null, dayHeading(date)),
          h('span', { class: 'day-total' }, money(dayNet.get(date), { sign: true }))),
        ul));
    }
    ul.append(txRow(tx));
  }
  if (list.length > shown.length) {
    const more = h('button', {
      type: 'button',
      class: 'btn btn-small btn-tinted load-more',
      onClick: () => {
        state.activityLimit += PAGE_SIZE * 2;
        markDirty('activity');
        render();
      },
    }, `Show more (${(list.length - shown.length).toLocaleString('en-US')} left)`);
    groups.push(more);
    loadMoreObserver = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) more.click();
    }, { root: viewEl('activity'), rootMargin: '600px 0px' });
    requestAnimationFrame(() => loadMoreObserver?.observe(more));
  }
  root.replaceChildren(...groups);
}

function stripStat(label, value, className = '') {
  return h('div', { class: 'strip-stat' },
    h('span', { class: 'strip-label' }, label),
    h('span', { class: `strip-value ${className}`.trim() }, value));
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

let charts = null;

function chartCard(title, chart) {
  const subtitle = h('p', { class: 'chart-sub' });
  const tableWrap = h('div', { class: 'chart-table-wrap', hidden: true }, chart.table);
  const toggle = h('button', {
    type: 'button',
    class: 'icon-btn',
    'aria-expanded': 'false',
    'aria-label': `Show "${title}" as a table`,
    title: 'Show as table',
  }, icon('table'));
  toggle.addEventListener('click', () => {
    const open = tableWrap.hidden;
    tableWrap.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.classList.toggle('is-on', open);
  });
  const card = h('article', { class: 'card chart-card' },
    h('header', { class: 'chart-head' },
      h('div', null, h('h2', { class: 'chart-title' }, title), subtitle),
      toggle),
    chart.el,
    tableWrap);
  return { card, subtitle };
}

function ensureCharts() {
  if (charts) return charts;
  const bars = createMonthlyBars();
  const line = createSpendingLine();
  const split = createMethodSplit();
  charts = {
    bars, line, split,
    barsCard: chartCard('Income vs expenses', bars),
    lineCard: chartCard('Spending over time', line),
    splitCard: chartCard('Cash vs card', split),
  };
  return charts;
}

function renderInsights() {
  syncFilterBar('insights');
  const root = document.getElementById('insights-content');
  const all = store.getAll();
  if (!all.length) {
    root.replaceChildren(emptyState({
      title: 'Charts appear here',
      text: 'Add a few transactions and you will see where your money goes.',
      actions: [h('button', { type: 'button', class: 'btn btn-primary', onClick: () => openEditor() }, icon('plus'), 'Add transaction')],
    }));
    return;
  }
  const c = ensureCharts();
  if (!c.barsCard.card.isConnected) {
    root.replaceChildren(c.barsCard.card, c.lineCard.card, c.splitCard.card,
      h('p', { class: 'footnote' }, 'Tap or drag on a chart to see exact numbers. The table button shows every value.'));
  }

  const { month, method } = state.filter;
  const methodNote = method === 'all' ? '' : ` · ${METHOD_LABEL[method]} only`;
  const list = store.filterTransactions(all, { method });
  const totals = store.monthlyTotals(list);
  const bounds = store.dataMonthBounds(all);
  const now = currentMonth();
  const lastMonth = bounds.last > now ? bounds.last : now;

  // 1. Income vs expenses per month
  const barMonths = month === 'all'
    ? monthRange(maxMonth(bounds.first, shiftMonth(lastMonth, -11)), lastMonth)
    : monthRange(shiftMonth(month, -5), month);
  c.bars.update({
    months: barMonths.map((key) => ({ key, income: totals.get(key)?.income || 0, expense: totals.get(key)?.expense || 0 })),
    focusKey: month === 'all' ? null : month,
    rangeLabel: rangeLabel(barMonths),
  });
  c.barsCard.subtitle.textContent = `${rangeLabel(barMonths)}${methodNote}`;

  // 2. Spending over time
  if (month === 'all') {
    const keys = monthRange(maxMonth(bounds.first, shiftMonth(lastMonth, -23)), lastMonth);
    c.line.update(monthlySpendingData(keys.map((key) => ({ key, expense: totals.get(key)?.expense || 0 }))));
    c.lineCard.subtitle.textContent = `Per month${methodNote}`;
  } else {
    const prevKey = shiftMonth(month, -1);
    const perDay = store.dailyExpenses(list, month);
    const lastDay = month < now ? perDay.length : month === now ? Number(todayKey().slice(8, 10)) : 0;
    c.line.update(dailySpendingData({ monthKey: month, perDay, prevKey, prevPerDay: store.dailyExpenses(list, prevKey), lastDay }));
    c.lineCard.subtitle.textContent = `${monthName(month)}, compared with ${monthName(prevKey, 'name')}${methodNote}`;
  }

  // 3. Cash vs card (always both methods)
  const period = month === 'all' ? all : store.filterTransactions(all, { month });
  const s = store.summarize(period);
  c.split.update({
    rows: [
      { id: 'spent', label: 'Spent', cash: s.cash.expense, card: s.card.expense, emptyText: 'No spending in this period' },
      { id: 'received', label: 'Received', cash: s.cash.income, card: s.card.income, emptyText: 'No income in this period' },
    ],
    emphasis: method,
  });
  c.splitCard.subtitle.textContent = `${month === 'all' ? 'All months' : monthName(month)}${method === 'all' ? '' : ' · both methods shown'}`;
}

const maxMonth = (a, b) => (a > b ? a : b);

function rangeLabel(keys) {
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (first === last) return monthName(first);
  if (first.slice(0, 4) === last.slice(0, 4)) return `${monthName(first, 'short')} – ${monthName(last, 'shortYear')}`;
  return `${monthName(first, 'shortYear')} – ${monthName(last, 'shortYear')}`;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

let themeControl = null;

function renderSettings() {
  const meta = store.getMeta();
  if (!themeControl) {
    themeControl = segmented({
      label: 'Appearance',
      className: 'segmented-wide',
      options: [
        { value: 'system', label: 'System' },
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
      ],
      value: state.theme,
      onChange: setTheme,
    });
  }
  themeControl.set(state.theme);

  const groups = [
    settingsGroup('Appearance', [h('div', { class: 'list-row list-row-control' }, themeControl.el)],
      'System follows your iPhone’s light or dark mode.'),
  ];

  if (state.waitingWorker) {
    groups.push(settingsGroup('Update', [
      rowButton({ iconName: 'sparkle', tint: 'accent', title: 'A new version is ready', subtitle: 'Tap to update now', onClick: applyUpdate }),
    ]));
  }

  groups.push(
    settingsGroup('Backup & restore', [
      rowButton({
        iconName: 'export',
        tint: 'accent',
        title: 'Export backup',
        subtitle: meta.lastBackupAt ? `Last backup ${relativeTime(meta.lastBackupAt)}` : 'No backup yet',
        onClick: exportBackup,
      }),
      rowButton({
        iconName: 'import',
        tint: 'accent',
        title: 'Import backup',
        subtitle: 'Restore from a backup file',
        onClick: () => document.getElementById('import-file').click(),
      }),
    ], 'A backup is one small .json file. Save it to iCloud Drive or Files. Import it to restore your data, for example on a new phone.'),
    settingsGroup('Your data', [
      infoRow({ iconName: 'shield', tint: 'green', title: 'Stored on this device only', value: dataDescription(store.snapshot()) }),
      rowButton({ iconName: 'trash', tint: 'danger', title: 'Delete all data', destructive: true, disabled: !hasData(store.snapshot()), onClick: deleteAll }),
    ], 'Nothing is uploaded anywhere. Removing the app from your Home Screen also removes its data, so export a backup first.'),
  );

  if (!isStandalone()) groups.push(installSteps());

  groups.push(settingsGroup('About', [
    infoRow({ iconName: 'info', tint: 'gray', title: 'Version', value: BUILD.startsWith('__') ? `${APP_VERSION} (local)` : `${APP_VERSION} (${BUILD.slice(0, 7)})` }),
  ], 'Amounts are in Israeli shekels (₪). Works offline.'));

  document.getElementById('settings-content').replaceChildren(...groups);
}

function settingsGroup(title, rows, footer) {
  const id = `group-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return h('section', { class: 'settings-group', 'aria-labelledby': id },
    h('h2', { class: 'group-title', id }, title),
    h('div', { class: 'list-card' }, rows),
    footer ? h('p', { class: 'group-footer' }, footer) : null);
}

function rowButton({ iconName, tint, title, subtitle, onClick, destructive, disabled }) {
  return h('button', { type: 'button', class: `list-row list-row-button${destructive ? ' is-destructive' : ''}`, onClick, disabled },
    h('span', { class: `row-icon tint-${tint}`, 'aria-hidden': 'true' }, icon(iconName)),
    h('span', { class: 'row-text' },
      h('span', { class: 'row-title' }, title),
      subtitle ? h('span', { class: 'row-subtitle' }, subtitle) : null),
    destructive ? null : icon('chevronRight', 'row-chevron'));
}

function infoRow({ iconName, tint, title, value }) {
  return h('div', { class: 'list-row' },
    h('span', { class: `row-icon tint-${tint}`, 'aria-hidden': 'true' }, icon(iconName)),
    h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, title)),
    h('span', { class: 'row-value' }, value));
}

function installSteps() {
  const steps = [
    ['Open this page in ', h('strong', null, 'Safari'), '.'],
    ['Tap the ', h('strong', null, 'Share'), ' button ', h('span', { class: 'inline-icon' }, icon('share')), ' (on newer iPhones, tap ', h('strong', null, '•••'), ' first).'],
    ['Scroll down and tap ', h('strong', null, 'Add to Home Screen'), ' ', h('span', { class: 'inline-icon' }, icon('addSquare')), '.'],
    ['Keep ', h('strong', null, 'Open as Web App'), ' switched on if you see it, then tap ', h('strong', null, 'Add'), '.'],
  ];
  return settingsGroup('Install on iPhone', [
    h('ol', { class: 'steps' }, steps.map((parts, i) => h('li', { class: 'step' }, h('span', { class: 'step-number', 'aria-hidden': 'true' }, String(i + 1)), h('span', null, parts)))),
  ], 'Then open Expenses from your Home Screen. It starts with its own empty data, so if you already added entries here, export a backup and import it in the installed app.');
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

function readTheme() {
  try {
    const theme = localStorage.getItem(THEME_KEY);
    return theme === 'light' || theme === 'dark' ? theme : 'system';
  } catch {
    return 'system';
  }
}

function setTheme(theme) {
  state.theme = theme;
  try {
    if (theme === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* not critical */
  }
  applyTheme(theme);
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  syncThemeColor();
}

// Colors the iPhone status bar to match the app (black while a sheet is open, like iOS).
function syncThemeColor() {
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    const tagScheme = (meta.getAttribute('media') || '').includes('dark') ? 'dark' : 'light';
    const scheme = state.theme === 'system' ? tagScheme : state.theme;
    meta.setAttribute('content', state.sheetPresented || scheme === 'dark' ? '#000000' : '#f2f2f7');
  });
}

// ---------------------------------------------------------------------------
// Add / edit sheet
// ---------------------------------------------------------------------------

function openEditor(id = null, { planId = null } = {}) {
  const plan = planId ? store.getPlan(planId) : null;
  if (planId && !plan) return;
  const existing = id ? store.getById(id) : null;
  if (id && !existing) return;
  const isNew = !existing && !plan;
  if (isNew) summonKeyboard(); // must run during the tap itself

  const draft = {
    type: existing ? existing.type : 'expense',
    method: plan ? plan.method : existing ? existing.method : ui.lastMethod === 'cash' ? 'cash' : 'card',
    installments: Boolean(plan),
  };
  const titleId = 'editor-title';

  const cancelButton = h('button', { type: 'button', class: 'nav-btn' }, 'Cancel');
  const saveButton = h('button', { type: 'submit', class: 'nav-btn nav-btn-strong' }, isNew ? 'Add' : 'Save');

  const typeControl = segmented({
    label: 'Type',
    className: 'segmented-type',
    options: [
      { value: 'expense', label: 'Expense', icon: 'expense' },
      { value: 'income', label: 'Income', icon: 'income' },
    ],
    value: draft.type,
    onChange: (value) => {
      draft.type = value;
      form.dataset.type = value;
      syncPlanUi();
    },
  });
  typeControl.el.hidden = Boolean(plan);

  const amountInput = h('input', {
    class: 'amount-input',
    type: 'text',
    inputmode: 'decimal',
    autocomplete: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
    enterkeyhint: 'next',
    placeholder: '0',
    'aria-label': 'Amount in shekels',
    'aria-describedby': 'amount-error',
    maxlength: '13',
    size: '1', // the field grows with its text (see .amount-wrap)
  });
  amountInput.value = plan ? String(plan.total) : existing ? String(existing.amount) : '';
  const sizer = h('span', { class: 'amount-sizer', 'aria-hidden': 'true' });
  const amountField = h('label', { class: 'amount-field' },
    h('span', { class: 'amount-sign', 'aria-hidden': 'true' }),
    h('span', { class: 'amount-currency', 'aria-hidden': 'true' }, '₪'),
    h('span', { class: 'amount-wrap' }, sizer, amountInput));
  const amountCaption = h('p', { class: 'amount-caption' }, 'Total amount');
  const amountError = h('p', { class: 'field-error', id: 'amount-error', 'aria-live': 'polite' });

  const methodControl = segmented({
    label: 'Paid with',
    className: 'segmented-method',
    options: [
      { value: 'cash', label: 'Cash', icon: 'cash' },
      { value: 'card', label: 'Card', icon: 'card' },
    ],
    value: draft.method,
    onChange: (value) => { draft.method = value; },
  });

  // Installments: a switch, the number of monthly payments, and a preview.
  const planSwitch = h('input', { type: 'checkbox', class: 'switch', id: 'tx-installments', role: 'switch' });
  planSwitch.checked = draft.installments;
  planSwitch.addEventListener('change', () => {
    draft.installments = planSwitch.checked;
    syncPlanUi();
    if (planSwitch.checked) haptic();
  });
  const switchRow = h('div', { class: 'form-row' },
    h('label', { class: 'form-label form-label-wide', for: 'tx-installments' }, icon('installments'), 'Pay in installments'),
    planSwitch);
  const countInput = h('input', {
    type: 'text',
    inputmode: 'numeric',
    class: 'field-input count-input',
    id: 'tx-count',
    maxlength: '3',
    autocomplete: 'off',
    'aria-describedby': 'plan-preview',
  });
  countInput.value = String(plan ? plan.count : 3);
  const countRow = h('div', { class: 'form-row' },
    h('label', { class: 'form-label', for: 'tx-count' }, icon('table'), 'Payments'),
    countInput,
    h('span', { class: 'count-unit', 'aria-hidden': 'true' }, 'monthly'));
  const countChips = h('div', { class: 'date-chips' }, [3, 6, 12, 24, 36].map((n) => {
    const chip = h('button', { type: 'button', class: 'chip', 'aria-label': `${n} payments` }, String(n));
    chip.dataset.count = String(n);
    chip.addEventListener('click', () => {
      countInput.value = String(n);
      syncPlanUi();
    });
    return chip;
  }));
  const countChipsRow = h('div', { class: 'form-row form-row-chips' }, countChips);
  const planPreview = h('p', { class: 'plan-preview', id: 'plan-preview', 'aria-live': 'polite' });
  countInput.addEventListener('input', () => {
    countInput.value = countInput.value.replace(/\D/g, '');
    syncPlanUi();
  });

  const dateInput = h('input', { type: 'date', class: 'field-input field-date', id: 'tx-date', required: true, min: '1900-01-01', max: '2200-12-31' });
  dateInput.value = plan ? plan.firstDate : existing ? existing.date : todayKey();
  const dateLabelText = h('span', null, 'Date');
  const chips = h('div', { class: 'date-chips' },
    dateChip('Today', () => todayKey()),
    dateChip('Yesterday', () => shiftDate(todayKey(), -1)));
  const syncChips = () => {
    chips.querySelectorAll('.chip').forEach((chip) => chip.classList.toggle('is-on', chip.dataset.date === dateInput.value));
  };
  dateInput.addEventListener('change', () => { syncChips(); syncPlanUi(); });
  dateInput.addEventListener('input', () => { syncChips(); syncPlanUi(); });

  const noteInput = h('input', {
    type: 'text',
    class: 'field-input',
    id: 'tx-note',
    maxlength: String(store.NOTE_MAX),
    placeholder: 'What was it for? (optional)',
    autocomplete: 'off',
    enterkeyhint: 'done',
    dir: 'auto',
    list: 'note-suggestions',
  });
  noteInput.value = plan ? plan.note : existing ? existing.note : '';
  const suggestions = h('datalist', { id: 'note-suggestions' }, store.recentNotes().map((note) => h('option', { value: note })));

  let deleteButton = null;
  if (plan) {
    deleteButton = h('button', { type: 'button', class: 'btn btn-destructive', onClick: () => { layer.close(); deletePlanWithUndo(plan.id); } }, icon('trash'), 'Delete plan');
  } else if (existing) {
    deleteButton = h('button', { type: 'button', class: 'btn btn-destructive', onClick: () => { layer.close(); deleteWithUndo(existing.id); } }, icon('trash'), 'Delete transaction');
  }

  const form = h('form', { class: 'editor', novalidate: true, dataset: { type: draft.type }, 'aria-labelledby': titleId },
    h('header', { class: 'sheet-header', 'data-drag-handle': '' },
      cancelButton,
      h('h2', { class: 'sheet-title', id: titleId }),
      saveButton),
    h('div', { class: 'sheet-body' },
      typeControl.el,
      amountField,
      amountCaption,
      amountError,
      h('div', { class: 'field-label', id: 'method-label' }, 'Paid with'),
      methodControl.el,
      h('div', { class: 'list-card form-card' },
        switchRow,
        countRow,
        countChipsRow,
        h('div', { class: 'form-row' },
          h('label', { class: 'form-label', for: 'tx-date' }, icon('calendar'), dateLabelText),
          dateInput),
        h('div', { class: 'form-row form-row-chips' }, chips),
        h('div', { class: 'form-row' },
          h('label', { class: 'form-label', for: 'tx-note' }, icon('note'), 'Note'),
          noteInput)),
      planPreview,
      suggestions,
      deleteButton));

  function dateChip(label, getDate) {
    const chip = h('button', { type: 'button', class: 'chip' }, label);
    chip.dataset.date = getDate();
    chip.addEventListener('click', () => {
      dateInput.value = getDate();
      syncChips();
      syncPlanUi();
    });
    return chip;
  }

  const planMode = () => Boolean(plan) || (isNew && draft.type === 'expense' && draft.installments);
  const paymentCount = () => Number(countInput.value);

  function syncPlanUi() {
    const on = planMode();
    switchRow.hidden = !isNew || draft.type !== 'expense';
    countRow.hidden = !on;
    countChipsRow.hidden = !on;
    amountCaption.hidden = !on;
    planPreview.hidden = !on;
    dateLabelText.textContent = on ? 'First payment' : 'Date';
    form.classList.toggle('is-plan', on);
    countChips.querySelectorAll('.chip').forEach((chip) => chip.classList.toggle('is-on', chip.dataset.count === countInput.value));

    const kind = draft.type === 'income' ? 'income' : 'expense';
    let title = isNew ? `New ${kind}` : `Edit ${kind}`;
    if (on) title = plan ? 'Edit installments' : 'New installment plan';
    form.querySelector('.sheet-title').textContent = title;

    if (on) {
      const count = paymentCount();
      const total = currentAmount();
      if (!Number.isInteger(count) || count < 2 || count > store.MAX_PAYMENTS) {
        planPreview.textContent = `Choose between 2 and ${store.MAX_PAYMENTS} payments.`;
      } else if (!(total > 0)) {
        planPreview.textContent = `${count} monthly payments. Enter the total amount above.`;
      } else if (toAgorot(total) < count) {
        planPreview.textContent = 'The total is too small for that many payments.';
      } else {
        const parts = store.splitPayments(total, count);
        const last = isDateKey(dateInput.value) ? ` The last one is on ${shortDate(store.paymentDate(dateInput.value, count - 1))}.` : '';
        const first = parts[0] !== parts[1] ? ` (the first is ${money(parts[0])})` : '';
        planPreview.textContent = `${count} monthly payments of ${money(parts[1])}${first}.${last}`;
      }
    }
    refreshSaveState();
  }

  function currentAmount() {
    return parseAmount(amountInput.value);
  }

  function refreshSaveState() {
    const value = currentAmount();
    let ok = value > 0;
    if (ok && planMode()) {
      const count = paymentCount();
      ok = Number.isInteger(count) && count >= 2 && count <= store.MAX_PAYMENTS && toAgorot(value) >= count;
    }
    saveButton.disabled = !ok;
  }

  function refreshAmount() {
    // Keep digits and one decimal separator with at most two decimals.
    const raw = amountInput.value;
    let cleaned = raw.replace(/[^\d.,]/g, '');
    const sep = cleaned.search(/[.,]/);
    if (sep >= 0) {
      cleaned = cleaned.slice(0, sep + 1) + cleaned.slice(sep + 1).replace(/[.,]/g, '').slice(0, 2);
    }
    cleaned = cleaned.replace(/^0+(?=\d)/, '');
    if (cleaned !== raw) amountInput.value = cleaned;
    sizer.textContent = cleaned || '0';
    amountField.classList.toggle('has-value', Boolean(cleaned));
    if (currentAmount() > 0) amountError.textContent = '';
    syncPlanUi();
  }
  amountInput.addEventListener('input', refreshAmount);
  amountInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      noteInput.focus();
    }
  });
  for (const input of [dateInput, noteInput, countInput]) {
    input.addEventListener('focus', () => setTimeout(() => input.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 350));
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const amount = currentAmount();
    if (!(amount > 0)) {
      amountError.textContent = 'Enter an amount above zero.';
      shake(amountField);
      amountInput.focus();
      return;
    }
    if (amount > store.MAX_AMOUNT) {
      amountError.textContent = 'That amount is too large.';
      shake(amountField);
      return;
    }
    if (!isDateKey(dateInput.value)) {
      shake(dateInput.closest('.form-row'));
      dateInput.focus();
      return;
    }
    const inPlan = planMode();
    const count = paymentCount();
    if (inPlan && (!Number.isInteger(count) || count < 2 || count > store.MAX_PAYMENTS || toAgorot(amount) < count)) {
      shake(countRow);
      countInput.focus();
      return;
    }
    let message;
    try {
      if (inPlan) {
        const payload = { total: amount, count, firstDate: dateInput.value, method: draft.method, note: noteInput.value };
        if (plan) {
          store.updatePlan(plan.id, payload);
          message = 'Installment plan saved';
        } else {
          const added = store.addPlan(payload);
          state.flashId = added.id;
          saveUi({ lastMethod: draft.method });
          requestPersistentStorage();
          message = `Plan added: ${count} payments of ${money(store.splitPayments(amount, count)[1])}`;
        }
      } else {
        const payload = { type: draft.type, method: draft.method, amount, date: dateInput.value, note: noteInput.value };
        if (isNew) {
          const tx = store.addTransaction(payload);
          state.flashId = tx.id;
          saveUi({ lastMethod: draft.method });
          requestPersistentStorage();
          message = `${draft.type === 'income' ? 'Income' : 'Expense'} of ${money(toAgorot(amount))} added`;
        } else {
          store.updateTransaction(existing.id, payload);
          message = 'Changes saved';
        }
      }
    } catch (err) {
      showError(err);
      return;
    }
    layer.close();
    haptic();
    toast(message, { iconName: 'check', duration: 2800 });
  });

  cancelButton.addEventListener('click', () => layer.close());

  refreshAmount();
  syncChips();

  const layer = openLayer({ kind: 'page', content: form, labelledBy: titleId, autoFocus: !isNew });
  if (isNew) {
    let done = false;
    const focusAmount = () => {
      if (done) return;
      done = true;
      handOverKeyboard(amountInput);
    };
    if (prefersReducedMotion()) focusAmount();
    else {
      layer.panel.addEventListener('transitionend', focusAmount, { once: true });
      setTimeout(focusAmount, 520);
    }
  }
}

function shake(el) {
  if (!el || prefersReducedMotion()) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}

// ---------------------------------------------------------------------------
// Delete, backup, restore
// ---------------------------------------------------------------------------

function deleteWithUndo(id) {
  let tx;
  try {
    tx = store.deleteTransaction(id);
  } catch (err) {
    showError(err);
    markDirty(...VIEWS);
    render();
    return;
  }
  if (!tx) return;
  haptic();
  toast('Transaction deleted', {
    iconName: 'trash',
    actionLabel: 'Undo',
    onAction: () => {
      try {
        store.restoreTransactions([tx]);
      } catch (err) {
        showError(err);
      }
    },
  });
}

/** "62 transactions and 2 installment plans" */
function dataDescription({ transactions, plans }) {
  const parts = [plural(transactions.length, 'transaction')];
  if (plans.length) parts.push(plural(plans.length, 'installment plan'));
  return parts.join(' and ');
}

const hasData = (data) => data.transactions.length > 0 || data.plans.length > 0;

async function deleteAll() {
  const before = store.snapshot();
  if (!hasData(before)) return;
  const choice = await alertDialog({
    title: 'Delete all data?',
    message: `This removes all ${dataDescription(before)} from this device. Export a backup first if you might need them later.`,
    actions: [
      { label: 'Cancel', role: 'cancel' },
      { label: 'Delete', value: 'delete', role: 'destructive' },
    ],
  });
  if (choice !== 'delete') return;
  try {
    store.restoreSnapshot({ transactions: [], plans: [] });
  } catch (err) {
    showError(err);
    return;
  }
  toast('All data deleted', {
    iconName: 'trash',
    actionLabel: 'Undo',
    duration: 7000,
    onAction: () => {
      try {
        store.restoreSnapshot(before);
      } catch (err) {
        showError(err);
      }
    },
  });
}

async function exportBackup() {
  const backup = store.buildBackup();
  if (!hasData(backup)) {
    await alertDialog({ title: 'Nothing to back up yet', message: 'Add a transaction first.', actions: [{ label: 'OK', role: 'cancel' }] });
    return;
  }
  const name = `expenses-backup-${todayKey()}.json`;
  const file = new File([JSON.stringify(backup, null, 2)], name, { type: 'application/json' });
  const touch = window.matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      // On iPhone this opens the share sheet: choose "Save to Files" (or AirDrop, Mail…).
      await navigator.share({ files: [file], title: 'Expenses backup' });
      markBackedUp();
      toast('Backup saved', { iconName: 'check' });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return; // closed the share sheet
    }
  }
  downloadFile(file);
  markBackedUp();
  toast('Backup saved to your downloads', { iconName: 'check' });
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const link = h('a', { href: url, download: file.name, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function markBackedUp() {
  store.setMeta({ lastBackupAt: Date.now(), backupSnoozedUntil: null });
  markDirty('home', 'settings');
  render();
}

function setupImport() {
  const input = document.getElementById('import-file');
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.value = ''; // allows choosing the same file again later
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      await alertDialog({ title: 'File too large', message: 'This does not look like an Expenses backup.', actions: [{ label: 'OK', role: 'cancel' }] });
      return;
    }
    let parsed;
    try {
      parsed = store.parseBackup(await file.text());
    } catch (err) {
      await alertDialog({
        title: "Couldn't import",
        message: err instanceof store.BackupError ? err.message : 'The file could not be read.',
        actions: [{ label: 'OK', role: 'cancel' }],
      });
      return;
    }
    const before = store.snapshot();
    const count = dataDescription(parsed);
    const from = parsed.exportedAt && dateTime(parsed.exportedAt) ? `Backup from ${dateTime(parsed.exportedAt)}. ` : '';
    let mode = 'replace';
    if (hasData(before)) {
      mode = await actionSheet({
        title: `Import ${count}?`,
        message: `${from}You have ${dataDescription(before)} on this device — replace them with the backup, or combine both?`,
        actions: [
          { label: 'Replace all data', value: 'replace', role: 'destructive' },
          { label: 'Merge with current data', value: 'merge' },
          { label: 'Cancel', role: 'cancel' },
        ],
      });
      if (!mode) return;
    }
    let message;
    try {
      if (mode === 'replace') {
        // Backups made before installments existed have no plans: keep the ones on this phone.
        store.restoreSnapshot({ transactions: parsed.transactions, plans: parsed.hasPlans ? parsed.plans : before.plans });
        message = `Restored ${count}`;
      } else {
        const tx = store.mergeTransactions(parsed.transactions);
        const plans = store.mergePlans(parsed.plans);
        const added = [];
        if (tx.added) added.push(plural(tx.added, 'transaction'));
        if (plans.added) added.push(plural(plans.added, 'plan'));
        const updated = tx.updated + plans.updated;
        message = added.length || updated
          ? `${added.length ? `Added ${added.join(' and ')}` : 'Nothing new'}${updated ? `, updated ${updated}` : ''}`
          : 'Everything was already here';
      }
    } catch (err) {
      showError(err);
      return;
    }
    if (parsed.skipped) message += ` · ${plural(parsed.skipped, 'entry', 'entries')} skipped`;
    toast(message, {
      iconName: 'check',
      actionLabel: 'Undo',
      duration: 7000,
      onAction: () => {
        try {
          store.restoreSnapshot(before);
        } catch (err) {
          showError(err);
        }
      },
    });
  });
}

function showError(err) {
  console.error(err);
  toast(err instanceof store.StorageError ? err.message : 'Something went wrong. Please try again.', { iconName: 'alert', duration: 5000 });
}

let persistRequested = false;
function requestPersistentStorage() {
  // Asks the browser to keep this app's data even when the phone is low on space.
  if (persistRequested || !navigator.storage || !navigator.storage.persist) return;
  persistRequested = true;
  navigator.storage.persisted()
    .then((persisted) => persisted || navigator.storage.persist())
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// Small persisted UI preferences
// ---------------------------------------------------------------------------

function readUi() {
  try {
    const parsed = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveUi(patch) {
  ui = { ...ui, ...patch };
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(ui));
  } catch {
    /* not critical */
  }
}

// ---------------------------------------------------------------------------
// Offline support & updates
// ---------------------------------------------------------------------------

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });
  navigator.serviceWorker.register('./sw.js').then((registration) => {
    if (registration.waiting && navigator.serviceWorker.controller) offerUpdate(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(worker);
      });
    });
    // Look for a new version whenever the app comes back to the foreground.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration.update().catch(() => {});
    });
  }).catch((err) => console.warn('Offline mode is unavailable:', err));
}

function offerUpdate(worker) {
  state.waitingWorker = worker;
  markDirty('settings');
  render();
  toast('A new version of Expenses is ready', { iconName: 'sparkle', actionLabel: 'Update', duration: 12000, onAction: applyUpdate });
}

function applyUpdate() {
  if (state.waitingWorker) state.waitingWorker.postMessage({ type: 'SKIP_WAITING' });
}

init();
