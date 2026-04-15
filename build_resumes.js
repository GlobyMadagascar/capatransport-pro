/**
 * build_resumes.js
 * ----------------
 * Génère data/resumes.json : pour chaque bloc, un cours résumé orienté examen
 * basé sur les thèmes qui tombent le plus souvent dans les annales.
 *
 * Usage : node build_resumes.js [bloc1|bloc2|bloc3|bloc4|all]
 *   - sans argument ou "all" : régénère tous les blocs
 *   - "blocN" : régénère uniquement ce bloc
 *
 * Coût estimé : ~0,40 €/bloc avec Sonnet, ~1,60 € pour les 4.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ override: true });
const Anthropic = require('@anthropic-ai/sdk').default;

const DATA_DIR = path.join(__dirname, 'data');
const ANNALES_FILE = path.join(DATA_DIR, 'all_annales.json');
const COURS_FILE = path.join(DATA_DIR, 'cours.json');
const OUTPUT_FILE = path.join(DATA_DIR, 'resumes.json');

const MODEL = process.env.RESUME_MODEL || 'claude-sonnet-4-5-20250929';
const MAX_TOKENS_OUT = 16000;

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY manquante dans .env');
  process.exit(1);
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ---------- Helpers ----------

function loadJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Filet de sécurité Markdown -> plain text (mêmes règles que server.js stripMarkdown)
 */
function stripMarkdown(text) {
  if (!text || typeof text !== 'string') return text || '';
  let out = text;
  out = out.replace(/```[a-zA-Z0-9]*\n?([\s\S]*?)```/g, '$1');
  out = out.replace(/`([^`\n]+)`/g, '$1');
  out = out.replace(/^#{1,6}\s+/gm, '');
  out = out.replace(/\*\*([^\*\n]+)\*\*/g, '$1');
  out = out.replace(/__([^_\n]+)__/g, '$1');
  out = out.replace(/(^|[^\*\w])\*([^\*\n]+)\*(?!\*)/g, '$1$2');
  out = out.replace(/(^|[^_\w])_([^_\n]+)_(?!_)/g, '$1$2');
  out = out.replace(/^[ \t]*[\*\+][ \t]+/gm, '- ');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
  out = out.replace(/^>\s?/gm, '');
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

function ficheToText(fiche) {
  const sections = (fiche.sections || []).map(s => {
    const h = s.heading ? `[${s.heading}]\n` : '';
    return h + (s.content || '');
  }).join('\n\n');
  const fallback = fiche.content || '';
  return `### ${fiche.title || fiche.id}\n${sections || fallback}`.trim();
}

/**
 * Tente de récupérer un JSON partiel/tronqué :
 * - extrait themes_top via regex
 * - extrait resume via regex sur la chaîne JSON (en gérant les \" et \n)
 */
function recoverPartialJSON(text) {
  const result = { themes_top: [], couverture_estimee: null, resume: '' };

  // themes_top : tente d'extraire un tableau valide
  const themesMatch = text.match(/"themes_top"\s*:\s*(\[[\s\S]*?\])/);
  if (themesMatch) {
    try {
      result.themes_top = JSON.parse(themesMatch[1]);
    } catch (_) { /* ignore */ }
  }

  const coverMatch = text.match(/"couverture_estimee"\s*:\s*"([^"]+)"/);
  if (coverMatch) result.couverture_estimee = coverMatch[1];

  // resume : extrait la chaîne JSON, même tronquée
  const resumeStart = text.indexOf('"resume"');
  if (resumeStart >= 0) {
    // Trouver le premier " après "resume":
    const colonIdx = text.indexOf(':', resumeStart);
    if (colonIdx >= 0) {
      const firstQuote = text.indexOf('"', colonIdx);
      if (firstQuote >= 0) {
        // Lire caractère par caractère en gérant les escapes, jusqu'à la fin de la chaîne
        let i = firstQuote + 1;
        let buf = '';
        while (i < text.length) {
          const ch = text[i];
          if (ch === '\\' && i + 1 < text.length) {
            const nxt = text[i + 1];
            if (nxt === 'n') buf += '\n';
            else if (nxt === 't') buf += '\t';
            else if (nxt === '"') buf += '"';
            else if (nxt === '\\') buf += '\\';
            else if (nxt === '/') buf += '/';
            else if (nxt === 'r') buf += '\r';
            else buf += nxt;
            i += 2;
          } else if (ch === '"') {
            // fin de chaîne JSON
            break;
          } else {
            buf += ch;
            i++;
          }
        }
        result.resume = buf;
      }
    }
  }

  return (result.resume || result.themes_top.length > 0) ? result : null;
}

