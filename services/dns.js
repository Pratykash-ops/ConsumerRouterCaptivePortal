// services/dns.js
// DNS Interceptor & Hijacker Service

const dns2 = require('dns2');
const dns = require('node:dns').promises;
const { Packet } = dns2;
const { dnsLogs, settings } = require('../utils/database');
const { isServerIp } = require('../utils/network');
const { getConfig, isAuthorized } = require('../utils/helpers');
const { PORTS, UPSTREAM_DNS } = require('../config/constants');

// Configure upstream Google DNS
dns.setServers(UPSTREAM_DNS);

/**
 * Handles incoming DNS request packets
 */
async function handleDnsRequest(request, send, rinfo) {
  const response = Packet.createResponseFromRequest(request);
  const [question] = (request.questions || []);
  const clientIP = rinfo.address;
  const config = getConfig();

  if (!question) {
    response.header.rcode = Packet.RCODE.FORMERR;
    return send(response);
  }

  try {
    const authorized = (settings.isSetupDone() && isAuthorized(clientIP));

    if (question.type === Packet.TYPE.A) {
      if (!authorized || question.name === config.LOCAL_DOMAIN) {
        // Spoof query: Point unauthorized client or local domain to captive portal IP
        response.answers.push({
          name: question.name,
          type: Packet.TYPE.A,
          class: Packet.CLASS.IN,
          ttl: 60,
          address: config.MY_SERVER_IP
        });
        dnsLogs.log(clientIP, question.name, 'hijacked');
      } else {
        // Resolve upstream address for authenticated client or local host
        try {
          const addresses = await dns.resolve4(question.name);
          if (addresses && addresses.length > 0) {
            response.answers.push({
              name: question.name,
              type: Packet.TYPE.A,
              class: Packet.CLASS.IN,
              ttl: 300,
              address: addresses[0]
            });
            const isServer = isServerIp(clientIP, config.MY_SERVER_IP);
            dnsLogs.log(clientIP, question.name, isServer ? 'server_bypass' : 'resolved');
          } else {
            response.header.rcode = Packet.RCODE.NXDOMAIN;
            dnsLogs.log(clientIP, question.name, 'error');
          }
        } catch {
          response.header.rcode = Packet.RCODE.NXDOMAIN;
          dnsLogs.log(clientIP, question.name, 'error');
        }
      }
    } else if (question.type === Packet.TYPE.AAAA) {
      // IPv6 Query Handling
      if (authorized) {
        try {
          const addresses = await dns.resolve6(question.name);
          if (addresses && addresses.length > 0) {
            for (const addr of addresses) {
              response.answers.push({
                name: question.name,
                type: Packet.TYPE.AAAA,
                class: Packet.CLASS.IN,
                ttl: 300,
                address: addr
              });
            }
          } else {
            response.header.rcode = Packet.RCODE.NXDOMAIN;
          }
        } catch {
          response.header.rcode = Packet.RCODE.NXDOMAIN;
        }
      } else {
        // Return empty NOERROR for unauthorized clients to encourage IPv4 A-record query
        response.header.rcode = Packet.RCODE.NOERROR;
      }
    } else {
      // Non-A / Non-AAAA records (TXT, MX, SRV, etc.)
      if (!authorized) {
        response.header.rcode = Packet.RCODE.NXDOMAIN;
      }
    }
  } catch (err) {
    console.error('[DNS] Resolution error caught safely:', err.message);
    response.header.rcode = Packet.RCODE.SERVFAIL;
  }

  send(response);
}

/**
 * Creates and configures the DNS2 Server instance
 */
function createDnsServer() {
  return dns2.createServer({
    udp: true,
    handle: handleDnsRequest
  });
}

const dnsServer = createDnsServer();

function startDnsServer(port = PORTS.DNS) {
  dnsServer.listen({ udp: port });
  dnsServer.on('listening', () => console.log(`[DNS] Hijacker listening on UDP Port ${port}`));
}

function stopDnsServer() {
  try {
    dnsServer.close();
  } catch {}
}

module.exports = {
  dnsServer,
  createDnsServer,
  handleDnsRequest,
  startDnsServer,
  stopDnsServer
};
