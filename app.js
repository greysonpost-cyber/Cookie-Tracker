const BASE_PRICE = 6;
const TAP_PRICE = 7;
const STORAGE_KEY = 'cookieTrackerDataV1'; // Keep the same key so existing data survives updates.
const APP_VERSION = 6;
const DEFAULT_BROTHER_SHARE = 4;
const DEFAULT_FLAVORS = [
  'Biscoff',
  'Cookie Monster',
  'Cinnamon Roll',
  'Ferrero',
  'Kinder',
  "S'mores",
  'Cookies & Cream',
  'Chocolate Chunk'
];

const PAYMENT_LABELS = {
  unpaid: 'Not paid yet',
  cash: 'Cash',
  apple: 'Apple Pay',
  tap: 'Tap to Pay',
  legacy: 'Paid · method unknown'
};

const defaultState = () => ({
  version: APP_VERSION,
  price: BASE_PRICE,
  flavors: DEFAULT_FLAVORS.map((name, index) => ({
    id: `flavor-${index + 1}`,
    name,
    stock: 0,
    active: true,
    brotherShare: DEFAULT_BROTHER_SHARE,
    size: 'Regular',
    priceCash: BASE_PRICE,
    priceTap: TAP_PRICE
  })),
  orders: [],
  sales: [],
  deals: [],
  brotherPayments: [],
  inventoryLog: [],
  settings: { lowStock: 3 }
});

let state = loadState();
let currentView = 'home';
let sellDraft = {};
let sellMeta = blankSaleMeta();
let orderDraft = {};
let orderMeta = blankOrderMeta();
let editingOrderId = null;
let moneyViewDate = localDateKey(new Date());
let moneyDateMode = 'all';

const $ = (sel) => document.querySelector(sel);
const main = $('#mainContent');
const pageTitle = $('#pageTitle');
const modalBackdrop = $('#modalBackdrop');
const modalCard = $('#modalCard');
const importFile = $('#importFile');

function blankSaleMeta() {
  return { customer: '', paymentMethod: 'cash', pricingMode: 'none', discountAmount: '', discountReason: '', dealId: '', dealSnapshot: null, chargeEnabled:false, priceOverrideTotal:'', chargeReason:'' };
}

function blankOrderMeta() {
  return { customer: '', contact: '', location: '', dueAt: '', note: '', paymentMethod: 'unpaid', reserveMode: 'now', pricingMode: 'none', discountAmount: '', discountReason: '', dealId: '', dealSnapshot: null, chargeEnabled:false, priceOverrideTotal:'', chargeReason:'' };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const saved = JSON.parse(raw);
    const base = defaultState();
    const legacyShare = validMoney(saved.brotherShare) ? Number(saved.brotherShare) : DEFAULT_BROTHER_SHARE;
    const merged = {
      ...base,
      ...saved,
      version: APP_VERSION,
      price: BASE_PRICE,
      settings: { ...base.settings, ...(saved.settings || {}) }
    };

    merged.flavors = Array.isArray(saved.flavors) && saved.flavors.length
      ? saved.flavors.map((f, index) => ({
          id: f.id || `flavor-${index + 1}`,
          name: f.name || `Flavor ${index + 1}`,
          stock: Math.max(0, Number(f.stock || 0)),
          active: f.active !== false,
          brotherShare: validMoney(f.brotherShare) ? Number(f.brotherShare) : legacyShare,
          size: f.size || 'Regular',
          priceCash: validMoney(f.priceCash) && Number(f.priceCash) >= 0 ? Number(f.priceCash) : BASE_PRICE,
          priceTap: validMoney(f.priceTap) && Number(f.priceTap) >= 0 ? Number(f.priceTap) : TAP_PRICE
        }))
      : base.flavors;

    merged.deals = Array.isArray(saved.deals) ? saved.deals.map((d, index) => ({
      id: d.id || `deal-${index + 1}`,
      name: d.name || `${Math.max(1, Number(d.qty || 1))} for ${money(Number(d.price || 0))}`,
      qty: Math.max(1, Number(d.qty || 1)),
      price: Math.max(0, Number(d.price || 0)),
      active: d.active !== false,
      createdAt: d.createdAt || new Date().toISOString()
    })) : [];

    merged.orders = Array.isArray(saved.orders) ? saved.orders.map(o => ({
      ...o,
      status: o.status || 'open',
      reserveMode: o.reserveMode || (o.status === 'waiting' ? 'auto' : 'now'),
      paid: !!o.paid,
      paymentMethod: o.paymentMethod || (o.paid ? 'legacy' : 'unpaid'),
      contact: o.contact || '',
      location: o.location || '',
      dueAt: o.dueAt || '',
      note: o.note || '',
      pricingMode: o.pricingMode || (Number(o.discountAmount || 0) > 0 ? (o.dealSnapshot || o.dealId ? 'deal' : 'discount') : 'none'),
      discountAmount: Math.max(0, Number(o.discountAmount || 0)),
      discountReason: o.discountReason || '',
      dealId: o.dealId || o.dealSnapshot?.id || '',
      dealSnapshot: o.dealSnapshot || null,
      chargeEnabled: !!o.chargeEnabled || validMoney(o.priceOverrideTotal) && o.priceOverrideTotal !== '',
      priceOverrideTotal: validMoney(o.priceOverrideTotal) && o.priceOverrideTotal !== '' ? Number(o.priceOverrideTotal) : '',
      chargeReason: o.chargeReason || '',
      items: normalizeItems(o.items)
    })) : [];

    merged.sales = Array.isArray(saved.sales) ? saved.sales.map(s => {
      const items = normalizeItems(s.items).map(i => ({
        ...i,
        brotherShare: validMoney(i.brotherShare) ? Number(i.brotherShare) : legacyShare
      }));
      const qty = itemsQty(items);
      const method = s.paymentMethod || (s.paid ? 'legacy' : 'unpaid');
      const unitPrice = validMoney(s.unitPrice)
        ? Number(s.unitPrice)
        : (validMoney(s.total) && qty ? Number(s.total) / qty : BASE_PRICE);
      const total = validMoney(s.total) ? Number(s.total) : qty * unitPrice;
      const brotherTotal = validMoney(s.brotherTotal)
        ? Number(s.brotherTotal)
        : items.reduce((sum, i) => sum + i.qty * Number(i.brotherShare || legacyShare), 0);
      return {
        ...s,
        items,
        paymentMethod: method,
        unitPrice,
        total,
        brotherTotal,
        paid: !!s.paid,
        pricingMode: s.pricingMode || (Number(s.discountAmount || 0) > 0 ? (s.dealSnapshot || s.dealId ? 'deal' : 'discount') : 'none'),
        discountAmount: Math.max(0, Number(s.discountAmount || 0)),
        discountReason: s.discountReason || '',
        dealId: s.dealId || s.dealSnapshot?.id || '',
        dealSnapshot: s.dealSnapshot || null,
        chargeEnabled: !!s.chargeEnabled || validMoney(s.priceOverrideTotal) && s.priceOverrideTotal !== '',
        priceOverrideTotal: validMoney(s.priceOverrideTotal) && s.priceOverrideTotal !== '' ? Number(s.priceOverrideTotal) : '',
        chargeReason: s.chargeReason || ''
      };
    }) : [];

    merged.brotherPayments = Array.isArray(saved.brotherPayments) ? saved.brotherPayments : [];
    merged.inventoryLog = Array.isArray(saved.inventoryLog) ? saved.inventoryLog : [];
    return merged;
  } catch {
    return defaultState();
  }
}

function normalizeItems(items) {
  return Array.isArray(items)
    ? items.filter(i => i && i.flavorId).map(i => ({ ...i, qty: Math.max(0, Number(i.qty || 0)) }))
    : [];
}