function qcmToText(year, q) {
  const opts = q.options || {};
  const optsStr = ['a', 'b', 'c', 'd']
    .filter(k => opts[k])
    .map(k => `${k}) ${opts[k]}`)
    .join('\n');
  const ans = q.answer ? `[Réponse: ${q.answer}]` : '[Réponse: ?]';
  return `(${year} Q${q.number}) ${q.text}\n${optsStr}\n${ans}`;
}

// Labels lus directement depuis cours.json (champ bloc_label des fiches)
function getBlocLabel(bloc, fiches) {
  const lbl = (fiches[0] && fiches[0].bloc_label) || bloc;
  const map = {
    'Droit & Réglementations': 'Bloc 1 — Droit & Réglementations professionnelles',
    'RETM': 'Bloc 2 — Réglementations Européennes Transport Marchandises (RETM)',
    'Normes Techniques': 'Bloc 3 — Normes techniques et sécurité des véhicules',
    'Ventes Internationales': 'Bloc 4 — Ventes internationales et Incoterms'
  };
  return map[lbl] || `${bloc} — ${lbl}`;
}

// ---------- Prompt builder ----------

function buildPrompt(bloc, fiches, allQCMs) {
  const ficheCount = fiches.length;
  const fichesText = fiches.map(ficheToText).join('\n\n---\n\n');
  // Limiter à un sample de QCMs représentatif (toutes années) pour ne pas exploser le contexte
  const qcmText = allQCMs.map(({ year, q }) => qcmToText(year, q)).join('\n\n');
  const blocLabel = getBlocLabel(bloc, fiches);

  return `Tu es expert pédagogique pour l'examen de Capacité Professionnelle de Transport Routier de Marchandises.

Ta mission : générer un COURS RÉSUMÉ orienté examen pour le ${blocLabel}, en te basant sur :
1. Le contenu intégral des ${ficheCount} fiches de cours officielles fournies ci-dessous
2. L'historique des QCM tombés aux examens des 6 dernières sessions

ANALYSE D'ABORD : parmi les QCM fournis, identifie ceux qui relèvent du ${bloc} (les autres concernent d'autres blocs et ne te servent que de contexte). Puis détermine les THÈMES qui couvrent environ 80 % des questions de ce bloc (loi de Pareto : ~20 % des thèmes représentent 80 % des questions). Cite les fréquences observées.

ENSUITE PRODUIS un résumé de cours qui :
- Va à l'essentiel : seulement ce qui sert pour passer l'examen
- Couvre EXHAUSTIVEMENT les thèmes prioritaires identifiés
- Donne pour chaque notion : la définition, les chiffres-clés (délais, seuils, articles de loi), et un exemple concret
- Inclut des moyens mnémotechniques quand c'est utile
- Reste structuré et facile à relire (sauts de ligne, sections, emojis comme repères visuels)

FORMATAGE STRICT — N'UTILISE JAMAIS DE MARKDOWN :
- INTERDIT : aucun caractère # (pas de titres ## ou ###)
- INTERDIT : aucun astérisque * ou ** (pas de gras Markdown ni de listes Markdown)
- INTERDIT : aucun underscore _ pour le formatage, aucun backtick \`
- AUTORISÉ : texte brut, emojis (🚛 ⚖️ 📋 ✅ etc.), MAJUSCULES pour souligner, tirets simples "-" en début de ligne pour les listes, sauts de ligne pour structurer
- Pour les titres de section : écris-les en MAJUSCULES préfixées d'un emoji, suivies d'une ligne vide

FORMAT DE SORTIE OBLIGATOIRE — JSON valide uniquement, avec cette structure exacte (pas de texte avant ni après le JSON, pas de balises) :

{
  "themes_top": [
    { "theme": "Nom du thème", "frequency": 12, "notes": "Brève description de ce qui est demandé sur ce thème" }
  ],
  "couverture_estimee": "≈ 82 %",
  "resume": "Le texte intégral du cours résumé, en plain text sans markdown..."
}

==========================================================================
FICHES DE COURS DU ${bloc.toUpperCase()} (source de vérité) :
==========================================================================
${fichesText}

==========================================================================
QCM HISTORIQUES (6 sessions d'examen) — sélectionne ceux qui concernent le ${bloc} :
==========================================================================
${qcmText}

Réponds maintenant avec UNIQUEMENT le JSON demandé.`;
}

