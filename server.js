// ============================================================================
// server.js — Backend Express.js pour la plateforme "Capacité Transport Pro"
// Entraînement à l'examen Capacité Professionnelle de Transport Routier
// ============================================================================

'use strict';

// --- Chargement des variables d'environnement ---
require('dotenv').config({ override: true });

const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs = require('fs');

// ============================================================================
// Configuration
// ============================================================================

const PORT = process.env.PORT || 3000;
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE, 10) || 10485760; // 10 Mo
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DOCUMENTS_JSON = path.join(UPLOADS_DIR, 'documents.json');

// Modèle Claude utilisé pour toutes les requêtes
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

// --- Initialisation du client Anthropic ---
const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// --- Création du dossier uploads s'il n'existe pas ---
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// --- Initialisation du fichier documents.json s'il n'existe pas ---
if (!fs.existsSync(DOCUMENTS_JSON)) {
  fs.writeFileSync(DOCUMENTS_JSON, JSON.stringify([], null, 2), 'utf-8');
}

// ============================================================================
// Application Express
// ============================================================================

const app = express();

// --- Production settings ---
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// --- Security headers + no-cache en dev ---
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (process.env.NODE_ENV !== 'production') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// --- Middleware CORS ---
app.use(cors());

// --- Middleware pour parser le JSON (limite à 50 Mo pour le contenu des documents) ---
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// --- Limitation de débit sur les routes API (100 requêtes par 15 minutes) ---
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Trop de requêtes depuis cette adresse IP. Veuillez réessayer dans 15 minutes.',
    code: 'RATE_LIMIT_EXCEEDED'
  }
});

app.use('/api/', apiLimiter);

// --- Blocage des PDFs et dossiers sources (jamais expos\u00e9s \u00e0 l'utilisateur) ---
// Les PDFs contiennent les sources et explications qu'il ne faut pas divulguer.
// Tout est servi via les JSON pr\u00e9-trait\u00e9s dans /data.
const BLOCKED_PATHS = [
  '/Annales_CAP3T5',
  '/Bloc2_RETM',
  '/Normes_Techniques',
  '/Re\u0301glementations_pro',
  '/Réglementations_pro',
  '/Ventes_Internationales',
  '/uploads'
];
app.use((req, res, next) => {
  var urlPath = decodeURIComponent(req.path || '');
  for (var i = 0; i < BLOCKED_PATHS.length; i++) {
    if (urlPath.indexOf(BLOCKED_PATHS[i]) === 0) {
      return res.status(404).send('Not found');
    }
  }
  if (/\.pdf($|\?)/i.test(urlPath)) {
    return res.status(404).send('Not found');
  }
  next();
});

// --- Fichiers statiques depuis la racine du projet ---
const staticOptions = process.env.NODE_ENV === 'production'
  ? { maxAge: '1d', etag: true }
  : { etag: false, lastModified: false, setHeaders: (res) => { res.setHeader('Cache-Control', 'no-store'); } };
app.use(express.static(__dirname, staticOptions));

// ============================================================================
// Configuration Multer (upload de fichiers)
// ============================================================================

const storage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename: function (_req, file, cb) {
    // Nom unique pour éviter les conflits
    const uniqueSuffix = uuidv4();
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`);
  }
});

// Filtre : n'accepter que les types autorisés
const fileFilter = function (_req, file, cb) {
  const allowedMimes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'image/jpeg',
    'image/png'
  ];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Type de fichier non supporté : ${file.mimetype}. Acceptés : PDF, DOCX, TXT, JPG, PNG.`), false);
  }
};

const upload = multer({
  storage: storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: fileFilter
});

// ============================================================================
// Fonctions utilitaires
// ============================================================================

/**
 * Lit le fichier documents.json et retourne le tableau de documents
 */
function readDocuments() {
  try {
    const data = fs.readFileSync(DOCUMENTS_JSON, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error('[ERREUR] Lecture de documents.json :', err.message);
    return [];
  }
}

/**
 * Sauvegarde le tableau de documents dans documents.json
 */
function saveDocuments(documents) {
  fs.writeFileSync(DOCUMENTS_JSON, JSON.stringify(documents, null, 2), 'utf-8');
}

/**
 * Extrait le texte d'un fichier selon son type MIME
 * @param {string} filePath - Chemin absolu du fichier
 * @param {string} mimetype - Type MIME du fichier
 * @returns {Promise<string>} Le texte extrait
 */
async function extractText(filePath, mimetype) {
  switch (mimetype) {
    case 'application/pdf': {
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdfParse(dataBuffer);
      return pdfData.text || '';
    }
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value || '';
    }
    case 'text/plain': {
      return fs.readFileSync(filePath, 'utf-8');
    }
    case 'image/jpeg':
    case 'image/png': {
      // Pour les images, on retourne un placeholder — l'analyse visuelle
      // serait gérée côté client ou via l'API Vision de Claude
      return `[Image : ${path.basename(filePath)}]`;
    }
    default:
      return '';
  }
}

// ============================================================================
// Prompts système pour Claude (MAX, l'instructeur camion)
// ============================================================================

/**
 * Prompt système pour l'analyse de documents
 */
const SYSTEM_PROMPT_ANALYZE = `Tu es MAX, un instructeur expert en transport routier de marchandises, spécialisé dans la préparation à l'examen de Capacité Professionnelle de Transport.

Tu es comme un vieux routier qui connaît chaque virage de la réglementation : précis, passionné et toujours prêt à guider les candidats sur la bonne route.

Ton rôle : analyser le document fourni et en extraire les informations pédagogiques essentielles.

Tu dois retourner un JSON structuré avec :
- "titre" : le titre ou sujet principal du document
- "themes" : un tableau des thèmes abordés
- "concepts_cles" : un tableau des concepts clés à retenir
- "questions_potentielles" : un tableau de questions d'examen potentielles basées sur le contenu
- "resume" : un résumé concis du document (3-5 phrases)
- "bloc" : le bloc d'examen concerné (1 = Entreprise et droit civil/commercial, 2 = Réglementation du transport, 3 = Technique d'exploitation, 4 = Gestion financière), ou null si non déterminé
- "difficulte" : estimation de la difficulté (1-5)

Réponds UNIQUEMENT avec le JSON valide, sans texte avant ou après.`;

/**
 * Prompt système pour la génération de questions
 */