function validMoney(value) {
  return value !== null && value !== '' && Number.isFinite(Number(value));
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function saveState() {
  state.version = APP_VERSION;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
}

function money(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
}

function dateText(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

function activeFlavors() { return state.flavors.filter(f => f.active); }
function deletedFlavors() { return state.flavors.filter(f => !f.active); }
function flavorById(id) { return state.flavors.find(f => f.id === id); }
function activeDeals() { return (state.deals || []).filter(d => d.active !== false); }
function dealById(id) { return (state.deals || []).find(d => d.id === id); }
function openOrders() { return state.orders.filter(o => o.status === 'open'); }
function waitingOrders() { return state.orders.filter(o => o.status === 'waiting'); }
function paymentLabel(method) { return PAYMENT_LABELS[method] || 'Unknown'; }
function unitPriceForMethod(method) { return method === 'tap' ? TAP_PRICE : BASE_PRICE; }
function orderPaid(order) { return (order.paymentMethod || 'unpaid') !== 'unpaid'; }
function flavorBrotherShare(flavorId) { return Number(flavorById(flavorId)?.brotherShare ?? DEFAULT_BROTHER_SHARE); }
function flavorPrice(flavorId, method = 'cash') {
  const f = flavorById(flavorId);
  return Number(method === 'tap' ? (f?.priceTap ?? TAP_PRICE) : (f?.priceCash ?? BASE_PRICE));
}
function flavorLabel(f) { return `${f?.name || 'Cookie'}${f?.size && f.size !== 'Regular' ? ' · ' + f.size : ''}`; }
function itemUnitPrice(item, method) {
  if (method === 'tap') return Number(item.priceTap ?? flavorPrice(item.flavorId, 'tap'));
  return Number(item.priceCash ?? flavorPrice(item.flavorId, 'cash'));
}
function itemsSubtotal(items, method = 'cash') { return roundMoney((items || []).reduce((sum, i) => sum + Number(i.qty || 0) * itemUnitPrice(i, method), 0)); }

function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatMoneyDate(key) {
  const date = new Date(`${key}T12:00:00`);
  if (Number.isNaN(date.getTime())) return key;
  const today = localDateKey(new Date());
  if (key === today) return 'Today';
  return new Intl.DateTimeFormat('en-US', { weekday:'short', month:'short', day:'numeric' }).format(date);
}

function canReserveItems(items, excludingOrderId = null) {
  return (items || []).every(item => Number(item.qty || 0) <= availableFor(item.flavorId, excludingOrderId));
}

function autoReserveWaitingOrders() {
  const waiting = state.orders
    .filter(o => o.status === 'waiting')
    .sort((a, b) => {
      const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
      const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
      if (aDue !== bDue) return aDue - bDue;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });
  const reserved = [];
  for (const order of waiting) {
    if (!canReserveItems(order.items, order.id)) continue;
    order.status = 'open';
    order.reserveMode = 'auto';
    order.autoReservedAt = new Date().toISOString();
    order.updatedAt = order.autoReservedAt;
    reserved.push(order);
  }
  return reserved;
}

function reservedFor(flavorId, excludingOrderId = null) {
  return openOrders()
    .filter(order => order.id !== excludingOrderId)
    .reduce((sum, order) => sum + order.items.filter(i => i.flavorId === flavorId).reduce((a, i) => a + i.qty, 0), 0);
}

function availableFor(flavorId, excludingOrderId = null) {
  const f = flavorById(flavorId);
  return Math.max(0, (f?.stock || 0) - reservedFor(flavorId, excludingOrderId));
}

function totalOnHand() { return activeFlavors().reduce((s, f) => s + Number(f.stock || 0), 0); }
function totalReserved() { return activeFlavors().reduce((s, f) => s + reservedFor(f.id), 0); }
function totalWaitingQty() { return waitingOrders().reduce((s, o) => s + itemsQty(o.items), 0); }
function totalSoldQty() { return state.sales.reduce((s, x) => s + itemsQty(x.items), 0); }
function totalRevenue() { return state.sales.reduce((s, x) => s + Number(x.total || 0), 0); }
function collectedRevenue() { return state.sales.filter(s => s.paid).reduce((a, s) => a + Number(s.total || 0), 0); }
function unpaidRevenue() { return state.sales.filter(s => !s.paid).reduce((a, s) => a + Number(s.total || 0), 0); }
function totalBrotherOwed() { return state.sales.reduce((s, sale) => s + Number(sale.brotherTotal ?? brotherForItems(sale.items)), 0); }
function totalBrotherPaid() { return state.brotherPayments.reduce((s, p) => s + Number(p.amount || 0), 0); }
function brotherBalance() { return totalBrotherOwed() - totalBrotherPaid(); }

function itemsQty(items) { return (items || []).reduce((s, i) => s + Number(i.qty || 0), 0); }
function itemsTotal(items, method = 'cash') { return itemsSubtotal(items, method); }
function brotherForItems(items) {
  return roundMoney((items || []).reduce((sum, i) => sum + Number(i.qty || 0) * Number(i.brotherShare ?? flavorBrotherShare(i.flavorId)), 0));
}
function dealDiscount(deal, items = null) {
  if (!deal) return 0;
  const regular = items ? itemsSubtotal(items, 'cash') : Number(deal.qty || 0) * BASE_PRICE;
  return roundMoney(regular - Number(deal.price || 0));
}
function pricingDeal(pricing) {
  return pricing?.dealSnapshot || dealById(pricing?.dealId || '') || null;
}
function pricingBreakdown(pricing, items, method = 'cash') {
  const qty = itemsQty(items);
  const unitPrice = qty ? roundMoney(itemsSubtotal(items, method) / qty) : unitPriceForMethod(method);
  const baseTotal = itemsSubtotal(items, method);
  const baseBrother = brotherForItems(items);
  const mode = pricing?.pricingMode || 'none';
  let discount = 0;
  let deal = null;
  let error = '';

  if (mode === 'discount') {
    discount = roundMoney(Number(pricing?.discountAmount || 0));
    if (!(discount > 0)) error = 'Enter a discount amount greater than $0.';
  } else if (mode === 'deal') {
    deal = pricingDeal(pricing);
    if (!deal) error = 'Choose a custom deal.';
    else if (qty !== Number(deal.qty || 0)) error = `${deal.name} requires exactly ${deal.qty} cookies.`;
    else {
      discount = dealDiscount(deal, items);
      if (!(discount > 0)) error = 'This deal does not create a discount for these cookies.';
    }
  }
  if (!error && discount > baseBrother + 0.001) error = `Discount exceeds brother's ${money(baseBrother)} share.`;
  if (!error && discount > baseTotal + 0.001) error = 'Discount cannot exceed the price.';
  if (!error && discount > 0 && !String(pricing?.discountReason || '').trim()) error = 'Enter a reason for the discount.';

  const defaultTotal = roundMoney(Math.max(0, baseTotal - discount));
  const brotherTotal = roundMoney(Math.max(0, baseBrother - discount));
  const hasOverride = !!pricing?.chargeEnabled || (pricing?.priceOverrideTotal !== '' && validMoney(pricing?.priceOverrideTotal));
  const enteredTotal = pricing?.priceOverrideTotal;
  let total = defaultTotal;
  if (hasOverride) {
    if (enteredTotal === '' || enteredTotal == null || !validMoney(enteredTotal) || Number(enteredTotal) < 0) {
      if (!error) error = 'Enter a valid final customer charge.';
    } else {
      total = roundMoney(Number(enteredTotal));
      if (total + 0.001 < brotherTotal && !error) error = 'The customer charge cannot be less than the brother payout.';
    }
    if (!String(pricing?.chargeReason || '').trim() && !error) error = 'Enter why the price was adjusted.';
  }
  const profit = roundMoney(total - brotherTotal);
  return { mode, qty, unitPrice, baseTotal, baseBrother, discount, defaultTotal, total, brotherTotal, profit, deal, error, hasOverride };
}

function pricingLabel(pricing) {
  if ((pricing?.pricingMode || 'none') === 'deal') {
    const deal = pricingDeal(pricing);
    return deal ? deal.name : 'Custom deal';
  }
  if ((pricing?.pricingMode || 'none') === 'discount') return 'Dollar discount';
  return 'No discount';
}
function itemSummary(items) {
  return (items || []).filter(i => i.qty > 0).map(i => `${i.qty}× ${i.nameSnapshot ? i.nameSnapshot + (i.sizeSnapshot && i.sizeSnapshot !== 'Regular' ? ' · ' + i.sizeSnapshot : '') : flavorLabel(flavorById(i.flavorId))}`).join(' · ');
}

function navTo(view) {
  currentView = view;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  const titles = { home:'Dashboard', inventory:'Inventory', sell:'New Sale', orders:'Orders', money:'Money' };
  pageTitle.textContent = titles[view];
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function render() {
  if (currentView === 'home') renderHome();
  if (currentView === 'inventory') renderInventory();
  if (currentView === 'sell') renderSell();
  if (currentView === 'orders') renderOrders();
  if (currentView === 'money') renderMoney();
}

function renderHome() {
  const recent = [...state.sales].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 4);
  main.innerHTML = `
    <section class="hero-card">
      <div class="hero-row">
        <div>
          <div class="label">AVAILABLE TO SELL</div>
          <div class="big">${totalOnHand() - totalReserved()}</div>
        </div>
        <div style="text-align:right">
          <div class="label">PRODUCTS</div>
          <div style="font-size:18px;font-weight:900;margin-top:4px">Regular + Jumbo</div>
        </div>
      </div>
      <div class="mini">
        <span class="hero-pill">${totalOnHand()} on hand</span>
        <span class="hero-pill">${totalReserved()} reserved</span>
        <span class="hero-pill">${totalSoldQty()} sold</span>
      </div>
    </section>

    <section class="stat-grid">
      ${statCard('Sales', money(totalRevenue()), `${totalSoldQty()} cookies`)}
      ${statCard('Collected', money(collectedRevenue()), unpaidRevenue() ? `${money(unpaidRevenue())} unpaid` : 'Everything paid')}
      ${statCard('Orders', openOrders().length + waitingOrders().length, `${openOrders().reduce((s, o) => s + itemsQty(o.items), 0)} reserved${waitingOrders().length ? ` · ${totalWaitingQty()} waiting` : ''}`)}
      ${statCard('Owe brother', money(Math.max(0, brotherBalance())), 'Commission varies by flavor')}
    </section>

    <div class="quick-actions">
      <button class="btn primary" onclick="navTo('sell')">＋ Record sale</button>
      <button class="btn secondary" onclick="openNewOrder()">☷ New order</button>
    </div>

    <div class="section-head"><div><h2>Stock</h2><div class="sub">Available after open orders</div></div><button class="text-btn" onclick="navTo('inventory')">View all</button></div>
    <div class="card-list">${activeFlavors().map(f => compactFlavor(f)).join('')}</div>

    <div class="section-head"><div><h2>Recent sales</h2><div class="sub">Latest completed sales</div></div><button class="text-btn" onclick="navTo('money')">Money</button></div>
    ${recent.length ? `<div class="card-list">${recent.map(saleCard).join('')}</div>` : emptyState('🍪', 'No sales yet', 'Your first completed sale will show here.')}
  `;
}

function statCard(label, value, sub = '') {
  return `<div class="stat-card"><div class="stat-label">${esc(label)}</div><div class="stat-value">${esc(value)}</div><div class="stat-sub">${esc(sub)}</div></div>`;
}

function compactFlavor(f) {
  const reserved = reservedFor(f.id);
  const avail = availableFor(f.id);
  const klass = avail <= state.settings.lowStock ? 'stock-low' : reserved ? 'stock-reserved' : '';
  return `<div class="list-card flavor-row">
    <div class="cookie-dot">🍪</div>
    <div><div class="flavor-name">${esc(flavorLabel(f))}</div><div class="meta">${money(f.priceCash ?? BASE_PRICE)} cash · ${f.stock} on hand${reserved ? ` · ${reserved} reserved` : ''} · Brother ${money(f.brotherShare)}</div></div>
    <div><div class="stock-num ${klass}">${avail}</div><div class="meta" style="text-align:right">available</div></div>
  </div>`;
}

function renderInventory() {
  main.innerHTML = `
    <div class="summary-strip"><div><div class="meta">TOTAL ON HAND</div><strong>${totalOnHand()}</strong></div><div style="text-align:right"><div class="meta">RESERVED</div><strong>${totalReserved()}</strong></div></div>
    <div class="card-list">
      ${activeFlavors().map(f => {
        const reserved = reservedFor(f.id);
        const avail = availableFor(f.id);
        return `<div class="list-card">
          <div class="flavor-row">
            <div class="cookie-dot">🍪</div>
            <div><div class="flavor-name">${esc(flavorLabel(f))}</div><div class="meta">${money(f.priceCash ?? BASE_PRICE)} cash · ${reserved ? `${reserved} reserved · ` : ''}${avail} available · Brother gets ${money(f.brotherShare)}</div></div>
            <div class="stock-num">${f.stock}</div>
          </div>
          <div class="row-actions">
            <button class="btn secondary small" onclick="adjustStock('${f.id}', 1)">+1</button>
            <button class="btn secondary small" onclick="adjustStock('${f.id}', 6)">+6</button>
            <button class="btn ghost small" onclick="openStockModal('${f.id}')">Adjust</button>
            <button class="btn ghost small" onclick="openEditFlavor('${f.id}')">Edit</button>
            ${f.size !== 'Jumbo (8 oz)' && !flavorNameExists(f.name,null,'Jumbo (8 oz)') ? `<button class="btn ghost small" onclick="openAddJumbo('${f.id}')">+ Jumbo</button>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>
    <button class="btn ghost full" style="margin-top:12px" onclick="openAddFlavor()">＋ Add cookie (Regular or Jumbo)</button>
  `;
}

function adjustStock(flavorId, delta) {
  const f = flavorById(flavorId);
  if (!f) return;
  if (f.stock + delta < reservedFor(flavorId)) {
    toast(`Can't go below ${reservedFor(flavorId)} because those cookies are reserved.`);
    return;
  }
  f.stock += delta;
  state.inventoryLog.push({ id: uid('inv'), flavorId, delta, createdAt: new Date().toISOString() });
  const newlyReserved = autoReserveWaitingOrders();
  saveState();
  render();
  toast(newlyReserved.length ? `${f.name}: ${delta > 0 ? '+' : ''}${delta} · ${newlyReserved.length} future order${newlyReserved.length === 1 ? '' : 's'} auto-reserved` : `${f.name}: ${delta > 0 ? '+' : ''}${delta}`);
}

function openStockModal(flavorId) {
  const f = flavorById(flavorId);
  if (!f) return;
  showModal(`
    <div class="modal-head"><div><div class="meta">ADJUST STOCK</div><h2>${esc(f.name)}</h2></div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="field"><label>New on-hand quantity</label><input id="stockInput" type="number" min="${reservedFor(flavorId)}" inputmode="numeric" value="${f.stock}"></div>
    <div class="meta" style="margin-bottom:14px">${reservedFor(flavorId)} currently reserved. On-hand stock cannot go below that.</div>
    <button class="btn primary full" onclick="setStock('${flavorId}')">Save stock</button>
  `);
  setTimeout(() => $('#stockInput')?.focus(), 100);
}

function setStock(flavorId) {
  const f = flavorById(flavorId);
  const value = Math.max(0, parseInt($('#stockInput').value || '0', 10));
  const reserved = reservedFor(flavorId);
  if (value < reserved) return toast(`At least ${reserved} are reserved.`);
  const delta = value - f.stock;
  f.stock = value;
  state.inventoryLog.push({ id: uid('inv'), flavorId, delta, createdAt: new Date().toISOString() });
  const newlyReserved = autoReserveWaitingOrders();
  saveState(); closeModal(); render(); toast(newlyReserved.length ? `Stock updated · ${newlyReserved.length} future order${newlyReserved.length === 1 ? '' : 's'} auto-reserved` : 'Stock updated');
}

function draftCapacity(type, flavorId) {
  if (type === 'order' && orderMeta.reserveMode === 'auto') return Number.POSITIVE_INFINITY;
  if (type === 'order' && editingOrderId) return availableFor(flavorId, editingOrderId);
  return availableFor(flavorId);
}

function renderQtyRows(draftName) {
  const draft = draftName === 'sell' ? sellDraft : orderDraft;
  return activeFlavors().map(f => {
    const qty = draft[f.id] || 0;
    const capacity = draftCapacity(draftName, f.id);
    const available = availableFor(f.id, draftName === 'order' ? editingOrderId : null);
    const stockText = Number.isFinite(capacity) ? `${available} available` : `${available} available · can wait for stock`;
    return `<div class="qty-line">
      <div><div class="flavor-name">${esc(flavorLabel(f))}</div><div class="meta">${stockText} · ${money(f.priceCash ?? BASE_PRICE)} cash · Brother ${money(f.brotherShare)}</div></div>
      <button class="qty-button" onclick="changeDraftQty('${draftName}','${f.id}',-1)">−</button>
      <div class="qty-value">${qty}</div>
      <button class="qty-button plus" onclick="changeDraftQty('${draftName}','${f.id}',1)">＋</button>
    </div>`;
  }).join('');
}

function draftItems(draft) {
  return Object.entries(draft).filter(([, qty]) => qty > 0).map(([flavorId, qty]) => ({ flavorId, qty }));
}

function captureSellMeta() {
  sellMeta.customer = $('#saleCustomer')?.value ?? sellMeta.customer;
  sellMeta.discountAmount = $('#saleDiscountAmount')?.value ?? sellMeta.discountAmount;
  sellMeta.discountReason = $('#saleDiscountReason')?.value ?? sellMeta.discountReason;
  sellMeta.dealId = $('#saleDealSelect')?.value ?? sellMeta.dealId;
  sellMeta.priceOverrideTotal = $('#saleChargeTotal')?.value ?? sellMeta.priceOverrideTotal;
  sellMeta.chargeReason = $('#saleChargeReason')?.value ?? sellMeta.chargeReason;
}

function captureOrderMeta() {
  orderMeta.customer = $('#orderCustomer')?.value ?? orderMeta.customer;
  orderMeta.contact = $('#orderContact')?.value ?? orderMeta.contact;
  orderMeta.location = $('#orderLocation')?.value ?? orderMeta.location;
  orderMeta.dueAt = $('#orderDueAt')?.value ?? orderMeta.dueAt;
  orderMeta.note = $('#orderNote')?.value ?? orderMeta.note;
  orderMeta.discountAmount = $('#orderDiscountAmount')?.value ?? orderMeta.discountAmount;
  orderMeta.discountReason = $('#orderDiscountReason')?.value ?? orderMeta.discountReason;
  orderMeta.dealId = $('#orderDealSelect')?.value ?? orderMeta.dealId;
  orderMeta.priceOverrideTotal = $('#orderChargeTotal')?.value ?? orderMeta.priceOverrideTotal;
  orderMeta.chargeReason = $('#orderChargeReason')?.value ?? orderMeta.chargeReason;
}

function changeDraftQty(type, flavorId, delta) {
  if (type === 'sell') captureSellMeta(); else captureOrderMeta();
  const draft = type === 'sell' ? sellDraft : orderDraft;
  const next = Math.max(0, (draft[flavorId] || 0) + delta);
  if (delta > 0 && next > draftCapacity(type, flavorId)) return toast('Not enough available stock.');
  draft[flavorId] = next;
  if (type === 'sell') renderSell(); else renderOrderComposer();
}

function paymentButtons(selected, target) {
  const methods = target === 'sell' ? ['cash', 'apple', 'tap'] : ['unpaid', 'cash', 'apple', 'tap'];
  if (selected === 'legacy' && !methods.includes('legacy')) methods.unshift('legacy');
  return `<div class="payment-grid">${methods.map(method => {
    const priceText = method === 'tap' ? 'Tap price per cookie' : method === 'unpaid' ? 'Cash price until paid' : 'Cookie-specific prices';
    return `<button type="button" class="payment-choice ${selected === method ? 'selected' : ''}" onclick="${target === 'sell' ? `setSalePayment('${method}')` : `setOrderPayment('${method}')`}">
      <span class="payment-title">${esc(paymentLabel(method))}</span><span class="payment-sub">${priceText}</span>
    </button>`;
  }).join('')}</div>`;
}

function setSalePayment(method) {
  captureSellMeta();
  sellMeta.paymentMethod = method;
  renderSell();
}

function setSalePricingMode(mode) {
  captureSellMeta();
  sellMeta.pricingMode = ['discount','deal'].includes(mode) ? mode : 'none';
  if (sellMeta.pricingMode !== 'deal') sellMeta.dealSnapshot = null;
  renderSell();
}

function setSaleDeal(dealId) {
  captureSellMeta();
  sellMeta.dealId = dealId;
  sellMeta.dealSnapshot = null;
  renderSell();
}

function setOrderPricingMode(mode) {
  captureOrderMeta();
  orderMeta.pricingMode = ['discount','deal'].includes(mode) ? mode : 'none';
  if (orderMeta.pricingMode !== 'deal') orderMeta.dealSnapshot = null;
  renderOrderComposer();
}

function setOrderDeal(dealId) {
  captureOrderMeta();
  orderMeta.dealId = dealId;
  orderMeta.dealSnapshot = null;
  renderOrderComposer();
}

function toggleCustomCharge(target) {
  if (target === 'sell') { captureSellMeta(); sellMeta.chargeEnabled = !sellMeta.chargeEnabled; sellMeta.priceOverrideTotal = ''; renderSell(); }
  else { captureOrderMeta(); orderMeta.chargeEnabled = !orderMeta.chargeEnabled; orderMeta.priceOverrideTotal = ''; renderOrderComposer(); }
}

function refreshSalePricing() {
  captureSellMeta();
  renderSell();
}

function refreshOrderPricing() {
  captureOrderMeta();
  renderOrderComposer();
}

function pricingControls(meta, target, items, method) {
  const mode = meta.pricingMode || 'none';
  const breakdown = pricingBreakdown(meta, items, method);
  const prefix = target === 'sell' ? 'sale' : 'order';
  const modeFn = target === 'sell' ? 'setSalePricingMode' : 'setOrderPricingMode';
  const dealFn = target === 'sell' ? 'setSaleDeal' : 'setOrderDeal';
  const deals = activeDeals();
  const selectedSnapshot = meta.dealSnapshot;
  const selectedDealMissing = mode === 'deal' && meta.dealId && !dealById(meta.dealId) && selectedSnapshot;
  const dealOptions = [
    '<option value="">Choose a deal…</option>',
    ...deals.map(d => `<option value="${esc(d.id)}" ${meta.dealId === d.id ? 'selected' : ''}>${esc(d.name)} · ${d.qty} cookies for ${money(d.price)}</option>`),
    ...(selectedDealMissing ? [`<option value="${esc(selectedSnapshot.id || meta.dealId)}" selected>${esc(selectedSnapshot.name || 'Saved deal')} · saved with order</option>`] : [])
  ].join('');

  return `<div class="pricing-box">
    <div class="field"><label>Discount / deal</label>
      <div class="pricing-mode-grid">
        <button type="button" class="payment-choice ${mode === 'none' ? 'selected' : ''}" onclick="${modeFn}('none')"><span class="payment-title">No discount</span><span class="payment-sub">Regular price</span></button>
        <button type="button" class="payment-choice ${mode === 'discount' ? 'selected' : ''}" onclick="${modeFn}('discount')"><span class="payment-title">$ Discount</span><span class="payment-sub">Choose an exact amount</span></button>
        <button type="button" class="payment-choice ${mode === 'deal' ? 'selected' : ''}" onclick="${modeFn}('deal')"><span class="payment-title">Custom deal</span><span class="payment-sub">Pick one you created</span></button>
      </div>
    </div>
    ${mode === 'discount' ? `<div class="field"><label>Discount amount</label><div class="money-input"><span>$</span><input id="${prefix}DiscountAmount" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(meta.discountAmount)}" placeholder="0.00" onchange="${target === 'sell' ? 'refreshSalePricing()' : 'refreshOrderPricing()'}"></div></div>` : ''}
    ${mode === 'deal' ? `<div class="field"><label>Select deal</label><select id="${prefix}DealSelect" onchange="${dealFn}(this.value)">${dealOptions}</select>${!deals.length && !selectedDealMissing ? '<div class="field-hint">Create deals in Settings first. Deals never apply automatically.</div>' : ''}</div>` : ''}
    ${mode !== 'none' ? `<div class="field"><label>Discount reason <span class="required">required</span></label><input id="${prefix}DiscountReason" value="${esc(meta.discountReason || '')}" placeholder="Why are you giving this discount?"></div>` : ''}
    ${mode !== 'none' ? `<div class="discount-preview ${breakdown.error ? 'warning' : ''}">
      <div><span>Regular total</span><strong>${money(breakdown.baseTotal)}</strong></div>
      <div><span>Discount</span><strong>−${money(breakdown.discount)}</strong></div>
      <div><span>Brother reduction</span><strong>−${money(breakdown.discount)}</strong></div>
      <div><span>Your profit</span><strong>${money(breakdown.profit)}</strong></div>
      ${breakdown.error ? `<p>${esc(breakdown.error)}</p>` : '<p>Your profit stays the same. The entire discount comes out of your brother’s cut.</p>'}
    </div>` : ''}
    <div class="field" style="margin-top:12px">
      <button type="button" class="btn ghost small" onclick="toggleCustomCharge('${target}')">${meta.chargeEnabled ? '− Remove custom charge' : '+ Custom charge'}</button>
      ${meta.chargeEnabled ? `<div class="charge-override">
        <label>Actual customer total</label><div class="money-input"><span>$</span><input id="${prefix}ChargeTotal" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" value="${esc(meta.priceOverrideTotal)}" onchange="${target === 'sell' ? 'refreshSalePricing()' : 'refreshOrderPricing()'}"></div>
        <label>Reason for charge adjustment</label><input id="${prefix}ChargeReason" placeholder="Price adjustment note" value="${esc(meta.chargeReason || '')}">
        <div class="field-hint">Actual charge and actual profit are saved in Money and exported records. Brother's fixed payout does not change.</div>
      </div>` : ''}
    </div>
  </div>`;
}

function renderSell() {
  const items = draftItems(sellDraft);
  const qty = itemsQty(items);
  const breakdown = pricingBreakdown(sellMeta, items, sellMeta.paymentMethod);
  main.innerHTML = `
    <div class="form-card">
      <h2>Choose cookies</h2>
      <div class="meta" style="margin-bottom:8px">Each cookie has its own cash, Apple Pay, and Tap to Pay price.</div>
      ${renderQtyRows('sell')}
    </div>

    <div class="form-card">
      <div class="field"><label>Customer name (optional)</label><input id="saleCustomer" placeholder="e.g. Alex" value="${esc(sellMeta.customer)}"></div>
      <div class="field"><label>How did they pay?</label>${paymentButtons(sellMeta.paymentMethod, 'sell')}</div>
      ${pricingControls(sellMeta, 'sell', items, sellMeta.paymentMethod)}
    </div>

    <div class="summary-strip"><div><div class="meta">${qty} COOKIE${qty === 1 ? '' : 'S'}${breakdown.discount ? ` · ${money(breakdown.discount)} OFF` : ''}</div><strong>${money(breakdown.total)}</strong>${breakdown.discount ? `<div class="meta"><s>${money(breakdown.baseTotal)}</s> regular</div>` : ''}</div><div style="text-align:right"><div class="meta">BROTHER GETS</div><strong>${money(breakdown.brotherTotal)}</strong><div class="meta">Mine ${money(breakdown.profit)}</div></div></div>
    <button class="btn primary full" ${qty ? '' : 'disabled'} onclick="recordSale()">Complete sale</button>
    <button class="btn ghost full" style="margin-top:8px" onclick="clearSaleDraft()">Clear</button>
  `;
}

function clearSaleDraft() {
  sellDraft = {};
  sellMeta = blankSaleMeta();
  renderSell();
}

function snapshotSaleItems(items) {
  return items.map(i => {
    const f = flavorById(i.flavorId);
    return { ...i, brotherShare: flavorBrotherShare(i.flavorId), priceCash: flavorPrice(i.flavorId, 'cash'), priceTap: flavorPrice(i.flavorId, 'tap'), nameSnapshot: f?.name || 'Cookie', sizeSnapshot: f?.size || 'Regular' };
  });
}

function recordSale() {
  captureSellMeta();
  const items = draftItems(sellDraft);
  if (!items.length) return toast('Choose at least one cookie.');
  for (const item of items) if (item.qty > availableFor(item.flavorId)) return toast(`Not enough ${flavorById(item.flavorId)?.name}.`);
  const saleItems = snapshotSaleItems(items);
  const breakdown = pricingBreakdown(sellMeta, saleItems, sellMeta.paymentMethod);
  if (breakdown.error) return toast(breakdown.error);
  items.forEach(i => flavorById(i.flavorId).stock -= i.qty);
  const deal = sellMeta.pricingMode === 'deal' ? pricingDeal(sellMeta) : null;
  const sale = {
    id: uid('sale'),
    items: saleItems,
    customer: sellMeta.customer.trim(),
    paid: true,
    paymentMethod: sellMeta.paymentMethod,
    unitPrice: breakdown.unitPrice,
    total: breakdown.total,
    brotherTotal: breakdown.brotherTotal,
    pricingMode: sellMeta.pricingMode || 'none',
    discountAmount: breakdown.discount,
    discountReason: breakdown.discount ? sellMeta.discountReason.trim() : '',
    chargeEnabled: breakdown.hasOverride,
    priceOverrideTotal: breakdown.hasOverride ? breakdown.total : '',
    chargeReason: breakdown.hasOverride ? sellMeta.chargeReason.trim() : '',
    dealId: deal?.id || '',
    dealSnapshot: deal ? { id:deal.id, name:deal.name, qty:Number(deal.qty), price:Number(deal.price) } : null,
    createdAt: new Date().toISOString(),
    source: 'direct'
  };
  state.sales.push(sale);
  saveState();
  sellDraft = {};
  sellMeta = blankSaleMeta();
  navTo('home');
  toast(`Sale recorded: ${money(sale.total)}${sale.discountAmount ? ` · ${money(sale.discountAmount)} discount` : ''}`);
}

function renderOrders() {
  const sorted = [...state.orders].sort((a, b) => {
    const rank = { open: 0, waiting: 1, fulfilled: 2, cancelled: 3 };
    const diff = (rank[a.status] ?? 3) - (rank[b.status] ?? 3);
    if (diff) return diff;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  main.innerHTML = `
    <button class="btn primary full" onclick="openNewOrder()">＋ New order</button>
    <div class="section-head"><div><h2>Orders</h2><div class="sub">Reserved orders hold stock. Future orders auto-reserve once the full order is available.</div></div></div>
    ${sorted.length ? `<div class="card-list">${sorted.map(orderCard).join('')}</div>` : emptyState('🧾', 'No orders yet', 'Create an order to reserve cookies for someone.')}
  `;
}

function orderCard(order) {
  const status = order.status || 'open';
  const method = order.paymentMethod || (order.paid ? 'legacy' : 'unpaid');
  const pricing = pricingBreakdown(order, order.items, method);
  const total = pricing.total;
  const details = [
    order.contact ? `Contact: ${esc(order.contact)}` : '',
    order.dueAt ? `Due: ${esc(dateText(order.dueAt))}` : '',
    order.location ? `Meet: ${esc(order.location)}` : ''
  ].filter(Boolean).join('<br>');
  const paymentClass = method === 'unpaid' ? 'unpaid' : 'paid';
  const statusText = status === 'open' ? 'RESERVED' : status === 'waiting' ? 'WAITING STOCK' : status === 'fulfilled' ? 'DELIVERED' : 'CANCELLED';
  const paymentText = method === 'unpaid' ? 'UNPAID' : paymentLabel(method).toUpperCase();
  return `<div class="list-card">
    <div class="order-head">
      <div><div class="flavor-name">${esc(order.customer || 'Unnamed customer')}</div><div class="meta">${dateText(order.createdAt)}${status === 'fulfilled' && order.fulfilledAt ? ` · Delivered ${dateText(order.fulfilledAt)}` : ''}</div></div>
      <div style="text-align:right"><div class="order-total">${money(total)}</div><span class="status ${status}">${statusText}</span></div>
    </div>
    <div class="order-items">${esc(itemSummary(order.items))}${details ? `<div class="order-detail-block">${details}</div>` : ''}${order.note ? `<div class="order-note">${esc(order.note)}</div>` : ''}</div>
    ${pricing.discount ? `<div class="discount-tag"><strong>${esc(pricingLabel(order))}</strong> · −${money(pricing.discount)}<br><span>${esc(order.discountReason || '')}</span></div>` : ''}
    ${pricing.hasOverride ? `<div class="discount-tag">Custom charge · ${money(pricing.total)} · ${esc(order.chargeReason || '')}</div>` : ''}
    ${order.reserveMode === 'auto' ? `<div class="order-auto-note">${status === 'waiting' ? '⏳ Future order · auto-reserves when every cookie is available' : status === 'open' ? '✓ Future order · stock is reserved' : 'Future order'}</div>` : ''}
    <div style="margin-top:9px"><span class="status ${paymentClass}">${esc(paymentText)}</span></div>
    ${status === 'open' ? `<div class="order-actions">
      <button class="btn green small" onclick="fulfillOrder('${order.id}')">✓ Delivered</button>
      <button class="btn secondary small" onclick="openEditOrder('${order.id}')">Edit</button>
      <button class="btn ghost small" onclick="openOrderPayment('${order.id}')">Payment</button>
      <button class="btn red small" onclick="cancelOrder('${order.id}')">Cancel</button>
    </div>` : ''}
    ${status === 'waiting' ? `<div class="order-actions">
      <button class="btn secondary small" onclick="openEditOrder('${order.id}')">Edit</button>
      <button class="btn ghost small" onclick="openOrderPayment('${order.id}')">Payment</button>
      <button class="btn red small" onclick="cancelOrder('${order.id}')">Cancel</button>
    </div>` : ''}
    ${status === 'fulfilled' ? `<div class="order-actions">
      <button class="btn secondary small" onclick="undoFulfillOrder('${order.id}')">↶ Undo delivery</button>
      <button class="btn ghost small" onclick="openOrderPayment('${order.id}')">Change payment</button>
    </div>` : ''}
    ${status === 'cancelled' ? `<div class="order-actions"><button class="btn secondary small" onclick="restoreOrder('${order.id}')">Restore order</button></div>` : ''}
  </div>`;
}

function openNewOrder() {
  editingOrderId = null;
  orderDraft = {};
  orderMeta = blankOrderMeta();
  showModal('');
  renderOrderComposer();
}

function openEditOrder(orderId) {
  const order = state.orders.find(o => o.id === orderId);
  if (!order || !['open','waiting'].includes(order.status)) return;
  editingOrderId = orderId;
  orderDraft = Object.fromEntries(order.items.map(i => [i.flavorId, i.qty]));
  orderMeta = {
    customer: order.customer || '',
    contact: order.contact || '',
    location: order.location || '',
    dueAt: order.dueAt || '',
    note: order.note || '',
    paymentMethod: order.paymentMethod || (order.paid ? 'legacy' : 'unpaid'),
    reserveMode: order.reserveMode || (order.status === 'waiting' ? 'auto' : 'now'),
    pricingMode: order.pricingMode || 'none',
    discountAmount: order.discountAmount || '',
    discountReason: order.discountReason || '',
    dealId: order.dealId || order.dealSnapshot?.id || '',
    dealSnapshot: order.dealSnapshot || null,
    chargeEnabled: !!order.chargeEnabled,
    priceOverrideTotal: order.priceOverrideTotal ?? '',
    chargeReason: order.chargeReason || ''
  };
  showModal('');
  renderOrderComposer();
}

function setOrderPayment(method) {
  captureOrderMeta();
  orderMeta.paymentMethod = method;
  renderOrderComposer();
}

function setOrderReserveMode(mode) {
  captureOrderMeta();
  orderMeta.reserveMode = mode === 'auto' ? 'auto' : 'now';
  renderOrderComposer();
}

function renderOrderComposer() {
  const method = orderMeta.paymentMethod || 'unpaid';
  const items = draftItems(orderDraft);
  const qty = itemsQty(items);
  const breakdown = pricingBreakdown(orderMeta, items, method);
  showModal(`
    <div class="modal-head"><div><div class="meta">${editingOrderId ? 'EDIT ORDER' : 'NEW ORDER'}</div><h2>${editingOrderId ? 'Update order' : 'Reserve cookies'}</h2></div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="field"><label>Customer name</label><input id="orderCustomer" placeholder="Name" value="${esc(orderMeta.customer)}"></div>
    <div class="two-col">
      <div class="field"><label>Contact (optional)</label><input id="orderContact" placeholder="Phone, Snap, etc." value="${esc(orderMeta.contact)}"></div>
      <div class="field"><label>Meet location (optional)</label><input id="orderLocation" placeholder="Lunch, class, hallway…" value="${esc(orderMeta.location)}"></div>
    </div>
    <div class="field"><label>Due / meet time (optional)</label><input id="orderDueAt" type="datetime-local" value="${esc(orderMeta.dueAt)}"></div>
    <div class="field">
      <label>Inventory reservation</label>
      <div class="reserve-mode-grid">
        <button type="button" class="payment-choice ${orderMeta.reserveMode !== 'auto' ? 'selected' : ''}" onclick="setOrderReserveMode('now')"><span class="payment-title">Reserve now</span><span class="payment-sub">Only save if all cookies are available now</span></button>
        <button type="button" class="payment-choice ${orderMeta.reserveMode === 'auto' ? 'selected' : ''}" onclick="setOrderReserveMode('auto')"><span class="payment-title">Future order · auto-reserve</span><span class="payment-sub">Save even if stock is short; reserve the full order automatically once ready</span></button>
      </div>
    </div>
    <div class="form-card" style="box-shadow:none;margin-bottom:12px"><h3 style="margin-bottom:7px">Cookies</h3>${renderQtyRows('order')}</div>
    <div class="field"><label>Payment</label>${paymentButtons(method, 'order')}</div>
    ${pricingControls(orderMeta, 'order', items, method)}
    <div class="field"><label>Notes (optional)</label><textarea id="orderNote" placeholder="Class period, special instructions, reminder…">${esc(orderMeta.note)}</textarea></div>
    <div class="summary-strip"><div><div class="meta">${qty} COOKIE${qty === 1 ? '' : 'S'}${breakdown.discount ? ` · ${money(breakdown.discount)} OFF` : ''}</div><strong>${money(breakdown.total)}</strong>${breakdown.discount ? `<div class="meta"><s>${money(breakdown.baseTotal)}</s> regular</div>` : ''}</div><div style="text-align:right"><div class="meta">BROTHER GETS</div><strong>${money(breakdown.brotherTotal)}</strong><div class="meta">Mine ${money(breakdown.profit)}</div></div></div>
    <button class="btn primary full" onclick="saveOrder()">${editingOrderId ? 'Save changes' : 'Save order'}</button>
  `, true);
}

function saveOrder() {
  captureOrderMeta();
  const items = snapshotSaleItems(draftItems(orderDraft));
  const customer = orderMeta.customer.trim();
  if (!customer) return toast('Enter the customer name.');
  if (!items.length) return toast('Choose at least one cookie.');
  const pricing = pricingBreakdown(orderMeta, items, orderMeta.paymentMethod || 'unpaid');
  if (pricing.error) return toast(pricing.error);
  const selectedDeal = orderMeta.pricingMode === 'deal' ? pricingDeal(orderMeta) : null;
  const dealSnapshot = selectedDeal ? { id:selectedDeal.id, name:selectedDeal.name, qty:Number(selectedDeal.qty), price:Number(selectedDeal.price) } : null;
  if (orderMeta.reserveMode !== 'auto') {
    for (const item of items) {
      const capacity = availableFor(item.flavorId, editingOrderId);
      if (item.qty > capacity) return toast(`Not enough ${flavorById(item.flavorId)?.name} available.`);
    }
  }
  const nextStatus = orderMeta.reserveMode === 'auto' && !canReserveItems(items, editingOrderId) ? 'waiting' : 'open';

  if (editingOrderId) {
    const order = state.orders.find(o => o.id === editingOrderId);
    if (!order || !['open','waiting'].includes(order.status)) return toast('That order can no longer be edited.');
    Object.assign(order, {
      customer,
      contact: orderMeta.contact.trim(),
      location: orderMeta.location.trim(),
      dueAt: orderMeta.dueAt,
      note: orderMeta.note.trim(),
      paymentMethod: orderMeta.paymentMethod,
      paid: orderMeta.paymentMethod !== 'unpaid',
      items,
      pricingMode: orderMeta.pricingMode || 'none',
      discountAmount: pricing.discount,
      discountReason: pricing.discount ? orderMeta.discountReason.trim() : '',
      chargeEnabled: pricing.hasOverride,
      priceOverrideTotal: pricing.hasOverride ? pricing.total : '',
      chargeReason: pricing.hasOverride ? orderMeta.chargeReason.trim() : '',
      dealId: selectedDeal?.id || '',
      dealSnapshot,
      reserveMode: orderMeta.reserveMode,
      status: nextStatus,
      updatedAt: new Date().toISOString()
    });
    if (nextStatus === 'open' && orderMeta.reserveMode === 'auto') order.autoReservedAt = order.autoReservedAt || new Date().toISOString();
    if (nextStatus === 'waiting') delete order.autoReservedAt;
    autoReserveWaitingOrders();
    saveState();
    editingOrderId = null;
    orderDraft = {};
    orderMeta = blankOrderMeta();
    closeModal();
    render();
    toast(nextStatus === 'waiting' ? 'Future order saved · waiting for full stock' : 'Order updated and reserved');
    return;
  }

  state.orders.push({
    id: uid('order'),
    customer,
    contact: orderMeta.contact.trim(),
    location: orderMeta.location.trim(),
    dueAt: orderMeta.dueAt,
    items,
    note: orderMeta.note.trim(),
    pricingMode: orderMeta.pricingMode || 'none',
    discountAmount: pricing.discount,
    discountReason: pricing.discount ? orderMeta.discountReason.trim() : '',
    chargeEnabled: pricing.hasOverride,
    priceOverrideTotal: pricing.hasOverride ? pricing.total : '',
    chargeReason: pricing.hasOverride ? orderMeta.chargeReason.trim() : '',
    dealId: selectedDeal?.id || '',
    dealSnapshot,
    paymentMethod: orderMeta.paymentMethod,
    paid: orderMeta.paymentMethod !== 'unpaid',
    reserveMode: orderMeta.reserveMode,
    status: nextStatus,
    autoReservedAt: nextStatus === 'open' && orderMeta.reserveMode === 'auto' ? new Date().toISOString() : undefined,
    createdAt:new Date().toISOString()
  });
  autoReserveWaitingOrders();
  saveState();
  orderDraft = {};
  orderMeta = blankOrderMeta();
  closeModal();
  navTo('orders');
  toast(nextStatus === 'waiting' ? 'Future order saved · it will auto-reserve when fully in stock' : 'Order saved and inventory reserved');
}

function openOrderPayment(orderId) {
  const order = state.orders.find(o => o.id === orderId);
  if (!order) return;
  const selected = order.paymentMethod || (order.paid ? 'legacy' : 'unpaid');
  showModal(`
    <div class="modal-head"><div><div class="meta">ORDER PAYMENT</div><h2>${esc(order.customer)}</h2></div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="setting-desc" style="margin-bottom:12px">Choose how this order was paid. Payment choice uses each cookie’s configured price. Custom charges stay unchanged.</div>
    <div class="payment-grid">${['unpaid','cash','apple','tap'].map(method => `<button type="button" class="payment-choice ${selected === method ? 'selected' : ''}" onclick="setOrderPaymentQuick('${order.id}','${method}')"><span class="payment-title">${esc(paymentLabel(method))}</span><span class="payment-sub">${method === 'tap' ? 'Tap prices' : method === 'unpaid' ? 'Not collected' : 'Cookie prices'}</span></button>`).join('')}</div>
  `);
}

function setOrderPaymentQuick(orderId, method) {
  const order = state.orders.find(o => o.id === orderId);
  if (!order) return;
  order.paymentMethod = method;
  order.paid = method !== 'unpaid';
  order.updatedAt = new Date().toISOString();
  if (order.status === 'fulfilled') {
    const sale = state.sales.find(s => s.orderId === order.id);
    if (sale) {
      sale.paymentMethod = method;
      sale.paid = method !== 'unpaid';
      if (sale.items.some(i => i.priceCash == null)) sale.items = sale.items.map(i => ({...i, priceCash:BASE_PRICE, priceTap:TAP_PRICE}));
      const pricing = pricingBreakdown(sale, sale.items, method);
      sale.unitPrice = pricing.unitPrice;
      sale.total = pricing.total;
      sale.brotherTotal = pricing.brotherTotal;
    }
  }
  saveState();
  closeModal();
  render();
  toast(`Payment: ${paymentLabel(method)}`);
}

function fulfillOrder(orderId) {
  const order = state.orders.find(o => o.id === orderId);
  if (!order || order.status !== 'open') return;
  for (const item of order.items) {
    const f = flavorById(item.flavorId);
    if (!f || f.stock < item.qty) return toast(`Not enough ${f?.name || 'stock'} on hand.`);
  }
  const method = order.paymentMethod || (order.paid ? 'legacy' : 'unpaid');
  const saleItems = order.items.map(i => i.priceCash != null ? {...i} : {...i, priceCash:BASE_PRICE, priceTap:TAP_PRICE, brotherShare:Number(i.brotherShare ?? flavorBrotherShare(i.flavorId))});
  const pricing = pricingBreakdown(order, saleItems, method);
  if (pricing.error) return toast(pricing.error);

  order.items.forEach(i => flavorById(i.flavorId).stock -= i.qty);
  order.status = 'fulfilled';
  order.fulfilledAt = new Date().toISOString();
  state.sales.push({
    id: uid('sale'),
    items: saleItems,
    customer: order.customer,
    paid: method !== 'unpaid',
    paymentMethod: method,
    unitPrice: pricing.unitPrice,
    total: pricing.total,
    brotherTotal: pricing.brotherTotal,
    pricingMode: order.pricingMode || 'none',
    discountAmount: pricing.discount,
    discountReason: pricing.discount ? order.discountReason || '' : '',
    chargeEnabled: pricing.hasOverride,
    priceOverrideTotal: pricing.hasOverride ? pricing.total : '',
    chargeReason: pricing.hasOverride ? order.chargeReason || '' : '',
    dealId: order.dealId || order.dealSnapshot?.id || '',
    dealSnapshot: order.dealSnapshot || null,
    createdAt: order.fulfilledAt,
    source:'order',
    orderId: order.id
  });
  saveState();
  render();
  toast('Order delivered and sale recorded');
}

function undoFulfillOrder(orderId) {
  const order = state.orders.find(o => o.id === orderId);
  if (!order || order.status !== 'fulfilled') return;
  if (!confirm(`Undo delivery for ${order.customer}? This will put the cookies back in stock and remove the linked sale.`)) return;
  const saleIndex = state.sales.findIndex(s => s.orderId === order.id);
  if (saleIndex >= 0) {
    const sale = state.sales[saleIndex];
    sale.items.forEach(i => {
      const f = flavorById(i.flavorId);
      if (f) f.stock += i.qty;
    });
    state.sales.splice(saleIndex, 1);
  } else {
    order.items.forEach(i => {
      const f = flavorById(i.flavorId);
      if (f) f.stock += i.qty;
    });
  }
  order.status = 'open';
  delete order.fulfilledAt;
  order.updatedAt = new Date().toISOString();
  saveState();
  render();
  toast('Delivery undone · order is open again');
}

function cancelOrder(orderId) {
  const order = state.orders.find(o => o.id === orderId);
  if (!order || !['open','waiting'].includes(order.status)) return;
  if (!confirm(`Cancel ${order.customer}'s order?${order.status === 'open' ? ' Reserved cookies will become available again.' : ''}`)) return;
  order.cancelledFromStatus = order.status;
  order.status = 'cancelled';
  order.cancelledAt = new Date().toISOString();
  const newlyReserved = autoReserveWaitingOrders();
  saveState();
  render();
  toast(newlyReserved.length ? `Order cancelled · ${newlyReserved.length} future order${newlyReserved.length === 1 ? '' : 's'} auto-reserved` : 'Order cancelled');
}

function restoreOrder(orderId) {
  const order = state.orders.find(o => o.id === orderId);
  if (!order || order.status !== 'cancelled') return;
  const auto = order.reserveMode === 'auto';
  if (!auto) {
    for (const item of order.items) if (item.qty > availableFor(item.flavorId)) return toast(`Not enough ${flavorById(item.flavorId)?.name} available to restore this order.`);
  }
  order.status = auto && !canReserveItems(order.items, order.id) ? 'waiting' : 'open';
  if (order.status === 'open' && auto) order.autoReservedAt = new Date().toISOString();
  delete order.cancelledAt;
  delete order.cancelledFromStatus;
  order.updatedAt = new Date().toISOString();
  autoReserveWaitingOrders();
  saveState();
  render();
  toast(order.status === 'waiting' ? 'Future order restored · waiting for stock' : 'Order restored and reserved');
}

function salesByFlavor(sales = state.sales) {
  const map = new Map(state.flavors.map(f => [f.id, { qty:0, revenue:0, brother:0 }]));
  sales.forEach(sale => {
    const items = sale.items || [];
    const qtyTotal = Math.max(1, itemsQty(items));
    const method = sale.paymentMethod || 'cash';
    const hasSnapshots = items.every(i => i.priceCash != null && i.priceTap != null);
    const rawWeights = items.map(i => hasSnapshots ? Number(i.qty || 0) * itemUnitPrice(i, method) : Number(i.qty || 0) * Number(sale.unitPrice || BASE_PRICE));
    const sumWeights = rawWeights.reduce((a,b) => a+b, 0) || qtyTotal;
    const baseBrother = brotherForItems(items);
    items.forEach((i, index) => {
      const current = map.get(i.flavorId) || {qty:0,revenue:0,brother:0};
      const itemQty = Number(i.qty || 0);
      const share = rawWeights[index] > 0 ? rawWeights[index] / sumWeights : itemQty / qtyTotal;
      const itemBrotherBase = itemQty * Number(i.brotherShare ?? flavorBrotherShare(i.flavorId));
      const brotherDiscount = baseBrother > 0 ? Number(sale.discountAmount || 0) * itemBrotherBase / baseBrother : 0;
      current.qty += itemQty;
      current.revenue += Number(sale.total || 0) * share;
      current.brother += Math.max(0, itemBrotherBase - brotherDiscount);
      map.set(i.flavorId,current);
    });
  });
  return activeFlavors().map(f => ({f,...(map.get(f.id)||{qty:0,revenue:0,brother:0})})).sort((a,b)=>b.qty-a.qty);
}

function paymentTotals(sales = state.sales) {
  const totals = { cash:0, apple:0, tap:0, unpaid:0, legacy:0 };
  sales.forEach(s => {
    const method = s.paymentMethod || (s.paid ? 'legacy' : 'unpaid');
    totals[method] = (totals[method] || 0) + Number(s.total || 0);
  });
  return totals;
}

function salesRevenue(sales) { return (sales || []).reduce((sum, sale) => sum + Number(sale.total || 0), 0); }
function salesBrother(sales) { return (sales || []).reduce((sum, sale) => sum + Number(sale.brotherTotal ?? brotherForItems(sale.items)), 0); }
function salesProfit(sales) { return salesRevenue(sales) - salesBrother(sales); }
function salesQty(sales) { return (sales || []).reduce((sum, sale) => sum + itemsQty(sale.items), 0); }
function salesCollected(sales) { return (sales || []).filter(s => s.paid).reduce((sum, sale) => sum + Number(sale.total || 0), 0); }

function setMoneyDate(value) {
  if (!value) return;
  moneyViewDate = value;
  moneyDateMode = 'day';
  renderMoney();
}

function changeMoneyDate(delta) {
  const base = new Date(`${moneyViewDate}T12:00:00`);
  if (Number.isNaN(base.getTime())) return;
  base.setDate(base.getDate() + delta);
  moneyViewDate = localDateKey(base);
  moneyDateMode = 'day';
  renderMoney();
}

function showTodayMoney() {
  moneyViewDate = localDateKey(new Date());
  moneyDateMode = 'day';
  renderMoney();
}

function showAllMoney() {
  moneyDateMode = 'all';
  renderMoney();
}

function renderMoney() {
  const filteredSales = moneyDateMode === 'all'
    ? [...state.sales]
    : state.sales.filter(sale => localDateKey(sale.createdAt) === moneyViewDate);
  const rows = salesByFlavor(filteredSales);
  const recent = [...filteredSales].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const payments = paymentTotals(filteredSales);
  const revenue = salesRevenue(filteredSales);
  const brother = salesBrother(filteredSales);
  const profit = salesProfit(filteredSales);
  const qty = salesQty(filteredSales);
  const collected = salesCollected(filteredSales);
  const unpaid = revenue - collected;
  const periodLabel = moneyDateMode === 'all' ? 'All time' : formatMoneyDate(moneyViewDate);
  main.innerHTML = `
    <div class="money-date-card">
      <div>
        <div class="meta">VIEWING</div>
        <div class="money-date-title">${esc(periodLabel)}</div>
      </div>
      <div class="date-mode-row">
        <button class="btn ${moneyDateMode === 'all' ? 'primary' : 'ghost'} small" onclick="showAllMoney()">All time</button>
        <button class="btn ${moneyDateMode === 'day' ? 'primary' : 'ghost'} small" onclick="showTodayMoney()">Today</button>
      </div>
      <div class="date-switcher ${moneyDateMode === 'all' ? 'dimmed' : ''}">
        <button class="date-arrow" onclick="changeMoneyDate(-1)" aria-label="Previous day">‹</button>
        <input type="date" value="${esc(moneyViewDate)}" onchange="setMoneyDate(this.value)">
        <button class="date-arrow" onclick="changeMoneyDate(1)" aria-label="Next day">›</button>
      </div>
    </div>

    <section class="stat-grid money-stats">
      ${statCard('My profit', money(profit), `${qty} cookie${qty === 1 ? '' : 's'} · revenue minus brother share`)}
      ${statCard('Revenue', money(revenue), unpaid > 0 ? `${money(unpaid)} unpaid` : `${money(collected)} collected`)}
      ${statCard('Brother share', money(brother), `${periodLabel}`)}
      ${statCard('Still owe', money(Math.max(0, brotherBalance())), `${money(totalBrotherPaid())} paid overall`)}
    </section>

    <div class="form-card">
      <h2>Payment methods</h2>
      <div class="payment-summary-grid">
        <div><span>Cash</span><strong>${money(payments.cash)}</strong></div>
        <div><span>Apple Pay</span><strong>${money(payments.apple)}</strong></div>
        <div><span>Tap to Pay</span><strong>${money(payments.tap)}</strong></div>
        <div><span>Unpaid</span><strong>${money(payments.unpaid)}</strong></div>
      </div>
    </div>

    <div class="form-card">
      <div class="section-head" style="margin-top:0"><div><h2>Pay brother</h2><div class="sub">Record money you've handed over · balance above is always all-time</div></div></div>
      <div style="display:grid;grid-template-columns:1fr auto;gap:8px"><input id="brotherPayment" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Amount"><button class="btn primary" onclick="recordBrotherPayment()">Add</button></div>
    </div>

    <div class="form-card">
      <h2>Sales by flavor · ${esc(periodLabel)}</h2>
      <table class="money-table"><thead><tr><th>Flavor</th><th>Sold</th><th>Sales</th><th>Brother</th><th>Mine</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${esc(flavorLabel(r.f))}</td><td>${r.qty}</td><td>${money(r.revenue)}</td><td>${money(r.brother)}</td><td>${money(r.revenue - r.brother)}</td></tr>`).join('')}
      </tbody></table>
    </div>

    <div class="section-head"><div><h2>Sales history</h2><div class="sub">${esc(periodLabel)} · payment method and sale price</div></div></div>
    ${recent.length ? `<div class="card-list">${recent.map(saleCard).join('')}</div>` : emptyState('💵', 'No sales for this date', moneyDateMode === 'all' ? 'Complete a sale to start your totals.' : 'Use the arrows or date picker to view another day.')}
  `;
}

function saleCard(sale) {
  const method = sale.paymentMethod || (sale.paid ? 'legacy' : 'unpaid');
  const discount = Number(sale.discountAmount || 0);
  const pricingNote = `${discount ? `<div class="discount-tag"><strong>${esc(pricingLabel(sale))}</strong> · −${money(discount)}<br><span>${esc(sale.discountReason || '')}</span></div>` : ''}${sale.chargeEnabled ? `<div class="discount-tag">Custom customer charge · ${money(sale.total)} · ${esc(sale.chargeReason || '')}</div>` : ''}`;
  return `<div class="list-card">
    <div class="order-head"><div><div class="flavor-name">${esc(sale.customer || 'Quick sale')}</div><div class="meta">${dateText(sale.createdAt)} · ${esc(itemSummary(sale.items))}<br>${esc(paymentLabel(method))} · ${money(sale.total)} customer charge · Brother ${money(sale.brotherTotal ?? brotherForItems(sale.items))}</div></div><div style="text-align:right"><div class="order-total">${money(sale.total)}</div><span class="status ${sale.paid ? 'paid' : 'unpaid'}">${sale.paid ? 'PAID' : 'UNPAID'}</span></div></div>
    ${pricingNote}
    ${!sale.paid ? `<div class="order-actions"><button class="btn green small" onclick="openSalePayment('${sale.id}')">Collect payment</button></div>` : ''}
  </div>`;
}

function openSalePayment(saleId) {
  const sale = state.sales.find(s => s.id === saleId);
  if (!sale) return;
  showModal(`
    <div class="modal-head"><div><div class="meta">COLLECT PAYMENT</div><h2>${esc(sale.customer || 'Sale')}</h2></div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="setting-desc" style="margin-bottom:12px">Choose how they paid. Payment method may change the charge unless a custom total was set. Actual amounts remain in financial records.</div>
    <div class="payment-grid">${['cash','apple','tap'].map(method => `<button class="payment-choice" onclick="markSalePaid('${sale.id}','${method}')"><span class="payment-title">${esc(paymentLabel(method))}</span><span class="payment-sub">${method === 'tap' ? 'Tap prices' : 'Cookie prices'}</span></button>`).join('')}</div>
  `);
}

function markSalePaid(saleId, method = 'cash') {
  const sale = state.sales.find(s => s.id === saleId);
  if (!sale) return;
  sale.paid = true;
  sale.paymentMethod = method;
  if (sale.items.some(i => i.priceCash == null)) {
    sale.items = sale.items.map(i => ({...i, priceCash:BASE_PRICE, priceTap:TAP_PRICE}));
  }
  const pricing = pricingBreakdown(sale, sale.items, method);
  if (pricing.error) return toast(pricing.error);
  sale.unitPrice = pricing.unitPrice;
  sale.total = pricing.total;
  sale.brotherTotal = pricing.brotherTotal;
  if (sale.orderId) {
    const order = state.orders.find(o => o.id === sale.orderId);
    if (order) {
      order.paid = true;
      order.paymentMethod = method;
    }
  }
  saveState();
  closeModal();
  render();
  toast(`Paid with ${paymentLabel(method)}`);
}

function recordBrotherPayment() {
  const input = $('#brotherPayment');
  const amount = Number(input?.value || 0);
  if (!(amount > 0)) return toast('Enter a payment amount.');
  state.brotherPayments.push({ id:uid('pay'), amount, createdAt:new Date().toISOString() });
  saveState();
  render();
  toast(`Recorded ${money(amount)} paid to brother`);
}

function openSettings() {
  showModal(`
    <div class="modal-head"><div><div class="meta">COOKIE TRACKER</div><h2>Settings</h2></div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="setting-row"><div class="setting-title">Selling prices</div><div class="setting-desc">Prices are set for each cookie size and flavor. Regular defaults to $6 ($7 Tap); jumbo prices are editable.</div></div>
    <div class="setting-row">
      <div class="setting-title">Brother commission by cookie</div>
      <div class="setting-desc">Set exactly how much your brother gets for each cookie sold. New sales lock in the commission at the time of the sale, so changing this later will not rewrite old sales.</div>
      <div class="commission-list">
        ${activeFlavors().map(f => `<div class="commission-row"><label>${esc(f.name)}</label><div class="money-input"><span>$</span><input data-brother-share="${esc(f.id)}" type="number" min="0" max="${Number(f.priceCash ?? BASE_PRICE)}" step="0.01" inputmode="decimal" value="${Number(f.brotherShare ?? DEFAULT_BROTHER_SHARE).toFixed(2)}"></div></div>`).join('')}
      </div>
      <button class="btn secondary small" style="margin-top:10px" onclick="saveFlavorShares()">Save commissions</button>
    </div>
    ${deletedFlavors().length ? `<div class="setting-row">
      <div class="setting-title">Deleted cookies</div>
      <div class="setting-desc">Deleted cookies stay here so old sales and orders keep their names. Restore one if you need to sell it again.</div>
      <div class="deal-list">
        ${deletedFlavors().map(f => `<div class="deal-row"><div><strong>${esc(f.name)}</strong><div class="meta">Brother ${money(f.brotherShare)}</div></div><button class="btn secondary small" onclick="restoreFlavor('${f.id}')">Restore</button></div>`).join('')}
      </div>
    </div>` : ''}
    <div class="setting-row">
      <div class="setting-title">Custom deals</div>
      <div class="setting-desc">Create deals such as 4 for $20. A deal is never applied automatically—you choose it on a sale or order. The deal discount comes entirely out of your brother's cut.</div>
      <div class="deal-list">
        ${activeDeals().length ? activeDeals().map(d => `<div class="deal-row"><div><strong>${esc(d.name)}</strong><div class="meta">${d.qty} cookies for ${money(d.price)} · saves ${money(dealDiscount(d))}</div></div><button class="btn red small" onclick="deleteDeal('${d.id}')">Delete</button></div>`).join('') : '<div class="field-hint">No custom deals yet.</div>'}
      </div>
      <div class="deal-builder">
        <div class="field"><label>Deal name (optional)</label><input id="newDealName" placeholder="e.g. 4 for $20"></div>
        <div class="two-col">
          <div class="field"><label>Cookie quantity</label><input id="newDealQty" type="number" min="1" step="1" inputmode="numeric" placeholder="4"></div>
          <div class="field"><label>Deal total</label><div class="money-input"><span>$</span><input id="newDealPrice" type="number" min="0" step="0.01" inputmode="decimal" placeholder="20.00"></div></div>
        </div>
        <button class="btn secondary small" onclick="addDeal()">＋ Add deal</button>
      </div>
    </div>
    <div class="setting-row">
      <div class="setting-title">Low-stock warning</div><div class="setting-desc">Available stock at or below this number shows in red.</div>
      <div style="margin-top:10px"><input id="lowStockInput" type="number" min="0" step="1" inputmode="numeric" value="${state.settings.lowStock}"></div>
      <button class="btn secondary small" style="margin-top:8px" onclick="saveLowStock()">Save warning</button>
    </div>
    <div class="setting-row"><div class="setting-title">Backup</div><div class="setting-desc">Export your full inventory, orders, settings, and sales as a JSON backup.</div><div class="row-actions"><button class="btn ghost small" onclick="exportBackup()">Export backup</button><button class="btn ghost small" onclick="importFile.click()">Import backup</button><button class="btn ghost small" onclick="exportSalesCSV()">Sales CSV</button></div></div>
    <div class="danger-zone"><div class="setting-title" style="color:var(--red)">Reset app</div><div class="setting-desc">Deletes all stock, sales, orders, and payments from this device.</div><button class="btn red small" style="margin-top:10px" onclick="resetApp()">Erase all data</button></div>
  `);
}

function saveFlavorShares() {
  const inputs = [...document.querySelectorAll('[data-brother-share]')];
  for (const input of inputs) {
    const value = Number(input.value);
    const f = flavorById(input.dataset.brotherShare);
    if (Number.isNaN(value) || value < 0 || value > Number(f?.priceCash ?? BASE_PRICE)) return toast('Brother commission cannot exceed this cookie’s cash price.');
  }
  inputs.forEach(input => {
    const f = flavorById(input.dataset.brotherShare);
    if (f) f.brotherShare = Number(input.value);
  });
  saveState();
  closeModal();
  render();
  toast('Flavor commissions updated');
}

function addDeal() {
  const qty = Math.max(0, parseInt($('#newDealQty')?.value || '0', 10));
  const price = roundMoney(Number($('#newDealPrice')?.value || 0));
  let name = $('#newDealName')?.value.trim() || '';
  if (!(qty > 0)) return toast('Enter how many cookies are in the deal.');
  if (!(price >= 0)) return toast('Enter a valid deal price.');
  const regular = roundMoney(qty * BASE_PRICE);
  if (price >= regular) return toast(`Deal total must be less than the regular ${money(regular)} price.`);
  if (!name) name = `${qty} for ${money(price).replace('.00','')}`;
  state.deals.push({ id:uid('deal'), name, qty, price, active:true, createdAt:new Date().toISOString() });
  saveState();
  openSettings();
  toast(`${name} added`);
}

function deleteDeal(dealId) {
  const deal = dealById(dealId);
  if (!deal) return;
  if (!confirm(`Delete the ${deal.name} deal? Existing orders and sales keep their saved deal details.`)) return;
  state.deals = state.deals.filter(d => d.id !== dealId);
  saveState();
  openSettings();
  toast('Deal deleted');
}

function saveLowStock() {
  const value = Math.max(0, parseInt($('#lowStockInput')?.value || '0', 10));
  state.settings.lowStock = value;
  saveState();
  closeModal();
  render();
  toast('Low-stock warning updated');
}

function flavorNameExists(name, excludeId = null, size = 'Regular') {
  const target = String(name || '').trim().toLowerCase();
  return state.flavors.some(f => f.id !== excludeId && f.active && String(f.name || '').trim().toLowerCase() === target && (f.size || 'Regular') === size);
}

function activeOrderReferencesFlavor(flavorId) {
  return state.orders.some(o => ['open', 'waiting'].includes(o.status) && (o.items || []).some(i => i.flavorId === flavorId && Number(i.qty || 0) > 0));
}

function cookieFormFields(prefix, cookie) {
  const f = cookie || { name:'', size:'Regular', priceCash: BASE_PRICE, priceTap:TAP_PRICE, brotherShare:DEFAULT_BROTHER_SHARE };
  const cash = Number(f.priceCash ?? BASE_PRICE);
  const brother = Number(f.brotherShare ?? DEFAULT_BROTHER_SHARE);
  return `
    <div class="field"><label>Cookie flavor</label><input id="${prefix}FlavorName" placeholder="e.g. Kinder" value="${esc(f.name)}" maxlength="60"></div>
    <div class="field"><label>Size</label><select id="${prefix}FlavorSize"><option value="Regular" ${f.size !== 'Jumbo (8 oz)' ? 'selected' : ''}>Regular</option><option value="Jumbo (8 oz)" ${f.size === 'Jumbo (8 oz)' ? 'selected' : ''}>Jumbo (8 oz)</option></select></div>
    <div class="two-col">
      <div class="field"><label>Cash / Apple Pay price</label><div class="money-input"><span>$</span><input id="${prefix}PriceCash" type="number" min="0.01" step="0.01" inputmode="decimal" value="${cash.toFixed(2)}" oninput="syncSplitInputs('${prefix}','price')"></div></div>
      <div class="field"><label>Tap to Pay price</label><div class="money-input"><span>$</span><input id="${prefix}PriceTap" type="number" min="0.01" step="0.01" inputmode="decimal" value="${Number(f.priceTap ?? TAP_PRICE).toFixed(2)}"></div></div>
    </div>
    <div class="two-col">
      <div class="field"><label>Brother's cut</label><div class="money-input"><span>$</span><input id="${prefix}FlavorShare" type="number" min="0" step="0.01" inputmode="decimal" value="${brother.toFixed(2)}" oninput="syncSplitInputs('${prefix}','brother')"></div></div>
      <div class="field"><label>My cut</label><div class="money-input"><span>$</span><input id="${prefix}MyCut" type="number" min="0" step="0.01" inputmode="decimal" value="${roundMoney(cash - brother).toFixed(2)}" oninput="syncSplitInputs('${prefix}','mine')"></div></div>
    </div>
    <div class="field-hint">The regular price is split between you and your brother. Tap to Pay extra goes to you. Changing either cut updates the other automatically.</div>`;
}
function syncSplitInputs(prefix, changed) {
  const cash = Number($(`#${prefix}PriceCash`)?.value || 0);
  const brotherInput = $(`#${prefix}FlavorShare`);
  const mineInput = $(`#${prefix}MyCut`);
  if (!brotherInput || !mineInput || !Number.isFinite(cash)) return;
  if (changed === 'mine') brotherInput.value = roundMoney(Math.max(0, cash - Number(mineInput.value || 0))).toFixed(2);
  else mineInput.value = roundMoney(Math.max(0, cash - Number(brotherInput.value || 0))).toFixed(2);
}
function readCookieFields(prefix, currentId = null) {
  const name = $(`#${prefix}FlavorName`)?.value.trim() || '';
  const size = $(`#${prefix}FlavorSize`)?.value || 'Regular';
  const priceCash = Number($(`#${prefix}PriceCash`)?.value);
  const priceTap = Number($(`#${prefix}PriceTap`)?.value);
  const brotherShare = Number($(`#${prefix}FlavorShare`)?.value);
  const mine = Number($(`#${prefix}MyCut`)?.value);
  if (!name) return {error:'Enter a cookie name.'};
  if (flavorNameExists(name, currentId, size)) return {error:'This flavor and size already exists.'};
  if (!Number.isFinite(priceCash) || !Number.isFinite(priceTap) || priceCash <= 0 || priceTap <= 0) return {error:'Enter valid prices greater than $0.'};
  if (!Number.isFinite(brotherShare) || brotherShare < 0 || brotherShare > priceCash) return {error:'Brother cut must be between $0 and the regular price.'};
  if (!Number.isFinite(mine) || mine < 0 || Math.abs(roundMoney(mine + brotherShare - priceCash)) > .001) return {error:'Your cut plus brother cut must equal the regular price.'};
  return { name, size, priceCash:roundMoney(priceCash), priceTap:roundMoney(priceTap), brotherShare:roundMoney(brotherShare) };
}
function openEditFlavor(flavorId) {
  const f = flavorById(flavorId);
  if (!f || !f.active) return;
  showModal(`
    <div class="modal-head"><div><div class="meta">COOKIE INVENTORY</div><h2>Edit cookie</h2></div><button class="modal-close" onclick="closeModal()">×</button></div>
    ${cookieFormFields('edit', f)}
    <button class="btn primary full" onclick="saveFlavorEdit('${f.id}')">Save changes</button>
    <div class="danger-zone" style="margin-top:16px">
      <div class="setting-title" style="color:var(--red)">Delete cookie</div>
      <div class="setting-desc">Removes this cookie from new sales and orders, but preserves its sales history. Stock must be zero and no open/waiting orders may reference it.</div>
      <button class="btn red small" style="margin-top:10px" onclick="deleteFlavor('${f.id}')">Delete ${esc(flavorLabel(f))}</button>
    </div>`);
}
function saveFlavorEdit(flavorId) {
  const f = flavorById(flavorId);
  if (!f || !f.active) return;
  const values = readCookieFields('edit', flavorId);
  if (values.error) return toast(values.error);
  Object.assign(f, values, {updatedAt:new Date().toISOString()});
  saveState(); closeModal(); render(); toast(`${flavorLabel(f)} updated`);
}