// ---------- Main ----------

// Seuil en caractères au-dessus duquel on chunk les fiches.
// Mesuré empiriquement : texte FR ≈ 2.7 chars/token ; limite API 200k tokens.
// Prompt = fiches + QCM (~80k) + template (~2k) doit rester < ~480k chars.
const CHUNK_CHAR_LIMIT = 380000;

async function callClaudeOnce(bloc, fiches, allQCMs, rawSuffix) {
  const prompt = buildPrompt(bloc, fiches, allQCMs);
  console.log(`  Prompt: ${prompt.length} chars (~${Math.round(prompt.length / 4)} tokens)`);

  const t0 = Date.now();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS_OUT,
    temperature: 0.3,
    messages: [{ role: 'user', content: prompt }]
  });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  const raw = response.content[0].text.trim();
  console.log(`  Claude réponse en ${dt}s | in=${response.usage.input_tokens} out=${response.usage.output_tokens}`);

  let cleaned = raw;
  cleaned = cleaned.replace(/^\s*```(?:json)?\s*/i, '');
  cleaned = cleaned.replace(/\s*```\s*$/, '');

  fs.writeFileSync(path.join(DATA_DIR, `_resume_${bloc}${rawSuffix || ''}_raw.txt`), raw, 'utf-8');

  let parsed = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.warn(`  ⚠️  JSON parse direct échoué (${err.message}). Tentative de récupération...`);
    parsed = recoverPartialJSON(cleaned);
    if (!parsed) {
      console.error(`  ❌ Récupération impossible pour ${bloc}${rawSuffix || ''}`);
      throw err;
    }
    console.log(`  ✅ Récupération partielle réussie`);
  }

  return {
    parsed,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens
    }
  };
}

function splitFichesIntoChunks(fiches) {
  let total = 0;
  for (const f of fiches) total += ficheToText(f).length;
  if (total <= CHUNK_CHAR_LIMIT) return [fiches];

  const nbChunks = Math.ceil(total / CHUNK_CHAR_LIMIT);
  const perChunk = Math.ceil(fiches.length / nbChunks);
  const chunks = [];
  for (let i = 0; i < fiches.length; i += perChunk) {
    chunks.push(fiches.slice(i, i + perChunk));
  }
  return chunks;
}

function mergeThemes(themesArrays) {
  const map = new Map();
  for (const arr of themesArrays) {
    for (const t of (arr || [])) {
      const key = (t.theme || '').toLowerCase().trim();
      if (!key) continue;
      if (map.has(key)) {
        const existing = map.get(key);
        existing.frequency = (existing.frequency || 0) + (t.frequency || 0);
      } else {
        map.set(key, { ...t });
      }
    }
  }
  return [...map.values()].sort((a, b) => (b.frequency || 0) - (a.frequency || 0));
}

