// Interactive SVG charts, drawn by hand so the app works offline with no libraries.
// Tap (or use the keyboard) to read exact numbers; every chart also has a table view.
// Colors come from CSS variables (see "Chart colors" in app.css) so light and dark
// mode each get their own color-blind-checked palette.

import { h, svg, prefersReducedMotion } from './dom.js';
import { money, compactMoney, monthName, percent, shortDate, pad2 } from './format.js';

const PLOT_HEIGHT = 168;
const TOP_PAD = 14;
const AXIS_BAND = 26;
const Y_LABEL_WIDTH = 46;
const CHART_HEIGHT = TOP_PAD + PLOT_HEIGHT + AXIS_BAND;

let chartId = 0;

/** Rounded axis maximum and tick values (whole shekels, in agorot). */
export function niceScale(maxValue, maxTicks = 4) {
  const max = Math.max(maxValue, 100);
  const rough = max / maxTicks;
  const magnitude = Math.max(100, 10 ** Math.floor(Math.log10(rough)));
  const residual = rough / magnitude;
  const step = (residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10) * magnitude;
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return { top, ticks };
}

function observeWidth(el, callback) {
  let last = 0;
  const ro = new ResizeObserver((entries) => {
    const width = Math.floor(entries[0].contentRect.width);
    if (width > 0 && width !== last) {
      last = width;
      callback(width);
    }
  });
  ro.observe(el);
  return ro;
}

/** Column with a 4px rounded top, square at the baseline. */
function columnPath(x, top, width, height, radius = 4) {
  if (height <= 0) return '';
  const r = Math.min(radius, width / 2, height);
  const bottom = top + height;
  return `M${x},${bottom}V${top + r}a${r},${r} 0 0 1 ${r},${-r}h${width - 2 * r}a${r},${r} 0 0 1 ${r},${r}V${bottom}Z`;
}

function gridAndTicks(root, ticks, yOf, plotWidth, width) {
  for (const tick of ticks) {
    const y = Math.round(yOf(tick)) + 0.5;
    root.append(svg('line', { class: tick === 0 ? 'chart-baseline' : 'chart-grid', x1: 0, x2: plotWidth, y1: y, y2: y }));
    root.append(svg('text', { class: 'chart-tick', x: width, y, dy: '0.35em', 'text-anchor': 'end' }, compactMoney(tick)));
  }
}

function readoutItem({ key, value, label, sub, muted }) {
  return h('div', { class: `readout-item${muted ? ' is-muted' : ''}` },
    key ? h('span', { class: `readout-key key-${key.shape} ${key.className}`, 'aria-hidden': 'true' }) : null,
    h('span', { class: 'readout-text' },
      h('span', { class: 'readout-value' }, value),
      h('span', { class: 'readout-label' }, label),
      sub ? h('span', { class: 'readout-sub' }, sub) : null));
}

function dataTable(caption, columns, rows) {
  return h('table', { class: 'data-table' },
    h('caption', { class: 'visually-hidden' }, caption),
    h('thead', null, h('tr', null, columns.map((c, i) => h('th', { scope: 'col', class: i ? 'num' : '' }, c)))),
    h('tbody', null, rows.map((row) =>
      h('tr', null, row.map((cell, i) => (i === 0 ? h('th', { scope: 'row' }, cell) : h('td', { class: 'num' }, cell)))))));
}

// ---------------------------------------------------------------------------
// Income vs expenses per month — grouped columns
// ---------------------------------------------------------------------------

