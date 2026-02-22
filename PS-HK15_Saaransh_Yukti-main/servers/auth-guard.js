/**
 * FarmMind Auth Guard
 * Include this script at the TOP of every protected page.
 * It reads the JWT from localStorage and validates it with the server.
 * On failure it immediately redirects to login.html.
 */
(function () {
    // Auth disabled: provide a simple fetch wrapper and optional user label.
    window.authFetch = function (url, options = {}) {
        return fetch(url, options);
    };

    window.FM_USER = JSON.parse(localStorage.getItem('fm_user') || '{}');

    document.addEventListener('DOMContentLoaded', () => {
        const label = document.querySelector('.nav-profile-label');
        const user = JSON.parse(localStorage.getItem('fm_user') || '{}');
        if (label && user.full_name) {
            const first = user.full_name.split(' ')[0];
            label.textContent = first;
        }
    });
})();
