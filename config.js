/* Gradi - configuration et codes d'activation (partagé par l'app et admin.html)
 *
 * IMPORTANT AVANT LA MISE EN LIGNE :
 *  1. Changez SECRET par une longue phrase que vous seul connaissez.
 *  2. Mettez vos vrais numéros Mobile Money et votre numéro WhatsApp.
 */
const GRADI_CONFIG = {
  APP_NAME: 'Gradi',
  SLOGAN: 'Gérez votre boutique, récupérez vos dettes.',
  SECRET: 'CHANGEZ-MOI-par-une-longue-phrase-secrete-2026',
  PAY_NUMBERS: {
    'MTN Mobile Money': '06 XXX XXXX',
    'Airtel Money': '05 XXX XXXX'
  },
  PAY_NAME: 'Nom du titulaire du compte',
  SUPPORT_WHATSAPP: '242060000000', // numéro WhatsApp qui reçoit les preuves de paiement
  COUNTRY_CODE: '242',
  PRICES: { standard: 7500, pro: 15000 },
  FREE_PRODUCT_LIMIT: 30,
  TRIAL_DAYS: 30,
  OVERDUE_DAYS: 7,
  MONTH_DAYS: 30
};

async function sha256Hex(str) {
  if (globalThis.crypto && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Repli simple si le navigateur n'offre pas crypto.subtle
  let h1 = 5381, h2 = 52711;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = (h1 * 33) ^ c; h2 = (h2 * 33) ^ c;
  }
  return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')).repeat(4);
}

// On ne garde que les 8 derniers chiffres du téléphone (ignore indicatif et 0 initial)
function phoneKey(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-8);
}

async function activationSig(phone, plan, months, serial) {
  const h = await sha256Hex([GRADI_CONFIG.SECRET, phoneKey(phone), plan, String(months), serial].join('|'));
  return h.slice(0, 8).toUpperCase();
}

// plan : 'S' (Standard) ou 'P' (Pro) ; months : 1 à 12
async function makeActivationCode(phone, plan, months, serial) {
  serial = serial || String(Math.floor(1000 + Math.random() * 9000));
  const sig = await activationSig(phone, plan, months, serial);
  return plan + months + '-' + serial + '-' + sig;
}

async function verifyActivationCode(code, phone) {
  const m = /^([SP])(\d{1,2})-(\d{4})-([0-9A-F]{8})$/.exec(String(code || '').trim().toUpperCase().replace(/\s+/g, ''));
  if (!m) return null;
  const [, p, months, serial, sig] = m;
  const expected = await activationSig(phone, p, parseInt(months, 10), serial);
  if (expected !== sig) return null;
  return { plan: p === 'S' ? 'standard' : 'pro', months: parseInt(months, 10), serial, code: m[0] };
}

if (typeof module !== 'undefined') {
  module.exports = { GRADI_CONFIG, sha256Hex, phoneKey, makeActivationCode, verifyActivationCode };
}
