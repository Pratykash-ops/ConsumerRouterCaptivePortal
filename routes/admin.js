// routes/admin.js
// Administrator console, authentication, user management, and portal configuration routes

const express = require('express');
const router = express.Router();
const { users, sessions, admin, dnsLogs, settings } = require('../utils/database');
const { getAllNetworkInterfaces, getSystemStats } = require('../utils/network');
const { upload, getWallpapers } = require('../utils/wallpaper');
const { getConfig } = require('../utils/helpers');
const { requireAdmin, getAuthAdmin } = require('../middleware/auth');
const { dhcpServer } = require('../utils/dhcp');
const { runPreFlightDiagnostics } = require('../utils/diagnostics');

// A. Admin Root (Redirect to dashboard if logged in, otherwise login)
router.get('/', (req, res) => {
    return res.redirect(getAuthAdmin(req) ? '/admin/dashboard' : '/admin/login');
});

// B. Admin Login Page
router.get('/login', (req, res) => {
    if (getAuthAdmin(req)) return res.redirect('/admin/dashboard');
        
    res.render('admin-login', {
        title: 'Admin Terminal Login',
        setupSuccess: req.query.setupSuccess === 'true',
        error: req.query.error
    });
});

// B. Process Admin Login
router.post('/login', (req, res) => {
    const { username, password } = req.body;
    const auth = admin.authenticate(username, password);

    if (auth) {
        res.cookie('admin_session', JSON.stringify({ id: auth.id, username: auth.username, role: auth.role }), {
            signed: true,
            httpOnly: true,
            maxAge: 8 * 60 * 60 * 1000 // 8 hours
        });
        return res.redirect('/admin/dashboard');
    }

    res.render('admin-login', {
        title: 'Admin Terminal Login',
        error: 'Invalid administrator credentials. Access Denied.'
    });
});

// C. Admin Logout
router.get('/logout', (req, res) => {
    res.clearCookie('admin_session');
    res.redirect('/admin/login');
});

// D. Admin Dashboard (Multi-Page Tabbed Architecture)
router.get('/dashboard', async (req, res) => {
    const adminUser = getAuthAdmin(req);
    if (!adminUser) {
        return res.redirect('/admin/login');
    }

    const config = getConfig();
    const systemStats = getSystemStats();
    const dnsStats = dnsLogs.getStats();
    const networkInterfaces = getAllNetworkInterfaces();
    const diagnostics = await runPreFlightDiagnostics();

    // Map sessions with status and expired flag
    const rawSessions = sessions.getAll();
    const sessionsList = rawSessions.map(s => {
        const isExpired = s.expires_at ? new Date(s.expires_at) < new Date() : false;
        return {
            ...s,
            isExpired,
            statusBadge: isExpired ? 'Expired' : 'Active'
        };
    });

    // Map DNS logs with action indicators
    const rawLogs = dnsLogs.getAll(50);
    const dnsLogsList = rawLogs.map(l => ({
        ...l,
        isHijacked: l.action === 'hijacked',
        isResolved: l.action === 'resolved',
        isServerBypass: l.action === 'server_bypass',
        isError: l.action === 'error',
        isRateLimited: l.action === 'rate_limited'
    }));

    // Server IP list that bypasses captive portal
    const serverBypassIps = ['127.0.0.1', '::1', config.MY_SERVER_IP, ...networkInterfaces.map(i => i.address)]
        .filter((v, i, a) => a.indexOf(v) === i);

    // Active Tab evaluation
    let currentTab = req.query.tab || 'overview';
    if (!req.query.tab) {
        if (req.query.userCreated || req.query.userDeleted || req.query.userError) currentTab = 'users';
        else if (req.query.cleared) currentTab = 'dns';
        else if (req.query.saved) currentTab = 'settings';
    }

    res.render('admin-dashboard', {
        title: 'Terminal Command Console',
        adminUser,
        currentTab,
        isTabOverview: currentTab === 'overview',
        isTabSessions: currentTab === 'sessions',
        isTabDns: currentTab === 'dns',
        isTabDhcp: currentTab === 'dhcp',
        isTabUsers: currentTab === 'users',
        isTabBranding: currentTab === 'branding',
        isTabDiagnostics: currentTab === 'diagnostics',
        isTabSettings: currentTab === 'settings',
        stats: {
            usersCount: users.count(),
            activeSessionsCount: sessions.countActive(),
            totalSessionsCount: rawSessions.length,
            dnsLogsCount: dnsLogs.count(),
            dnsStats
        },
        systemStats,
        networkInterfaces,
        serverBypassIps,
        diagnostics,
        settings: settings.getAll(),
        detected_ip: config.DETECTED_IP,
        isEnterpriseBranding: config.ENABLE_ENTERPRISE_BRANDING,
        wallpapers: getWallpapers(config.RAW_BACKGROUND_IMAGE),
        usersList: users.getAll(),
        sessionsList,
        dnsLogsList,
        dhcpLeases: dhcpServer.getLeases(),
        dhcpActive: dhcpServer.listening,
        saved: req.query.saved === 'true',
        userCreated: req.query.userCreated === 'true',
        userDeleted: req.query.userDeleted === 'true',
        userError: req.query.userError,
        cleared: req.query.cleared === 'true'
    });
});

