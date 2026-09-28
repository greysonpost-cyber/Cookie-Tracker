const BASE_PRICE = 6;
const TAP_PRICE = 7;
const STORAGE_KEY = 'cookieTrackerDataV1'; // Keep the same key so existing data survives updates.
const APP_VERSION = 2;
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
    brotherShare: DEFAULT_BROTHER_SHARE
  })),
  orders: [],
  sales: [],
  brotherPayments: [],
  inventoryLog: [],
  settings: { lowStock: 3 }
});

let state = loadState();
let currentView = 'home';
let sellDraft = {};
let sellMeta = { customer: '', paymentMethod: 'cash' };
let orderDraft = {};
let orderMeta = blankOrderMeta();
let editingOrderId = null;

const $ = (sel) => document.querySelector(sel);
const main = $('#mainContent');
const pageTitle = $('#pageTitle');
const modalBackdrop = $('#modalBackdrop');
const modalCard = $('#modalCard');
const importFile = $('#importFile');

function blankOrderMeta() {
  return { customer: '', contact: '', location: '', dueAt: '', note: '', paymentMethod: 'unpaid' };
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
          brotherShare: validMoney(f.brotherShare) ? Number(f.brotherShare) : legacyShare
        }))
      : base.flavors;

    merged.orders = Array.isArray(saved.orders) ? saved.orders.map(o => ({
      ...o,
      status: o.status || 'open',
      paid: !!o.paid,
      paymentMethod: o.paymentMethod || (o.paid ? 'legacy' : 'unpaid'),
      contact: o.contact || '',
      location: o.location || '',
      dueAt: o.dueAt || '',
      note: o.note || '',
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
        paid: !!s.paid
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
function flavorById(id) { return state.flavors.find(f => f.id === id); }
function openOrders() { return state.orders.filter(o => o.status === 'open'); }
function paymentLabel(method) { return PAYMENT_LABELS[method] || 'Unknown'; }
function unitPriceForMethod(method) { return method === 'tap' ? TAP_PRICE : BASE_PRICE; }
function orderPaid(order) { return (order.paymentMethod || 'unpaid') !== 'unpaid'; }
function flavorBrotherShare(flavorId) { return Number(flavorById(flavorId)?.brotherShare ?? DEFAULT_BROTHER_SHARE); }

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
function totalSoldQty() { return state.sales.reduce((s, x) => s + itemsQty(x.items), 0); }
function totalRevenue() { return state.sales.reduce((s, x) => s + Number(x.total || 0), 0); }
function collectedRevenue() { return state.sales.filter(s => s.paid).reduce((a, s) => a + Number(s.total || 0), 0); }
function unpaidRevenue() { return state.sales.filter(s => !s.paid).reduce((a, s) => a + Number(s.total || 0), 0); }
function totalBrotherOwed() { return state.sales.reduce((s, sale) => s + Number(sale.brotherTotal ?? brotherForItems(sale.items)), 0); }
function totalBrotherPaid() { return state.brotherPayments.reduce((s, p) => s + Number(p.amount || 0), 0); }
function brotherBalance() { return totalBrotherOwed() - totalBrotherPaid(); }

function itemsQty(items) { return (items || []).reduce((s, i) => s + Number(i.qty || 0), 0); }
function itemsTotal(items, method = 'cash') { return itemsQty(items) * unitPriceForMethod(method); }
function brotherForItems(items) {
  return (items || []).reduce((sum, i) => sum + Number(i.qty || 0) * Number(i.brotherShare ?? flavorBrotherShare(i.flavorId)), 0);
}
function itemSummary(items) {
  return (items || []).filter(i => i.qty > 0).map(i => `${i.qty}× ${flavorById(i.flavorId)?.name || 'Cookie'}`).join(' · ');
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
          <div class="label">PRICE</div>
          <div style="font-size:22px;font-weight:900;margin-top:4px">$6 · $7 tap</div>
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
      ${statCard('Open orders', openOrders().length, `${openOrders().reduce((s, o) => s + itemsQty(o.items), 0)} cookies reserved`)}
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
    <div><div class="flavor-name">${esc(f.name)}</div><div class="meta">${f.stock} on hand${reserved ? ` · ${reserved} reserved` : ''} · Brother ${money(f.brotherShare)}</div></div>
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
            <div><div class="flavor-name">${esc(f.name)}</div><div class="meta">${reserved ? `${reserved} reserved · ` : ''}${avail} available · Brother gets ${money(f.brotherShare)}</div></div>
            <div class="stock-num">${f.stock}</div>
          </div>
          <div class="row-actions">
            <button class="btn secondary small" onclick="adjustStock('${f.id}', 1)">+1</button>
            <button class="btn secondary small" onclick="adjustStock('${f.id}', 6)">+6</button>
            <button class="btn ghost small" onclick="openStockModal('${f.id}')">Adjust</button>
          </div>
        </div>`;
      }).join('')}
    </div>
    <button class="btn ghost full" style="margin-top:12px" onclick="openAddFlavor()">＋ Add flavor</button>
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
  saveState();
  render();
  toast(`${f.name}: ${delta > 0 ? '+' : ''}${delta}`);
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
  saveState(); closeModal(); render(); toast('Stock updated');
}

function draftCapacity(type, flavorId) {
  if (type === 'order' && editingOrderId) return availableFor(flavorId, editingOrderId);
  return availableFor(flavorId);
}

function renderQtyRows(draftName) {
  const draft = draftName === 'sell' ? sellDraft : orderDraft;
  return activeFlavors().map(f => {
    const qty = draft[f.id] || 0;
    const capacity = draftCapacity(draftName, f.id);
    return `<div class="qty-line">
      <div><div class="flavor-name">${esc(f.name)}</div><div class="meta">${capacity} available · Brother ${money(f.brotherShare)}</div></div>
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
}

function captureOrderMeta() {
  orderMeta.customer = $('#orderCustomer')?.value ?? orderMeta.customer;
  orderMeta.contact = $('#orderContact')?.value ?? orderMeta.contact;
  orderMeta.location = $('#orderLocation')?.value ?? orderMeta.location;
  orderMeta.dueAt = $('#orderDueAt')?.value ?? orderMeta.dueAt;
  orderMeta.note = $('#orderNote')?.value ?? orderMeta.note;
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
    const priceText = method === 'tap' ? '$7 each' : method === 'unpaid' ? '$6 when paid' : method === 'legacy' ? '$6 each' : '$6 each';
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

function renderSell() {
  const items = draftItems(sellDraft);
  const qty = itemsQty(items);
  const unitPrice = unitPriceForMethod(sellMeta.paymentMethod);
  const brother = items.reduce((sum, i) => sum + i.qty * flavorBrotherShare(i.flavorId), 0);
  main.innerHTML = `
    <div class="form-card">
      <h2>Choose cookies</h2>
      <div class="meta" style="margin-bottom:8px">Cash and Apple Pay are $6 each. Tap to Pay is $7 each.</div>
      ${renderQtyRows('sell')}
    </div>

    <div class="form-card">
      <div class="field"><label>Customer name (optional)</label><input id="saleCustomer" placeholder="e.g. Alex" value="${esc(sellMeta.customer)}"></div>
      <div class="field"><label>How did they pay?</label>${paymentButtons(sellMeta.paymentMethod, 'sell')}</div>
    </div>

    <div class="summary-strip"><div><div class="meta">${qty} COOKIE${qty === 1 ? '' : 'S'} · ${money(unitPrice)} EACH</div><strong>${money(qty * unitPrice)}</strong></div><div style="text-align:right"><div class="meta">BROTHER GETS</div><strong>${money(brother)}</strong></div></div>
    <button class="btn primary full" ${qty ? '' : 'disabled'} onclick="recordSale()">Complete sale</button>
    <button class="btn ghost full" style="margin-top:8px" onclick="clearSaleDraft()">Clear</button>
  `;
}

function clearSaleDraft() {
  sellDraft = {};
  sellMeta = { customer:'', paymentMethod:'cash' };
  renderSell();
}

function snapshotSaleItems(items) {
  return items.map(i => ({ ...i, brotherShare: flavorBrotherShare(i.flavorId) }));
}

function recordSale() {
  captureSellMeta();
  const items = draftItems(sellDraft);
  if (!items.length) return toast('Choose at least one cookie.');
  for (const item of items) if (item.qty > availableFor(item.flavorId)) return toast(`Not enough ${flavorById(item.flavorId)?.name}.`);
  items.forEach(i => flavorById(i.flavorId).stock -= i.qty);
  const saleItems = snapshotSaleItems(items);
  const unitPrice = unitPriceForMethod(sellMeta.paymentMethod);
  const sale = {
    id: uid('sale'),
    items: saleItems,
    customer: sellMeta.customer.trim(),
    paid: true,
    paymentMethod: sellMeta.paymentMethod,
    unitPrice,
    total: itemsQty(saleItems) * unitPrice,
    brotherTotal: brotherForItems(saleItems),
    createdAt: new Date().toISOString(),
    source: 'direct'
  };
  state.sales.push(sale);
  saveState();
  sellDraft = {};
  sellMeta = { customer:'', paymentMethod:'cash' };
  navTo('home');
  toast(`Sale recorded: ${money(sale.total)} · ${paymentLabel(sale.paymentMethod)}`);
}

function renderOrders() {
  const sorted = [...state.orders].sort((a, b) => {
    const rank = { open: 0, fulfilled: 1, cancelled: 2 };
    const diff = (rank[a.status] ?? 3) - (rank[b.status] ?? 3);
    if (diff) return diff;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  main.innerHTML = `
    <button class="btn primary full" onclick="openNewOrder()">＋ New order</button>
    <div class="section-head"><div><h2>Orders</h2><div class="sub">Open orders reserve inventory. Delivered orders can be undone.</div></div></div>
    ${sorted.length ? `<div class="card-list">${sorted.map(orderCard).join('')}</div>` : emptyState('🧾', 'No orders yet', 'Create an order to reserve cookies for someone.')}
  `;
}

function orderCard(order) {
  const status = order.status || 'open';
  const method = order.paymentMethod || (order.paid ? 'legacy' : 'unpaid');
  const total = itemsTotal(order.items, method);
  const details = [
    order.contact ? `Contact: ${esc(order.contact)}` : '',
    order.dueAt ? `Due: ${esc(dateText(order.dueAt))}` : '',
    order.location ? `Meet: ${esc(order.location)}` : ''
  ].filter(Boolean).join('<br>');
  const paymentClass = method === 'unpaid' ? 'unpaid' : 'paid';
  const paymentText = method === 'unpaid' ? 'UNPAID' : paymentLabel(method).toUpperCase();
  return `<div class="list-card">
    <div class="order-head">
      <div><div class="flavor-name">${esc(order.customer || 'Unnamed customer')}</div><div class="meta">${dateText(order.createdAt)}${status === 'fulfilled' && order.fulfilledAt ? ` · Delivered ${dateText(order.fulfilledAt)}` : ''}</div></div>
      <div style="text-align:right"><div class="order-total">${money(total)}</div><span class="status ${status}">${status === 'open' ? 'OPEN' : status === 'fulfilled' ? 'DELIVERED' : 'CANCELLED'}</span></div>
    </div>
    <div class="order-items">${esc(itemSummary(order.items))}${details ? `<div class="order-detail-block">${details}</div>` : ''}${order.note ? `<div class="order-note">${esc(order.note)}</div>` : ''}</div>
    <div style="margin-top:9px"><span class="status ${paymentClass}">${esc(paymentText)}</span></div>
    ${status === 'open' ? `<div class="order-actions">
      <button class="btn green small" onclick="fulfillOrder('${order.id}')">✓ Delivered</button>
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
  if (!order || order.status !== 'open') return;
  editingOrderId = orderId;
  orderDraft = Object.fromEntries(order.items.map(i => [i.flavorId, i.qty]));
  orderMeta = {
    customer: order.customer || '',
    contact: order.contact || '',
    location: order.location || '',
    dueAt: order.dueAt || '',
    note: order.note || '',
    paymentMethod: order.paymentMethod || (order.paid ? 'legacy' : 'unpaid')
  };
  showModal('');
  renderOrderComposer();
}

function setOrderPayment(method) {
  captureOrderMeta();
  orderMeta.paymentMethod = method;
  renderOrderComposer();
}

function renderOrderComposer() {
  const method = orderMeta.paymentMethod || 'unpaid';
  const items = draftItems(orderDraft);
  const qty = itemsQty(items);
  showModal(`
    <div class="modal-head"><div><div class="meta">${editingOrderId ? 'EDIT ORDER' : 'NEW ORDER'}</div><h2>${editingOrderId ? 'Update order' : 'Reserve cookies'}</h2></div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="field"><label>Customer name</label><input id="orderCustomer" placeholder="Name" value="${esc(orderMeta.customer)}"></div>
    <div class="two-col">
      <div class="field"><label>Contact (optional)</label><input id="orderContact" placeholder="Phone, Snap, etc." value="${esc(orderMeta.contact)}"></div>
      <div class="field"><label>Meet location (optional)</label><input id="orderLocation" placeholder="Lunch, class, hallway…" value="${esc(orderMeta.location)}"></div>
    </div>
    <div class="field"><label>Due / meet time (optional)</label><input id="orderDueAt" type="datetime-local" value="${esc(orderMeta.dueAt)}"></div>
    <div class="form-card" style="box-shadow:none;margin-bottom:12px"><h3 style="margin-bottom:7px">Cookies</h3>${renderQtyRows('order')}</div>
    <div class="field"><label>Payment</label>${paymentButtons(method, 'order')}</div>
    <div class="field"><label>Notes (optional)</label><textarea id="orderNote" placeholder="Class period, special instructions, reminder…">${esc(orderMeta.note)}</textarea></div>
    <div class="summary-strip"><div><div class="meta">${qty} COOKIE${qty === 1 ? '' : 'S'} · ${money(unitPriceForMethod(method))} EACH</div><strong>${money(itemsTotal(items, method))}</strong></div><div style="text-align:right"><div class="meta">PAYMENT</div><strong class="summary-method">${esc(paymentLabel(method))}</strong></div></div>
    <button class="btn primary full" onclick="saveOrder()">${editingOrderId ? 'Save changes' : 'Save order'}</button>
  `, true);
}

function saveOrder() {
  captureOrderMeta();
  const items = draftItems(orderDraft);
  const customer = orderMeta.customer.trim();
  if (!customer) return toast('Enter the customer name.');
  if (!items.length) return toast('Choose at least one cookie.');
  for (const item of items) {
    const capacity = availableFor(item.flavorId, editingOrderId);
    if (item.qty > capacity) return toast(`Not enough ${flavorById(item.flavorId)?.name} available.`);
  }

  if (editingOrderId) {
    const order = state.orders.find(o => o.id === editingOrderId);
    if (!order || order.status !== 'open') return toast('That order can no longer be edited.');
    Object.assign(order, {
      customer,
      contact: orderMeta.contact.trim(),
      location: orderMeta.location.trim(),
      dueAt: orderMeta.dueAt,
      note: orderMeta.note.trim(),
      paymentMethod: orderMeta.paymentMethod,
      paid: orderMeta.paymentMethod !== 'unpaid',
      items,
      updatedAt: new Date().toISOString()
    });
    saveState();
    editingOrderId = null;
    orderDraft = {};
    orderMeta = blankOrderMeta();
    closeModal();
    render();
    toast('Order updated');
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
    paymentMethod: orderMeta.paymentMethod,
    paid: orderMeta.paymentMethod !== 'unpaid',
    status:'open',
    createdAt:new Date().toISOString()
  });
  saveState();
  orderDraft = {};
  orderMeta = blankOrderMeta();
  closeModal();
  navTo('orders');
  toast('Order saved and inventory reserved');
}

function openOrderPayment(orderId) {
  const order = state.orders.find(o => o.id === orderId);
  if (!order) return;
  const selected = order.paymentMethod || (order.paid ? 'legacy' : 'unpaid');
  showModal(`
    <div class="modal-head"><div><div class="meta">ORDER PAYMENT</div><h2>${esc(order.customer)}</h2></div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="setting-desc" style="margin-bottom:12px">Choose how this order was paid. Tap to Pay changes the order to $7 per cookie.</div>
    <div class="payment-grid">${['unpaid','cash','apple','tap'].map(method => `<button type="button" class="payment-choice ${selected === method ? 'selected' : ''}" onclick="setOrderPaymentQuick('${order.id}','${method}')"><span class="payment-title">${esc(paymentLabel(method))}</span><span class="payment-sub">${method === 'tap' ? '$7 each' : method === 'unpaid' ? 'Not collected' : '$6 each'}</span></button>`).join('')}</div>
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
      sale.unitPrice = unitPriceForMethod(method);
      sale.total = itemsQty(sale.items) * sale.unitPrice;
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
  order.items.forEach(i => flavorById(i.flavorId).stock -= i.qty);
  order.status = 'fulfilled';
  order.fulfilledAt = new Date().toISOString();
  const method = order.paymentMethod || (order.paid ? 'legacy' : 'unpaid');
  const saleItems = snapshotSaleItems(order.items);
  const unitPrice = unitPriceForMethod(method);
  state.sales.push({
    id: uid('sale'),
    items: saleItems,
    customer: order.customer,
    paid: method !== 'unpaid',
    paymentMethod: method,
    unitPrice,
    total: itemsQty(saleItems) * unitPrice,
    brotherTotal: brotherForItems(saleItems),
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
  if (!order || order.status !== 'open') return;
  if (!confirm(`Cancel ${order.customer}'s order? Reserved cookies will become available again.`)) return;
  order.status = 'cancelled';
  order.cancelledAt = new Date().toISOString();
  saveState();
  render();
  toast('Order cancelled');
}

function restoreOrder(orderId) {
  const order = state.orders.find(o => o.id === orderId);
  if (!order || order.status !== 'cancelled') return;
  for (const item of order.items) if (item.qty > availableFor(item.flavorId)) return toast(`Not enough ${flavorById(item.flavorId)?.name} available to restore this order.`);
  order.status = 'open';
  delete order.cancelledAt;
  order.updatedAt = new Date().toISOString();
  saveState();
  render();
  toast('Order restored');
}

function salesByFlavor() {
  const map = new Map(state.flavors.map(f => [f.id, { qty:0, revenue:0, brother:0 }]));
  state.sales.forEach(sale => {
    const unitPrice = Number(sale.unitPrice || (itemsQty(sale.items) ? sale.total / itemsQty(sale.items) : BASE_PRICE));
    sale.items.forEach(i => {
      const current = map.get(i.flavorId) || { qty:0, revenue:0, brother:0 };
      current.qty += i.qty;
      current.revenue += i.qty * unitPrice;
      current.brother += i.qty * Number(i.brotherShare ?? flavorBrotherShare(i.flavorId));
      map.set(i.flavorId, current);
    });
  });
  return activeFlavors().map(f => ({ f, ...(map.get(f.id) || { qty:0, revenue:0, brother:0 }) })).sort((a, b) => b.qty - a.qty);
}

function paymentTotals() {
  const totals = { cash:0, apple:0, tap:0, unpaid:0, legacy:0 };
  state.sales.forEach(s => {
    const method = s.paymentMethod || (s.paid ? 'legacy' : 'unpaid');
    totals[method] = (totals[method] || 0) + Number(s.total || 0);
  });
  return totals;
}

function renderMoney() {
  const rows = salesByFlavor();
  const recent = [...state.sales].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const payments = paymentTotals();
  main.innerHTML = `
    <section class="stat-grid">
      ${statCard('Revenue', money(totalRevenue()), `${totalSoldQty()} sold`)}
      ${statCard('Collected', money(collectedRevenue()), unpaidRevenue() ? `${money(unpaidRevenue())} still unpaid` : 'No unpaid sales')}
      ${statCard('Brother total', money(totalBrotherOwed()), 'Based on each flavor’s commission')}
      ${statCard('Still owe', money(Math.max(0, brotherBalance())), `${money(totalBrotherPaid())} recorded paid`)}
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
      <div class="section-head" style="margin-top:0"><div><h2>Pay brother</h2><div class="sub">Record money you've handed over</div></div></div>
      <div style="display:grid;grid-template-columns:1fr auto;gap:8px"><input id="brotherPayment" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Amount"><button class="btn primary" onclick="recordBrotherPayment()">Add</button></div>
    </div>

    <div class="form-card">
      <h2>Sales by flavor</h2>
      <table class="money-table"><thead><tr><th>Flavor</th><th>Sold</th><th>Sales</th><th>Brother</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${esc(r.f.name)}</td><td>${r.qty}</td><td>${money(r.revenue)}</td><td>${money(r.brother)}</td></tr>`).join('')}
      </tbody></table>
    </div>

    <div class="section-head"><div><h2>Sales history</h2><div class="sub">Shows payment method and sale price</div></div></div>
    ${recent.length ? `<div class="card-list">${recent.map(saleCard).join('')}</div>` : emptyState('💵', 'No money tracked yet', 'Complete a sale to start your totals.')}
  `;
}

function saleCard(sale) {
  const method = sale.paymentMethod || (sale.paid ? 'legacy' : 'unpaid');
  return `<div class="list-card">
    <div class="order-head"><div><div class="flavor-name">${esc(sale.customer || 'Quick sale')}</div><div class="meta">${dateText(sale.createdAt)} · ${esc(itemSummary(sale.items))}<br>${esc(paymentLabel(method))} · ${money(sale.unitPrice || BASE_PRICE)} each · Brother ${money(sale.brotherTotal ?? brotherForItems(sale.items))}</div></div><div style="text-align:right"><div class="order-total">${money(sale.total)}</div><span class="status ${sale.paid ? 'paid' : 'unpaid'}">${sale.paid ? 'PAID' : 'UNPAID'}</span></div></div>
    ${!sale.paid ? `<div class="order-actions"><button class="btn green small" onclick="openSalePayment('${sale.id}')">Collect payment</button></div>` : ''}
  </div>`;
}

function openSalePayment(saleId) {
  const sale = state.sales.find(s => s.id === saleId);
  if (!sale) return;
  showModal(`
    <div class="modal-head"><div><div class="meta">COLLECT PAYMENT</div><h2>${esc(sale.customer || 'Sale')}</h2></div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="setting-desc" style="margin-bottom:12px">Choose how they paid. Tap to Pay changes this sale to $7 per cookie.</div>
    <div class="payment-grid">${['cash','apple','tap'].map(method => `<button class="payment-choice" onclick="markSalePaid('${sale.id}','${method}')"><span class="payment-title">${esc(paymentLabel(method))}</span><span class="payment-sub">${method === 'tap' ? '$7 each' : '$6 each'}</span></button>`).join('')}</div>
  `);
}

function markSalePaid(saleId, method = 'cash') {
  const sale = state.sales.find(s => s.id === saleId);
  if (!sale) return;
  sale.paid = true;
  sale.paymentMethod = method;
  sale.unitPrice = unitPriceForMethod(method);
  sale.total = itemsQty(sale.items) * sale.unitPrice;
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
    <div class="setting-row"><div class="setting-title">Selling prices</div><div class="setting-desc">Cash and Apple Pay are fixed at $6.00 per cookie. Tap to Pay is $7.00 per cookie.</div></div>
    <div class="setting-row">
      <div class="setting-title">Brother commission by flavor</div>
      <div class="setting-desc">Set exactly how much your brother gets for each cookie sold. New sales lock in the commission at the time of the sale, so changing this later will not rewrite old sales.</div>
      <div class="commission-list">
        ${activeFlavors().map(f => `<div class="commission-row"><label>${esc(f.name)}</label><div class="money-input"><span>$</span><input data-brother-share="${esc(f.id)}" type="number" min="0" max="6" step="0.01" inputmode="decimal" value="${Number(f.brotherShare ?? DEFAULT_BROTHER_SHARE).toFixed(2)}"></div></div>`).join('')}
      </div>
      <button class="btn secondary small" style="margin-top:10px" onclick="saveFlavorShares()">Save commissions</button>
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
    if (Number.isNaN(value) || value < 0 || value > BASE_PRICE) return toast('Each commission must be from $0 to $6.');
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

function saveLowStock() {
  const value = Math.max(0, parseInt($('#lowStockInput')?.value || '0', 10));
  state.settings.lowStock = value;
  saveState();
  closeModal();
  render();
  toast('Low-stock warning updated');
}

function openAddFlavor() {
  showModal(`
    <div class="modal-head"><div><div class="meta">INVENTORY</div><h2>Add flavor</h2></div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="field"><label>Flavor name</label><input id="newFlavorName" placeholder="e.g. Red Velvet"></div>
    <div class="field"><label>Brother gets per cookie</label><input id="newFlavorShare" type="number" min="0" max="6" step="0.01" inputmode="decimal" value="${DEFAULT_BROTHER_SHARE.toFixed(2)}"></div>
    <button class="btn primary full" onclick="addFlavor()">Add flavor</button>
  `);
}

function addFlavor() {
  const name = $('#newFlavorName')?.value.trim();
  const brotherShare = Number($('#newFlavorShare')?.value ?? DEFAULT_BROTHER_SHARE);
  if (!name) return toast('Enter a flavor name.');
  if (Number.isNaN(brotherShare) || brotherShare < 0 || brotherShare > BASE_PRICE) return toast('Brother commission must be from $0 to $6.');
  state.flavors.push({ id:uid('flavor'), name, stock:0, active:true, brotherShare });
  saveState();
  closeModal();
  render();
  toast(`${name} added`);
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type:'application/json' });
  downloadBlob(blob, `cookie-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`);
}

function exportSalesCSV() {
  const header = ['Date','Customer','Items','Quantity','Payment Method','Unit Price','Total','Paid','Brother Total'];
  const rows = state.sales.map(s => [
    new Date(s.createdAt).toLocaleString(),
    s.customer || 'Quick sale',
    itemSummary(s.items),
    itemsQty(s.items),
    paymentLabel(s.paymentMethod || (s.paid ? 'legacy' : 'unpaid')),
    Number(s.unitPrice || BASE_PRICE).toFixed(2),
    Number(s.total || 0).toFixed(2),
    s.paid ? 'Yes' : 'No',
    Number(s.brotherTotal ?? brotherForItems(s.items)).toFixed(2)
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
  sellMeta = { customer:'', paymentMethod:'cash' };
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

saveState(); // Runs migrations without changing the storage key or wiping existing data.
render();
