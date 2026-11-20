/* Gradi - logique pure (sans écran), testable séparément */
const GradiLogic = (() => {
  const DAY = 86400000;

  function fmtNumber(n) {
    const v = Math.round(Number(n) || 0);
    const s = Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return (v < 0 ? '-' : '') + s;
  }
  const fmtFCFA = n => fmtNumber(n) + ' FCFA';

  function startOfDay(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function startOfMonth(t) { const d = new Date(t); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime(); }

  // Dette d'un client = ventes non payées moins paiements reçus
  function balanceFor(id, sales, payments) {
    let b = 0;
    for (const s of sales) if (s.customerId === id) b += s.total - s.paid;
    for (const p of payments) if (p.customerId === id) b -= p.amount;
    return b;
  }

  // Date de la plus ancienne vente encore impayée (paiements imputés sur les plus anciennes d'abord)
  function oldestUnpaidDate(id, sales, payments) {
    let pool = payments.filter(p => p.customerId === id).reduce((a, p) => a + p.amount, 0);
    const list = sales.filter(s => s.customerId === id && s.total > s.paid).sort((a, b) => a.date - b.date);
    for (const s of list) {
      let u = s.total - s.paid;
      const use = Math.min(u, pool);
      pool -= use; u -= use;
      if (u > 0) return s.date;
    }
    return null;
  }

  function planOf(account, now = Date.now(), freeLimit = 30) {
    const paidPlan = !!(account && account.plan && account.plan !== 'free');
    const active = paidPlan && account.planExpiry > now;
    const key = active ? account.plan : 'free';
    return {
      key,
      active,
      trial: active && !!account.trial,
      productLimit: key === 'free' ? freeLimit : Infinity,
      reminders: key !== 'free',
      detailedReports: key === 'pro',
      daysLeft: active ? Math.ceil((account.planExpiry - now) / DAY) : 0,
      expired: paidPlan && !active
    };
  }

  function waNumber(phone, cc = '242') {
    let d = String(phone || '').replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    if (!d) return '';
    if (d.startsWith(cc) && d.length >= cc.length + 8) return d;
    return cc + d;
  }
  function waLink(phone, text, cc) {
    return 'https://wa.me/' + waNumber(phone, cc) + '?text=' + encodeURIComponent(text);
  }
  function reminderText(shop, name, amount) {
    return 'Bonjour ' + name + ', c\'est ' + shop + '. Petit rappel : vous avez un solde de ' +
      fmtFCFA(amount).replace(/ /g, ' ') + '. Merci de passer régler quand vous pouvez. Bonne journée !';
  }

  function summarize(sales, expenses, now = Date.now()) {
    const d0 = startOfDay(now), m0 = startOfMonth(now);
    let today = 0, month = 0, margin = 0, count = 0;
    const prod = {};
    for (const s of sales) {
      if (s.date >= d0) today += s.total;
      if (s.date >= m0) {
        month += s.total; count++;
        for (const it of s.items) {
          const mg = (it.price - it.cost) * it.qty;
          margin += mg;
          const p = prod[it.productId] || (prod[it.productId] = { name: it.name, qty: 0, revenue: 0, margin: 0 });
          p.qty += it.qty; p.revenue += it.price * it.qty; p.margin += mg;
        }
      }
    }
    let expMonth = 0;
    for (const e of expenses) if (e.date >= m0) expMonth += e.amount;
    const list = Object.values(prod);
    return {
      today, month, count, expMonth, margin, profit: margin - expMonth,
      top: list.slice().sort((a, b) => b.qty - a.qty).slice(0, 5),
      byProduct: list.slice().sort((a, b) => b.revenue - a.revenue)
    };
  }

  function last7Days(sales, now = Date.now()) {
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const s = startOfDay(now - i * DAY), e = s + DAY;
      let total = 0, n = 0;
      for (const x of sales) if (x.date >= s && x.date < e) { total += x.total; n++; }
      out.push({ day: s, total, n });
    }
    return out;
  }

  function subscriptionPrice(plan, months, prices) {
    const base = prices[plan];
    return months >= 6 ? base * (months - Math.floor(months / 6)) : base * months;
  }

  return { DAY, fmtNumber, fmtFCFA, startOfDay, startOfMonth, balanceFor, oldestUnpaidDate, planOf,
    waNumber, waLink, reminderText, summarize, last7Days, subscriptionPrice };
})();

if (typeof module !== 'undefined') module.exports = GradiLogic;
