#!/usr/bin/env node

/**
 * Script d'extraction des statistiques GoatCounter
 * S'exécute automatiquement chaque jour via GitHub Actions
 * 
 * Récupère DYNAMIQUEMENT toutes les nouvelles depuis data.json
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, '..', 'analytics', 'stats.json');
const DATA_FILE = path.join(__dirname, '..', 'data.json');

// Charger dynamiquement toutes les nouvelles depuis data.json
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

function fetchGoatCounter() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'fsarboni.goatcounter.com',
      path: '/',
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    };

    https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const stats = parseGoatCounterHTML(data);
          resolve(stats);
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', (error) => {
      reject(error);
    }).end();
  });
}

function parseGoatCounterHTML(html) {
  const stats = {};
  const now = new Date();

  // Initialiser toutes les nouvelles avec 0
  Object.keys(NOUVELLES).forEach(fichier => {
    stats[NOUVELLES[fichier]] = {
      fichier: fichier,
      telecharges: 0,
      dernièreMiseAJour: now.toISOString().split('T')[0]
    };
  });

  // Expression régulière pour trouver les entrées /download/
  // Cherche le pattern: /download/FICHIER ... NOMBRE
  const downloadPattern = /\/download\/([^\s<>"]+)[\s\S]*?(\d+)\s+(?:views|events|hits|téléchargements|downloads)/gi;
  
  let match;
  let found = 0;

  while ((match = downloadPattern.exec(html)) !== null) {
    const fichier = match[1];
    const count = parseInt(match[2], 10);

    // Chercher la nouvelle correspondante
    for (const [fichierKey, titre] of Object.entries(NOUVELLES)) {
      if (fichier.includes(fichierKey.replace('.pdf', '')) || 
          fichierKey.replace('.pdf', '') === fichier.replace(/%20/g, '_').replace(/-/g, '_')) {
        stats[titre].telecharges = count;
        stats[titre].dernièreMiseAJour = now.toISOString().split('T')[0];
        found++;
        break;
      }
    }
  }

  console.log(`✅ ${found} nouvelles trouvées dans GoatCounter`);
  return stats;
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
      }))
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`✅ Statistiques sauvegardées dans ${OUTPUT_FILE}`);
  console.log(`   Total: ${output.total} téléchargements`);
  console.log(`   Nouvelles avec données: ${output.classement.filter(c => c.telecharges > 0).length}`);
  console.log(`   Dernière mise à jour: ${output.dernièreMiseAJour}`);
}

// Exécuter
if (!loadNouvelles()) {
  console.error('❌ Impossible de charger les nouvelles depuis data.json');
  process.exit(1);
}

fetchGoatCounter()
  .then(stats => {
    saveStats(stats);
    console.log('✅ Succès !');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Erreur:', error.message);
    
    // Si ça échoue, on crée un fichier avec les nouvelles (mais sans données GoatCounter)
    console.log('⚠️ Création d\'un fichier vide par défaut...');
    const defaultStats = {};
    Object.keys(NOUVELLES).forEach(fichier => {
      defaultStats[NOUVELLES[fichier]] = {
        fichier: fichier,
        telecharges: 0,
        dernièreMiseAJour: new Date().toISOString().split('T')[0]
      };
    });
    
    const dir = path.dirname(OUTPUT_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    const output = {
      dernièreMiseAJour: new Date().toISOString(),
      total: 0,
      nouvelles: defaultStats,
      classement: []
    };
    
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    console.log(`✅ Fichier par défaut créé avec ${Object.keys(NOUVELLES).length} nouvelles`);
    process.exit(0);
  });
