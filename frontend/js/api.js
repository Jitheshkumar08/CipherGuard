const originalFetch = window.fetch;
let authExpiryTimer = null;
let lastRefreshAt = 0;

const SESSION_REFRESH_COOLDOWN_MS = 60 * 1000;

function clearAuthState(redirectToLogin = true) {
    localStorage.removeItem('token');
    localStorage.removeItem('mlefps_pass');
    sessionStorage.removeItem('mlefps_pass');

    if (redirectToLogin && window.location.pathname !== '/login') {
        window.location.href = '/login';
    }
}

async function shouldClearAuthFor401(response) {
    try {
        const payload = await response.clone().json();
        const msg = String(payload?.error || payload?.message || '').toLowerCase();

        // Only hard-logout for JWT auth failures from auth middleware.
        if (msg.includes('invalid or expired token')) return true;
        if (msg.includes('no authentication token')) return true;
        if (msg.includes('authentication token required')) return true;
        return false;
    } catch {
        return false;
    }
}



function decodeJwtPayload(token) {
    try {
        const parts = String(token || '').split('.');
        if (parts.length < 2) return null;
        const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
        return JSON.parse(atob(padded));
    } catch {
        return null;
    }
}

function getTokenExpiryMs(token) {
    const payload = decodeJwtPayload(token);
    if (!payload || typeof payload.exp !== 'number') return null;
    return payload.exp * 1000;
}

function isTokenValid(token) {
    const expiryMs = getTokenExpiryMs(token);
    if (!expiryMs) return false;
    return Date.now() < expiryMs;
}

function scheduleExpiryLogout() {
    if (authExpiryTimer) {
        clearTimeout(authExpiryTimer);
        authExpiryTimer = null;
    }

    const token = localStorage.getItem('token');
    if (!token) return;

    const expiryMs = getTokenExpiryMs(token);
    if (!expiryMs || Date.now() >= expiryMs) {
        clearAuthState(true);
        return;
    }

    const waitMs = Math.max(0, expiryMs - Date.now());
    authExpiryTimer = setTimeout(() => {
        clearAuthState(true);
    }, waitMs);
}

async function refreshSessionToken() {
    const token = localStorage.getItem('token');
    if (!token || !isTokenValid(token)) {
        clearAuthState(true);
        return;
    }

    const headers = new Headers();
    headers.append('Authorization', `Bearer ${token}`);

    const password = sessionStorage.getItem('mlefps_pass') || localStorage.getItem('mlefps_pass');
    if (password) headers.append('x-user-password', password);

    const res = await originalFetch('/api/auth/refresh', { method: 'POST', headers });
    if (!res.ok) {
        if (res.status === 401) clearAuthState(true);
        return;
    }

    const data = await res.json().catch(() => ({}));
    if (data && data.token) {
        localStorage.setItem('token', data.token);
        scheduleExpiryLogout();
    }
}

function handleUserActivity() {
    const token = localStorage.getItem('token');
    if (!token || !isTokenValid(token)) return;

    const now = Date.now();
    if (now - lastRefreshAt < SESSION_REFRESH_COOLDOWN_MS) return;

    lastRefreshAt = now;
    refreshSessionToken().catch(() => {
        // Ignore refresh noise; existing 401 handling and expiry checks remain authoritative.
    });
}

window.isTokenValid = isTokenValid;
window.scheduleExpiryLogout = scheduleExpiryLogout;
window.clearAuthState = clearAuthState;
window.refreshSessionToken = refreshSessionToken;

scheduleExpiryLogout();

['click', 'keydown', 'mousemove', 'scroll', 'touchstart', 'focus'].forEach((evt) => {
    window.addEventListener(evt, handleUserActivity, { passive: true });
});

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        handleUserActivity();
    }
});

window.fetch = async function (resource, config) {
    const token = localStorage.getItem('token');
    const password = sessionStorage.getItem('mlefps_pass') || localStorage.getItem('mlefps_pass');

    if (token && !isTokenValid(token)) {
        clearAuthState(true);
        throw new Error('Session expired. Please log in again.');
    }

    config = config || {};
    config.headers = config.headers || {};

    if (token) {
        if (config.headers instanceof Headers) {
            config.headers.append('Authorization', `Bearer ${token}`);
            if (password) config.headers.append('x-user-password', password);
        } else {
            config.headers['Authorization'] = `Bearer ${token}`;
            if (password) config.headers['x-user-password'] = password;
        }
    }

    const res = await originalFetch(resource, config);
    if (res.status === 401 && await shouldClearAuthFor401(res)) {
        clearAuthState(true);
    }
    return res;
};

// Debug function to check token expiry (call it in console or app boot)
window.debugTokenInfo = async function () {
    const token = localStorage.getItem('token');
    if (!token) {
        console.warn('[Token] No token in localStorage');
        return;
    }

    try {
        const parts = token.split('.');
        if (parts.length !== 3) throw new Error('Invalid token format');
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        const nowMs = Date.now();
        const expMs = payload.exp * 1000;
        const remainingMs = expMs - nowMs;

        console.log('[Token] Local token info:', {
            issuedAt: new Date(payload.iat * 1000).toISOString(),
            expiresAt: new Date(expMs).toISOString(),
            remainingMinutes: (remainingMs / 60000).toFixed(2),
            isExpired: remainingMs <= 0
        });

        // Also try server endpoint if available
        const serverInfo = await fetch('/api/auth/debug/token-info')
            .then(r => r.ok ? r.json() : null)
            .catch(() => null);

        if (serverInfo) {
            console.log('[Token] Server token info:', serverInfo);
        }
    } catch (err) {
        console.error('[Token] Error decoding:', err.message);
    }
};

// Auto-log on page load for debugging
if (localStorage.getItem('token')) {
    console.log('[Token] DEBUG: Call window.debugTokenInfo() to check token expiry');
}

