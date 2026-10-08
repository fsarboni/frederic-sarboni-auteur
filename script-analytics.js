#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(process.cwd(), 'data.json');
const OUTPUT_FILE = path.join(process.cwd(), 'analytics', 'stats.json');
const TOKEN = process.env.GOATCOUNTER_TOKEN;

// Nombre d'essais par appel GoatCounter, et attente entre deux essais (ms)
const MAX_ESSAIS = 5;
const ATTENTES = [3000, 8000, 15000, 30000];

let NOUVELLES = {};

function loadNouvelles() {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (data.nouvelles_gratuites && Array.isArray(data.nouvelles_gratuites)) {
      data.nouvelles_gratuites.forEach(n => {
        if (n.fichier) {
          const fichier = n.fichier.split('/').pop();
          NOUVELLES[fichier] = n.titre;
        }
      });
      console.log(`✅ ${Object.keys(NOUVELLES).length} nouvelles chargées`);
      return true;
    }
  } catch (e) {
    console.error('❌ Erreur lecture data.json :', e.message);
  }
  return false;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Un seul appel, sans relance
function apiGetOnce(urlPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'fsarboni.goatcounter.com',
      path: urlPath,
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + TOKEN,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('Timeout')); });
    req.end();
  });
}

// Appel avec relances : coupure réseau, lenteur, limite de débit (429) ou panne serveur (5xx)
async function apiGet(urlPath) {
  let derniereErreur = null;
  for (let essai = 1; essai <= MAX_ESSAIS; essai++) {
    try {
      const result = await apiGetOnce(urlPath);
      // 404 persistant : on rend la réponse, fetchPeriod sautera ce mois
      if (result.status === 404 && essai === MAX_ESSAIS) return result;
      if (result.status === 404 || result.status === 429 || result.status >= 500) {
        derniereErreur = new Error(`HTTP ${result.status}${detail(result.body)}`);
      } else {
        return result;
      }
    } catch (e) {
      derniereErreur = e;
    }
    if (essai < MAX_ESSAIS) {
      const attente = ATTENTES[essai - 1];
      console.log(`   ↻ ${derniereErreur.message} — nouvel essai dans ${attente / 1000} s (${essai + 1}/${MAX_ESSAIS})`);
      await sleep(attente);
    }
  }
  throw new Error(`GoatCounter injoignable après ${MAX_ESSAIS} essais (${derniereErreur.message})`);
}

// Message d'erreur renvoyé par GoatCounter, pour comprendre ce qui coince
function detail(body) {
  if (!body) return '';
  if (typeof body === 'string') return ' — ' + body.slice(0, 200).replace(/\s+/g, ' ');
  if (body.error) return ' — ' + body.error;
  if (body.errors) return ' — ' + JSON.stringify(body.errors).slice(0, 200);
  return '';
}

function addMonths(dateStr, months) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split('T')[0];
}

function matchTitre(fichierPath) {
  const pathNorm = fichierPath.toLowerCase().replace('.pdf','').replace(/_/g,'-').replace(/%20/g,'-');
  for (const [fichierKey, titre] of Object.entries(NOUVELLES)) {
    const keyNorm = fichierKey.replace('.pdf','').toLowerCase().replace(/_/g,'-');
    if (pathNorm === keyNorm || pathNorm.includes(keyNorm) || keyNorm.includes(pathNorm)) {
      return titre;
    }
  }
  return null;
}

