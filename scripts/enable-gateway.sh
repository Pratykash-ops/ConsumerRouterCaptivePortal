#!/usr/bin/env bash
# scripts/enable-gateway.sh
# Optional Hard Enforcement: Enables Linux kernel IPv4 forwarding and NAT masquerade.
# Use this only if you want this server to act as a strict Layer 3/4 gateway filter.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
   echo "[-] This script must be run as root (sudo)."
   exit 1
fi

echo "[+] Enabling Linux IPv4 Packet Forwarding..."
sysctl -w net.ipv4.ip_forward=1 > /dev/null

# Persist sysctl
if ! grep -q "^net.ipv4.ip_forward=1" /etc/sysctl.conf 2>/dev/null; then
    echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf
fi

# Detect default outgoing WAN interface
WAN_IF=$(ip route get 8.8.8.8 2>/dev/null | awk '{print $5; exit}')
if [[ -z "$WAN_IF" ]]; then
    WAN_IF="eth0"
fi

echo "[+] Outgoing WAN interface detected: $WAN_IF"

# Configure NAT Masquerade
if command -v iptables >/dev/null 2>&1; then
    echo "[+] Configuring iptables FORWARD and NAT MASQUERADE rules..."
    iptables -t nat -A POSTROUTING -o "$WAN_IF" -j MASQUERADE
    iptables -A FORWARD -i "$WAN_IF" -m state --state RELATED,ESTABLISHED -j ACCEPT
    iptables -A FORWARD -j ACCEPT
    echo "[+] Gateway NAT routing active on interface: $WAN_IF"
else
    echo "[-] iptables command not found. Please install iptables or nftables."
fi

echo "[✓] Linux Gateway forwarding successfully initialized."
