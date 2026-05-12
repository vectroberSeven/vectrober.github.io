/* ════════════════════════════════════════════════════
   POCKET CONTROL — script.js
   Almacenamiento: localStorage (sin backend requerido)
   Auto-refresco cada 30 segundos
   ════════════════════════════════════════════════════ */

'use strict';

/* ══════════════════════════════════════════════════════
   STORAGE — localStorage como base de datos local
══════════════════════════════════════════════════════ */

const DB = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); }
    catch { return []; }
  },
  set(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
  },
  nextId(key) {
    const rows = DB.get(key);
    return rows.length ? Math.max(...rows.map(r => r.id)) + 1 : 1;
  },
};

const KEYS = { TX: 'pc_transactions', REM: 'pc_reminders' };

/* ══════════════════════════════════════════════════════
   ESTADO GLOBAL
══════════════════════════════════════════════════════ */
const State = {
  transactions: [],
  reminders:    [],
  currentView:  'dashboard',
  editingTxId:  null,
  refreshTimer: null,
};

/* ══════════════════════════════════════════════════════
   CATEGORÍAS FIJAS
══════════════════════════════════════════════════════ */
const CATEGORIES = {
  ingreso: [
    { name: 'Salario',     icon: '💼' },
    { name: 'Freelance',   icon: '💻' },
    { name: 'Inversiones', icon: '📈' },
  ],
  egreso: [
    { name: 'Alimentación',    icon: '🍔' },
    { name: 'Transporte',      icon: '🚗' },
    { name: 'Servicios',       icon: '💡' },
    { name: 'Entretenimiento', icon: '🎮' },
    { name: 'Salud',           icon: '🏥' },
    { name: 'Educación',       icon: '📚' },
    { name: 'Otros',           icon: '📦' },
  ],
};

/* ══════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════ */

