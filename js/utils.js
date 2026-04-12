/**
 * CapaTransport Pro — Module utilitaires
 * Chargé en premier, fournit les fonctions partagées par tous les modules.
 * Tout est attaché au namespace global CT.
 */

// ============================================================
// Namespace principal
// ============================================================
window.CT = window.CT || {};

// ============================================================
// 1. LocalStorage helpers  —  CT.Utils
// ============================================================
CT.Utils = CT.Utils || {};

CT.Utils.saveData = function (key, data) {
    try {
        localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
        console.warn('[CT] Impossible de sauvegarder dans le localStorage :', e);
    }
};

CT.Utils.loadData = function (key, defaultValue) {
    try {
        var raw = localStorage.getItem(key);
        if (raw === null) return defaultValue;
        return JSON.parse(raw);
    } catch (e) {
        console.warn('[CT] Impossible de lire le localStorage :', e);
        return defaultValue;
    }
};

CT.Utils.removeData = function (key) {
    try {
        localStorage.removeItem(key);
    } catch (e) {
        console.warn('[CT] Impossible de supprimer du localStorage :', e);
    }
};

// ============================================================
// 2. Toast notifications  —  CT.Toast
// ============================================================
CT.Toast = {
    _icons: {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    },

    show: function (message, type, duration) {
        type = type || 'info';
        duration = duration || 4000;

        var container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            document.body.appendChild(container);
        }

        var toast = document.createElement('div');
        toast.className = 'toast toast--' + type;

        var iconClass = CT.Toast._icons[type] || CT.Toast._icons.info;
        toast.innerHTML =
            '<i class="fas ' + iconClass + '"></i>' +
            '<span class="toast__message">' + CT.Utils.sanitize(message) + '</span>';

        container.appendChild(toast);

        // Déclencher le reflow avant d'ajouter la classe visible (animation)
        void toast.offsetWidth;
        toast.classList.add('toast--visible');

        setTimeout(function () {
            toast.classList.remove('toast--visible');
            setTimeout(function () {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 400);
        }, duration);
    }
};

// ============================================================
// 3. Loading overlay  —  CT.Loading
// ============================================================
CT.Loading = {
    show: function (message) {
        var overlay = document.getElementById('loading-overlay');
        if (!overlay) return;
        var textEl = overlay.querySelector('.loading-overlay__text');
        if (textEl && message) {
            textEl.textContent = message;
        }
        overlay.style.display = 'flex';
        overlay.classList.add('loading-overlay--visible');
    },

    hide: function () {
        var overlay = document.getElementById('loading-overlay');
        if (!overlay) return;
        overlay.classList.remove('loading-overlay--visible');
        overlay.style.display = 'none';
    }
};

// ============================================================
// 4. Modal helpers  —  CT.Modal
// ============================================================
CT.Modal = {
    show: function (modalId) {
        var modal = document.getElementById(modalId);
        if (!modal) return;
        modal.style.display = '';
        // Force reflow then add class for animation
        void modal.offsetWidth;
        modal.classList.add('modal--visible');
    },

    hide: function (modalId) {
        var modal = document.getElementById(modalId);
        if (!modal) return;
        modal.classList.remove('modal--visible');
        setTimeout(function() { modal.style.display = 'none'; }, 300);
    },

    confirm: function (title, message) {
        return new Promise(function (resolve) {
            var modal = document.getElementById('modal-confirm');
            if (!modal) {
                resolve(false);
                return;
            }

            var titleEl = modal.querySelector('.modal__title');
            var messageEl = modal.querySelector('.modal__message');
            var btnConfirm = document.getElementById('modal-confirm-btn');
            var btnCancel = modal.querySelector('[data-action="close-modal"]:not(.modal__backdrop)');
            var backdrop = modal.querySelector('.modal__backdrop');

            if (titleEl) titleEl.textContent = title || 'Confirmation';
            if (messageEl) messageEl.textContent = message || '';

            CT.Modal.show('modal-confirm');

            function cleanup(result) {
                CT.Modal.hide('modal-confirm');
                if (btnConfirm) btnConfirm.removeEventListener('click', onConfirm);
                if (btnCancel) btnCancel.removeEventListener('click', onCancel);
                if (backdrop) backdrop.removeEventListener('click', onBackdrop);
                resolve(result);
            }

            function onConfirm() { cleanup(true); }
            function onCancel() { cleanup(false); }
            function onBackdrop() { cleanup(false); }

            if (btnConfirm) btnConfirm.addEventListener('click', onConfirm);
            if (btnCancel) btnCancel.addEventListener('click', onCancel);
            if (backdrop) backdrop.addEventListener('click', onBackdrop);
        });
    }
};

