/**
 * CapaTransport Pro — Module Dashboard & Statistiques
 * Chargé après exam.js, avant app.js.
 * Tout est attaché au namespace global CT.
 */

window.CT = window.CT || {};

CT.Dashboard = (function () {

    // =========================================================================
    // Chart instances (stored for cleanup)
    // =========================================================================
    var charts = {
        scoreGlobal: null,
        blocsRadar: null,
        evolutionScore: null,
        statsRadar: null,
        repartitionErreurs: null,
        tempsQuestion: null
    };

    // =========================================================================
    // Helpers
    // =========================================================================

    function $(id) { return document.getElementById(id); }
    function qs(sel) { return document.querySelector(sel); }
    function qsa(sel) { return document.querySelectorAll(sel); }

    function loadData(key, defaultValue) {
        if (CT.Utils && typeof CT.Utils.loadData === 'function') {
            var result = CT.Utils.loadData(key, defaultValue);
            return result !== undefined ? result : defaultValue;
        }
        try {
            var raw = localStorage.getItem(key);
            if (raw === null) return defaultValue;
            return JSON.parse(raw);
        } catch (e) {
            return defaultValue;
        }
    }

    function getProfile() {
        var profile = loadData('ct_profile', null);
        if (!profile && CT.DemoData) {
            profile = CT.DemoData.profile;
        }
        return profile || { prenom: 'Utilisateur', examDate: null, scoreGlobal: 0 };
    }

    function getSessions() {
        var sessions = loadData('ct_sessions', null);
        if (sessions && sessions.length > 0) return sessions;
        if (CT.DemoData && CT.DemoData.recentSessions) {
            return CT.DemoData.recentSessions.map(function (s) {
                return {
                    id: s.id,
                    date: s.date,
                    score: s.score,
                    type: s.type,
                    totalQuestions: s.nbQuestions,
                    correctAnswers: Math.round(s.nbQuestions * s.score / 100),
                    duration: s.duree * 60,
                    scoresByBloc: {}
                };
            });
        }
        return [];
    }

    function getQuestionHistory() {
        return loadData('ct_question_history', {});
    }

    function destroyChart(key) {
        if (charts[key]) {
            charts[key].destroy();
            charts[key] = null;
        }
    }

    function formatDateShort(isoString) {
        if (!isoString) return '';
        var d = new Date(isoString);
        var day = ('0' + d.getDate()).slice(-2);
        var month = ('0' + (d.getMonth() + 1)).slice(-2);
        return day + '/' + month + '/' + d.getFullYear();
    }

    function formatDuration(seconds) {
        if (!seconds || seconds <= 0) return '0min';
        var m = Math.round(seconds / 60);
        if (m < 60) return m + 'min';
        var h = Math.floor(m / 60);
        var rem = m % 60;
        if (rem === 0) return h + 'h';
        return h + 'h ' + rem + 'min';
    }

    function isSameDay(date1, date2) {
        return date1.getFullYear() === date2.getFullYear() &&
               date1.getMonth() === date2.getMonth() &&
               date1.getDate() === date2.getDate();
    }

    function scoreColor(score) {
        if (score >= 70) return '#22c55e';
        if (score >= 50) return '#FF6B00';
        return '#ef4444';
    }

    // =========================================================================
    // calculateStreak
    // =========================================================================

    function calculateStreak() {
        var sessions = loadData('ct_sessions', null);
        if (!sessions || sessions.length === 0) {
            // Demo: return 3 days streak
            return 3;
        }

        // Build a set of dates (YYYY-MM-DD) that have sessions
        var dateSet = {};
        for (var i = 0; i < sessions.length; i++) {
            var d = new Date(sessions[i].date);
            var key = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
            dateSet[key] = true;
        }

        var streak = 0;
        var check = new Date();
        check.setHours(0, 0, 0, 0);

        // Check today first, then go backward
        while (true) {
            var k = check.getFullYear() + '-' + ('0' + (check.getMonth() + 1)).slice(-2) + '-' + ('0' + check.getDate()).slice(-2);
            if (dateSet[k]) {
                streak++;
                check.setDate(check.getDate() - 1);
            } else {
                // If today has no session but yesterday does, don't break immediately
                // (user might not have done anything today yet)
                if (streak === 0) {
                    check.setDate(check.getDate() - 1);
                    var k2 = check.getFullYear() + '-' + ('0' + (check.getMonth() + 1)).slice(-2) + '-' + ('0' + check.getDate()).slice(-2);
                    if (dateSet[k2]) {
                        streak++;
                        check.setDate(check.getDate() - 1);
                        continue;
                    }
                }
                break;
            }
        }
        return streak;
    }

    // =========================================================================
    // calculateStats(period) — period: 7, 30, or 'all'
    // =========================================================================

    function calculateStats(period) {
        var sessions = getSessions();
        var history = getQuestionHistory();
        var now = new Date();
        var cutoff = null;

        if (period === 7) {
            cutoff = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
        } else if (period === 30) {
            cutoff = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
        }

        // Filter sessions by period
        var filtered = sessions;
        if (cutoff) {
            filtered = sessions.filter(function (s) {
                return new Date(s.date) >= cutoff;
            });
        }

        var totalQuestions = 0;
        var correctAnswers = 0;
        var totalTimeSeconds = 0;
        var scoresByDate = {};
        var errorsByBloc = { bloc1: 0, bloc2: 0, bloc3: 0, bloc4: 0 };
        var questionsByBloc = { bloc1: 0, bloc2: 0, bloc3: 0, bloc4: 0 };
        var timeByBloc = { bloc1: 0, bloc2: 0, bloc3: 0, bloc4: 0 };
        var countByBloc = { bloc1: 0, bloc2: 0, bloc3: 0, bloc4: 0 };

        for (var i = 0; i < filtered.length; i++) {
            var s = filtered[i];
            var tq = s.totalQuestions || s.nbQuestions || 0;
            var ca = s.correctAnswers || Math.round(tq * (s.score || 0) / 100);
            totalQuestions += tq;
            correctAnswers += ca;
            totalTimeSeconds += (s.duration || (s.duree ? s.duree * 60 : 0));

            // Score by date
            var dateKey = formatDateShort(s.date);
            if (!scoresByDate[dateKey]) {
                scoresByDate[dateKey] = { total: 0, count: 0 };
            }
            scoresByDate[dateKey].total += (s.score || 0);
            scoresByDate[dateKey].count++;

            // Errors by bloc
            if (s.scoresByBloc) {
                for (var bk in s.scoresByBloc) {
                    if (s.scoresByBloc.hasOwnProperty(bk)) {
                        var blocKey = bk.indexOf('bloc') === 0 ? bk : 'bloc' + bk;
                        if (errorsByBloc.hasOwnProperty(blocKey)) {
                            // Approximate: lower score = more errors for that bloc
                            var blocScore = s.scoresByBloc[bk];
                            questionsByBloc[blocKey] += tq / 4; // approximate
                            errorsByBloc[blocKey] += Math.round((tq / 4) * (100 - blocScore) / 100);
                        }
                    }
                }
            }
        }

        // If no real bloc data, use demo approximation
        var hasRealBlocData = false;
        for (var b in questionsByBloc) {
            if (questionsByBloc[b] > 0) { hasRealBlocData = true; break; }
        }
        if (!hasRealBlocData && CT.DemoData) {
            var ds = CT.DemoData.blocScores;
            errorsByBloc = {
                bloc1: Math.round(50 * (100 - ds.bloc1) / 100),
                bloc2: Math.round(50 * (100 - ds.bloc2) / 100),
                bloc3: Math.round(50 * (100 - ds.bloc3) / 100),
                bloc4: Math.round(50 * (100 - ds.bloc4) / 100)
            };
        }

        // Avg time by bloc (approximate from sessions)
        var avgTimeByBloc = {
            bloc1: 45,
            bloc2: 52,
            bloc3: 38,
            bloc4: 48
        };
        // If we have real history data, compute from it
        var histKeys = Object.keys(history);
        if (histKeys.length > 0) {
            var blocAttempts = { bloc1: 0, bloc2: 0, bloc3: 0, bloc4: 0 };
            for (var hi = 0; hi < histKeys.length; hi++) {
                var hq = history[histKeys[hi]];
                if (hq.bloc) {
                    var hbk = 'bloc' + hq.bloc;
                    if (blocAttempts.hasOwnProperty(hbk)) {
                        blocAttempts[hbk] += hq.attempts || 0;
                    }
                }
            }
            // Rough avg time estimate
            if (totalTimeSeconds > 0 && totalQuestions > 0) {
                var avgPerQ = totalTimeSeconds / totalQuestions;
                for (var ab in avgTimeByBloc) {
                    if (blocAttempts[ab] > 0) {
                        avgTimeByBloc[ab] = Math.round(avgPerQ * (0.8 + Math.random() * 0.4));
                    }
                }
            }
        }

        var successRate = totalQuestions > 0 ? Math.round((correctAnswers / totalQuestions) * 100) : 0;
        var totalTimeMinutes = Math.round(totalTimeSeconds / 60);

        // Build scores by date object for chart
        var sortedDates = Object.keys(scoresByDate).sort(function (a, b) {
            var pa = a.split('/'); var pb = b.split('/');
            var da = new Date(pa[2], pa[1] - 1, pa[0]);
            var db = new Date(pb[2], pb[1] - 1, pb[0]);
            return da - db;
        });
        var chartDates = [];
        var chartScores = [];
        for (var di = 0; di < sortedDates.length; di++) {
            chartDates.push(sortedDates[di]);
            var entry = scoresByDate[sortedDates[di]];
            chartScores.push(Math.round(entry.total / entry.count));
        }

        // If no chart data, provide demo
        if (chartDates.length === 0 && CT.DemoData) {
            var demoSess = CT.DemoData.recentSessions;
            for (var dsi = demoSess.length - 1; dsi >= 0; dsi--) {
                chartDates.push(formatDateShort(demoSess[dsi].date));
                chartScores.push(demoSess[dsi].score);
            }
        }

        // Bloc scores for radar
        var blocScores = getBlocScores();

        return {
            totalQuestions: totalQuestions || (CT.DemoData ? 120 : 0),
            correctAnswers: correctAnswers,
            successRate: successRate || (CT.DemoData ? 67 : 0),
            totalTimeMinutes: totalTimeMinutes || (CT.DemoData ? 218 : 0),
            sessions: filtered,
            scoresByDate: { dates: chartDates, scores: chartScores },
            errorsByBloc: errorsByBloc,
            avgTimeByBloc: avgTimeByBloc,
            blocScores: blocScores,
            streak: calculateStreak()
        };
    }

    // =========================================================================
    // getBlocScores — from sessions or demo
    // =========================================================================

    function getBlocScores() {
        var sessions = loadData('ct_sessions', null);
        if (sessions && sessions.length > 0) {
            var blocTotals = { bloc1: 0, bloc2: 0, bloc3: 0, bloc4: 0 };
            var blocCounts = { bloc1: 0, bloc2: 0, bloc3: 0, bloc4: 0 };
            for (var i = 0; i < sessions.length; i++) {
                var sb = sessions[i].scoresByBloc;
                if (sb) {
                    for (var bk in sb) {
                        if (sb.hasOwnProperty(bk)) {
                            var key = bk.indexOf('bloc') === 0 ? bk : 'bloc' + bk;
                            if (blocTotals.hasOwnProperty(key)) {
                                blocTotals[key] += sb[bk];
                                blocCounts[key]++;
                            }
                        }
                    }
                }
            }
            var result = {};
            for (var b in blocTotals) {
                result[b] = blocCounts[b] > 0 ? Math.round(blocTotals[b] / blocCounts[b]) : 0;
            }
            // If all zeros, fall back to demo
            var hasData = false;
            for (var r in result) { if (result[r] > 0) { hasData = true; break; } }
            if (hasData) return result;
        }
        if (CT.DemoData && CT.DemoData.blocScores) {
            return CT.DemoData.blocScores;
        }
        return { bloc1: 0, bloc2: 0, bloc3: 0, bloc4: 0 };
    }

    // =========================================================================
    // getGlobalScore — average of all session scores
    // =========================================================================

    function getGlobalScore() {
        var sessions = loadData('ct_sessions', null);
        if (sessions && sessions.length > 0) {
            var total = 0;
            for (var i = 0; i < sessions.length; i++) {
                total += (sessions[i].score || 0);
            }
            return Math.round(total / sessions.length);
        }
        var profile = getProfile();
        if (profile.scoreGlobal) return profile.scoreGlobal;
        if (CT.DemoData && CT.DemoData.profile) return CT.DemoData.profile.scoreGlobal;
        return 0;
    }

    // =========================================================================
    // renderScoreGauge
    // =========================================================================

    function renderScoreGauge() {
        var canvas = $('chart-score-global');
        if (!canvas || typeof Chart === 'undefined') return;

        destroyChart('scoreGlobal');

        var score = getGlobalScore();

        charts.scoreGlobal = new Chart(canvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                datasets: [{
                    data: [score, 100 - score],
                    backgroundColor: ['#FF6B00', '#1A2744'],
                    borderWidth: 0,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: false,
                cutout: '75%',
                rotation: -90,
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false }
                },
                animation: {
                    animateRotate: true,
                    duration: 1200
                }
            }
        });

        var scoreEl = $('score-global-value');
        if (scoreEl) scoreEl.textContent = score + '%';
    }

    // =========================================================================
    // renderBlocsRadar
    // =========================================================================

    function renderBlocsRadar() {
        var canvas = $('chart-blocs-radar');
        if (!canvas || typeof Chart === 'undefined') return;

        destroyChart('blocsRadar');

        var blocScores = getBlocScores();

        charts.blocsRadar = new Chart(canvas.getContext('2d'), {
            type: 'radar',
            data: {
                labels: ['Droit', 'RETM', 'Gestion', 'International'],
                datasets: [{
                    label: 'Score par bloc',
                    data: [
                        blocScores.bloc1 || 0,
                        blocScores.bloc2 || 0,
                        blocScores.bloc3 || 0,
                        blocScores.bloc4 || 0
                    ],
                    backgroundColor: 'rgba(255, 107, 0, 0.3)',
                    borderColor: '#FF6B00',
                    borderWidth: 2,
                    pointBackgroundColor: '#FF6B00',
                    pointBorderColor: '#FF6B00',
                    pointRadius: 4
                }]
            },
            options: {
                responsive: false,
                scales: {
                    r: {
                        min: 0,
                        max: 100,
                        ticks: {
                            stepSize: 25,
                            color: '#B0BEC5',
                            backdropColor: 'transparent',
                            font: { size: 10 }
                        },
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        },
                        angleLines: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        },
                        pointLabels: {
                            color: '#FFFFFF',
                            font: { size: 12, family: 'Roboto' }
                        }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function (ctx) {
                                return ctx.label + ' : ' + ctx.raw + '%';
                            }
                        }
                    }
                }
            }
        });
    }

    // =========================================================================
    // renderTimeline
    // =========================================================================

    function renderTimeline() {
        var container = $('activity-timeline');
        if (!container) return;

        var sessions = getSessions();
        // Sort by date descending
        sessions.sort(function (a, b) {
            return new Date(b.date) - new Date(a.date);
        });

        var last5 = sessions.slice(0, 5);

        if (last5.length === 0) {
            container.innerHTML = '<li class="timeline__item"><div class="timeline__content"><span class="timeline__desc">Aucune session pour le moment.</span></div></li>';
            return;
        }

        var html = '';
        for (var i = 0; i < last5.length; i++) {
            var s = last5[i];
            var score = s.score || 0;
            var color = scoreColor(score);
            var dateStr = formatDateShort(s.date);
            var type = s.type || 'Session';
            var duration = formatDuration(s.duration || (s.duree ? s.duree * 60 : 0));

            html += '<li class="timeline__item">' +
                '<div class="timeline__dot" style="background:' + color + '"></div>' +
                '<div class="timeline__content">' +
                '<span class="timeline__date">' + dateStr + '</span>' +
                '<span class="timeline__desc">' + CT.Utils.sanitize(type) + ' - ' + score + '% - ' + duration + '</span>' +
                '</div></li>';
        }

        container.innerHTML = html;
    }

    // =========================================================================
    // renderWeakPoints
    // =========================================================================

    function renderWeakPoints() {
        var container = $('weak-points-list');
        if (!container) return;

        var weakPoints = null;

        // Try to compute from question history
        var history = getQuestionHistory();
        var histKeys = Object.keys(history);
        if (histKeys.length > 0) {
            var themeScores = {};
            for (var i = 0; i < histKeys.length; i++) {
                var q = history[histKeys[i]];
                var theme = q.bloc ? 'Bloc ' + q.bloc : 'Autre';
                if (!themeScores[theme]) {
                    themeScores[theme] = { attempts: 0, correct: 0 };
                }
                themeScores[theme].attempts += q.attempts || 0;
                themeScores[theme].correct += q.correct || 0;
            }
            var entries = [];
            for (var t in themeScores) {
                if (themeScores.hasOwnProperty(t)) {
                    var ts = themeScores[t];
                    var sc = ts.attempts > 0 ? Math.round((ts.correct / ts.attempts) * 100) : 0;
                    entries.push({ name: t, score: sc });
                }
            }
            entries.sort(function (a, b) { return a.score - b.score; });
            if (entries.length > 0) {
                weakPoints = entries.slice(0, 4);
            }
        }

        if (!weakPoints && CT.DemoData && CT.DemoData.weakPoints) {
            weakPoints = CT.DemoData.weakPoints;
        }

        if (!weakPoints || weakPoints.length === 0) {
            container.innerHTML = '<li>Aucune donnée disponible.</li>';
            return;
        }

        var html = '';
        for (var w = 0; w < weakPoints.length; w++) {
            var wp = weakPoints[w];
            var wpColor = scoreColor(wp.score);
            html += '<li class="weak-point">' +
                '<div class="weak-point__header">' +
                '<span class="weak-point__name">' + CT.Utils.sanitize(wp.name) + '</span>' +
                '<span class="weak-point__score" style="color:' + wpColor + '">' + wp.score + '%</span>' +
                '</div>' +
                '<div class="weak-point__bar">' +
                '<div class="weak-point__fill" style="width:' + wp.score + '%;background:' + wpColor + '"></div>' +
                '</div></li>';
        }

        container.innerHTML = html;
    }

    // =========================================================================
    // renderGoals
    // =========================================================================

    function renderGoals() {
        var profile = getProfile();

        // Exam countdown
        var countdownEl = $('goal-countdown');
        if (countdownEl) {
            if (profile.examDate) {
                var days = CT.DateTime.daysUntil(profile.examDate);
                countdownEl.textContent = days > 0 ? 'J-' + days : (days === 0 ? "C'est aujourd'hui !" : 'Examen passé');
            } else {
                countdownEl.textContent = 'Non défini';
            }
        }

        // Daily goal: count today's questions
        var dailyEl = $('goal-daily');
        if (dailyEl) {
            var sessions = loadData('ct_sessions', null) || [];
            var today = new Date();
            var todayCount = 0;
            for (var i = 0; i < sessions.length; i++) {
                var sd = new Date(sessions[i].date);
                if (isSameDay(sd, today)) {
                    todayCount += (sessions[i].totalQuestions || sessions[i].nbQuestions || 0);
                }
            }
            dailyEl.textContent = todayCount + ' / 20 questions';
        }

        // Streak
        var streakEl = $('goal-streak');
        if (streakEl) {
            var streak = calculateStreak();
            streakEl.textContent = streak + ' jour' + (streak > 1 ? 's' : '');
        }
    }

    // =========================================================================
    // updateCountdown
    // =========================================================================

    function updateCountdown() {
        var el = $('countdown-text');
        if (!el) return;

        var profile = getProfile();
        if (profile.examDate) {
            var days = CT.DateTime.daysUntil(profile.examDate);
            if (days > 0) {
                el.textContent = 'J-' + days + ' avant l\'examen';
            } else if (days === 0) {
                el.textContent = "Jour de l'examen !";
            } else {
                el.textContent = 'Examen passé';
            }
        } else {
            el.textContent = 'Date d\'examen non définie';
        }
    }

    // =========================================================================
    // renderDashboard
    // =========================================================================

    function renderDashboard() {
        renderScoreGauge();
        renderBlocsRadar();
        renderTimeline();
        renderWeakPoints();
        renderGoals();
    }

    // =========================================================================
    // Stats Page — renderStats(period)
    // =========================================================================

    function renderStats(period) {
        period = period || 'all';
        var stats = calculateStats(period);

        // Update stat cards
        var el;
        el = $('stat-total-questions');
        if (el) el.textContent = stats.totalQuestions;

        el = $('stat-taux-reussite');
        if (el) el.textContent = stats.successRate + '%';

        el = $('stat-temps-total');
        if (el) {
            if (CT.Utils && CT.Utils.formatDuration) {
                el.textContent = CT.Utils.formatDuration(stats.totalTimeMinutes);
            } else {
                el.textContent = stats.totalTimeMinutes + 'min';
            }
        }

        el = $('stat-streak');
        if (el) el.textContent = stats.streak + ' jour' + (stats.streak > 1 ? 's' : '');

        // Render all 4 charts
        renderEvolutionChart(stats);
        renderStatsRadar(stats);
        renderErrorsChart(stats);
        renderTimeChart(stats);
    }

    // =========================================================================
    // renderEvolutionChart — Line chart
    // =========================================================================

    function renderEvolutionChart(data) {
        var canvas = $('chart-evolution-score');
        if (!canvas || typeof Chart === 'undefined') return;

        destroyChart('evolutionScore');

        var dates = data.scoresByDate.dates || [];
        var scores = data.scoresByDate.scores || [];

        charts.evolutionScore = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels: dates,
                datasets: [{
                    label: 'Score (%)',
                    data: scores,
                    borderColor: '#FF6B00',
                    backgroundColor: 'rgba(255, 107, 0, 0.15)',
                    fill: true,
                    tension: 0.3,
                    pointBackgroundColor: '#FF6B00',
                    pointBorderColor: '#FF6B00',
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        ticks: { color: '#B0BEC5', font: { size: 11 } },
                        grid: { color: 'rgba(255, 255, 255, 0.05)' }
                    },
                    y: {
                        min: 0,
                        max: 100,
                        ticks: {
                            color: '#B0BEC5',
                            stepSize: 25,
                            callback: function (val) { return val + '%'; }
                        },
                        grid: { color: 'rgba(255, 255, 255, 0.08)' }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function (ctx) { return 'Score : ' + ctx.raw + '%'; }
                        }
                    }
                }
            }
        });
    }

    // =========================================================================
    // renderStatsRadar — Radar chart on stats page
    // =========================================================================

    function renderStatsRadar(data) {
        var canvas = $('chart-stats-radar');
        if (!canvas || typeof Chart === 'undefined') return;

        destroyChart('statsRadar');

        var blocScores = data.blocScores || getBlocScores();

        charts.statsRadar = new Chart(canvas.getContext('2d'), {
            type: 'radar',
            data: {
                labels: ['Droit', 'RETM', 'Gestion', 'International'],
                datasets: [{
                    label: 'Score par bloc',
                    data: [
                        blocScores.bloc1 || 0,
                        blocScores.bloc2 || 0,
                        blocScores.bloc3 || 0,
                        blocScores.bloc4 || 0
                    ],
                    backgroundColor: 'rgba(255, 107, 0, 0.3)',
                    borderColor: '#FF6B00',
                    borderWidth: 2,
                    pointBackgroundColor: '#FF6B00',
                    pointBorderColor: '#FF6B00',
                    pointRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    r: {
                        min: 0,
                        max: 100,
                        ticks: {
                            stepSize: 25,
                            color: '#B0BEC5',
                            backdropColor: 'transparent',
                            font: { size: 10 }
                        },
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        },
                        angleLines: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        },
                        pointLabels: {
                            color: '#FFFFFF',
                            font: { size: 12, family: 'Roboto' }
                        }
                    }
                },
                plugins: {
                    legend: { display: false }
                }
            }
        });
    }

    // =========================================================================
    // renderErrorsChart — Doughnut chart
    // =========================================================================

    function renderErrorsChart(data) {
        var canvas = $('chart-repartition-erreurs');
        if (!canvas || typeof Chart === 'undefined') return;

        destroyChart('repartitionErreurs');

        var errors = data.errorsByBloc || {};

        charts.repartitionErreurs = new Chart(canvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['Droit', 'RETM', 'Gestion', 'International'],
                datasets: [{
                    data: [
                        errors.bloc1 || 0,
                        errors.bloc2 || 0,
                        errors.bloc3 || 0,
                        errors.bloc4 || 0
                    ],
                    backgroundColor: ['#E94560', '#FF6B00', '#FFC300', '#0F9B58'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '55%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: '#B0BEC5',
                            padding: 15,
                            font: { size: 12, family: 'Roboto' }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function (ctx) {
                                var total = 0;
                                var dataset = ctx.dataset.data;
                                for (var j = 0; j < dataset.length; j++) total += dataset[j];
                                var pct = total > 0 ? Math.round((ctx.raw / total) * 100) : 0;
                                return ctx.label + ' : ' + ctx.raw + ' erreurs (' + pct + '%)';
                            }
                        }
                    }
                }
            }
        });
    }

    // =========================================================================
    // renderTimeChart — Bar chart
    // =========================================================================

    function renderTimeChart(data) {
        var canvas = $('chart-temps-question');
        if (!canvas || typeof Chart === 'undefined') return;

        destroyChart('tempsQuestion');

        var avgTime = data.avgTimeByBloc || {};

        charts.tempsQuestion = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: ['Droit', 'RETM', 'Gestion', 'International'],
                datasets: [{
                    label: 'Temps moyen (s)',
                    data: [
                        avgTime.bloc1 || 0,
                        avgTime.bloc2 || 0,
                        avgTime.bloc3 || 0,
                        avgTime.bloc4 || 0
                    ],
                    backgroundColor: '#FF6B00',
                    borderRadius: 6,
                    borderSkipped: false,
                    barThickness: 40
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        ticks: { color: '#B0BEC5', font: { size: 12 } },
                        grid: { display: false }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: {
                            color: '#B0BEC5',
                            callback: function (val) { return val + 's'; }
                        },
                        grid: { color: 'rgba(255, 255, 255, 0.08)' }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function (ctx) { return 'Temps moyen : ' + ctx.raw + 's'; }
                        }
                    }
                }
            }
        });
    }

    // =========================================================================
    // Period selector setup
    // =========================================================================

    function setupPeriodSelector() {
        var buttons = qsa('.btn--period[data-period]');
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].addEventListener('click', function () {
                // Remove active class from all
                var all = qsa('.btn--period[data-period]');
                for (var j = 0; j < all.length; j++) {
                    all[j].classList.remove('btn--period--active');
                }
                // Add active to clicked
                this.classList.add('btn--period--active');
                // Get period
                var period = this.getAttribute('data-period');
                if (period === '7' || period === '30') {
                    period = parseInt(period, 10);
                }
                renderStats(period);
            });
        }
    }

    // =========================================================================
    // init
    // =========================================================================

    function init() {
        // Chart.js global defaults
        if (typeof Chart !== 'undefined') {
            Chart.defaults.color = '#B0BEC5';
            Chart.defaults.font.family = 'Roboto';
            Chart.defaults.plugins.legend.labels.color = '#B0BEC5';
        }

        // Set user firstname
        var profile = getProfile();
        var nameEl = $('user-firstname');
        if (nameEl) {
            nameEl.textContent = profile.prenom || 'Utilisateur';
        }

        // Update exam countdown in topbar
        updateCountdown();

        // Render dashboard
        renderDashboard();

        // Setup period selector for stats page
        setupPeriodSelector();

        console.log('[CapaTransport Pro] Module Dashboard initialisé.');
    }

    // =========================================================================
    // refresh — public, called after exam sessions
    // =========================================================================

    function refresh() {
        renderDashboard();
        updateCountdown();
        // Also refresh stats if on stats page
        var statsPage = $('page-stats');
        if (statsPage && (statsPage.style.display !== 'none' || statsPage.classList.contains('page--active'))) {
            var activeBtn = qs('.btn--period--active[data-period]');
            var period = 'all';
            if (activeBtn) {
                period = activeBtn.getAttribute('data-period');
                if (period === '7' || period === '30') period = parseInt(period, 10);
            }
            renderStats(period);
        }
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
        charts: charts,
        init: init,
        refresh: refresh,
        renderDashboard: renderDashboard,
        renderStats: renderStats,
        updateCountdown: updateCountdown,
        calculateStats: calculateStats,
        calculateStreak: calculateStreak
    };

})();
