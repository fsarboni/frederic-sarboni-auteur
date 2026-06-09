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
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    }).on('error', reject).on('timeout', () => reject(new Error('Timeout'))).end();
  });
}

async function discoverAPI() {
  // Tester plusieurs endpoints pour trouver ce qui fonctionne
  const endpoints = [
    '/api/v0/stats/hits',
    '/api/v0/stats/hits?limit=10',
    '/api/v0/me',
    '/api/v0/stats/total',
  ];
  
  for (const ep of endpoints) {
    const r = await apiGet(ep);
    console.log(`\n🔍 ${ep} → ${r.status}`);
    console.log(JSON.stringify(r.body).substring(0, 300));
  }
}

async function main() {
  if (!TOKEN) { console.error('❌ GOATCOUNTER_TOKEN non défini'); process.exit(1); }
  if (!loadNouvelles()) { console.error('❌ Impossible de charger data.json'); process.exit(1); }
  console.log('📊 Découverte API GoatCounter...');
  await discoverAPI();
}

main();
