$path = "G:\Program Files\AI coding\知识萃取"
$total_chunks = 26

while ($true) {
    Start-Sleep -Seconds 60

    $index_path = Join-Path $path "新能源\输出\skus\skus_index.json"
    if (!(Test-Path $index_path)) { continue }

    $data = Get-Content $index_path -Raw | ConvertFrom-Json
    $chunks = $data.skus | ForEach-Object { $_.source_chunk } | Where-Object { $_ } | Sort-Object -Unique
    $done = $chunks.Count
    $remaining = $total_chunks - $done

    $ts = Get-Date -Format "HH:mm:ss"
    Write-Host "[$ts] chunks: $done / $total_chunks (remaining: $remaining)"

    if ($done -ge $total_chunks) {
        Write-Host "[$ts] All chunks processed. Putting computer to sleep..."
        Start-Sleep -Seconds 10
        rundll32.exe powrprof.dll,SetSuspendState 0,1,0
        break
    }
}
