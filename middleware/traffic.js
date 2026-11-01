// middleware/traffic.js
// Captive Portal Traffic Enforcement & Interception Middleware

const { settings } = require('../utils/database');
const { isServerIp } = require('../utils/network');
const { getConfig, isAuthorized } = require('../utils/helpers');
const { PROBE_PATHS } = require('../config/constants');

/**
 * Safely extracts client IPv4/IPv6 directly from socket connection.
 * Bypasses untrusted reverse-proxy headers to prevent client IP spoofing.
 */
function getClientIp(req) {
  const raw = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : (req.ip || '');
  return raw.replace('::ffff:', '').trim();
}

/**
 * Checks if a requested path is a known captive detection probe or API endpoint
 */
function isCaptiveProbePath(pathname) {
  if (PROBE_PATHS.includes(pathname)) return true;
  if (pathname.startsWith('/portal/api')) return true;
  return false;
}

/**
 * Captive Traffic Enforcement Middleware
 */
function captiveEnforcementMiddleware(req, res, next) {
  const clientIP = getClientIp(req);
  const isSetupDone = settings.isSetupDone();
  const config = getConfig();

  // 1. Static resources are always accessible
  if (req.path.startsWith('/public') || req.path.startsWith('/images') || req.path === '/favicon.ico') {
    return next();
  }

  // 2. Initial setup enforcement: redirect all traffic to setup wizard until completed
  if (!isSetupDone) {
    if (req.path === '/setup' || req.path === '/setup/complete' || req.path === '/setup/diagnostics') {
      return next();
    }
    return res.redirect('/setup');
  }

  // 3. Direct Server Bypass: Host machine internet traffic is never intercepted
  if (isServerIp(clientIP, config.MY_SERVER_IP)) {
    return next();
  }

  // 4. Captive probe requests (CNA & RFC 8908) must reach portal route handlers
  if (isCaptiveProbePath(req.path)) {
    return next();
  }

  // 5. Authorized clients, authentication endpoints, and public portal paths pass through
  if (
    isAuthorized(clientIP) ||
    req.path.startsWith('/portal') ||
    req.path.startsWith('/auth') ||
    req.path.startsWith('/admin') ||
    req.path.startsWith('/setup') ||
    req.path === '/login' ||
    req.path === '/register' ||
    req.path === '/dashboard' ||
    req.path === '/'
  ) {
    return next();
  }

  // 6. Redirect unauthenticated client requests to captive login page
  res.status(302).redirect(`http://${config.MY_SERVER_IP}/portal/login`);
}

module.exports = {
  getClientIp,
  isCaptiveProbePath,
  captiveEnforcementMiddleware
};
