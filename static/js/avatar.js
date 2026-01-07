// Avatar loader (Handling Custom Avatars)

document.addEventListener('DOMContentLoaded', function () {
    const avatars = document.querySelectorAll('.user-avatar-img');

    console.log('[Avatar] Found', avatars.length, 'avatar placeholders');

    avatars.forEach((imgPlaceholder, index) => {
        try {
            const username = imgPlaceholder.dataset.username;
            const customAvatarUrl = imgPlaceholder.dataset.avatarUrl;

            // Create text avatar as default fallback
            const textAvatar = document.createElement('div');
            textAvatar.className = 'user-avatar';
            textAvatar.textContent = username;

            // Replace the img placeholder with text avatar first
            if (imgPlaceholder.parentNode) {
                imgPlaceholder.parentNode.replaceChild(textAvatar, imgPlaceholder);
            }

            if (customAvatarUrl && customAvatarUrl.trim() !== '') {
                console.log(`[Avatar ${index}] Using custom URL:`, customAvatarUrl);

                const avatarImg = new Image();
                avatarImg.src = customAvatarUrl;

                // Set timeout for loading (3 seconds)
                const timeout = setTimeout(() => {
                    console.log(`[Avatar ${index}] Timeout - keeping text avatar`);
                    avatarImg.src = ''; // Stop loading
                }, 3000);

                // If Avatar loads successfully, replace text avatar with image
                avatarImg.onload = function () {
                    clearTimeout(timeout);
                    console.log(`[Avatar ${index}] Loaded successfully`);
                    avatarImg.className = 'user-avatar-img';
                    avatarImg.alt = username;
                    avatarImg.style.width = '100%';
                    avatarImg.style.height = '100%';
                    avatarImg.style.borderRadius = '50%';
                    avatarImg.style.objectFit = 'cover';

                    // Check if textAvatar still has a parent before replacing
                    if (textAvatar.parentNode) {
                        textAvatar.parentNode.replaceChild(avatarImg, textAvatar);
                    }
                };

                avatarImg.onerror = function () {
                    clearTimeout(timeout);
                    console.log(`[Avatar ${index}] Failed to load (or 404) - keeping text avatar`);
                };
            } else {
                console.log(`[Avatar ${index}] No custom URL found - keeping text avatar`);
            }
        } catch (err) {
            console.error(`[Avatar ${index}] Error processing avatar:`, err);
        }
    });
});
