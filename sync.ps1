$path = "G:\Program Files\AI coding\知识萃取"
Set-Location $path

$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = $path
$watcher.IncludeSubdirectories = $true
$watcher.EnableRaisingEvents = $true

$action = {
    Start-Sleep -Seconds 5
    Set-Location "G:\Program Files\AI coding\知识萃取"
    git add -A
    $changes = git status --porcelain
    if ($changes) {
        git commit -m "auto sync"
        git push origin main
    }
}

Register-ObjectEvent $watcher "Created" -Action $action | Out-Null
Register-ObjectEvent $watcher "Changed" -Action $action | Out-Null
Register-ObjectEvent $watcher "Deleted" -Action $action | Out-Null
Register-ObjectEvent $watcher "Renamed" -Action $action | Out-Null

while ($true) { Start-Sleep -Seconds 10 }
