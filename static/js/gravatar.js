// Gravatar avatar loader
// Requires: blueimp-md5 library

function getGravatarUrl(email, size = 72) {
    if (!email || email.trim() === '' || email === 'No email') {
        return null;
    }
    
    if (typeof md5 === 'undefined') {
        console.error('[Gravatar] md5 library not loaded');
        return null;
    }
    
    try {
        const hash = md5(email.trim().toLowerCase());
        // Use d=404 so that if no custom avatar exists, it returns 404
        // and triggers onerror, causing the fallback text avatar to remain.
        return `https://www.gravatar.com/avatar/${hash}?d=404&s=${size}`;
    } catch (e) {
        console.error('[Gravatar] Error generating hash:', e);
        return null;
    }
}

// Load Gravatar images for all user avatars
document.addEventListener('DOMContentLoaded', function() {
    const avatars = document.querySelectorAll('.user-avatar-img');

    console.log('[Gravatar] Found', avatars.length, 'avatar placeholders');

    avatars.forEach((imgPlaceholder, index) => {
        try {
            const username = imgPlaceholder.dataset.username;

            // Find the email in the same row - try multiple methods
            let email = '';

            // Method 1: Find the closest tr and then find .user-email within it
            const row = imgPlaceholder.closest('tr');
            if (row) {
                const emailCell = row.querySelector('.user-email');
                if (emailCell) {
                    email = emailCell.textContent.trim();
                }
            }

            // Method 2: If still no email, try finding by table structure
            if (!email || email === '') {
                const td = imgPlaceholder.closest('td');
                if (td && td.nextElementSibling) {
                    const nextTd = td.nextElementSibling;
                    if (nextTd.classList.contains('user-email')) {
                        email = nextTd.textContent.trim();
                    }
                }
            }

            console.log(`[Gravatar ${index}] Username: "${username}", Email: "${email}"`);

            // Create text avatar as default fallback
            const textAvatar = document.createElement('div');
            textAvatar.className = 'user-avatar';
            textAvatar.textContent = username;

            // Replace the img placeholder with text avatar first
            if (imgPlaceholder.parentNode) {
                imgPlaceholder.parentNode.replaceChild(textAvatar, imgPlaceholder);
            }

            // Try to load Gravatar in background
            const gravatarUrl = getGravatarUrl(email, 72);
            
            if (gravatarUrl) {
                const gravatarImg = new Image();
                gravatarImg.src = gravatarUrl;

                console.log(`[Gravatar ${index}] Loading URL:`, gravatarUrl);

                // Set timeout for loading (3 seconds)
                const timeout = setTimeout(() => {
                    console.log(`[Gravatar ${index}] Timeout - keeping text avatar`);
                    gravatarImg.src = ''; // Stop loading
                }, 3000);

                // If Gravatar loads successfully, replace text avatar with image
                gravatarImg.onload = function() {
                    clearTimeout(timeout);
                    console.log(`[Gravatar ${index}] Loaded successfully`);
                    gravatarImg.className = 'user-avatar-img';
                    gravatarImg.alt = username;
                    gravatarImg.style.width = '36px';
                    gravatarImg.style.height = '36px';
                    gravatarImg.style.borderRadius = '50%';
                    gravatarImg.style.objectFit = 'cover';

                    // Check if textAvatar still has a parent before replacing
                    if (textAvatar.parentNode) {
                        textAvatar.parentNode.replaceChild(gravatarImg, textAvatar);
                    }
                };

                // If Gravatar fails to load, keep text avatar (do nothing)
                gravatarImg.onerror = function() {
                    clearTimeout(timeout);
                    console.log(`[Gravatar ${index}] Failed to load (or 404) - keeping text avatar`);
                };
            } else {
                console.log(`[Gravatar ${index}] No email or md5 missing - keeping text avatar`);
            }
        } catch (err) {
            console.error(`[Gravatar ${index}] Error processing avatar:`, err);
        }
    });
});
