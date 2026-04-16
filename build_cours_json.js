#!/usr/bin/env node
/**
 * build_cours_json.js
 *
 * Convertit TOUS les PDF des dossiers Bloc2_RETM / Normes_Techniques /
 * Re╠üglementations_pro / Ventes_Internationales en un seul fichier
 * data/cours.json structur\u00e9 par bloc, utilisable par la plateforme
 * SANS jamais r\u00e9v\u00e9ler les sources ni distribuer les PDF.
 *
 * Usage : node build_cours_json.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Mapping dossier → bloc + libell\u00e9
// On d\u00e9tecte le dossier "R\u00e9glementations_pro" dynamiquement car son nom
// peut contenir des caract\u00e8res d\u00e9compos\u00e9s (MacOS \u2192 Windows).
function findReglDir() {
  try {
    var entries = fs.readdirSync(ROOT);
    for (var i = 0; i < entries.length; i++) {
      if (/^Re.*glementations_pro$/i.test(entries[i])) return entries[i];
    }
  } catch (e) {}
  return 'R\u00e9glementations_pro';
}

const FOLDERS = [
  { dir: findReglDir(),            bloc: 'bloc1', label: 'Droit & R\u00e9glementations' },
  { dir: 'Bloc2_RETM',             bloc: 'bloc2', label: 'RETM' },
  { dir: 'Normes_Techniques',      bloc: 'bloc3', label: 'Normes Techniques' },
  { dir: 'Ventes_Internationales', bloc: 'bloc4', label: 'Ventes Internationales' }
];

/**
 * Nettoie le texte extrait d'un PDF et retire toute m\u00e9tadonn\u00e9e sensible :
 *   - noms de fichiers .pdf
 *   - mentions "source :" / copyright / auteur
 *   - URLs et chemins de fichiers
 *   - num\u00e9ros de page et pieds de page
 */
/**
 * R\u00e9pare les noms issus d'un mauvais d\u00e9codage MacOS (NFD utf-8 lu comme CP850).
 * Ex : "Corrige\u2560\u00fc" \u2192 "Corrig\u00e9"
 */
function fixMacEncoding(s) {
  if (!s) return s;
  // Apr\u00e8s ╠ (U+2560), le byte CP850 correspond \u00e0 un combining char UTF-8
  const combMap = {
    '\u00C7': '\u0300', // grave
    '\u00FC': '\u0301', // acute
    '\u00E9': '\u0302', // circumflex
    '\u00E2': '\u0303', // tilde
    '\u00EA': '\u0308'  // diaeresis
  };
  const fixed = s.replace(/(\S)\u2560(.)/g, (m, prev, marker) => {
    const comb = combMap[marker];
    if (!comb) return m;
    return (prev + comb).normalize('NFC');
  });
  return fixed.normalize('NFC');
}

