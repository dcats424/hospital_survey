const crypto = require('crypto');
const db = require('../config/database');

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

  const result = await db.query(
    `SELECT s.token, s.user_id, s.username, s.email, s.expires_at, u.role_id
     FROM admin_sessions s
     LEFT JOIN admin_users u ON u.id = s.user_id
     WHERE s.expires_at IS NULL OR s.expires_at > NOW()`
  );

  const roleIds = [...new Set(result.rows.filter(r => r.role_id).map(r => r.role_id))];
  const permissionsByRole = {};
  if (roleIds.length > 0) {
    const permResult = await db.query(
      `SELECT role_id, module FROM role_permissions WHERE role_id = ANY($1)`,
      [roleIds]
    );
    for (const row of permResult.rows) {
      if (!permissionsByRole[row.role_id]) permissionsByRole[row.role_id] = [];
      permissionsByRole[row.role_id].push(row.module);
    }
  }

  const loaded = result.rows.map(r => {
    const permissions = r.role_id ? (permissionsByRole[r.role_id] || []) : [];
    return [r.token, {
      id: r.user_id,
      username: r.username,
      email: r.email,
      role_id: r.role_id,
      permissions,
      expires_at: r.expires_at
    }];
  });
  hydrateSessions(loaded);
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
