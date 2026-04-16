/**
 * CapaTransport Pro - Contr\u00f4leur principal de l'application
 * Charg\u00e9 en dernier, apr\u00e8s utils.js, api.js, documents.js, exam.js, dashboard.js
 */

window.CT = window.CT || {};

CT.App = (function () {

    // =========================================================================
    // State
    // =========================================================================

    var state = {
        currentPage: 'dashboard',
        user: null,
        sidebarOpen: false,
        selectedSessionType: null,
        selectedBloc: null,
        selectedDifficulty: 'melange',
        chatHistory: []
    };

    // =========================================================================
    // Raccourcis DOM
    // =========================================================================

    function $(id) { return document.getElementById(id); }
    function qs(sel) { return document.querySelector(sel); }
    function qsa(sel) { return document.querySelectorAll(sel); }

    // =========================================================================
    // Titres des pages
    // =========================================================================

    var PAGE_TITLES = {
        dashboard:  'Tableau de bord',
        training:   'Entra\u00eenement',
        exam:       'Examen en cours',
        library:    'Annales & Cours',
        chat:       'Chat avec MAX',
        stats:      'Statistiques',
        settings:   'Param\u00e8tres'
    };

    // Dur\u00e9e du mode invit\u00e9 : 15 minutes
    var GUEST_DURATION_MS = 15 * 60 * 1000;
    var guestTimerInterval = null;

    // ---------- Device fingerprint (survit au clear cache via server) ----------
    function generateFingerprint() {
        var parts = [];
        parts.push(navigator.userAgent || '');
        parts.push(navigator.language || '');
        parts.push(screen.width + 'x' + screen.height + 'x' + screen.colorDepth);
        parts.push(new Date().getTimezoneOffset());
        parts.push(navigator.hardwareConcurrency || 0);
        parts.push(navigator.platform || '');
        // Canvas fingerprint
        try {
            var canvas = document.createElement('canvas');
            var ctx = canvas.getContext('2d');
            canvas.width = 200; canvas.height = 50;
            ctx.textBaseline = 'top';
            ctx.font = '14px Arial';
            ctx.fillStyle = '#f60';
            ctx.fillRect(125, 1, 62, 20);
            ctx.fillStyle = '#069';
            ctx.fillText('CapaTransport', 2, 15);
            ctx.fillStyle = 'rgba(102,204,0,0.7)';
            ctx.fillText('fingerprint', 4, 35);
            parts.push(canvas.toDataURL());
        } catch (e) { parts.push('no-canvas'); }
        // Simple hash
        var str = parts.join('|||');
        var hash = 0;
        for (var i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash = hash & hash; // 32-bit
        }
        // Create a longer hex string for reliability
        var h1 = Math.abs(hash).toString(16);
        var h2 = Math.abs(hash * 31 + str.length).toString(16);
        var h3 = Math.abs(hash * 17 + parts[2].length).toString(16);
        return 'ct-' + h1 + '-' + h2 + '-' + h3;
    }

    function getDeviceFingerprint() {
        // Try multiple storage mechanisms
        var fp = null;
        try { fp = localStorage.getItem('ct_device_fp'); } catch(e) {}
        if (!fp) try { fp = sessionStorage.getItem('ct_device_fp'); } catch(e) {}
        if (!fp) {
            // Check cookie
            var match = document.cookie.match(/ct_device_fp=([^;]+)/);
            if (match) fp = match[1];
        }
        if (!fp) {
            fp = generateFingerprint();
        }
        // Persist everywhere
        try { localStorage.setItem('ct_device_fp', fp); } catch(e) {}
        try { sessionStorage.setItem('ct_device_fp', fp); } catch(e) {}
        try { document.cookie = 'ct_device_fp=' + fp + ';path=/;max-age=' + (365*86400) + ';SameSite=Lax'; } catch(e) {}
        return fp;
    }

    // =========================================================================
    // R\u00e9ponses d\u00e9mo du chat MAX (hors-ligne)
    // =========================================================================

    var DEMO_RESPONSES = {
        ptac:      "Le PTAC (Poids Total Autoris\u00e9 en Charge) est le poids maximal qu\u2019un v\u00e9hicule peut atteindre en charge. Pour un porteur, il est indiqu\u00e9 sur le certificat d\u2019immatriculation (case F2). Au-del\u00e0 de 3,5 tonnes, la r\u00e9glementation transport de marchandises s\u2019applique.",
        conduite:  "En transport routier de marchandises, les temps de conduite sont r\u00e9gis par le r\u00e8glement CE 561/2006 : 9 h de conduite par jour (extensible \u00e0 10 h deux fois par semaine), repos journalier de 11 h (r\u00e9ductible \u00e0 9 h trois fois par semaine) et pause de 45 min apr\u00e8s 4 h 30 de conduite.",
        incoterm:  "Les Incoterms sont des r\u00e8gles publi\u00e9es par la CCI qui d\u00e9finissent les responsabilit\u00e9s vendeur/acheteur. En transport routier, les plus courants sont EXW (d\u00e9part usine), FCA (franco transporteur), CPT (port pay\u00e9), CIP (port + assurance pay\u00e9s) et DAP (rendu au lieu de destination).",
        cmr:       "La lettre de voiture CMR est le document de transport international routier r\u00e9gi par la Convention de Gen\u00e8ve de 1956. Elle est \u00e9tablie en 3 exemplaires originaux (exp\u00e9diteur, transporteur, destinataire) et fait foi du contrat de transport, de la prise en charge et de la livraison.",
        bilan:     "Le bilan comptable pr\u00e9sente la situation financi\u00e8re de l\u2019entreprise \u00e0 un instant donn\u00e9. L\u2019actif (ce que l\u2019entreprise poss\u00e8de) doit toujours \u00eatre \u00e9gal au passif (ce qu\u2019elle doit). Les principaux postes sont : immobilisations, stocks, cr\u00e9ances \u00e0 l\u2019actif ; capitaux propres, dettes \u00e0 long et court terme au passif.",
        tva:       "La TVA (Taxe sur la Valeur Ajout\u00e9e) est un imp\u00f4t indirect collect\u00e9 par les entreprises. Le taux normal est de 20 %. En transport, la TVA est d\u00e9ductible sur les achats professionnels (carburant, pi\u00e8ces, etc.). La d\u00e9claration se fait mensuellement ou trimestriellement via le formulaire CA3."
    };

    var DEMO_DEFAULT = "Je suis MAX, ton assistant pour la pr\u00e9paration \u00e0 l\u2019examen Capacit\u00e9 de Transport. Pose-moi tes questions sur la r\u00e9glementation, la gestion financi\u00e8re, le droit des transports ou tout autre sujet du programme !";

    // =========================================================================
    // 1. init() - Point d'entr\u00e9e principal
    // =========================================================================

    function init() {
        // V\u00e9rifier le profil local en premier
        var localProfile = CT.Utils.loadData('ct_profile', null);

        // Firebase auth state listener
        if (typeof firebase !== 'undefined' && firebase.auth) {
            try {
                firebase.auth().onAuthStateChanged(function (firebaseUser) {
                    if (firebaseUser) {
                        loadFirestoreProfile(firebaseUser).then(function () {
                            hideLoading();
                            initApp();
                        }).catch(function () {
                            // Firestore \u00e9chou\u00e9, utiliser profil local
                            if (localProfile) {
                                state.user = localProfile;
                                hideLoading();
                                initApp();
                            } else {
                                hideLoading();
                                showAuthModal();
                            }
                        });
                    } else {
                        // Pas de user Firebase, v\u00e9rifier localStorage
                        if (localProfile) {
                            state.user = localProfile;
                            hideLoading();
                            initApp();
                        } else {
                            hideLoading();
                            showAuthModal();
                        }
                    }
                });
            } catch (e) {
                // Firebase non disponible
                if (localProfile) {
                    state.user = localProfile;
                    hideLoading();
                    initApp();
                } else {
                    hideLoading();
                    showAuthModal();
                }
            }
        } else {
            // Pas de Firebase
            if (localProfile) {
                state.user = localProfile;
                hideLoading();
                initApp();
            } else {
                hideLoading();
                showAuthModal();
            }
        }

        // Attacher tous les \u00e9couteurs d'\u00e9v\u00e9nements
        setupEventListeners();
    }

    // =========================================================================
    // 2. loadFirestoreProfile()
    // =========================================================================

    function loadFirestoreProfile(firebaseUser) {
        return new Promise(function (resolve, reject) {
            try {
                var db = firebase.firestore();
                db.collection('users').doc(firebaseUser.uid).get().then(function (doc) {
                    if (doc.exists) {
                        var data = doc.data();
                        state.user = {
                            uid: firebaseUser.uid,
                            prenom: data.prenom || 'Candidat',
                            email: firebaseUser.email || '',
                            region: data.region || '',
                            examDate: data.examDate || '',
                            isGuest: false
                        };
                    } else {
                        state.user = {
                            uid: firebaseUser.uid,
                            prenom: 'Candidat',
                            email: firebaseUser.email || '',
                            region: '',
                            examDate: '',
                            isGuest: false
                        };
                    }
                    CT.Utils.saveData('ct_profile', state.user);
                    resolve();
                }).catch(function (err) {
                    console.warn('[CT.App] Erreur Firestore :', err);
                    reject(err);
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    // =========================================================================
    // 3. initApp()
    // =========================================================================

    function initApp() {
        if (!state.user) return;

        // Si invité : vérifier côté serveur si l'essai est encore valide
        if (state.user.isGuest && !state.user.guestPaid) {
            var fp = state.user.deviceFp || getDeviceFingerprint();
            fetch('/api/trial/check?fp=' + encodeURIComponent(fp))
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.reason === 'paid') return; // accès payé, ok
                    if (!data.allowed) {
                        handleGuestExpired();
                        return;
                    }
                    // Recalculer startedAt à partir du remaining
                    if (data.remainingMs > 0) {
                        state.user.guestStartedAt = Date.now() - (GUEST_DURATION_MS - data.remainingMs);
                        startGuestCountdown();
                    }
                })
                .catch(function() {
                    // Hors ligne : fallback local
                    var started = state.user.guestStartedAt || CT.Utils.loadData('ct_guest_started_at', null);
                    if (started) {
                        var elapsed = Date.now() - started;
                        if (elapsed >= GUEST_DURATION_MS) {
                            handleGuestExpired();
                            return;
                        }
                        startGuestCountdown();
                    }
                });
        }

        // Mettre \u00e0 jour l'interface avec les infos utilisateur
        updateUserUI();

        // Initialiser le tableau de bord
        if (CT.Dashboard && typeof CT.Dashboard.init === 'function') {
            try { CT.Dashboard.init(); } catch (e) { console.warn('[CT.App] Erreur init Dashboard :', e); }
        }

        // Charger la biblioth\u00e8que annales/cours
        if (CT.Library && typeof CT.Library.load === 'function') {
            try { CT.Library.load(); } catch (e) { console.warn('[CT.App] Erreur chargement biblioth\u00e8que :', e); }
        }

        // Naviguer vers le tableau de bord
        navigateTo('dashboard');

        // Charger les param\u00e8tres
        loadSettings();

        // Mettre \u00e0 jour le compte \u00e0 rebours
        updateCountdown();

        // Cacher l'overlay apr\u00e8s un court d\u00e9lai
        setTimeout(function () {
            hideLoading();
        }, 300);
    }

    // =========================================================================
    // 4. Navigation
    // =========================================================================

    function navigateTo(page) {
        // Masquer toutes les pages
        var pages = qsa('.page');
        for (var i = 0; i < pages.length; i++) {
            pages[i].style.display = 'none';
            pages[i].classList.remove('page--active');
        }

        // Afficher la page cible
        var target = $('page-' + page);
        if (target) {
            target.style.display = 'block';
            target.classList.add('page--active');
        }

        // Mettre \u00e0 jour le lien actif dans la sidebar
        var links = qsa('.sidebar__nav-link');
        for (var j = 0; j < links.length; j++) {
            links[j].classList.remove('sidebar__nav-link--active');
            links[j].removeAttribute('aria-current');
            if (links[j].getAttribute('data-page') === page) {
                links[j].classList.add('sidebar__nav-link--active');
                links[j].setAttribute('aria-current', 'page');
            }
        }

        // Mettre \u00e0 jour le titre de la topbar
        var titleEl = $('topbar-title');
        if (titleEl) {
            titleEl.textContent = PAGE_TITLES[page] || 'CapaTransport Pro';
        }

        // Fermer la sidebar sur mobile
        closeSidebar();

        // Actions sp\u00e9cifiques \u00e0 certaines pages
        if (page === 'stats' && CT.Dashboard && typeof CT.Dashboard.renderStats === 'function') {
            try { CT.Dashboard.renderStats(); } catch (e) { /* ignor\u00e9 */ }
        }

        if (page === 'library' && CT.Library && typeof CT.Library.load === 'function') {
            try { CT.Library.load(); } catch (e) { /* ignor\u00e9 */ }
        }

        if (page === 'settings') {
            loadSettings();
        }

        // Sauvegarder la page courante
        state.currentPage = page;
    }

    // =========================================================================
    // 5. Sidebar
    // =========================================================================

    function openSidebar() {
        var sidebar = $('sidebar');
        var overlay = $('sidebar-overlay');
        var hamburger = $('hamburger-btn');
        if (sidebar) sidebar.classList.add('sidebar--open');
        if (overlay) overlay.classList.add('sidebar-overlay--visible');
        if (hamburger) hamburger.setAttribute('aria-expanded', 'true');
        state.sidebarOpen = true;
    }

    function closeSidebar() {
        var sidebar = $('sidebar');
        var overlay = $('sidebar-overlay');
        var hamburger = $('hamburger-btn');
        if (sidebar) sidebar.classList.remove('sidebar--open');
        if (overlay) overlay.classList.remove('sidebar-overlay--visible');
        if (hamburger) hamburger.setAttribute('aria-expanded', 'false');
        state.sidebarOpen = false;
    }

    // =========================================================================
    // 6. Authentification
    // =========================================================================

    function showAuthModal() {
        var modal = $('modal-auth');
        if (modal) {
            modal.style.display = '';
            CT.Modal.show('modal-auth');
        }
    }

    function hideAuthModal() {
        var modal = $('modal-auth');
        if (modal) {
            CT.Modal.hide('modal-auth');
            modal.style.display = 'none';
        }
    }

    function switchAuthTab(tab) {
        var tabs = qsa('.auth-tabs__tab');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].classList.remove('auth-tabs__tab--active');
            tabs[i].setAttribute('aria-selected', 'false');
        }

        var activeTab = qs('.auth-tabs__tab[data-tab="' + tab + '"]');
        if (activeTab) {
            activeTab.classList.add('auth-tabs__tab--active');
            activeTab.setAttribute('aria-selected', 'true');
        }

        var loginPanel = $('auth-panel-login');
        var registerPanel = $('auth-panel-register');

        if (tab === 'login') {
            if (loginPanel) loginPanel.style.display = '';
            if (registerPanel) registerPanel.style.display = 'none';
        } else {
            if (loginPanel) loginPanel.style.display = 'none';
            if (registerPanel) registerPanel.style.display = '';
        }
    }

    function handleLogin(e) {
        e.preventDefault();

        var email = ($('login-email') || {}).value || '';
        var password = ($('login-password') || {}).value || '';

        if (!email || !password) {
            CT.Toast.show('Veuillez remplir tous les champs.', 'warning');
            return;
        }

        if (typeof firebase === 'undefined' || !firebase.auth) {
            // Mode hors-ligne : connexion locale
            var localProfile = CT.Utils.loadData('ct_profile', null);
            if (localProfile && localProfile.email === email) {
                state.user = localProfile;
                hideAuthModal();
                initApp();
            } else {
                CT.Toast.show('Mode hors-ligne : aucun compte trouv\u00e9 localement.', 'error');
            }
            return;
        }

        CT.Loading.show('Connexion en cours...');

        firebase.auth().signInWithEmailAndPassword(email, password)
            .then(function (credential) {
                var user = credential.user;
                return loadFirestoreProfile(user);
            })
            .then(function () {
                CT.Loading.hide();
                hideAuthModal();
                initApp();
                CT.Toast.show('Connexion r\u00e9ussie. Bienvenue !', 'success');
            })
            .catch(function (error) {
                CT.Loading.hide();
                var msg = translateFirebaseError(error.code);
                CT.Toast.show(msg, 'error');
            });
    }

    function handleRegister(e) {
        e.preventDefault();

        var prenom = ($('register-prenom') || {}).value || '';
        var email = ($('register-email') || {}).value || '';
        var password = ($('register-password') || {}).value || '';
        var region = ($('register-region') || {}).value || '';
        var examDate = ($('register-exam-date') || {}).value || '';

        if (!prenom || !email || !password) {
            CT.Toast.show('Veuillez remplir les champs obligatoires.', 'warning');
            return;
        }

        if (password.length < 6) {
            CT.Toast.show('Le mot de passe doit contenir au moins 6 caract\u00e8res.', 'warning');
            return;
        }

        if (typeof firebase === 'undefined' || !firebase.auth) {
            // Mode hors-ligne : cr\u00e9er un profil local
            state.user = {
                prenom: prenom,
                email: email,
                region: region,
                examDate: examDate,
                isGuest: false
            };
            CT.Utils.saveData('ct_profile', state.user);
            hideAuthModal();
            initApp();
            CT.Toast.show('Compte cr\u00e9\u00e9 localement (mode hors-ligne).', 'success');
            return;
        }

        CT.Loading.show('Cr\u00e9ation du compte...');

        firebase.auth().createUserWithEmailAndPassword(email, password)
            .then(function (credential) {
                var user = credential.user;
                var db = firebase.firestore();
                return db.collection('users').doc(user.uid).set({
                    prenom: prenom,
                    region: region,
                    examDate: examDate,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                }).then(function () {
                    state.user = {
                        uid: user.uid,
                        prenom: prenom,
                        email: email,
                        region: region,
                        examDate: examDate,
                        isGuest: false
                    };
                    CT.Utils.saveData('ct_profile', state.user);
                });
            })
            .then(function () {
                CT.Loading.hide();
                hideAuthModal();
                initApp();
                CT.Toast.show('Compte cr\u00e9\u00e9 avec succ\u00e8s. Bienvenue !', 'success');
            })
            .catch(function (error) {
                CT.Loading.hide();
                var msg = translateFirebaseError(error.code);
                CT.Toast.show(msg, 'error');
            });
    }

    function handleGuestAccess() {
        var fp = getDeviceFingerprint();

        // Demander au serveur si cet appareil a droit à l'essai
        fetch('/api/trial/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fingerprint: fp })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data.allowed) {
                // Essai expiré ou appareil bloqué
                CT.Toast.show('Votre essai gratuit de 15 minutes est termine. Veuillez acheter un acces pour continuer.', 'error');
                if (CT.Modal && typeof CT.Modal.alert === 'function') {
                    CT.Modal.alert(
                        'Essai termine',
                        'Votre periode d\'essai gratuit de 15 minutes sur cet appareil est terminee. ' +
                        'Pour continuer a utiliser la plateforme, veuillez contacter l\'administrateur pour acheter un acces.'
                    );
                }
                return;
            }

            // Accès payé — pas de countdown
            if (data.reason === 'paid') {
                var now = new Date();
                var examDate = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
                var examDateStr = examDate.getFullYear() + '-' +
                    ('0' + (examDate.getMonth() + 1)).slice(-2) + '-' +
                    ('0' + examDate.getDate()).slice(-2);
                state.user = {
                    prenom: 'Candidat',
                    email: '',
                    region: '',
                    examDate: examDateStr,
                    isGuest: true,
                    guestPaid: true,
                    deviceFp: fp
                };
                CT.Utils.saveData('ct_profile', state.user);
                hideAuthModal();
                initApp();
                CT.Toast.show('Acces valide. Bienvenue !', 'success');
                return;
            }

            // Essai en cours
            var now2 = new Date();
            var startedAt = now2.getTime() - (GUEST_DURATION_MS - data.remainingMs);
            var examDate2 = new Date(now2.getTime() + 90 * 24 * 60 * 60 * 1000);
            var examDateStr2 = examDate2.getFullYear() + '-' +
                ('0' + (examDate2.getMonth() + 1)).slice(-2) + '-' +
                ('0' + examDate2.getDate()).slice(-2);

            state.user = {
                prenom: 'Candidat',
                email: '',
                region: '',
                examDate: examDateStr2,
                isGuest: true,
                guestStartedAt: startedAt,
                deviceFp: fp
            };

            CT.Utils.saveData('ct_profile', state.user);
            CT.Utils.saveData('ct_guest_started_at', startedAt);
            hideAuthModal();
            initApp();

            var minsLeft = Math.ceil(data.remainingMs / 60000);
            CT.Toast.show('Mode decouverte : ' + minsLeft + ' minutes restantes.', 'warning');
            if (data.isNew && CT.Modal && typeof CT.Modal.alert === 'function') {
                CT.Modal.alert(
                    'Mode decouverte',
                    'Vous avez 15 minutes pour explorer la plateforme. Passe ce delai, vous devrez acheter un acces pour continuer. Le compteur ne se reinitialise pas, meme en vidant le cache.'
                );
            }

            startGuestCountdown();
        })
        .catch(function() {
            // Hors ligne — fallback local
            var now = new Date();
            var examDate = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
            var examDateStr = examDate.getFullYear() + '-' +
                ('0' + (examDate.getMonth() + 1)).slice(-2) + '-' +
                ('0' + examDate.getDate()).slice(-2);
            state.user = {
                prenom: 'Candidat',
                email: '',
                region: '',
                examDate: examDateStr,
                isGuest: true,
                guestStartedAt: now.getTime(),
                deviceFp: fp
            };
            CT.Utils.saveData('ct_profile', state.user);
            CT.Utils.saveData('ct_guest_started_at', now.getTime());
            hideAuthModal();
            initApp();
            CT.Toast.show('Mode decouverte active (hors-ligne) : 15 minutes.', 'warning');
            startGuestCountdown();
        });
    }

    function startGuestCountdown() {
        if (!state.user || !state.user.isGuest || state.user.guestPaid) return;

        var startedAt = state.user.guestStartedAt || CT.Utils.loadData('ct_guest_started_at', Date.now());
        var banner = document.getElementById('guest-banner');
        var countdownEl = document.getElementById('guest-countdown');
        if (banner) banner.style.display = 'flex';

        function tick() {
            var remaining = GUEST_DURATION_MS - (Date.now() - startedAt);
            if (remaining <= 0) {
                if (guestTimerInterval) clearInterval(guestTimerInterval);
                guestTimerInterval = null;
                if (countdownEl) countdownEl.textContent = '00:00';
                handleGuestExpired();
                return;
            }
            var mins = Math.floor(remaining / 60000);
            var secs = Math.floor((remaining % 60000) / 1000);
            if (countdownEl) {
                countdownEl.textContent = (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs;
            }
        }

        tick();
        if (guestTimerInterval) clearInterval(guestTimerInterval);
        guestTimerInterval = setInterval(tick, 1000);

        var signupLink = document.getElementById('guest-banner-signup');
        if (signupLink) {
            signupLink.onclick = function (e) {
                e.preventDefault();
                handleGuestExpired(true);
            };
        }
    }

    function handleGuestExpired(manual) {
        if (guestTimerInterval) { clearInterval(guestTimerInterval); guestTimerInterval = null; }
        var banner = document.getElementById('guest-banner');
        if (banner) banner.style.display = 'none';
        CT.Utils.removeData('ct_profile');
        CT.Utils.removeData('ct_guest_started_at');
        state.user = null;
        if (!manual) {
            CT.Toast.show('Votre essai gratuit de 15 minutes est termine. Achetez un acces pour continuer.', 'warning');
        }
        showAuthModal();
        // Forcer l'onglet inscription
        setTimeout(function () { switchAuthTab('register'); }, 100);
    }

    function handleLogout() {
        if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) {
            firebase.auth().signOut().catch(function (err) {
                console.warn('[CT.App] Erreur signOut :', err);
            });
        }

        // Nettoyer localStorage utilisateur
        CT.Utils.removeData('ct_profile');

        state.user = null;
        state.chatHistory = [];
        state.selectedSessionType = null;
        state.selectedBloc = null;
        state.selectedDifficulty = 'melange';

        showAuthModal();
        CT.Toast.show('D\u00e9connexion r\u00e9ussie.', 'info');
    }

    function translateFirebaseError(code) {
        var messages = {
            'auth/wrong-password':         'Mot de passe incorrect.',
            'auth/user-not-found':         'Aucun compte trouv\u00e9 avec cet email.',
            'auth/email-already-in-use':   'Cet email est d\u00e9j\u00e0 utilis\u00e9.',
            'auth/invalid-email':          'Adresse email invalide.',
            'auth/weak-password':          'Le mot de passe est trop faible (min. 6 caract\u00e8res).',
            'auth/too-many-requests':      'Trop de tentatives. R\u00e9essayez plus tard.',
            'auth/network-request-failed': 'Erreur r\u00e9seau. V\u00e9rifiez votre connexion.',
            'auth/invalid-credential':     'Identifiants invalides. V\u00e9rifiez votre email et mot de passe.',
            'auth/user-disabled':          'Ce compte a \u00e9t\u00e9 d\u00e9sactiv\u00e9.'
        };
        return messages[code] || 'Erreur d\u2019authentification. Veuillez r\u00e9essayer.';
    }

    // =========================================================================
    // 7. Training (Entra\u00eenement)
    // =========================================================================

    function handleTrainingCardClick(card) {
        // Retirer la s\u00e9lection des autres cartes
        var cards = qsa('.training-card');
        for (var i = 0; i < cards.length; i++) {
            cards[i].classList.remove('training-card--selected');
        }

        // S\u00e9lectionner la carte cliqu\u00e9e
        card.classList.add('training-card--selected');
        state.selectedSessionType = card.getAttribute('data-session-type');

        // Afficher/masquer le s\u00e9lecteur de bloc
        var blocSelector = $('bloc-selector');
        if (blocSelector) {
            if (state.selectedSessionType === 'session-bloc') {
                blocSelector.style.display = 'block';
                blocSelector.classList.add('bloc-selector--visible');
            } else {
                blocSelector.style.display = 'none';
                blocSelector.classList.remove('bloc-selector--visible');
            }
        }
    }

    function handleBlocClick(btn) {
        var blocs = qsa('.btn--bloc');
        for (var i = 0; i < blocs.length; i++) {
            blocs[i].classList.remove('btn--bloc--active');
        }
        btn.classList.add('btn--bloc--active');
        state.selectedBloc = btn.getAttribute('data-bloc');
    }

    function handleDifficultyClick(btn) {
        var buttons = qsa('.btn--difficulty');
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].classList.remove('btn--difficulty--active');
            buttons[i].setAttribute('aria-checked', 'false');
        }
        btn.classList.add('btn--difficulty--active');
        btn.setAttribute('aria-checked', 'true');
        state.selectedDifficulty = btn.getAttribute('data-difficulty') || 'melange';
    }

    function handleStartSession() {
        if (!state.selectedSessionType) {
            CT.Toast.show('Veuillez s\u00e9lectionner un type de session.', 'warning');
            return;
        }

        if (state.selectedSessionType === 'session-bloc' && !state.selectedBloc) {
            CT.Toast.show('Veuillez s\u00e9lectionner un bloc.', 'warning');
            return;
        }

        if (CT.Exam && typeof CT.Exam.startSession === 'function') {
            CT.Exam.startSession(state.selectedSessionType, state.selectedBloc, state.selectedDifficulty);
            navigateTo('exam');
        } else {
            CT.Toast.show('Le module d\u2019examen n\u2019est pas disponible.', 'error');
        }
    }

    // =========================================================================
    // 8. Chat avec MAX
    // =========================================================================

    function sendChatMessage(message) {
        if (!message || !message.trim()) return;
        message = message.trim();

        var messagesEl = $('chat-messages');
        if (!messagesEl) return;

        // Ajouter le message utilisateur
        var userBubble =
            '<div class="chat__message chat__message--user">' +
                '<div class="chat__bubble chat__bubble--user"><p>' + escapeHtml(message) + '</p></div>' +
                '<div class="chat__avatar chat__avatar--user"><i class="fas fa-user"></i></div>' +
            '</div>';
        messagesEl.insertAdjacentHTML('beforeend', userBubble);

        // Masquer les suggestions apr\u00e8s le premier message
        var suggestions = qs('.chat__suggestions');
        if (suggestions) {
            suggestions.style.display = 'none';
        }

        // Afficher l'indicateur de frappe
        var typingEl = $('chat-typing');
        if (typingEl) typingEl.style.display = 'flex';

        // Ajouter \u00e0 l'historique
        state.chatHistory.push({ role: 'user', content: message });

        // Scroll vers le bas
        scrollChatToBottom();

        // Appeler l'API ou fournir une r\u00e9ponse de d\u00e9mo
        getChatResponse(message).then(function (response) {
            // Masquer l'indicateur de frappe
            if (typingEl) typingEl.style.display = 'none';

            // Ajouter la r\u00e9ponse de MAX
            var botBubble =
                '<div class="chat__message chat__message--bot">' +
                    '<div class="chat__avatar chat__avatar--bot"><i class="fas fa-user-tie"></i></div>' +
                    '<div class="chat__bubble chat__bubble--bot"><p>' + formatChatResponse(response) + '</p></div>' +
                '</div>';
            messagesEl.insertAdjacentHTML('beforeend', botBubble);

            // Ajouter \u00e0 l'historique
            state.chatHistory.push({ role: 'assistant', content: response });

            // Scroll vers le bas
            scrollChatToBottom();
        }).catch(function () {
            if (typingEl) typingEl.style.display = 'none';
            var errorBubble =
                '<div class="chat__message chat__message--bot">' +
                    '<div class="chat__avatar chat__avatar--bot"><i class="fas fa-user-tie"></i></div>' +
                    '<div class="chat__bubble chat__bubble--bot"><p>D\u00e9sol\u00e9, je rencontre une erreur. R\u00e9essayez dans quelques instants.</p></div>' +
                '</div>';
            messagesEl.insertAdjacentHTML('beforeend', errorBubble);
            scrollChatToBottom();
        });
    }

    function getChatResponse(message) {
        return new Promise(function (resolve) {
            // Essayer l'API
            if (CT.API && typeof CT.API.chatWithMax === 'function') {
                CT.API.chatWithMax(message, state.chatHistory, state.user)
                    .then(function (result) {
                        if (result && (result.response || result.message || result.reply)) {
                            resolve(result.response || result.message || result.reply);
                        } else {
                            // API indisponible, r\u00e9ponse de d\u00e9mo
                            resolve(getDemoResponse(message));
                        }
                    })
                    .catch(function () {
                        resolve(getDemoResponse(message));
                    });
            } else {
                resolve(getDemoResponse(message));
            }
        });
    }

    function getDemoResponse(message) {
        var lower = message.toLowerCase();

        if (lower.indexOf('ptac') !== -1 || lower.indexOf('poids') !== -1) return DEMO_RESPONSES.ptac;
        if (lower.indexOf('conduite') !== -1 || lower.indexOf('temps') !== -1 || lower.indexOf('repos') !== -1) return DEMO_RESPONSES.conduite;
        if (lower.indexOf('incoterm') !== -1) return DEMO_RESPONSES.incoterm;
        if (lower.indexOf('cmr') !== -1 || lower.indexOf('lettre de voiture') !== -1) return DEMO_RESPONSES.cmr;
        if (lower.indexOf('bilan') !== -1 || lower.indexOf('comptab') !== -1) return DEMO_RESPONSES.bilan;
        if (lower.indexOf('tva') !== -1 || lower.indexOf('taxe') !== -1) return DEMO_RESPONSES.tva;

        return DEMO_DEFAULT;
    }

    function formatChatResponse(text) {
        if (!text) return '';
        // Mini-rendu Markdown -> HTML
        var html = escapeHtml(text);
        html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
        html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
        html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
        html = html.replace(/^###\s+(.+)$/gm, '<h4>$1</h4>');
        html = html.replace(/^##\s+(.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^#\s+(.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/\*\*([^\*\n]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
        html = html.replace(/(^|[^\*])\*([^\*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
        html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
        html = html.replace(/^[\-\*]\s+(.+)$/gm, '<li>$1</li>');
        html = html.replace(/(<li>[\s\S]*?<\/li>)(?:\s*(<li>[\s\S]*?<\/li>))+/g, function (match) {
            return '<ul>' + match.replace(/\s*\n\s*/g, '') + '</ul>';
        });
        html = html.replace(/\n+/g, function (m) { return m.length > 1 ? '<br><br>' : '<br>'; });
        html = html.replace(/<br>\s*(<\/?(h[1-6]|ul|li|p)>)/g, '$1');
        html = html.replace(/(<\/?(h[1-6]|ul|li|p)>)\s*<br>/g, '$1');
        return html;
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function scrollChatToBottom() {
        var messagesEl = $('chat-messages');
        if (messagesEl) {
            messagesEl.scrollTop = messagesEl.scrollHeight;
        }
    }

    // =========================================================================
    // 9. Param\u00e8tres
    // =========================================================================

    function loadSettings() {
        var profile = CT.Utils.loadData('ct_profile', null);
        if (!profile) return;

        var prenomEl = $('settings-prenom');
        var regionEl = $('settings-region');
        var examDateEl = $('settings-exam-date');
        var apiKeyEl = $('settings-api-key');
        var fontSizeEl = $('settings-font-size');
        var fontSizeValue = $('font-size-value');
        var notificationsEl = $('settings-notifications');

        if (prenomEl) prenomEl.value = profile.prenom || '';
        if (regionEl) regionEl.value = profile.region || '';
        if (examDateEl) examDateEl.value = profile.examDate || '';

        // Cl\u00e9 API
        if (apiKeyEl && CT.API && typeof CT.API.getApiKey === 'function') {
            apiKeyEl.value = CT.API.getApiKey() || '';
        }

        // Taille de police
        var savedFontSize = CT.Utils.loadData('ct_font_size', 16);
        if (fontSizeEl) fontSizeEl.value = savedFontSize;
        if (fontSizeValue) fontSizeValue.textContent = savedFontSize + 'px';

        // Notifications
        var savedNotif = CT.Utils.loadData('ct_notifications', true);
        if (notificationsEl) notificationsEl.checked = savedNotif;
    }

    function saveSettings() {
        var prenom = ($('settings-prenom') || {}).value || '';
        var region = ($('settings-region') || {}).value || '';
        var examDate = ($('settings-exam-date') || {}).value || '';
        var apiKey = ($('settings-api-key') || {}).value || '';
        var notifications = $('settings-notifications') ? $('settings-notifications').checked : true;

        // Mettre \u00e0 jour le profil
        if (!state.user) state.user = {};
        state.user.prenom = prenom;
        state.user.region = region;
        state.user.examDate = examDate;

        CT.Utils.saveData('ct_profile', state.user);
        CT.Utils.saveData('ct_notifications', notifications);

        // Sauvegarder la cl\u00e9 API
        if (apiKey && CT.API && typeof CT.API.saveApiKey === 'function') {
            CT.API.saveApiKey(apiKey);
        }

        // Mettre \u00e0 jour Firestore si utilisateur Firebase
        if (!state.user.isGuest && state.user.uid && typeof firebase !== 'undefined' && firebase.firestore) {
            try {
                firebase.firestore().collection('users').doc(state.user.uid).update({
                    prenom: prenom,
                    region: region,
                    examDate: examDate
                }).catch(function (err) {
                    console.warn('[CT.App] Erreur mise \u00e0 jour Firestore :', err);
                });
            } catch (e) {
                // Firebase non disponible
            }
        }

        // Mettre \u00e0 jour l'interface
        updateUserUI();
        updateCountdown();

        CT.Toast.show('Param\u00e8tres enregistr\u00e9s', 'success');
    }

    function handleFontSizeChange() {
        var fontSizeEl = $('settings-font-size');
        var fontSizeValue = $('font-size-value');
        if (!fontSizeEl) return;

        var size = fontSizeEl.value;
        if (fontSizeValue) fontSizeValue.textContent = size + 'px';
        document.documentElement.style.fontSize = size + 'px';
        CT.Utils.saveData('ct_font_size', parseInt(size, 10));
    }

    function handleTestApi() {
        var apiKeyEl = $('settings-api-key');
        var statusIndicator = $('api-status-indicator');
        var statusText = $('api-status-text');

        var key = apiKeyEl ? apiKeyEl.value : '';

        if (!key) {
            CT.Toast.show('Veuillez entrer une cl\u00e9 API.', 'warning');
            return;
        }

        if (statusText) statusText.textContent = 'Test en cours...';

        if (CT.API && typeof CT.API.testApiKey === 'function') {
            CT.API.testApiKey(key).then(function (result) {
                if (result) {
                    if (statusIndicator) {
                        statusIndicator.className = 'status-dot status-dot--success';
                    }
                    if (statusText) statusText.textContent = 'Connect\u00e9';
                    CT.Toast.show('Cl\u00e9 API valid\u00e9e.', 'success');
                } else {
                    if (statusIndicator) {
                        statusIndicator.className = 'status-dot status-dot--error';
                    }
                    if (statusText) statusText.textContent = 'Erreur';
                    CT.Toast.show('Cl\u00e9 API invalide.', 'error');
                }
            }).catch(function () {
                if (statusIndicator) {
                    statusIndicator.className = 'status-dot status-dot--error';
                }
                if (statusText) statusText.textContent = 'Erreur';
                CT.Toast.show('Impossible de tester la cl\u00e9 API.', 'error');
            });
        } else {
            CT.Toast.show('Module API non disponible.', 'error');
        }
    }

    function handleExportData() {
        try {
            var exportData = {};
            for (var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i);
                if (key && key.indexOf('ct_') === 0) {
                    try {
                        exportData[key] = JSON.parse(localStorage.getItem(key));
                    } catch (e) {
                        exportData[key] = localStorage.getItem(key);
                    }
                }
            }

            var blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            var url = URL.createObjectURL(blob);

            var a = document.createElement('a');
            a.href = url;
            a.download = 'capatransport_export_' + new Date().toISOString().slice(0, 10) + '.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            CT.Toast.show('Donn\u00e9es export\u00e9es avec succ\u00e8s.', 'success');
        } catch (e) {
            CT.Toast.show('Erreur lors de l\u2019exportation.', 'error');
        }
    }

    function handleResetData() {
        var doReset = function () {
            // Supprimer toutes les cl\u00e9s ct_*
            var keysToRemove = [];
            for (var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i);
                if (key && key.indexOf('ct_') === 0) {
                    keysToRemove.push(key);
                }
            }
            for (var j = 0; j < keysToRemove.length; j++) {
                localStorage.removeItem(keysToRemove[j]);
            }
            window.location.reload();
        };

        if (CT.Modal && typeof CT.Modal.confirm === 'function') {
            CT.Modal.confirm(
                'R\u00e9initialiser les donn\u00e9es',
                '\u00cates-vous s\u00fbr de vouloir supprimer toutes vos donn\u00e9es ? Cette action est irr\u00e9versible.'
            ).then(function (confirmed) {
                if (confirmed) doReset();
            });
        } else {
            if (window.confirm('\u00cates-vous s\u00fbr de vouloir supprimer toutes vos donn\u00e9es ? Cette action est irr\u00e9versible.')) {
                doReset();
            }
        }
    }

    // =========================================================================
    // 10. Quick start & dashboard actions
    // =========================================================================

    function handleQuickStart() {
        navigateTo('training');
    }

    function handleDashboardAction(action) {
        if (action === 'start-exam-blanc') {
            state.selectedSessionType = 'exam-blanc';
            state.selectedBloc = null;
            if (CT.Exam && typeof CT.Exam.startSession === 'function') {
                CT.Exam.startSession('exam-blanc', null, state.selectedDifficulty);
                navigateTo('exam');
            }
        } else if (action === 'start-session-bloc') {
            navigateTo('training');
            // Pr\u00e9-s\u00e9lectionner session-bloc
            setTimeout(function () {
                var card = qs('.training-card[data-session-type="session-bloc"]');
                if (card) handleTrainingCardClick(card);
            }, 100);
        } else if (action === 'start-quiz-eclair') {
            state.selectedSessionType = 'quiz-eclair';
            state.selectedBloc = null;
            if (CT.Exam && typeof CT.Exam.startSession === 'function') {
                CT.Exam.startSession('quiz-eclair', null, state.selectedDifficulty);
                navigateTo('exam');
            }
        }
    }

    // =========================================================================
    // 11. UI Helpers
    // =========================================================================

    function updateUserUI() {
        if (!state.user) return;

        var prenom = state.user.prenom || 'Candidat';

        // Sidebar
        var sidebarName = $('sidebar-user-name');
        if (sidebarName) sidebarName.textContent = prenom;

        // Salutation dashboard
        var firstnameEl = $('user-firstname');
        if (firstnameEl) firstnameEl.textContent = prenom;
    }

    function updateCountdown() {
        if (!state.user || !state.user.examDate) return;

        var countdownText = $('countdown-text');
        if (!countdownText) return;

        if (CT.DateTime && typeof CT.DateTime.daysUntil === 'function') {
            var days = CT.DateTime.daysUntil(state.user.examDate);
            if (days > 0) {
                countdownText.textContent = 'J-' + days + ' avant l\u2019examen';
            } else if (days === 0) {
                countdownText.textContent = 'C\u2019est aujourd\u2019hui !';
            } else {
                countdownText.textContent = 'Examen pass\u00e9';
            }
        }
    }

    function hideLoading() {
        var overlay = $('loading-overlay');
        if (!overlay) return;
        overlay.classList.add('loading-overlay--fade-out');
        setTimeout(function () {
            overlay.style.display = 'none';
            overlay.classList.remove('loading-overlay--fade-out');
            overlay.classList.remove('loading-overlay--visible');
        }, 400);
    }

    // =========================================================================
    // 12. Setup Event Listeners
    // =========================================================================

    function setupEventListeners() {
        // --- Sidebar ---
        var hamburger = $('hamburger-btn');
        if (hamburger) hamburger.addEventListener('click', function (e) {
            e.stopPropagation();
            openSidebar();
        });

        var closeBtn = $('sidebar-close-btn');
        if (closeBtn) closeBtn.addEventListener('click', closeSidebar);

        var overlay = $('sidebar-overlay');
        if (overlay) overlay.addEventListener('click', closeSidebar);

        // --- Fermeture au clic en dehors (mobile) ---
        document.addEventListener('click', function (e) {
            if (!state.sidebarOpen) return;
            var sidebar = $('sidebar');
            var hamb = $('hamburger-btn');
            if (!sidebar) return;
            if (sidebar.contains(e.target)) return;
            if (hamb && hamb.contains(e.target)) return;
            closeSidebar();
        });

        // --- Swipe pour fermer la sidebar sur mobile ---
        var touchStartX = null;
        var sidebarEl = $('sidebar');
        if (sidebarEl) {
            sidebarEl.addEventListener('touchstart', function (e) {
                if (!state.sidebarOpen) return;
                touchStartX = e.touches[0].clientX;
            }, { passive: true });
            sidebarEl.addEventListener('touchmove', function (e) {
                if (touchStartX === null) return;
                var dx = e.touches[0].clientX - touchStartX;
                if (dx < -50) {
                    closeSidebar();
                    touchStartX = null;
                }
            }, { passive: true });
            sidebarEl.addEventListener('touchend', function () { touchStartX = null; }, { passive: true });
        }

        // --- Navigation sidebar ---
        var navLinks = qsa('.sidebar__nav-link[data-page]');
        for (var i = 0; i < navLinks.length; i++) {
            navLinks[i].addEventListener('click', function (e) {
                e.preventDefault();
                var page = this.getAttribute('data-page');
                if (page) navigateTo(page);
            });
        }

        // --- Auth tabs ---
        var authTabs = qsa('.auth-tabs__tab[data-tab]');
        for (var t = 0; t < authTabs.length; t++) {
            authTabs[t].addEventListener('click', function () {
                switchAuthTab(this.getAttribute('data-tab'));
            });
        }

        // --- Login / Register forms ---
        var loginForm = $('login-form');
        if (loginForm) loginForm.addEventListener('submit', handleLogin);

        var registerForm = $('register-form');
        if (registerForm) registerForm.addEventListener('submit', handleRegister);

        // --- Guest access ---
        var guestBtn = $('guest-access-btn');
        if (guestBtn) guestBtn.addEventListener('click', handleGuestAccess);

        // --- Logout ---
        var logoutBtn = $('logout-btn');
        if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

        // --- Quick start ---
        var quickStartBtn = $('quick-start-btn');
        if (quickStartBtn) quickStartBtn.addEventListener('click', handleQuickStart);

        // --- Training cards ---
        var trainingCards = qsa('.training-card[data-session-type]');
        for (var c = 0; c < trainingCards.length; c++) {
            trainingCards[c].addEventListener('click', function () {
                handleTrainingCardClick(this);
            });
        }

        // --- Bloc buttons ---
        var blocBtns = qsa('.btn--bloc[data-bloc]');
        for (var b = 0; b < blocBtns.length; b++) {
            blocBtns[b].addEventListener('click', function () {
                handleBlocClick(this);
            });
        }

        // --- Difficulty buttons ---
        var diffBtns = qsa('.btn--difficulty[data-difficulty]');
        for (var d = 0; d < diffBtns.length; d++) {
            diffBtns[d].addEventListener('click', function () {
                handleDifficultyClick(this);
            });
        }

        // --- Start session ---
        var startBtn = $('start-session-btn');
        if (startBtn) startBtn.addEventListener('click', handleStartSession);

        // --- Chat ---
        var chatSendBtn = $('chat-send-btn');
        if (chatSendBtn) {
            chatSendBtn.addEventListener('click', function () {
                var input = $('chat-input');
                if (input && input.value.trim()) {
                    sendChatMessage(input.value);
                    input.value = '';
                }
            });
        }

        var chatInput = $('chat-input');
        if (chatInput) {
            chatInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (chatInput.value.trim()) {
                        sendChatMessage(chatInput.value);
                        chatInput.value = '';
                    }
                }
            });
        }

        var chips = qsa('.chat__suggestion-chip[data-suggestion]');
        for (var s = 0; s < chips.length; s++) {
            chips[s].addEventListener('click', function () {
                var text = this.getAttribute('data-suggestion') || this.textContent;
                sendChatMessage(text);
            });
        }

        // --- Settings ---
        var saveSettingsBtn = $('save-settings-btn');
        if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', saveSettings);

        var testApiBtn = $('test-api-btn');
        if (testApiBtn) testApiBtn.addEventListener('click', handleTestApi);

        var exportBtn = $('export-data-btn');
        if (exportBtn) exportBtn.addEventListener('click', handleExportData);

        var resetBtn = $('reset-data-btn');
        if (resetBtn) resetBtn.addEventListener('click', handleResetData);

        var fontSizeEl = $('settings-font-size');
        if (fontSizeEl) fontSizeEl.addEventListener('input', handleFontSizeChange);

        // --- Dashboard action buttons (d\u00e9l\u00e9gation) ---
        document.addEventListener('click', function (e) {
            var target = e.target;
            // Remonter pour trouver [data-action]
            while (target && target !== document.body) {
                var action = target.getAttribute('data-action');
                if (action) {
                    handleAction(action, target);
                    return;
                }
                target = target.parentElement;
            }
        });

        // --- Window resize ---
        window.addEventListener('resize', function () {
            if (window.innerWidth >= 1024) {
                closeSidebar();
            }
        });

        // --- Keyboard: Escape ---
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                // Fermer la sidebar si ouverte
                if (state.sidebarOpen) {
                    closeSidebar();
                    return;
                }
                // Fermer les modals visibles
                var visibleModals = qsa('.modal--visible');
                for (var m = 0; m < visibleModals.length; m++) {
                    var modalId = visibleModals[m].id;
                    if (modalId && modalId !== 'modal-auth') {
                        CT.Modal.hide(modalId);
                    }
                }
            }
        });

        // --- Modal backdrop clicks ---
        var modalBackdrops = qsa('.modal__backdrop');
        for (var mb = 0; mb < modalBackdrops.length; mb++) {
            modalBackdrops[mb].addEventListener('click', function () {
                var modal = this.closest('.modal');
                if (modal && modal.id && modal.id !== 'modal-auth') {
                    CT.Modal.hide(modal.id);
                }
            });
        }

        var modalCloseBtns = qsa('.modal__close-btn');
        for (var mc = 0; mc < modalCloseBtns.length; mc++) {
            modalCloseBtns[mc].addEventListener('click', function () {
                var modal = this.closest('.modal');
                if (modal && modal.id) {
                    CT.Modal.hide(modal.id);
                    if (modal.id === 'modal-auth') {
                        modal.style.display = 'none';
                    }
                }
            });
        }
    }

    // =========================================================================
    // 13. Action router (data-action)
    // =========================================================================

    function handleAction(action, target) {
        switch (action) {
            case 'quick-start':
                handleQuickStart();
                break;
            case 'start-exam-blanc':
            case 'start-session-bloc':
            case 'start-quiz-eclair':
                handleDashboardAction(action);
                break;
            case 'guest-access':
                handleGuestAccess();
                break;
            case 'navigate':
                var page = target.getAttribute('data-page');
                if (page) navigateTo(page);
                break;
            default:
                break;
        }
    }

    // =========================================================================
    // 14. Restaurer la taille de police au chargement
    // =========================================================================

    function restoreFontSize() {
        var savedSize = CT.Utils.loadData('ct_font_size', null);
        if (savedSize) {
            document.documentElement.style.fontSize = savedSize + 'px';
        }
    }

    // =========================================================================
    // Public API
    // =========================================================================

    return {
        state: state,
        init: init,
        initApp: initApp,
        navigateTo: navigateTo,
        openSidebar: openSidebar,
        closeSidebar: closeSidebar,
        showAuthModal: showAuthModal,
        hideAuthModal: hideAuthModal,
        handleLogin: handleLogin,
        handleRegister: handleRegister,
        handleGuestAccess: handleGuestAccess,
        handleLogout: handleLogout,
        sendChatMessage: sendChatMessage,
        loadSettings: loadSettings,
        saveSettings: saveSettings,
        handleStartSession: handleStartSession,
        hideLoading: hideLoading,
        updateCountdown: updateCountdown,
        restoreFontSize: restoreFontSize
    };

})();

// =========================================================================
// D\u00e9marrage de l'application
// =========================================================================

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
        CT.App.restoreFontSize();
        CT.App.init();
    });
} else {
    CT.App.restoreFontSize();
    CT.App.init();
}