function deleteFlavor(flavorId) {
  const f = flavorById(flavorId);
  if (!f || !f.active) return;
  if (Number(f.stock || 0) > 0) return toast(`Set ${f.name} stock to 0 before deleting it.`);
  if (activeOrderReferencesFlavor(flavorId)) return toast(`${f.name} is still used in an open or waiting order.`);
  if (!confirm(`Delete ${f.name}? It will disappear from Inventory, Sales, and new Orders. Past history will stay saved.`)) return;
  f.active = false;
  f.deletedAt = new Date().toISOString();
  delete sellDraft[flavorId];
  delete orderDraft[flavorId];
  saveState();
  closeModal();
  render();
  toast(`${f.name} deleted`);
}

function restoreFlavor(flavorId) {
  const f = flavorById(flavorId);
  if (!f || f.active) return;
  if (flavorNameExists(f.name, flavorId, f.size || 'Regular')) return toast(`Rename the active ${f.name} cookie first before restoring this one.`);
  f.active = true;
  delete f.deletedAt;
  saveState();
  openSettings();
  toast(`${f.name} restored`);
}

function openAddJumbo(flavorId) {
  const original = flavorById(flavorId);
  if (!original) return;
  if (flavorNameExists(original.name, null, 'Jumbo (8 oz)')) return toast('Jumbo already exists for this flavor.');
  showModal(`
    <div class="modal-head"><div><div class="meta">8 OZ OPTION</div><h2>Add jumbo cookie</h2></div><button class="modal-close" onclick="closeModal()">×</button></div>
    ${cookieFormFields('new', { name:original.name, size:'Jumbo (8 oz)', priceCash:7, priceTap:8, brotherShare:5 })}
    <button class="btn primary full" onclick="addFlavor()">Add jumbo cookie</button>
  `);
}
function openAddFlavor() {
  showModal(`
    <div class="modal-head"><div><div class="meta">INVENTORY</div><h2>Add cookie</h2></div><button class="modal-close" onclick="closeModal()">×</button></div>
    ${cookieFormFields('new', {name:'', size:'Regular', priceCash:BASE_PRICE, priceTap:TAP_PRICE, brotherShare:DEFAULT_BROTHER_SHARE})}
    <button class="btn primary full" onclick="addFlavor()">Add cookie</button>
  `);
}
function addFlavor() {
  const values = readCookieFields('new');
  if (values.error) return toast(values.error);
  state.flavors.push({id:uid('flavor'), stock:0, active:true, ...values });
  saveState(); closeModal(); render(); toast(`${flavorLabel(values)} added`);
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type:'application/json' });
  downloadBlob(blob, `cookie-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`);
}

