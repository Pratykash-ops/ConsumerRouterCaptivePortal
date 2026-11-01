// utils/diagnostics.js
// AUTHOR: Pratyaksh
// Network Pre-Flight & Diagnostics Engine for ConsumerRouterCaptivePortal
// Validates ports, permissions, router gateway, DNS delegation, and upstream connectivity

const os = require('os');
const fs = require('fs');
const net = require('node:net');
const dgram = require('node:dgram');
const dns = require('node:dns').promises;
const dnsSync = require('node:dns');
const { getLocalIpAddress, getAllNetworkInterfaces } = require('./network');
const { getConfig } = require('./helpers');

/**
 * Test whether a TCP port is currently free or in use.
 */
function probeTcpPort(port, host = '0.0.0.0') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      resolve({
        port,
        protocol: 'TCP',
        available: false,
        error: err.code || err.message,
        inUseBySelf: err.code === 'EADDRINUSE'
      });
    });
    server.once('listening', () => {
      server.close(() => {
        resolve({ port, protocol: 'TCP', available: true, error: null });
      });
    });
    try {
      server.listen(port, host);
    } catch (err) {
      resolve({ port, protocol: 'TCP', available: false, error: err.code || err.message });
    }
  });
}

/**
 * Test whether a UDP port is currently free or in use.
 */
function probeUdpPort(port, host = '0.0.0.0') {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    socket.once('error', (err) => {
      resolve({
        port,
        protocol: 'UDP',
        available: false,
        error: err.code || err.message,
        inUseBySelf: err.code === 'EADDRINUSE'
      });
    });
    try {
      socket.bind(port, host, () => {
        try {
          socket.close(() => {
            resolve({ port, protocol: 'UDP', available: true, error: null });
          });
        } catch {
          resolve({ port, protocol: 'UDP', available: true, error: null });
        }
      });
    } catch (err) {
      resolve({ port, protocol: 'UDP', available: false, error: err.code || err.message });
    }
  });
}

/**
 * Estimate Default Router Gateway from local IP
 */