export function createMonthlyBars() {
  const id = ++chartId;
  const readout = h('div', { class: 'readout', 'aria-live': 'polite' });
  const plot = h('div', { class: 'chart-plot' });
  const el = h('div', { class: 'chart' }, readout, plot);
  const table = h('div', { class: 'chart-table' });
  let data = null;
  let width = 0;
  let active = null; // index the user tapped
  let animate = true;
  let groups = [];

  observeWidth(plot, (w) => {
    width = w;
    draw();
  });

  function focusIndex() {
    return data ? data.months.findIndex((m) => m.key === data.focusKey) : -1;
  }

  function update(next) {
    data = next;
    active = null;
    animate = true;
    draw();
    renderTable();
  }

  function draw() {
    if (!data || !width) return;
    const { months } = data;
    const plotWidth = width - Y_LABEL_WIDTH;
    const max = Math.max(0, ...months.map((m) => Math.max(m.income, m.expense)));
    const { top, ticks } = niceScale(max);
    const yOf = (v) => TOP_PAD + PLOT_HEIGHT - (v / top) * PLOT_HEIGHT;
    const band = plotWidth / months.length;
    const barWidth = Math.max(4, Math.min(20, band * 0.3));
    const labelEvery = months.length > 8 ? 2 : 1;

    const root = svg('svg', {
      class: 'chart-svg',
      width,
      height: CHART_HEIGHT,
      viewBox: `0 0 ${width} ${CHART_HEIGHT}`,
      role: 'group',
      'aria-label': `Income and expenses per month, ${data.rangeLabel}. Use the table button for all values.`,
    });
    gridAndTicks(root, ticks, yOf, plotWidth, width);

    groups = months.map((m, i) => {
      const center = i * band + band / 2;
      const g = svg('g', { class: 'bar-group', style: { '--i': i } });
      g.append(svg('rect', { class: 'bar-band', x: i * band + 2, y: TOP_PAD - 6, width: band - 4, height: PLOT_HEIGHT + 6, rx: 8 }));
      const incomeHeight = (m.income / top) * PLOT_HEIGHT;
      const expenseHeight = (m.expense / top) * PLOT_HEIGHT;
      if (m.income > 0) g.append(svg('path', { class: 'bar bar-income', d: columnPath(center - 1 - barWidth, yOf(m.income), barWidth, Math.max(1, incomeHeight)) }));
      if (m.expense > 0) g.append(svg('path', { class: 'bar bar-expense', d: columnPath(center + 1, yOf(m.expense), barWidth, Math.max(1, expenseHeight)) }));
      if (i % labelEvery === 0 || m.key === data.focusKey) {
        g.append(svg('text', {
          class: `chart-xlabel${m.key === data.focusKey ? ' is-focus' : ''}`,
          x: center,
          y: TOP_PAD + PLOT_HEIGHT + 18,
          'text-anchor': 'middle',
        }, monthName(m.key, 'short')));
      }
      const hit = svg('rect', {
        class: 'chart-hit',
        x: i * band,
        y: 0,
        width: band,
        height: CHART_HEIGHT,
        tabindex: '0',
        role: 'button',
        'aria-label': `${monthName(m.key)}: income ${money(m.income)}, expenses ${money(m.expense)}`,
      });
      hit.addEventListener('click', () => select(active === i ? null : i));
      hit.addEventListener('focus', () => {
        // Keyboard focus shows the same numbers a tap does.
        let keyboard = false;
        try {
          keyboard = hit.matches(':focus-visible');
        } catch {
          /* older browsers */
        }
        if (active !== i && keyboard) select(i);
      });
      hit.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault();
          const next = Math.min(months.length - 1, Math.max(0, i + (event.key === 'ArrowRight' ? 1 : -1)));
          groups[next].querySelector('.chart-hit').focus();
          select(next);
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          select(active === i ? null : i);
        } else if (event.key === 'Escape' && active !== null) {
          event.stopPropagation();
          select(null);
        }
      });
      g.append(hit);
      root.append(g);
      return g;
    });

    if (animate && !prefersReducedMotion()) root.classList.add('is-entering');
    animate = false;
    plot.replaceChildren(root);
    if (!months.some((m) => m.income || m.expense)) {
      plot.append(h('p', { class: 'chart-empty' }, 'No transactions in these months yet'));
    }
    paintSelection();
  }

  function select(index) {
    active = index;
    paintSelection();
  }

  function paintSelection() {
    const current = active ?? focusIndex();
    groups.forEach((g, i) => {
      g.classList.toggle('is-active', i === current);
      g.classList.toggle('is-dimmed', active !== null && i !== active);
      g.querySelector('.chart-hit').setAttribute('aria-pressed', String(i === active));
    });
    renderReadout(current);
  }

  function renderReadout(index) {
    const month = index >= 0 ? data.months[index] : null;
    const income = month ? month.income : data.months.reduce((s, m) => s + m.income, 0);
    const expense = month ? month.expense : data.months.reduce((s, m) => s + m.expense, 0);
    const net = income - expense;
    readout.replaceChildren(
      h('p', { class: 'readout-caption' }, month ? monthName(month.key) : `${data.rangeLabel} · total`),
      h('div', { class: 'readout-items' },
        readoutItem({ key: { shape: 'bar', className: 'is-income' }, value: money(income), label: 'Income' }),
        readoutItem({ key: { shape: 'bar', className: 'is-expense' }, value: money(expense), label: 'Expenses' })),
      h('p', { class: 'readout-note' },
        h('strong', null, money(net, { sign: true })),
        net >= 0 ? ' saved' : ' overspent'));
  }

  function renderTable() {
    table.replaceChildren(dataTable(
      'Income and expenses per month',
      ['Month', 'Income', 'Expenses', 'Net'],
      data.months.map((m) => [monthName(m.key, 'shortYear'), money(m.income), money(m.expense), money(m.income - m.expense, { sign: true })]),
    ));
  }

  return { el, table, update, id };
}

