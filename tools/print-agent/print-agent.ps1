# CNTP print-relay agent
# Runs on an always-on machine on the factory LAN (e.g. the office PC).
# Polls prod for pending print jobs and sends each to its printer over TCP 9100.
# Needs only outbound HTTPS to prod + LAN access to the printers — no Tailscale/VPN.
#
# Usage (PowerShell):
#   $env:PROD_URL = "https://<production-url>"
#   $env:PRINT_AGENT_SECRET = "<same secret as prod PRINT_AGENT_SECRET>"
#   powershell -ExecutionPolicy Bypass -File .\print-agent.ps1
#
# To run permanently, register it as a Scheduled Task (see README.md).

$ProdUrl = $env:PROD_URL
$Secret  = $env:PRINT_AGENT_SECRET
$PollMs  = 1000

if ([string]::IsNullOrWhiteSpace($ProdUrl) -or [string]::IsNullOrWhiteSpace($Secret)) {
  Write-Error "Set PROD_URL and PRINT_AGENT_SECRET environment variables first."
  exit 1
}

$Headers = @{ "x-print-agent-secret" = $Secret }
Write-Host "print-agent started → $ProdUrl (polling every $PollMs ms)"

function Send-ToPrinter([string]$ip, [int]$port, [string]$payload) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $client.BeginConnect($ip, $port, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne(5000)) { throw "connect timeout to ${ip}:${port}" }
    $client.EndConnect($iar)
    $stream = $client.GetStream()
    $bytes = [System.Text.Encoding]::ASCII.GetBytes($payload)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
    Start-Sleep -Milliseconds 200
  } finally {
    $client.Close()
  }
}

while ($true) {
  try {
    $resp = Invoke-RestMethod -Uri "$ProdUrl/api/print/agent/next" -Method Post -Headers $Headers -TimeoutSec 15
    foreach ($job in $resp.jobs) {
      $ok = $true; $err = $null
      try {
        Send-ToPrinter $job.printer_ip ([int]$job.printer_port) $job.payload
        Write-Host ("printed {0} → {1}:{2} ({3})" -f $job.section_id, $job.printer_ip, $job.printer_port, $job.id)
      } catch {
        $ok = $false; $err = $_.Exception.Message
        Write-Warning ("FAILED {0} → {1}: {2}" -f $job.section_id, $job.printer_ip, $err)
      }
      $body = @{ id = $job.id; ok = $ok; error = $err } | ConvertTo-Json
      try {
        Invoke-RestMethod -Uri "$ProdUrl/api/print/agent/result" -Method Post -Headers $Headers -ContentType "application/json" -Body $body -TimeoutSec 15 | Out-Null
      } catch {
        Write-Warning "could not report result for $($job.id): $($_.Exception.Message)"
      }
    }
  } catch {
    Write-Warning "poll error: $($_.Exception.Message)"
    Start-Sleep -Seconds 3
  }
  Start-Sleep -Milliseconds $PollMs
}
