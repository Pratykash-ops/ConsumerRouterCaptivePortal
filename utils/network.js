/*
AUTHOR: PRATYAKSH
LAST EDITED 18 October 2026
*/

const os = require('os');

/**
 * Automatically detects the machine's primary IPv4 address on the local router/network.
 * Prioritizes physical LAN/WLAN interfaces over virtual/VPN adapters (e.g., Tailscale, Docker, tun).
 * @returns {string} Detected IPv4 address (e.g. '192.168.2.102') or '127.0.0.1' fallback.
 */
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        candidates.push({
          name,
          address: addr.address,
          netmask: addr.netmask,
          mac: addr.mac
        });
      }
    }
  }

  if (candidates.length === 0) {
    return '127.0.0.1';
  }

  const isVpnOrVirtual = (name) => /tailscale|docker|tun|tap|veth|br-|vmnet|vboxnet/i.test(name);
  const isPrivateLan = (ip) => /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(ip);

  // 1. Prefer physical network interface with private LAN address (typical router DHCP IP)
  const bestPhysical = candidates.find(c => !isVpnOrVirtual(c.name) && isPrivateLan(c.address));
  if (bestPhysical) return bestPhysical.address;

  // 2. Any physical non-virtual network interface
  const anyPhysical = candidates.find(c => !isVpnOrVirtual(c.name));
  if (anyPhysical) return anyPhysical.address;

  // 3. Fallback to first non-internal IPv4
  return candidates[0].address;
}

/**
 * Returns all active IPv4 network interfaces on the machine.
 * Useful for operator display and interface selection in setup.
 */
function getAllNetworkInterfaces() {
  const interfaces = os.networkInterfaces();
  const detectedIp = getLocalIpAddress();
  const list = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        list.push({
          interface: name,
          address: addr.address,
          netmask: addr.netmask,
          mac: addr.mac,
          isDetected: addr.address === detectedIp
        });
      }
    }
  }

  return list;
}

/**
 * Checks whether an IP belongs to the local server host (loopback or host adapter).
 * Used to ensure the server's own internet traffic is NEVER blocked or hijacked by the portal wall.
 */
function isServerIp(ip, configuredServerIp = null) {
  if (!ip) return false;
  const clean = ip.replace('::ffff:', '').trim();
  if (clean === '127.0.0.1' || clean === '::1' || clean === 'localhost') return true;
  if (configuredServerIp && clean === configuredServerIp.trim()) return true;

  const interfaces = os.networkInterfaces();
  for (const addrs of Object.values(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.address === clean) return true;
    }
  }
  return false;
}

/**
 * Returns host machine & process metrics for dashboard display.
 */
function getSystemStats() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memPercent = Math.round((usedMem / totalMem) * 100);

  const uptimeSec = Math.floor(os.uptime());
  const days = Math.floor(uptimeSec / 86400);
  const hours = Math.floor((uptimeSec % 86400) / 3600);
  const mins = Math.floor((uptimeSec % 3600) / 60);
  const systemUptime = `${days > 0 ? days + 'd ' : ''}${hours}h ${mins}m`;

  const nodeUptimeSec = Math.floor(process.uptime());
  const nhours = Math.floor(nodeUptimeSec / 3600);
  const nmins = Math.floor((nodeUptimeSec % 3600) / 60);
  const nsecs = nodeUptimeSec % 60;
  const processUptime = `${nhours > 0 ? nhours + 'h ' : ''}${nmins}m ${nsecs}s`;

  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.arch()}`,
    release: os.release(),
    nodeVersion: process.version,
    cpuCount: os.cpus() ? os.cpus().length : 1,
    cpuModel: os.cpus() && os.cpus()[0] ? os.cpus()[0].model : 'Unknown Processor',
    loadAvg: os.loadavg().map(n => n.toFixed(2)).join(', '),
    totalMemMb: Math.round(totalMem / (1024 * 1024)),
    usedMemMb: Math.round(usedMem / (1024 * 1024)),
    freeMemMb: Math.round(freeMem / (1024 * 1024)),
    memPercent,
    systemUptime,
    processUptime
  };
}

module.exports = {
  getLocalIpAddress,
  getAllNetworkInterfaces,
  isServerIp,
  getSystemStats
};
