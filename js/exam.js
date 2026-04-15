/**
 * CapaTransport Pro - Module Examen
 * Moteur d'examen : sessions, minuteur, notation, resultats
 */

window.CT = window.CT || {};

CT.Exam = (function () {

    var SESSION_CONFIG = {
        'exam-blanc':     { count: 50, time: 12600, bloc: null,  label: 'Examen Blanc' },
        'session-bloc':   { count: 20, time: 2700,  bloc: null,  label: 'Session par Bloc' },
        'quiz-eclair':    { count: 10, time: 1200,  bloc: null,  label: 'Quiz \u00c9clair' },
        'points-faibles': { count: 15, time: 2700,  bloc: null,  label: 'Points Faibles' },
        'session-libre':  { count: 20, time: 2700,  bloc: null,  label: 'Session Libre' }
    };

    var state = {
        active: false,
        sessionType: null,
        selectedBloc: null,
        difficulty: 'melange',
        questions: [],
        currentIndex: 0,
        answers: {},
        timer: null,
        timeRemaining: 0,
        startTime: null,
        endTime: null
    };

    var scoreChartInstance = null;
    var blocsChartInstance = null;

    function $(id) { return document.getElementById(id); }
    function qs(sel) { return document.querySelector(sel); }
    function qsa(sel) { return document.querySelectorAll(sel); }

    function formatTime(seconds) {
        var h = Math.floor(seconds / 3600);
        var m = Math.floor((seconds % 3600) / 60);
        var s = seconds % 60;
        return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }

    function shuffle(arr) {
        var copy = arr.slice();
        for (var i = copy.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = copy[i]; copy[i] = copy[j]; copy[j] = tmp;
        }
        return copy;
    }

    function generateId() {
        return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    function escapeHtml(text) {
        if (!text) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(String(text)));
        return div.innerHTML;
    }

    function toast(message, type) {
        if (CT.Toast && typeof CT.Toast.show === 'function') {
            CT.Toast.show(message, type || 'info');
        } else {
            console.log('[Toast][' + (type || 'info') + '] ' + message);
        }
    }

    function showPage(pageId) {
        var pages = qsa('.page');
        for (var i = 0; i < pages.length; i++) {
            pages[i].style.display = 'none';
            pages[i].classList.remove('page--active');
        }
        var target = $(pageId);
        if (target) {
            target.style.display = '';
            target.classList.add('page--active');
        }
    }

    function saveData(key, value) {
        if (CT.Utils && typeof CT.Utils.saveData === 'function') {
            return CT.Utils.saveData(key, value);
        }
        try { localStorage.setItem(key, JSON.stringify(value)); return true; }
        catch (e) { return false; }
    }

    function loadData(key) {
        if (CT.Utils && typeof CT.Utils.loadData === 'function') {
            return CT.Utils.loadData(key);
        }
        try { var r = localStorage.getItem(key); return r ? JSON.parse(r) : null; }
        catch (e) { return null; }
    }

    // =========================================================================
    // Fallback questions
    // =========================================================================

    function getFallbackQuestions(count, bloc, difficulty) {
        var pool = [];
        if (CT.DemoData && Array.isArray(CT.DemoData.demoQuestions)) {
            pool = CT.DemoData.demoQuestions.slice();
        }
        if (pool.length === 0) pool = buildMinimalQuestions();

        if (bloc) {
            var filtered = pool.filter(function (q) { return String(q.bloc) === String(bloc); });
            if (filtered.length > 0) pool = filtered;
        }
        if (difficulty && difficulty !== 'melange') {
            var df = pool.filter(function (q) { return q.difficulte === difficulty; });
            if (df.length >= Math.min(count, 5)) pool = df;
        }
        return shuffle(pool).slice(0, count);
    }

    function buildMinimalQuestions() {
        var blocs = [
            { num: 1, label: 'R\u00e9glementation' },
            { num: 2, label: 'RETM' },
            { num: 3, label: 'Normes Techniques' },
            { num: 4, label: 'Ventes Internationales' }
        ];
        var questions = [];
        var diffs = ['facile', 'moyen', 'difficile'];
        for (var b = 0; b < blocs.length; b++) {
            for (var i = 0; i < 15; i++) {
                questions.push({
                    id: 'demo_b' + blocs[b].num + '_q' + (i + 1),
                    bloc: blocs[b].num,
                    bloc_label: blocs[b].label,
                    type: 'qcm',
                    difficulte: diffs[i % 3],
                    contexte: null,
                    question: 'Question de d\u00e9monstration ' + (i + 1) + ' - Bloc ' + blocs[b].num + ' (' + blocs[b].label + ')',
                    choix: { A: 'R\u00e9ponse A', B: 'R\u00e9ponse B', C: 'R\u00e9ponse C', D: 'R\u00e9ponse D' },
                    bonne_reponse: 'A',
                    explication: 'Ceci est une question de d\u00e9monstration. La bonne r\u00e9ponse est A. Connectez le serveur pour obtenir de vraies questions.'
                });
            }
        }
        return questions;
    }

    // =========================================================================
    // Start Session
    // =========================================================================

    async function startSession(sessionType, bloc, difficulty) {
        var config = SESSION_CONFIG[sessionType];
        if (!config) { toast('Type de session invalide.', 'error'); return; }

        state.active = true;
        state.sessionType = sessionType;
        state.selectedBloc = bloc || null;
        state.difficulty = difficulty || 'melange';
        state.currentIndex = 0;
        state.answers = {};
        state.startTime = new Date();
        state.endTime = null;

        var count = config.count;
        var time = config.time;

        toast('MAX pr\u00e9pare vos questions...', 'info');

        var questions = null;
        try {
            var apiResult = await CT.API.generateQuestions({
                bloc: state.selectedBloc,
                count: count,
                difficulty: state.difficulty,
                sessionType: sessionType
            });
            if (apiResult && Array.isArray(apiResult.questions) && apiResult.questions.length > 0) {
                questions = apiResult.questions;
            } else if (apiResult && Array.isArray(apiResult) && apiResult.length > 0) {
                questions = apiResult;
            }
        } catch (err) {
            console.warn('API indisponible, utilisation des questions de d\u00e9monstration.', err);
        }

        if (!questions || questions.length === 0) {
            questions = getFallbackQuestions(count, state.selectedBloc, state.difficulty);
            toast('Mode hors-ligne : questions de d\u00e9monstration charg\u00e9es.', 'warning');
        }

        for (var i = 0; i < questions.length; i++) {
            if (!questions[i].id) questions[i].id = 'q_' + i + '_' + Date.now();
        }

        state.questions = questions;
        buildNavigatorGrid();
        showPage('page-exam');
        showExamInterface();
        startTimer(time);
        displayQuestion(0);
    }

    // =========================================================================
    // Show/hide exam vs results
    // =========================================================================

    function showExamInterface() {
        var el;
        el = $('exam-results'); if (el) el.style.display = 'none';
        el = $('exam-question-area'); if (el) el.style.display = '';
        el = $('exam-choices'); if (el) el.style.display = '';
        el = qs('.exam__bottombar'); if (el) el.style.display = '';
        el = $('exam-navigator'); if (el) el.style.display = '';
        el = qs('.exam__topbar'); if (el) el.style.display = '';
    }

    // =========================================================================
    // Navigator grid
    // =========================================================================

    function buildNavigatorGrid() {
        var grid = $('exam-navigator-grid');
        if (!grid) return;
        grid.innerHTML = '';
        for (var i = 0; i < state.questions.length; i++) {
            var btn = document.createElement('button');
            btn.className = 'exam__nav-btn';
            btn.setAttribute('data-index', i);
            btn.setAttribute('role', 'listitem');
            btn.setAttribute('aria-label', 'Question ' + (i + 1));
            btn.textContent = String(i + 1);
            btn.addEventListener('click', (function (idx) {
                return function () { goToQuestion(idx); };
            })(i));
            grid.appendChild(btn);
        }
    }

    function updateNavigatorGrid() {
        var grid = $('exam-navigator-grid');
        if (!grid) return;
        var buttons = grid.querySelectorAll('.exam__nav-btn');
        for (var i = 0; i < buttons.length; i++) {
            var idx = parseInt(buttons[i].getAttribute('data-index'), 10);
            buttons[i].classList.remove('exam__nav-btn--current', 'exam__nav-btn--answered', 'exam__nav-btn--skipped');
            if (idx === state.currentIndex) buttons[i].classList.add('exam__nav-btn--current');
            var qId = state.questions[idx] ? state.questions[idx].id : null;
            if (qId && state.answers[qId] !== undefined && state.answers[qId] !== null && state.answers[qId] !== '') {
                buttons[i].classList.add('exam__nav-btn--answered');
            }
        }
    }

    // =========================================================================
    // Display Question
    // =========================================================================

    function displayQuestion(index) {
        if (index < 0 || index >= state.questions.length) return;
        state.currentIndex = index;
        var q = state.questions[index];

        var counter = $('exam-question-counter');
        if (counter) counter.innerHTML = 'Question <strong>' + (index + 1) + '</strong> / <strong>' + state.questions.length + '</strong>';

        var progress = $('exam-progress-fill');
        if (progress) {
            var pct = ((index + 1) / state.questions.length * 100).toFixed(1);
            progress.style.width = pct + '%';
            var bar = progress.parentElement;
            if (bar) bar.setAttribute('aria-valuenow', pct);
        }

        var qNum = $('exam-question-number');
        if (qNum) qNum.textContent = 'Question ' + (index + 1);

        var blocBadge = $('exam-question-bloc');
        if (blocBadge) blocBadge.textContent = q.bloc_label || ('Bloc ' + (q.bloc || '?'));

        var contextEl = $('exam-question-context');
        if (contextEl) {
            if (q.contexte) { contextEl.style.display = ''; contextEl.textContent = q.contexte; }
            else { contextEl.style.display = 'none'; contextEl.textContent = ''; }
        }

        var textEl = $('exam-question-text');
        if (textEl) textEl.textContent = q.question || q.texte || '';

        var choicesEl = $('exam-choices');
        var textInputEl = $('exam-text-input');
        var numberInputEl = $('exam-number-input');
        var qType = (q.type || 'qcm').toLowerCase();

        if (qType === 'qcm' || qType === 'vrai_faux') {
            if (choicesEl) choicesEl.style.display = '';
            if (textInputEl) textInputEl.style.display = 'none';
            if (numberInputEl) numberInputEl.style.display = 'none';
            populateChoices(q);
            restoreChoiceAnswer(q);
        } else if (qType === 'redactionnel') {
            if (choicesEl) choicesEl.style.display = 'none';
            if (textInputEl) textInputEl.style.display = '';
            if (numberInputEl) numberInputEl.style.display = 'none';
            var ta = $('exam-redactionnel');
            if (ta) ta.value = state.answers[q.id] || '';
        } else if (qType === 'calcul') {
            if (choicesEl) choicesEl.style.display = 'none';
            if (textInputEl) textInputEl.style.display = 'none';
            if (numberInputEl) numberInputEl.style.display = '';
            var ni = $('exam-calcul');
            if (ni) ni.value = state.answers[q.id] !== undefined ? state.answers[q.id] : '';
        } else {
            if (choicesEl) choicesEl.style.display = '';
            if (textInputEl) textInputEl.style.display = 'none';
            if (numberInputEl) numberInputEl.style.display = 'none';
            populateChoices(q);
            restoreChoiceAnswer(q);
        }

        var prevBtn = $('exam-prev-btn');
        if (prevBtn) prevBtn.disabled = (index === 0);

        updateNavigatorGrid();
        removeInlineExplanation();
    }

    function populateChoices(q) {
        var choices = q.choix || q.choices || {};
        var letters = ['A', 'B', 'C', 'D'];
        var ids = ['choice-a-text', 'choice-b-text', 'choice-c-text', 'choice-d-text'];
        for (var i = 0; i < letters.length; i++) {
            var el = $(ids[i]);
            if (el) el.textContent = choices[letters[i]] || '--';
        }
        var qType = (q.type || 'qcm').toLowerCase();
        var btns = qsa('.exam__choice');
        for (var j = 0; j < btns.length; j++) {
            var letter = btns[j].getAttribute('data-choice');
            btns[j].style.display = (qType === 'vrai_faux' && (letter === 'C' || letter === 'D')) ? 'none' : '';
            btns[j].classList.remove('exam__choice--selected');
            btns[j].setAttribute('aria-checked', 'false');
        }
    }

    function restoreChoiceAnswer(q) {
        var saved = state.answers[q.id];
        if (!saved) return;
        var btns = qsa('.exam__choice');
        for (var i = 0; i < btns.length; i++) {
            if (btns[i].getAttribute('data-choice') === saved) {
                btns[i].classList.add('exam__choice--selected');
                btns[i].setAttribute('aria-checked', 'true');
            }
        }
    }

    // =========================================================================
    // Select Choice
    // =========================================================================

    function selectChoice(choice) {
        if (!state.active || state.questions.length === 0) return;
        var q = state.questions[state.currentIndex];
        state.answers[q.id] = choice;

        var btns = qsa('.exam__choice');
        for (var i = 0; i < btns.length; i++) {
            var letter = btns[i].getAttribute('data-choice');
            if (letter === choice) {
                btns[i].classList.add('exam__choice--selected');
                btns[i].setAttribute('aria-checked', 'true');
            } else {
                btns[i].classList.remove('exam__choice--selected');
                btns[i].setAttribute('aria-checked', 'false');
            }
        }
        updateNavigatorGrid();
    }

    // =========================================================================
    // Save current answer
    // =========================================================================

    function saveCurrentAnswer() {
        if (!state.active || state.questions.length === 0) return;
        var q = state.questions[state.currentIndex];
        var qType = (q.type || 'qcm').toLowerCase();

        if (qType === 'redactionnel') {
            var ta = $('exam-redactionnel');
            if (ta && ta.value.trim()) state.answers[q.id] = ta.value.trim();
        } else if (qType === 'calcul') {
            var ni = $('exam-calcul');
            if (ni && ni.value.trim() !== '') state.answers[q.id] = ni.value.trim();
        }
    }

    // =========================================================================
    // Navigation
    // =========================================================================

    function nextQuestion() {
        if (!state.active) return;
        saveCurrentAnswer();
        if (state.currentIndex >= state.questions.length - 1) {
            toast('Derni\u00e8re question. Cliquez \u00abTerminer\u00bb quand vous \u00eates pr\u00eat.', 'info');
            return;
        }
        displayQuestion(state.currentIndex + 1);
    }

    function prevQuestion() {
        if (!state.active) return;
        saveCurrentAnswer();
        if (state.currentIndex <= 0) return;
        displayQuestion(state.currentIndex - 1);
    }

    function skipQuestion() {
        if (!state.active) return;
        saveCurrentAnswer();
        var total = state.questions.length;
        for (var offset = 1; offset < total; offset++) {
            var idx = (state.currentIndex + offset) % total;
            var qId = state.questions[idx].id;
            if (state.answers[qId] === undefined || state.answers[qId] === null || state.answers[qId] === '') {
                displayQuestion(idx);
                return;
            }
        }
        if (state.currentIndex < total - 1) {
            displayQuestion(state.currentIndex + 1);
        } else {
            toast('Toutes les questions ont une r\u00e9ponse. Cliquez \u00abTerminer\u00bb quand vous \u00eates pr\u00eat.', 'info');
        }
    }

    function goToQuestion(index) {
        if (!state.active) return;
        saveCurrentAnswer();
        if (index >= 0 && index < state.questions.length) displayQuestion(index);
    }

    // =========================================================================
    // Timer
    // =========================================================================

    function startTimer(seconds) {
        state.timeRemaining = seconds;
        updateTimerDisplay();
        if (state.timer) clearInterval(state.timer);

        state.timer = setInterval(function () {
            state.timeRemaining--;
            if (state.timeRemaining <= 0) {
                state.timeRemaining = 0;
                updateTimerDisplay();
                stopTimer();
                toast('Temps \u00e9coul\u00e9 !', 'warning');
                finishExam();
                return;
            }
            updateTimerDisplay();

            var timerEl = $('exam-timer');
            if (timerEl) {
                var parent = timerEl.closest('.exam__timer') || timerEl.parentElement;
                if (state.timeRemaining < 600) {
                    timerEl.classList.add('exam__timer--danger');
                    if (parent) parent.classList.add('exam__timer--danger');
                } else {
                    timerEl.classList.remove('exam__timer--danger');
                    if (parent) parent.classList.remove('exam__timer--danger');
                }
            }
        }, 1000);
    }

    function updateTimerDisplay() {
        var el = $('exam-timer');
        if (el) el.textContent = formatTime(state.timeRemaining);
    }

    function stopTimer() {
        if (state.timer) { clearInterval(state.timer); state.timer = null; }
    }

    // =========================================================================
    // Finish Exam
    // =========================================================================

    function finishExam() {
        saveCurrentAnswer();
        stopTimer();
        state.active = false;
        state.endTime = new Date();

        var results = calculateResults();
        saveSession(results);
        saveQuestionHistory();
        showResults(results);

        if (CT.Dashboard && typeof CT.Dashboard.refresh === 'function') {
            try { CT.Dashboard.refresh(); } catch (e) { /* ignore */ }
        }
    }

    function calculateResults() {
        var total = state.questions.length;
        var correct = 0;
        var scoresByBloc = {};
        var questionResults = [];

        for (var i = 0; i < total; i++) {
            var q = state.questions[i];
            var userAnswer = state.answers[q.id] || null;
            var isCorrect = false;
            var qType = (q.type || 'qcm').toLowerCase();

            if (qType === 'qcm' || qType === 'vrai_faux') {
                isCorrect = userAnswer !== null && String(userAnswer).toUpperCase() === String((q.bonne_reponse || q.reponse)).toUpperCase();
            } else if (qType === 'calcul') {
                var expected = parseFloat((q.bonne_reponse || q.reponse));
                var given = parseFloat(userAnswer);
                if (!isNaN(expected) && !isNaN(given)) isCorrect = Math.abs(expected - given) < 0.01;
            } else if (qType === 'redactionnel') {
                isCorrect = userAnswer !== null && String(userAnswer).trim().length > 0;
            }

            if (isCorrect) correct++;

            var blocKey = q.bloc_label || ('Bloc ' + (q.bloc || '?'));
            if (!scoresByBloc[blocKey]) scoresByBloc[blocKey] = { correct: 0, total: 0 };
            scoresByBloc[blocKey].total++;
            if (isCorrect) scoresByBloc[blocKey].correct++;

            questionResults.push({
                index: i, question: q, userAnswer: userAnswer,
                correctAnswer: (q.bonne_reponse || q.reponse), isCorrect: isCorrect,
                explication: q.explication || null
            });
        }

        var duration = 0;
        if (state.startTime && state.endTime) {
            duration = Math.round((state.endTime.getTime() - state.startTime.getTime()) / 1000);
        }

        return {
            score: total > 0 ? Math.round((correct / total) * 100) : 0,
            correct: correct, total: total,
            scoresByBloc: scoresByBloc, duration: duration,
            questionResults: questionResults
        };
    }

    function saveSession(results) {
        var sessions = loadData('ct_sessions') || [];
        var blocScores = {};
        for (var key in results.scoresByBloc) {
            if (results.scoresByBloc.hasOwnProperty(key)) {
                var b = results.scoresByBloc[key];
                blocScores[key] = b.total > 0 ? Math.round((b.correct / b.total) * 100) : 0;
            }
        }
        sessions.push({
            id: generateId(), date: new Date().toISOString(),
            type: state.sessionType, duration: results.duration,
            score: results.score, scoresByBloc: blocScores,
            totalQuestions: results.total, correctAnswers: results.correct
        });
        saveData('ct_sessions', sessions);
    }

    function saveQuestionHistory() {
        var history = loadData('ct_question_history') || {};
        for (var i = 0; i < state.questions.length; i++) {
            var q = state.questions[i];
            var userAnswer = state.answers[q.id] || null;
            var qType = (q.type || 'qcm').toLowerCase();
            var isCorrect = false;

            if (qType === 'qcm' || qType === 'vrai_faux') {
                isCorrect = userAnswer !== null && String(userAnswer).toUpperCase() === String((q.bonne_reponse || q.reponse)).toUpperCase();
            } else if (qType === 'calcul') {
                var exp = parseFloat((q.bonne_reponse || q.reponse));
                var giv = parseFloat(userAnswer);
                if (!isNaN(exp) && !isNaN(giv)) isCorrect = Math.abs(exp - giv) < 0.01;
            } else if (qType === 'redactionnel') {
                isCorrect = userAnswer !== null && String(userAnswer).trim().length > 0;
            }

            if (!history[q.id]) {
                history[q.id] = { attempts: 0, correct: 0, lastSeen: null, bloc: q.bloc || null };
            }
            history[q.id].attempts++;
            if (isCorrect) history[q.id].correct++;
            history[q.id].lastSeen = new Date().toISOString();
        }
        saveData('ct_question_history', history);
    }

    // =========================================================================
    // Show Results
    // =========================================================================

    function showResults(results) {
        var el;
        el = $('exam-question-area'); if (el) el.style.display = 'none';
        el = $('exam-choices'); if (el) el.style.display = 'none';
        el = $('exam-text-input'); if (el) el.style.display = 'none';
        el = $('exam-number-input'); if (el) el.style.display = 'none';
        el = qs('.exam__bottombar'); if (el) el.style.display = 'none';
        el = $('exam-navigator'); if (el) el.style.display = 'none';
        el = qs('.exam__topbar'); if (el) el.style.display = 'none';

        el = $('exam-results'); if (el) el.style.display = '';

        var scoreVal = $('results-score-value');
        if (scoreVal) scoreVal.textContent = results.score + '%';

        renderScoreChart(results);
        renderBlocsChart(results);
        renderResultsList(results);
    }

    // =========================================================================
    // Charts
    // =========================================================================

    function renderScoreChart(results) {
        var canvas = $('chart-results-score');
        if (!canvas || typeof Chart === 'undefined') return;
        if (scoreChartInstance) { scoreChartInstance.destroy(); scoreChartInstance = null; }

        var score = results.score;
        var color = score >= 70 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444';

        scoreChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['Correctes', 'Incorrectes'],
                datasets: [{ data: [score, 100 - score], backgroundColor: [color, '#e5e7eb'], borderWidth: 0 }]
            },
            options: {
                responsive: true, maintainAspectRatio: true, cutout: '70%',
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: function (ctx) { return ctx.label + ' : ' + ctx.raw + '%'; } } }
                }
            }
        });
    }

    function renderBlocsChart(results) {
        var canvas = $('chart-results-blocs');
        if (!canvas || typeof Chart === 'undefined') return;
        if (blocsChartInstance) { blocsChartInstance.destroy(); blocsChartInstance = null; }

        var labels = [], data = [], colors = [];
        var palette = ['#3b82f6', '#8b5cf6', '#06b6d4', '#f59e0b', '#ef4444', '#22c55e'];
        var idx = 0;
        for (var key in results.scoresByBloc) {
            if (results.scoresByBloc.hasOwnProperty(key)) {
                var b = results.scoresByBloc[key];
                labels.push(key);
                data.push(b.total > 0 ? Math.round((b.correct / b.total) * 100) : 0);
                colors.push(palette[idx % palette.length]);
                idx++;
            }
        }

        blocsChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{ label: 'Score (%)', data: data, backgroundColor: colors, borderRadius: 6, barThickness: 40 }]
            },
            options: {
                responsive: true, maintainAspectRatio: true,
                scales: {
                    y: { beginAtZero: true, max: 100, ticks: { callback: function (v) { return v + '%'; } } }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: function (ctx) { return ctx.raw + '%'; } } }
                }
            }
        });
    }

    // =========================================================================
    // Results list
    // =========================================================================

    function renderResultsList(results) {
        var list = $('results-list');
        if (!list) return;
        list.innerHTML = '';

        for (var i = 0; i < results.questionResults.length; i++) {
            var qr = results.questionResults[i];
            var li = document.createElement('li');
            li.className = 'results-list__item' + (qr.isCorrect ? ' results-list__item--correct' : ' results-list__item--incorrect');

            var summary = document.createElement('div');
            summary.className = 'results-list__summary';
            summary.setAttribute('role', 'button');
            summary.setAttribute('tabindex', '0');
            summary.setAttribute('aria-expanded', 'false');

            var icon = qr.isCorrect
                ? '<i class="fas fa-check-circle" style="color:#22c55e;" aria-hidden="true"></i>'
                : '<i class="fas fa-times-circle" style="color:#ef4444;" aria-hidden="true"></i>';

            var qText = qr.question.question || qr.question.texte || '';
            var truncated = qText.length > 80 ? qText.substring(0, 80) + '...' : qText;

            summary.innerHTML = '<span class="results-list__number">' + icon + ' Q' + (i + 1) + '</span>' +
                '<span class="results-list__text">' + escapeHtml(truncated) + '</span>';

            var detail = document.createElement('div');
            detail.className = 'results-list__detail';
            detail.style.display = 'none';

            var userDisp = formatAnswerDisplay(qr.question, qr.userAnswer);
            var correctDisp = formatAnswerDisplay(qr.question, qr.correctAnswer);
            var html = '<p><strong>Votre r\u00e9ponse :</strong> ' + escapeHtml(userDisp) + '</p>' +
                '<p><strong>Bonne r\u00e9ponse :</strong> ' + escapeHtml(correctDisp) + '</p>';
            if (qr.explication) html += '<p class="results-list__explication"><strong>Explication :</strong> ' + escapeHtml(qr.explication) + '</p>';
            detail.innerHTML = html;

            (function (s, d) {
                s.addEventListener('click', function () {
                    var open = d.style.display !== 'none';
                    d.style.display = open ? 'none' : '';
                    s.setAttribute('aria-expanded', open ? 'false' : 'true');
                });
                s.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); s.click(); }
                });
            })(summary, detail);

            li.appendChild(summary);
            li.appendChild(detail);
            list.appendChild(li);
        }
    }

    function formatAnswerDisplay(question, answer) {
        if (answer === null || answer === undefined) return 'Pas de r\u00e9ponse';
        var qType = (question.type || 'qcm').toLowerCase();
        if (qType === 'qcm' || qType === 'vrai_faux') {
            var choices = question.choix || question.choices || {};
            var text = choices[answer] || '';
            return answer + (text ? ' - ' + text : '');
        }
        return String(answer);
    }

    // =========================================================================
    // Ask MAX
    // =========================================================================

    async function askMax() {
        if (!state.active || state.questions.length === 0) return;
        var q = state.questions[state.currentIndex];
        var currentAnswer = state.answers[q.id] || null;

        // Afficher imm\u00e9diatement la bulle MAX avec indicateur de r\u00e9flexion
        showMaxThinking(q, currentAnswer);

        var explanation = null;
        try {
            // L'API re\u00e7oit la question compl\u00e8te + la r\u00e9ponse de l'\u00e9tudiant
            // MAX sait donc d\u00e9j\u00e0 exactement quelle est la question
            var result = await CT.API.getExplanation(q, currentAnswer);
            if (result && result.explanation) explanation = result.explanation;
            else if (result && typeof result === 'string') explanation = result;
        } catch (err) {
            console.warn('API indisponible pour l\'explication:', err);
        }

        if (!explanation) {
            explanation = q.explication ||
                'Pour cette question, la bonne r\u00e9ponse est ' +
                (q.bonne_reponse || q.reponse || '(non disponible)') +
                '. Relisez attentivement la question et comparez chaque option.';
        }

        updateMaxAnswer(explanation);
    }

    function showMaxThinking(q, userAnswer) {
        removeInlineExplanation();
        var area = $('exam-question-area');
        if (!area) return;

        var qText = q.question || q.texte || '';
        var truncated = qText.length > 120 ? qText.substring(0, 120) + '...' : qText;

        var div = document.createElement('div');
        div.id = 'exam-max-explanation';
        div.className = 'exam__max-explanation';
        div.innerHTML = '<div class="exam__max-explanation-header">' +
            '<i class="fas fa-user-tie" aria-hidden="true"></i> <strong>MAX r\u00e9pond \u00e0 votre question</strong>' +
            '<button class="exam__max-explanation-close" aria-label="Fermer">&times;</button>' +
            '</div>' +
            '<p class="exam__max-explanation-q"><em>\u00ab ' + escapeHtml(truncated) + ' \u00bb</em></p>' +
            (userAnswer ? '<p class="exam__max-explanation-ua">Votre r\u00e9ponse : <strong>' + escapeHtml(userAnswer) + '</strong></p>' : '') +
            '<p id="exam-max-answer"><i class="fas fa-spinner fa-spin"></i> MAX analyse la question...</p>';
        area.appendChild(div);

        var closeBtn = div.querySelector('.exam__max-explanation-close');
        if (closeBtn) closeBtn.addEventListener('click', function () { removeInlineExplanation(); });

        div.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // Mini-rendu Markdown -> HTML (titres, gras, italique, listes, code inline)
    function renderMarkdown(text) {
        if (!text) return '';
        var html = escapeHtml(text);

        // Titres ### / ## / #
        html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
        html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
        html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
        html = html.replace(/^###\s+(.+)$/gm, '<h4>$1</h4>');
        html = html.replace(/^##\s+(.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^#\s+(.+)$/gm, '<h3>$1</h3>');

        // Gras **texte** et __texte__
        html = html.replace(/\*\*([^\*\n]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');

        // Italique *texte* et _texte_ (en évitant ** déjà traité)
        html = html.replace(/(^|[^\*])\*([^\*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
        html = html.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');

        // Code inline `code`
        html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');

        // Listes à puces (- ou *)
        html = html.replace(/^[\-\*]\s+(.+)$/gm, '<li>$1</li>');
        // Regrouper les <li> consécutifs en <ul>
        html = html.replace(/(<li>[\s\S]*?<\/li>)(?:\s*(<li>[\s\S]*?<\/li>))+/g, function (match) {
            return '<ul>' + match.replace(/\s*\n\s*/g, '') + '</ul>';
        });
        // Cas d'un <li> isolé
        html = html.replace(/(?<!<\/ul>)(?<!<ul>)(<li>[\s\S]*?<\/li>)(?!<li>)(?!<\/ul>)/g, '<ul>$1</ul>');

        // Sauts de ligne -> <br> (sauf après un bloc HTML)
        html = html.replace(/\n+/g, function (m) { return m.length > 1 ? '<br><br>' : '<br>'; });
        // Nettoyage des <br> autour des blocs
        html = html.replace(/<br>\s*(<\/?(h[1-6]|ul|li|p)>)/g, '$1');
        html = html.replace(/(<\/?(h[1-6]|ul|li|p)>)\s*<br>/g, '$1');

        return html;
    }

    function updateMaxAnswer(text) {
        var ans = $('exam-max-answer');
        if (ans) {
            ans.innerHTML = renderMarkdown(text);
        } else {
            // Fallback si la bulle a disparu
            var area = $('exam-question-area');
            if (!area) { toast(text, 'info'); return; }
            var div = document.createElement('div');
            div.id = 'exam-max-explanation';
            div.className = 'exam__max-explanation';
            div.innerHTML = '<div class="exam__max-explanation-header">' +
                '<i class="fas fa-user-tie"></i> <strong>MAX dit :</strong>' +
                '<button class="exam__max-explanation-close">&times;</button>' +
                '</div><div class="exam__max-explanation-body">' + renderMarkdown(text) + '</div>';
            area.appendChild(div);
            var cb = div.querySelector('.exam__max-explanation-close');
            if (cb) cb.addEventListener('click', function () { removeInlineExplanation(); });
        }
    }

    function removeInlineExplanation() {
        var el = $('exam-max-explanation');
        if (el && el.parentElement) el.parentElement.removeChild(el);
    }

    // =========================================================================
    // End Session
    // =========================================================================

    function endSession() {
        stopTimer();
        state.active = false;
        state.sessionType = null;
        state.selectedBloc = null;
        state.difficulty = 'melange';
        state.questions = [];
        state.currentIndex = 0;
        state.answers = {};
        state.timeRemaining = 0;
        state.startTime = null;
        state.endTime = null;

        if (scoreChartInstance) { scoreChartInstance.destroy(); scoreChartInstance = null; }
        if (blocsChartInstance) { blocsChartInstance.destroy(); blocsChartInstance = null; }

        var timerEl = $('exam-timer');
        if (timerEl) {
            timerEl.classList.remove('exam__timer--danger');
            var p = timerEl.closest('.exam__timer') || timerEl.parentElement;
            if (p) p.classList.remove('exam__timer--danger');
        }

        showPage('page-dashboard');
    }

    // =========================================================================
    // Confirm finish
    // =========================================================================

    function confirmFinish() {
        saveCurrentAnswer();
        var answered = 0;
        for (var i = 0; i < state.questions.length; i++) {
            var qId = state.questions[i].id;
            if (state.answers[qId] !== undefined && state.answers[qId] !== null && state.answers[qId] !== '') answered++;
        }
        var unanswered = state.questions.length - answered;
        var msg = 'Voulez-vous vraiment terminer l\'\u00e9preuve ?';
        if (unanswered > 0) msg += '\n\nAttention : ' + unanswered + ' question' + (unanswered > 1 ? 's' : '') + ' sans r\u00e9ponse.';
        if (confirm(msg)) finishExam();
    }

    // =========================================================================
    // Event listeners
    // =========================================================================

    function init() {
        var choiceBtns = qsa('.exam__choice');
        for (var i = 0; i < choiceBtns.length; i++) {
            choiceBtns[i].addEventListener('click', function () {
                selectChoice(this.getAttribute('data-choice'));
            });
        }

        var prevBtn = $('exam-prev-btn');
        if (prevBtn) prevBtn.addEventListener('click', function () { prevQuestion(); });

        var nextBtn = $('exam-next-btn');
        if (nextBtn) nextBtn.addEventListener('click', function () { nextQuestion(); });

        var skipBtn = $('exam-skip-btn');
        if (skipBtn) skipBtn.addEventListener('click', function () { skipQuestion(); });

        var askMaxBtn = $('exam-ask-max-btn');
        if (askMaxBtn) askMaxBtn.addEventListener('click', function () { askMax(); });

        var finishBtn = $('exam-finish-btn');
        if (finishBtn) finishBtn.addEventListener('click', function () { confirmFinish(); });

        var retryBtn = $('results-retry-btn');
        if (retryBtn) {
            retryBtn.addEventListener('click', function () {
                var st = state.sessionType || 'quiz-eclair';
                var bl = state.selectedBloc;
                var df = state.difficulty;
                endSession();
                startSession(st, bl, df);
            });
        }

        var dashBtn = $('results-dashboard-btn');
        if (dashBtn) dashBtn.addEventListener('click', function () { endSession(); });

        var textarea = $('exam-redactionnel');
        if (textarea) textarea.addEventListener('blur', function () { saveCurrentAnswer(); updateNavigatorGrid(); });

        var numInput = $('exam-calcul');
        if (numInput) numInput.addEventListener('blur', function () { saveCurrentAnswer(); updateNavigatorGrid(); });

        console.log('[CapaTransport Pro] Module Examen initialis\u00e9.');
    }

    // =========================================================================
    // Auto-init
    // =========================================================================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // =========================================================================
    // Public API
    // =========================================================================

    return {
        state: state,
        startSession: startSession,
        displayQuestion: displayQuestion,
        selectChoice: selectChoice,
        nextQuestion: nextQuestion,
        prevQuestion: prevQuestion,
        skipQuestion: skipQuestion,
        goToQuestion: goToQuestion,
        startTimer: startTimer,
        stopTimer: stopTimer,
        finishExam: finishExam,
        askMax: askMax,
        endSession: endSession,
        confirmFinish: confirmFinish,
        init: init
    };

})();
