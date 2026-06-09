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
        catch (e) { reject(new Error('Réponse non-JSON : ' + data.substring(0, 200))); }
      });
    }).on('error', reject).on('timeout', () => reject(new Error('Timeout'))).end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchCountForPath(fichierName) {
  // Essayer différentes variantes du nom de fichier
  const variants = [
    fichierName,
    fichierName.replace('.pdf', ''),
  ];

  for (const variant of variants) {
    const encoded = encodeURIComponent('download/' + variant);
    try {
      const result = await apiGet(`/api/v0/stats/hits?start=2020-01-01&end=2030-12-31&path=${encoded}`);
      if (result && result.hits && result.hits.length > 0) {
        const total = result.hits.reduce((sum, h) => sum + (h.count || 0), 0);
        if (total > 0) return total;
      }
    } catch (e) {
      // continuer
    }
    await sleep(300); // respecter le rate limit
  }
  return 0;
}

async function fetchAllStats() {
  const counts = {};
  const fichiers = Object.keys(NOUVELLES);
  console.log(`🔍 Interrogation de ${fichiers.length} nouvelles...`);

  for (let i = 0; i < fichiers.length; i++) {
    const fichier = fichiers[i];
    const titre = NOUVELLES[fichier];
    const count = await fetchCountForPath(fichier);
    if (count > 0) {
      counts[titre] = count;
      console.log(`  ✅ ${titre}: ${count}`);
    }
    if (i % 10 === 9) console.log(`  ... ${i + 1}/${fichiers.length}`);
  }

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
  console.log('📊 Récupération historique complet GoatCounter...');
  try {
    const counts = await fetchAllStats();
    console.log(`✅ ${Object.keys(counts).length} nouvelles avec téléchargements`);
    saveStats(counts);
    console.log('✅ Succès !');
  } catch (e) {
    console.error('❌ Erreur:', e.message);
    process.exit(1);
  }
}

main();
