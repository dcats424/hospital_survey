const crypto = require('crypto');
const db = require('../config/database');
const { ALL_MODULES } = require('../utils/constants');

let sessions = new Map();

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function hydrateSessions(loaded) {
  sessions.clear();
  for (const [token, session] of loaded) {
    sessions.set(token, session);
  }
  return sessions;
}

async function loadSessions() {
  await db.query(`DELETE FROM admin_sessions WHERE expires_at IS NOT NULL AND expires_at < NOW()`);
  await db.query(`DELETE FROM admin_sessions WHERE expires_at IS NULL AND created_at < NOW() - INTERVAL '7 days'`);
  return sessions;
}

function requireAuth(req, res, next) {
  const token = req.header('x-session-token');
  if (!token) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (!sessions.has(token)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const session = sessions.get(token);
  if (session.expires_at && new Date(session.expires_at) < new Date()) {
    sessions.delete(token);
    db.query('DELETE FROM admin_sessions WHERE token_hash = $1', [hashToken(token)]).catch(() => {});
    return res.status(401).json({ error: 'session_expired' });
  }
  req.adminUser = session;
  next();
}

function requireModule(moduleName) {
  return function (req, res, next) {
    const perms = req.adminUser.permissions || [];
    if (perms.includes(moduleName)) {
      return next();
    }
    return res.status(403).json({ error: 'forbidden', message: 'Access denied to this module' });
  };
}

module.exports = { sessions, loadSessions, requireAuth, requireModule, hashToken };