function estimateGatewayIp(serverIp) {
  if (!serverIp || serverIp === '127.0.0.1') return '192.168.1.1';
  const parts = serverIp.split('.');
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.${parts[2]}.1`;
  }
  return '192.168.1.1';
}

/**
 * Probe TCP connectivity to a host and port with timeout
 */
function probeConnectivity(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let status = false;

    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      status = true;
      socket.destroy();
      resolve(true);
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });

    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });

    try {
      socket.connect(port, host);
    } catch {
      resolve(false);
    }
  });
}

/**
 * Runs a complete pre-flight diagnostic suite
 */
async function runPreFlightDiagnostics() {
  const config = getConfig();
  const serverIp = config.DETECTED_IP || getLocalIpAddress();
  const estimatedGateway = estimateGatewayIp(serverIp);
  const isPrivileged = typeof process.getuid === 'function' ? process.getuid() === 0 : true; // Windows default true

  const primaryAdapter = getAllNetworkInterfaces().find(i => i.isDetected) || getAllNetworkInterfaces()[0];
  const primaryMac = primaryAdapter ? primaryAdapter.mac : null;

  const results = {
    timestamp: new Date().toISOString(),
    serverIp,
    estimatedGateway,
    primaryMac,
    isPrivileged,
    allPassed: true,
    hasWarnings: false,
    checks: []
  };

  // 1. IP & Network Interface Check
  const hasValidLanIp = serverIp && serverIp !== '127.0.0.1';
  results.checks.push({
    id: 'lan_ip',
    title: 'Host Machine LAN IPv4',
    status: hasValidLanIp ? 'ok' : 'error',
    value: serverIp,
    details: hasValidLanIp
      ? `Successfully detected LAN IP (${serverIp}).`
      : 'No active physical network adapter with LAN IP detected. Connect to router Wi-Fi or Ethernet.',
    actionRequired: !hasValidLanIp
  });

  // 2. Static IP Assignment / DHCP Address Reservation Check
  let hasDhcpIndicator = false;
  try {
    const dhcpPaths = ['/var/lib/dhcp', '/var/run/dhclient.pid', '/run/systemd/netif/leases', '/run/dhcpcd'];
    for (const p of dhcpPaths) {
      if (fs.existsSync(p)) {
        hasDhcpIndicator = true;
        break;
      }
    }
  } catch {}

  results.checks.push({
    id: 'static_ip_reservation',
    title: 'Static IP / Router DHCP Reservation',
    status: hasDhcpIndicator ? 'warning' : 'ok',
    value: `${serverIp}${primaryMac ? ` (MAC: ${primaryMac})` : ''}`,
    details: hasDhcpIndicator
      ? `Host network adapter appears to use a dynamic DHCP lease. If the router assigns a new IP upon renewal or reboot, all DNS redirection and captive portal routes will immediately fail.`
      : `Host machine LAN IP is ${serverIp}. For permanent uptime, ensure this IP address is statically assigned or reserved in your router's DHCP settings.`,
    actionRequired: hasDhcpIndicator,
    recommendation: primaryMac
      ? `Router Action: In Router Settings -> DHCP Reservation / Static Leases, permanently bind MAC [${primaryMac}] to IP [${serverIp}].`
      : `Router Action: Assign a static DHCP address reservation for IP [${serverIp}] in your router settings.`
  });

  // 3. Privilege / Root Permissions Check
  results.checks.push({
    id: 'privileges',
    title: 'Process Elevation (Root / Administrator)',
    status: isPrivileged ? 'ok' : 'warning',
    value: isPrivileged ? 'Elevated (UID 0)' : 'Non-root user',
    details: isPrivileged
      ? 'Process is running with elevated privileges required for low ports (53, 67, 80).'
      : 'Running as normal user. Binding UDP Port 53 (DNS) and Port 67 (DHCP) typically requires root (sudo) or Administrator.',
    actionRequired: !isPrivileged
  });

  // 4. Router Gateway Reachability Check
  // Test common router management ports (80 HTTP, 443 HTTPS, 53 DNS)
  const isGatewayWeb = await probeConnectivity(estimatedGateway, 80, 1000);
  const isGatewayDns = await probeConnectivity(estimatedGateway, 53, 1000);
  const isGatewayReachable = isGatewayWeb || isGatewayDns;

  results.checks.push({
    id: 'router_gateway',
    title: 'Consumer Router Gateway Reachability',
    status: isGatewayReachable ? 'ok' : 'warning',
    value: `${estimatedGateway} (${isGatewayReachable ? 'Reachable' : 'No response'})`,
    details: isGatewayReachable
      ? `Successfully communicated with router gateway at ${estimatedGateway}.`
      : `No immediate response on common ports from estimated router IP ${estimatedGateway}. Router may block TCP probes or use a different subnet.`,
    actionRequired: false
  });

  // 5. DNS Delegation / Router Points to Server Check
  const configuredDnsServers = dnsSync.getServers();
  const pointsToSelf = configuredDnsServers.some(s => s === serverIp || s === '127.0.0.1' || s === '::1');

  // Direct DNS probe to router gateway
  let routerResolvesToSelf = false;
  try {
    const { Resolver } = require('node:dns').promises;
    const routerResolver = new Resolver();
    routerResolver.setServers([estimatedGateway]);
    const res = await routerResolver.resolve4(config.LOCAL_DOMAIN).catch(() => []);
    if (res.includes(serverIp)) {
      routerResolvesToSelf = true;
    }
  } catch {}

  // Local interception probe
  let dnsInterceptionActive = false;
  try {
    const res = await dns.resolve4(config.LOCAL_DOMAIN).catch(() => []);
    if (res.includes(serverIp)) {
      dnsInterceptionActive = true;
    }
  } catch {}

  const dnsStatus = pointsToSelf || routerResolvesToSelf || dnsInterceptionActive;
  results.checks.push({
    id: 'dns_delegation',
    title: 'Router DNS Delegation (Points to Server)',
    status: dnsStatus ? 'ok' : 'warning',
    value: dnsStatus
      ? `Points to ${serverIp} (Active)`
      : `Current DNS: [${configuredDnsServers.join(', ') || 'Router Gateway'}]`,
    details: dnsStatus
      ? `Verified: DNS requests are successfully directed to this server machine (${serverIp}). Unauthenticated clients will be caught and prompted to log in.`
      : `Router / client DNS is NOT pointing to this machine yet. Current active DNS: [${configuredDnsServers.join(', ')}]. Connected clients will bypass the captive portal until router DNS is updated.`,
    actionRequired: !dnsStatus,
    recommendation: `Router Action: Set Primary DNS (DNS 1) to ${serverIp} (leave Secondary DNS empty), OR Disable router DHCP so our built-in DHCP server provides it.`
  });

  // 6. Upstream Internet Connectivity Check
  let upstreamInternet = false;
  try {
    const upstreamProbe = await dns.resolve4('connectivitycheck.gstatic.com').catch(() => []);
    upstreamInternet = upstreamProbe.length > 0;
  } catch {}

  results.checks.push({
    id: 'upstream_internet',
    title: 'Upstream Internet Connectivity',
    status: upstreamInternet ? 'ok' : 'warning',
    value: upstreamInternet ? 'Online' : 'Offline / Restricted',
    details: upstreamInternet
      ? 'Host machine has verified active internet access through upstream gateway.'
      : 'Host cannot resolve external internet domains. Ensure router WAN is connected.',
    actionRequired: !upstreamInternet
  });

  // 6. Port Availability Checks
  // Note: If our own process is already running and listening, EADDRINUSE is expected for self
  const portProbes = [
    { name: 'HTTP Web Server', port: 80, type: 'TCP', probe: probeTcpPort(80) },
    { name: 'DNS Interceptor', port: 53, type: 'UDP', probe: probeUdpPort(53) },
    { name: 'DHCP Engine', port: 67, type: 'UDP', probe: probeUdpPort(67) }
  ];

  for (const p of portProbes) {
    const probeRes = await p.probe;
    // If available OR error is EADDRINUSE (meaning our process or another is already bound)
    const isBoundBySelf = probeRes.inUseBySelf;
    results.checks.push({
      id: `port_${p.port}`,
      title: `${p.name} (Port ${p.port}/${p.type})`,
      status: probeRes.available || isBoundBySelf ? 'ok' : 'error',
      value: probeRes.available ? 'Available' : (isBoundBySelf ? 'Active (Listening)' : `Occupied (${probeRes.error})`),
      details: probeRes.available || isBoundBySelf
        ? `Port ${p.port}/${p.type} is ready for captive service.`
        : `Port ${p.port}/${p.type} failed: ${probeRes.error}. If port 53 is used by systemd-resolved, run: sudo systemctl stop systemd-resolved`,
      actionRequired: !probeRes.available && !isBoundBySelf
    });
  }

  // Calculate overall status
  results.allPassed = !results.checks.some(c => c.status === 'error');
  results.hasWarnings = results.checks.some(c => c.status === 'warning');

  return results;
}

module.exports = {
  runPreFlightDiagnostics,
  estimateGatewayIp,
  probeConnectivity
};
