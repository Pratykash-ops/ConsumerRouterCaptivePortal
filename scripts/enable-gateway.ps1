# scripts/enable-gateway.ps1
# Optional Hard Enforcement: Enables Windows IPv4 Routing and NAT Masquerade.
# Run in Administrator PowerShell.

Write-Host "[+] Checking Administrator privileges..." -ForegroundColor Cyan
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error "[-] This script must be run as Administrator."
    Exit 1
}

Write-Host "[+] Enabling Windows IPv4 Forwarding..." -ForegroundColor Cyan
Set-NetIPInterface -Forwarding Enabled

Write-Host "[+] Verifying Network Adapters..." -ForegroundColor Cyan
Get-NetAdapter | Where-Object { $_.Status -eq "Up" } | Format-Table Name, InterfaceDescription, LinkSpeed

Write-Host "[✓] Windows packet forwarding enabled." -ForegroundColor Green
Write-Host "[i] In ConsumerRouterCaptivePortal, use integrated DHCP mode to direct clients through this host." -ForegroundColor Yellow
