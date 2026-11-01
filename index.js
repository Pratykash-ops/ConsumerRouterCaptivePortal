// index.js
// AUTHOR: Pratyaksh
// LAST EDITED: 01 November 2026
// Minami's Captive Portal - Modular Server Entry Point
// Express Web Server, Traffic Interception Middleware, DNS Hijacker, DHCP Service, and HTTPS Rejector

if (typeof process.loadEnvFile === 'function') {
    try { process.loadEnvFile(); } catch {}
} else {
    try { require('dotenv').config(); } catch {}
}

const express = require('express');
const path = require('path');
const crypto = require('node:crypto');
const cookieParser = require('cookie-parser');
const { engine } = require('express-handlebars');

// Constants & Configurations
const { PORTS } = require('./config/constants');
const { settings } = require('./utils/database');
const { isServerIp } = require('./utils/network');
const { renderIcon } = require('./utils/icons');
const { getConfig, isAuthorized } = require('./utils/helpers');

// Middleware
const { captiveEnforcementMiddleware } = require('./middleware/traffic');

// Services & Servers
const { dnsServer, startDnsServer, stopDnsServer } = require('./services/dns');
const { httpsServer, startHttpsRejector, stopHttpsRejector } = require('./services/https');
const { dhcpServer } = require('./utils/dhcp');

// Route modules
const setupRoutes = require('./routes/setup');
const adminRoutes = require('./routes/admin');
const portalRoutes = require('./routes/portal');

// --- 1. EXPRESS SETUP & VIEW ENGINE ---
const app = express();

const cookieSecret = process.env.COOKIE_PARSING_SECRET || crypto.randomBytes(32).toString('hex');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser(cookieSecret));

// Register Handlebars View Engine with vector SVG icons and helpers
app.engine('hbs', engine({
    extname: '.hbs',
    defaultLayout: 'main',
    layoutsDir: path.join(__dirname, 'views', 'layouts'),
    partialsDir: path.join(__dirname, 'views', 'partials'),
    helpers: {
        eq: (a, b) => a === b,
        icon: (name, options) => renderIcon(name, options)
    }
}));
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

// Static assets
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'public')));

// --- 2. TRAFFIC ENFORCEMENT & CAPTIVE MIDDLEWARE ---
app.use(captiveEnforcementMiddleware);

// --- 3. MOUNT ROUTE GROUPS ---
app.use('/setup', setupRoutes);
app.use('/admin', adminRoutes);
app.use('/portal', portalRoutes);
app.use('/', portalRoutes);

// --- 4. SERVER LIFECYCLE ---
function startServer(httpPort = PORTS.HTTP, dnsPort = PORTS.DNS, httpsPort = PORTS.HTTPS, dhcpPort = PORTS.DHCP) {
    const isSetupDone = settings.isSetupDone();
    const config = getConfig();

    // 1. Start Express Web Server
    const server = app.listen(httpPort, () => {
        console.log(`\n========================================================================`);
        console.log(`[HTTP] Express Web Server listening on Port ${httpPort}`);
        console.log(`[NETWORK] Machine IP on Router Network: ${config.DETECTED_IP}`);

        if (!isSetupDone) {
            console.log(`[STATUS] INITIAL SETUP REQUIRED`);
            console.log(`[SETUP] Please open the setup wizard in your browser:`);
            console.log(`   http://localhost:${httpPort}/setup`);
            console.log(`   (or http://${config.DETECTED_IP}:${httpPort}/setup)`);
        } else {
            console.log(`[STATUS] Portal active at http://${config.MY_SERVER_IP}`);
            console.log(`[ADMIN] Admin Console: http://${config.MY_SERVER_IP}:${httpPort}/admin/login`);
        }
        console.log(`========================================================================\n`);
    });

    // 2. Start DNS Server
    startDnsServer(dnsPort);

    // 3. Start Integrated DHCP Server
    dhcpServer.start(dhcpPort);

    // 4. Start HTTPS Rejector Service
    startHttpsRejector(httpsPort);

    return server;
}

if (require.main === module) {
    startServer();
}

module.exports = {
    app,
    dnsServer,
    dhcpServer,
    httpsServer,
    startServer,
    stopDnsServer,
    stopHttpsRejector,
    isAuthorized,
    isServerIp,
    getConfig
};