// ============================================================
// 5. Date / Time helpers  —  CT.DateTime
// ============================================================
CT.DateTime = {
    formatDate: function (date) {
        if (!(date instanceof Date)) date = new Date(date);
        var d = ('0' + date.getDate()).slice(-2);
        var m = ('0' + (date.getMonth() + 1)).slice(-2);
        var y = date.getFullYear();
        return d + '/' + m + '/' + y;
    },

    formatTime: function (seconds) {
        seconds = Math.max(0, Math.floor(seconds));
        var h = ('0' + Math.floor(seconds / 3600)).slice(-2);
        var m = ('0' + Math.floor((seconds % 3600) / 60)).slice(-2);
        var s = ('0' + (seconds % 60)).slice(-2);
        return h + ':' + m + ':' + s;
    },

    daysUntil: function (dateString) {
        var target = new Date(dateString);
        var now = new Date();
        target.setHours(0, 0, 0, 0);
        now.setHours(0, 0, 0, 0);
        var diff = target.getTime() - now.getTime();
        return Math.ceil(diff / (1000 * 60 * 60 * 24));
    },

    timeAgo: function (date) {
        if (!(date instanceof Date)) date = new Date(date);
        var now = new Date();
        var diffMs = now.getTime() - date.getTime();
        var diffSec = Math.floor(diffMs / 1000);
        var diffMin = Math.floor(diffSec / 60);
        var diffH = Math.floor(diffMin / 60);
        var diffD = Math.floor(diffH / 24);
        var diffW = Math.floor(diffD / 7);
        var diffM = Math.floor(diffD / 30);

        if (diffSec < 60) return "il y a quelques secondes";
        if (diffMin === 1) return "il y a 1 minute";
        if (diffMin < 60) return "il y a " + diffMin + " minutes";
        if (diffH === 1) return "il y a 1 heure";
        if (diffH < 24) return "il y a " + diffH + " heures";
        if (diffD === 1) return "il y a 1 jour";
        if (diffD < 7) return "il y a " + diffD + " jours";
        if (diffW === 1) return "il y a 1 semaine";
        if (diffW < 5) return "il y a " + diffW + " semaines";
        if (diffM === 1) return "il y a 1 mois";
        if (diffM < 12) return "il y a " + diffM + " mois";
        return "il y a plus d'un an";
    }
};

// ============================================================
// 6. DOM helpers  —  CT.DOM
// ============================================================
CT.DOM = {
    $: function (selector) {
        return document.querySelector(selector);
    },

    $$: function (selector) {
        return document.querySelectorAll(selector);
    },

    create: function (tag, className, innerHTML) {
        var el = document.createElement(tag);
        if (className) el.className = className;
        if (innerHTML) el.innerHTML = innerHTML;
        return el;
    },

    on: function (element, event, handler) {
        if (typeof element === 'string') {
            // Délégation d'événement sur document
            document.addEventListener(event, function (e) {
                var target = e.target.closest(element);
                if (target) handler.call(target, e);
            });
        } else if (element && element.addEventListener) {
            element.addEventListener(event, handler);
        }
    }
};

// ============================================================
// 7. UUID v4 generator  —  CT.Utils.uuid()
// ============================================================
CT.Utils.uuid = function () {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = (Math.random() * 16) | 0;
        var v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
};

// ============================================================
// 8. Number formatting  —  CT.Utils
// ============================================================
CT.Utils.formatPercent = function (value) {
    return Math.round(value) + '%';
};

CT.Utils.formatDuration = function (minutes) {
    minutes = Math.round(minutes);
    if (minutes < 60) return minutes + 'min';
    var h = Math.floor(minutes / 60);
    var m = minutes % 60;
    if (m === 0) return h + 'h';
    return h + 'h ' + m + 'min';
};