const SYSTEM_PROMPT_QUESTIONS = `Tu es MAX, l'instructeur le plus affûté de la formation Capacité Transport. Comme un GPS de précision, tu génères des questions d'examen qui mettent les candidats sur la voie du succès.

Tu génères des questions d'examen pour la Capacité Professionnelle de Transport Routier de Marchandises.

Les blocs de l'examen :
- Bloc 1 : L'entreprise et le droit civil et commercial
- Bloc 2 : L'entreprise et son activité commerciale (RETM - Réglementation du Transport de Marchandises)
- Bloc 3 : L'entreprise et la direction technique d'exploitation
- Bloc 4 : L'entreprise et la gestion financière

Tu dois générer des questions au format JSON strict. Chaque question doit suivre ce schéma :
{
  "id": "identifiant unique (string)",
  "bloc": numéro du bloc (1-4),
  "theme": "thème de la question",
  "question": "énoncé complet de la question",
  "type": "qcm" ou "vrai_faux" ou "calcul" ou "cas_pratique",
  "options": ["A) ...", "B) ...", "C) ...", "D) ..."] (pour QCM, sinon tableau vide),
  "reponse_correcte": "la bonne réponse (lettre pour QCM, Vrai/Faux, ou valeur calculée)",
  "explication": "explication détaillée de la réponse",
  "difficulte": niveau de difficulté (1-5),
  "reference_legale": "référence réglementaire si applicable"
}

Réponds UNIQUEMENT avec un tableau JSON valide de questions, sans texte avant ou après.`;

/**
 * Prompt système pour les explications détaillées
 */
/**
 * Filet de sécurité : retire les caractères Markdown des réponses de Claude
 * au cas où il ignorerait l'instruction "pas de markdown" du system prompt.
 * Préserve les emojis, les retours à la ligne et la ponctuation utile.
 */
function stripMarkdown(text) {
  if (!text || typeof text !== 'string') return text || '';
  let out = text;
  // Code blocks ```...``` -> contenu seul
  out = out.replace(/```[a-zA-Z0-9]*\n?([\s\S]*?)```/g, '$1');
  // Code inline `xxx` -> xxx
  out = out.replace(/`([^`\n]+)`/g, '$1');
  // Titres ###..# en début de ligne -> retire le préfixe
  out = out.replace(/^#{1,6}\s+/gm, '');
  // Gras **xxx** ou __xxx__ -> xxx
  out = out.replace(/\*\*([^\*\n]+)\*\*/g, '$1');
  out = out.replace(/__([^_\n]+)__/g, '$1');
  // Italique *xxx* ou _xxx_ -> xxx (en évitant de toucher aux ** déjà retirés)
  out = out.replace(/(^|[^\*\w])\*([^\*\n]+)\*(?!\*)/g, '$1$2');
  out = out.replace(/(^|[^_\w])_([^_\n]+)_(?!_)/g, '$1$2');
  // Listes Markdown "* item" ou "+ item" -> "- item" (les tirets restent OK en plain text)
  out = out.replace(/^[ \t]*[\*\+][ \t]+/gm, '- ');
  // Liens [texte](url) -> texte (url)
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
  // Quote markers "> "
  out = out.replace(/^>\s?/gm, '');
  // Triple+ retours à la ligne -> double
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

const SYSTEM_PROMPT_EXPLAIN = `Tu es MAX, instructeur expert en Capacité Transport. Tel un mécanicien qui démonte chaque pièce pour l'expliquer, tu fournis des explications claires, détaillées et pédagogiques.

Ton style :
- Tu utilises des métaphores du monde du transport pour rendre les concepts concrets
- Tu donnes des exemples pratiques tirés du quotidien d'un transporteur
- Tu cites les références réglementaires précises
- Tu structures ta réponse avec des sections claires séparées par des sauts de ligne
- Tu conclus toujours par un conseil mémorable pour l'examen

FORMATAGE STRICT — N'UTILISE JAMAIS DE MARKDOWN :
- INTERDIT : aucun caractère # (pas de titres ## ou ###)
- INTERDIT : aucun astérisque * ou ** (pas de gras Markdown ni d'italique Markdown ni de listes à puces avec *)
- INTERDIT : aucun underscore _ ou __ pour le formatage
- INTERDIT : aucun backtick \`
- AUTORISÉ : texte brut, emojis (🚛 ✅ ❌ 📋 ⚖️ 🎯 etc.), tirets simples "-" en début de ligne pour les listes, sauts de ligne, MAJUSCULES pour mettre en valeur
- Pour structurer : utilise des emojis comme préfixes de section et des sauts de ligne, pas de # ou *
- Pour souligner : utilise les MAJUSCULES ou des « guillemets français »

Langue : français uniquement.`;

/**
 * Prompt système pour le chat avec MAX
 */
const SYSTEM_PROMPT_CHAT = `Tu es MAX, un instructeur passionné et bienveillant pour la préparation à l'examen de Capacité Professionnelle de Transport Routier de Marchandises.

Ta personnalité :
- Tu es comme un chef de convoi expérimenté : rassurant, précis et motivant
- Tu utilises des métaphores du transport routier ("On reprend la route !", "Pas de virage dangereux ici", "Tu es sur la bonne voie !")
- Tu tutoies l'étudiant comme un collègue routier
- Tu es encourageant mais honnête sur les lacunes
- Tu donnes toujours des conseils pratiques pour l'examen

Tes compétences :
- Droit civil et commercial appliqué au transport
- Réglementation du transport de marchandises (RETM)
- Gestion d'exploitation de transport
- Gestion financière d'entreprise de transport
- Normes techniques des véhicules
- Ventes et contrats internationaux

Règles :
- Réponds toujours en français
- Sois concis mais complet (pas plus de 3-4 paragraphes)
- Si tu ne sais pas, dis-le honnêtement
- Encourage toujours l'étudiant à continuer ses révisions

FORMATAGE STRICT — N'UTILISE JAMAIS DE MARKDOWN :
- INTERDIT : aucun #, ##, ###, aucun astérisque * ou **, aucun underscore _ pour le formatage, aucun backtick \`
- AUTORISÉ : texte brut, emojis, MAJUSCULES, « guillemets », tirets simples "-" pour les listes
- Structure tes paragraphes avec des sauts de ligne et des emojis comme repères visuels`;

// ============================================================================
// Routes
// ============================================================================

// --- Page d'accueil ---
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// --- Page de l'application ---
app.get('/app', (_req, res) => {
  res.sendFile(path.join(__dirname, 'app.html'));
});

// ============================================================================
// API : Upload de document
// ============================================================================

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'Aucun fichier reçu. Veuillez sélectionner un document à envoyer.',
        code: 'NO_FILE'
      });
    }

    const file = req.file;
    console.log(`[UPLOAD] Fichier reçu : ${file.originalname} (${file.mimetype}, ${(file.size / 1024).toFixed(1)} Ko)`);

    // Extraction du texte
    let extractedText = '';
    try {
      extractedText = await extractText(file.path, file.mimetype);
    } catch (extractErr) {
      console.error(`[ERREUR] Extraction du texte : ${extractErr.message}`);
      extractedText = '[Erreur lors de l\'extraction du texte]';
    }

    // Création des métadonnées du document
    const document = {
      id: uuidv4(),
      filename: file.filename,
      originalName: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      path: file.path,
      extractedText: extractedText.substring(0, 50000), // Limiter la taille du texte stocké
      uploadDate: new Date().toISOString(),
      category: req.body.category || 'general'
    };

    // Sauvegarde dans documents.json
    const documents = readDocuments();
    documents.push(document);
    saveDocuments(documents);

    console.log(`[UPLOAD] Document enregistré : ${document.id}`);

    // Retourner les métadonnées (sans le texte complet pour alléger la réponse)
    res.json({
      success: true,
      message: `Document "${file.originalname}" uploadé avec succès !`,
      document: {
        id: document.id,
        filename: document.filename,
        originalName: document.originalName,
        mimetype: document.mimetype,
        size: document.size,
        uploadDate: document.uploadDate,
        category: document.category,
        textLength: extractedText.length
      }
    });
  } catch (err) {
    console.error('[ERREUR] Upload :', err.message);
    res.status(500).json({
      error: 'Erreur lors de l\'upload du document. Vérifiez le format et la taille du fichier.',
      code: 'UPLOAD_ERROR',
      details: err.message
    });
  }
});