function sanitize(text) {
  if (!text) return '';
  let out = fixMacEncoding(String(text));
  out = out.replace(/\r\n/g, '\n');
  // Retirer les noms de fichiers PDF
  out = out.replace(/[\w\-_\.\/\\]+\.pdf/gi, '');
  // Retirer mentions de source
  out = out.replace(/^(source|r\u00e9f\u00e9rence|origine|auteur|copyright|\u00a9|cma|cci)\s*:?.*$/gim, '');
  // Retirer URLs
  out = out.replace(/https?:\/\/\S+/g, '');
  // Retirer chemins
  out = out.replace(/[A-Z]:\\[^\s]+/g, '');
  // Retirer num\u00e9ros de page "Page 1/12"
  out = out.replace(/Page\s+\d+\s*\/\s*\d+/gi, '');
  // Retirer marques CAP3T5_... (r\u00e9f\u00e9rences internes)
  out = out.replace(/CAP3T5_[\w\-_\.]+/g, '');

  // ── Retirer noms d'entreprises privées (risque juridique) ──
  out = out.replace(/Groupe\s*Promotrans\s*[–\-—]\s*Direction\s*de\s*la\s*P[ée]dagogie/gi, '');
  out = out.replace(/Groupe\s*Promotrans/gi, '');
  out = out.replace(/PROMOTRANS/gi, '');
  out = out.replace(/Promotrans/gi, '');
  out = out.replace(/Direction\s*de\s*la\s*P[ée]dagogie/gi, '');
  out = out.replace(/TOUTE\s*REPRODUCTION\s*INTERDITE\s*SANS\s*AUTORISATION\s*[ÉE]CRITE\s*PR[ÉE]ALABLE\s*DU\s*GROUPE\s*\w*/gi, '');
  // Retirer lignes "ATTESTATION DE CAPACITÉ MARCHANDISE..." (headers répétitifs)
  out = out.replace(/^ATTESTATION DE CAPACITÉ MARCHANDISE.*$/gim, '');
  out = out.replace(/^Attestation de capacité marchandises.*$/gim, '');
  out = out.replace(/^MATIERE$/gim, '');
  // Retirer descriptions d'images auto-générées
  out = out.replace(/^Une image contenant.*$/gim, '');
  out = out.replace(/^Description générée automatiquement.*$/gim, '');
  out = out.replace(/^Smartphone avec un remplissage.*$/gim, '');
  out = out.replace(/^Flashez-moi.*$/gim, '');
  out = out.replace(/^cliquez ici.*$/gim, '');
  // Retirer numéros de page isolés
  out = out.replace(/^\d{1,3}$/gm, '');

  // Compacter lignes vides
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

/**
 * D\u00e9termine si c'est un exercice (Exo, Exos, Cas, Sujet, Corrig\u00e9) ou un cours
 */
function detectType(filename) {
  if (/_?(Exo|Exos|Cas|Sujet|Corrig)/i.test(filename)) return 'exercice';
  if (/Synth/i.test(filename)) return 'synthese';
  if (/Annexe/i.test(filename)) return 'annexe';
  return 'cours';
}

/**
 * D\u00e9rive un titre lisible depuis le nom de fichier sans r\u00e9v\u00e9ler la source
 */
function deriveTitle(filename) {
  // R\u00e9parer l'encodage MacOS puis normaliser
  let base = fixMacEncoding(filename).replace(/\.pdf$/i, '');
  // Retirer le pr\u00e9fixe CAP3T5_ et le code UF
  base = base.replace(/^CAP3T5_?/, '');
  base = base.replace(/^(UF\d+\.\d+_)?/, '');
  base = base.replace(/^(RP\d+_|NT_|VIM_)/, '');
  // Retirer les num\u00e9ros de section au d\u00e9but (1-1_, 1.1_)
  base = base.replace(/^[\d\-_\.]+_?/, '');
  // Retirer les suffixes _Exo, _Exos, _Cas, _Sujet, _Synth\u00e8se, _Annexe
  base = base.replace(/_(Exos?|Cas|Sujet|Corrig\u00e9?|Synth\u00e8se|Annexe\d*|Exo\-corrig\u00e9?)$/i, '');
  // Replace _ par espace, enlever accents d\u00e9cod\u00e9s
  base = base.replace(/[_\-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!base) base = 'Fiche';
  // Capitaliser
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/**
 * D\u00e9coupe un texte en sections d'apr\u00e8s des d\u00e9tections simples de titres
 * (lignes enti\u00e8rement en majuscules ou commen\u00e7ant par num\u00e9ro).
 */
function extractSections(text) {
  const lines = text.split(/\n/);
  const sections = [];
  let current = { heading: null, content: '' };

  function isHeading(line) {
    const l = line.trim();
    if (!l || l.length > 120) return false;
    // Titres tout en majuscules
    if (/^[A-Z0-9\u00c0-\u017f\s'\-]{4,}$/.test(l) && l === l.toUpperCase()) return true;
    // Titres num\u00e9rot\u00e9s type "1.", "1.1", "I -", "CHAPITRE"
    if (/^(\d+[\.)]\s|\d+\.\d+\s|I{1,3}\s*[-\u2013]\s|CHAPITRE|PARTIE|SECTION)/i.test(l)) return true;
    return false;
  }

  for (const raw of lines) {
    const l = raw.trim();
    if (isHeading(l)) {
      if (current.heading || current.content.trim()) sections.push(current);
      current = { heading: l, content: '' };
    } else {
      current.content += raw + '\n';
    }
  }
  if (current.heading || current.content.trim()) sections.push(current);

  return sections
    .map(s => ({ heading: s.heading, content: s.content.trim() }))
    .filter(s => s.content || s.heading);
}

/**
 * Custom page renderer that preserves spaces between text items.
 * pdf-parse's default renderer loses spaces on many PDFs.
 */
function customPageRender(pageData) {
  return pageData.getTextContent({
    normalizeWhitespace: false,
    disableCombineTextItems: false
  }).then(function(textContent) {
    let lastY = null;
    let text = '';
    for (const item of textContent.items) {
      if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) {
        text += '\n';
      } else if (lastY !== null && text.length > 0 && !text.endsWith(' ') && !text.endsWith('\n')) {
        text += ' ';
      }
      text += item.str;
      lastY = item.transform[5];
    }
    return text;
  });
}

async function processPdf(filePath, bloc, label) {
  const filename = path.basename(filePath);
  try {
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer, { pagerender: customPageRender });
    const raw = data.text || '';
    const clean = sanitize(raw);
    const sections = extractSections(clean);
    return {
      id: filename.replace(/\.pdf$/i, '').replace(/[^\w\-]/g, '_'),
      bloc: bloc,
      bloc_label: label,
      title: deriveTitle(filename),
      type: detectType(filename),
      sections: sections,
      content: clean,
      word_count: clean.split(/\s+/).length
    };
  } catch (err) {
    console.warn('[WARN] \u00c9chec extraction ' + filename + ' : ' + err.message);
    return null;
  }
}

function listPdfs(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === '__MACOSX') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push.apply(out, listPdfs(full));
    else if (/\.pdf$/i.test(e.name)) out.push(full);
  }
  return out;
}

(async function main() {
  console.log('=== Construction de data/cours.json ===');
  const result = { bloc1: [], bloc2: [], bloc3: [], bloc4: [] };
  const seen = new Set();

  for (const f of FOLDERS) {
    const folder = path.join(ROOT, f.dir);
    if (!fs.existsSync(folder)) {
      console.log('[SKIP] Dossier introuvable : ' + f.dir);
      continue;
    }
    const files = listPdfs(folder);
    console.log('[' + f.dir + '] ' + files.length + ' PDF trouv\u00e9(s)');

    for (const pdf of files) {
      if (seen.has(pdf)) continue;
      seen.add(pdf);
      const item = await processPdf(pdf, f.bloc, f.label);
      if (item) {
        result[f.bloc].push(item);
        console.log('  \u2713 ' + item.title + '  [' + item.type + ']');
      }
    }
  }

  const out = path.join(DATA_DIR, 'cours.json');
  fs.writeFileSync(out, JSON.stringify(result, null, 2), 'utf-8');
  const total = result.bloc1.length + result.bloc2.length + result.bloc3.length + result.bloc4.length;
  console.log('\n=== Termin\u00e9 === ' + total + ' cours/exercices \u00e9crits dans data/cours.json');
  console.log('  Bloc 1 : ' + result.bloc1.length);
  console.log('  Bloc 2 : ' + result.bloc2.length);
  console.log('  Bloc 3 : ' + result.bloc3.length);
  console.log('  Bloc 4 : ' + result.bloc4.length);
})().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
