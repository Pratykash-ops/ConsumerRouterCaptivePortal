// config/constants.js
// Centralized configuration constants and network defaults

module.exports = {
  PORTS: {
    HTTP: 80,
    DNS: 53,
    HTTPS: 443,
    DHCP: 67
  },

  UPSTREAM_DNS: ['8.8.8.8', '8.8.4.4'],

  DEFAULT_LOCAL_DOMAIN: 'myportal.sc',
  DEFAULT_SESSION_HOURS: 24,

  // Captive Network Assistant (CNA) & RFC 8908 probe endpoints that must pass through without 302 redirect
  PROBE_PATHS: [
    '/.well-known/capport',
    '/capport',
    '/generate_204',
    '/gen_204',
    '/hotspot-detect.html',
    '/canonical.html',
    '/library/test/success.html',
    '/success.txt',
    '/ncsi.txt',
    '/connecttest.txt'
  ]
};