// ============================================================================
// API : Analyse de document avec Claude
// ============================================================================

app.post('/api/analyze', async (req, res) => {
  try {
    const { documentId, text } = req.body;

    // On peut recevoir soit un ID de document, soit du texte directement
    let documentText = text || '';

    if (documentId && !documentText) {
      const documents = readDocuments();
      const doc = documents.find(d => d.id === documentId);
      if (!doc) {
        return res.status(404).json({
          error: 'Document introuvable. Vérifiez l\'identifiant du document.',
          code: 'DOCUMENT_NOT_FOUND'
        });
      }
      documentText = doc.extractedText || '';
    }

    if (!documentText || documentText.trim().length === 0) {
      return res.status(400).json({
        error: 'Aucun texte à analyser. Le document est peut-être vide ou non supporté.',
        code: 'EMPTY_TEXT'
      });
    }

    console.log(`[ANALYSE] Envoi de ${documentText.length} caractères à Claude...`);

    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      temperature: 0.3,
      system: SYSTEM_PROMPT_ANALYZE,
      messages: [
        {
          role: 'user',
          content: `Analyse le document suivant et retourne le JSON structuré demandé :\n\n---\n${documentText.substring(0, 30000)}\n---`
        }
      ]
    });

    // Extraction de la réponse texte
    const responseText = response.content[0].text;

    // Tentative de parsing JSON
    let analysis;
    try {
      // Chercher le JSON dans la réponse (au cas où il y aurait du texte autour)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[0]);
      } else {
        analysis = JSON.parse(responseText);
      }
    } catch (parseErr) {
      console.warn('[ANALYSE] Réponse non-JSON, retour en texte brut');
      analysis = { raw: responseText };
    }

    res.json({
      success: true,
      analysis: analysis
    });
  } catch (err) {
    console.error('[ERREUR] Analyse :', err.message);
    res.status(500).json({
      error: 'Erreur lors de l\'analyse du document. Le service est peut-être temporairement indisponible.',
      code: 'ANALYSIS_ERROR',
      details: err.message
    });
  }
});

// ============================================================================
// API : Génération de questions d'examen
// ============================================================================

// ---------- Helpers : charger les QCM depuis les annales JSON ----------
function loadAllAnnalesQCM() {
  const allFile = path.join(DATA_DIR, 'all_annales.json');
  if (!fs.existsSync(allFile)) return [];
  const annales = JSON.parse(fs.readFileSync(allFile, 'utf-8'));
  const pool = [];
  for (const annale of annales) {
    for (const q of annale.qcm) {
      if (!q.answer) continue; // Ignorer les QCM sans réponse
      pool.push({
        id: `annale_${annale.year}_q${q.number}`,
        bloc: null,
        bloc_label: `Annale ${annale.year}`,
        theme: `Examen officiel ${annale.year}`,
        question: q.text,
        type: 'qcm',
        choix: {
          A: q.options.a || '',
          B: q.options.b || '',
          C: q.options.c || '',
          D: q.options.d || ''
        },
        reponse: q.answer,
        explication: q.explanation || null,
        difficulte: 3,
        source: `Session ${annale.year}`
      });
    }
  }
  return pool;
}

let _annalesPool = null;
function getAnnalesPool() {
  if (!_annalesPool) _annalesPool = loadAllAnnalesQCM();
  return _annalesPool;
}

function shuffleArray(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

app.post('/api/generate-questions', async (req, res) => {
  try {
    const { bloc, count, difficulty, documentContext, sessionType } = req.body;
    const questionCount = count || 5;

    // 1) D'abord, essayer de piocher dans les annales JSON (vraies questions d'examen)
    const pool = getAnnalesPool();
    if (pool.length > 0) {
      const shuffled = shuffleArray(pool);
      const selected = shuffled.slice(0, Math.min(questionCount, shuffled.length));
      console.log(`[QUESTIONS] ${selected.length} questions piochées dans les annales (pool: ${pool.length})`);
      return res.json({
        success: true,
        count: selected.length,
        questions: selected
      });
    }

    // 2) Fallback : génération via Claude si aucune annale disponible
    const questionDifficulty = difficulty || 3;
    let userPrompt = `Génère exactement ${questionCount} questions d'examen`;
    if (bloc) userPrompt += ` pour le Bloc ${bloc}`;
    userPrompt += ` de niveau de difficulté ${questionDifficulty}/5.`;
    if (documentContext) {
      userPrompt += `\n\nBase-toi sur le contenu suivant :\n---\n${documentContext.substring(0, 20000)}\n---`;
    }
    userPrompt += `\n\nIMPORTANT : Chaque question DOIT avoir le format suivant :
{
  "id": "identifiant unique",
  "bloc": numéro (1-4),
  "bloc_label": "nom du bloc",
  "theme": "thème",
  "question": "énoncé complet",
  "type": "qcm",
  "choix": { "A": "texte option A", "B": "texte option B", "C": "texte option C", "D": "texte option D" },
  "reponse": "A",
  "explication": "explication détaillée",
  "difficulte": ${questionDifficulty}
}
Retourne UNIQUEMENT le tableau JSON.`;

    console.log(`[QUESTIONS] Génération Claude de ${questionCount} questions (Bloc: ${bloc || 'tous'})`);

    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 8192,
      temperature: 0.7,
      system: SYSTEM_PROMPT_QUESTIONS,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = response.content[0].text;
    let questions;
    try {
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      questions = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(responseText);
      // Normaliser le format pour exam.js
      questions = questions.map((q, i) => ({
        id: q.id || `gen_${i}_${Date.now()}`,
        bloc: q.bloc || null,
        bloc_label: q.bloc_label || (q.bloc ? `Bloc ${q.bloc}` : 'Général'),
        theme: q.theme || '',
        question: q.question || q.texte || '',
        type: q.type || 'qcm',
        choix: q.choix || (q.options ? {
          A: (q.options[0] || '').replace(/^[A-D]\)\s*/, ''),
          B: (q.options[1] || '').replace(/^[A-D]\)\s*/, ''),
          C: (q.options[2] || '').replace(/^[A-D]\)\s*/, ''),
          D: (q.options[3] || '').replace(/^[A-D]\)\s*/, '')
        } : {}),
        reponse: q.reponse || q.reponse_correcte || q.answer || '',
        explication: q.explication || q.explanation || null,
        difficulte: q.difficulte || questionDifficulty
      }));
    } catch (parseErr) {
      console.warn('[QUESTIONS] Réponse non-JSON :', parseErr.message);
      questions = [];
    }

    res.json({
      success: true,
      count: questions.length,
      questions: questions
    });
  } catch (err) {
    console.error('[ERREUR] Génération de questions :', err.message);
    res.status(500).json({
      error: 'Erreur lors de la génération des questions. Réessayez dans quelques instants.',
      code: 'GENERATION_ERROR',
      details: err.message
    });
  }
});

