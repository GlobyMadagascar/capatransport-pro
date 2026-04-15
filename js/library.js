/**
 * CapaTransport Pro - Module Biblioth\u00e8que
 * Affichage des annales et cours pr\u00e9-convertis en JSON.
 * AUCUN PDF n'est jamais affich\u00e9 ni t\u00e9l\u00e9charg\u00e9 depuis la plateforme.
 */

window.CT = window.CT || {};

CT.Library = (function () {

    var state = {
        annales: [],
        cours: { bloc1: [], bloc2: [], bloc3: [], bloc4: [] },
        resumesMeta: [], // [{bloc,label,themes_count,couverture_estimee,resume_chars}]
        currentTab: 'annales',
        loaded: false
    };

    function $(id) { return document.getElementById(id); }
    function qsa(sel) { return document.querySelectorAll(sel); }

    function escapeHtml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * Nettoie tout contenu susceptible de r\u00e9v\u00e9ler la source (nom PDF, chemin,
     * mention "source :", auteur, copyright, etc.)
     */
    function sanitize(text) {
        if (!text) return '';
        var out = String(text);
        // Retirer noms de fichiers .pdf
        out = out.replace(/[\w\-_\.\/\\]+\.pdf/gi, '');
        // Retirer mentions de source
        out = out.replace(/^(source|r\u00e9f\u00e9rence|origine|auteur|copyright|\u00a9)\s*:.*$/gim, '');
        // Retirer tous les chemins de fichiers
        out = out.replace(/[A-Z]:\\[^\s]+/g, '');
        out = out.replace(/\/[a-z_\-]+\/[A-Za-z0-9_\-\/]+/g, '');
        return out.trim();
    }

    async function load() {
        if (state.loaded) { render(); return; }

        // Charger les annales depuis l'API
        try {
            var resp = await fetch('/api/annales');
            if (resp.ok) {
                var data = await resp.json();
                if (data && Array.isArray(data.annales)) {
                    state.annales = data.annales;
                }
            }
        } catch (e) { /* hors-ligne */ }

        // Charger la liste des r\u00e9sum\u00e9s examen
        try {
            var resumesResp = await fetch('/api/resumes');
            if (resumesResp.ok) {
                var resumesData = await resumesResp.json();
                if (resumesData && Array.isArray(resumesData.resumes)) {
                    state.resumesMeta = resumesData.resumes;
                }
            }
        } catch (e) { /* pas encore g\u00e9n\u00e9r\u00e9 */ }

        // Charger les cours pr\u00e9-convertis (data/cours.json g\u00e9n\u00e9r\u00e9 par build_cours_json.js)
        try {
            var coursResp = await fetch('/data/cours.json?v=' + Date.now(), { cache: 'no-store' });
            if (coursResp.ok) {
                var coursData = await coursResp.json();
                if (coursData && typeof coursData === 'object') {
                    ['bloc1', 'bloc2', 'bloc3', 'bloc4'].forEach(function (k) {
                        if (Array.isArray(coursData[k])) state.cours[k] = coursData[k];
                    });
                }
            }
        } catch (e) { /* pas encore g\u00e9n\u00e9r\u00e9 */ }

        state.loaded = true;
        render();
        attachTabListeners();
    }

    function attachTabListeners() {
        var tabs = qsa('[data-lib-tab]');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].addEventListener('click', function () {
                var tab = this.getAttribute('data-lib-tab');
                state.currentTab = tab;
                for (var j = 0; j < tabs.length; j++) {
                    tabs[j].classList.remove('btn--period--active');
                    tabs[j].setAttribute('aria-selected', 'false');
                }
                this.classList.add('btn--period--active');
                this.setAttribute('aria-selected', 'true');
                render();
            });
        }

        var closeBtn = $('library-reader-close');
        if (closeBtn) closeBtn.addEventListener('click', function () {
            var reader = $('library-reader');
            if (reader) reader.style.display = 'none';
        });
    }

    function render() {
        var grid = $('library-grid');
        if (!grid) return;
        grid.innerHTML = '';

        var items = [];
        if (state.currentTab === 'annales') {
            items = state.annales.map(function (a) {
                return {
                    title: 'Annale ' + a.year,
                    subtitle: a.session || ('Session ' + a.year),
                    meta: (a.qcmCount || 0) + ' QCM \u2022 ' + (a.problemsCount || 0) + ' probl\u00e8mes',
                    icon: 'fa-file-alt',
                    type: 'annale',
                    key: a.year
                };
            });
        } else {
            var blocKey = state.currentTab;
            items = (state.cours[blocKey] || []).map(function (c) {
                return {
                    title: c.title || 'Cours',
                    subtitle: c.type === 'exercice' ? 'Exercice' : 'Cours',
                    meta: (c.sections ? c.sections.length + ' sections' : ''),
                    icon: c.type === 'exercice' ? 'fa-dumbbell' : 'fa-book-open',
                    type: 'cours',
                    key: c.id
                };
            });

            // Carte sp\u00e9ciale : R\u00e9sum\u00e9 orient\u00e9 examen (si disponible)
            var resumeMeta = state.resumesMeta.find(function (r) { return r.bloc === blocKey; });
            if (resumeMeta) {
                items.unshift({
                    title: '\ud83d\udcab R\u00e9sum\u00e9 orient\u00e9 examen',
                    subtitle: 'L\'essentiel \u00e0 retenir \u2014 bas\u00e9 sur les annales',
                    meta: ((resumeMeta.themes_top || []).length) + ' th\u00e8mes \u2022 couverture ' + (resumeMeta.couverture_estimee || '?'),
                    icon: 'fa-star',
                    type: 'resume',
                    key: blocKey,
                    featured: true
                });
            }
        }

        if (items.length === 0) {
            grid.innerHTML = '<div class="library__empty">' +
                '<i class="fas fa-inbox" aria-hidden="true"></i>' +
                '<p>Aucun contenu disponible pour cette cat\u00e9gorie.</p>' +
                '<p class="library__empty-hint">Si vous \u00eates admin, ex\u00e9cutez <code>node build_cours_json.js</code> pour g\u00e9n\u00e9rer le contenu.</p>' +
                '</div>';
            return;
        }

        items.forEach(function (it) {
            var card = document.createElement('button');
            card.type = 'button';
            card.className = 'library__card' + (it.featured ? ' library__card--featured' : '');
            card.innerHTML =
                '<div class="library__card-icon"><i class="fas ' + it.icon + '"></i></div>' +
                '<div class="library__card-body">' +
                    '<h4 class="library__card-title">' + escapeHtml(it.title) + '</h4>' +
                    '<p class="library__card-subtitle">' + escapeHtml(it.subtitle) + '</p>' +
                    (it.meta ? '<p class="library__card-meta">' + escapeHtml(it.meta) + '</p>' : '') +
                '</div>' +
                '<i class="fas fa-chevron-right library__card-arrow"></i>';
            card.addEventListener('click', function () { openItem(it); });
            grid.appendChild(card);
        });
    }

    async function openItem(it) {
        var reader = $('library-reader');
        var title = $('library-reader-title');
        var body = $('library-reader-body');
        if (!reader || !title || !body) return;

        title.textContent = it.title;
        body.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Chargement...';
        reader.style.display = 'block';
        reader.scrollIntoView({ behavior: 'smooth', block: 'start' });

        if (it.type === 'resume') {
            try {
                var rResp = await fetch('/api/resumes/' + it.key);
                var rData = await rResp.json();
                if (rData && rData.success && rData.resume) {
                    body.innerHTML = renderResume(rData);
                } else {
                    body.innerHTML = '<p>R\u00e9sum\u00e9 indisponible.</p>';
                }
            } catch (e) {
                body.innerHTML = '<p>Erreur lors du chargement du r\u00e9sum\u00e9.</p>';
            }
            return;
        }

        if (it.type === 'annale') {
            try {
                var resp = await fetch('/api/annales/' + it.key);
                var data = await resp.json();
                if (data && data.annale) {
                    body.innerHTML = renderAnnale(data.annale);
                } else {
                    body.innerHTML = '<p>Impossible de charger cette annale.</p>';
                }
            } catch (e) {
                body.innerHTML = '<p>Erreur lors du chargement.</p>';
            }
        } else {
            // Cours : afficher le contenu directement depuis le state
            var found = null;
            var blocKey = state.currentTab;
            (state.cours[blocKey] || []).forEach(function (c) { if (c.id === it.key) found = c; });
            if (found) {
                body.innerHTML = renderCours(found);
            } else {
                body.innerHTML = '<p>Contenu introuvable.</p>';
            }
        }
    }

    function renderAnnale(annale) {
        var html = '<div class="library__reader-content">';
        html += '<p class="library__reader-meta">' + escapeHtml(annale.session || '') + '</p>';

        if (annale.qcm && annale.qcm.length > 0) {
            html += '<h4>Questions QCM (' + annale.qcm.length + ')</h4>';
            html += '<ol class="library__qcm-list">';
            annale.qcm.forEach(function (q) {
                html += '<li>';
                html += '<p class="library__qcm-question">' + escapeHtml(sanitize(q.text || '')) + '</p>';
                if (q.options) {
                    html += '<ul class="library__qcm-options">';
                    ['a', 'b', 'c', 'd'].forEach(function (k) {
                        if (q.options[k]) {
                            html += '<li><strong>' + k.toUpperCase() + ')</strong> ' + escapeHtml(sanitize(q.options[k])) + '</li>';
                        }
                    });
                    html += '</ul>';
                }
                if (q.answer) html += '<p class="library__qcm-answer">R\u00e9ponse : <strong>' + escapeHtml(q.answer.toUpperCase()) + '</strong></p>';
                html += '</li>';
            });
            html += '</ol>';
        }

        if (annale.problems && annale.problems.length > 0) {
            html += '<h4>Probl\u00e8mes</h4>';
            annale.problems.forEach(function (p) {
                html += '<div class="library__problem">';
                html += '<h5>' + escapeHtml(p.title || ('Probl\u00e8me ' + p.number)) + '</h5>';
                html += '<div class="library__problem-text">' + escapeHtml(sanitize(p.subject_text || '')).replace(/\n/g, '<br>') + '</div>';
                html += '</div>';
            });
        }

        html += '</div>';
        return html;
    }

    function renderResume(r) {
        var html = '<div class="library__reader-content library__resume">';
        html += '<p class="library__reader-meta">' + escapeHtml(r.label || '') + ' \u00b7 ' + escapeHtml(r.couverture_estimee || '') + '</p>';

        if (Array.isArray(r.themes_top) && r.themes_top.length > 0) {
            html += '<h4>\ud83c\udfaf Th\u00e8mes prioritaires (loi de Pareto)</h4>';
            html += '<div class="library__themes">';
            r.themes_top.forEach(function (t) {
                html += '<div class="library__theme">' +
                    '<div class="library__theme-head">' +
                        '<strong>' + escapeHtml(t.theme || '') + '</strong>' +
                        (t.frequency ? '<span class="library__theme-freq">' + t.frequency + ' occ.</span>' : '') +
                    '</div>' +
                    (t.notes ? '<p class="library__theme-notes">' + escapeHtml(t.notes) + '</p>' : '') +
                '</div>';
            });
            html += '</div>';
        }

        html += '<h4>\ud83d\udcd6 Cours r\u00e9sum\u00e9</h4>';
        html += '<div class="library__resume-text">' + escapeHtml(r.resume || '').replace(/\n/g, '<br>') + '</div>';

        html += '</div>';
        return html;
    }

    function renderCours(cours) {
        var html = '<div class="library__reader-content">';
        html += '<p class="library__reader-meta">' + escapeHtml(cours.type === 'exercice' ? 'Exercice' : 'Fiche de cours') + '</p>';

        if (cours.sections && cours.sections.length > 0) {
            cours.sections.forEach(function (s) {
                if (s.heading) html += '<h4>' + escapeHtml(sanitize(s.heading)) + '</h4>';
                if (s.content) {
                    html += '<div class="library__cours-text">' + escapeHtml(sanitize(s.content)).replace(/\n/g, '<br>') + '</div>';
                }
            });
        } else if (cours.content) {
            html += '<div class="library__cours-text">' + escapeHtml(sanitize(cours.content)).replace(/\n/g, '<br>') + '</div>';
        } else {
            html += '<p>Contenu vide.</p>';
        }

        html += '</div>';
        return html;
    }

    return {
        state: state,
        load: load,
        render: render
    };
})();
