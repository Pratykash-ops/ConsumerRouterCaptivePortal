// routes/setup.js
// Setup wizard and initial machine/portal provisioning routes

const express = require('express');
const router = express.Router();
const { settings, admin } = require('../utils/database');
const { getAllNetworkInterfaces } = require('../utils/network');
const { upload, getWallpapers } = require('../utils/wallpaper');
const { getConfig } = require('../utils/helpers');
const { runPreFlightDiagnostics } = require('../utils/diagnostics');

// A. Initial Setup Page (redirects to /admin/login once setup is complete)
router.get('/', async (req, res) => {
    if (settings.isSetupDone()) {
        return res.redirect('/admin/login');
    }

    const config = getConfig();
    const s = settings.getAll();
    const diagnostics = await runPreFlightDiagnostics();

    res.render('setup', {
        title: 'Initial Setup',
        server_ip: config.MY_SERVER_IP,
        detected_ip: config.DETECTED_IP,
        networkInterfaces: getAllNetworkInterfaces(),
        local_domain: config.LOCAL_DOMAIN,
        session_hours: config.SESSION_HOURS,
        enterprise_name: s.enterprise_name || "Minami Enterprise Network",
        enterprise_tagline: s.enterprise_tagline || "High-Speed Secure Wi-Fi Access",
        enable_enterprise_branding: s.enable_enterprise_branding === 'true',
        wallpapers: getWallpapers(config.RAW_BACKGROUND_IMAGE),
        admin_username: 'admin',
        diagnostics,
        error: req.query.error
    });
});

// Live Pre-flight Diagnostics JSON endpoint
router.get('/diagnostics', async (req, res) => {
    const diagnostics = await runPreFlightDiagnostics();
    res.json(diagnostics);
});

// B. Handle Initial Setup Submission
router.post('/complete', upload.single('custom_wallpaper'), (req, res) => {
    if (settings.isSetupDone()) {
        return res.redirect('/admin/login');
    }

    const {
        server_ip, local_domain, session_hours,
        enterprise_name, enterprise_tagline, selected_wallpaper,
        enable_enterprise_branding,
        admin_username, admin_password, confirm_password
    } = req.body;

    if (!admin_password || admin_password !== confirm_password) {
        return res.redirect('/setup?error=' + encodeURIComponent('Passwords do not match or cannot be empty'));
    }

    // Save network & captive portal configurations
    if (server_ip) settings.set('server_ip', server_ip.trim());
    if (local_domain) settings.set('local_domain', local_domain.trim());
    if (session_hours) settings.set('session_hours', String(session_hours).trim());
    if (enterprise_name) settings.set('enterprise_name', enterprise_name.trim());
    if (enterprise_tagline) settings.set('enterprise_tagline', enterprise_tagline.trim());

    // Save enterprise branding toggle (off by default)
    const isBrandingEnabled = enable_enterprise_branding === 'true' || enable_enterprise_branding === 'on';
    settings.set('enable_enterprise_branding', isBrandingEnabled ? 'true' : 'false');

    // Wallpaper configuration: uploaded file takes precedence over gallery selection
    if (req.file) {
        settings.set('background_image', `/images/${req.file.filename}`);
    } else if (selected_wallpaper) {
        settings.set('background_image', selected_wallpaper.trim());
    }

    // Update or create the administrator account
    const username = (admin_username || 'admin').trim();
    const existing = admin.get(username);
    if (existing) {
        admin.updatePassword(username, admin_password);
    } else {
        admin.create(username, admin_password, 'superadmin');
    }

    // Mark setup as completed
    settings.markSetupDone();

    console.log('\n========================================================================');
    console.log('[SETUP] Initial Setup Completed Successfully!');
    console.log('[SERVER] Express server is now running in production captive portal mode.');
    console.log('========================================================================\n');

    res.redirect('/admin/login?setupSuccess=true');
});

module.exports = router;