// ============================================================================
// API : Explication détaillée d'une question
// ============================================================================

app.post('/api/explain', async (req, res) => {
  try {
    let { question, reponse, options, userAnswer } = req.body;

    // Le frontend peut envoyer soit (question: string, options: array, reponse: string),
    // soit (question: objet complet contenant question/texte, choix/options, reponse/bonne_reponse).
    let questionText = '';
    let optionsList = [];
    let correctAnswer = reponse || '';

    if (typeof question === 'string') {
      questionText = question;
    } else if (question && typeof question === 'object') {
      questionText = question.question || question.texte || question.text || '';
      // Choix peut être un objet {A:'...',B:'...'} ou un tableau
      const choix = question.choix || question.choices || question.options || options;
      if (Array.isArray(choix)) {
        optionsList = choix;
      } else if (choix && typeof choix === 'object') {
        optionsList = Object.keys(choix).map(k => `${k}) ${choix[k]}`);
      }
      if (!correctAnswer) {
        correctAnswer = question.bonne_reponse || question.reponse || question.answer || '';
      }
    }

    if (Array.isArray(options) && options.length > 0 && optionsList.length === 0) {
      optionsList = options;
    }

    if (!questionText) {
      return res.status(400).json({
        error: 'Veuillez fournir une question à expliquer.',
        code: 'MISSING_QUESTION'
      });
    }

    let userPrompt = `Explique en détail la question suivante :\n\n**Question :** ${questionText}`;

    if (optionsList.length > 0) {
      userPrompt += `\n\n**Options :**\n${optionsList.join('\n')}`;
    }

    if (correctAnswer) {
      userPrompt += `\n\n**Réponse correcte :** ${correctAnswer}`;
    }
    // Garder l'ancien nom local 'reponse' pour la suite de la fonction
    reponse = correctAnswer;

    if (userAnswer) {
      userPrompt += `\n\n**Réponse de l'étudiant :** ${userAnswer}`;
      if (userAnswer !== reponse) {
        userPrompt += `\n\nL'étudiant s'est trompé. Explique pourquoi sa réponse est incorrecte et pourquoi la bonne réponse est correcte.`;
      } else {
        userPrompt += `\n\nL'étudiant a bien répondu ! Confirme et approfondis la notion.`;
      }
    }

    console.log('[EXPLICATION] Demande d\'explication pour une question');

    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      temperature: 0.5,
      system: SYSTEM_PROMPT_EXPLAIN,
      messages: [
        {
          role: 'user',
          content: userPrompt
        }
      ]
    });

    const explanation = stripMarkdown(response.content[0].text);

    res.json({
      success: true,
      explanation: explanation
    });
  } catch (err) {
    console.error('[ERREUR] Explication :', err.message);
    res.status(500).json({
      error: 'Erreur lors de la génération de l\'explication. Notre moteur pédale un peu, réessayez !',
      code: 'EXPLAIN_ERROR',
      details: err.message
    });
  }
});

// ============================================================================
// API : Chat avec MAX (assistant expert)
// ============================================================================

app.post('/api/chat', async (req, res) => {
  try {
    const { message, conversationHistory, history, studentProfile, profile } = req.body;
    const chatHistory = conversationHistory || history || [];
    const chatProfile = studentProfile || profile || null;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({
        error: 'Message vide. Dis quelque chose à MAX !',
        code: 'EMPTY_MESSAGE'
      });
    }

    // Construction du prompt système avec le profil étudiant si disponible
    let systemPrompt = SYSTEM_PROMPT_CHAT;

    if (chatProfile) {
      systemPrompt += `\n\nProfil de l'étudiant :`;
      if (chatProfile.name || chatProfile.prenom) systemPrompt += `\n- Nom : ${chatProfile.name || chatProfile.prenom}`;
      if (chatProfile.level) systemPrompt += `\n- Niveau : ${chatProfile.level}`;
      if (chatProfile.weakPoints) systemPrompt += `\n- Points faibles : ${chatProfile.weakPoints.join(', ')}`;
      if (chatProfile.strongPoints) systemPrompt += `\n- Points forts : ${chatProfile.strongPoints.join(', ')}`;
      if (chatProfile.score || chatProfile.scoreGlobal) systemPrompt += `\n- Score moyen : ${chatProfile.score || chatProfile.scoreGlobal}%`;
      systemPrompt += `\n\nAdapte tes réponses au profil de l'étudiant. Insiste sur ses points faibles et félicite ses points forts.`;
    }

    // Construction des messages avec historique (limité aux 10 derniers échanges)
    let messages = [];

    if (chatHistory && Array.isArray(chatHistory) && chatHistory.length > 0) {
      // Garder les 10 derniers messages de l'historique
      const recentHistory = chatHistory.slice(-10);
      messages = recentHistory.map(msg => ({
        role: msg.role,
        content: msg.content
      }));
    }

    // Ajout du message actuel de l'utilisateur
    messages.push({
      role: 'user',
      content: message
    });

    console.log(`[CHAT] Message reçu (${message.substring(0, 50)}...), historique: ${messages.length - 1} messages`);

    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      temperature: 0.8,
      system: systemPrompt,
      messages: messages
    });

    const reply = stripMarkdown(response.content[0].text);

    res.json({
      success: true,
      reply: reply,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens
      }
    });
  } catch (err) {
    console.error('[ERREUR] Chat :', err.message);
    res.status(500).json({
      error: 'MAX a un problème de transmission ! Réessayez dans quelques instants.',
      code: 'CHAT_ERROR',
      details: err.message
    });
  }
});

