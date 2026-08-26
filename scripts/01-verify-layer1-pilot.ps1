[CmdletBinding()]
param([switch]$WhatIf)
$ErrorActionPreference="Stop"
$env:Path=@([Environment]::GetEnvironmentVariable("Path","Machine"),[Environment]::GetEnvironmentVariable("Path","User"))-join ";"
$pilot=Join-Path (Split-Path $PSScriptRoot -Parent) "pilot"
if(-not(Test-Path (Join-Path $pilot "mise.toml"))){throw "Layer 1 pilot mise.toml is missing."}
if($WhatIf){Write-Host "[WhatIf] Would test NTFS hardlinks in a temporary directory and run mise task verify twice.";exit 0}
$scratch=Join-Path ([IO.Path]::GetTempPath()) ("afd-hardlink-"+[guid]::NewGuid().ToString("N"))
try{New-Item -ItemType Directory $scratch|Out-Null;$source=Join-Path $scratch "source";$link=Join-Path $scratch "link";Set-Content -LiteralPath $source -Value "afd" -NoNewline;New-Item -ItemType HardLink -Path $link -Target $source|Out-Null;if((Get-Content -Raw $link)-ne"afd"){throw "Hardlink content mismatch."}}finally{if(Test-Path $scratch){Remove-Item -LiteralPath $scratch -Recurse -Force}}
Push-Location $pilot
try{
    for($pass=1;$pass-le 2;$pass++){
        foreach($tool in @("python","node","go","rustc")){
            $executable=(& mise which $tool 2>&1 | Select-Object -First 1)
            if(($LASTEXITCODE -ne 0) -or -not(Test-Path -LiteralPath $executable -PathType Leaf)){throw "mise did not resolve $tool in pilot pass $pass."}
            if($tool -eq "go"){& $executable version}else{& $executable --version}
            if($LASTEXITCODE -ne 0){throw "$tool failed in pilot pass $pass."}
        }
        uv --version; if($LASTEXITCODE -ne 0){throw "uv failed in pilot pass $pass."}
        pnpm --version; if($LASTEXITCODE -ne 0){throw "pnpm failed in pilot pass $pass."}
    }
}finally{Pop-Location}
Write-Host "Layer 1 pilot and hardlink verification passed." -ForegroundColor Green
