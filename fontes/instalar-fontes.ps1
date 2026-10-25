# Instala as fontes dos temas do AVDP Busca só para o usuário atual (sem administrador).
# O AVDP já traz as fontes dentro do programa; instalar no Windows serve para o Holyrics
# (e outros programas) mostrarem o mesmo texto.
$ErrorActionPreference = 'Stop'
$origem = $PSScriptRoot
$destino = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Fonts'
$reg = 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Fonts'
New-Item -ItemType Directory -Force $destino | Out-Null
if (-not (Test-Path $reg)) { New-Item -Force $reg | Out-Null }

Add-Type -Namespace W -Name F -MemberDefinition '[DllImport("gdi32.dll", CharSet=CharSet.Unicode)] public static extern int AddFontResource(string f);'

# hashes das fontes já instaladas (do usuário e do sistema), para não duplicar
$ja = @{}
foreach ($d in @($destino, (Join-Path $env:WINDIR 'Fonts'))) {
  Get-ChildItem $d -Include *.ttf, *.otf -Recurse -ErrorAction SilentlyContinue | ForEach-Object { $ja[$_.Length] = $true }
}

$novas = 0; $puladas = 0
foreach ($f in Get-ChildItem $origem -Filter *.ttf) {
  $alvo = Join-Path $destino $f.Name
  if ($ja.ContainsKey($f.Length)) {
    $h = (Get-FileHash $f.FullName).Hash
    $igual = Get-ChildItem $destino, (Join-Path $env:WINDIR 'Fonts') -Include *.ttf -Recurse -ErrorAction SilentlyContinue |
      Where-Object { $_.Length -eq $f.Length -and (Get-FileHash $_.FullName).Hash -eq $h }
    if ($igual) { Write-Host "  já instalada: $($f.Name)"; $puladas++; continue }
  }
  Copy-Item $f.FullName $alvo -Force
  New-ItemProperty -Path $reg -Name "$($f.BaseName) (TrueType)" -Value $alvo -PropertyType String -Force | Out-Null
  [void][W.F]::AddFontResource($alvo)
  Write-Host "  instalada: $($f.Name)"; $novas++
}
Write-Host ""
Write-Host "Fontes novas: $novas  |  já existiam: $puladas"
Write-Host "Feche e abra o Holyrics para ele ver as fontes novas."