// ============================================================================
// API : Liste des documents
// ============================================================================

app.get('/api/documents', (_req, res) => {
  try {
    const documents = readDocuments();

    // Retourner les métadonnées sans le texte extrait (trop volumineux)
    const documentList = documents.map(doc => ({
      id: doc.id,
      filename: doc.filename,
      originalName: doc.originalName,
      mimetype: doc.mimetype,
      size: doc.size,
      uploadDate: doc.uploadDate,
      category: doc.category,
      textLength: doc.extractedText ? doc.extractedText.length : 0
    }));

    res.json({
      success: true,
      count: documentList.length,
      documents: documentList
    });
  } catch (err) {
    console.error('[ERREUR] Liste documents :', err.message);
    res.status(500).json({
      error: 'Erreur lors de la récupération de la liste des documents.',
      code: 'LIST_ERROR',
      details: err.message
    });
  }
});

// ============================================================================
// API : Suppression d'un document
// ============================================================================

app.delete('/api/documents/:id', (req, res) => {
  try {
    const { id } = req.params;
    const documents = readDocuments();
    const docIndex = documents.findIndex(d => d.id === id);

    if (docIndex === -1) {
      return res.status(404).json({
        error: 'Document introuvable. Il a peut-être déjà été supprimé.',
        code: 'DOCUMENT_NOT_FOUND'
      });
    }

    const doc = documents[docIndex];

    // Supprimer le fichier physique s'il existe dans uploads/
    if (doc.path && fs.existsSync(doc.path)) {
      try {
        fs.unlinkSync(doc.path);
        console.log(`[DELETE] Fichier supprimé : ${doc.path}`);
      } catch (unlinkErr) {
        console.warn(`[WARN] Impossible de supprimer le fichier : ${unlinkErr.message}`);
      }
    }

    // Retirer du tableau et sauvegarder
    documents.splice(docIndex, 1);
    saveDocuments(documents);

    console.log(`[DELETE] Document supprimé : ${id} (${doc.originalName})`);

    res.json({
      success: true,
      message: `Document "${doc.originalName}" supprimé avec succès.`
    });
  } catch (err) {
    console.error('[ERREUR] Suppression :', err.message);
    res.status(500).json({
      error: 'Erreur lors de la suppression du document.',
      code: 'DELETE_ERROR',
      details: err.message
    });
  }
});

// ============================================================================
// API : Health check
// ============================================================================

app.get('/api/health', (_req, res) => {
  const apiKeyConfigured = !!(ANTHROPIC_API_KEY && ANTHROPIC_API_KEY.length > 0);

  res.json({
    status: apiKeyConfigured ? 'ok' : 'warning',
    message: apiKeyConfigured
      ? 'Le serveur est opérationnel. Toutes les routes sont prêtes !'
      : 'Le serveur fonctionne mais la clé API Anthropic n\'est pas configurée. Créez un fichier .env avec ANTHROPIC_API_KEY.',
    apiKeyConfigured: apiKeyConfigured,
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// ============================================================================
// API : Scanner les dossiers PDF existants du projet
// ============================================================================

app.post('/api/scan-existing', async (req, res) => {
  try {
    // Mapping des dossiers vers les catégories
    const folderCategoryMap = {
      'Annales_CAP3T5': 'annales',
      'Bloc2_RETM': 'bloc2_retm',
      'Normes_Techniques': 'normes_techniques',
      'Réglementations_pro': 'reglementations',
      'Ventes_Internationales': 'ventes_internationales'
    };

    const documents = readDocuments();
    const results = {
      scanned: 0,
      added: 0,
      skipped: 0,
      errors: 0,
      details: []
    };

    // Parcourir chaque dossier configuré
    for (const [folderName, category] of Object.entries(folderCategoryMap)) {
      const folderPath = path.join(__dirname, folderName);

      // Vérifier si le dossier existe
      if (!fs.existsSync(folderPath)) {
        console.log(`[SCAN] Dossier non trouvé : ${folderName}`);
        results.details.push({
          folder: folderName,
          status: 'not_found',
          message: `Dossier "${folderName}" non trouvé`
        });
        continue;
      }

      // Lire les fichiers du dossier (récursif)
      const files = getAllFiles(folderPath);

      for (const filePath of files) {
        // Ne traiter que les PDF
        if (path.extname(filePath).toLowerCase() !== '.pdf') {
          continue;
        }

        results.scanned++;

        const originalName = path.basename(filePath);

        // Vérifier si le document existe déjà (par nom original et catégorie)
        const alreadyExists = documents.some(
          d => d.originalName === originalName && d.category === category
        );

        if (alreadyExists) {
          results.skipped++;
          results.details.push({
            file: originalName,
            folder: folderName,
            status: 'skipped',
            message: 'Document déjà indexé'
          });
          continue;
        }

        // Extraction du texte
        try {
          console.log(`[SCAN] Extraction de : ${originalName}`);
          const extractedText = await extractText(filePath, 'application/pdf');

          const document = {
            id: uuidv4(),
            filename: originalName,
            originalName: originalName,
            mimetype: 'application/pdf',
            size: fs.statSync(filePath).size,
            path: filePath,
            extractedText: extractedText.substring(0, 50000),
            uploadDate: new Date().toISOString(),
            category: category
          };

          documents.push(document);
          results.added++;
          results.details.push({
            file: originalName,
            folder: folderName,
            category: category,
            status: 'added',
            textLength: extractedText.length
          });
        } catch (extractErr) {
          console.error(`[SCAN] Erreur extraction ${originalName} : ${extractErr.message}`);
          results.errors++;
          results.details.push({
            file: originalName,
            folder: folderName,
            status: 'error',
            message: extractErr.message
          });
        }
      }
    }

    // Sauvegarder tous les documents mis à jour
    saveDocuments(documents);

    console.log(`[SCAN] Terminé — ${results.added} ajoutés, ${results.skipped} ignorés, ${results.errors} erreurs`);

    res.json({
      success: true,
      message: `Scan terminé ! ${results.added} document(s) ajouté(s), ${results.skipped} déjà présent(s), ${results.errors} erreur(s).`,
      results: results
    });
  } catch (err) {
    console.error('[ERREUR] Scan :', err.message);
    res.status(500).json({
      error: 'Erreur lors du scan des dossiers existants.',
      code: 'SCAN_ERROR',
      details: err.message
    });
  }
});

/**
 * Récupère récursivement tous les fichiers d'un dossier
 * @param {string} dirPath - Chemin du dossier
 * @returns {string[]} Tableau de chemins absolus
 */
function getAllFiles(dirPath) {
  let files = [];
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        // Ignorer le dossier __MACOSX
        if (entry.name === '__MACOSX') continue;
        files = files.concat(getAllFiles(fullPath));
      } else {
        files.push(fullPath);
      }
    }
  } catch (err) {
    console.error(`[SCAN] Erreur lecture dossier ${dirPath} : ${err.message}`);
  }
  return files;
}

// ============================================================================
// Admin Panel — Data & Routes
// ============================================================================

const USERS_JSON = path.join(__dirname, 'data', 'users.json');

// Ensure data directory exists
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readUsers() {
  try {
    if (!fs.existsSync(USERS_JSON)) return [];
    const data = fs.readFileSync(USERS_JSON, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error('[ADMIN] Erreur lecture users.json :', err.message);
    return [];
  }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_JSON, JSON.stringify(users, null, 2), 'utf-8');
}

// Simple admin auth middleware (checks x-admin-token header)
function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (token === 'capa-admin-session-valid') {
    return next();
  }
  return res.status(401).json({ error: 'Non autorisé. Veuillez vous connecter.' });
}