const fmt = n =>
  `$${Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function fmtDate(str) {
  if (!str) return '—';
  const d = new Date(str + 'T00:00:00');
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

const todayISO = () => new Date().toISOString().split('T')[0];

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* Toast de notificación (reemplaza alert) */
function toast(msg, type = 'success') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `toast toast-${type} show`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3200);
}

function updateLastRefreshed() {
  const el = document.getElementById('last-refreshed');
  if (!el) return;
  const now = new Date();
  el.textContent = `Actualizado: ${now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

function updateHeaderDate() {
  const el = document.getElementById('header-date');
  if (!el) return;
  el.textContent = new Date().toLocaleDateString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

/* ══════════════════════════════════════════════════════
   AUTO-REFRESCO (30 s)
══════════════════════════════════════════════════════ */

function startAutoRefresh() {
  stopAutoRefresh();
  State.refreshTimer = setInterval(() => {
    refreshCurrentView();
    updateLastRefreshed();
  }, 30_000);
}

function stopAutoRefresh() {
  if (State.refreshTimer) clearInterval(State.refreshTimer);
}

function refreshCurrentView() {
  switch (State.currentView) {
    case 'dashboard':    loadDashboard(true);     break;
    case 'transactions': refreshTransactionList(); break;
    case 'reports':      loadReports();            break;
    case 'reminders':    refreshReminderList();    break;
  }
}

/* ══════════════════════════════════════════════════════
   NAVEGACIÓN
══════════════════════════════════════════════════════ */

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${name}`)?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n =>
    n.classList.toggle('active', n.dataset.view === name));
  State.currentView = name;
  closeSidebar();
  switch (name) {
    case 'dashboard':    loadDashboard();    break;
    case 'transactions': loadTransactions(); break;
    case 'categories':   loadCategories();   break;
    case 'reports':      loadReports();      break;
    case 'reminders':    loadReminders();    break;
    case 'invoices':     loadInvoices();     break;
  }
}

/* ══════════════════════════════════════════════════════
   SIDEBAR / MÓVIL
══════════════════════════════════════════════════════ */

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}

document.getElementById('hamburger').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('open');
});
document.getElementById('sidebar-overlay').addEventListener('click', closeSidebar);

document.querySelectorAll('.nav-item[data-view]').forEach(item =>
  item.addEventListener('click', () => showView(item.dataset.view)));
document.querySelectorAll('.link-sm[data-view]').forEach(el =>
  el.addEventListener('click', () => showView(el.dataset.view)));

/* ══════════════════════════════════════════════════════
   DASHBOARD
══════════════════════════════════════════════════════ */

function calcBalance(txs) {
  let ingresos = 0, egresos = 0;
  txs.forEach(t => t.type === 'ingreso' ? (ingresos += t.amount) : (egresos += t.amount));
  return { ingresos, egresos, balance: ingresos - egresos };
}

const easeOut = t => 1 - Math.pow(1 - t, 3);

function animateValue(id, value, color) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.color = color;
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const start = performance.now();
  const dur = 700;
  (function step(now) {
    const p = Math.min((now - start) / dur, 1);
    el.textContent = sign + fmt(abs * easeOut(p));
    if (p < 1) requestAnimationFrame(step);
    else el.textContent = sign + fmt(abs);
  })(start);
}

function loadDashboard(silent = false) {
  const txs = DB.get(KEYS.TX);
  State.transactions = txs;
  const { ingresos, egresos, balance } = calcBalance(txs);

  animateValue('stat-balance', balance,   balance >= 0 ? 'var(--accent)' : 'var(--expense)');
  animateValue('stat-income',  ingresos,  'var(--income)');
  animateValue('stat-expense', egresos,   'var(--expense)');

  const trend = document.getElementById('stat-balance-trend');
  if (trend) {
    trend.textContent = balance >= 0
      ? `✓ Positivo · Ahorro del ${Math.round((balance / (ingresos || 1)) * 100)}%`
      : '⚠ Balance negativo';
    trend.style.color = balance >= 0 ? 'var(--income)' : 'var(--expense)';
  }

  const sorted = [...txs].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  renderTxList(document.getElementById('recent-transactions'), sorted.slice(0, 8), false);
  updateLastRefreshed();
}

/* ══════════════════════════════════════════════════════
   CATEGORÍAS — Pills selector
══════════════════════════════════════════════════════ */

function renderCategoryPills(type, selectedName = '') {
  const container = document.getElementById('tx-category-pills');
  if (!container) return;
  const cats  = CATEGORIES[type] || [];
  const first = selectedName || cats[0]?.name || '';

  container.innerHTML = cats.map(c => `
    <div class="cat-pill-opt${c.name === first ? ' selected' : ''}" data-cat="${escHtml(c.name)}">
      ${c.icon} ${escHtml(c.name)}
    </div>`).join('');

  document.getElementById('tx-category').value = first;

  container.querySelectorAll('.cat-pill-opt').forEach(pill => {
    pill.addEventListener('click', () => {
      container.querySelectorAll('.cat-pill-opt').forEach(p => p.classList.remove('selected'));
      pill.classList.add('selected');
      document.getElementById('tx-category').value = pill.dataset.cat;
    });
  });
}

/* ══════════════════════════════════════════════════════
   TRANSACCIONES — CRUD en localStorage
══════════════════════════════════════════════════════ */

function sortedTx() {
  return [...State.transactions].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
}

function loadTransactions() {
  renderCategoryPills('egreso');
  document.getElementById('tx-date').value = todayISO();
  State.transactions = DB.get(KEYS.TX);
  renderTxList(document.getElementById('transactions-list'), sortedTx(), true);
}

function refreshTransactionList() {
  State.transactions = DB.get(KEYS.TX);
  applyFilters();
}

function renderTxList(container, txs, withActions) {
  if (!container) return;
  if (!txs || txs.length === 0) {
    container.innerHTML = '<div class="empty-state">Sin transacciones aún. ¡Registra la primera!</div>';
    return;
  }
  container.innerHTML = txs.map(t => txRow(t, withActions)).join('');
}

function txRow(t, withActions) {
  const isIncome = t.type === 'ingreso';
  const allCats  = [...CATEGORIES.ingreso, ...CATEGORIES.egreso];
  const cat      = allCats.find(c => c.name === t.category);
  const icon     = cat ? cat.icon : (isIncome ? '↑' : '↓');
  const actions  = withActions ? `
    <div class="tx-actions">
      <button class="btn-icon" onclick="editTx(${t.id})" title="Editar">✎</button>
      <button class="btn-icon" onclick="openInvoiceForTx(${t.id})" title="Generar comprobante" style="color:var(--accent)">◈</button>
      <button class="btn-icon" onclick="deleteTx(${t.id})" title="Eliminar" style="color:var(--expense)">✕</button>
    </div>` : '';
  return `
    <div class="tx-item" id="tx-row-${t.id}">
      <div class="tx-icon ${isIncome ? 'income' : 'expense'}">${icon}</div>
      <div class="tx-info">
        <div class="tx-category">${escHtml(t.category)}</div>
        <div class="tx-desc">${escHtml(t.description || '—')}</div>
        <div class="tx-date">${fmtDate(t.date)}</div>
      </div>
      <div class="tx-amount ${isIncome ? 'income' : 'expense'}">
        ${isIncome ? '+' : '-'}${fmt(t.amount)}
      </div>
      ${actions}
    </div>`;
}

/* ── Formulario: mostrar / ocultar ── */
document.getElementById('btn-show-tx-form').addEventListener('click', () => {
  resetTxForm();
  document.getElementById('tx-form-card').classList.add('open');
  document.getElementById('tx-form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
document.getElementById('btn-close-tx-form').addEventListener('click', hideTxForm);
document.getElementById('btn-cancel-tx').addEventListener('click', hideTxForm);

function hideTxForm() {
  document.getElementById('tx-form-card').classList.remove('open');
  resetTxForm();
}

function resetTxForm() {
  document.getElementById('tx-edit-id').value       = '';
  document.getElementById('tx-amount').value         = '';
  document.getElementById('tx-description').value    = '';
  document.getElementById('tx-date').value           = todayISO();
  document.getElementById('tx-type-egreso').checked  = true;
  document.getElementById('tx-form-title').textContent = 'Nueva Transacción';
  document.getElementById('btn-save-tx').textContent   = 'Guardar transacción';
  State.editingTxId = null;
  renderCategoryPills('egreso');
}

/* Cambiar pills al cambiar tipo */
document.querySelectorAll('input[name="tx-type"]').forEach(r =>
  r.addEventListener('change', () => renderCategoryPills(r.value)));

/* ── GUARDAR transacción ── */
document.getElementById('btn-save-tx').addEventListener('click', () => {
  const type     = document.querySelector('input[name="tx-type"]:checked')?.value;
  const amountRaw = document.getElementById('tx-amount').value;
  const amount   = parseFloat(amountRaw);
  const category = document.getElementById('tx-category').value;
  const date     = document.getElementById('tx-date').value;
  const desc     = document.getElementById('tx-description').value.trim();

  /* Validaciones con mensajes claros */
  if (!type)                       { toast('Selecciona si es ingreso o egreso.', 'error'); return; }
  if (!amountRaw || isNaN(amount) || amount <= 0) { toast('Ingresa un monto válido mayor a $0.', 'error'); return; }
  if (!category)                   { toast('Selecciona una categoría.', 'error'); return; }
  if (!date)                       { toast('Selecciona una fecha.', 'error'); return; }

  const txs    = DB.get(KEYS.TX);
  const editId = document.getElementById('tx-edit-id').value;

  if (editId) {
    const idx = txs.findIndex(t => t.id === parseInt(editId));
    if (idx !== -1) txs[idx] = { ...txs[idx], type, amount, category, description: desc, date };
    DB.set(KEYS.TX, txs);
    toast('Transacción actualizada ✓');
  } else {
    txs.push({
      id: DB.nextId(KEYS.TX),
      type, amount, category, description: desc, date,
      created_at: new Date().toISOString(),
    });
    DB.set(KEYS.TX, txs);
    toast('Transacción guardada ✓');
  }

  hideTxForm();
  State.transactions = DB.get(KEYS.TX);
  renderTxList(document.getElementById('transactions-list'), sortedTx(), true);
  applyFilters();
  updateLastRefreshed();
});

/* ── EDITAR transacción ── */
function editTx(id) {
  const t = State.transactions.find(x => x.id === id);
  if (!t) return;
  document.getElementById('tx-form-card').classList.add('open');
  document.getElementById('tx-form-title').textContent  = 'Editar Transacción';
  document.getElementById('btn-save-tx').textContent    = 'Actualizar';
  document.getElementById('tx-edit-id').value           = id;
  document.getElementById('tx-amount').value            = t.amount;
  document.getElementById('tx-description').value       = t.description || '';
  document.getElementById('tx-date').value              = t.date;
  const radio = document.getElementById(`tx-type-${t.type}`);
  if (radio) radio.checked = true;
  renderCategoryPills(t.type, t.category);
  State.editingTxId = id;
  document.getElementById('tx-form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ── ELIMINAR transacción ── */
function deleteTx(id) {
  if (!confirm('¿Eliminar esta transacción?')) return;
  let txs = DB.get(KEYS.TX);
  txs = txs.filter(t => t.id !== id);
  DB.set(KEYS.TX, txs);
  State.transactions = txs;
  const row = document.getElementById(`tx-row-${id}`);
  if (row) {
    row.style.transition = 'opacity .3s, transform .3s';
    row.style.opacity    = '0';
    row.style.transform  = 'translateX(16px)';
    setTimeout(() => {
      row.remove();
      const list = document.getElementById('transactions-list');
      if (list && !list.querySelector('.tx-item'))
        list.innerHTML = '<div class="empty-state">Sin transacciones aún.</div>';
    }, 320);
  }
  toast('Transacción eliminada.');
  updateLastRefreshed();
}

/* ── Filtros ── */
document.getElementById('tx-search')?.addEventListener('input', applyFilters);
document.getElementById('tx-filter-type')?.addEventListener('change', applyFilters);

function applyFilters() {
  const query = (document.getElementById('tx-search')?.value || '').toLowerCase();
  const type  = document.getElementById('tx-filter-type')?.value || '';
  const filtered = sortedTx().filter(t => {
    const matchType = !type || t.type === type;
    const matchQ    = !query ||
      t.category.toLowerCase().includes(query) ||
      (t.description || '').toLowerCase().includes(query);
    return matchType && matchQ;
  });
  renderTxList(document.getElementById('transactions-list'), filtered, true);
}

/* ══════════════════════════════════════════════════════
   CATEGORÍAS — vista
══════════════════════════════════════════════════════ */

function loadCategories() {
  const render = (id, cats) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = cats.map(c =>
      `<div class="cat-pill"><span class="emoji">${c.icon}</span> ${escHtml(c.name)}</div>`
    ).join('');
  };
  render('cat-income',  CATEGORIES.ingreso);
  render('cat-expense', CATEGORIES.egreso);
}

/* ══════════════════════════════════════════════════════
   REPORTES
══════════════════════════════════════════════════════ */

function loadReports() {
  const txs = DB.get(KEYS.TX);

  /* Mensual */
  const monthly = {};
  txs.forEach(t => {
    const m = t.date.substring(0, 7);
    if (!monthly[m]) monthly[m] = { ingresos: 0, egresos: 0 };
    t.type === 'ingreso' ? (monthly[m].ingresos += t.amount) : (monthly[m].egresos += t.amount);
  });
  renderMonthlyChart(monthly);

  /* Por categoría — mes actual */
  const thisMonth = todayISO().substring(0, 7);
  const catMap = {};
  txs.filter(t => t.type === 'egreso' && t.date.startsWith(thisMonth))
     .forEach(t => { catMap[t.category] = (catMap[t.category] || 0) + t.amount; });
  const catArr = Object.entries(catMap)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
  renderCategoryChart(catArr);
}

function renderMonthlyChart(data) {
  const container = document.getElementById('monthly-chart');
  if (!container) return;
  const months = Object.keys(data).sort().reverse().slice(0, 6).reverse();
  if (!months.length) { container.innerHTML = '<div class="empty-state">Sin datos aún</div>'; return; }
  const maxVal = Math.max(...months.flatMap(m => [data[m].ingresos, data[m].egresos]), 1);
  container.innerHTML = months.map(m => {
    const d = data[m];
    return `
      <div class="month-row">
        <div class="month-label"><span>${formatMonthLabel(m)}</span></div>
        <div class="month-bars">
          <div class="bar-row">
            <span class="bar-label inc">Ingreso</span>
            <div class="bar-track"><div class="bar-fill inc" style="width:${(d.ingresos/maxVal*100).toFixed(1)}%"></div></div>
            <span class="bar-value">${fmt(d.ingresos)}</span>
          </div>
          <div class="bar-row">
            <span class="bar-label exp">Egreso</span>
            <div class="bar-track"><div class="bar-fill exp" style="width:${(d.egresos/maxVal*100).toFixed(1)}%"></div></div>
            <span class="bar-value">${fmt(d.egresos)}</span>
          </div>
        </div>
      </div>`;
  }).join('');
}

function renderCategoryChart(cats) {
  const container = document.getElementById('category-chart');
  if (!container) return;
  if (!cats.length) { container.innerHTML = '<div class="empty-state">Sin gastos este mes</div>'; return; }
  const max = cats[0].amount || 1;
  container.innerHTML = cats.slice(0, 8).map(c => {
    const cat  = CATEGORIES.egreso.find(x => x.name === c.category);
    return `
      <div class="cat-bar-row">
        <div class="cat-bar-header">
          <span class="cat-bar-name">${cat ? cat.icon : '📦'} ${escHtml(c.category)}</span>
          <span class="cat-bar-amount">${fmt(c.amount)}</span>
        </div>
        <div class="cat-bar-track">
          <div class="cat-bar-fill" style="width:${(c.amount/max*100).toFixed(1)}%"></div>
        </div>
      </div>`;
  }).join('');
}

function formatMonthLabel(ym) {
  const [y, m] = ym.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
}

/* ══════════════════════════════════════════════════════
   RECORDATORIOS — CRUD en localStorage
══════════════════════════════════════════════════════ */

function loadReminders() {
  const remCat = document.getElementById('rem-category');
  if (remCat) {
    const all = [...CATEGORIES.egreso, ...CATEGORIES.ingreso];
    remCat.innerHTML = all.map(c =>
      `<option value="${escHtml(c.name)}">${c.icon} ${escHtml(c.name)}</option>`
    ).join('');
  }
  refreshReminderList();
}

function refreshReminderList() {
  State.reminders = DB.get(KEYS.REM);
  const today = new Date(); today.setHours(0,0,0,0);
  const pending = State.reminders
    .filter(r => !r.is_paid)
    .map(r => {
      const due = new Date(r.due_date + 'T00:00:00');
      const days_until = Math.round((due - today) / 86400000);
      return { ...r, days_until, is_urgent: days_until <= r.reminder_days };
    })
    .sort((a, b) => a.days_until - b.days_until);
  renderReminderList(pending);
}

function renderReminderList(reminders) {
  const container = document.getElementById('reminders-list');
  if (!container) return;
  if (!reminders.length) {
    container.innerHTML = '<div class="empty-state" style="text-align:center;padding:48px;">¡Sin recordatorios pendientes! 🎉</div>';
    return;
  }
  container.innerHTML = reminders.map(r => {
    const days = r.days_until;
    const cls  = days < 0 ? 'urgent' : (r.is_urgent ? (days <= 1 ? 'urgent' : 'warning') : 'ok');
    const txt  = days < 0 ? `${Math.abs(days)}d venc.` : days === 0 ? 'Hoy' : `${days}d`;
    return `
      <div class="reminder-card ${cls}" id="rem-${r.id}">
        <div class="reminder-urgency">
          <span class="days-num">${txt}</span>
          <span class="days-label">restantes</span>
        </div>
        <div class="reminder-info">
          <div class="reminder-title">${escHtml(r.title)}</div>
          <div class="reminder-meta">${escHtml(r.category)} · Vence ${fmtDate(r.due_date)}</div>
        </div>
        <div class="reminder-amount">${fmt(r.amount)}</div>
        <div class="reminder-actions">
          <button class="btn-pay"        onclick="payReminder(${r.id})">✓ Pagado</button>
          <button class="btn-delete-rem" onclick="deleteReminder(${r.id})">✕</button>
        </div>
      </div>`;
  }).join('');
}

document.getElementById('btn-show-rem-form').addEventListener('click', () => {
  document.getElementById('rem-form-card').classList.add('open');
  document.getElementById('rem-due').value = todayISO();
  document.getElementById('rem-form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
document.getElementById('btn-close-rem-form').addEventListener('click', () =>
  document.getElementById('rem-form-card').classList.remove('open'));
document.getElementById('btn-cancel-rem').addEventListener('click', () =>
  document.getElementById('rem-form-card').classList.remove('open'));

document.getElementById('btn-save-rem').addEventListener('click', () => {
  const title         = document.getElementById('rem-title').value.trim();
  const amountRaw     = document.getElementById('rem-amount').value;
  const amount        = parseFloat(amountRaw);
  const category      = document.getElementById('rem-category').value;
  const due_date      = document.getElementById('rem-due').value;
  const reminder_days = parseInt(document.getElementById('rem-days').value) || 3;

  if (!title)                          { toast('Escribe un título.', 'error'); return; }
  if (!amountRaw || isNaN(amount) || amount <= 0) { toast('Ingresa un monto válido.', 'error'); return; }
  if (!due_date)                       { toast('Selecciona una fecha.', 'error'); return; }

  const rems = DB.get(KEYS.REM);
  rems.push({ id: DB.nextId(KEYS.REM), title, amount, category, due_date, reminder_days, is_paid: 0, created_at: new Date().toISOString() });
  DB.set(KEYS.REM, rems);

  document.getElementById('rem-form-card').classList.remove('open');
  document.getElementById('rem-title').value  = '';
  document.getElementById('rem-amount').value = '';
  toast('Recordatorio guardado ✓');
  refreshReminderList();
});

function payReminder(id) {
  const rems = DB.get(KEYS.REM);
  const idx  = rems.findIndex(r => r.id === id);
  if (idx !== -1) rems[idx].is_paid = 1;
  DB.set(KEYS.REM, rems);
  const el = document.getElementById(`rem-${id}`);
  if (el) {
    el.style.transition = 'opacity .4s, transform .4s';
    el.style.opacity    = '0';
    el.style.transform  = 'translateX(20px)';
    setTimeout(refreshReminderList, 420);
  }
  toast('¡Marcado como pagado! ✓');
}

function deleteReminder(id) {
  if (!confirm('¿Eliminar este recordatorio?')) return;
  DB.set(KEYS.REM, DB.get(KEYS.REM).filter(r => r.id !== id));
  toast('Recordatorio eliminado.');
  refreshReminderList();
}

/* ══════════════════════════════════════════════════════
   FACTURACIÓN — Comprobantes de transacciones
══════════════════════════════════════════════════════ */

const KEYS_INV = 'pc_invoices';

/* ── Helpers de factura ── */
function nextFolio() {
  const invs = DB.get(KEYS_INV);
  const num  = invs.length ? Math.max(...invs.map(i => i.folio)) + 1 : 1;
  return num;
}

function calcInvTotals(items, ivaPct) {
  const subtotal = items.reduce((s, i) => s + (i.qty * i.price), 0);
  const iva      = subtotal * (ivaPct / 100);
  const total    = subtotal + iva;
  return { subtotal, iva, total };
}

/* ── Cargar vista ── */
function loadInvoices() {
  refreshInvoiceList();
  populateTxSelect();
}

function populateTxSelect() {
  const sel = document.getElementById('inv-tx-select');
  if (!sel) return;
  const txs = DB.get(KEYS.TX).sort((a,b) => b.date.localeCompare(a.date) || b.id - a.id);
  sel.innerHTML = '<option value="">— Selecciona una transacción —</option>' +
    txs.map(t =>
      `<option value="${t.id}">${fmtDate(t.date)} · ${escHtml(t.category)} · ${fmt(t.amount)} (${t.type})</option>`
    ).join('');
}

function refreshInvoiceList() {
  const container = document.getElementById('invoices-list');
  if (!container) return;
  const invs = DB.get(KEYS_INV).sort((a,b) => b.folio - a.folio);
  if (!invs.length) {
    container.innerHTML = '<div class="empty-state">No hay comprobantes generados aún. Usa el botón ◈ en una transacción o "+ Nuevo Comprobante".</div>';
    return;
  }
  container.innerHTML = invs.map(inv => `
    <div class="invoice-card" id="inv-card-${inv.folio}">
      <div class="invoice-card-folio">
        <span class="inv-folio-num">FC-${String(inv.folio).padStart(4,'0')}</span>
        <span class="inv-chip ${inv.tx_type === 'ingreso' ? 'chip-income' : 'chip-expense'}">${inv.tx_type}</span>
      </div>
      <div class="invoice-card-info">
        <div class="invoice-card-title">${escHtml(inv.receptor_nombre || 'Sin receptor')}</div>
        <div class="invoice-card-sub">${escHtml(inv.emisor_nombre || 'Sin emisor')} · ${fmtDate(inv.fecha_emision)}</div>
      </div>
      <div class="invoice-card-total">${fmt(inv.total)}</div>
      <div class="invoice-card-actions">
        <button class="btn btn-ghost btn-sm" onclick="viewInvoice(${inv.folio})">Ver</button>
        <button class="btn-delete-rem" onclick="deleteInvoice(${inv.folio})">✕</button>
      </div>
    </div>
  `).join('');
}

/* ── Abrir modal desde transacción ── */
function openInvoiceForTx(txId) {
  showView('invoices');
  setTimeout(() => {
    openInvoiceModal();
    const sel = document.getElementById('inv-tx-select');
    if (sel) sel.value = txId;
    autoFillFromTx(txId);
  }, 80);
}

function autoFillFromTx(txId) {
  const t = DB.get(KEYS.TX).find(x => x.id === parseInt(txId));
  if (!t) return;
  const descEl  = document.querySelector('#inv-items-container .inv-desc');
  const priceEl = document.querySelector('#inv-items-container .inv-price');
  const qtyEl   = document.querySelector('#inv-items-container .inv-qty');
  if (descEl)  descEl.value  = t.description || t.category;
  if (priceEl) priceEl.value = t.amount;
  if (qtyEl)   qtyEl.value   = 1;
}

/* ── Modal: abrir / cerrar ── */
function openInvoiceModal() {
  populateTxSelect();
  resetInvoiceForm();
  document.getElementById('invoice-modal-overlay').classList.remove('hidden');
}
function closeInvoiceModal() {
  document.getElementById('invoice-modal-overlay').classList.add('hidden');
}

function resetInvoiceForm() {
  ['inv-em-nombre','inv-em-rfc','inv-em-dir','inv-em-email',
   'inv-rec-nombre','inv-rec-rfc','inv-rec-dir','inv-rec-email','inv-firma'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('inv-iva').value     = '16';
  document.getElementById('inv-payment').value = 'Efectivo';
  document.getElementById('inv-tx-select').value = '';
  // Reset items
  const cont = document.getElementById('inv-items-container');
  cont.innerHTML = buildItemRow();
  bindRemoveItem(cont.querySelector('.inv-remove-item'));
}

function buildItemRow() {
  return `<div class="inv-item-row">
    <input class="inv-desc"  type="text"   placeholder="Descripción del producto / servicio" />
    <input class="inv-qty"   type="number" placeholder="Cant." min="1" value="1" />
    <input class="inv-price" type="number" placeholder="Precio unit." min="0" step="0.01" />
    <button class="btn-icon inv-remove-item" title="Eliminar">✕</button>
  </div>`;
}

function bindRemoveItem(btn) {
  btn.addEventListener('click', () => {
    const rows = document.querySelectorAll('#inv-items-container .inv-item-row');
    if (rows.length > 1) btn.closest('.inv-item-row').remove();
    else toast('Debe haber al menos una línea.', 'error');
  });
}

document.getElementById('btn-add-inv-item').addEventListener('click', () => {
  const cont = document.getElementById('inv-items-container');
  const div  = document.createElement('div');
  div.innerHTML = buildItemRow();
  const row = div.firstElementChild;
  cont.appendChild(row);
  bindRemoveItem(row.querySelector('.inv-remove-item'));
});

document.getElementById('btn-new-invoice').addEventListener('click', openInvoiceModal);
document.getElementById('btn-close-invoice-modal').addEventListener('click', closeInvoiceModal);
document.getElementById('btn-cancel-invoice').addEventListener('click', closeInvoiceModal);
document.getElementById('invoice-modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('invoice-modal-overlay')) closeInvoiceModal();
});

/* Autocompletar al cambiar transacción seleccionada */
document.getElementById('inv-tx-select').addEventListener('change', function() {
  if (this.value) autoFillFromTx(parseInt(this.value));
});

/* ── GENERAR comprobante ── */
document.getElementById('btn-generate-invoice').addEventListener('click', () => {
  const txId = document.getElementById('inv-tx-select').value;
  const tx   = txId ? DB.get(KEYS.TX).find(x => x.id === parseInt(txId)) : null;

  const emNombre = document.getElementById('inv-em-nombre').value.trim();
  const recNombre= document.getElementById('inv-rec-nombre').value.trim();
  if (!emNombre) { toast('Escribe el nombre del emisor.', 'error'); return; }
  if (!recNombre){ toast('Escribe el nombre del receptor.', 'error'); return; }

  // Recolectar items
  const rows  = document.querySelectorAll('#inv-items-container .inv-item-row');
  const items = [];
  let valid   = true;
  rows.forEach(row => {
    const desc  = row.querySelector('.inv-desc').value.trim();
    const qty   = parseFloat(row.querySelector('.inv-qty').value) || 0;
    const price = parseFloat(row.querySelector('.inv-price').value) || 0;
    if (!desc || qty <= 0 || price <= 0) { valid = false; return; }
    items.push({ desc, qty, price });
  });
  if (!items.length || !valid) { toast('Completa todos los campos de producto/servicio.', 'error'); return; }

  const ivaPct   = parseFloat(document.getElementById('inv-iva').value) || 0;
  const { subtotal, iva, total } = calcInvTotals(items, ivaPct);

  const invoice = {
    folio:           nextFolio(),
    fecha_emision:   todayISO(),
    tx_id:           tx ? tx.id   : null,
    tx_type:         tx ? tx.type : 'egreso',
    emisor_nombre:   emNombre,
    emisor_rfc:      document.getElementById('inv-em-rfc').value.trim(),
    emisor_dir:      document.getElementById('inv-em-dir').value.trim(),
    emisor_email:    document.getElementById('inv-em-email').value.trim(),
    receptor_nombre: recNombre,
    receptor_rfc:    document.getElementById('inv-rec-rfc').value.trim(),
    receptor_dir:    document.getElementById('inv-rec-dir').value.trim(),
    receptor_email:  document.getElementById('inv-rec-email').value.trim(),
    items,
    iva_pct:         ivaPct,
    subtotal,
    iva,
    total,
    forma_pago:      document.getElementById('inv-payment').value,
    firma:           document.getElementById('inv-firma').value.trim(),
    created_at:      new Date().toISOString(),
  };

  const invs = DB.get(KEYS_INV);
  invs.push(invoice);
  DB.set(KEYS_INV, invs);

  closeInvoiceModal();
  refreshInvoiceList();
  toast('Comprobante generado ✓');
  setTimeout(() => viewInvoice(invoice.folio), 300);
});

/* ══════════════════════════════════════════════════════
   QR — genera el HTML completo de la factura embebido
   en un data:text/html URL que se abre en cualquier
   navegador al escanear, SIN servidor ni internet.
══════════════════════════════════════════════════════ */

/** Construye el HTML completo de la factura como string minificado */
function buildInvoiceHTML(inv) {
  const folio = String(inv.folio).padStart(4, '0');

  const rows = (inv.items || []).map(it => {
    const imp = it.qty * it.price;
    return `<tr><td>${escHtml(it.desc)}</td><td style="text-align:right">${it.qty}</td><td style="text-align:right">$${Number(it.price).toFixed(2)}</td><td style="text-align:right">$${Number(imp).toFixed(2)}</td></tr>`;
  }).join('');

  const fmtN = n => `$${Number(n||0).toFixed(2)}`;

  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Factura FC-${folio} - PocketControl</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;background:#f4f6f5;color:#0f2419;padding:20px}h1{color:#0f7a3e}.doc{max-width:700px;margin:0 auto;background:#fff;padding:32px;border-radius:12px;box-shadow:0 4px 20px rgba(0,80,30,.12)}.hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1db954;padding-bottom:16px;margin-bottom:20px}.brand{font-size:1.3rem;font-weight:700;color:#0f7a3e}.sub{font-size:.75rem;color:#4d7a5e;margin-top:3px}.meta{text-align:right;font-size:.8rem;color:#4d7a5e}.meta strong{color:#0f2419}.parties{display:flex;gap:12px;background:#f0f5f2;border-radius:8px;padding:16px;margin-bottom:20px}.party{flex:1}.plbl{font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#8ab49a;margin-bottom:4px}.pname{font-weight:700;font-size:.95rem}.pdet{font-size:.78rem;color:#4d7a5e;line-height:1.5}.pdiv{font-size:1.3rem;color:#b2d4bf;align-self:center}table{width:100%;border-collapse:collapse;margin-bottom:20px;font-size:.85rem}th{background:#0f7a3e;color:#fff;padding:9px 10px;text-align:left;font-size:.75rem;text-transform:uppercase}th:not(:first-child){text-align:right}td{padding:9px 10px;border-bottom:1px solid #d6e8de;color:#0f2419}td:not(:first-child){text-align:right}tr:nth-child(even) td{background:#f7fbf8}.tots{margin-left:auto;width:260px;border:1px solid #d6e8de;border-radius:8px;overflow:hidden;margin-bottom:24px}.trow{display:flex;justify-content:space-between;padding:7px 12px;font-size:.85rem;color:#4d7a5e;border-bottom:1px solid #d6e8de}.trow:last-child{border-bottom:none}.grand{background:#0f7a3e!important;color:#fff!important;font-weight:700;font-size:.95rem}.firma-sec{display:flex;justify-content:space-between;align-items:flex-end;padding-top:16px;border-top:1px solid #d6e8de;margin-top:16px;margin-bottom:20px}.firma-box{text-align:center}.firma-line{width:180px;border-bottom:1.5px solid #0f7a3e;height:36px;margin-bottom:5px}.firma-txt{font-size:.78rem;font-weight:600;color:#0f2419}.firma-sub{font-size:.68rem;color:#8ab49a;margin-top:2px}.firma-nota{font-size:.7rem;color:#8ab49a;text-align:right;max-width:240px;line-height:1.5}.foot{margin-top:20px;padding-top:10px;border-top:1px solid #d6e8de;font-size:.68rem;color:#8ab49a;display:flex;justify-content:space-between}.print-btn{display:block;margin:24px auto 0;background:#1db954;color:#fff;border:none;padding:12px 32px;border-radius:8px;font-size:1rem;font-weight:700;cursor:pointer}@media print{.print-btn{display:none}body{padding:0;background:#fff}@page{margin:10mm;size:letter}}</style></head><body><div class="doc"><div class="hdr"><div><div class="brand">◈ PocketControl</div><div class="sub">Sistema de Finanzas Personales</div></div><div class="meta"><div><span>Folio: </span><strong>FC-${folio}</strong></div><div><span>Emisión: </span><strong>${inv.fecha_emision||''}</strong></div><div><span>Pago: </span><strong>${escHtml(inv.forma_pago||'')}</strong></div></div></div><div class="parties"><div class="party"><div class="plbl">Emisor</div><div class="pname">${escHtml(inv.emisor_nombre||'')}</div>${inv.emisor_rfc?`<div class="pdet">RFC: ${escHtml(inv.emisor_rfc)}</div>`:''} ${inv.emisor_dir?`<div class="pdet">${escHtml(inv.emisor_dir)}</div>`:''} ${inv.emisor_email?`<div class="pdet">${escHtml(inv.emisor_email)}</div>`:''}</div><div class="pdiv">→</div><div class="party"><div class="plbl">Receptor</div><div class="pname">${escHtml(inv.receptor_nombre||'')}</div>${inv.receptor_rfc?`<div class="pdet">RFC: ${escHtml(inv.receptor_rfc)}</div>`:''} ${inv.receptor_dir?`<div class="pdet">${escHtml(inv.receptor_dir)}</div>`:''} ${inv.receptor_email?`<div class="pdet">${escHtml(inv.receptor_email)}</div>`:''}</div></div><table><thead><tr><th>Descripción</th><th>Cant.</th><th>Precio unit.</th><th>Importe</th></tr></thead><tbody>${rows}</tbody></table><div class="tots"><div class="trow"><span>Subtotal</span><span>${fmtN(inv.subtotal)}</span></div><div class="trow"><span>IVA (${inv.iva_pct||0}%)</span><span>${fmtN(inv.iva)}</span></div><div class="trow grand"><span>Total a Pagar</span><span>${fmtN(inv.total)}</span></div></div><div class="firma-sec"><div class="firma-box"><div class="firma-line"></div><div class="firma-txt">${escHtml(inv.firma||'Firma / Sello')}</div><div class="firma-sub">Firma autorizada</div></div><div class="firma-nota">Generado por PocketControl<br>${new Date(inv.created_at).toLocaleDateString('es-MX')}</div></div><div class="foot"><span>PocketControl · Finanzas Personales</span><span>FC-${folio} · ${inv.fecha_emision||''}</span></div><button class="print-btn" onclick="window.print()">🖨 Imprimir / Guardar como PDF</button></div></body></html>`;
}

/** Genera el QR apuntando a index.html?factura=FOLIO (URL corta, siempre escaneable) */
async function generateQRDataURL(inv) {
  return new Promise((resolve) => {
    const container = document.getElementById('qr-hidden-container');
    container.innerHTML = '';

    // ✅ URL corta (~40 chars) → funciona en cualquier QR y en móviles sin restricciones.
    // Al escanear se abre index.html con el folio como parámetro y se muestra la factura.
    const baseURL = location.href.split('?')[0].split('#')[0];
    const qrText  = `${baseURL}?factura=${inv.folio}`;

    new QRCode(container, {
      text:         qrText,
      width:        220,
      height:       220,
      correctLevel: QRCode.CorrectLevel.M,
    });

    setTimeout(() => {
      const img    = container.querySelector('img');
      const canvas = container.querySelector('canvas');
      resolve(img?.src || canvas?.toDataURL('image/png') || '');
    }, 180);
  });
}

/* ── VER comprobante ── */
async function viewInvoice(folio) {
  const inv = DB.get(KEYS_INV).find(i => i.folio === folio);
  if (!inv) return;

  document.getElementById('viewer-folio-label').textContent =
    `Comprobante FC-${String(inv.folio).padStart(4,'0')}`;

  // Mostrar spinner mientras genera QR
  document.getElementById('invoice-print-area').innerHTML =
    `<div style="text-align:center;padding:48px;color:#4d7a5e;font-size:.9rem">Generando código QR…</div>`;
  document.getElementById('invoice-viewer-overlay').classList.remove('hidden');

  const qrImgSrc = await generateQRDataURL(inv);

  const folioPad = String(inv.folio).padStart(4,'0');
  const itemsHTML = inv.items.map(it => `
    <tr>
      <td>${escHtml(it.desc)}</td>
      <td class="inv-num">${it.qty}</td>
      <td class="inv-num">${fmt(it.price)}</td>
      <td class="inv-num">${fmt(it.qty * it.price)}</td>
    </tr>`).join('');

  document.getElementById('invoice-print-area').innerHTML = `
    <div class="inv-doc">

      <div class="inv-doc-header">
        <div class="inv-doc-brand">
          <div class="inv-doc-logo">◈ PocketControl</div>
          <div class="inv-doc-tagline">Sistema de Finanzas Personales</div>
        </div>
        <div class="inv-doc-meta">
          <div class="inv-meta-row"><span>Folio:</span><strong>FC-${folioPad}</strong></div>
          <div class="inv-meta-row"><span>Fecha de emisión:</span><strong>${fmtDate(inv.fecha_emision)}</strong></div>
          <div class="inv-meta-row"><span>Forma de pago:</span><strong>${escHtml(inv.forma_pago)}</strong></div>
        </div>
      </div>

      <div class="inv-parties">
        <div class="inv-party">
          <div class="inv-party-label">EMISOR</div>
          <div class="inv-party-name">${escHtml(inv.emisor_nombre)}</div>
          ${inv.emisor_rfc   ? `<div class="inv-party-detail">RFC: ${escHtml(inv.emisor_rfc)}</div>` : ''}
          ${inv.emisor_dir   ? `<div class="inv-party-detail">${escHtml(inv.emisor_dir)}</div>`       : ''}
          ${inv.emisor_email ? `<div class="inv-party-detail">${escHtml(inv.emisor_email)}</div>`     : ''}
        </div>
        <div class="inv-party-divider">→</div>
        <div class="inv-party">
          <div class="inv-party-label">RECEPTOR</div>
          <div class="inv-party-name">${escHtml(inv.receptor_nombre)}</div>
          ${inv.receptor_rfc   ? `<div class="inv-party-detail">RFC: ${escHtml(inv.receptor_rfc)}</div>`   : ''}
          ${inv.receptor_dir   ? `<div class="inv-party-detail">${escHtml(inv.receptor_dir)}</div>`         : ''}
          ${inv.receptor_email ? `<div class="inv-party-detail">${escHtml(inv.receptor_email)}</div>`       : ''}
        </div>
      </div>

      <table class="inv-table">
        <thead>
          <tr>
            <th>Descripción</th>
            <th class="inv-num">Cantidad</th>
            <th class="inv-num">Precio Unit.</th>
            <th class="inv-num">Importe</th>
          </tr>
        </thead>
        <tbody>${itemsHTML}</tbody>
      </table>

      <div class="inv-totals">
        <div class="inv-total-row"><span>Subtotal</span><span>${fmt(inv.subtotal)}</span></div>
        <div class="inv-total-row"><span>IVA (${inv.iva_pct}%)</span><span>${fmt(inv.iva)}</span></div>
        <div class="inv-total-row inv-grand-total"><span>Total a Pagar</span><span>${fmt(inv.total)}</span></div>
      </div>

      <!-- Firma -->
      <div class="inv-firma-section">
        <div class="inv-firma-box">
          <div class="inv-firma-line"></div>
          <div class="inv-firma-text">${escHtml(inv.firma || 'Firma / Sello')}</div>
          <div class="inv-firma-sub">Firma autorizada</div>
        </div>
        <div class="inv-firma-nota">
          Generado por PocketControl<br/>
          ${new Date(inv.created_at).toLocaleString('es-MX')}
        </div>
      </div>

      <!-- QR de verificación -->
      <div class="inv-qr-section">
        <div class="inv-qr-box">
          <img class="inv-qr-img"
               src="${qrImgSrc}"
               alt="QR Factura FC-${folioPad}" />
          <div class="inv-qr-label">Escanea para<br/>ver esta factura</div>
        </div>
        <div style="flex:1;font-size:.73rem;color:#4d7a5e;line-height:1.7;max-width:420px;text-align:right;">
          <strong style="font-size:.82rem;color:#0f2419;display:block;margin-bottom:4px">
            Código de Verificación Digital
          </strong>
          Folio: <strong>FC-${folioPad}</strong> · Total: <strong>${fmt(inv.total)}</strong><br/>
          Escanea con tu celular — abre la factura<br/>
          directo en el navegador donde tengas el archivo.<br/>
          Usa <strong>Imprimir → Guardar como PDF</strong> para compartirla.
        </div>
      </div>

      <div class="inv-footer">
        <span>PocketControl · Sistema de Finanzas Personales</span>
        <span>FC-${folioPad} · ${fmtDate(inv.fecha_emision)}</span>
      </div>

    </div>`;

  State._currentInv    = inv;
  State._currentQRSrc  = qrImgSrc;
}

function deleteInvoice(folio) {
  if (!confirm('¿Eliminar este comprobante?')) return;
  DB.set(KEYS_INV, DB.get(KEYS_INV).filter(i => i.folio !== folio));
  toast('Comprobante eliminado.');
  refreshInvoiceList();
}

document.getElementById('btn-close-viewer').addEventListener('click', () =>
  document.getElementById('invoice-viewer-overlay').classList.add('hidden'));

document.getElementById('invoice-viewer-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('invoice-viewer-overlay'))
    document.getElementById('invoice-viewer-overlay').classList.add('hidden');
});

