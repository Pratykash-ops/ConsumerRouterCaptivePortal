// utils/helpers.js
// Shared portal configuration, authentication, and authorization helpers

const { settings, sessions } = require('./database');
const { getLocalIpAddress, isServerIp } = require('./network');
const { getAuthAdmin } = require('../middleware/auth');
const { DEFAULT_SESSION_HOURS, DEFAULT_LOCAL_DOMAIN } = require('../config/constants');

/**
 * Returns current portal configuration dynamically evaluated from database settings and environment.
 */
function getConfig() {
    const s = settings.getAll();
    const detectedIp = getLocalIpAddress();
    const isEnterprise = s.enable_enterprise_branding === 'true';

    return {
        MY_SERVER_IP: s.server_ip || detectedIp,
        SESSION_HOURS: parseInt(s.session_hours || String(DEFAULT_SESSION_HOURS), 10),
        LOCAL_DOMAIN: process.env.LOCAL_DOMAIN || s.local_domain || DEFAULT_LOCAL_DOMAIN,
        IS_SETUP_DONE: settings.isSetupDone(),
        DETECTED_IP: detectedIp,
        ENABLE_ENTERPRISE_BRANDING: isEnterprise,
        BACKGROUND_IMAGE: isEnterprise ? (s.background_image || '/images/bg3.jpg') : null,
        RAW_BACKGROUND_IMAGE: s.background_image || '/images/bg3.jpg',
        ENTERPRISE_NAME: isEnterprise ? (s.enterprise_name || "Minami Enterprise Network") : "Minami's Captive",
        ENTERPRISE_TAGLINE: isEnterprise ? (s.enterprise_tagline || "High-Speed Secure Wi-Fi Access") : "Enterprise High-Speed Internet Access"
    };
}

/**
 * Checks authorization for a given IP address.
 * The server machine host itself (127.0.0.1, ::1, or physical adapters) is NEVER blocked by the portal wall.
 */
function isAuthorized(ip) {
    const config = getConfig();
    if (isServerIp(ip, config.MY_SERVER_IP)) {
        return true;
    }
    return sessions.isAuthorized(ip);
}

module.exports = {
    getConfig,
    isAuthorized,
    getAuthAdmin
};