// --- Serve admin.html ---
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// --- Admin login ---
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'admin' && password === 'CapaTransport2024!') {
    return res.json({ success: true, token: 'capa-admin-session-valid' });
  }
  return res.status(401).json({ error: 'Identifiants incorrects.' });
});

// --- Dashboard stats ---
app.get('/api/admin/stats', adminAuth, (_req, res) => {
  const users = readUsers();
  const totalUsers = users.length;
  const activeUsers = users.filter(u => u.active).length;
  const validatedPayments = users.filter(u => u.paymentStatus === 'validated').length;
  const pendingPayments = users.filter(u => u.paymentStatus === 'pending').length;
  const expiredPayments = users.filter(u => u.paymentStatus === 'expired').length;
  const revenue = validatedPayments * 430;

  // Registration over time (by month)
  const registrationsByMonth = {};
  users.forEach(u => {
    const month = u.registrationDate.substring(0, 7); // YYYY-MM
    registrationsByMonth[month] = (registrationsByMonth[month] || 0) + 1;
  });

  // Recent activity (last 10 users sorted by lastLogin)
  const recentActivity = [...users]
    .filter(u => u.lastLogin)
    .sort((a, b) => new Date(b.lastLogin) - new Date(a.lastLogin))
    .slice(0, 10)
    .map(u => ({
      id: u.id,
      name: `${u.firstName} ${u.lastName}`,
      lastLogin: u.lastLogin,
      paymentStatus: u.paymentStatus
    }));

  res.json({
    success: true,
    stats: {
      totalUsers,
      activeUsers,
      validatedPayments,
      pendingPayments,
      expiredPayments,
      revenue,
      registrationsByMonth,
      recentActivity
    }
  });
});

// --- List users (with search & pagination) ---
app.get('/api/admin/users', adminAuth, (req, res) => {
  let users = readUsers();
  const { search, status, page = 1, limit = 50 } = req.query;

  if (search) {
    const s = search.toLowerCase();
    users = users.filter(u =>
      u.firstName.toLowerCase().includes(s) ||
      u.lastName.toLowerCase().includes(s) ||
      u.email.toLowerCase().includes(s)
    );
  }

  if (status) {
    users = users.filter(u => u.paymentStatus === status);
  }

  const total = users.length;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const paginated = users.slice(offset, offset + parseInt(limit));

  res.json({
    success: true,
    total,
    page: parseInt(page),
    limit: parseInt(limit),
    users: paginated
  });
});

// --- Single user detail ---
app.get('/api/admin/users/:id', adminAuth, (req, res) => {
  const users = readUsers();
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé.' });
  res.json({ success: true, user });
});

// --- Activate user ---
app.post('/api/admin/users/:id/activate', adminAuth, (req, res) => {
  const users = readUsers();
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé.' });
  user.active = true;
  saveUsers(users);
  res.json({ success: true, message: `${user.firstName} ${user.lastName} activé.` });
});

// --- Deactivate user ---
app.post('/api/admin/users/:id/deactivate', adminAuth, (req, res) => {
  const users = readUsers();
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé.' });
  user.active = false;
  saveUsers(users);
  res.json({ success: true, message: `${user.firstName} ${user.lastName} désactivé.` });
});

// --- Validate payment ---
app.post('/api/admin/users/:id/validate-payment', adminAuth, (req, res) => {
  const users = readUsers();
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé.' });
  user.paymentStatus = 'validated';
  user.paymentDate = new Date().toISOString();
  user.paymentMethod = user.paymentMethod || 'manuel';
  saveUsers(users);
  res.json({ success: true, message: `Paiement validé pour ${user.firstName} ${user.lastName}.` });
});

// --- Reject payment ---
app.post('/api/admin/users/:id/reject-payment', adminAuth, (req, res) => {
  const users = readUsers();
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé.' });
  user.paymentStatus = 'expired';
  user.paymentDate = null;
  saveUsers(users);
  res.json({ success: true, message: `Paiement rejeté pour ${user.firstName} ${user.lastName}.` });
});

// --- Delete user ---
app.delete('/api/admin/users/:id', adminAuth, (req, res) => {
  let users = readUsers();
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Utilisateur non trouvé.' });
  const deleted = users.splice(idx, 1)[0];
  saveUsers(users);
  res.json({ success: true, message: `${deleted.firstName} ${deleted.lastName} supprimé.` });
});

// --- List payments ---
app.get('/api/admin/payments', adminAuth, (_req, res) => {
  const users = readUsers();
  const payments = users.map(u => ({
    userId: u.id,
    userName: `${u.firstName} ${u.lastName}`,
    email: u.email,
    amount: u.paymentStatus === 'validated' ? 430 : 0,
    status: u.paymentStatus,
    date: u.paymentDate,
    method: u.paymentMethod,
    registrationDate: u.registrationDate
  }));
  res.json({ success: true, payments });
});

