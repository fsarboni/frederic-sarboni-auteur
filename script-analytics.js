#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(process.cwd(), 'data.json');
const OUTPUT_FILE = path.join(process.cwd(), 'analytics', 'stats.json');
const TOKEN = process.env.GOATCOUNTER_TOKEN;

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

function apiGet(urlPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'fsarboni.goatcounter.com',
      path: urlPath,
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + TOKEN,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    };
    https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Non-JSON: ' + data.substring(0, 200))); }
      });
    }).on('error', reject).on('timeout', () => reject(new Error('Timeout'))).end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

async function fetchPeriod(start, end) {
  const url = `/api/v0/stats/hits?tz=UTC&limit=200&period-start=${start}&period-end=${end}`;
  try {
    const result = await apiGet(url);
    return result && result.hits ? result.hits : [];
  } catch(e) {
    return [];
  }
}

async function fetchAllDownloads() {
  const counts = {};
  
  // Générer toutes les semaines depuis oct 2025
  const startDate = '2025-10-17';
  const today = new Date().toISOString().split('T')[0];
  
  let weekStart = startDate;
  let weekCount = 0;
  
  while (weekStart <= today) {
    const weekEnd = addDays(weekStart, 6) <= today ? addDays(weekStart, 6) : today;
    const hits = await fetchPeriod(weekStart, weekEnd);
    
    hits.forEach(hit => {
      if (hit.path && hit.path.includes('download/')) {
        const fichierPath = hit.path.replace(/.*download\//, '');
        for (const [fichierKey, titre] of Object.entries(NOUVELLES)) {
          const keyNorm = fichierKey.replace('.pdf', '').toLowerCase().replace(/_/g, '-');
          const pathNorm = fichierPath.toLowerCase().replace('.pdf', '').replace(/_/g, '-').replace(/%20/g, '-');
          if (pathNorm === keyNorm || pathNorm.includes(keyNorm) || keyNorm.includes(pathNorm)) {
            counts[titre] = (counts[titre] || 0) + (hit.count || 0);
            break;
          }
        }
      }
    });
    
    weekCount++;
    if (weekCount % 5 === 0) console.log(`  ... semaine ${weekCount} (${weekStart})`);
    
    weekStart = addDays(weekStart, 7);
    await sleep(300);
  }
  
  console.log(`📅 ${weekCount} semaines interrogées`);
  return counts;
}

function saveStats(counts) {
  const stats = {};
  Object.entries(NOUVELLES).forEach(([fichier, titre]) => {
    stats[titre] = {
      fichier,
      telecharges: counts[titre] || 0,
      derniere_date: new Date().toISOString().split('T')[0]
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
        fichier: data.fichier
      })),
    totalNouvelles: Object.keys(stats).length
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`✅ Sauvegardé — Total: ${output.total} téléchargements, ${output.totalNouvelles} nouvelles`);
}

async function main() {
  if (!TOKEN) { console.error('❌ GOATCOUNTER_TOKEN non défini'); process.exit(1); }
  if (!loadNouvelles()) { console.error('❌ Impossible de charger data.json'); process.exit(1); }
  console.log('📊 Récupération historique complet (oct 2025 → aujourd\'hui)...');
  try {
    const counts = await fetchAllDownloads();
    console.log(`✅ ${Object.keys(counts).length} nouvelles avec téléchargements`);
    Object.entries(counts).forEach(([t, c]) => console.log(`   ${t}: ${c}`));
    saveStats(counts);
    console.log('✅ Succès !');
  } catch (e) {
    console.error('❌ Erreur:', e.message);
    process.exit(1);
  }
}

main();
