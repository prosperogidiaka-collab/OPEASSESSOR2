$ErrorActionPreference = 'Stop'

$ruleName = 'OPE Assessor HTTP 8000'
$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue

if ($existing) {
  Set-NetFirewallRule -DisplayName $ruleName -Enabled True -Action Allow
} else {
  New-NetFirewallRule `
    -DisplayName $ruleName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort 8000 `
    -Profile Any | Out-Null
}

Write-Host 'OPE Assessor firewall access is enabled on TCP port 8000.'
Write-Host 'Open this from other devices on the same Wi-Fi: http://172.22.86.248:8000'
