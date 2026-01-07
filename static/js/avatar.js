// Avatar loader (Handling Custom Avatars)

document.addEventListener('DOMContentLoaded', function () {
    const avatars = document.querySelectorAll('.user-avatar-img');

    console.log('[Avatar] Found', avatars.length, 'avatar placeholders');

    avatars.forEach((imgElement, index) => {
        try {
            const username = imgElement.dataset.username || '';
            const customAvatarUrl = (imgElement.dataset.avatarUrl || '').trim();

            // Build ui-avatars fallback (size and colors match template usage)
            const uiAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=6366f1&color=fff&s=200`;

            // Helper to set fallback once (avoid infinite retries)
            function setFallback() {
                if (imgElement.dataset.fallbackUsed === '1') return;
                imgElement.dataset.fallbackUsed = '1';
                imgElement.src = uiAvatar;
            }

            // Ensure we have handlers that will fallback when the real <img> fails
            let timeoutHandle = null;
            const onImgLoad = function () {
                if (timeoutHandle) {
                    clearTimeout(timeoutHandle);
                    timeoutHandle = null;
                }
                // loaded successfully — nothing else to do
                console.log(`[Avatar ${index}] <img> loaded successfully`);
            };
            const onImgError = function () {
                if (timeoutHandle) {
                    clearTimeout(timeoutHandle);
                    timeoutHandle = null;
                }
                console.log(`[Avatar ${index}] <img> error — applying ui-avatar fallback`);
                setFallback();
            };

            // Attach handlers once
            imgElement.addEventListener('load', onImgLoad);
            imgElement.addEventListener('error', onImgError);

            // If a custom URL exists, set it immediately (so the browser will render it while we watch for load/error)
            if (customAvatarUrl) {
                console.log(`[Avatar ${index}] Using custom URL (apply immediately):`, customAvatarUrl);

                // Start a timeout: if the image doesn't load within 3s, fall back
                timeoutHandle = setTimeout(() => {
                    console.log(`[Avatar ${index}] Load timeout, using fallback`);
                    timeoutHandle = null;
                    setFallback();
                }, 3000);

                // Try setting the actual img src so the browser attempts to load it right away
                imgElement.src = customAvatarUrl;
            } else {
                // No custom url: ensure img has a sensible src (keep the existing src if set, otherwise use uiAvatar)
                if (!imgElement.src || imgElement.src.trim() === '') {
                    imgElement.src = uiAvatar;
                }
            }

            // Expose a simple updater so template inline handlers (or other scripts) can reuse logic
            imgElement.updateAvatarPreview = function (url) {
                // Allow passing null/empty to revert to ui-avatar
                const u = (url || '').trim();
                if (!u) {
                    setFallback();
                    return;
                }

                // Try the new URL quickly and swap if it loads
                const tmp = new Image();
                let done = false;
                const tto = setTimeout(() => {
                    if (!done) {
                        done = true;
                        setFallback();
                    }
                }, 3000);

                tmp.onload = function () {
                    if (done) return;
                    done = true;
                    clearTimeout(tto);
                    imgElement.dataset.avatarUrl = u;
                    imgElement.src = u;
                };
                tmp.onerror = function () {
                    if (done) return;
                    done = true;
                    clearTimeout(tto);
                    setFallback();
                };
                tmp.src = u;
            };
        } catch (err) {
            console.error(`[Avatar ${index}] Error processing avatar:`, err);
        }
    });
});
