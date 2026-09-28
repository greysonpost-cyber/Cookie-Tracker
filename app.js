const PRICE = 6;
const STORAGE_KEY = 'cookieTrackerDataV1';
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

const defaultState = () => ({
  version: 1,
  price: PRICE,
  brotherShare: 4,
  flavors: DEFAULT_FLAVORS.map((name, index) => ({ id: `flavor-${index + 1}`, name, stock: 0, active: true })),
  orders: [],
  sales: [],
  brotherPayments: [],
  inventoryLog: [],
  settings: { lowStock: 3 }
});

let state = loadState();
let currentView = 'home';
let sellDraft = {};
let sellMeta = { customer: '', paid: true };
let orderDraft = {};
let orderMeta = { customer: '', note: '', paid: false };

const $ = (sel) => document.querySelector(sel);
const main = $('#mainContent');
const pageTitle = $('#pageTitle');
const modalBackdrop = $('#modalBackdrop');
const modalCard = $('#modalCard');
const importFile = $('#importFile');

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const saved = JSON.parse(raw);
    const merged = { ...defaultState(), ...saved };
    merged.price = PRICE;
    return merged;
  } catch {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid(prefix='id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
}

function esc(value='') {
  return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function money(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
}

function dateText(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

function activeFlavors() { return state.flavors.filter(f => f.active); }
function flavorById(id) { return state.flavors.find(f => f.id === id); }
function openOrders() { return state.orders.filter(o => o.status === 'open'); }

function reservedFor(flavorId) {
  return openOrders().reduce((sum, order) => sum + order.items.filter(i => i.flavorId === flavorId).reduce((a,i)=>a+i.qty,0), 0);
}

function availableFor(flavorId) {
  const f = flavorById(flavorId);
  return Math.max(0, (f?.stock || 0) - reservedFor(flavorId));
}

function totalOnHand() { return activeFlavors().reduce((s,f)=>s+f.stock,0); }
function totalReserved() { return activeFlavors().reduce((s,f)=>s+reservedFor(f.id),0); }
function totalSoldQty() { return state.sales.reduce((s,x)=>s+x.items.reduce((a,i)=>a+i.qty,0),0); }
function totalRevenue() { return state.sales.reduce((s,x)=>s+x.total,0); }
function collectedRevenue() { return state.sales.filter(s=>s.paid).reduce((a,s)=>a+s.total,0); }
function unpaidRevenue() { return state.sales.filter(s=>!s.paid).reduce((a,s)=>a+s.total,0); }
function totalBrotherOwed() { return totalSoldQty() * Number(state.brotherShare || 0); }
function totalBrotherPaid() { return state.brotherPayments.reduce((s,p)=>s+Number(p.amount||0),0); }
function brotherBalance() { return totalBrotherOwed() - totalBrotherPaid(); }

function itemsQty(items) { return items.reduce((s,i)=>s+i.qty,0); }
function itemsTotal(items) { return itemsQty(items) * PRICE; }
function itemSummary(items) {
  return items.filter(i=>i.qty>0).map(i => `${i.qty}× ${flavorById(i.flavorId)?.name || 'Cookie'}`).join(' · ');
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
  const recent = [...state.sales].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,4);
  main.innerHTML = `
    <section class="hero-card">
      <div class="hero-row">
        <div>
          <div class="label">AVAILABLE TO SELL</div>
          <div class="big">${totalOnHand() - totalReserved()}</div>
        </div>
        <div style="text-align:right">
          <div class="label">PRICE EACH</div>
          <div style="font-size:24px;font-weight:900;margin-top:4px">$6</div>
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
      ${statCard('Open orders', openOrders().length, `${openOrders().reduce((s,o)=>s+itemsQty(o.items),0)} cookies reserved`)}
      ${statCard('Owe brother', money(Math.max(0, brotherBalance())), `${money(state.brotherShare)} per cookie`)}
    </section>

    <div class="quick-actions">
      <button class="btn primary" onclick="navTo('sell')">＋ Record sale</button>
      <button class="btn secondary" onclick="openNewOrder()">☷ New order</button>
    </div>

    <div class="section-head"><div><h2>Stock</h2><div class="sub">Available after open orders</div></div><button class="text-btn" onclick="navTo('inventory')">View all</button></div>
    <div class="card-list">
      ${activeFlavors().map(f => compactFlavor(f)).join('')}
    </div>

    <div class="section-head"><div><h2>Recent sales</h2><div class="sub">Latest completed sales</div></div><button class="text-btn" onclick="navTo('money')">Money</button></div>
    ${recent.length ? `<div class="card-list">${recent.map(saleCard).join('')}</div>` : emptyState('🍪','No sales yet','Your first completed sale will show here.')}
  `;
}

function statCard(label, value, sub='') {
  return `<div class="stat-card"><div class="stat-label">${esc(label)}</div><div class="stat-value">${esc(value)}</div><div class="stat-sub">${esc(sub)}</div></div>`;
}

function compactFlavor(f) {
  const reserved = reservedFor(f.id);
  const avail = availableFor(f.id);
  const klass = avail <= state.settings.lowStock ? 'stock-low' : reserved ? 'stock-reserved' : '';
  return `<div class="list-card flavor-row">
    <div class="cookie-dot">🍪</div>
    <div><div class="flavor-name">${esc(f.name)}</div><div class="meta">${f.stock} on hand${reserved ? ` · ${reserved} reserved` : ''}</div></div>
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
            <div><div class="flavor-name">${esc(f.name)}</div><div class="meta">${reserved ? `${reserved} reserved · ` : ''}${avail} available</div></div>
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
  setTimeout(()=>$('#stockInput')?.focus(),100);
}

function setStock(flavorId) {
  const f = flavorById(flavorId);
  const value = Math.max(0, parseInt($('#stockInput').value || '0',10));
  const reserved = reservedFor(flavorId);
  if (value < reserved) return toast(`At least ${reserved} are reserved.`);
  const delta = value - f.stock;
  f.stock = value;
  state.inventoryLog.push({ id: uid('inv'), flavorId, delta, createdAt: new Date().toISOString() });
  saveState(); closeModal(); render(); toast('Stock updated');
}

function renderQtyRows(draftName) {
  const draft = draftName === 'sell' ? sellDraft : orderDraft;
  return activeFlavors().map(f => {
    const qty = draft[f.id] || 0;
    return `<div class="qty-line">
      <div><div class="flavor-name">${esc(f.name)}</div><div class="meta">${availableFor(f.id)} available</div></div>
      <button class="qty-button" onclick="changeDraftQty('${draftName}','${f.id}',-1)">−</button>
      <div class="qty-value">${qty}</div>
      <button class="qty-button plus" onclick="changeDraftQty('${draftName}','${f.id}',1)">＋</button>
    </div>`;
  }).join('');
}

function draftItems(draft) {
  return Object.entries(draft).filter(([,qty])=>qty>0).map(([flavorId, qty])=>({ flavorId, qty }));
}

function changeDraftQty(type, flavorId, delta) {
  if (type === 'sell') {
    sellMeta.customer = $('#saleCustomer')?.value ?? sellMeta.customer;
    sellMeta.paid = $('#salePaid')?.checked ?? sellMeta.paid;
  } else {
    orderMeta.customer = $('#orderCustomer')?.value ?? orderMeta.customer;
    orderMeta.note = $('#orderNote')?.value ?? orderMeta.note;
    orderMeta.paid = $('#orderPaid')?.checked ?? orderMeta.paid;
  }
  const draft = type === 'sell' ? sellDraft : orderDraft;
  const next = Math.max(0, (draft[flavorId] || 0) + delta);
  if (delta > 0 && next > availableFor(flavorId)) return toast('Not enough available stock.');
  draft[flavorId] = next;
  if (type === 'sell') renderSell(); else renderOrderComposer();
}

function renderSell() {
  const items = draftItems(sellDraft);
  const qty = itemsQty(items);
  main.innerHTML = `
    <div class="form-card">
      <h2>Choose cookies</h2>
      <div class="meta" style="margin-bottom:8px">Each cookie is $6. No bundle pricing.</div>
      ${renderQtyRows('sell')}
    </div>

    <div class="form-card">
      <div class="field"><label>Customer name (optional)</label><input id="saleCustomer" placeholder="e.g. Alex" value="${esc(sellMeta.customer)}"></div>
      <div class="checkbox-row"><div><div class="setting-title">Paid</div><div class="setting-desc">Turn off if they still owe you.</div></div><input id="salePaid" type="checkbox" ${sellMeta.paid ? 'checked' : ''}></div>
    </div>

    <div class="summary-strip"><div><div class="meta">${qty} COOKIE${qty===1?'':'S'}</div><strong>${money(qty * PRICE)}</strong></div><div style="text-align:right"><div class="meta">BROTHER SHARE</div><strong>${money(qty * state.brotherShare)}</strong></div></div>
    <button class="btn primary full" ${qty ? '' : 'disabled'} onclick="recordSale()">Complete sale</button>
    <button class="btn ghost full" style="margin-top:8px" onclick="clearSaleDraft()">Clear</button>
  `;
}

function clearSaleDraft() { sellDraft = {}; sellMeta = { customer:'', paid:true }; renderSell(); }

function recordSale() {
  const items = draftItems(sellDraft);
  if (!items.length) return toast('Choose at least one cookie.');
  for (const item of items) if (item.qty > availableFor(item.flavorId)) return toast(`Not enough ${flavorById(item.flavorId)?.name}.`);
  items.forEach(i => flavorById(i.flavorId).stock -= i.qty);
  const sale = {
    id: uid('sale'), items, customer: $('#saleCustomer')?.value.trim() || sellMeta.customer || '',
    paid: $('#salePaid') ? !!$('#salePaid').checked : !!sellMeta.paid, total: itemsTotal(items), createdAt: new Date().toISOString(), source: 'direct'
  };
  state.sales.push(sale);
  saveState();
  sellDraft = {}; sellMeta = { customer:'', paid:true };
  navTo('home');
  toast(`Sale recorded: ${money(sale.total)}`);
}

function renderOrders() {
  const sorted = [...state.orders].sort((a,b)=> {
    if (a.status === 'open' && b.status !== 'open') return -1;
    if (b.status === 'open' && a.status !== 'open') return 1;
    return new Date(b.createdAt)-new Date(a.createdAt);
  });
  main.innerHTML = `
    <button class="btn primary full" onclick="openNewOrder()">＋ New order</button>
    <div class="section-head"><div><h2>Orders</h2><div class="sub">Open orders reserve inventory</div></div></div>
    ${sorted.length ? `<div class="card-list">${sorted.map(orderCard).join('')}</div>` : emptyState('🧾','No orders yet','Create an order to reserve cookies for someone.')}
  `;
}

function orderCard(order) {
  const status = order.status || 'open';
  return `<div class="list-card">
    <div class="order-head">
      <div><div class="flavor-name">${esc(order.customer || 'Unnamed customer')}</div><div class="meta">${dateText(order.createdAt)}</div></div>
      <div style="text-align:right"><div class="order-total">${money(itemsTotal(order.items))}</div><span class="status ${status}">${status === 'open' ? 'OPEN' : status.toUpperCase()}</span></div>
    </div>
    <div class="order-items">${esc(itemSummary(order.items))}${order.note ? `<br><span class="meta">${esc(order.note)}</span>` : ''}</div>
    <div style="margin-top:9px"><span class="status ${order.paid ? 'paid' : 'unpaid'}">${order.paid ? 'PAID' : 'UNPAID'}</span></div>
    ${status === 'open' ? `<div class="order-actions">
      <button class="btn green small" onclick="fulfillOrder('${order.id}')">✓ Delivered</button>
      <button class="btn ghost small" onclick="toggleOrderPaid('${order.id}')">${order.paid ? 'Mark unpaid' : 'Mark paid'}</button>
      <button class="btn red small" onclick="cancelOrder('${order.id}')">Cancel</button>
    </div>` : ''}
  </div>`;
}

function openNewOrder() {
  orderDraft = {};
  orderMeta = { customer:'', note:'', paid:false };
  showModal('');
  renderOrderComposer();
}

function renderOrderComposer() {
  showModal(`
    <div class="modal-head"><div><div class="meta">NEW ORDER</div><h2>Reserve cookies</h2></div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="field"><label>Customer name</label><input id="orderCustomer" placeholder="Name" value="${esc(orderMeta.customer)}"></div>
    <div class="form-card" style="box-shadow:none;margin-bottom:12px"><h3 style="margin-bottom:7px">Cookies</h3>${renderQtyRows('order')}</div>
    <div class="field"><label>Notes (optional)</label><textarea id="orderNote" placeholder="Class period, where to meet, etc.">${esc(orderMeta.note)}</textarea></div>
    <div class="checkbox-row"><div><div class="setting-title">Already paid</div><div class="setting-desc">You can change this before delivery.</div></div><input id="orderPaid" type="checkbox" ${orderMeta.paid ? 'checked' : ''}></div>
    <div class="summary-strip"><div><div class="meta">ORDER TOTAL</div><strong>${money(itemsTotal(draftItems(orderDraft)))}</strong></div><div class="meta">$6 each</div></div>
    <button class="btn primary full" onclick="createOrder()">Save order</button>
  `, true);
}

function createOrder() {
  orderMeta.customer = $('#orderCustomer')?.value ?? orderMeta.customer;
  orderMeta.note = $('#orderNote')?.value ?? orderMeta.note;
  orderMeta.paid = $('#orderPaid')?.checked ?? orderMeta.paid;
  const items = draftItems(orderDraft);
  const customer = orderMeta.customer.trim();
  if (!customer) return toast('Enter the customer name.');
  if (!items.length) return toast('Choose at least one cookie.');
  for (const item of items) if (item.qty > availableFor(item.flavorId)) return toast(`Not enough ${flavorById(item.flavorId)?.name} available.`);
  state.orders.push({ id: uid('order'), customer, items, note: orderMeta.note.trim(), paid: !!orderMeta.paid, status:'open', createdAt:new Date().toISOString() });
  saveState(); orderDraft = {}; orderMeta = { customer:'', note:'', paid:false }; closeModal(); navTo('orders'); toast('Order saved and inventory reserved');
}

function toggleOrderPaid(orderId) {
  const order = state.orders.find(o=>o.id===orderId); if (!order) return;
  order.paid = !order.paid; saveState(); render();
}

function fulfillOrder(orderId) {
  const order = state.orders.find(o=>o.id===orderId); if (!order || order.status !== 'open') return;
  for (const item of order.items) {
    const f = flavorById(item.flavorId);
    if (!f || f.stock < item.qty) return toast(`Not enough ${f?.name || 'stock'} on hand.`);
  }
  order.items.forEach(i=>flavorById(i.flavorId).stock -= i.qty);
  order.status = 'fulfilled'; order.fulfilledAt = new Date().toISOString();
  state.sales.push({ id: uid('sale'), items: order.items.map(i=>({...i})), customer: order.customer, paid: order.paid, total: itemsTotal(order.items), createdAt: order.fulfilledAt, source:'order', orderId: order.id });
  saveState(); render(); toast('Order delivered and sale recorded');
}

function cancelOrder(orderId) {
  const order = state.orders.find(o=>o.id===orderId); if (!order || order.status !== 'open') return;
  if (!confirm(`Cancel ${order.customer}'s order? Reserved cookies will become available again.`)) return;
  order.status = 'cancelled'; order.cancelledAt = new Date().toISOString(); saveState(); render(); toast('Order cancelled');
}

function salesByFlavor() {
  const map = new Map(state.flavors.map(f=>[f.id,0]));
  state.sales.forEach(s=>s.items.forEach(i=>map.set(i.flavorId,(map.get(i.flavorId)||0)+i.qty)));
  return activeFlavors().map(f=>({f, qty:map.get(f.id)||0})).sort((a,b)=>b.qty-a.qty);
}

function renderMoney() {
  const rows = salesByFlavor();
  const recent = [...state.sales].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  main.innerHTML = `
    <section class="stat-grid">
      ${statCard('Revenue', money(totalRevenue()), `${totalSoldQty()} sold`)}
      ${statCard('Collected', money(collectedRevenue()), unpaidRevenue() ? `${money(unpaidRevenue())} still unpaid` : 'No unpaid sales')}
      ${statCard('Brother total', money(totalBrotherOwed()), `${money(state.brotherShare)} × ${totalSoldQty()}`)}
      ${statCard('Still owe', money(Math.max(0,brotherBalance())), `${money(totalBrotherPaid())} recorded paid`)}
    </section>

    <div class="form-card">
      <div class="section-head" style="margin-top:0"><div><h2>Pay brother</h2><div class="sub">Record money you've handed over</div></div></div>
      <div style="display:grid;grid-template-columns:1fr auto;gap:8px"><input id="brotherPayment" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Amount"><button class="btn primary" onclick="recordBrotherPayment()">Add</button></div>
    </div>

    <div class="form-card">
      <h2>Sales by flavor</h2>
      <table class="money-table"><thead><tr><th>Flavor</th><th>Sold</th><th>Sales</th><th>Brother</th></tr></thead><tbody>
      ${rows.map(r=>`<tr><td>${esc(r.f.name)}</td><td>${r.qty}</td><td>${money(r.qty*PRICE)}</td><td>${money(r.qty*state.brotherShare)}</td></tr>`).join('')}
      </tbody></table>
    </div>

    <div class="section-head"><div><h2>Sales history</h2><div class="sub">Tap unpaid sales when collected</div></div></div>
    ${recent.length ? `<div class="card-list">${recent.map(saleCard).join('')}</div>` : emptyState('💵','No money tracked yet','Complete a sale to start your totals.')}
  `;
}

function saleCard(sale) {
  return `<div class="list-card">
    <div class="order-head"><div><div class="flavor-name">${esc(sale.customer || 'Quick sale')}</div><div class="meta">${dateText(sale.createdAt)} · ${esc(itemSummary(sale.items))}</div></div><div style="text-align:right"><div class="order-total">${money(sale.total)}</div><span class="status ${sale.paid ? 'paid' : 'unpaid'}">${sale.paid ? 'PAID' : 'UNPAID'}</span></div></div>
    ${!sale.paid ? `<div class="order-actions"><button class="btn green small" onclick="markSalePaid('${sale.id}')">Mark paid</button></div>` : ''}
  </div>`;
}

function markSalePaid(saleId) {
  const sale = state.sales.find(s=>s.id===saleId); if (!sale) return;
  sale.paid = true;
  if (sale.orderId) { const order = state.orders.find(o=>o.id===sale.orderId); if (order) order.paid = true; }
  saveState(); render(); toast('Marked paid');
}

function recordBrotherPayment() {
  const input = $('#brotherPayment');
  const amount = Number(input?.value || 0);
  if (!(amount > 0)) return toast('Enter a payment amount.');
  state.brotherPayments.push({ id:uid('pay'), amount, createdAt:new Date().toISOString() });
  saveState(); render(); toast(`Recorded ${money(amount)} paid to brother`);
}

function openSettings() {
  showModal(`
    <div class="modal-head"><div><div class="meta">COOKIE TRACKER</div><h2>Settings</h2></div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="setting-row"><div class="setting-title">Cookie price</div><div class="setting-desc">Fixed at $6.00 per cookie. There are no bundle deals in this version.</div></div>
    <div class="setting-row">
      <div class="setting-title">Brother's share per cookie</div><div class="setting-desc">This controls the “owe brother” total. It does not change the $6 sale price.</div>
      <div style="margin-top:10px"><input id="brotherShareInput" type="number" min="0" max="6" step="0.01" inputmode="decimal" value="${Number(state.brotherShare).toFixed(2)}"></div>
      <button class="btn secondary small" style="margin-top:8px" onclick="saveBrotherShare()">Save share</button>
    </div>
    <div class="setting-row">
      <div class="setting-title">Low-stock warning</div><div class="setting-desc">Available stock at or below this number shows in red.</div>
      <div style="margin-top:10px"><input id="lowStockInput" type="number" min="0" step="1" inputmode="numeric" value="${state.settings.lowStock}"></div>
      <button class="btn secondary small" style="margin-top:8px" onclick="saveLowStock()">Save warning</button>
    </div>
    <div class="setting-row"><div class="setting-title">Backup</div><div class="setting-desc">Export your full inventory, orders, and sales as a JSON backup.</div><div class="row-actions"><button class="btn ghost small" onclick="exportBackup()">Export backup</button><button class="btn ghost small" onclick="importFile.click()">Import backup</button><button class="btn ghost small" onclick="exportSalesCSV()">Sales CSV</button></div></div>
    <div class="danger-zone"><div class="setting-title" style="color:var(--red)">Reset app</div><div class="setting-desc">Deletes all stock, sales, orders, and payments from this device.</div><button class="btn red small" style="margin-top:10px" onclick="resetApp()">Erase all data</button></div>
  `);
}

function saveBrotherShare() {
  const value = Number($('#brotherShareInput')?.value);
  if (Number.isNaN(value) || value < 0 || value > PRICE) return toast('Enter an amount from $0 to $6.');
  state.brotherShare = value; saveState(); closeModal(); render(); toast('Brother share updated');
}

function saveLowStock() {
  const value = Math.max(0, parseInt($('#lowStockInput')?.value || '0',10));
  state.settings.lowStock = value; saveState(); closeModal(); render(); toast('Low-stock warning updated');
}

function openAddFlavor() {
  showModal(`
    <div class="modal-head"><div><div class="meta">INVENTORY</div><h2>Add flavor</h2></div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="field"><label>Flavor name</label><input id="newFlavorName" placeholder="e.g. Red Velvet"></div>
    <button class="btn primary full" onclick="addFlavor()">Add flavor</button>
  `);
}

function addFlavor() {
  const name = $('#newFlavorName')?.value.trim(); if (!name) return toast('Enter a flavor name.');
  state.flavors.push({ id:uid('flavor'), name, stock:0, active:true }); saveState(); closeModal(); render(); toast(`${name} added`);
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(state,null,2)], {type:'application/json'});
  downloadBlob(blob, `cookie-tracker-backup-${new Date().toISOString().slice(0,10)}.json`);
}

