// utils/dhcp.js
// AUTHOR: Pratyaksh
// Lightweight, cross-platform RFC 2131 & RFC 8910 DHCP Server for Node.js
// Broadcasts DNS Server (Opt 6) and Captive Portal URI (Opt 114) to LAN clients

const dgram = require('node:dgram');
const { getConfig } = require('./helpers');

const DHCP_SERVER_PORT = 67;
const DHCP_CLIENT_PORT = 68;
const DHCP_MAGIC_COOKIE = Buffer.from([99, 130, 83, 99]);

// DHCP Message Types (Option 53)
const DHCP_MSG_TYPE = {
  DISCOVER: 1,
  OFFER: 2,
  REQUEST: 3,
  DECLINE: 4,
  ACK: 5,
  NAK: 6,
  RELEASE: 7,
  INFORM: 8
};

// DHCP Options
const DHCP_OPTION = {
  SUBNET_MASK: 1,
  ROUTER: 3,
  DNS_SERVER: 6,
  HOST_NAME: 12,
  REQUESTED_IP: 50,
  LEASE_TIME: 51,
  MSG_TYPE: 53,
  SERVER_ID: 54,
  PARAM_REQUEST_LIST: 55,
  CAPTIVE_PORTAL_URI: 114, // RFC 8910
  END: 255
};

class DHCPServer {
  constructor(options = {}) {
    this.options = options;
    this.server = null;
    this.leases = new Map(); // MAC -> { ip, hostname, expiresAt }
    this.ipPool = [];
    this.listening = false;
  }

  // Parse IPv4 string to 4-byte buffer
  ipToBuffer(ipStr) {
    return Buffer.from(ipStr.split('.').map(octet => parseInt(octet, 10)));
  }

  // Parse 4-byte buffer to IPv4 string
  bufferToIp(buf, offset = 0) {
    return `${buf[offset]}.${buf[offset + 1]}.${buf[offset + 2]}.${buf[offset + 3]}`;
  }

  // Format MAC buffer to string (e.g., 'aa:bb:cc:dd:ee:ff')
  formatMac(buf, len = 6) {
    const parts = [];
    for (let i = 0; i < len; i++) {
      parts.push(buf[i].toString(16).padStart(2, '0'));
    }
    return parts.join(':');
  }

  // Parse incoming DHCP options
  parseOptions(buf, offset) {
    const options = {};
    let pos = offset;

    while (pos < buf.length) {
      const tag = buf[pos++];
      if (tag === 0) continue; // Pad option
      if (tag === 255) break;  // End option

      if (pos >= buf.length) break;
      const len = buf[pos++];
      const val = buf.subarray(pos, pos + len);
      pos += len;

      options[tag] = val;
    }
    return options;
  }

  // Generate dynamic pool based on server IP subnet
  initPool(serverIp, startOffset = 100, endOffset = 200) {
    const parts = serverIp.split('.').map(n => parseInt(n, 10));
    const prefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
    this.ipPool = [];
    for (let i = startOffset; i <= endOffset; i++) {
      const ip = `${prefix}.${i}`;
      if (ip !== serverIp) {
        this.ipPool.push(ip);
      }
    }
  }

  // Assign or reclaim an IP for a client MAC
  allocateIp(mac, requestedIp = null) {
    if (this.leases.has(mac)) {
      return this.leases.get(mac).ip;
    }

    // Try honoring requested IP if available in pool
    if (requestedIp && this.ipPool.includes(requestedIp)) {
      const inUse = Array.from(this.leases.values()).some(l => l.ip === requestedIp);
      if (!inUse) return requestedIp;
    }

    // Allocate first free IP
    const usedIps = new Set(Array.from(this.leases.values()).map(l => l.ip));
    for (const ip of this.ipPool) {
      if (!usedIps.has(ip)) {
        return ip;
      }
    }

    return this.ipPool[0] || '192.168.1.150';
  }