async function generateBloc(bloc, fiches, allQCMs) {
  const blocLabel = getBlocLabel(bloc, fiches);
  console.log(`\n=== ${blocLabel} ===`);
  console.log(`  Fiches: ${fiches.length}`);
  console.log(`  QCM contexte: ${allQCMs.length}`);

  const chunks = splitFichesIntoChunks(fiches);
  if (chunks.length > 1) {
    console.log(`  ⚡ Chunking: ${chunks.length} passes (fiches trop volumineuses pour un seul appel)`);
  }

  const results = [];
  for (let i = 0; i < chunks.length; i++) {
    const suffix = chunks.length > 1 ? `_part${i + 1}of${chunks.length}` : '';
    console.log(`  --- Pass ${i + 1}/${chunks.length} (${chunks[i].length} fiches) ---`);
    const r = await callClaudeOnce(bloc, chunks[i], allQCMs, suffix);
    results.push(r);
  }

  const allThemes = mergeThemes(results.map(r => r.parsed.themes_top));
  const mergedResume = results.map((r, i) => {
    const head = chunks.length > 1 ? `\n\n========== PARTIE ${i + 1}/${chunks.length} ==========\n\n` : '';
    return head + stripMarkdown(r.parsed.resume || '');
  }).join('').trim();

  const totalIn = results.reduce((s, r) => s + r.usage.input_tokens, 0);
  const totalOut = results.reduce((s, r) => s + r.usage.output_tokens, 0);

  return {
    bloc,
    label: blocLabel,
    themes_top: allThemes,
    couverture_estimee: results[0].parsed.couverture_estimee || null,
    resume: mergedResume,
    fiches_sources: fiches.map(f => f.id || f.title),
    annales_sources: [...new Set(allQCMs.map(x => x.year))],
    model: MODEL,
    chunks: chunks.length,
    generated_at: new Date().toISOString(),
    usage: {
      input_tokens: totalIn,
      output_tokens: totalOut
    }
  };
}

async function main() {
  const target = process.argv[2] || 'all';

  console.log('Chargement des données...');
  const annales = loadJSON(ANNALES_FILE);
  const cours = loadJSON(COURS_FILE);

  // Aplatir tous les QCM avec leur année
  const allQCMs = [];
  for (const annale of annales) {
    const year = annale.year;
    for (const q of annale.qcm || []) {
      allQCMs.push({ year, q });
    }
  }
  console.log(`  ${annales.length} annales / ${allQCMs.length} QCM totaux`);
  console.log(`  bloc1=${cours.bloc1.length} bloc2=${cours.bloc2.length} bloc3=${cours.bloc3.length} bloc4=${cours.bloc4.length}`);

  // Charger l'existant si déjà présent (pour ne pas écraser ce qui marche)
  let existing = {};
  if (fs.existsSync(OUTPUT_FILE)) {
    existing = loadJSON(OUTPUT_FILE);
    console.log(`  Existant: ${Object.keys(existing).filter(k => k !== '_meta').join(', ')}`);
  }

  const blocsToGenerate = target === 'all' ? ['bloc1', 'bloc2', 'bloc3', 'bloc4'] : [target];

  for (const bloc of blocsToGenerate) {
    if (!cours[bloc]) {
      console.warn(`Bloc inconnu: ${bloc}`);
      continue;
    }
    try {
      const result = await generateBloc(bloc, cours[bloc], allQCMs);
      existing[bloc] = result;
      // Sauvegarde incrémentale après chaque bloc
      existing._meta = {
        last_update: new Date().toISOString(),
        model: MODEL,
        annales_count: annales.length
      };
      saveJSON(OUTPUT_FILE, existing);
      console.log(`  ✅ ${bloc} sauvé. Thèmes: ${result.themes_top.length}, résumé: ${result.resume.length} chars`);
    } catch (err) {
      console.error(`  ❌ Échec ${bloc}:`, err.message);
    }
  }

  console.log(`\n✅ Terminé. Fichier: ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
