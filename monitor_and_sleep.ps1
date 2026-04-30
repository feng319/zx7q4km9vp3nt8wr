# 用法:
#   .\monitor_and_sleep.ps1                          # 默认监控新能源 (26 chunks)
#   .\monitor_and_sleep.ps1 -IndexPath "...\skus_index.json" -TotalChunks 50
#   .\monitor_and_sleep.ps1 -SkipSleep               # 只监控不睡眠

param(
    [string]$IndexPath = "G:\Program Files\AI coding\知识萃取\新能源\输出\skus\skus_index.json",
    [int]$TotalChunks = 0,
    [int]$IntervalSeconds = 60,
    [switch]$SkipSleep
)

# 自动检测总 chunks 数（从 chunks_index.json）
if ($TotalChunks -eq 0) {
    $chunksIndexPath = Split-Path $IndexPath | Split-Path | Join-Path -ChildPath "chunks\chunks_index.json"
    if (Test-Path $chunksIndexPath) {
        $pyResult = python -c "import json; d=json.load(open(r'$chunksIndexPath',encoding='utf-8')); print(len(d.get('chunks',[])))" 2>$null
        if ($pyResult -match '^\d+$') {
            $TotalChunks = [int]$pyResult
        }
    }
    if ($TotalChunks -eq 0) {
        Write-Host "ERROR: Cannot determine total chunks. Set -TotalChunks manually." -ForegroundColor Red
        exit 1
    }
}

Write-Host "Monitor started" -ForegroundColor Green
Write-Host "  Index: $IndexPath"
Write-Host "  Total chunks: $TotalChunks"
Write-Host "  Interval: ${IntervalSeconds}s"
Write-Host "  Sleep on complete: $(-not $SkipSleep)"
Write-Host ""

while ($true) {
    Start-Sleep -Seconds $IntervalSeconds

    if (!(Test-Path $IndexPath)) { continue }

    # 用 python 解析 JSON（比 PowerShell ConvertFrom-Json 可靠）
    $pyCmd = @"
import json, sys
try:
    d = json.load(open(r'''$IndexPath''', encoding='utf-8'))
    skus = d.get('skus', [])
    chunks = set(s.get('source_chunk','') for s in skus if s.get('source_chunk'))
    print(len(chunks))
except Exception as e:
    print('ERROR:' + str(e), file=sys.stderr)
    print(-1)
"@
    $done = ($pyCmd | python 2>$null | Select-Object -Last 1).Trim()

    if ($done -match '^-?\d+$') {
        $done = [int]$done
    } else {
        continue
    }

    if ($done -lt 0) { continue }

    $remaining = $TotalChunks - $done
    $ts = Get-Date -Format "HH:mm:ss"
    $pct = [math]::Round($done / $TotalChunks * 100)
    Write-Host "[$ts] chunks: $done / $TotalChunks ($pct%) | remaining: $remaining"

    if ($done -ge $TotalChunks) {
        Write-Host "[$ts] All done! Sleeping in 10s..." -ForegroundColor Green
        if (-not $SkipSleep) {
            Start-Sleep -Seconds 10
            rundll32.exe powrprof.dll,SetSuspendState 0,1,0
        }
        break
    }
}
