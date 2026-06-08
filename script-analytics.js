#!/usr/bin/env node

/**
 * Script d'extraction HISTORIQUE complet des statistiques GoatCounter
 * Récupère TOUS les téléchargements depuis le début
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, '..', 'analytics', 'stats.json');
const DATA_FILE = path.join(__dirname, '..', 'data.json');
const HISTORY_FILE = path.join(__dirname, '..', 'analytics', 'history.json');

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

console.log('📊 Récupération de l\'historique complet GoatCounter...');

function fetchGoatCounterPage() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'fsarboni.goatcounter.com',
      path: '/',
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    };

    https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        resolve(data);
      });
    }).on('error', (error) => {
      reject(error);
    }).end();
  });
}

function parseHistoryFromHTML(html) {
  const stats = {};
  const history = {};
  const now = new Date();

  // Initialiser toutes les nouvelles
  Object.keys(NOUVELLES).forEach(fichier => {
    stats[NOUVELLES[fichier]] = {
      fichier: fichier,
      telecharges: 0,
      premiere_date: null,
      derniere_date: now.toISOString().split('T')[0]
    };
    history[NOUVELLES[fichier]] = [];
  });

  // Regex pour extraire les données /download/
  // Cherche le pattern avec dates et nombres
  const downloadPattern = /\/download\/([^\s<>"]+)[\s\S]*?(\d+)\s+(?:views|events|hits|téléchargements|downloads)/gi;
  
  let match;
  let totalFound = 0;

  while ((match = downloadPattern.exec(html)) !== null) {
    const fichier = match[1];
    const count = parseInt(match[2], 10);

    // Trouver la nouvelle correspondante
    for (const [fichierKey, titre] of Object.entries(NOUVELLES)) {
      if (fichier.includes(fichierKey.replace('.pdf', '')) || 
          fichierKey.replace('.pdf', '') === fichier.replace(/%20/g, '_').replace(/-/g, '_')) {
        
        stats[titre].telecharges = count;
        
        // Enregistrer dans l'historique
        const dateEntry = {
          date: now.toISOString().split('T')[0],
          telecharges: count
        };
        
        // Éviter les doublons
        if (!history[titre].find(h => h.date === dateEntry.date)) {
          history[titre].push(dateEntry);
        }
        
        if (!stats[titre].premiere_date) {
          stats[titre].premiere_date = dateEntry.date;
        }
        
        stats[titre].derniere_date = dateEntry.date;
        totalFound++;
        break;
      }
    }
  }

  console.log(`✅ ${totalFound} nouvelles trouvées`);

  return { stats, history };
}

function loadExistingHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    }
  } catch (error) {
    console.warn('⚠️ Impossible de charger l\'historique:', error.message);
  }
  return {};
}

function mergeHistories(newHistory, existingHistory) {
  const merged = { ...existingHistory };

  Object.keys(newHistory).forEach(titre => {
    if (!merged[titre]) {
      merged[titre] = [];
    }

    newHistory[titre].forEach(newEntry => {
      // Vérifier si la date existe déjà
      const exists = merged[titre].find(h => h.date === newEntry.date);
      if (!exists) {
        merged[titre].push(newEntry);
      } else {
        // Mettre à jour si le nombre a changé
        const existing = merged[titre].find(h => h.date === newEntry.date);
        if (existing.telecharges !== newEntry.telecharges) {
          existing.telecharges = newEntry.telecharges;
        }
      }
    });

    // Trier par date
    merged[titre].sort((a, b) => new Date(a.date) - new Date(b.date));
  });

  return merged;
}

function saveStats(stats, history) {
  // Créer le dossier s'il n'existe pas
  const dir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Préparer les données actuelles
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

  // Sauvegarder les données actuelles
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`✅ Statistiques sauvegardées dans ${OUTPUT_FILE}`);

  // Sauvegarder l'historique
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  console.log(`✅ Historique sauvegardé dans ${HISTORY_FILE}`);

  console.log(`   Total actuel: ${output.total} téléchargements`);
  console.log(`   Nouvelles: ${output.totalNouvelles}`);
  console.log(`   Dernière mise à jour: ${output.dernièreMiseAJour}`);
}

// Exécuter
if (!loadNouvelles()) {
  console.error('❌ Impossible de charger les nouvelles depuis data.json');
  process.exit(1);
}

console.log('🔍 Récupération de la page GoatCounter...');

fetchGoatCounterPage()
  .then(html => {
    console.log('📊 Analyse de la page...');
    const { stats, history } = parseHistoryFromHTML(html);
    
    // Fusionner avec l'historique existant
    console.log('🔄 Fusion avec l\'historique existant...');
    const existingHistory = loadExistingHistory();
    const mergedHistory = mergeHistories(history, existingHistory);
    
    saveStats(stats, mergedHistory);
    console.log('✅ Succès !');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Erreur:', error.message);
    
    // Créer un fichier par défaut en cas d'erreur
    console.log('⚠️ Création d\'un fichier par défaut...');
    const defaultStats = {};
    Object.keys(NOUVELLES).forEach(fichier => {
      defaultStats[NOUVELLES[fichier]] = {
        fichier: fichier,
        telecharges: 0,
        premiere_date: null,
        derniere_date: new Date().toISOString().split('T')[0]
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
      classement: [],
      totalNouvelles: Object.keys(NOUVELLES).length
    };
    
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({}, null, 2));
    
    console.log(`✅ Fichier par défaut créé avec ${Object.keys(NOUVELLES).length} nouvelles`);
    process.exit(0);
  });
