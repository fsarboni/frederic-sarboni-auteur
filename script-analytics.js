#!/usr/bin/env node

/**
 * Script d'extraction des statistiques GoatCounter
 * Version corrigée et simplifiée
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// CHEMINS CORRECTS (à la racine)
const DATA_FILE = path.join(__dirname, 'data.json');
const OUTPUT_FILE = path.join(__dirname, 'analytics', 'stats.json');
const HISTORY_FILE = path.join(__dirname, 'analytics', 'history.json');

let NOUVELLES = {};

function loadNouvelles() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (data.nouvelles_gratuites && Array.isArray(data.nouvelles_gratuites)) {
        data.nouvelles_gratuites.forEach(nouvelle => {
          if (nouvelle.fichier) {
            const fichier = nouvelle.fichier.split('/').pop();
            NOUVELLES[fichier] = nouvelle.titre;
          }
        });
        console.log(`✅ ${Object.keys(NOUVELLES).length} nouvelles chargées depuis data.json`);
        return true;
      }
    }
  } catch (error) {
    console.warn('⚠️ Impossible de charger data.json:', error.message);
  }
  return false;
}

console.log('📊 Récupération des statistiques GoatCounter...');

function fetchGoatCounterPage() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'fsarboni.goatcounter.com',
      path: '/',
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0'
      },
      timeout: 10000
    };

    https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => { resolve(data); });
    }).on('error', (error) => {
      reject(error);
    }).on('timeout', () => {
      reject(new Error('Timeout'));
    }).end();
  });
}

function parseGoatCounterData(html) {
  const stats = {};
  const now = new Date();

  // Initialiser toutes les nouvelles
  Object.keys(NOUVELLES).forEach(fichier => {
    stats[NOUVELLES[fichier]] = {
      fichier: fichier,
      telecharges: 0,
      derniere_date: now.toISOString().split('T')[0]
    };
  });

  // Chercher les entrées /download/
  const downloadRegex = /\/download\/([^\s<>"]+)[\s\S]*?(\d+)\s+(?:views|events|hits|téléchargements)/gi;
  let match;
  let found = 0;

  while ((match = downloadRegex.exec(html)) !== null) {
    const fichier = match[1];
    const count = parseInt(match[2], 10);

    // Trouver la nouvelle correspondante
    for (const [fichierKey, titre] of Object.entries(NOUVELLES)) {
      if (fichier.includes(fichierKey.replace('.pdf', '')) || 
          fichierKey.replace('.pdf', '') === fichier.replace(/%20/g, '_').replace(/-/g, '_')) {
        stats[titre].telecharges = count;
        stats[titre].derniere_date = now.toISOString().split('T')[0];
        found++;
        break;
      }
    }
  }

  console.log(`✅ ${found} nouvelles trouvées dans GoatCounter`);
  return stats;
}

function loadExistingHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    }
  } catch (error) {
    console.warn('⚠️ Impossible de charger l\'historique');
  }
  return {};
}

function saveStats(stats) {
  // Créer le dossier s'il n'existe pas
  const dir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Préparer les données
  const output = {
    dernièreMiseAJour: new Date().toISOString(),
    total: Object.values(stats).reduce((sum, s) => sum + s.telecharges, 0),
    nouvelles: stats,
    classement: Object.entries(stats)
      .sort((a, b) => b[1].telecharges - a[1].telecharges)
      .map(([titre, data], index) => ({
        position: index + 1,
        titre: titre,
        telecharges: data.telecharges,
        fichier: data.fichier
      })),
    totalNouvelles: Object.keys(stats).length
  };

  // Sauvegarder
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`✅ Statistiques sauvegardées`);
  console.log(`   Total: ${output.total} téléchargements`);
  console.log(`   Nouvelles: ${output.totalNouvelles}`);
  console.log(`   Dernière mise à jour: ${output.dernièreMiseAJour}`);
}

// EXÉCUTION
if (!loadNouvelles()) {
  console.error('❌ Impossible de charger les nouvelles depuis data.json');
  process.exit(1);
}

fetchGoatCounterPage()
  .then(html => {
    console.log('📊 Analyse des données...');
    const stats = parseGoatCounterData(html);
    saveStats(stats);
    console.log('✅ Succès !');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Erreur:', error.message);
    
    // Créer un fichier par défaut
    console.log('⚠️ Création d\'un fichier par défaut...');
    const defaultStats = {};
    Object.keys(NOUVELLES).forEach(fichier => {
      defaultStats[NOUVELLES[fichier]] = {
        fichier: fichier,
        telecharges: 0,
        derniere_date: new Date().toISOString().split('T')[0]
      };
    });
    
    const output = {
      dernièreMiseAJour: new Date().toISOString(),
      total: 0,
      nouvelles: defaultStats,
      classement: [],
      totalNouvelles: Object.keys(NOUVELLES).length
    };
    
    const dir = path.dirname(OUTPUT_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    console.log('✅ Fichier par défaut créé');
    process.exit(0);
  });