// E. Admin: Create User Account
router.post('/users/create', (req, res) => {
    const adminUser = getAuthAdmin(req);
    if (!adminUser) return res.redirect('/admin/login');

    const { username, password, reference_number } = req.body;
    if (!username || !password) {
        return res.redirect('/admin/dashboard?tab=users&userError=' + encodeURIComponent('Username and password are required'));
    }

    try {
        users.create(username, password, reference_number);
        res.redirect('/admin/dashboard?userCreated=true');
    } catch (err) {
        res.redirect('/admin/dashboard?tab=users&userError=' + encodeURIComponent('Username already exists or invalid data'));
    }
});

// F. Admin: Delete User Account
router.post('/users/delete', (req, res) => {
    const adminUser = getAuthAdmin(req);
    if (!adminUser) return res.redirect('/admin/login');

    const { id } = req.body;
    if (id) {
        users.delete(parseInt(id, 10));
    }
    res.redirect('/admin/dashboard?userDeleted=true');
});

// G. Admin: Quick Action Toggle Enterprise Branding
router.post('/branding/toggle', (req, res) => {
    const adminUser = getAuthAdmin(req);
    if (!adminUser) return res.redirect('/admin/login');

    const current = settings.get('enable_enterprise_branding') === 'true';
    settings.set('enable_enterprise_branding', current ? 'false' : 'true');
    res.redirect('/admin/dashboard?saved=true');
});

// H. Admin: Upload Custom Wallpaper
router.post('/wallpaper/upload', upload.single('wallpaper_file'), (req, res) => {
    const adminUser = getAuthAdmin(req);
    if (!adminUser) return res.redirect('/admin/login');

    if (req.file) {
        settings.set('background_image', `/images/${req.file.filename}`);
        settings.set('enable_enterprise_branding', 'true');
    }
    res.redirect('/admin/dashboard?saved=true');
});

// I. Admin: Select Wallpaper from Preset Gallery
router.post('/wallpaper/select', (req, res) => {
    const adminUser = getAuthAdmin(req);
    if (!adminUser) return res.redirect('/admin/login');

    const { selected_wallpaper } = req.body;
    if (selected_wallpaper) {
        settings.set('background_image', selected_wallpaper.trim());
    }
    settings.set('enable_enterprise_branding', 'true');
    res.redirect('/admin/dashboard?saved=true');
});

// J. Admin: Update Portal Settings
router.post('/settings', (req, res) => {
    const adminUser = getAuthAdmin(req);
    if (!adminUser) return res.redirect('/admin/login');

    const { server_ip, local_domain, session_hours, enterprise_name, enterprise_tagline, enable_enterprise_branding, admin_password } = req.body;

    if (server_ip) settings.set('server_ip', server_ip.trim());
    if (local_domain) settings.set('local_domain', local_domain.trim());
    if (session_hours) settings.set('session_hours', String(session_hours).trim());
    if (enterprise_name) settings.set('enterprise_name', enterprise_name.trim());
    if (enterprise_tagline) settings.set('enterprise_tagline', enterprise_tagline.trim());

    // Save enterprise branding toggle
    const isBrandingEnabled = enable_enterprise_branding === 'true' || enable_enterprise_branding === 'on';
    settings.set('enable_enterprise_branding', isBrandingEnabled ? 'true' : 'false');

    if (admin_password && admin_password.trim()) {
        admin.updatePassword(adminUser.username, admin_password.trim());
    }

    res.redirect('/admin/dashboard?saved=true');
});

// K. Revoke Client Session
router.post('/revoke-session', (req, res) => {
    const adminUser = getAuthAdmin(req);
    if (!adminUser) return res.redirect('/admin/login');

    const { ip_address } = req.body;
    if (ip_address) {
        sessions.delete(ip_address);
    }
    res.redirect('/admin/dashboard');
});

// K2. Admin: Direct Manual Authorization of Device IP
router.post('/sessions/authorize', (req, res) => {
    const adminUser = getAuthAdmin(req);
    if (!adminUser) return res.redirect('/admin/login');

    const { ip_address, hours } = req.body;
    if (ip_address) {
        const config = getConfig();
        sessions.create(ip_address.trim(), null, parseInt(hours || String(config.SESSION_HOURS), 10));
    }
    res.redirect('/admin/dashboard?tab=sessions');
});

// L. Clear DNS Logs
router.post('/clear-logs', (req, res) => {
    const adminUser = getAuthAdmin(req);
    if (!adminUser) return res.redirect('/admin/login');

    dnsLogs.clear();
    res.redirect('/admin/dashboard?cleared=true');
});

module.exports = router;