async function fetchPeriod(start, end) {
  // counts : { titre -> total }
  // history : { titre -> { 'YYYY-MM-DD' -> count } }
  const counts = {};
  const history = {};
  let afterId = '';
  let pages = 0;

  while (pages < 20) {
    let url = `/api/v0/stats/hits?limit=200&start=${start}&end=${end}`;
    if (afterId) url += `&after=${afterId}`;

    const result = await apiGet(url);

    // Mois refusé par GoatCounter : on le saute et on le signale.
    // Le garde-fou de saveStats empêche ensuite d'enregistrer des chiffres en baisse.
    if (result.status !== 200) {
      console.log(`   ⚠️ Mois ignoré : HTTP ${result.status}${detail(result.body)}`);
      return { counts, history, ignore: true };
    }
    if (!result.body.hits || result.body.hits.length === 0) break;

    result.body.hits.forEach(hit => {
      if (!hit.path || !hit.path.includes('download/')) return;
      const fichierPath = hit.path.replace(/.*download\//, '');
      const titre = matchTitre(fichierPath);
      if (!titre) return;

      // total
      counts[titre] = (counts[titre] || 0) + (hit.count || 0);

      // détail journalier depuis hit.stats
      if (hit.stats && Array.isArray(hit.stats)) {
        if (!history[titre]) history[titre] = {};
        hit.stats.forEach(s => {
          if (!s.day) return;
          const day = s.day.split('T')[0];
          const dayCount = s.daily || 0;
          if (dayCount > 0) {
            history[titre][day] = (history[titre][day] || 0) + dayCount;
          }
        });
      }
    });

    if (!result.body.more) break;
    afterId = result.body.hits[result.body.hits.length - 1].path_id;
    pages++;
    await sleep(1000);
  }

  return { counts, history };
}

async function fetchAllDownloads() {
  const totalCounts = {};
  const totalHistory = {};
  const startDate = '2025-10-17';
  const today = new Date().toISOString().split('T')[0];

  let monthStart = startDate;
  let monthIndex = 0;
  let moisIgnores = 0;

  while (monthStart < today) {
    let monthEnd = addMonths(monthStart, 1);
    if (monthEnd > today) monthEnd = today;

    console.log(`📅 Période ${monthStart} → ${monthEnd}`);
    const { counts, history, ignore } = await fetchPeriod(monthStart, monthEnd);
    if (ignore) moisIgnores++;

    Object.entries(counts).forEach(([titre, count]) => {
      totalCounts[titre] = (totalCounts[titre] || 0) + count;
    });

    Object.entries(history).forEach(([titre, days]) => {
      if (!totalHistory[titre]) totalHistory[titre] = {};
      Object.entries(days).forEach(([day, count]) => {
        totalHistory[titre][day] = (totalHistory[titre][day] || 0) + count;
      });
    });

    monthIndex++;
    monthStart = monthEnd;
    await sleep(1500);
    // Garde-fou : 10 ans d'historique
    if (monthIndex > 120) break;
  }

  if (moisIgnores > 0) console.log(`⚠️ ${moisIgnores} mois ignoré(s) sur ${monthIndex}`);
  if (moisIgnores === monthIndex) throw new Error('GoatCounter a refusé toutes les périodes');
  return { totalCounts, totalHistory };
}

// Les téléchargements cumulés ne peuvent pas baisser.
// Si le nouveau total est inférieur à l'ancien, des données manquent : on garde l'ancien fichier.
function totalPrecedent() {
  try { return JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')).total || 0; }
  catch (e) { return 0; }
}

function saveStats(counts, history) {
  const stats = {};
  Object.entries(NOUVELLES).forEach(([fichier, titre]) => {
    // Construire la liste triée des jours avec téléchargements
    const joursBruts = history[titre] || {};
    const jours = Object.entries(joursBruts)
      .filter(([, c]) => c > 0)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, count]) => ({ date: day, count }));

    const dernierJour = jours.length > 0 ? jours[jours.length - 1].date : null;

    stats[titre] = {
      fichier,
      telecharges: counts[titre] || 0,
      derniere_date: dernierJour || new Date().toISOString().split('T')[0],
      historique: jours
    };
  });

  const dir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const output = {
    dernièreMiseAJour: new Date().toISOString(),
    total: Object.values(stats).reduce((sum, s) => sum + s.telecharges, 0),
    nouvelles: stats,
    classement: Object.entries(stats)
      .sort((a, b) => b[1].telecharges - a[1].telecharges)
      .map(([titre, data], index) => ({
        position: index + 1,
        titre,
        telecharges: data.telecharges,
        fichier: data.fichier,
        derniere_date: data.derniere_date,
        historique: data.historique
      })),
    totalNouvelles: Object.keys(stats).length
  };

  const ancien = totalPrecedent();
  if (output.total < ancien) {
    console.log(`⚠️ Total incomplet (${output.total} au lieu d'au moins ${ancien}) — stats.json conservé tel quel`);
    return;
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`✅ Sauvegardé — Total: ${output.total} téléchargements, ${output.totalNouvelles} nouvelles`);
}

async function main() {
  if (!TOKEN) { console.error('❌ GOATCOUNTER_TOKEN non défini'); process.exit(1); }
  if (!loadNouvelles()) { console.error('❌ Impossible de charger data.json'); process.exit(1); }
  console.log('📊 Récupération historique complet GoatCounter (par mois)...');
  try {
    const { totalCounts, totalHistory } = await fetchAllDownloads();
    console.log(`✅ ${Object.keys(totalCounts).length} nouvelles avec téléchargements`);
    Object.entries(totalCounts).sort((a,b) => b[1]-a[1]).forEach(([t, c]) => console.log(`   ${c} - ${t}`));
    saveStats(totalCounts, totalHistory);
    console.log('✅ Succès !');
  } catch (e) {
    console.error('❌ Erreur:', e.message);
    process.exit(1);
  }
}

main();
