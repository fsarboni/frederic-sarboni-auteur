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

async function testDateParams() {
  const variants = [
    '/api/v0/stats/hits?limit=5',
    '/api/v0/stats/hits?limit=5&start=2025-10-17&end=2026-06-09',
    '/api/v0/stats/hits?limit=5&after=2025-10-17',
    '/api/v0/stats/hits?limit=5&daily=1',
    '/api/v0/stats/hits?limit=200&daily=1',
  ];
  
  for (const url of variants) {
    const r = await apiGet(url);
    const hitCount = r.hits ? r.hits.length : 0;
    const hasDownload = r.hits ? r.hits.filter(h => h.path && h.path.includes('download')).length : 0;
    console.log(`\n📡 ${url}`);
    console.log(`   → ${hitCount} hits, ${hasDownload} downloads, more=${r.more}`);
    if (r.error) console.log(`   → ERREUR: ${r.error}`);
    if (r.hits && r.hits[0]) console.log(`   → premier: path="${r.hits[0].path}" count=${r.hits[0].count}`);
  }
}

async function main() {
  if (!TOKEN) { console.error('❌ GOATCOUNTER_TOKEN non défini'); process.exit(1); }
  loadNouvelles();
  console.log('🔍 Test des paramètres de date...');
  await testDateParams();
}

main();
