// routes/portal.js
// Client captive portal, authentication, and connected dashboard routes

const express = require('express');
const router = express.Router();
const { users, sessions } = require('../utils/database');
const { getConfig } = require('../utils/helpers');
const { getClientIp } = require('../middleware/traffic');

// Render Login Page Helper
function renderLogin(req, res) {
    const config = getConfig();
    res.render('login', {
        title: 'Login',
        wallpaper: config.BACKGROUND_IMAGE,
        enterprise_name: config.ENTERPRISE_NAME,
        enterprise_tagline: config.ENTERPRISE_TAGLINE,
        session_hours: config.SESSION_HOURS,
        isEnterpriseBranding: config.ENABLE_ENTERPRISE_BRANDING,
        error: req.query.error
    });
}

// Render Connected Dashboard Helper
function renderDashboard(req, res) {
    const clientIP = getClientIp(req);
    const session = sessions.get(clientIP);
    const config = getConfig();

    res.render('dashboard', {
        title: 'Connected',
        wallpaper: config.BACKGROUND_IMAGE,
        enterprise_name: config.ENTERPRISE_NAME,
        isEnterpriseBranding: config.ENABLE_ENTERPRISE_BRANDING,
        clientIP,
        session
    });
}

// A. Root & Portal Index (Redirects to dashboard if authorized, otherwise login)
router.get(['/', '/portal'], (req, res) => {
    const clientIP = getClientIp(req);
    if (sessions.isAuthorized(clientIP)) {
        return res.redirect('/dashboard');
    }
    return res.redirect('/portal/login');
});

// B. User Captive Login Page
router.get('/portal/login', renderLogin);
router.get('/login', renderLogin);

// C. Public registration is disabled by design: Redirect to login
router.get(['/portal/register', '/register'], (req, res) => {
    res.redirect('/portal/login');
});

router.post(['/auth/register', '/portal/register', '/register'], (req, res) => {
    res.redirect('/portal/login');
});

// D. Handle User Login & Internet Unlock
const handleUserLogin = (req, res) => {
    const { username, password } = req.body;
    const clientIP = getClientIp(req);
    const config = getConfig();

    const user = users.authenticate(username, password);

    if (user) {
        sessions.create(clientIP, user.id, config.SESSION_HOURS);
        console.log(`[AUTH] Internet unlocked for '${username}' at IP ${clientIP} for ${config.SESSION_HOURS}h`);
        res.redirect('/dashboard');
    } else {
        res.render('login', {
            title: 'Login',
            wallpaper: config.BACKGROUND_IMAGE,
            enterprise_name: config.ENTERPRISE_NAME,
            enterprise_tagline: config.ENTERPRISE_TAGLINE,
            isEnterpriseBranding: config.ENABLE_ENTERPRISE_BRANDING,
            error: 'Invalid credentials. Please verify your username and password.'
        });
    }
};

router.post('/auth/login', handleUserLogin);
router.post('/portal/login', handleUserLogin);
router.post('/login', handleUserLogin);

// E. Connected Dashboard
router.get('/dashboard', renderDashboard);
router.get('/portal/dashboard', renderDashboard);

// F. RFC 8908 Captive Portal API Handler (.well-known/capport)
router.get(['/.well-known/capport', '/capport', '/portal/api/capport'], (req, res) => {
    const clientIP = getClientIp(req);
    const config = getConfig();
    const isAuth = sessions.isAuthorized(clientIP);

    res.setHeader('Content-Type', 'application/captive+json');
    if (isAuth) {
        return res.json({
            "captive": false,
            "user-portal-url": `http://${config.MY_SERVER_IP}/dashboard`,
            "venue-info-url": `http://${config.MY_SERVER_IP}/`,
            "seconds-remaining": parseInt(config.SESSION_HOURS || '24', 10) * 3600,
            "can-extend-session": true
        });
    }

    res.json({
        "captive": true,
        "user-portal-url": `http://${config.MY_SERVER_IP}/portal/login`,
        "venue-info-url": `http://${config.MY_SERVER_IP}/`
    });
});

// G. Captive Portal Detection Probes (CNA Handlers)
// Android & ChromeOS Connectivity Check
router.get(['/generate_204', '/gen_204'], (req, res) => {
    const clientIP = getClientIp(req);
    if (sessions.isAuthorized(clientIP)) {
        return res.status(204).end();
    }
    const config = getConfig();
    res.redirect(`http://${config.MY_SERVER_IP}/portal/login`);
});

// Apple CNA Probe (iOS, macOS, watchOS)
router.get(['/hotspot-detect.html', '/library/test/success.html', '/canonical.html', '/success.txt'], (req, res) => {
    const clientIP = getClientIp(req);
    if (sessions.isAuthorized(clientIP)) {
        return res.status(200).send('<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>');
    }
    const config = getConfig();
    res.redirect(`http://${config.MY_SERVER_IP}/portal/login`);
});

// Windows NCSI Probes
router.get('/ncsi.txt', (req, res) => {
    const clientIP = getClientIp(req);
    if (sessions.isAuthorized(clientIP)) {
        return res.status(200).send('Microsoft NCSI');
    }
    const config = getConfig();
    res.redirect(`http://${config.MY_SERVER_IP}/portal/login`);
});

router.get('/connecttest.txt', (req, res) => {
    const clientIP = getClientIp(req);
    if (sessions.isAuthorized(clientIP)) {
        return res.status(200).send('Microsoft Connect Test');
    }
    const config = getConfig();
    res.redirect(`http://${config.MY_SERVER_IP}/portal/login`);
});

module.exports = router;