function exportSalesCSV() {
  const header = ['Date','Customer','Items','Quantity','Total','Paid'];
  const rows = state.sales.map(s=>[
    new Date(s.createdAt).toLocaleString(), s.customer || 'Quick sale', itemSummary(s.items), itemsQty(s.items), s.total.toFixed(2), s.paid ? 'Yes' : 'No'
  ]);
  const csv = [header, ...rows].map(row=>row.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  downloadBlob(new Blob([csv],{type:'text/csv'}),`cookie-sales-${new Date().toISOString().slice(0,10)}.csv`);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}

importFile.addEventListener('change', async (e) => {
  const file = e.target.files?.[0]; if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed.flavors) || !Array.isArray(parsed.sales) || !Array.isArray(parsed.orders)) throw new Error('Invalid backup');
    state = { ...defaultState(), ...parsed, price: PRICE };
    saveState(); closeModal(); render(); toast('Backup imported');
  } catch { toast('That backup file could not be imported.'); }
  e.target.value = '';
});

function resetApp() {
  if (!confirm('Erase all Cookie Tracker data from this device? This cannot be undone unless you exported a backup.')) return;
  state = defaultState(); sellDraft={}; sellMeta={customer:'',paid:true}; orderDraft={}; orderMeta={customer:'',note:'',paid:false}; saveState(); closeModal(); navTo('home'); toast('App reset');
}

function showModal(html, preserveFocus=false) {
  modalCard.innerHTML = html;
  modalBackdrop.classList.remove('hidden');
}
function closeModal() { modalBackdrop.classList.add('hidden'); modalCard.innerHTML=''; }
modalBackdrop.addEventListener('click', e => { if (e.target === modalBackdrop) closeModal(); });

function emptyState(emoji,title,text) {
  return `<div class="empty"><span class="emoji">${emoji}</span><strong>${esc(title)}</strong><div class="meta" style="margin-top:5px">${esc(text)}</div></div>`;
}

let toastTimer;
function toast(message) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className='toast'; document.body.appendChild(el); }
  el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('show'),2200);
}

document.querySelectorAll('.nav-item').forEach(btn=>btn.addEventListener('click',()=>navTo(btn.dataset.view)));
$('#settingsBtn').addEventListener('click', openSettings);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(()=>{}));
}

render();