// --- Analytics ---
app.get('/api/admin/analytics', adminAuth, (_req, res) => {
  const users = readUsers();

  const totalSessions = users.reduce((s, u) => s + (u.sessions || 0), 0);
  const totalTime = users.reduce((s, u) => s + (u.timeSpentMinutes || 0), 0);
  const totalPages = users.reduce((s, u) => s + (u.pagesVisited || 0), 0);
  const totalQcm = users.reduce((s, u) => s + (u.qcmAttempts || 0), 0);
  const totalCorrect = users.reduce((s, u) => s + (u.qcmCorrect || 0), 0);

  // Average scores per bloc
  const blocScores = { bloc1: [], bloc2: [], bloc3: [], bloc4: [] };
  users.forEach(u => {
    if (u.examScores) {
      for (const [bloc, score] of Object.entries(u.examScores)) {
        if (score !== null && score !== undefined) blocScores[bloc].push(score);
      }
    }
  });
  const avgScores = {};
  for (const [bloc, scores] of Object.entries(blocScores)) {
    avgScores[bloc] = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  }

  // Most active users
  const mostActive = [...users]
    .sort((a, b) => (b.sessions || 0) - (a.sessions || 0))
    .slice(0, 10)
    .map(u => ({ id: u.id, name: `${u.firstName} ${u.lastName}`, sessions: u.sessions, timeSpent: u.timeSpentMinutes }));

  // Bloc popularity
  const blocPopularity = { bloc1: 0, bloc2: 0, bloc3: 0, bloc4: 0 };
  users.forEach(u => {
    (u.favoriteBlocs || []).forEach(b => {
      if (blocPopularity[b] !== undefined) blocPopularity[b]++;
    });
  });

  res.json({
    success: true,
    analytics: {
      totalSessions,
      totalTimeMinutes: totalTime,
      totalPages,
      totalQcmAttempts: totalQcm,
      totalQcmCorrect: totalCorrect,
      qcmSuccessRate: totalQcm > 0 ? Math.round((totalCorrect / totalQcm) * 100) : 0,
      avgScoresPerBloc: avgScores,
      mostActiveUsers: mostActive,
      blocPopularity
    }
  });
});

// --- Content stats ---
app.get('/api/admin/content', adminAuth, (_req, res) => {
  const documents = readDocuments();

  const byCategory = {};
  documents.forEach(d => {
    const cat = d.category || 'general';
    if (!byCategory[cat]) byCategory[cat] = { count: 0, totalSize: 0 };
    byCategory[cat].count++;
    byCategory[cat].totalSize += d.size || 0;
  });

  // Check annales files on disk
  const annalesDir = path.join(__dirname, 'data');
  let annalesFiles = [];
  try {
    annalesFiles = fs.readdirSync(annalesDir).filter(f => f.endsWith('.txt'));
  } catch (e) { /* ignore */ }

  res.json({
    success: true,
    content: {
      totalDocuments: documents.length,
      byCategory,
      annalesFiles: annalesFiles.length,
      annalesDetail: annalesFiles
    }
  });
});

// ============================================================================
// API : Annales (QCM + Problèmes)
// ============================================================================

// GET /api/annales — Liste toutes les annales disponibles
app.get('/api/annales', (_req, res) => {
  try {
    const allFile = path.join(DATA_DIR, 'all_annales.json');
    if (!fs.existsSync(allFile)) {
      return res.json({ success: true, annales: [] });
    }
    const annales = JSON.parse(fs.readFileSync(allFile, 'utf-8'));
    // Retourner un résumé léger (sans le texte complet des problèmes)
    const summary = annales.map(a => ({
      year: a.year,
      session: a.session,
      qcmCount: a.qcm.length,
      answeredCount: a.qcm.filter(q => q.answer).length,
      problemsCount: a.problems.length
    }));
    return res.json({ success: true, annales: summary });
  } catch (err) {
    console.error('[ERREUR ANNALES]', err.message);
    return res.status(500).json({ error: 'Erreur lors du chargement des annales.' });
  }
});

// GET /api/annales/:year — Détail d'une annale avec QCM et problèmes
app.get('/api/annales/:year', (req, res) => {
  try {
    const year = req.params.year;
    const filePath = path.join(DATA_DIR, `annales_${year}.json`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: `Annale ${year} non trouvée.` });
    }
    const annale = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return res.json({ success: true, annale });
  } catch (err) {
    console.error('[ERREUR ANNALE]', err.message);
    return res.status(500).json({ error: 'Erreur lors du chargement de l\'annale.' });
  }
});

// GET /api/cours — Cours structurés issus du build_cours_json.js
app.get('/api/cours', (_req, res) => {
  try {
    const coursFile = path.join(DATA_DIR, 'cours.json');
    if (!fs.existsSync(coursFile)) {
      return res.json({ bloc1: [], bloc2: [], bloc3: [], bloc4: [] });
    }
    const data = JSON.parse(fs.readFileSync(coursFile, 'utf-8'));
    return res.json(data);
  } catch (err) {
    console.error('[ERREUR COURS]', err.message);
    return res.status(500).json({ error: 'Erreur lors du chargement des cours.' });
  }
});

// GET /api/annales/:year/qcm — Uniquement les QCM d'une annale (pour l'entraînement)
app.get('/api/annales/:year/qcm', (req, res) => {
  try {
    const year = req.params.year;
    const filePath = path.join(DATA_DIR, `annales_${year}.json`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: `Annale ${year} non trouvée.` });
    }
    const annale = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    // En mode entraînement, ne pas envoyer les réponses
    const hideAnswers = req.query.mode === 'exam';
    const qcm = annale.qcm.map(q => {
      if (hideAnswers) {
        return { number: q.number, text: q.text, options: q.options };
      }
      return q;
    });
    return res.json({ success: true, year: annale.year, session: annale.session, qcm });
  } catch (err) {
    console.error('[ERREUR QCM]', err.message);
    return res.status(500).json({ error: 'Erreur lors du chargement des QCM.' });
  }
});

// ============================================================================
// Gestion des erreurs Multer
// ============================================================================

app.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: `Le fichier dépasse la taille maximale autorisée (${(MAX_FILE_SIZE / 1024 / 1024).toFixed(0)} Mo).`,
        code: 'FILE_TOO_LARGE'
      });
    }
    return res.status(400).json({
      error: `Erreur d'upload : ${err.message}`,
      code: 'MULTER_ERROR'
    });
  }

  if (err) {
    console.error('[ERREUR GLOBALE]', err.message);
    return res.status(500).json({
      error: 'Une erreur interne s\'est produite. Contactez le support si le problème persiste.',
      code: 'INTERNAL_ERROR',
      details: err.message
    });
  }

  next();
});

// ============================================================================
// API : Cours résumés (générés par build_resumes.js)
// ============================================================================

// GET /api/resumes — Tous les résumés (sans le contenu pour rester léger)
app.get('/api/resumes', (_req, res) => {
  try {
    const file = path.join(DATA_DIR, 'resumes.json');
    if (!fs.existsSync(file)) {
      return res.json({ success: true, resumes: [], _meta: null });
    }
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const summary = [];
    for (const k of Object.keys(data)) {
      if (k.startsWith('_')) continue;
      const b = data[k];
      summary.push({
        bloc: b.bloc,
        label: b.label,
        themes_top: b.themes_top || [],
        couverture_estimee: b.couverture_estimee,
        resume_length: (b.resume || '').length,
        fiches_count: (b.fiches_sources || []).length,
        annales_sources: b.annales_sources || [],
        generated_at: b.generated_at
      });
    }
    return res.json({ success: true, resumes: summary, _meta: data._meta || null });
  } catch (err) {
    console.error('[ERREUR RESUMES]', err.message);
    return res.status(500).json({ error: 'Erreur lors du chargement des résumés.' });
  }
});

