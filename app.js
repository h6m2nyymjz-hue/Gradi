/* Gradi - application de gestion de boutique (fonctionne hors ligne, données sur le téléphone) */
(() => {
'use strict';
const C = GRADI_CONFIG, L = GradiLogic;
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const money = L.fmtFCFA;
const num = v => parseInt(String(v == null ? '' : v).replace(/[\s ]/g, ''), 10) || 0;
const dfmt = ts => new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
const dfull = ts => new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
const daysAgo = ts => Math.max(0, Math.floor((Date.now() - ts) / L.DAY));

/* ---------- Base de données locale (IndexedDB) ---------- */
let db;
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('gradi', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      ['products', 'customers', 'sales', 'payments', 'expenses'].forEach(s => d.createObjectStore(s, { keyPath: 'id' }));
      d.createObjectStore('meta', { keyPath: 'key' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const rq = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const st = (n, m = 'readonly') => db.transaction(n, m).objectStore(n);
const dbAll = n => rq(st(n).getAll());
const dbPut = (n, o) => rq(st(n, 'readwrite').put(o));
const dbDel = (n, id) => rq(st(n, 'readwrite').delete(id));
const dbClear = n => rq(st(n, 'readwrite').clear());
async function getMeta(k) { const r = await rq(st('meta').get(k)); return r ? r.value : undefined; }
const setMeta = (k, v) => dbPut('meta', { key: k, value: v });

/* ---------- État ---------- */
const S = {
  account: null, products: [], customers: [], sales: [], payments: [], expenses: [], used: [],
  tab: 'sell', cart: {}, search: '', psearch: '', unlocked: false, onboard: 0,
  payMode: 'cash', fails: 0, lockUntil: 0, installEvt: null, subPlan: 'standard', subMonths: 1, sentNow: {}
};
const plan = () => L.planOf(S.account, Date.now(), C.FREE_PRODUCT_LIMIT);

async function loadAll() {
  [S.products, S.customers, S.sales, S.payments, S.expenses] = await Promise.all(
    ['products', 'customers', 'sales', 'payments', 'expenses'].map(dbAll));
  S.account = (await getMeta('account')) || null;
  S.used = (await getMeta('usedSerials')) || [];
}
const balance = id => L.balanceFor(id, S.sales, S.payments);
const debtors = () => S.customers
  .map(c => ({ c, bal: balance(c.id), since: L.oldestUnpaidDate(c.id, S.sales, S.payments) }))
  .filter(x => x.bal > 0)
  .sort((a, b) => b.bal - a.bal);
const overdue = () => debtors().filter(x => x.since && daysAgo(x.since) >= C.OVERDUE_DAYS);

/* ---------- Petits outils d'interface ---------- */
let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2400);
}
function openSheet(title, html) {
  $('#sheetRoot').innerHTML =
    '<div class="sheet-bg" id="sheetBg"><div class="sheet" role="dialog" aria-label="' + esc(title) + '">' +
    '<div class="sheet-head"><h2>' + esc(title) + '</h2><button data-action="closeSheet" aria-label="Fermer">✕</button></div>' +
    html + '</div></div>';
}
function closeSheet() { $('#sheetRoot').innerHTML = ''; }
function logoSVG(size) {
  return '<svg class="logo" width="' + size + '" height="' + size + '" viewBox="0 0 512 512" aria-hidden="true">' +
    '<rect width="512" height="512" rx="110" fill="#0b7a4b"/><rect x="132" y="224" width="248" height="156" fill="#fff"/>' +
    [0, 1, 2, 3, 4, 5].map(i => '<rect x="' + (112 + 48 * i) + '" y="154" width="48" height="70" fill="' + (i % 2 ? '#f5a623' : '#fff') + '"/>').join('') +
    '<rect x="222" y="276" width="68" height="104" fill="#0b7a4b"/><rect x="150" y="260" width="50" height="50" fill="#0b7a4b"/><rect x="312" y="260" width="50" height="50" fill="#0b7a4b"/></svg>';
}
async function hashPin(pin, salt) { return sha256Hex('gradi|' + salt + '|' + pin); }

/* ---------- Écrans d'accueil, inscription, PIN ---------- */
const SLIDES = [
  { e: '🛒', t: 'Vendez vite', d: 'Enregistrez une vente en 3 clics, même sans internet.' },
  { e: '📦', t: 'Suivez votre stock', d: 'Gradi vous prévient quand un produit est presque fini.' },
  { e: '💰', t: 'Récupérez vos dettes', d: 'Voyez qui vous doit de l\'argent et relancez vos clients sur WhatsApp.' }
];
function onboardView() {
  const s = SLIDES[S.onboard], last = S.onboard === SLIDES.length - 1;
  return '<div class="auth">' + logoSVG(84) + '<h1>Gradi</h1><p class="slogan">' + esc(C.SLOGAN) + '</p>' +
    '<div class="slide"><div class="emoji">' + s.e + '</div><h2>' + s.t + '</h2><p class="muted">' + s.d + '</p></div>' +
    '<div class="dots">' + SLIDES.map((_, i) => '<i class="' + (i === S.onboard ? 'on' : '') + '"></i>').join('') + '</div>' +
    '<button class="btn big block" data-action="obnext">' + (last ? 'Commencer' : 'Suivant') + '</button>' +
    (last ? '' : '<button class="btn ghost block mt" data-action="obskip">Passer</button>') + '</div>';
}
function registerView() {
  return '<div class="auth">' + logoSVG(64) + '<h1>Créer ma boutique</h1>' +
    '<p class="slogan">1 mois d\'essai gratuit du plan Standard, sans payer.</p>' +
    '<label for="r_shop">Nom de la boutique</label><input type="text" id="r_shop" placeholder="Ex : Boutique Mama Julie" autocomplete="organization">' +
    '<label for="r_phone">Votre numéro de téléphone</label><input type="tel" id="r_phone" placeholder="06 123 4567" autocomplete="tel">' +
    '<label for="r_pin">Choisissez un code PIN (4 chiffres)</label><input type="password" id="r_pin" class="pin" inputmode="numeric" maxlength="4" autocomplete="new-password">' +
    '<label for="r_pin2">Répétez le code PIN</label><input type="password" id="r_pin2" class="pin" inputmode="numeric" maxlength="4" autocomplete="new-password">' +
    '<button class="btn big block mt" data-action="register">Créer ma boutique</button>' +
    '<p class="muted small center mt">Vos données restent enregistrées sur ce téléphone. Pensez à faire une sauvegarde de temps en temps (menu ⚙️).</p></div>';
}
function loginView() {
  return '<div class="auth">' + logoSVG(72) + '<h1>' + esc(S.account.shop) + '</h1><p class="slogan">Entrez votre code PIN</p>' +
    '<input type="password" id="pinLogin" class="pin" inputmode="numeric" maxlength="4" autocomplete="current-password" autofocus aria-label="Code PIN">' +
    '<button class="btn big block mt" data-action="login">Ouvrir</button>' +
    '<button class="btn ghost block mt" data-action="forgotPin">PIN oublié ?</button></div>';
}

/* ---------- Structure de l'application ---------- */
function headerView() {
  const on = navigator.onLine;
  return '<header class="topbar"><div class="grow"><div class="brand">Gradi</div><div class="shop">' + esc(S.account.shop) + '</div></div>' +
    '<span class="net ' + (on ? '' : 'off') + '" id="net" title="Vos données sont enregistrées sur ce téléphone"><i></i>' + (on ? 'En ligne' : 'Hors ligne') + '</span>' +
    '<button class="iconbtn" data-action="settings" aria-label="Menu">⚙️</button></header>';
}
function bannerView() {
  const p = plan();
  if (p.expired) return '<div class="banner red">⛔ <span class="grow">Votre abonnement est terminé. Vous êtes au plan Gratuit.</span><button class="btn small" data-action="sub">Renouveler</button></div>';
  if (p.active && p.daysLeft <= 5) return '<div class="banner">⏰ <span class="grow">' + (p.trial ? 'Votre essai gratuit' : 'Votre abonnement') + ' se termine dans ' + p.daysLeft + ' jour' + (p.daysLeft > 1 ? 's' : '') + '.</span><button class="btn small" data-action="sub">Voir</button></div>';
  return '';
}
function navView() {
  const items = [['sell', '🛒', 'Vendre'], ['stock', '📦', 'Stock'], ['clients', '👥', 'Clients'], ['debts', '💰', 'Dettes'], ['bilan', '📊', 'Bilan']];
  const od = overdue().length;
  return '<nav class="nav">' + items.map(([k, i, t]) =>
    '<button class="' + (k === S.tab ? 'active ' : '') + (k === 'sell' ? 'sell' : '') + '" data-action="tab" data-tab="' + k + '"><span class="ico">' + i + '</span>' + t +
    (k === 'debts' && od ? '<span class="dot">' + od + '</span>' : '') + '</button>').join('') + '</nav>';
}
function render() {
  const app = $('#app');
  if (!S.account) { app.innerHTML = S.onboard < SLIDES.length ? onboardView() : registerView(); return; }
  if (!S.unlocked) { app.innerHTML = loginView(); return; }
  const views = { sell: sellView, stock: stockView, clients: clientsView, debts: debtsView, bilan: bilanView };
  app.innerHTML = headerView() + bannerView() + '<main id="main">' + views[S.tab]() + '</main>' +
    (S.tab === 'sell' ? '<div id="cartbar"></div>' : '') + navView();
  if (S.tab === 'sell') cartBar();
}

/* ---------- Vendre ---------- */
const cartItems = () => Object.entries(S.cart)
  .map(([id, q]) => ({ p: S.products.find(x => x.id === id), q }))
  .filter(x => x.p && x.q > 0);
const cartTotal = () => cartItems().reduce((a, x) => a + x.p.price * x.q, 0);

function sellView() {
  if (!S.products.length) {
    return '<div class="empty"><div class="big">📦</div><h2>Ajoutez vos produits</h2><p>Pour vendre, commencez par enregistrer ce que vous vendez.</p>' +
      '<button class="btn big" data-action="addProduct">+ Ajouter mon premier produit</button></div>';
  }
  return '<input type="search" id="search" placeholder="🔍 Chercher un produit" value="' + esc(S.search) + '" aria-label="Chercher un produit">' +
    '<div class="tiles" id="tiles">' + tilesHTML() + '</div>';
}
function tilesHTML() {
  const q = S.search.trim().toLowerCase();
  const list = S.products.filter(p => !q || p.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  if (!list.length) return '<div class="empty grow" style="grid-column:1/-1">Aucun produit trouvé</div>';
  return list.map(p => {
    const qty = S.cart[p.id] || 0;
    return '<div class="tile ' + (qty ? 'in ' : '') + (p.stock <= 0 ? 'out' : '') + '" data-action="add" data-id="' + p.id + '">' +
      '<div class="tname">' + esc(p.name) + '</div><div class="tprice">' + money(p.price) + '</div>' +
      '<div class="tstock">Stock : ' + p.stock + (p.stock <= p.low ? ' ⚠️' : '') + '</div>' +
      (qty ? '<div class="qty"><button data-action="dec" data-id="' + p.id + '" aria-label="Retirer un">−</button><b>' + qty + '</b><button data-action="inc" data-id="' + p.id + '" aria-label="Ajouter un">+</button></div>' : '') + '</div>';
  }).join('');
}
function cartBar() {
  const el = $('#cartbar'); if (!el) return;
  const items = cartItems();
  if (!items.length) { el.innerHTML = ''; return; }
  const n = items.reduce((a, x) => a + x.q, 0);
  el.innerHTML = '<div class="cartbar"><div class="grow"><div class="small">' + n + ' article' + (n > 1 ? 's' : '') + '</div><div class="total">' + money(cartTotal()) + '</div></div>' +
    '<button class="btn small" style="background:transparent;color:#fff;border-color:rgba(255,255,255,.5)" data-action="clearCart">Vider</button>' +
    '<button class="btn" data-action="checkout">Valider</button></div>';
}
function refreshSell() { const t = $('#tiles'); if (t) t.innerHTML = tilesHTML(); cartBar(); }
function cartAdd(id, d) {
  const p = S.products.find(x => x.id === id); if (!p) return;
  const cur = S.cart[id] || 0, next = cur + d;
  if (d > 0 && p.stock <= 0) return toast('Stock épuisé : ' + p.name);
  if (d > 0 && next > p.stock) return toast('Stock insuffisant (' + p.stock + ' restant' + (p.stock > 1 ? 's' : '') + ')');
  if (next <= 0) delete S.cart[id]; else S.cart[id] = next;
  refreshSell();
}
function checkoutHTML() {
  const total = cartTotal();
  const opts = S.customers.slice().sort((a, b) => a.name.localeCompare(b.name))
    .map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('');
  const noCust = !S.customers.length;
  return '<div class="card green"><div class="small">Total à payer</div><div class="stat big">' + money(total) + '</div></div>' +
    '<div class="seg"><button data-action="payMode" data-mode="cash" class="' + (S.payMode === 'cash' ? 'on' : '') + '">💵 Payé comptant</button>' +
    '<button data-action="payMode" data-mode="credit" class="' + (S.payMode === 'credit' ? 'on' : '') + '">📒 À crédit</button></div>' +
    '<div id="creditBox" style="display:' + (S.payMode === 'credit' ? 'block' : 'none') + '">' +
    '<label for="ck_cust">Client</label><select id="ck_cust">' + opts + '<option value="new"' + (noCust ? ' selected' : '') + '>➕ Nouveau client</option></select>' +
    '<div id="newCust" style="display:' + (noCust ? 'block' : 'none') + '"><label for="ck_name">Nom du client</label><input type="text" id="ck_name" autocomplete="off">' +
    '<label for="ck_phone">Téléphone WhatsApp (pour les rappels)</label><input type="tel" id="ck_phone" autocomplete="off"></div>' +
    '<label for="ck_paid">Acompte payé maintenant (FCFA)</label><input type="number" id="ck_paid" inputmode="numeric" value="0" min="0"></div>' +
    '<button class="btn big block mt" data-action="confirmSale">Confirmer la vente</button>';
}
async function confirmSale() {
  const items = cartItems(); if (!items.length) return;
  const total = cartTotal();
  for (const { p, q } of items) if (q > p.stock) return toast('Stock insuffisant : ' + p.name);
  let customerId = null, paid = total;
  if (S.payMode === 'credit') {
    paid = num($('#ck_paid').value);
    if (paid < 0 || paid >= total) return toast('L\'acompte doit être inférieur au total');
    const sel = $('#ck_cust').value;
    if (sel === 'new') {
      const name = $('#ck_name').value.trim();
      if (!name) return toast('Écrivez le nom du client');
      const c = { id: uid(), name, phone: $('#ck_phone').value.trim(), created: Date.now() };
      await dbPut('customers', c); customerId = c.id;
    } else customerId = sel;
  }
  const sale = { id: uid(), date: Date.now(), customerId, total, paid,
    items: items.map(({ p, q }) => ({ productId: p.id, name: p.name, qty: q, price: p.price, cost: p.cost })) };
  await dbPut('sales', sale);
  for (const { p, q } of items) { p.stock -= q; await dbPut('products', p); }
  S.cart = {}; S.payMode = 'cash';
  await loadAll(); closeSheet(); render(); toast('Vente enregistrée ✓');
}

/* ---------- Stock ---------- */
function stockView() {
  return '<div class="row mb"><div class="grow"><h2>Mes produits</h2></div><button class="btn" data-action="addProduct">+ Produit</button></div>' +
    '<input type="search" id="psearch" placeholder="🔍 Chercher un produit" value="' + esc(S.psearch) + '" aria-label="Chercher un produit">' +
    '<div class="card mt" id="plist">' + productListHTML() + '</div>';
}
function productListHTML() {
  const q = S.psearch.trim().toLowerCase();
  const list = S.products.filter(p => !q || p.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  if (!list.length) return '<div class="empty">' + (S.products.length ? 'Aucun produit trouvé' : 'Aucun produit pour le moment') + '</div>';
  return list.map(p => '<div class="list-item" data-action="editProduct" data-id="' + p.id + '"><div class="grow"><b>' + esc(p.name) + '</b>' +
    '<div class="small muted">Achat ' + money(p.cost) + ' · Vente ' + money(p.price) + '</div></div>' +
    '<span class="badge ' + (p.stock <= 0 ? 'red' : p.stock <= p.low ? 'amber' : '') + '">' + (p.stock <= 0 ? 'Épuisé' : p.stock + ' en stock') + '</span></div>').join('');
}
function productSheet(id) {
  const p = id ? S.products.find(x => x.id === id) : null;
  if (!p && S.products.length >= plan().productLimit) {
    return upgradeSheet('Le plan Gratuit permet ' + C.FREE_PRODUCT_LIMIT + ' produits. Passez au plan Standard pour en ajouter autant que vous voulez.');
  }
  openSheet(p ? 'Modifier le produit' : 'Nouveau produit',
    '<label for="p_name">Nom du produit</label><input type="text" id="p_name" value="' + esc(p ? p.name : '') + '" autocomplete="off">' +
    '<div class="grid2"><div><label for="p_cost">Prix d\'achat</label><input type="number" id="p_cost" inputmode="numeric" min="0" value="' + (p ? p.cost : '') + '"></div>' +
    '<div><label for="p_price">Prix de vente</label><input type="number" id="p_price" inputmode="numeric" min="0" value="' + (p ? p.price : '') + '"></div></div>' +
    '<div class="grid2"><div><label for="p_stock">Quantité en stock</label><input type="number" id="p_stock" inputmode="numeric" min="0" value="' + (p ? p.stock : '') + '"></div>' +
    '<div><label for="p_low">Alerte quand il reste</label><input type="number" id="p_low" inputmode="numeric" min="0" value="' + (p ? p.low : 3) + '"></div></div>' +
    (p ? '<label>Réapprovisionner</label><div class="row">' + [5, 10, 20, 50].map(n => '<button class="btn alt small grow" data-action="restock" data-n="' + n + '">+' + n + '</button>').join('') + '</div>' : '') +
    '<button class="btn big block mt" data-action="saveProduct" data-id="' + (p ? p.id : '') + '">Enregistrer</button>' +
    (p ? '<button class="btn warn block mt" data-action="deleteProduct" data-id="' + p.id + '">Supprimer ce produit</button>' : ''));
}
async function saveProduct(id) {
  const name = $('#p_name').value.trim(), cost = num($('#p_cost').value), price = num($('#p_price').value),
    stock = num($('#p_stock').value), low = num($('#p_low').value);
  if (!name) return toast('Écrivez le nom du produit');
  if (price <= 0) return toast('Écrivez le prix de vente');
  const p = id ? S.products.find(x => x.id === id) : { id: uid(), created: Date.now() };
  Object.assign(p, { name, cost, price, stock: Math.max(0, stock), low });
  await dbPut('products', p);
  await loadAll(); closeSheet(); render(); toast('Produit enregistré ✓');
}

/* ---------- Clients ---------- */
function clientsView() {
  const list = S.customers.slice().sort((a, b) => a.name.localeCompare(b.name));
  return '<div class="row mb"><div class="grow"><h2>Mes clients</h2></div><button class="btn" data-action="addClient">+ Client</button></div>' +
    '<div class="card">' + (list.length ? list.map(c => {
      const b = balance(c.id);
      return '<div class="list-item" data-action="client" data-id="' + c.id + '"><div class="avatar">' + esc(c.name.charAt(0).toUpperCase()) + '</div>' +
        '<div class="grow"><b>' + esc(c.name) + '</b><div class="small muted">' + esc(c.phone || 'Pas de numéro') + '</div></div>' +
        (b > 0 ? '<span class="badge red">' + money(b) + '</span>' : '<span class="badge">À jour</span>') + '</div>';
    }).join('') : '<div class="empty"><div class="big">👥</div>Aucun client enregistré.<br>Ajoutez vos clients qui achètent à crédit.</div>') + '</div>';
}
function clientForm(id) {
  const c = id ? S.customers.find(x => x.id === id) : null;
  openSheet(c ? 'Modifier le client' : 'Nouveau client',
    '<label for="c_name">Nom du client</label><input type="text" id="c_name" value="' + esc(c ? c.name : '') + '" autocomplete="off">' +
    '<label for="c_phone">Téléphone WhatsApp</label><input type="tel" id="c_phone" value="' + esc(c ? c.phone || '' : '') + '" placeholder="06 123 4567" autocomplete="off">' +
    '<button class="btn big block mt" data-action="saveClient" data-id="' + (c ? c.id : '') + '">Enregistrer</button>' +
    (c ? '<button class="btn warn block mt" data-action="deleteClient" data-id="' + c.id + '">Supprimer ce client</button>' : ''));
}
async function saveClient(id) {
  const name = $('#c_name').value.trim(), phone = $('#c_phone').value.trim();
  if (!name) return toast('Écrivez le nom du client');
  const c = id ? S.customers.find(x => x.id === id) : { id: uid(), created: Date.now() };
  Object.assign(c, { name, phone });
  await dbPut('customers', c);
  await loadAll(); closeSheet(); render(); toast('Client enregistré ✓');
}
function clientSheet(id) {
  const c = S.customers.find(x => x.id === id); if (!c) return;
  const b = balance(id);
  const ev = S.sales.filter(s => s.customerId === id).map(s => ({ t: s.date, k: 'sale', s }))
    .concat(S.payments.filter(p => p.customerId === id).map(p => ({ t: p.date, k: 'pay', p })))
    .sort((a, b) => b.t - a.t).slice(0, 25);
  openSheet(c.name,
    '<div class="card ' + (b > 0 ? 'red' : '') + '"><div class="small muted">' + esc(c.phone || 'Pas de numéro') + '</div><div class="small">Dette actuelle</div>' +
    '<div class="stat big ' + (b > 0 ? 'danger' : 'ok') + '">' + money(Math.max(0, b)) + '</div></div>' +
    '<div class="grid2">' +
    '<button class="btn" data-action="payDebt" data-id="' + id + '"' + (b > 0 ? '' : ' disabled') + '>💵 Encaisser</button>' +
    '<button class="btn alt" data-action="remind" data-id="' + id + '"' + (b > 0 ? '' : ' disabled') + '>💬 Rappel</button></div>' +
    '<button class="btn ghost block mt" data-action="editClient" data-id="' + id + '">✏️ Modifier le client</button>' +
    '<h3 class="mt">Historique</h3><div class="card">' + (ev.length ? ev.map(e => e.k === 'sale'
      ? '<div class="list-item" style="cursor:default"><div class="grow"><b>Achat ' + money(e.s.total) + '</b><div class="small muted">' + dfull(e.t) + ' · ' +
        esc(e.s.items.map(i => i.qty + '× ' + i.name).join(', ')) + '</div></div><span class="small">' + (e.s.total > e.s.paid ? 'Dû ' + money(e.s.total - e.s.paid) : 'Payé') + '</span></div>'
      : '<div class="list-item" style="cursor:default"><div class="grow"><b class="ok">Paiement reçu</b><div class="small muted">' + dfull(e.t) + '</div></div><b class="ok">+' + money(e.p.amount) + '</b></div>'
    ).join('') : '<div class="empty">Aucun achat pour le moment</div>') + '</div>');
}
function paySheet(id) {
  const c = S.customers.find(x => x.id === id), b = balance(id);
  openSheet('Encaisser un paiement',
    '<p><b>' + esc(c.name) + '</b> doit <b class="danger">' + money(b) + '</b></p>' +
    '<label for="pay_amt">Montant reçu (FCFA)</label><input type="number" id="pay_amt" inputmode="numeric" min="1" max="' + b + '" value="' + b + '">' +
    '<button class="btn big block mt" data-action="savePayment" data-id="' + id + '">Enregistrer le paiement</button>');
}
async function savePayment(id) {
  const b = balance(id), amount = num($('#pay_amt').value);
  if (amount <= 0) return toast('Écrivez le montant reçu');
  if (amount > b) return toast('Ce montant dépasse la dette (' + money(b) + ')');
  await dbPut('payments', { id: uid(), customerId: id, amount, date: Date.now() });
  await loadAll(); closeSheet(); render(); toast('Paiement enregistré ✓');
}

/* ---------- Dettes et rappels WhatsApp ---------- */
function debtsView() {
  const list = debtors(), total = list.reduce((a, x) => a + x.bal, 0), od = overdue();
  return '<div class="card green"><div class="small">On me doit en tout</div><div class="stat big">' + money(total) + '</div>' +
    '<div class="small">' + list.length + ' client' + (list.length > 1 ? 's' : '') + (od.length ? ' · ' + od.length + ' en retard' : '') + '</div></div>' +
    (od.length ? '<button class="btn big block mb" data-action="remindAll">💬 Relancer les clients en retard (' + od.length + ')</button>' : '') +
    '<div class="card">' + (list.length ? list.map(({ c, bal, since }) =>
      '<div class="list-item" data-action="client" data-id="' + c.id + '"><div class="avatar">' + esc(c.name.charAt(0).toUpperCase()) + '</div>' +
      '<div class="grow"><b>' + esc(c.name) + '</b><div class="small muted">' + (since ? (daysAgo(since) === 0 ? 'Dette d\'aujourd\'hui' : 'Depuis ' + daysAgo(since) + ' jour' + (daysAgo(since) > 1 ? 's' : '')) : '') +
      (c.lastReminder ? ' · Rappel le ' + dfmt(c.lastReminder) : '') + '</div></div>' +
      '<div class="right"><b class="danger">' + money(bal) + '</b></div></div>').join('')
      : '<div class="empty"><div class="big">🎉</div>Personne ne vous doit d\'argent.</div>') + '</div>';
}
function remindSheet(id) {
  const p = plan(), c = S.customers.find(x => x.id === id); if (!c) return;
  if (!p.reminders) return upgradeSheet('Les rappels WhatsApp sont inclus dans le plan Standard.');
  if (!L.waNumber(c.phone, C.COUNTRY_CODE)) {
    toast('Ajoutez d\'abord le numéro WhatsApp de ce client'); return clientForm(id);
  }
  openSheet('Rappel à ' + c.name,
    '<label for="rm_text">Message (modifiable)</label><textarea id="rm_text">' + esc(L.reminderText(S.account.shop, c.name, balance(id))) + '</textarea>' +
    '<button class="btn big block mt" data-action="sendReminder" data-id="' + id + '">💬 Ouvrir WhatsApp</button>');
}
async function markReminded(c) { c.lastReminder = Date.now(); await dbPut('customers', c); }
async function sendReminder(id) {
  const c = S.customers.find(x => x.id === id);
  window.open(L.waLink(c.phone, $('#rm_text').value, C.COUNTRY_CODE), '_blank', 'noopener');
  await markReminded(c); await loadAll(); closeSheet(); render();
}
function remindAllSheet() {
  if (!plan().reminders) return upgradeSheet('Les rappels WhatsApp sont inclus dans le plan Standard.');
  const od = overdue();
  openSheet('Clients en retard',
    '<p class="muted small">Dette de plus de ' + C.OVERDUE_DAYS + ' jours. Touchez « Envoyer » pour chaque client : WhatsApp s\'ouvre avec le message prêt.</p>' +
    '<div class="card">' + od.map(({ c, bal, since }) =>
      '<div class="list-item" style="cursor:default"><div class="grow"><b>' + esc(c.name) + '</b><div class="small muted">' + money(bal) + ' · ' + daysAgo(since) + ' j</div></div>' +
      (L.waNumber(c.phone, C.COUNTRY_CODE)
        ? '<button class="btn small ' + (S.sentNow[c.id] ? 'ghost' : '') + '" data-action="sendOne" data-id="' + c.id + '">' + (S.sentNow[c.id] ? '✓ Envoyé' : 'Envoyer') + '</button>'
        : '<span class="badge amber">Pas de numéro</span>') + '</div>').join('') + '</div>');
}
async function sendOne(id) {
  const c = S.customers.find(x => x.id === id);
  window.open(L.waLink(c.phone, L.reminderText(S.account.shop, c.name, balance(id)), C.COUNTRY_CODE), '_blank', 'noopener');
  S.sentNow[id] = true; await markReminded(c); await loadAll(); remindAllSheet();
}

/* ---------- Bilan et dépenses ---------- */
const EXP_CATS = ['Loyer', 'Transport', 'Électricité', 'Eau', 'Salaire', 'Marchandise', 'Autre'];
function bilanView() {
  const s = L.summarize(S.sales, S.expenses), p = plan();
  const totalDebt = debtors().reduce((a, x) => a + x.bal, 0);
  const low = S.products.filter(x => x.stock <= x.low).sort((a, b) => a.stock - b.stock);
  const m0 = L.startOfMonth(Date.now());
  const exps = S.expenses.filter(e => e.date >= m0).sort((a, b) => b.date - a.date);
  let detailed;
  if (p.detailedReports) {
    const days = L.last7Days(S.sales), mx = Math.max(1, ...days.map(d => d.total));
    detailed = '<div class="card"><h3>Rapport détaillé · 7 derniers jours</h3>' + days.map(d =>
      '<div class="row" style="margin:6px 0"><span class="small" style="width:52px">' + new Date(d.day).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' }) + '</span>' +
      '<div class="bar grow"><i style="width:' + Math.round(d.total / mx * 100) + '%"></i></div><b class="small" style="width:96px;text-align:right">' + money(d.total) + '</b></div>').join('') +
      '<h3 class="mt">Produits du mois</h3><table><tr><th>Produit</th><th class="r">Qté</th><th class="r">Ventes</th><th class="r">Marge</th></tr>' +
      (s.byProduct.slice(0, 10).map(x => '<tr><td>' + esc(x.name) + '</td><td class="r">' + x.qty + '</td><td class="r">' + L.fmtNumber(x.revenue) + '</td><td class="r">' + L.fmtNumber(x.margin) + '</td></tr>').join('') || '<tr><td colspan="4" class="muted">Pas encore de ventes</td></tr>') + '</table></div>';
  } else {
    detailed = '<div class="card lock"><h3>🔒 Rapport détaillé</h3><p class="muted small">Ventes jour par jour, marge par produit… disponible avec le plan Pro.</p><button class="btn alt small" data-action="sub">Voir les abonnements</button></div>';
  }
  return '<div class="grid2"><div class="card green"><div class="small">Ventes du jour</div><div class="stat">' + L.fmtNumber(s.today) + '</div><div class="small">FCFA</div></div>' +
    '<div class="card"><div class="small muted">Ventes du mois</div><div class="stat">' + L.fmtNumber(s.month) + '</div><div class="small muted">FCFA</div></div>' +
    '<div class="card"><div class="small muted">Dépenses du mois</div><div class="stat">' + L.fmtNumber(s.expMonth) + '</div><div class="small muted">FCFA</div></div>' +
    '<div class="card"><div class="small muted">Bénéfice estimé</div><div class="stat ' + (s.profit < 0 ? 'danger' : 'ok') + '">' + L.fmtNumber(s.profit) + '</div><div class="small muted">FCFA (marge − dépenses)</div></div></div>' +
    '<div class="card ' + (totalDebt ? 'red' : '') + '"><div class="row between"><div><div class="small muted">Dettes des clients</div><div class="stat ' + (totalDebt ? 'danger' : '') + '">' + money(totalDebt) + '</div></div>' +
    '<button class="btn alt small" data-action="tab" data-tab="debts">Voir</button></div></div>' +
    '<div class="card"><h3>🏆 Produits les plus vendus (mois)</h3>' + (s.top.length ? s.top.map((x, i) =>
      '<div class="row" style="margin:6px 0"><b>' + (i + 1) + '.</b><span class="grow">' + esc(x.name) + '</span><b>' + x.qty + '</b></div>').join('') : '<p class="muted">Pas encore de ventes ce mois-ci.</p>') + '</div>' +
    '<div class="card"><h3>⚠️ Stock bas</h3>' + (low.length ? low.map(x =>
      '<div class="row" style="margin:6px 0"><span class="grow">' + esc(x.name) + '</span><span class="badge ' + (x.stock <= 0 ? 'red' : 'amber') + '">' + (x.stock <= 0 ? 'Épuisé' : x.stock + ' restant' + (x.stock > 1 ? 's' : '')) + '</span></div>').join('') : '<p class="muted">Tout est en ordre 👍</p>') + '</div>' +
    detailed +
    '<div class="card"><div class="row between"><h3 style="margin:0">💸 Dépenses du mois</h3><button class="btn small" data-action="addExpense">+ Dépense</button></div>' +
    (exps.length ? exps.map(e => '<div class="list-item" data-action="delExpense" data-id="' + e.id + '"><div class="grow"><b>' + esc(e.cat) + '</b><div class="small muted">' + dfmt(e.date) + (e.note ? ' · ' + esc(e.note) : '') + '</div></div><b>' + money(e.amount) + '</b></div>').join('') +
      '<p class="small muted mt">Touchez une dépense pour la supprimer.</p>' : '<p class="muted mt">Aucune dépense enregistrée ce mois-ci.</p>') + '</div>';
}
function expenseSheet() {
  const today = new Date(); today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  openSheet('Nouvelle dépense',
    '<label for="e_amt">Montant (FCFA)</label><input type="number" id="e_amt" inputmode="numeric" min="1">' +
    '<label for="e_cat">Catégorie</label><select id="e_cat">' + EXP_CATS.map(c => '<option>' + c + '</option>').join('') + '</select>' +
    '<label for="e_note">Note (facultatif)</label><input type="text" id="e_note" autocomplete="off">' +
    '<label for="e_date">Date</label><input type="date" id="e_date" value="' + today.toISOString().slice(0, 10) + '">' +
    '<button class="btn big block mt" data-action="saveExpense">Enregistrer</button>');
}
async function saveExpense() {
  const amount = num($('#e_amt').value);
  if (amount <= 0) return toast('Écrivez le montant');
  const d = $('#e_date').value ? new Date($('#e_date').value + 'T12:00:00').getTime() : Date.now();
  await dbPut('expenses', { id: uid(), amount, cat: $('#e_cat').value, note: $('#e_note').value.trim(), date: d });
  await loadAll(); closeSheet(); render(); toast('Dépense enregistrée ✓');
}

/* ---------- Abonnement ---------- */
function upgradeSheet(msg) {
  openSheet('Passez au plan supérieur', '<p>' + esc(msg) + '</p><button class="btn big block" data-action="sub">Voir les abonnements</button>');
}
function planLabel(k) { return { free: 'Gratuit', standard: 'Standard', pro: 'Pro' }[k]; }
function subSheet() {
  const p = plan(), a = S.account;
  const price = L.subscriptionPrice(S.subPlan, S.subMonths, C.PRICES);
  const num6 = Object.entries(C.PAY_NUMBERS).map(([n, v]) => '<div class="row between"><span>' + esc(n) + '</span><b>' + esc(v) + '</b></div>').join('');
  openSheet('Abonnements',
    '<div class="card"><div class="small muted">Votre plan actuel</div><b>' + planLabel(p.key) + '</b>' +
    (p.active ? ' · ' + (p.trial ? 'essai gratuit, ' : '') + 'encore ' + p.daysLeft + ' jour' + (p.daysLeft > 1 ? 's' : '') + ' (jusqu\'au ' + dfull(a.planExpiry) + ')' : ' · pas d\'abonnement en cours') + '</div>' +
    '<div class="plan"><b>Gratuit</b> <span class="price">0 FCFA</span><ul><li>Jusqu\'à ' + C.FREE_PRODUCT_LIMIT + ' produits</li><li>Ventes, stock, dettes et bilan</li><li>Pas de rappels WhatsApp</li></ul></div>' +
    '<div class="plan ' + (S.subPlan === 'standard' ? 'cur' : '') + '" data-action="choosePlan" data-plan="standard"><b>Standard</b> <span class="price">' + L.fmtNumber(C.PRICES.standard) + ' FCFA/mois</span><ul><li>Produits illimités</li><li>Dettes + rappels WhatsApp</li></ul></div>' +
    '<div class="plan ' + (S.subPlan === 'pro' ? 'cur' : '') + '" data-action="choosePlan" data-plan="pro"><b>Pro</b> <span class="price">' + L.fmtNumber(C.PRICES.pro) + ' FCFA/mois</span><ul><li>Tout le plan Standard</li><li>Rapports détaillés</li></ul></div>' +
    '<label for="sub_months">Durée</label><select id="sub_months">' + [1, 3, 6, 12].map(m => '<option value="' + m + '"' + (m === S.subMonths ? ' selected' : '') + '>' + m + ' mois' + (m === 6 ? ' (1 mois offert)' : m === 12 ? ' (2 mois offerts)' : '') + '</option>').join('') + '</select>' +
    '<div class="card green mt"><div class="small">À payer pour ' + planLabel(S.subPlan) + ' · ' + S.subMonths + ' mois</div><div class="stat big">' + money(price) + '</div></div>' +
    '<h3>1. Payez par Mobile Money</h3><div class="card">' + num6 + '<div class="small muted mt">Au nom de : ' + esc(C.PAY_NAME) + '</div></div>' +
    '<label for="sub_ref">Référence de la transaction</label><input type="text" id="sub_ref" placeholder="Ex : MP26112012345" autocomplete="off">' +
    '<button class="btn alt block mt" data-action="sendProof">💬 2. Envoyer la preuve par WhatsApp</button>' +
    '<h3 class="mt">3. Entrez le code reçu</h3><input type="text" id="sub_code" placeholder="Ex : S1-1234-AB12CD34" autocomplete="off" style="text-transform:uppercase">' +
    '<button class="btn big block mt" data-action="activate">Activer mon abonnement</button>');
}
function sendProof() {
  const msg = 'Bonjour, je veux activer Gradi ' + planLabel(S.subPlan) + ' pour ' + S.subMonths + ' mois (' + money(L.subscriptionPrice(S.subPlan, S.subMonths, C.PRICES)).replace(/ /g, ' ') + ').\n' +
    'Boutique : ' + S.account.shop + '\nTéléphone : ' + S.account.phone + '\nRéférence de paiement : ' + ($('#sub_ref').value.trim() || '(à compléter)');
  window.open(L.waLink(C.SUPPORT_WHATSAPP, msg, C.COUNTRY_CODE), '_blank', 'noopener');
}
async function activate() {
  const raw = $('#sub_code').value;
  const r = await verifyActivationCode(raw, S.account.phone);
  if (!r) return toast('Code invalide. Vérifiez-le ou contactez-nous.');
  if (S.used.includes(r.serial + r.code)) return toast('Ce code a déjà été utilisé.');
  const now = Date.now(), cur = plan();
  const base = cur.active && cur.key === r.plan ? S.account.planExpiry : now;
  S.account.plan = r.plan; S.account.trial = false;
  S.account.planExpiry = base + r.months * C.MONTH_DAYS * L.DAY;
  S.used.push(r.serial + r.code);
  await setMeta('account', S.account); await setMeta('usedSerials', S.used);
  closeSheet(); render(); toast('Abonnement ' + planLabel(r.plan) + ' activé ✓');
}

/* ---------- Réglages, sauvegarde, PIN ---------- */
function settingsSheet() {
  const p = plan();
  openSheet('Menu',
    '<div class="card"><b>' + esc(S.account.shop) + '</b><div class="small muted">' + esc(S.account.phone) + '</div>' +
    '<div class="mt"><span class="badge ' + (p.key === 'free' ? 'amber' : '') + '">Plan ' + planLabel(p.key) + (p.trial ? ' (essai)' : '') + '</span>' +
    (p.active ? ' <span class="small muted">' + p.daysLeft + ' j restants</span>' : '') + '</div></div>' +
    '<button class="btn block" data-action="sub">⭐ Abonnements</button>' +
    '<button class="btn ghost block mt" data-action="exportData">💾 Sauvegarder mes données</button>' +
    '<button class="btn ghost block mt" data-action="importPick">📥 Restaurer une sauvegarde</button>' +
    '<input type="file" id="importFile" accept="application/json,.json" style="display:none">' +
    '<button class="btn ghost block mt" data-action="changePin">🔑 Changer mon code PIN</button>' +
    (S.installEvt ? '<button class="btn ghost block mt" data-action="install">📲 Installer l\'application</button>' : '') +
    '<button class="btn ghost block mt" data-action="lock">🔒 Verrouiller</button>' +
    '<p class="small muted mt">Vos données sont enregistrées sur ce téléphone. Faites une sauvegarde régulièrement et gardez-la sur WhatsApp ou Google Drive.</p>');
}
async function exportData() {
  const data = { app: 'gradi', version: 1, date: Date.now(), account: S.account, usedSerials: S.used,
    products: S.products, customers: S.customers, sales: S.sales, payments: S.payments, expenses: S.expenses };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'gradi-sauvegarde-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Sauvegarde téléchargée ✓');
}
async function importData(file) {
  try {
    const d = JSON.parse(await file.text());
    if (d.app !== 'gradi' || !d.account) throw new Error('bad');
    if (!confirm('Remplacer toutes les données actuelles par cette sauvegarde ?')) return;
    for (const n of ['products', 'customers', 'sales', 'payments', 'expenses']) {
      await dbClear(n);
      for (const o of d[n] || []) await dbPut(n, o);
    }
    await setMeta('account', d.account); await setMeta('usedSerials', d.usedSerials || []);
    await loadAll(); S.unlocked = false; S.cart = {}; closeSheet(); render(); toast('Sauvegarde restaurée ✓');
  } catch (e) { toast('Fichier de sauvegarde non valide'); }
}
function pinSheet() {
  openSheet('Changer mon code PIN',
    '<label for="np_old">Code PIN actuel</label><input type="password" id="np_old" class="pin" inputmode="numeric" maxlength="4">' +
    '<label for="np_new">Nouveau code PIN</label><input type="password" id="np_new" class="pin" inputmode="numeric" maxlength="4">' +
    '<label for="np_new2">Répétez le nouveau code</label><input type="password" id="np_new2" class="pin" inputmode="numeric" maxlength="4">' +
    '<button class="btn big block mt" data-action="savePin">Enregistrer</button>');
}
async function savePin() {
  const o = $('#np_old').value, n = $('#np_new').value, n2 = $('#np_new2').value;
  if (await hashPin(o, S.account.salt) !== S.account.pinHash) return toast('Code PIN actuel incorrect');
  if (!/^\d{4}$/.test(n)) return toast('Le PIN doit avoir 4 chiffres');
  if (n !== n2) return toast('Les deux codes sont différents');
  S.account.pinHash = await hashPin(n, S.account.salt);
  await setMeta('account', S.account); closeSheet(); toast('Code PIN changé ✓');
}

/* ---------- Connexion / inscription ---------- */
async function register() {
  const shop = $('#r_shop').value.trim(), phone = $('#r_phone').value.trim(), pin = $('#r_pin').value, pin2 = $('#r_pin2').value;
  if (!shop) return toast('Écrivez le nom de votre boutique');
  if (phone.replace(/\D/g, '').length < 8) return toast('Numéro de téléphone incomplet');
  if (!/^\d{4}$/.test(pin)) return toast('Le PIN doit avoir exactement 4 chiffres');
  if (pin !== pin2) return toast('Les deux codes PIN sont différents');
  const salt = uid();
  S.account = { shop, phone, salt, pinHash: await hashPin(pin, salt), plan: 'standard', trial: true,
    planExpiry: Date.now() + C.TRIAL_DAYS * L.DAY, created: Date.now() };
  await setMeta('account', S.account); await setMeta('usedSerials', []);
  S.unlocked = true; S.tab = 'sell'; render(); toast('Bienvenue sur Gradi 🎉');
}
async function login() {
  const el = $('#pinLogin'); if (!el) return;
  if (Date.now() < S.lockUntil) return toast('Trop d\'essais. Patientez quelques secondes.');
  if (await hashPin(el.value, S.account.salt) === S.account.pinHash) { S.unlocked = true; S.fails = 0; render(); return; }
  S.fails++; el.value = '';
  if (S.fails >= 5) { S.lockUntil = Date.now() + 30000; S.fails = 0; toast('Trop d\'essais. Patientez 30 secondes.'); } else toast('Code PIN incorrect');
}
async function resetAll() {
  if (!confirm('Tout effacer sur ce téléphone (produits, clients, ventes) ? Cette action est définitive.')) return;
  for (const n of ['products', 'customers', 'sales', 'payments', 'expenses', 'meta']) await dbClear(n);
  S.account = null; S.unlocked = false; S.cart = {}; S.onboard = 0; await loadAll(); render();
}

/* ---------- Actions (clics) ---------- */
const A = {
  obnext() { S.onboard++; render(); },
  obskip() { S.onboard = SLIDES.length; render(); },
  register, login,
  forgotPin() {
    openSheet('PIN oublié ?',
      '<p>Pour votre sécurité, le code PIN ne peut pas être récupéré. Vous avez deux solutions :</p>' +
      '<p><b>1.</b> Restaurez une sauvegarde faite sur un autre appareil (elle contient votre PIN de l\'époque).</p>' +
      '<p><b>2.</b> Effacez tout et recommencez à zéro.</p>' +
      '<input type="file" id="importFile" accept="application/json,.json" style="display:none">' +
      '<button class="btn alt block" data-action="importPick">📥 Restaurer une sauvegarde</button>' +
      '<button class="btn warn block mt" data-action="resetAll">🗑️ Tout effacer</button>');
  },
  resetAll,
  tab(el) { S.tab = el.dataset.tab; closeSheet(); render(); window.scrollTo(0, 0); },
  closeSheet,
  add(el) { cartAdd(el.dataset.id, 1); },
  inc(el) { cartAdd(el.dataset.id, 1); },
  dec(el) { cartAdd(el.dataset.id, -1); },
  clearCart() { S.cart = {}; refreshSell(); },
  checkout() { if (!cartItems().length) return; S.payMode = 'cash'; openSheet('Valider la vente', checkoutHTML()); },
  payMode(el) {
    S.payMode = el.dataset.mode;
    document.querySelectorAll('[data-action=payMode]').forEach(b => b.classList.toggle('on', b === el));
    $('#creditBox').style.display = S.payMode === 'credit' ? 'block' : 'none';
  },
  confirmSale,
  addProduct() { if (S.tab === 'sell') S.tab = 'stock'; productSheet(null); },
  editProduct(el) { productSheet(el.dataset.id); },
  restock(el) { const f = $('#p_stock'); f.value = num(f.value) + num(el.dataset.n); },
  saveProduct(el) { return saveProduct(el.dataset.id); },
  async deleteProduct(el) {
    if (!confirm('Supprimer ce produit ? L\'historique des ventes est conservé.')) return;
    await dbDel('products', el.dataset.id); delete S.cart[el.dataset.id];
    await loadAll(); closeSheet(); render(); toast('Produit supprimé');
  },
  addClient() { clientForm(null); },
  editClient(el) { clientForm(el.dataset.id); },
  saveClient(el) { return saveClient(el.dataset.id); },
  async deleteClient(el) {
    if (balance(el.dataset.id) > 0) return toast('Ce client a une dette : encaissez-la d\'abord');
    if (!confirm('Supprimer ce client ?')) return;
    await dbDel('customers', el.dataset.id); await loadAll(); closeSheet(); render(); toast('Client supprimé');
  },
  client(el) { clientSheet(el.dataset.id); },
  payDebt(el) { paySheet(el.dataset.id); },
  savePayment(el) { return savePayment(el.dataset.id); },
  remind(el) { remindSheet(el.dataset.id); },
  sendReminder(el) { return sendReminder(el.dataset.id); },
  remindAll() { remindAllSheet(); },
  sendOne(el) { return sendOne(el.dataset.id); },
  addExpense() { expenseSheet(); },
  saveExpense,
  async delExpense(el) {
    if (!confirm('Supprimer cette dépense ?')) return;
    await dbDel('expenses', el.dataset.id); await loadAll(); render(); toast('Dépense supprimée');
  },
  sub() { subSheet(); },
  choosePlan(el) { S.subPlan = el.dataset.plan; subSheet(); },
  sendProof, activate,
  settings() { settingsSheet(); },
  exportData,
  importPick() { const f = $('#importFile'); if (f) f.click(); },
  changePin() { pinSheet(); },
  savePin,
  async install() { if (S.installEvt) { S.installEvt.prompt(); S.installEvt = null; closeSheet(); } },
  lock() { S.unlocked = false; closeSheet(); render(); }
};

document.addEventListener('click', e => {
  const bg = e.target.id === 'sheetBg' ? e.target : null;
  if (bg) return closeSheet();
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = A[el.dataset.action];
  if (fn) Promise.resolve(fn(el, e)).catch(err => { console.error(err); toast('Une erreur est survenue'); });
});
document.addEventListener('input', e => {
  const id = e.target.id;
  if (id === 'search') { S.search = e.target.value; const t = $('#tiles'); if (t) t.innerHTML = tilesHTML(); }
  else if (id === 'psearch') { S.psearch = e.target.value; const l = $('#plist'); if (l) l.innerHTML = productListHTML(); }
  else if (id === 'pinLogin' && e.target.value.length === 4) login();
});
document.addEventListener('change', e => {
  const id = e.target.id;
  if (id === 'ck_cust') $('#newCust').style.display = e.target.value === 'new' ? 'block' : 'none';
  else if (id === 'sub_months') { S.subMonths = parseInt(e.target.value, 10); subSheet(); }
  else if (id === 'importFile' && e.target.files[0]) importData(e.target.files[0]);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'pinLogin') login();
  if (e.key === 'Escape') closeSheet();
});
window.addEventListener('online', () => { const n = $('#net'); if (n) { n.className = 'net'; n.innerHTML = '<i></i>En ligne'; } });
window.addEventListener('offline', () => { const n = $('#net'); if (n) { n.className = 'net off'; n.innerHTML = '<i></i>Hors ligne'; } });
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; });

/* ---------- Démarrage ---------- */
(async () => {
  try {
    db = await openDB();
    await loadAll();
    render();
  } catch (err) {
    console.error(err);
    $('#app').innerHTML = '<div class="auth"><h1>Oups</h1><p class="center">Gradi ne peut pas enregistrer de données sur ce navigateur. Ouvrez-le avec Chrome (pas en navigation privée).</p></div>';
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
})();