// ============================================================
// 10. Sanitize HTML  —  CT.Utils.sanitize()
// ============================================================
CT.Utils.sanitize = function (str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

// ============================================================
// 11. Debounce  —  CT.Utils.debounce()
// ============================================================
CT.Utils.debounce = function (fn, delay) {
    var timer = null;
    return function () {
        var context = this;
        var args = arguments;
        clearTimeout(timer);
        timer = setTimeout(function () {
            fn.apply(context, args);
        }, delay);
    };
};

// ============================================================
// 9. Demo data  —  CT.DemoData
// ============================================================
(function () {
    // Date d'examen : 90 jours à partir d'aujourd'hui
    var examDate = new Date();
    examDate.setDate(examDate.getDate() + 90);
    var examDateISO = examDate.toISOString().split('T')[0];

    // Dates récentes pour les sessions
    function daysAgo(n) {
        var d = new Date();
        d.setDate(d.getDate() - n);
        return d.toISOString();
    }

    CT.DemoData = {
        // --- Profil utilisateur ---
        profile: {
            prenom: 'Thomas',
            region: 'ile-de-france',
            examDate: examDateISO,
            scoreGlobal: 67
        },

        // --- Scores par bloc ---
        blocScores: {
            bloc1: 72,
            bloc2: 58,
            bloc3: 74,
            bloc4: 65
        },

        // --- Sessions récentes ---
        recentSessions: [
            { id: 'sess-001', date: daysAgo(1),  score: 72, type: 'Entraînement Bloc 2 — RETM',              nbQuestions: 20, duree: 35 },
            { id: 'sess-002', date: daysAgo(3),  score: 65, type: 'Examen blanc complet',                     nbQuestions: 50, duree: 90 },
            { id: 'sess-003', date: daysAgo(5),  score: 80, type: 'Entraînement Bloc 1 — Droit civil',        nbQuestions: 15, duree: 25 },
            { id: 'sess-004', date: daysAgo(8),  score: 55, type: 'Entraînement Bloc 3 — Gestion financière', nbQuestions: 20, duree: 40 },
            { id: 'sess-005', date: daysAgo(12), score: 70, type: 'Entraînement Bloc 4 — International',      nbQuestions: 15, duree: 28 }
        ],

        // --- Points faibles ---
        weakPoints: [
            { name: 'Temps de conduite et de repos (CE 561/2006)', score: 42 },
            { name: 'Prix de revient kilométrique',                score: 48 },
            { name: 'Incoterms 2020 — transfert des risques',     score: 51 },
            { name: 'Responsabilité du transporteur (CMR)',        score: 53 }
        ],

        // --- 20 questions démo (5 par bloc) ---
        demoQuestions: [
            // ────────────────────────────────────────
            // BLOC 1 — Droit civil, commercial et social
            // ────────────────────────────────────────
            {
                id: 'q-b1-01',
                type: 'qcm',
                bloc: '1',
                theme: 'Contrat de transport',
                difficulte: 'moyen',
                question: "Selon l'article L. 1432-2 du Code des transports, à quel moment le contrat de transport de marchandises est-il réputé conclu ?",
                contexte: "Le contrat de transport est un contrat commercial encadré par le Code des transports et le Code de commerce.",
                choix: [
                    "A. Dès la remise de la marchandise au transporteur",
                    "B. Dès l'acceptation de la commande de transport par le transporteur",
                    "C. Au moment du chargement effectif du véhicule",
                    "D. À la signature de la lettre de voiture"
                ],
                bonne_reponse: 'B',
                explication: "Le contrat de transport est un contrat consensuel : il est formé dès l'échange des consentements, c'est-à-dire dès que le transporteur accepte la commande de transport (article L. 1432-2 du Code des transports). La lettre de voiture n'est qu'un document probatoire, pas une condition de formation.",
                reference: 'Article L. 1432-2 du Code des transports',
                astuce: "Retenez : le contrat de transport est consensuel (accord de volontés), pas solennel (pas besoin d'écrit pour sa validité).",
                frequence_examen: 'élevée'
            },
            {
                id: 'q-b1-02',
                type: 'qcm',
                bloc: '1',
                theme: 'Responsabilité du transporteur',
                difficulte: 'difficile',
                question: "Dans le cadre d'un transport national, le transporteur peut s'exonérer de sa responsabilité pour avarie. Parmi les cas suivants, lequel n'est PAS un cas d'exonération reconnu ?",
                contexte: "La responsabilité du transporteur routier est une responsabilité de plein droit, mais elle connaît des cas d'exonération limitativement énumérés.",
                choix: [
                    "A. La force majeure",
                    "B. Le vice propre de la marchandise",
                    "C. Le retard dû aux embouteillages",
                    "D. La faute de l'expéditeur"
                ],
                bonne_reponse: 'C',
                explication: "Les cas d'exonération du transporteur sont : la force majeure, le vice propre de la marchandise et la faute de l'ayant droit (expéditeur/destinataire). Les embouteillages sont un aléa prévisible du transport routier et ne constituent ni un cas de force majeure ni un cas d'exonération.",
                reference: 'Article L. 133-1 du Code de commerce',
                astuce: "Les 3 cas d'exonération : Force majeure, Vice propre, Faute de l'ayant droit. Moyen mnémotechnique : FVF.",
                frequence_examen: 'très élevée'
            },
            {
                id: 'q-b1-03',
                type: 'qcm',
                bloc: '1',
                theme: 'Droit social — durée du travail',
                difficulte: 'moyen',
                question: "Quelle est la durée maximale hebdomadaire de travail pour un conducteur routier de marchandises sur une semaine isolée ?",
                contexte: "Le droit social des conducteurs routiers est encadré par le Code du travail et le décret n° 83-40 du 26 janvier 1983 modifié.",
                choix: [
                    "A. 44 heures",
                    "B. 48 heures",
                    "C. 52 heures",
                    "D. 56 heures"
                ],
                bonne_reponse: 'C',
                explication: "La durée maximale hebdomadaire de travail d'un conducteur routier est de 52 heures sur une semaine isolée (dérogation transport) et 48 heures en moyenne sur un trimestre. Attention à ne pas confondre avec le temps de conduite maximum (56h / semaine selon le règlement CE 561/2006).",
                reference: 'Décret n° 83-40 du 26 janvier 1983, article 5',
                astuce: "Temps de travail : 52h/semaine isolée, 48h/moyenne. Temps de conduite : 56h/semaine, 90h/quinzaine. Ne pas confondre !",
                frequence_examen: 'très élevée'
            },
            {
                id: 'q-b1-04',
                type: 'qcm',
                bloc: '1',
                theme: 'Contrat type — sous-traitance',
                difficulte: 'facile',
                question: "Qui est responsable vis-à-vis de l'expéditeur en cas de sous-traitance du transport ?",
                contexte: "Un commissionnaire de transport confie l'exécution d'un transport à un sous-traitant. La marchandise est endommagée pendant le transport.",
                choix: [
                    "A. Uniquement le sous-traitant qui a réalisé le transport",
                    "B. Le commissionnaire de transport, garant de ses substitués",
                    "C. L'expéditeur, car il a accepté la sous-traitance",
                    "D. Le destinataire, en tant que bénéficiaire du contrat"
                ],
                bonne_reponse: 'B',
                explication: "Le commissionnaire de transport est garant du fait de ses substitués (article L. 1432-9 du Code des transports). Il répond de la bonne exécution du transport vis-à-vis de son donneur d'ordre, même s'il a confié l'exécution à un sous-traitant.",
                reference: 'Article L. 1432-9 du Code des transports',
                astuce: "Le commissionnaire est un « garant » : il assume la responsabilité complète de la chaîne de transport vis-à-vis de son client.",
                frequence_examen: 'élevée'
            },
            {
                id: 'q-b1-05',
                type: 'qcm',
                bloc: '1',
                theme: 'Prescription',
                difficulte: 'moyen',
                question: "Quel est le délai de prescription pour une action en responsabilité résultant d'un contrat de transport national de marchandises ?",
                contexte: "Après livraison d'une marchandise endommagée, le destinataire souhaite engager la responsabilité du transporteur.",
                choix: [
                    "A. 6 mois",
                    "B. 1 an",
                    "C. 2 ans",
                    "D. 5 ans"
                ],
                bonne_reponse: 'B',
                explication: "Le délai de prescription des actions nées du contrat de transport est d'un an à compter de la livraison (ou de la date à laquelle la livraison aurait dû avoir lieu en cas de perte). Ce délai est fixé par l'article L. 133-6 du Code de commerce.",
                reference: 'Article L. 133-6 du Code de commerce',
                astuce: "Prescription transport national = 1 an. Transport international CMR = 1 an également (article 32 CMR). Attention, en droit commun commercial c'est 5 ans.",
                frequence_examen: 'élevée'
            },

            // ────────────────────────────────────────
            // BLOC 2 — Réglementation et exploitation technique des transports (RETM)
            // ────────────────────────────────────────
            {
                id: 'q-b2-01',
                type: 'qcm',
                bloc: '2',
                theme: 'Temps de conduite — CE 561/2006',
                difficulte: 'moyen',
                question: "Selon le règlement (CE) n° 561/2006, quelle est la durée maximale de conduite journalière ?",
                contexte: "Un conducteur routier effectue un trajet longue distance et doit respecter les temps de conduite réglementaires.",
                choix: [
                    "A. 8 heures, extensible à 9 heures",
                    "B. 9 heures, extensible à 10 heures deux fois par semaine",
                    "C. 10 heures sans possibilité d'extension",
                    "D. 9 heures sans possibilité d'extension"
                ],
                bonne_reponse: 'B',
                explication: "Le règlement CE 561/2006 (article 6§1) fixe la durée maximale de conduite journalière à 9 heures, avec possibilité d'extension à 10 heures deux fois au cours d'une même semaine. C'est une question classique de l'examen.",
                reference: 'Règlement (CE) n° 561/2006, article 6, paragraphe 1',
                astuce: "9h/jour (10h x 2/semaine), 56h/semaine, 90h/quinzaine. Pause : 45 min après 4h30 de conduite (fractionnable 15+30).",
                frequence_examen: 'très élevée'
            },
            {
                id: 'q-b2-02',
                type: 'qcm',
                bloc: '2',
                theme: 'Tachygraphe',
                difficulte: 'difficile',
                question: "Quelle est la tolérance maximale autorisée pour un tachygraphe numérique en termes de précision de la vitesse ?",
                contexte: "Lors d'un contrôle routier, un agent vérifie la conformité du tachygraphe numérique installé dans le véhicule.",
                choix: [
                    "A. ± 2 km/h",
                    "B. ± 4 km/h",
                    "C. ± 6 km/h",
                    "D. ± 10 km/h"
                ],
                bonne_reponse: 'C',
                explication: "Le règlement (UE) n° 165/2014 et ses annexes fixent la tolérance de mesure de la vitesse du tachygraphe numérique à ± 6 km/h. Cette tolérance intègre l'erreur de mesure du capteur et l'usure des pneumatiques.",
                reference: 'Règlement (UE) n° 165/2014, annexe I C',
                astuce: "Tolérance tachygraphe : ± 6 km/h pour la vitesse, ± 4 % pour la distance. Inspection obligatoire tous les 2 ans.",
                frequence_examen: 'moyenne'
            },
            {
                id: 'q-b2-03',
                type: 'qcm',
                bloc: '2',
                theme: 'PTAC et PMA',
                difficulte: 'moyen',
                question: "Quel est le Poids Total Roulant Autorisé (PTRA) maximal pour un ensemble articulé à 5 essieux en France ?",
                contexte: "Un transporteur planifie un chargement pour un tracteur semi-remorque à 5 essieux circulant sur le réseau routier français.",
                choix: [
                    "A. 38 tonnes",
                    "B. 40 tonnes",
                    "C. 42 tonnes",
                    "D. 44 tonnes"
                ],
                bonne_reponse: 'B',
                explication: "En France, le PTRA maximal pour un ensemble articulé à 5 essieux est de 40 tonnes (article R. 312-4 du Code de la route). Le passage à 44 tonnes est possible uniquement pour les ensembles à 5 essieux ou plus avec suspension pneumatique dans le cadre du transport combiné, ou pour les 6 essieux.",
                reference: 'Article R. 312-4 du Code de la route',
                astuce: "5 essieux = 40 t. 44 t uniquement si transport combiné rail-route ou 6 essieux (sous conditions). Surcharge = contravention de 4e classe.",
                frequence_examen: 'très élevée'
            },
            {
                id: 'q-b2-04',
                type: 'qcm',
                bloc: '2',
                theme: 'Documents de transport',
                difficulte: 'facile',
                question: "Combien d'exemplaires originaux de la lettre de voiture nationale doivent être établis ?",
                contexte: "Un transporteur charge des marchandises et doit établir les documents de transport réglementaires pour un trajet national.",
                choix: [
                    "A. 1 exemplaire",
                    "B. 2 exemplaires",
                    "C. 3 exemplaires",
                    "D. 4 exemplaires"
                ],
                bonne_reponse: 'C',
                explication: "La lettre de voiture nationale est établie en 3 exemplaires originaux : un pour l'expéditeur, un qui accompagne la marchandise (remis au destinataire) et un conservé par le transporteur. C'est un document probatoire du contrat de transport.",
                reference: 'Contrat type général (décret n° 2017-461)',
                astuce: "Lettre de voiture nationale = 3 exemplaires. Lettre de voiture CMR (international) = 3 exemplaires également (article 5 CMR).",
                frequence_examen: 'élevée'
            },
            {
                id: 'q-b2-05',
                type: 'qcm',
                bloc: '2',
                theme: 'Temps de repos',
                difficulte: 'difficile',
                question: "Selon le règlement (CE) n° 561/2006, combien de repos journaliers réduits un conducteur peut-il prendre entre deux repos hebdomadaires ?",
                contexte: "Un conducteur effectue des trajets sur plusieurs jours et planifie ses repos conformément à la réglementation européenne.",
                choix: [
                    "A. Un maximum de 2 repos réduits",
                    "B. Un maximum de 3 repos réduits",
                    "C. Un maximum de 4 repos réduits",
                    "D. Aucune limite, tant que la durée minimale de 9h est respectée"
                ],
                bonne_reponse: 'B',
                explication: "Le règlement CE 561/2006 (article 8§4) autorise un maximum de 3 repos journaliers réduits (minimum 9 heures consécutives au lieu de 11 heures) entre deux repos hebdomadaires. Cette règle est fréquemment contrôlée.",
                reference: 'Règlement (CE) n° 561/2006, article 8, paragraphe 4',
                astuce: "Repos journalier normal = 11h (fractionnable 3h + 9h). Repos réduit = 9h minimum. Maximum 3 repos réduits entre 2 repos hebdomadaires.",
                frequence_examen: 'très élevée'
            },

            // ────────────────────────────────────────
            // BLOC 3 — Gestion commerciale et financière
            // ────────────────────────────────────────
            {
                id: 'q-b3-01',
                type: 'qcm',
                bloc: '3',
                theme: 'Prix de revient kilométrique',
                difficulte: 'moyen',
                question: "Dans le calcul du prix de revient kilométrique d'un véhicule, lequel de ces postes est un coût variable ?",
                contexte: "Un gestionnaire de flotte calcule le prix de revient d'un ensemble articulé parcourant 120 000 km par an.",
                choix: [
                    "A. L'assurance du véhicule",
                    "B. La taxe à l'essieu",
                    "C. Le carburant",
                    "D. L'amortissement du véhicule"
                ],
                bonne_reponse: 'C',
                explication: "Le carburant (gazole) est un coût variable car il dépend directement du kilométrage parcouru. L'assurance, la taxe à l'essieu et l'amortissement sont des charges fixes indépendantes de l'activité kilométrique.",
                reference: 'Méthodologie CNR (Comité National Routier)',
                astuce: "Coûts variables : carburant, pneumatiques, entretien-réparations, péages. Coûts fixes : assurance, taxes, amortissement, financement.",
                frequence_examen: 'très élevée'
            },
            {
                id: 'q-b3-02',
                type: 'qcm',
                bloc: '3',
                theme: 'Bilan comptable',
                difficulte: 'moyen',
                question: "Dans le bilan d'une entreprise de transport, où se classent les véhicules ?",
                contexte: "Un dirigeant d'entreprise de transport analyse son bilan comptable de fin d'exercice.",
                choix: [
                    "A. Actif circulant",
                    "B. Actif immobilisé corporel",
                    "C. Passif — capitaux propres",
                    "D. Passif — dettes à long terme"
                ],
                bonne_reponse: 'B',
                explication: "Les véhicules sont des immobilisations corporelles inscrites à l'actif du bilan. Ils figurent dans la catégorie « matériel de transport » des immobilisations corporelles et sont amortis sur leur durée d'utilisation (généralement 4 à 6 ans).",
                reference: 'Plan Comptable Général, comptes 2182 et 2184',
                astuce: "Actif immobilisé : biens durables (véhicules, bâtiments). Actif circulant : biens qui se renouvellent (stocks, créances clients, trésorerie).",
                frequence_examen: 'élevée'
            },
            {
                id: 'q-b3-03',
                type: 'qcm',
                bloc: '3',
                theme: 'Compte de résultat',
                difficulte: 'difficile',
                question: "Quel indicateur du compte de résultat mesure la performance de l'exploitation avant prise en compte de la politique financière et fiscale ?",
                contexte: "Le directeur financier d'une société de transport analyse la rentabilité opérationnelle de l'entreprise.",
                choix: [
                    "A. Le résultat net",
                    "B. Le résultat financier",
                    "C. Le résultat d'exploitation",
                    "D. La capacité d'autofinancement"
                ],
                bonne_reponse: 'C',
                explication: "Le résultat d'exploitation mesure la performance de l'activité courante de l'entreprise, indépendamment de sa politique de financement (résultat financier) et de la fiscalité (impôt sur les sociétés). C'est l'indicateur clé de la rentabilité opérationnelle.",
                reference: 'Plan Comptable Général, liasse fiscale (2050-2059)',
                astuce: "Résultat d'exploitation = produits d'exploitation - charges d'exploitation. Il exclut le financier, l'exceptionnel et l'impôt.",
                frequence_examen: 'élevée'
            },
            {
                id: 'q-b3-04',
                type: 'qcm',
                bloc: '3',
                theme: 'TVA',
                difficulte: 'facile',
                question: "Quel est le taux normal de TVA applicable aux prestations de transport routier de marchandises en France métropolitaine ?",
                contexte: "Une entreprise de transport établit une facture pour une prestation de transport national.",
                choix: [
                    "A. 5,5 %",
                    "B. 10 %",
                    "C. 15 %",
                    "D. 20 %"
                ],
                bonne_reponse: 'D',
                explication: "Le transport routier de marchandises est soumis au taux normal de TVA de 20 % en France métropolitaine (article 278 du Code général des impôts). Le taux réduit de 10 % s'applique au transport de voyageurs.",
                reference: 'Article 278 du Code général des impôts',
                astuce: "Transport de marchandises = 20 %. Transport de voyageurs = 10 %. Attention : transport international souvent exonéré de TVA.",
                frequence_examen: 'élevée'
            },
            {
                id: 'q-b3-05',
                type: 'qcm',
                bloc: '3',
                theme: 'Seuil de rentabilité',
                difficulte: 'difficile',
                question: "Une entreprise de transport a des charges fixes annuelles de 300 000 € et un taux de marge sur coûts variables de 40 %. Quel est son seuil de rentabilité ?",
                contexte: "Le contrôleur de gestion analyse le point mort de l'entreprise pour l'exercice en cours.",
                choix: [
                    "A. 450 000 €",
                    "B. 600 000 €",
                    "C. 750 000 €",
                    "D. 900 000 €"
                ],
                bonne_reponse: 'C',
                explication: "Le seuil de rentabilité = Charges fixes / Taux de marge sur coûts variables = 300 000 / 0,40 = 750 000 €. L'entreprise doit donc réaliser 750 000 € de chiffre d'affaires pour couvrir l'ensemble de ses charges.",
                reference: 'Analyse financière — calcul du point mort',
                astuce: "Seuil de rentabilité = CF / Taux de MCV. Si MCV = 40 %, alors chaque euro de CA génère 0,40 € pour couvrir les charges fixes.",
                frequence_examen: 'moyenne'
            },

            // ────────────────────────────────────────
            // BLOC 4 — Transport international
            // ────────────────────────────────────────
            {
                id: 'q-b4-01',
                type: 'qcm',
                bloc: '4',
                theme: 'Incoterms 2020',
                difficulte: 'moyen',
                question: "Selon les Incoterms 2020, avec la règle FCA (Free Carrier), à quel moment le transfert des risques s'opère-t-il ?",
                contexte: "Un exportateur français vend des marchandises à un acheteur allemand en FCA, point de départ l'usine du vendeur.",
                choix: [
                    "A. Au moment du chargement sur le navire",
                    "B. Lorsque la marchandise est remise au premier transporteur désigné par l'acheteur",
                    "C. À la livraison au domicile de l'acheteur",
                    "D. Au passage de la frontière"
                ],
                bonne_reponse: 'B',
                explication: "En FCA (Free Carrier), le vendeur livre la marchandise au transporteur ou à une autre personne désignée par l'acheteur, au lieu convenu. Le transfert des risques s'opère à ce moment précis. Si le lieu est les locaux du vendeur, le risque passe au chargement sur le véhicule de collecte.",
                reference: 'Incoterms 2020, ICC — règle FCA',
                astuce: "FCA : le vendeur dédouane à l'export et livre au transporteur choisi par l'acheteur. Le risque passe à la remise au transporteur.",
                frequence_examen: 'très élevée'
            },
            {
                id: 'q-b4-02',
                type: 'qcm',
                bloc: '4',
                theme: 'Convention CMR',
                difficulte: 'moyen',
                question: "Selon la Convention CMR, quel est le plafond d'indemnisation en cas de perte totale ou partielle de la marchandise ?",
                contexte: "Un chargement de marchandises est perdu lors d'un transport international France-Italie couvert par une lettre de voiture CMR.",
                choix: [
                    "A. 8,33 DTS par kilogramme de poids brut manquant",
                    "B. 10 € par kilogramme de poids brut manquant",
                    "C. La valeur déclarée de la marchandise sans limite",
                    "D. 25 € par kilogramme de poids brut manquant"
                ],
                bonne_reponse: 'A',
                explication: "La Convention CMR (article 23§3) fixe le plafond d'indemnisation à 8,33 DTS (Droits de Tirage Spéciaux) par kilogramme de poids brut de marchandise manquante ou endommagée. Ce plafond peut être dépassé uniquement en cas de déclaration de valeur ou d'intérêt spécial à la livraison.",
                reference: 'Convention CMR, article 23, paragraphe 3',
                astuce: "CMR : 8,33 DTS/kg brut. Pour dépasser ce plafond : déclaration de valeur (art. 24) ou déclaration d'intérêt spécial à la livraison (art. 26).",
                frequence_examen: 'très élevée'
            },
            {
                id: 'q-b4-03',
                type: 'qcm',
                bloc: '4',
                theme: 'Assurance transport',
                difficulte: 'moyen',
                question: "Dans une police d'assurance transport de marchandises, que couvre la garantie « tous risques » (police tous risques) ?",
                contexte: "Un commissionnaire de transport souscrit une assurance pour des marchandises transportées à l'international.",
                choix: [
                    "A. Uniquement les risques nommés dans le contrat",
                    "B. Tous les dommages et pertes matériels, sauf les exclusions expressément mentionnées",
                    "C. Uniquement les risques liés aux accidents de la route",
                    "D. Tous les risques y compris la guerre et les grèves"
                ],
                bonne_reponse: 'B',
                explication: "La garantie « tous risques » couvre tous les dommages et pertes matériels subis par la marchandise, à l'exception des exclusions expressément mentionnées dans la police (vice propre, insuffisance d'emballage, faute intentionnelle de l'assuré, guerre, grève sauf extension).",
                reference: 'Imprimés des assureurs français — Police tous risques',
                astuce: "Tous risques ≠ tout est couvert. Les exclusions classiques restent : vice propre, guerre, grève, faute intentionnelle. Il faut lire les exclusions !",
                frequence_examen: 'élevée'
            },
            {
                id: 'q-b4-04',
                type: 'qcm',
                bloc: '4',
                theme: 'Douane — régimes',
                difficulte: 'difficile',
                question: "Qu'est-ce que le régime du transit communautaire T1 ?",
                contexte: "Un transporteur achemine des marchandises en provenance de Turquie à travers l'Union européenne à destination de la Suisse.",
                choix: [
                    "A. Un régime de transit pour les marchandises communautaires circulant entre deux points du territoire douanier de l'UE",
                    "B. Un régime de transit pour les marchandises non-communautaires circulant sous douane à travers le territoire de l'UE",
                    "C. Un régime d'exportation temporaire",
                    "D. Un régime de perfectionnement actif"
                ],
                bonne_reponse: 'B',
                explication: "Le transit T1 (transit externe) permet la circulation de marchandises non-communautaires (tierces) à travers le territoire douanier de l'UE sans paiement des droits de douane et de la TVA. Le T2 (transit interne) concerne les marchandises communautaires.",
                reference: 'Code des douanes de l\'Union (CDU), articles 226-236',
                astuce: "T1 = marchandises non-UE (transit externe). T2 = marchandises UE (transit interne). Le transit suspend les droits et taxes.",
                frequence_examen: 'élevée'
            },
            {
                id: 'q-b4-05',
                type: 'qcm',
                bloc: '4',
                theme: 'Cabotage',
                difficulte: 'moyen',
                question: "Selon le règlement (CE) n° 1072/2009, combien d'opérations de cabotage un transporteur non-résident peut-il effectuer dans un État membre de l'UE ?",
                contexte: "Un transporteur polonais livre une marchandise en France puis souhaite effectuer des transports intérieurs français avant de repartir.",
                choix: [
                    "A. 1 opération dans les 3 jours suivant le déchargement international",
                    "B. 3 opérations dans les 7 jours suivant le déchargement international",
                    "C. 5 opérations dans les 14 jours suivant le déchargement international",
                    "D. Aucune limite, dans le cadre de la libre prestation de services"
                ],
                bonne_reponse: 'B',
                explication: "Le règlement (CE) n° 1072/2009 (article 8) autorise un transporteur non-résident à effectuer jusqu'à 3 opérations de cabotage dans un délai de 7 jours suivant le déchargement complet de la livraison internationale ayant permis l'entrée dans l'État membre.",
                reference: 'Règlement (CE) n° 1072/2009, article 8',
                astuce: "Règle du cabotage : 3 opérations en 7 jours après le déchargement international. Au-delà, c'est du cabotage illégal (sanctions lourdes).",
                frequence_examen: 'très élevée'
            }
        ]
    };
})();

// ============================================================
// Initialisation — message console
// ============================================================
console.log('[CapaTransport Pro] Module utilitaires chargé.');