// GET /api/resumes/:bloc — Résumé complet d'un bloc
app.get('/api/resumes/:bloc', (req, res) => {
  try {
    const bloc = req.params.bloc;
    if (!/^bloc[1-4]$/.test(bloc)) {
      return res.status(400).json({ error: 'Bloc invalide. Attendu: bloc1, bloc2, bloc3 ou bloc4.' });
    }
    const file = path.join(DATA_DIR, 'resumes.json');
    if (!fs.existsSync(file)) {
      return res.status(404).json({ error: 'Aucun résumé généré. Lance build_resumes.js.' });
    }
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!data[bloc]) {
      return res.status(404).json({ error: `Résumé ${bloc} non disponible.` });
    }
    return res.json({ success: true, ...data[bloc] });
  } catch (err) {
    console.error('[ERREUR RESUME]', err.message);
    return res.status(500).json({ error: 'Erreur lors du chargement du résumé.' });
  }
});

// GET /api/problems — Liste de tous les problèmes corrigés des annales
app.get('/api/problems', (_req, res) => {
  try {
    const file = path.join(DATA_DIR, 'all_annales.json');
    if (!fs.existsSync(file)) return res.json({ success: true, problems: [] });
    const annales = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const problems = [];
    for (const a of annales) {
      for (const p of (a.problems || [])) {
        problems.push({
          id: `${a.year}_p${p.number}`,
          year: a.year,
          session: a.session,
          number: p.number,
          title: p.title,
          subject_preview: (p.subject_text || '').substring(0, 300) + '...',
          subject_length: (p.subject_text || '').length,
          has_correction: !!(p.corrected_text && p.corrected_text.trim().length > 0)
        });
      }
    }
    return res.json({ success: true, problems });
  } catch (err) {
    console.error('[ERREUR PROBLEMS]', err.message);
    return res.status(500).json({ error: 'Erreur lors du chargement des problèmes.' });
  }
});

// GET /api/problems/:year/:num — Détail d'un problème
app.get('/api/problems/:year/:num', (req, res) => {
  try {
    const year = parseInt(req.params.year, 10);
    const num = parseInt(req.params.num, 10);
    const file = path.join(DATA_DIR, 'all_annales.json');
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'Aucune annale trouvée.' });
    const annales = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const annale = annales.find(a => a.year === year);
    if (!annale) return res.status(404).json({ error: `Annale ${year} non trouvée.` });
    const problem = (annale.problems || []).find(p => p.number === num);
    if (!problem) return res.status(404).json({ error: `Problème ${num} non trouvé.` });
    return res.json({
      success: true,
      year,
      session: annale.session,
      problem
    });
  } catch (err) {
    console.error('[ERREUR PROBLEM]', err.message);
    return res.status(500).json({ error: 'Erreur lors du chargement du problème.' });
  }
});

// POST /api/explain-problem — MAX explique un problème étape par étape
app.post('/api/explain-problem', async (req, res) => {
  try {
    const { problem, question_specifique, bloc } = req.body;
    if (!problem || (!problem.subject_text && !problem.title)) {
      return res.status(400).json({ error: 'Problème manquant ou invalide.', code: 'MISSING_PROBLEM' });
    }

    // Charger le résumé du bloc concerné comme contexte (si fourni)
    let coursContext = '';
    if (bloc && /^bloc[1-4]$/.test(bloc)) {
      const file = path.join(DATA_DIR, 'resumes.json');
      if (fs.existsSync(file)) {
        const all = JSON.parse(fs.readFileSync(file, 'utf-8'));
        if (all[bloc] && all[bloc].resume) {
          // Tronquer le cours à 12000 chars pour rester raisonnable
          coursContext = all[bloc].resume.substring(0, 12000);
        }
      }
    }

    let userPrompt = `Explique ce PROBLÈME D'EXAMEN étape par étape, comme un instructeur le ferait au tableau.\n\n`;
    userPrompt += `=== ÉNONCÉ ===\n${problem.title || ''}\n${problem.subject_text || ''}\n\n`;
    if (problem.corrected_text) {
      userPrompt += `=== CORRIGÉ OFFICIEL (référence pour vérifier ta réponse) ===\n${problem.corrected_text.substring(0, 6000)}\n\n`;
    }
    if (coursContext) {
      userPrompt += `=== EXTRAIT DU COURS (utilise-le comme source de vérité) ===\n${coursContext}\n\n`;
    }
    if (question_specifique) {
      userPrompt += `=== QUESTION DE L'ÉTUDIANT ===\n${question_specifique}\n\n`;
    } else {
      userPrompt += `Décompose le problème en étapes claires : 1) Lecture de l'énoncé et identification de la situation, 2) Notions de cours mobilisées, 3) Raisonnement étape par étape, 4) Solution finale, 5) Pièges fréquents et conseils pour l'examen.\n\n`;
    }
    userPrompt += `Sois précis, structuré, pédagogique. Cite les articles de loi quand pertinent. Donne des exemples chiffrés.`;

    console.log('[EXPLAIN-PROBLEM] Demande pour problème');

    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      temperature: 0.4,
      system: SYSTEM_PROMPT_EXPLAIN,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const explanation = stripMarkdown(response.content[0].text);

    return res.json({
      success: true,
      explanation,
      bloc_used: bloc || null,
      cours_context_used: coursContext.length > 0
    });
  } catch (err) {
    console.error('[ERREUR EXPLAIN-PROBLEM]', err.message);
    return res.status(500).json({
      error: 'Erreur lors de l\'explication du problème. Réessayez !',
      code: 'EXPLAIN_PROBLEM_ERROR',
      details: err.message
    });
  }
});

// ============================================================================
// Démarrage du serveur
// ============================================================================

app.listen(PORT, () => {
  console.log('============================================================');
  console.log('  🚛  Capacité Transport Pro — Serveur démarré');
  console.log(`  📡  Port : ${PORT}`);
  console.log(`  🌐  URL  : http://localhost:${PORT}`);
  console.log(`  📁  Uploads : ${UPLOADS_DIR}`);
  console.log(`  🔑  API Key : ${ANTHROPIC_API_KEY ? 'Configurée ✓' : 'NON CONFIGURÉE ✗'}`);
  console.log('============================================================');
});

module.exports = app;