document.getElementById('btn-print-invoice').addEventListener('click', () => {
  const inv      = State._currentInv;
  const qrImgSrc = State._currentQRSrc || '';
  if (!inv) return;

  const folioPad = String(inv.folio).padStart(4,'0');

  const win = window.open('', '_blank', 'width=860,height=980');
  win.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>FC-${folioPad} — PocketControl</title>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;background:#fff;color:#0f2419;padding:28px;font-size:.875rem}
    .doc{max-width:700px;margin:0 auto}
    .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1db954;padding-bottom:16px;margin-bottom:20px}
    .brand{font-size:1.3rem;font-weight:700;color:#0f7a3e}
    .tag{font-size:.72rem;color:#4d7a5e;margin-top:3px}
    .meta{text-align:right;font-size:.8rem;color:#4d7a5e}
    .meta strong{color:#0f2419}
    .meta div{margin-bottom:3px}
    .parties{display:flex;gap:12px;background:#f0f5f2;border-radius:8px;padding:16px;margin-bottom:20px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .party{flex:1}
    .plbl{font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#8ab49a;margin-bottom:4px}
    .pname{font-weight:700}
    .pdet{font-size:.78rem;color:#4d7a5e;line-height:1.5}
    .pdiv{font-size:1.3rem;color:#b2d4bf;align-self:center}
    table{width:100%;border-collapse:collapse;margin-bottom:20px;font-size:.84rem}
    th{background:#0f7a3e;color:#fff;padding:9px 10px;text-align:left;font-size:.73rem;text-transform:uppercase;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    th:not(:first-child){text-align:right}
    td{padding:9px 10px;border-bottom:1px solid #d6e8de;color:#0f2419}
    td:not(:first-child){text-align:right}
    tr:nth-child(even) td{background:#f7fbf8;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .tots{margin-left:auto;width:260px;border:1px solid #d6e8de;border-radius:8px;overflow:hidden;margin-bottom:24px}
    .trow{display:flex;justify-content:space-between;padding:7px 12px;font-size:.84rem;color:#4d7a5e;border-bottom:1px solid #d6e8de}
    .trow:last-child{border-bottom:none}
    .grand{background:#0f7a3e!important;color:#fff!important;font-weight:700;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .grand span{color:#fff!important}
    .firma-sec{display:flex;justify-content:space-between;align-items:flex-end;padding-top:16px;border-top:1px solid #d6e8de;margin-top:16px;margin-bottom:20px}
    .firma-box{text-align:center}
    .firma-line{width:180px;border-bottom:1.5px solid #0f7a3e;height:36px;margin-bottom:5px}
    .firma-txt{font-size:.78rem;font-weight:600;color:#0f2419}
    .firma-sub{font-size:.68rem;color:#8ab49a;margin-top:2px}
    .firma-nota{font-size:.7rem;color:#8ab49a;text-align:right;max-width:220px;line-height:1.5}
    .qr-sec{display:flex;justify-content:space-between;align-items:flex-end;padding-top:16px;border-top:1px solid #d6e8de;gap:12px}
    .qr-box{display:flex;flex-direction:column;align-items:center;gap:5px}
    .qr-img{width:110px;height:110px;border:2px solid #d6e8de;border-radius:8px;padding:4px;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .qr-lbl{font-size:.62rem;color:#8ab49a;text-transform:uppercase;letter-spacing:.05em;text-align:center}
    .qr-info{flex:1;font-size:.7rem;color:#4d7a5e;line-height:1.7;text-align:right}
    .qr-info strong{color:#0f2419}
    .foot{margin-top:20px;padding-top:10px;border-top:1px solid #d6e8de;font-size:.68rem;color:#8ab49a;display:flex;justify-content:space-between}
    @media print{body{padding:8px}@page{margin:10mm;size:letter}}
  </style>
</head>
<body>
<div class="doc">
  <div class="hdr">
    <div><div class="brand">◈ PocketControl</div><div class="tag">Sistema de Finanzas Personales</div></div>
    <div class="meta">
      <div><span>Folio: </span><strong>FC-${folioPad}</strong></div>
      <div><span>Emisión: </span><strong>${fmtDate(inv.fecha_emision)}</strong></div>
      <div><span>Pago: </span><strong>${escHtml(inv.forma_pago||'')}</strong></div>
    </div>
  </div>

  <div class="parties">
    <div class="party">
      <div class="plbl">Emisor</div>
      <div class="pname">${escHtml(inv.emisor_nombre||'')}</div>
      ${inv.emisor_rfc   ? `<div class="pdet">RFC: ${escHtml(inv.emisor_rfc)}</div>` : ''}
      ${inv.emisor_dir   ? `<div class="pdet">${escHtml(inv.emisor_dir)}</div>`       : ''}
      ${inv.emisor_email ? `<div class="pdet">${escHtml(inv.emisor_email)}</div>`     : ''}
    </div>
    <div class="pdiv">→</div>
    <div class="party">
      <div class="plbl">Receptor</div>
      <div class="pname">${escHtml(inv.receptor_nombre||'')}</div>
      ${inv.receptor_rfc   ? `<div class="pdet">RFC: ${escHtml(inv.receptor_rfc)}</div>`   : ''}
      ${inv.receptor_dir   ? `<div class="pdet">${escHtml(inv.receptor_dir)}</div>`         : ''}
      ${inv.receptor_email ? `<div class="pdet">${escHtml(inv.receptor_email)}</div>`       : ''}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Descripción</th><th>Cant.</th><th>Precio unit.</th><th>Importe</th>
      </tr>
    </thead>
    <tbody>
      ${inv.items.map(it => `<tr>
        <td>${escHtml(it.desc)}</td>
        <td>${it.qty}</td>
        <td>$${Number(it.price).toFixed(2)}</td>
        <td>$${Number(it.qty*it.price).toFixed(2)}</td>
      </tr>`).join('')}
    </tbody>
  </table>

  <div class="tots">
    <div class="trow"><span>Subtotal</span><span>${fmt(inv.subtotal)}</span></div>
    <div class="trow"><span>IVA (${inv.iva_pct||0}%)</span><span>${fmt(inv.iva)}</span></div>
    <div class="trow grand"><span>Total a Pagar</span><span>${fmt(inv.total)}</span></div>
  </div>

  <div class="firma-sec">
    <div class="firma-box">
      <div class="firma-line"></div>
      <div class="firma-txt">${escHtml(inv.firma||'Firma / Sello')}</div>
      <div class="firma-sub">Firma autorizada</div>
    </div>
    <div class="firma-nota">Generado por PocketControl<br/>${new Date(inv.created_at).toLocaleDateString('es-MX')}</div>
  </div>

  <div class="qr-sec">
    <div class="qr-box">
      <img class="qr-img" src="${qrImgSrc}" alt="QR FC-${folioPad}"/>
      <div class="qr-lbl">Escanea para<br/>abrir factura</div>
    </div>
    <div class="qr-info">
      <strong>Código de Verificación Digital</strong><br/>
      Folio: <strong>FC-${folioPad}</strong> · Total: <strong>${fmt(inv.total)}</strong><br/>
      Escanea con tu celular — la factura se abre directo<br/>
      en el navegador. Usa <strong>Compartir → Imprimir → PDF</strong>.
    </div>
  </div>

  <div class="foot">
    <span>PocketControl · Sistema de Finanzas Personales</span>
    <span>FC-${folioPad} · ${fmtDate(inv.fecha_emision)}</span>
  </div>
</div>
<script>window.onload=function(){setTimeout(function(){window.print()},500)}<\/script>
</body></html>`);
  win.document.close();
});


(function init() {
  updateHeaderDate();

  // ✅ Si la URL trae ?factura=FOLIO (al escanear el QR), abrir esa factura directo
  const params      = new URLSearchParams(location.search);
  const folioParam  = parseInt(params.get('factura'));
  if (folioParam) {
    showView('invoices');
    setTimeout(() => viewInvoice(folioParam), 250);
  } else {
    showView('dashboard');
  }

  startAutoRefresh();
  setInterval(updateHeaderDate, 60_000);
})();