function exportSalesCSV() {
  const header = ['Date','Customer','Items','Quantity','Payment Method','Average Unit Price','Regular Total','Discount','Discount Type','Discount Reason','Actual Charge','Paid','Brother Total','My Profit','Custom Charge','Custom Charge Reason'];
  const rows = state.sales.map(s => [
    new Date(s.createdAt).toLocaleString(),
    s.customer || 'Quick sale',
    itemSummary(s.items),
    itemsQty(s.items),
    paymentLabel(s.paymentMethod || (s.paid ? 'legacy' : 'unpaid')),
    Number(s.unitPrice || BASE_PRICE).toFixed(2),
    (Number(s.total || 0) + Number(s.discountAmount || 0)).toFixed(2),
    Number(s.discountAmount || 0).toFixed(2),
    pricingLabel(s),
    s.discountReason || '',
    Number(s.total || 0).toFixed(2),
    s.paid ? 'Yes' : 'No',
    Number(s.brotherTotal ?? brotherForItems(s.items)).toFixed(2),
    (Number(s.total || 0) - Number(s.brotherTotal ?? brotherForItems(s.items))).toFixed(2),
    s.chargeEnabled ? 'Yes' : 'No',
    s.chargeReason || ''
  ]);
  const csv = [header, ...rows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  downloadBlob(new Blob([csv], { type:'text/csv' }), `cookie-sales-${new Date().toISOString().slice(0, 10)}.csv`);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

importFile.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed.flavors) || !Array.isArray(parsed.sales) || !Array.isArray(parsed.orders)) throw new Error('Invalid backup');
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    state = loadState();
    autoReserveWaitingOrders();
    saveState();
    closeModal();
    render();
    toast('Backup imported');
  } catch {
    toast('That backup file could not be imported.');
  }
  e.target.value = '';
});

