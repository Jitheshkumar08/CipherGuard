const originalFetch = window.fetch;

window.fetch = async function (resource, config) {
    const token = localStorage.getItem('token');
    const password = sessionStorage.getItem('mlefps_pass');

    config = config || {};
    config.headers = config.headers || {};

    if (token) {
        // If headers is Headers object
        if (config.headers instanceof Headers) {
            config.headers.append('Authorization', `Bearer ${token}`);
            if (password) config.headers.append('x-user-password', password);
        } else {
            config.headers['Authorization'] = `Bearer ${token}`;
            if (password) config.headers['x-user-password'] = password;
        }
    }

    // Auto-redirect to login if 401
    const res = await originalFetch(resource, config);
    if (res.status === 401) {
        localStorage.removeItem('token');
        sessionStorage.removeItem('mlefps_pass');
        window.location.href = '/login';
    }
    return res;
};
