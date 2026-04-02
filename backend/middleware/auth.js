const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

module.exports = async (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No authentication token provided.' });
    }

    try {
        const token = header.split(' ')[1];
        if (!JWT_SECRET) {
            return res.status(500).json({ error: 'Server misconfiguration: JWT secret missing.' });
        }
        const payload = jwt.verify(token, JWT_SECRET);

        // Attach user identity to request
        req.user = { id: payload.sub, username: payload.username };
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Invalid or expired token.' });
    }
};
