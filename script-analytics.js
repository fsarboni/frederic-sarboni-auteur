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

async function fetchStats() {
  const stats = {};
  Object.entries(NOUVELLES).forEach(([fichier, titre]) => {
    stats[titre] = { fichier, telecharges: 0, derniere_date: new Date().toISOString().split('T')[0] };
  });

  // Récupérer les hits pour les chemins /download/
  const result = await apiGet('/api/v0/stats/hits?limit=200');
  
  if (result && result.hits) {
    let found = 0;
    result.hits.forEach(hit => {
      if (hit.path && hit.path.includes('download/')) {
        const fichierPath = hit.path.replace(/.*download\//, '');
        for (const [fichierKey, titre] of Object.entries(NOUVELLES)) {
          const keyNorm = fichierKey.replace('.pdf', '').toLowerCase().replace(/_/g, '-');
          const pathNorm = fichierPath.toLowerCase().replace(/_/g, '-').replace(/%20/g, '-');
          if (pathNorm.includes(keyNorm) || keyNorm === pathNorm.replace('.pdf', '')) {
            stats[titre].telecharges = hit.count || 0;
            found++;
            break;
          }
        }
      }
    });
    console.log(`✅ ${found} nouvelles trouvées dans GoatCounter`);
  }

  return stats;
}

function saveStats(stats) {
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
  if (!TOKEN) {
    console.error('❌ GOATCOUNTER_TOKEN non défini');
    process.exit(1);
  }
  if (!loadNouvelles()) {
    console.error('❌ Impossible de charger data.json');
    process.exit(1);
  }
  console.log('📊 Récupération des stats GoatCounter via API...');
  try {
    const stats = await fetchStats();
    saveStats(stats);
    console.log('✅ Succès !');
  } catch (e) {
    console.error('❌ Erreur API :', e.message);
    process.exit(1);
  }
}

main();
