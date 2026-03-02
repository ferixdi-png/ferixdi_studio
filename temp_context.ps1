$lines = Get-Content 'app\data\characters.json' -Encoding UTF8
$contaminated = @(2260,4727,8440,8966,9144,9668,9843,10373,10722,11411,12103,19917,23199,23376,23549,24239,24761,24935,25109,25630,26491,27697,29420,29942,30290,30983,31673,32191,32535)

foreach($bodyLine in $contaminated) {
    $idx = $bodyLine - 1
    $bodyVal = $lines[$idx].Trim()
    
    # Search backwards for height_build and character ID
    $hb = "NOT_FOUND"
    $charId = "NOT_FOUND"
    $age = "NOT_FOUND"
    for($j = $idx; $j -gt ($idx - 60); $j--) {
        if($lines[$j] -match '"height_build":\s*"(.+)"') {
            $hb = $Matches[1]
        }
        if($lines[$j] -match '"age":\s*"(.+)"') {
            $age = $Matches[1]
        }
        if($lines[$j] -match '"id":\s*"(.+)"') {
            $charId = $Matches[1]
        }
        if($charId -ne "NOT_FOUND" -and $hb -ne "NOT_FOUND" -and $age -ne "NOT_FOUND") { break }
    }
    Write-Output "L${bodyLine}|${charId}|age:${age}|hb:${hb}|val:${bodyVal}"
}
