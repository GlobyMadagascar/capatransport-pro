/**
 * CapaTransport Pro - Module API
 * Communication avec le serveur Express
 */

window.CT = window.CT || {};

CT.API = (function () {
    // =========================================================================
    // Configuration
    // =========================================================================

    let baseUrl = window.location.origin;

    function getHeaders() {
        return { 'Content-Type': 'application/json' };
    }

    // =========================================================================
    // Retry logic
    // =========================================================================

    async function fetchWithRetry(url, options, retries) {
        if (retries === undefined) retries = 3;

        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                const response = await fetch(url, options);
                return response;
            } catch (err) {
                if (attempt < retries - 1) {
                    const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
                    await new Promise(function (resolve) {
                        setTimeout(resolve, delay);
                    });
                } else {
                    throw err;
                }
            }
        }
    }

    // =========================================================================
    // Error handling helper
    // =========================================================================

    async function handleResponse(response) {
        if (response.status === 429) {
            CT.Toast.show('Trop de requêtes. Attendez un moment.', 'warning');
            return null;
        }

        if (response.status === 500) {
            var data = null;
            try {
                data = await response.json();
            } catch (e) {
                // ignore parse error
            }
            var msg = (data && data.error) ? data.error : 'Erreur interne du serveur.';
            CT.Toast.show(msg, 'error');
            return null;
        }

        if (!response.ok) {
            var body = null;
            try {
                body = await response.json();
            } catch (e) {
                // ignore
            }
            if (body && body.error && /cl[eé]\s*api/i.test(body.error)) {
                CT.Toast.show('Cl\u00e9 API non configur\u00e9e. Allez dans Param\u00e8tres.', 'error');
                return null;
            }
            var errMsg = (body && body.error) ? body.error : 'Erreur serveur (' + response.status + ')';
            CT.Toast.show(errMsg, 'error');
            return null;
        }

        return response.json();
    }

    function handleNetworkError() {
        CT.Toast.show('Connexion au serveur impossible. V\u00e9rifiez que le serveur est lanc\u00e9.', 'error');
        return null;
    }

    // =========================================================================
    // Health check
    // =========================================================================

    async function checkHealth() {
        try {
            var response = await fetchWithRetry(baseUrl + '/api/health', {
                method: 'GET',
                headers: getHeaders()
            });
            return await handleResponse(response);
        } catch (err) {
            return handleNetworkError();
        }
    }

    // =========================================================================
    // Document operations
    // =========================================================================

    async function uploadDocument(file, category) {
        try {
            var formData = new FormData();
            formData.append('file', file);
            formData.append('category', category);

            var response = await fetchWithRetry(baseUrl + '/api/upload', {
                method: 'POST',
                body: formData
                // No Content-Type header — browser sets multipart boundary automatically
            });
            return await handleResponse(response);
        } catch (err) {
            return handleNetworkError();
        }
    }

    async function getDocuments() {
        try {
            var response = await fetchWithRetry(baseUrl + '/api/documents', {
                method: 'GET',
                headers: getHeaders()
            });
            return await handleResponse(response);
        } catch (err) {
            return handleNetworkError();
        }
    }

    async function deleteDocument(id) {
        try {
            var response = await fetchWithRetry(baseUrl + '/api/documents/' + encodeURIComponent(id), {
                method: 'DELETE',
                headers: getHeaders()
            });
            return await handleResponse(response);
        } catch (err) {
            return handleNetworkError();
        }
    }

    async function scanExistingDocuments() {
        try {
            var response = await fetchWithRetry(baseUrl + '/api/scan-existing', {
                method: 'POST',
                headers: getHeaders()
            });
            return await handleResponse(response);
        } catch (err) {
            return handleNetworkError();
        }
    }

    async function analyzeDocument(documentId, content) {
        try {
            var response = await fetchWithRetry(baseUrl + '/api/analyze', {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({ documentId: documentId, content: content })
            });
            return await handleResponse(response);
        } catch (err) {
            return handleNetworkError();
        }
    }

    // =========================================================================
    // Question generation
    // =========================================================================

    async function generateQuestions(options) {
        try {
            var payload = {
                bloc: options.bloc,
                count: options.count,
                difficulty: options.difficulty,
                documentContext: options.documentContext || null,
                sessionType: options.sessionType || null
            };

            var response = await fetchWithRetry(baseUrl + '/api/generate-questions', {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify(payload)
            });
            return await handleResponse(response);
        } catch (err) {
            return handleNetworkError();
        }
    }

    // =========================================================================
    // Explanation
    // =========================================================================

    async function getExplanation(question, userAnswer) {
        try {
            var response = await fetchWithRetry(baseUrl + '/api/explain', {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({ question: question, userAnswer: userAnswer })
            });
            return await handleResponse(response);
        } catch (err) {
            return handleNetworkError();
        }
    }

    // =========================================================================
    // Chat with MAX
    // =========================================================================

    async function chatWithMax(message, conversationHistory, studentProfile) {
        try {
            var history = Array.isArray(conversationHistory)
                ? conversationHistory.slice(-10)
                : [];

            var response = await fetchWithRetry(baseUrl + '/api/chat', {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({
                    message: message,
                    history: history,
                    profile: studentProfile || null
                })
            });
            return await handleResponse(response);
        } catch (err) {
            return handleNetworkError();
        }
    }

    // =========================================================================
    // API key management (localStorage)
    // =========================================================================

    function saveApiKey(key) {
        try {
            localStorage.setItem('ct_api_key', key);
            return true;
        } catch (err) {
            CT.Toast.show('Impossible de sauvegarder la cl\u00e9 API.', 'error');
            return false;
        }
    }

    function getApiKey() {
        try {
            return localStorage.getItem('ct_api_key') || null;
        } catch (err) {
            return null;
        }
    }

    async function testApiKey(key) {
        try {
            var response = await fetchWithRetry(baseUrl + '/api/health', {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({ key: key })
            });
            return await handleResponse(response);
        } catch (err) {
            return handleNetworkError();
        }
    }

    // =========================================================================
    // Public API
    // =========================================================================

    return {
        baseUrl: baseUrl,
        getHeaders: getHeaders,
        fetchWithRetry: fetchWithRetry,

        // Health
        checkHealth: checkHealth,

        // Documents
        uploadDocument: uploadDocument,
        getDocuments: getDocuments,
        deleteDocument: deleteDocument,
        scanExistingDocuments: scanExistingDocuments,
        analyzeDocument: analyzeDocument,

        // Questions
        generateQuestions: generateQuestions,

        // Explanation
        getExplanation: getExplanation,

        // Chat
        chatWithMax: chatWithMax,

        // API key
        saveApiKey: saveApiKey,
        getApiKey: getApiKey,
        testApiKey: testApiKey
    };
})();