function resetApp() {
  if (!confirm('Erase all Cookie Tracker data from this device? This cannot be undone unless you exported a backup.')) return;
  state = defaultState();
  sellDraft = {};
  sellMeta = blankSaleMeta();
  orderDraft = {};
  orderMeta = blankOrderMeta();
  editingOrderId = null;
  saveState();
  closeModal();
  navTo('home');
  toast('App reset');
}

function showModal(html) {
  modalCard.innerHTML = html;
  modalBackdrop.classList.remove('hidden');
}
function closeModal() {
  modalBackdrop.classList.add('hidden');
  modalCard.innerHTML = '';
  editingOrderId = null;
}
modalBackdrop.addEventListener('click', e => { if (e.target === modalBackdrop) closeModal(); });

function emptyState(emoji, title, text) {
  return `<div class="empty"><span class="emoji">${emoji}</span><strong>${esc(title)}</strong><div class="meta" style="margin-top:5px">${esc(text)}</div></div>`;
}

let toastTimer;
function toast(message) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => navTo(btn.dataset.view)));
$('#settingsBtn').addEventListener('click', openSettings);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      .then(reg => reg.update())
      .catch(() => {});
  });
}

autoReserveWaitingOrders();
saveState(); // Runs migrations without changing the storage key or wiping existing data.
render();
