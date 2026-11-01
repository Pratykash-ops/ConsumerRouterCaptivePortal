// middleware/auth.js
// Administrator Session Authentication & Authorization Middleware

const { admin } = require('../utils/database');

/**
 * Retrieves authenticated admin user from signed cookie session.
 */
function getAuthAdmin(req) {
  if (!req.signedCookies || !req.signedCookies.admin_session) {
    return null;
  }
  try {
    const parsed = JSON.parse(req.signedCookies.admin_session);
    if (!parsed || !parsed.username) return null;
    const verified = admin.get(parsed.username);
    return verified || null;
  } catch {
    return null;
  }
}

/**
 * Express middleware to restrict routes to authenticated administrators.
 */
function requireAdmin(req, res, next) {
  const adminUser = getAuthAdmin(req);
  if (!adminUser) {
    return res.redirect('/admin/login');
  }
  req.adminUser = adminUser;
  next();
}

module.exports = {
  getAuthAdmin,
  requireAdmin
};
