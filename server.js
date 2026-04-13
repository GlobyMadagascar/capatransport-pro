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

// --- Security headers ---
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
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

// --- Fichiers statiques depuis la racine du projet ---
const staticOptions = process.env.NODE_ENV === 'production'
  ? { maxAge: '1d', etag: true }
  : {};
app.use(express.static(__dirname, staticOptions));

// --- Fichiers uploadés accessibles publiquement ---
app.use('/uploads', express.static(UPLOADS_DIR));

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
const SYSTEM_PROMPT_EXPLAIN = `Tu es MAX, instructeur expert en Capacité Transport. Tel un mécanicien qui démonte chaque pièce pour l'expliquer, tu fournis des explications claires, détaillées et pédagogiques.

Ton style :
- Tu utilises des métaphores du monde du transport pour rendre les concepts concrets
- Tu donnes des exemples pratiques tirés du quotidien d'un transporteur
- Tu cites les références réglementaires précises
- Tu structures ta réponse avec des puces et des sections claires
- Tu conclus toujours par un conseil mémorable pour l'examen

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
- Encourage toujours l'étudiant à continuer ses révisions`;

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

app.post('/api/generate-questions', async (req, res) => {
  try {
    const { bloc, count, difficulty, documentContext } = req.body;

    const questionCount = count || 5;
    const questionDifficulty = difficulty || 3;

    // Construction du prompt utilisateur
    let userPrompt = `Génère exactement ${questionCount} questions d'examen`;

    if (bloc) {
      userPrompt += ` pour le Bloc ${bloc}`;
    }

    userPrompt += ` de niveau de difficulté ${questionDifficulty}/5.`;

    if (documentContext) {
      userPrompt += `\n\nBase-toi sur le contenu suivant pour créer des questions pertinentes :\n---\n${documentContext.substring(0, 20000)}\n---`;
    }

    userPrompt += '\n\nRetourne UNIQUEMENT le tableau JSON des questions, sans aucun texte supplémentaire.';

    console.log(`[QUESTIONS] Génération de ${questionCount} questions (Bloc: ${bloc || 'tous'}, Difficulté: ${questionDifficulty})`);

    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 8192,
      temperature: 0.7,
      system: SYSTEM_PROMPT_QUESTIONS,
      messages: [
        {
          role: 'user',
          content: userPrompt
        }
      ]
    });

    const responseText = response.content[0].text;

    // Parsing du tableau JSON
    let questions;
    try {
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        questions = JSON.parse(jsonMatch[0]);
      } else {
        questions = JSON.parse(responseText);
      }
    } catch (parseErr) {
      console.warn('[QUESTIONS] Réponse non-JSON, tentative de récupération');
      questions = [{ raw: responseText, error: 'Format de réponse inattendu' }];
    }

    res.json({
      success: true,
      count: Array.isArray(questions) ? questions.length : 0,
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
    const { question, reponse, options, userAnswer } = req.body;

    if (!question) {
      return res.status(400).json({
        error: 'Veuillez fournir une question à expliquer.',
        code: 'MISSING_QUESTION'
      });
    }

    let userPrompt = `Explique en détail la question suivante :\n\n**Question :** ${question}`;

    if (options && Array.isArray(options) && options.length > 0) {
      userPrompt += `\n\n**Options :**\n${options.join('\n')}`;
    }

    if (reponse) {
      userPrompt += `\n\n**Réponse correcte :** ${reponse}`;
    }

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

    const explanation = response.content[0].text;

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

    const reply = response.content[0].text;

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
