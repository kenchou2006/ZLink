// Avatar loader (Handling Custom Avatars)

function initAvatars() {
    const avatars = document.querySelectorAll('.user-avatar-img');

    avatars.forEach((imgElement) => {
        try {
            // Ensure image has an alt attribute
            const username = imgElement.dataset.username || '';
            try {
                if (!imgElement.getAttribute('alt')) {
                    imgElement.setAttribute('alt', username ? `${username}'s avatar` : 'User avatar');
                }
            } catch (e) { /* ignore */ }

            // Helper to show initials and hide image
            function showInitials() {
                try {
                    imgElement.classList.add('hidden');
                    const initials = imgElement.parentElement && imgElement.parentElement.querySelector('.user-avatar-initials');
                    if (initials) initials.classList.remove('hidden');
                } catch (e) { /* ignore */ }
            }

            // Helper to show image and hide initials
            function showImage() {
                try {
                    imgElement.classList.remove('hidden');
                    const initials = imgElement.parentElement && imgElement.parentElement.querySelector('.user-avatar-initials');
                    if (initials) initials.classList.add('hidden');
                } catch (e) { /* ignore */ }
            }

            // By default: show initials to avoid broken-image icons
            showInitials();

            // Validation flow: validate a URL using a temporary Image before assigning to the DOM img
            function validateAndApply(url, onSuccess, onFail) {
                if (!url || !url.trim()) { if (typeof onFail === 'function') onFail(); return; }
                const u = url.trim();
                const validator = new Image();
                let finished = false;
                const timeout = setTimeout(() => {
                    if (finished) return;
                    finished = true;
                    try { validator.onload = validator.onerror = null; } catch (e) {}
                    if (typeof onFail === 'function') onFail();
                }, 3000);

                validator.onload = function () {
                    if (finished) return;
                    // ensure it's a real image (has dimensions)
                    if (!validator.naturalWidth || !validator.naturalHeight) {
                        finished = true;
                        clearTimeout(timeout);
                        try { validator.onload = validator.onerror = null; } catch (e) {}
                        if (typeof onFail === 'function') onFail();
                        return;
                    }
                    finished = true;
                    clearTimeout(timeout);
                    try { validator.onload = validator.onerror = null; } catch (e) {}
                    if (typeof onSuccess === 'function') onSuccess(u);
                };
                validator.onerror = function () {
                    if (finished) return;
                    finished = true;
                    clearTimeout(timeout);
                    try { validator.onload = validator.onerror = null; } catch (e) {}
                    if (typeof onFail === 'function') onFail();
                };
                // Start loading
                try { validator.src = u; } catch (e) { clearTimeout(timeout); finished = true; if (typeof onFail === 'function') onFail(); }
            }

            // Initial dataset-based apply (if data-avatar-url present)
            try {
                const starting = (imgElement.dataset.avatarUrl || '').trim();
                if (starting) {
                    // Validate before applying to avoid broken image icons
                    validateAndApply(starting, (goodUrl) => {
                        try {
                            imgElement.src = goodUrl;
                            showImage();
                        } catch (e) { showInitials(); }
                    }, () => {
                        showInitials();
                    });
                } else {
                    showInitials();
                }
            } catch (e) { showInitials(); }

            // Expose a simple updater for interactive preview (used by profile page)
            imgElement.updateAvatarPreview = function (url) {
                const u = (url || '').trim();
                if (!u) {
                    // clear and show initials
                    try { imgElement.src = ''; } catch (e) {}
                    showInitials();
                    return;
                }

                validateAndApply(u, (goodUrl) => {
                    try {
                        imgElement.src = goodUrl;
                        showImage();
                    } catch (e) {
                        showInitials();
                    }
                }, () => {
                    showInitials();
                });
            };

        } catch (err) {
            // safe fallback: show initials
            try { const initials = imgElement.parentElement && imgElement.parentElement.querySelector('.user-avatar-initials'); if (initials) initials.classList.remove('hidden'); imgElement.classList.add('hidden'); } catch (e) {}
            console.error('Avatar init error:', err);
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAvatars);
} else {
    initAvatars();
}
