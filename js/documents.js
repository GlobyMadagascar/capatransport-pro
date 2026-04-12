/**
 * CapaTransport Pro - Module Documents
 * Upload, gestion et affichage des documents de formation
 */

window.CT = window.CT || {};

CT.Documents = (function () {
    // =========================================================================
    // State
    // =========================================================================

    var documents = [];

    // =========================================================================
    // Constants
    // =========================================================================

    var MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

    var ACCEPTED_TYPES = {
        'application/pdf': 'pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
        'application/msword': 'doc',
        'text/plain': 'txt'
    };

    var ACCEPTED_EXTENSIONS = ['pdf', 'doc', 'docx', 'txt'];

    var CATEGORY_LABELS = {
        'annales': 'Annales',
        'reglementation': 'R\u00e9glementation',
        'retm': 'RETM',
        'bloc2_retm': 'RETM',
        'normes_techniques': 'Normes Tech.',
        'normes-techniques': 'Normes Tech.',
        'ventes_internationales': 'Ventes Int.',
        'ventes-internationales': 'Ventes Int.',
        'cours-personnels': 'Cours'
    };

    var ICON_MAP = {
        'pdf': 'fa-file-pdf',
        'docx': 'fa-file-word',
        'doc': 'fa-file-word',
        'txt': 'fa-file-alt'
    };

    var BLOC_TO_CATEGORIES = {
        1: ['reglementation'],
        2: ['retm', 'bloc2_retm'],
        3: ['normes_techniques', 'normes-techniques'],
        4: ['ventes_internationales', 'ventes-internationales']
    };

    // =========================================================================
    // Helpers
    // =========================================================================

    function getFileExtension(filename) {
        var parts = filename.split('.');
        if (parts.length < 2) return '';
        return parts[parts.length - 1].toLowerCase();
    }

    function getIconClass(filename) {
        var ext = getFileExtension(filename);
        return ICON_MAP[ext] || 'fa-file';
    }

    function getCategoryLabel(category) {
        return CATEGORY_LABELS[category] || category;
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        try {
            var d = new Date(dateStr);
            if (isNaN(d.getTime())) return dateStr;
            return d.toLocaleDateString('fr-FR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });
        } catch (e) {
            return dateStr;
        }
    }

    function formatFileSize(bytes) {
        if (!bytes) return '';
        if (bytes < 1024) return bytes + ' o';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' Ko';
        return (bytes / (1024 * 1024)).toFixed(1) + ' Mo';
    }

    function isValidFile(file) {
        // Check size
        if (file.size > MAX_FILE_SIZE) {
            return {
                valid: false,
                message: 'Le fichier "' + file.name + '" d\u00e9passe la taille maximale de 10 Mo (' + formatFileSize(file.size) + ').'
            };
        }

        // Check type by extension
        var ext = getFileExtension(file.name);
        if (ACCEPTED_EXTENSIONS.indexOf(ext) === -1) {
            return {
                valid: false,
                message: 'Le fichier "' + file.name + '" n\'est pas un format accept\u00e9. Formats autoris\u00e9s : PDF, DOC, DOCX, TXT.'
            };
        }

        return { valid: true, message: '' };
    }

    function saveToLocalStorage() {
        try {
            localStorage.setItem('ct_documents', JSON.stringify(documents));
        } catch (e) {
            // Silently fail if storage is full
        }
    }

    function loadFromLocalStorage() {
        try {
            var data = localStorage.getItem('ct_documents');
            if (data) {
                return JSON.parse(data);
            }
        } catch (e) {
            // Ignore parse errors
        }
        return [];
    }

    // =========================================================================
    // DOM references
    // =========================================================================

    function getElements() {
        return {
            uploadZone: document.getElementById('upload-zone'),
            fileInput: document.getElementById('file-input'),
            docCategory: document.getElementById('doc-category'),
            scanBtn: document.getElementById('scan-existing-btn'),
            processingIndicator: document.getElementById('processing-indicator'),
            progressBar: document.getElementById('processing-progress'),
            documentsGrid: document.getElementById('documents-grid'),
            documentsEmpty: document.getElementById('documents-empty')
        };
    }

    // =========================================================================
    // Init
    // =========================================================================

    function init() {
        var els = getElements();

        // Drag-and-drop setup
        if (els.uploadZone) {
            els.uploadZone.addEventListener('dragover', function (e) {
                e.preventDefault();
                e.stopPropagation();
                els.uploadZone.classList.add('upload-zone--active');
            });

            els.uploadZone.addEventListener('dragenter', function (e) {
                e.preventDefault();
                e.stopPropagation();
                els.uploadZone.classList.add('upload-zone--active');
            });

            els.uploadZone.addEventListener('dragleave', function (e) {
                e.preventDefault();
                e.stopPropagation();
                els.uploadZone.classList.remove('upload-zone--active');
            });

            els.uploadZone.addEventListener('drop', function (e) {
                e.preventDefault();
                e.stopPropagation();
                els.uploadZone.classList.remove('upload-zone--active');
                if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    handleFiles(e.dataTransfer.files);
                }
            });

            // Click to open file picker
            els.uploadZone.addEventListener('click', function () {
                if (els.fileInput) {
                    els.fileInput.click();
                }
            });
        }

        // File input change
        if (els.fileInput) {
            els.fileInput.addEventListener('change', function () {
                if (els.fileInput.files && els.fileInput.files.length > 0) {
                    handleFiles(els.fileInput.files);
                    // Reset so the same file can be re-uploaded
                    els.fileInput.value = '';
                }
            });
        }

        // Scan existing button
        if (els.scanBtn) {
            els.scanBtn.addEventListener('click', function () {
                scanExisting();
            });
        }

        // Load documents from server
        loadDocuments();
    }

    // =========================================================================
    // handleFiles
    // =========================================================================

    async function handleFiles(fileList) {
        var els = getElements();
        var files = Array.prototype.slice.call(fileList);
        var category = els.docCategory ? els.docCategory.value : 'annales';
        var totalFiles = files.length;
        var processed = 0;

        // Show processing indicator
        if (els.processingIndicator) {
            els.processingIndicator.style.display = '';
        }
        if (els.progressBar) {
            els.progressBar.style.width = '0%';
            els.progressBar.setAttribute('aria-valuenow', '0');
        }

        for (var i = 0; i < files.length; i++) {
            var file = files[i];

            // Validate
            var validation = isValidFile(file);
            if (!validation.valid) {
                if (CT.Toast) {
                    CT.Toast.show(validation.message, 'error');
                }
                processed++;
                updateProgress(processed, totalFiles, els);
                continue;
            }

            // Upload
            try {
                var result = await CT.API.uploadDocument(file, category);

                if (result) {
                    if (CT.Toast) {
                        CT.Toast.show('Document upload\u00e9 avec succ\u00e8s', 'success');
                    }
                } else {
                    if (CT.Toast) {
                        CT.Toast.show('Erreur lors de l\'upload de "' + file.name + '".', 'error');
                    }
                }
            } catch (err) {
                if (CT.Toast) {
                    CT.Toast.show('Erreur lors de l\'upload de "' + file.name + '" : ' + (err.message || 'erreur inconnue'), 'error');
                }
            }

            processed++;
            updateProgress(processed, totalFiles, els);
        }

        // Hide processing indicator
        if (els.processingIndicator) {
            els.processingIndicator.style.display = 'none';
        }

        // Refresh list
        loadDocuments();
    }

    function updateProgress(processed, total, els) {
        if (!els.progressBar) return;
        var pct = total > 0 ? Math.round((processed / total) * 100) : 0;
        els.progressBar.style.width = pct + '%';
        els.progressBar.setAttribute('aria-valuenow', String(pct));
        if (els.progressBar.textContent !== undefined) {
            els.progressBar.textContent = pct + '%';
        }
    }

    // =========================================================================
    // scanExisting
    // =========================================================================

    async function scanExisting() {
        if (CT.Toast) {
            CT.Toast.show('Scan des documents existants...', 'info');
        }

        try {
            var result = await CT.API.scanExistingDocuments();

            if (result) {
                var count = 0;
                if (result.documents && Array.isArray(result.documents)) {
                    count = result.documents.length;
                } else if (typeof result.count === 'number') {
                    count = result.count;
                } else if (typeof result.found === 'number') {
                    count = result.found;
                }

                if (CT.Toast) {
                    CT.Toast.show(count + ' document(s) trouv\u00e9(s) lors du scan.', 'success');
                }

                loadDocuments();
            } else {
                if (CT.Toast) {
                    CT.Toast.show('Erreur lors du scan des documents.', 'error');
                }
            }
        } catch (err) {
            if (CT.Toast) {
                CT.Toast.show('Erreur lors du scan : ' + (err.message || 'erreur inconnue'), 'error');
            }
        }
    }

    // =========================================================================
    // loadDocuments
    // =========================================================================

    async function loadDocuments() {
        try {
            var result = await CT.API.getDocuments();

            if (result) {
                if (Array.isArray(result)) {
                    documents = result;
                } else if (result.documents && Array.isArray(result.documents)) {
                    documents = result.documents;
                } else {
                    documents = [];
                }
                saveToLocalStorage();
            } else {
                // API unavailable, fallback to localStorage
                documents = loadFromLocalStorage();
            }
        } catch (err) {
            // API unavailable, fallback to localStorage
            documents = loadFromLocalStorage();
        }

        renderDocuments();
    }

    // =========================================================================
    // renderDocuments
    // =========================================================================

    function renderDocuments() {
        var els = getElements();
        if (!els.documentsGrid) return;

        // Clear grid (keep empty state element if inside)
        var children = Array.prototype.slice.call(els.documentsGrid.children);
        for (var i = 0; i < children.length; i++) {
            if (children[i] !== els.documentsEmpty) {
                els.documentsGrid.removeChild(children[i]);
            }
        }

        // Show/hide empty state
        if (els.documentsEmpty) {
            els.documentsEmpty.style.display = documents.length === 0 ? '' : 'none';
        }

        if (documents.length === 0) return;

        // Build cards
        for (var j = 0; j < documents.length; j++) {
            var doc = documents[j];
            var card = createDocumentCard(doc);
            els.documentsGrid.appendChild(card);
        }

        // Attach delete handlers via delegation
        els.documentsGrid.addEventListener('click', handleGridClick);
    }

    function createDocumentCard(doc) {
        var card = document.createElement('div');
        card.className = 'document-card';

        var name = doc.name || doc.filename || 'Document sans nom';
        var category = doc.category || '';
        var categoryLabel = getCategoryLabel(category);
        var date = formatDate(doc.date || doc.createdAt || doc.uploadedAt);
        var status = doc.status === 'processing' ? 'En cours' : 'Pr\u00eat';
        var iconClass = getIconClass(name);
        var docId = doc.id || doc._id || '';

        card.innerHTML =
            '<div class="document-card__icon">' +
                '<i class="fas ' + iconClass + '"></i>' +
            '</div>' +
            '<div class="document-card__info">' +
                '<h4 class="document-card__name">' + escapeHtml(name) + '</h4>' +
                '<span class="document-card__category badge badge--' + escapeHtml(category) + '">' + escapeHtml(categoryLabel) + '</span>' +
                '<span class="document-card__date">' + escapeHtml(date) + '</span>' +
                '<span class="document-card__status">' + escapeHtml(status) + '</span>' +
            '</div>' +
            '<div class="document-card__actions">' +
                '<button class="btn btn--sm btn--danger" data-action="delete-doc" data-doc-id="' + escapeHtml(String(docId)) + '">' +
                    '<i class="fas fa-trash"></i>' +
                '</button>' +
            '</div>';

        return card;
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

    function handleGridClick(e) {
        var target = e.target;

        // Walk up to find the button with data-action
        while (target && target !== e.currentTarget) {
            if (target.getAttribute && target.getAttribute('data-action') === 'delete-doc') {
                var docId = target.getAttribute('data-doc-id');
                if (docId) {
                    confirmDelete(docId);
                }
                return;
            }
            target = target.parentElement;
        }
    }

    // =========================================================================
    // confirmDelete
    // =========================================================================

    async function confirmDelete(docId) {
        // Use CT.Modal if available, otherwise simple confirm
        var confirmed = false;

        if (CT.Modal && typeof CT.Modal.confirm === 'function') {
            try {
                confirmed = await CT.Modal.confirm(
                    'Supprimer le document',
                    '\u00cates-vous s\u00fbr de vouloir supprimer ce document ?'
                );
            } catch (e) {
                confirmed = false;
            }
        } else {
            confirmed = window.confirm('\u00cates-vous s\u00fbr de vouloir supprimer ce document ?');
        }

        if (!confirmed) return;

        try {
            var result = await CT.API.deleteDocument(docId);

            if (result !== null) {
                if (CT.Toast) {
                    CT.Toast.show('Document supprim\u00e9 avec succ\u00e8s.', 'success');
                }
                loadDocuments();
            }
        } catch (err) {
            if (CT.Toast) {
                CT.Toast.show('Erreur lors de la suppression : ' + (err.message || 'erreur inconnue'), 'error');
            }
        }
    }

    // =========================================================================
    // getDocumentContext
    // =========================================================================

    function getDocumentContext(bloc) {
        var MAX_CONTEXT_LENGTH = 10000;
        var categories = BLOC_TO_CATEGORIES[bloc];

        if (!categories || !Array.isArray(categories)) return '';

        var relevantDocs = documents.filter(function (doc) {
            var docCat = doc.category || '';
            return categories.indexOf(docCat) !== -1;
        });

        if (relevantDocs.length === 0) return '';

        var context = '';
        for (var i = 0; i < relevantDocs.length; i++) {
            var doc = relevantDocs[i];
            var text = doc.content || doc.text || doc.extractedText || '';
            if (!text) continue;

            if (context.length > 0) {
                context += '\n\n---\n\n';
            }
            context += text;

            if (context.length >= MAX_CONTEXT_LENGTH) {
                context = context.substring(0, MAX_CONTEXT_LENGTH);
                break;
            }
        }

        return context;
    }

    // =========================================================================
    // Public API
    // =========================================================================

    return {
        documents: documents,
        init: init,
        handleFiles: handleFiles,
        scanExisting: scanExisting,
        loadDocuments: loadDocuments,
        renderDocuments: renderDocuments,
        confirmDelete: confirmDelete,
        getDocumentContext: getDocumentContext
    };
})();

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
        CT.Documents.init();
    });
} else {
    CT.Documents.init();
}
