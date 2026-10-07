# Remove old build output directories (WB Proxy Manager)
# Keeps: dist-portable4 (current v1.1.0 build)
# Run from anywhere; paths resolved relative to this script.
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$keep = @('dist-portable4', 'dist-portable5')   # 保留当前版本（v1.1.0 / v1.2.0）

$targets = Get-ChildItem -LiteralPath $root -Directory -Filter 'dist-portable*' |
           Where-Object { $_.Name -ne $keep }

if (-not $targets) {
  Write-Host 'Nothing to clean: no old dist-portable* directories found.'
  exit 0
}

foreach ($t in $targets) {
  Write-Host "Removing: $($t.Name) ..."
  try {
    Remove-Item -LiteralPath $t.FullName -Recurse -Force -Confirm:$false -ErrorAction Stop
    if (Test-Path -LiteralPath $t.FullName) {
      Write-Host "  FAILED (still exists, likely locked): $($t.Name)"
    } else {
      Write-Host "  OK removed: $($t.Name)"
    }
  } catch {
    Write-Host "  FAILED: $($t.Name) -> $($_.Exception.Message)"
  }
}

Write-Host ''
Write-Host '--- remaining dist-portable* ---'
Get-ChildItem -LiteralPath $root -Directory -Filter 'dist-portable*' | ForEach-Object { Write-Host $_.Name }
Write-Host 'Done.'