// ---------------------------------------------------------------------------
// Spending over time — cumulative line for a month (vs the month before),
// or monthly spending when "All months" is selected
// ---------------------------------------------------------------------------

export function createSpendingLine() {
  const readout = h('div', { class: 'readout', 'aria-live': 'polite' });
  const plot = h('div', { class: 'chart-plot' });
  const el = h('div', { class: 'chart' }, readout, plot);
  const table = h('div', { class: 'chart-table' });
  let data = null;
  let width = 0;
  let scrub = null; // x index being inspected
  let animate = true;
  let parts = null;

  observeWidth(plot, (w) => {
    width = w;
    draw();
  });

  function update(next) {
    data = next;
    scrub = null;
    animate = true;
    draw();
    renderTable();
  }

  function draw() {
    if (!data || !width) return;
    const plotWidth = width - Y_LABEL_WIDTH;
    const { current, previous, xCount } = data;
    const max = Math.max(0, ...current, ...(previous || []));
    const { top, ticks } = niceScale(max);
    const xOf = (i) => (xCount <= 1 ? plotWidth / 2 : (i / (xCount - 1)) * (plotWidth - 8) + 4);
    const yOf = (v) => TOP_PAD + PLOT_HEIGHT - (v / top) * PLOT_HEIGHT;
    const baseline = yOf(0);
    const toPath = (values) => values.map((v, i) => `${i ? 'L' : 'M'}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join('');

    const root = svg('svg', {
      class: 'chart-svg',
      width,
      height: CHART_HEIGHT,
      viewBox: `0 0 ${width} ${CHART_HEIGHT}`,
      role: 'group',
      'aria-label': data.ariaLabel,
    });
    gridAndTicks(root, ticks, yOf, plotWidth, width);

    for (const tick of data.xTicks) {
      root.append(svg('text', {
        class: 'chart-xlabel',
        x: Math.min(Math.max(xOf(tick.index), 14), plotWidth - 14),
        y: TOP_PAD + PLOT_HEIGHT + 18,
        'text-anchor': 'middle',
      }, tick.label));
    }

    if (previous && previous.length) {
      root.append(svg('path', { class: 'line line-context', d: toPath(previous) }));
    }

    let endDot = null;
    if (current.length) {
      const lastIndex = current.length - 1;
      const area = `${toPath(current)}L${xOf(lastIndex).toFixed(1)},${baseline}L${xOf(0).toFixed(1)},${baseline}Z`;
      root.append(svg('path', { class: 'area area-expense', d: current.length > 1 ? area : '' }));
      const line = svg('path', { class: 'line line-expense', d: toPath(current) });
      root.append(line);
      const ex = xOf(lastIndex);
      const ey = yOf(current[lastIndex]);
      endDot = svg('circle', { class: 'dot dot-expense', cx: ex, cy: ey, r: 4 });
      root.append(endDot);
      // Direct label at the end of the line (the one number this chart is about),
      // placed above or below the dot, whichever keeps it off the comparison line.
      const labelText = money(current[lastIndex]);
      const nearRight = ex > plotWidth * 0.62;
      const lx = nearRight ? ex - 8 : ex + 8;
      const span = labelText.length * 7.5;
      const [left, right] = nearRight ? [lx - span, lx] : [lx, lx + span];
      const contextYs = (previous || [])
        .map((v, i) => [xOf(i), yOf(v)])
        .filter(([x]) => x >= left - 6 && x <= right + 6)
        .map(([, y]) => y);
      const clashes = (baselineY) => contextYs.some((y) => y > baselineY - 15 && y < baselineY + 6);
      const aboveY = ey - 10;
      const belowY = ey + 21;
      const fitsAbove = aboveY - 12 > TOP_PAD - 6;
      const fitsBelow = belowY < baseline - 4;
      let labelY = fitsAbove ? aboveY : belowY;
      if (clashes(labelY)) {
        const other = labelY === aboveY ? belowY : aboveY;
        if ((other === aboveY ? fitsAbove : fitsBelow) && !clashes(other)) labelY = other;
      }
      root.append(svg('text', {
        class: 'chart-endlabel',
        x: lx,
        y: labelY,
        'text-anchor': nearRight ? 'end' : 'start',
      }, labelText));
      if (animate && !prefersReducedMotion()) {
        root.classList.add('is-entering');
        requestAnimationFrame(() => {
          const length = line.getTotalLength ? line.getTotalLength() : 0;
          if (length) {
            line.style.strokeDasharray = `${length}`;
            line.style.strokeDashoffset = `${length}`;
            line.getBoundingClientRect();
            line.style.transition = 'stroke-dashoffset 900ms cubic-bezier(0.22, 1, 0.36, 1)';
            line.style.strokeDashoffset = '0';
            setTimeout(() => {
              line.style.strokeDasharray = '';
              line.style.transition = '';
            }, 1000);
          }
        });
      }
    }
    animate = false;

    const cross = svg('g', { class: 'crosshair', visibility: 'hidden' });
    const crossLine = svg('line', { class: 'crosshair-line', y1: TOP_PAD - 4, y2: baseline });
    const crossPrev = svg('circle', { class: 'dot dot-context', r: 4 });
    const crossCurrent = svg('circle', { class: 'dot dot-expense', r: 4 });
    cross.append(crossLine, crossPrev, crossCurrent);
    root.append(cross);

    const overlay = svg('rect', {
      class: 'chart-scrub',
      x: 0,
      y: 0,
      width: plotWidth,
      height: CHART_HEIGHT,
      tabindex: '0',
      role: 'slider',
      'aria-label': 'Inspect spending by date. Use the arrow keys.',
      'aria-valuemin': '0',
      'aria-valuemax': String(xCount - 1),
    });
    root.append(overlay);

    const indexAt = (clientX) => {
      const rect = root.getBoundingClientRect();
      const x = clientX - rect.left;
      const i = Math.round(((x - 4) / Math.max(1, plotWidth - 8)) * (xCount - 1));
      return Math.min(maxIndex(), Math.max(0, i));
    };
    overlay.addEventListener('pointerdown', (event) => {
      if (!event.isPrimary) return;
      setScrub(indexAt(event.clientX));
    });
    overlay.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'mouse' || event.buttons || event.pressure > 0) setScrub(indexAt(event.clientX));
    });
    overlay.addEventListener('pointerleave', (event) => {
      // A mouse pointer shows numbers on hover only; on touch they stay until the next tap.
      if (event.pointerType === 'mouse' && document.activeElement !== overlay) setScrub(null);
    });
    overlay.addEventListener('keydown', (event) => {
      const step = { ArrowRight: 1, ArrowLeft: -1, ArrowUp: 1, ArrowDown: -1 }[event.key];
      if (step) {
        event.preventDefault();
        setScrub(Math.min(maxIndex(), Math.max(0, (scrub ?? (current.length || 1) - 1) + step)));
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        setScrub(event.key === 'Home' ? 0 : maxIndex());
      } else if (event.key === 'Escape' && scrub !== null) {
        event.stopPropagation();
        setScrub(null);
      }
    });
    overlay.addEventListener('focus', () => {
      if (scrub === null) setScrub(Math.max(0, current.length - 1));
    });

    parts = { cross, crossLine, crossPrev, crossCurrent, overlay, xOf, yOf, endDot };
    plot.replaceChildren(root);
    if (!max) plot.append(h('p', { class: 'chart-empty' }, data.emptyText));
    paintScrub();
  }

  function maxIndex() {
    return Math.max(data.current.length, data.previous ? data.previous.length : 0, 1) - 1;
  }

  function setScrub(index) {
    if (index === scrub) return;
    scrub = index;
    paintScrub();
  }

  function paintScrub() {
    const { cross, crossLine, crossPrev, crossCurrent, overlay, xOf, yOf } = parts;
    if (scrub === null) {
      cross.setAttribute('visibility', 'hidden');
      overlay.removeAttribute('aria-valuenow');
    } else {
      const x = xOf(scrub);
      cross.setAttribute('visibility', 'visible');
      crossLine.setAttribute('x1', x);
      crossLine.setAttribute('x2', x);
      placeDot(crossCurrent, data.current[scrub], x, yOf);
      placeDot(crossPrev, data.previous ? data.previous[scrub] : undefined, x, yOf);
      overlay.setAttribute('aria-valuenow', String(scrub));
      overlay.setAttribute('aria-valuetext', data.describe(scrub));
    }
    readout.replaceChildren(...data.readout(scrub));
  }

  function placeDot(dot, value, x, yOf) {
    if (value === undefined) {
      dot.setAttribute('visibility', 'hidden');
      return;
    }
    dot.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', x);
    dot.setAttribute('cy', yOf(value));
  }

  function renderTable() {
    table.replaceChildren(data.table());
  }

  /** Clears the inspected point (e.g. when the user taps elsewhere). */
  function clear() {
    setScrub(null);
  }

  return { el, table, update, clear };
}

/** Builds the data the spending line needs for one month. */
export function dailySpendingData({ monthKey, perDay, prevKey, prevPerDay, lastDay }) {
  const cumulative = (values, upTo) => {
    const out = [];
    let sum = 0;
    for (let i = 0; i < upTo; i += 1) {
      sum += values[i];
      out.push(sum);
    }
    return out;
  };
  const current = cumulative(perDay, lastDay);
  const hasPrev = prevPerDay && prevPerDay.some((v) => v > 0);
  const previous = hasPrev ? cumulative(prevPerDay, prevPerDay.length) : null;
  const xCount = Math.max(perDay.length, previous ? previous.length : 0);
  const monthShort = monthName(monthKey, 'short');
  const prevShort = monthName(prevKey, 'short');
  const prevLong = monthName(prevKey, 'name');
  const thisLong = monthName(monthKey, 'name');
  const ongoing = lastDay > 0 && lastDay < perDay.length;
  const dayLabel = (i, m) => `${i + 1} ${m}`;
  const xTicks = [0, 7, 14, 21, 28].filter((i) => i < perDay.length).map((i) => ({ index: i, label: dayLabel(i, monthShort) }));

  const readout = (scrub) => {
    const items = [];
    if (scrub === null) {
      const total = current.length ? current[current.length - 1] : 0;
      items.push(readoutItem({
        key: { shape: 'line', className: 'is-expense' },
        value: money(total),
        label: ongoing ? `spent so far in ${thisLong}` : `spent in ${thisLong}`,
      }));
      if (previous) {
        const sameDay = ongoing ? previous[Math.min(lastDay, previous.length) - 1] : previous[previous.length - 1];
        items.push(readoutItem({
          key: { shape: 'line', className: 'is-context' },
          value: money(sameDay ?? 0),
          label: ongoing ? `by ${dayLabel(Math.min(lastDay, previous.length) - 1, prevShort)}` : `in ${prevLong}`,
        }));
      }
    } else {
      const has = scrub < current.length;
      items.push(readoutItem({
        key: { shape: 'line', className: 'is-expense' },
        value: has ? money(current[scrub]) : '—',
        label: `spent by ${dayLabel(scrub, monthShort)}`,
        sub: has ? `${money(perDay[scrub])} that day` : 'not yet',
      }));
      if (previous) {
        const hasPrevDay = scrub < previous.length;
        items.push(readoutItem({
          key: { shape: 'line', className: 'is-context' },
          value: hasPrevDay ? money(previous[scrub]) : '—',
          label: hasPrevDay ? `by ${dayLabel(scrub, prevShort)}` : `${prevLong} had ${previous.length} days`,
          sub: hasPrevDay ? `${money(prevPerDay[scrub])} that day` : null,
        }));
      }
    }
    return [
      h('p', { class: 'readout-caption' }, scrub === null ? 'Total spending, day by day' : shortDate(`${monthKey}-${pad2(scrub + 1)}`)),
      h('div', { class: 'readout-items' }, items),
    ];
  };

  return {
    current,
    previous,
    xCount,
    xTicks,
    emptyText: `No spending in ${thisLong} yet`,
    ariaLabel: `Running total of spending in ${monthName(monthKey)}${previous ? `, compared with ${prevLong}` : ''}. Use the table button for all values.`,
    readout,
    describe: (i) => `${dayLabel(i, monthShort)}: ${i < current.length ? money(current[i]) : 'no data yet'}`,
    table: () => dataTable(
      `Spending in ${monthName(monthKey)}`,
      ['Day', 'That day', 'Running total', ...(previous ? [`${prevShort} total`] : [])],
      Array.from({ length: xCount }, (_, i) => [
        String(i + 1),
        i < current.length ? money(perDay[i]) : '—',
        i < current.length ? money(current[i]) : '—',
        ...(previous ? [i < previous.length ? money(previous[i]) : '—'] : []),
      ]),
    ),
  };
}

/** Builds the data the spending line needs for a list of months ("All months"). */
export function monthlySpendingData(months) {
  const values = months.map((m) => m.expense);
  const count = months.length;
  const average = count ? Math.round(values.reduce((a, b) => a + b, 0) / count) : 0;
  const every = Math.max(1, Math.ceil(count / 6));
  const xTicks = months
    .map((m, i) => ({ index: i, label: monthName(m.key, 'short') }))
    .filter((t) => (count - 1 - t.index) % every === 0);

  return {
    current: values,
    previous: null,
    xCount: count,
    xTicks,
    emptyText: 'No spending yet',
    ariaLabel: 'Spending per month. Use the table button for all values.',
    readout: (scrub) => {
      const index = scrub ?? count - 1;
      const month = months[index];
      return [
        h('p', { class: 'readout-caption' }, scrub === null ? 'Spending per month' : monthName(month.key)),
        h('div', { class: 'readout-items' },
          readoutItem({ key: { shape: 'line', className: 'is-expense' }, value: money(month ? month.expense : 0), label: `spent in ${month ? monthName(month.key, 'name') : ''}` }),
          readoutItem({ value: money(average), label: `monthly average (${count} months)`, muted: true })),
      ];
    },
    describe: (i) => `${monthName(months[i].key)}: ${money(months[i].expense)}`,
    table: () => dataTable('Spending per month', ['Month', 'Spent'], months.map((m) => [monthName(m.key, 'shortYear'), money(m.expense)])),
  };
}

// ---------------------------------------------------------------------------
// Cash vs card — two 100% split bars (spent / received)
// ---------------------------------------------------------------------------

export function createMethodSplit() {
  const el = h('div', { class: 'chart split' });
  const table = h('div', { class: 'chart-table' });
  let data = null;
  let active = null; // { row, method }
  let growIn = false;

  function update(next) {
    data = next;
    active = null;
    growIn = !prefersReducedMotion();
    render();
    table.replaceChildren(dataTable(
      'Cash and card totals',
      ['', 'Cash', 'Card', 'Total'],
      data.rows.map((r) => [r.label, money(r.cash), money(r.card), money(r.cash + r.card)]),
    ));
  }

  function render() {
    const legend = h('div', { class: 'split-legend' },
      h('span', null, h('span', { class: 'readout-key key-bar is-cash', 'aria-hidden': 'true' }), 'Cash'),
      h('span', null, h('span', { class: 'readout-key key-bar is-card', 'aria-hidden': 'true' }), 'Card'));
    const rows = data.rows.map((row) => {
      const total = row.cash + row.card;
      const segments = h('div', { class: 'split-bar' });
      const values = h('div', { class: 'split-values' });
      if (!total) {
        segments.classList.add('is-empty');
        values.append(h('span', { class: 'split-none' }, row.emptyText));
      }
      for (const method of ['cash', 'card']) {
        const value = row[method];
        if (!total) break;
        const share = value / total;
        const isActive = active && active.row === row.id && active.method === method;
        const dimmed = (active && !isActive) || (data.emphasis !== 'all' && data.emphasis !== method);
        if (value > 0) {
          const seg = h('button', {
            type: 'button',
            class: `split-seg is-${method}${isActive ? ' is-active' : ''}${dimmed ? ' is-dimmed' : ''}`,
            style: { 'flex-grow': growIn ? 0.0001 : share },
            'aria-label': `${row.label} with ${method}: ${money(value)}, ${percent(share)}`,
            'aria-pressed': String(Boolean(isActive)),
          });
          seg.dataset.share = String(share);
          seg.addEventListener('click', () => {
            active = isActive ? null : { row: row.id, method };
            render();
          });
          segments.append(seg);
        }
        values.append(h('span', { class: `split-value${isActive ? ' is-active' : ''}${dimmed ? ' is-dimmed' : ''}` },
          h('span', { class: `readout-key key-bar is-${method}`, 'aria-hidden': 'true' }),
          h('strong', null, money(value)),
          ` ${method === 'cash' ? 'Cash' : 'Card'} · ${percent(share)}`));
      }
      return h('div', { class: 'split-row' },
        h('div', { class: 'split-head' },
          h('span', { class: 'split-title' }, row.label),
          h('span', { class: 'split-total' }, money(total))),
        segments,
        values);
    });
    const detail = active ? describeActive() : null;
    el.replaceChildren(legend, ...rows, detail ? h('p', { class: 'split-detail', 'aria-live': 'polite' }, detail) : h('p', { class: 'split-detail is-hint' }, 'Tap a bar to see its share'));

    if (growIn) {
      growIn = false;
      // Grow the segments in from zero when new data arrives.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        el.querySelectorAll('.split-seg').forEach((seg) => { seg.style.flexGrow = seg.dataset.share; });
      }));
    }
  }

  function describeActive() {
    const row = data.rows.find((r) => r.id === active.row);
    const value = row[active.method];
    const total = row.cash + row.card;
    const verb = row.id === 'spent' ? 'spent' : 'received';
    return `${money(value)} ${verb} by ${active.method} — ${percent(value / total)} of ${money(total)}`;
  }

  return { el, table, update };
}

// ---------------------------------------------------------------------------
// Spending by category — one bar per category, biggest first. Each row shows
// the name, amount and share as text, so color is never the only label.
// ---------------------------------------------------------------------------

export function createCategoryBreakdown({ onSelect, renderIcon }) {
  const readout = h('div', { class: 'readout' });
  const list = h('ul', { class: 'cat-bars' });
  const el = h('div', { class: 'chart' }, readout, list);
  const table = h('div', { class: 'chart-table' });

  function update({ rows, periodLabel }) {
    const total = rows.reduce((sum, r) => sum + r.amount, 0);
    const max = rows.length ? rows[0].amount : 0;
    readout.replaceChildren(
      h('p', { class: 'readout-caption' }, periodLabel),
      h('div', { class: 'readout-items' },
        h('div', { class: 'readout-item' },
          h('span', { class: 'readout-text' },
            h('span', { class: 'readout-value' }, money(total)),
            h('span', { class: 'readout-label' }, rows.length ? `spent across ${rows.length} ${rows.length === 1 ? 'category' : 'categories'}` : 'spent')))));
    const grow = !prefersReducedMotion();
    list.replaceChildren(...rows.map((row, i) => {
      const share = total ? row.amount / total : 0;
      const fill = h('span', { class: 'cat-bar-fill', style: { '--fill': grow ? '0' : (max ? row.amount / max : 0).toFixed(4) } });
      fill.dataset.fill = (max ? row.amount / max : 0).toFixed(4);
      return h('li', null,
        h('button', {
          type: 'button',
          class: 'cat-bar-row',
          style: { '--cat': `var(--cat-${row.category.color})`, '--i': i },
          'aria-label': `${row.category.name}: ${money(row.amount)}, ${percent(share)} of spending, ${row.count} ${row.count === 1 ? 'expense' : 'expenses'}. Shows these transactions.`,
          onClick: () => onSelect(row.category.id),
        },
        h('span', { class: 'cat-bubble', 'aria-hidden': 'true' }, renderIcon(row.category.icon)),
        h('span', { class: 'cat-bar-main' },
          h('span', { class: 'cat-bar-top' },
            h('span', { class: 'cat-bar-name', dir: 'auto' }, row.category.name),
            h('span', { class: 'cat-bar-amount' }, money(row.amount)),
            h('span', { class: 'cat-bar-share' }, percent(share))),
          h('span', { class: 'cat-bar-track', 'aria-hidden': 'true' }, fill))));
    }));
    if (!rows.length) list.append(h('li', { class: 'chart-empty-row' }, 'No spending in this period yet'));
    if (grow) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        list.querySelectorAll('.cat-bar-fill').forEach((f) => f.style.setProperty('--fill', f.dataset.fill));
      }));
    }
    table.replaceChildren(dataTable('Spending by category', ['Category', 'Spent', 'Share'],
      rows.map((r) => [r.category.name, money(r.amount), percent(total ? r.amount / total : 0)])));
  }

  return { el, table, update };
}
