#!/usr/bin/env node

/**
 * Script d'extraction des statistiques GoatCounter
 * S'exécute automatiquement chaque jour via GitHub Actions
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const SITE = 'fsarboni';
const OUTPUT_FILE = path.join(__dirname, '..', 'analytics', 'stats.json');

// Données des nouvelles
const NOUVELLES = {
  'Le_Dernier_Rendez-vous.pdf': 'Le Dernier Rendez-vous',
  'Celle_qui_savait_lire.pdf': 'Celle qui savait lire',
  'Le_Dernier_Sourire.pdf': 'Le Dernier Sourire',
  'Le_Choix_du_Programmeur.pdf': 'Le Choix du Programmeur',
  'Le_Gardien_des_Songes.pdf': 'Le Gardien des Songes',
  'A_la_carte.pdf': 'À la carte'
};

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

  // Expression régulière pour trouver les entrées /download/
  const regex = /\/download\/([a-zA-Z0-9_-]+\.pdf)[\s\S]*?(\d+)\s+(?:views|events|hits)/gi;
  let match;

  // Initialiser toutes les nouvelles avec 0
  Object.keys(NOUVELLES).forEach(fichier => {
    stats[NOUVELLES[fichier]] = {
      fichier: fichier,
      telecharges: 0,
      dernièreMiseAJour: now.toISOString().split('T')[0]
    };
  });

  // Parser les données trouvées
  while ((match = regex.exec(html)) !== null) {
    const fichier = match[1].replace(/-/g, '_');
    const count = parseInt(match[2], 10);

    if (NOUVELLES[fichier]) {
      stats[NOUVELLES[fichier]].telecharges = count;
      stats[NOUVELLES[fichier]].dernièreMiseAJour = now.toISOString().split('T')[0];
    }
  }

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
  console.log(`   Dernière mise à jour: ${output.dernièreMiseAJour}`);
}

// Exécuter
fetchGoatCounter()
  .then(stats => {
    saveStats(stats);
    console.log('✅ Succès !');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Erreur:', error.message);
    
    // Si ça échoue, on crée un fichier vide
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
    console.log('✅ Fichier par défaut créé');
    process.exit(0);
  });