  buildReply(requestPacket, msgType, clientIp, config) {
    const reply = Buffer.alloc(548); // Standard BOOTP/DHCP message minimum
    reply.fill(0);

    reply[0] = 2; // BOOTREPLY
    reply[1] = requestPacket[1]; // htype
    reply[2] = requestPacket[2]; // hlen
    reply[3] = 0; // hops

    // Copy Transaction ID (xid)
    requestPacket.copy(reply, 4, 4, 8);

    // Flags (Broadcast flag)
    reply.writeUInt16BE(0x8000, 10);

    // yiaddr (Your Client IP)
    const clientIpBuf = this.ipToBuffer(clientIp);
    clientIpBuf.copy(reply, 16);

    // siaddr (Next server IP)
    const serverIpBuf = this.ipToBuffer(config.MY_SERVER_IP);
    serverIpBuf.copy(reply, 20);

    // chaddr (Client MAC)
    requestPacket.copy(reply, 28, 28, 44);

    // Magic Cookie (RFC 1497)
    DHCP_MAGIC_COOKIE.copy(reply, 236);

    // Write DHCP Options
    let pos = 240;

    // Option 53: DHCP Message Type
    reply[pos++] = DHCP_OPTION.MSG_TYPE;
    reply[pos++] = 1;
    reply[pos++] = msgType;

    // Option 54: Server Identifier
    reply[pos++] = DHCP_OPTION.SERVER_ID;
    reply[pos++] = 4;
    serverIpBuf.copy(reply, pos);
    pos += 4;

    // Option 51: IP Address Lease Time (default 24h = 86400s)
    const leaseTimeSeconds = parseInt(config.SESSION_HOURS || '24', 10) * 3600;
    reply[pos++] = DHCP_OPTION.LEASE_TIME;
    reply[pos++] = 4;
    reply.writeUInt32BE(leaseTimeSeconds, pos);
    pos += 4;

    // Option 1: Subnet Mask (255.255.255.0)
    reply[pos++] = DHCP_OPTION.SUBNET_MASK;
    reply[pos++] = 4;
    Buffer.from([255, 255, 255, 0]).copy(reply, pos);
    pos += 4;

    // Option 3: Default Gateway / Router
    // In soft portal mode, point gateway to server or network router
    reply[pos++] = DHCP_OPTION.ROUTER;
    reply[pos++] = 4;
    serverIpBuf.copy(reply, pos);
    pos += 4;

    // Option 6: Domain Name Server (DNS Server -> This Machine)
    reply[pos++] = DHCP_OPTION.DNS_SERVER;
    reply[pos++] = 4;
    serverIpBuf.copy(reply, pos);
    pos += 4;

    // Option 114: RFC 8910 Captive Portal API URI
    const capportUrl = `http://${config.MY_SERVER_IP}/.well-known/capport`;
    const capportBuf = Buffer.from(capportUrl, 'utf8');
    if (pos + 2 + capportBuf.length < reply.length - 1) {
      reply[pos++] = DHCP_OPTION.CAPTIVE_PORTAL_URI;
      reply[pos++] = capportBuf.length;
      capportBuf.copy(reply, pos);
      pos += capportBuf.length;
    }

    // Option 255: End Option
    reply[pos++] = DHCP_OPTION.END;

    return reply.subarray(0, pos);
  }

  handleMessage(msg, rinfo) {
    if (msg.length < 240) return;

    // Verify Magic Cookie
    if (
      msg[236] !== DHCP_MAGIC_COOKIE[0] ||
      msg[237] !== DHCP_MAGIC_COOKIE[1] ||
      msg[238] !== DHCP_MAGIC_COOKIE[2] ||
      msg[239] !== DHCP_MAGIC_COOKIE[3]
    ) {
      return;
    }

    const options = this.parseOptions(msg, 240);
    const msgTypeBuf = options[DHCP_OPTION.MSG_TYPE];
    if (!msgTypeBuf) return;
    const msgType = msgTypeBuf[0];

    const mac = this.formatMac(msg.subarray(28, 34));
    let requestedIp = null;
    if (options[DHCP_OPTION.REQUESTED_IP]) {
      requestedIp = this.bufferToIp(options[DHCP_OPTION.REQUESTED_IP]);
    }

    let hostname = '';
    if (options[DHCP_OPTION.HOST_NAME]) {
      hostname = options[DHCP_OPTION.HOST_NAME].toString('utf8');
    }

    const config = getConfig();
    if (this.ipPool.length === 0) {
      this.initPool(config.MY_SERVER_IP);
    }

    if (msgType === DHCP_MSG_TYPE.DISCOVER) {
      const offeredIp = this.allocateIp(mac, requestedIp);
      const reply = this.buildReply(msg, DHCP_MSG_TYPE.OFFER, offeredIp, config);
      this.server.send(reply, 0, reply.length, DHCP_CLIENT_PORT, '255.255.255.255');
    } else if (msgType === DHCP_MSG_TYPE.REQUEST) {
      const ackIp = this.allocateIp(mac, requestedIp);
      this.leases.set(mac, {
        ip: ackIp,
        hostname: hostname || 'Unknown Device',
        expiresAt: Date.now() + parseInt(config.SESSION_HOURS || '24', 10) * 3600 * 1000
      });
      const reply = this.buildReply(msg, DHCP_MSG_TYPE.ACK, ackIp, config);
      this.server.send(reply, 0, reply.length, DHCP_CLIENT_PORT, '255.255.255.255');
    } else if (msgType === DHCP_MSG_TYPE.RELEASE) {
      this.leases.delete(mac);
    }
  }

  start(port = DHCP_SERVER_PORT) {
    if (this.server) return;

    this.server = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this.server.on('message', (msg, rinfo) => {
      try {
        this.handleMessage(msg, rinfo);
      } catch (err) {
        // Safe catch to avoid crashing
      }
    });

    this.server.on('error', (err) => {
      if (err.code === 'EACCES' || err.code === 'EADDRINUSE') {
        console.log(`[DHCP] Note: UDP Port ${port} requires elevated permissions. (Integrated DHCP server in standby)`);
      } else {
        console.log(`[DHCP] Server warning: ${err.message}`);
      }
    });

    try {
      this.server.bind(port, '0.0.0.0', () => {
        try {
          this.server.setBroadcast(true);
          this.listening = true;
          console.log(`[DHCP] Integrated RFC 2131/8910 DHCP Server active on UDP Port ${port}`);
        } catch {}
      });
    } catch (err) {
      console.log(`[DHCP] Standby mode: ${err.message}`);
    }
  }

  stop() {
    if (this.server) {
      try { this.server.close(); } catch {}
      this.server = null;
      this.listening = false;
    }
  }

  getLeases() {
    return Array.from(this.leases.entries()).map(([mac, data]) => ({
      mac,
      ...data
    }));
  }
}

const dhcpServer = new DHCPServer();

module.exports = {
  DHCPServer,
  dhcpServer
};
