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

function apiRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'fsarboni.goatcounter.com',
      path: urlPath,
      method: method,
      headers: {
        'Authorization': 'Bearer ' + TOKEN,
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
      },
      timeout: 30000
    };
    const req = https.request(options, (res) => {
      let data = '';
      console.log(`📡 HTTP ${method} ${urlPath} → ${res.statusCode}`);
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => reject(new Error('Timeout')));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchAllDownloads() {
  const counts = {};

  // Démarrer un export
  console.log('📤 Démarrage export GoatCounter...');
  const startResp = await apiRequest('POST', '/api/v0/export', { start_from_hit_id: 0 });
  console.log('Export démarré:', JSON.stringify(startResp.body).substring(0, 200));

  if (startResp.status !== 202 || !startResp.body.id) {
    console.error('❌ Impossible de démarrer l\'export');
    return counts;
  }

  const exportId = startResp.body.id;
  console.log(`📦 Export ID: ${exportId}`);

  // Attendre que l'export soit prêt
  let ready = false;
  for (let i = 0; i < 20; i++) {
    await sleep(3000);
    const statusResp = await apiRequest('GET', `/api/v0/export/${exportId}`);
    console.log(`⏳ Statut export: ${JSON.stringify(statusResp.body).substring(0, 150)}`);
    if (statusResp.body.finished_at) {
      ready = true;
      break;
    }
  }

  if (!ready) {
    console.error('❌ Export trop long');
    return counts;
  }

  // Télécharger l'export
  console.log('📥 Téléchargement des données...');
  const dataResp = await apiRequest('GET', `/api/v0/export/${exportId}/download`);
  
  if (typeof dataResp.body === 'string') {
    // CSV ligne par ligne
    const lines = dataResp.body.split('\n');
    console.log(`📄 ${lines.length} lignes dans l'export`);
    lines.forEach(line => {
      if (line.includes('download/')) {
        // Format CSV : hit_id,path,title,event,bot,session,...
        const parts = line.split(',');
        if (parts.length >= 2) {
          const p = parts[1].replace(/"/g, '');
          const fichierPath = p.replace(/.*download\//, '');
          for (const [fichierKey, titre] of Object.entries(NOUVELLES)) {
            const keyNorm = fichierKey.replace('.pdf', '').toLowerCase().replace(/_/g, '-');
            const pathNorm = fichierPath.toLowerCase().replace('.pdf', '').replace(/_/g, '-').replace(/%20/g, '-');
            if (pathNorm === keyNorm || pathNorm.includes(keyNorm)) {
              counts[titre] = (counts[titre] || 0) + 1;
              break;
            }
          }
        }
      }
    });
  } else {
    console.log('Réponse export:', JSON.stringify(dataResp.body).substring(0, 300));
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
  console.log('📊 Récupération historique complet via export GoatCounter...');
  try {
    const counts = await fetchAllDownloads();
    const found = Object.keys(counts).length;
    console.log(`✅ ${found} nouvelles avec téléchargements`);
    saveStats(counts);
    console.log('✅ Succès !');
  } catch (e) {
    console.error('❌ Erreur:', e.message);
    process.exit(1);
  }
}

main();
