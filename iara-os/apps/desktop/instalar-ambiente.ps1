# =============================================================================
# IARA Desktop — instalação única do ambiente de build (Windows)
#
# Execute UMA vez, como usuário normal (o instalador pede elevação quando
# precisar). Depois disso: `npm install` e `npm run dev` nesta pasta.
#
# O que instala e por quê:
#   1. Rust (rustup)            — o Tauri compila o shell nativo em Rust.
#   2. VS Build Tools + C++     — o linker do Windows (obrigatório p/ Rust MSVC).
#   Download total ~2 GB; primeira compilação demora vários minutos. É uma vez só.
# =============================================================================

Write-Host "[1/3] Instalando Rust (rustup)..." -ForegroundColor Cyan
winget install --id Rustlang.Rustup -e --accept-source-agreements --accept-package-agreements

Write-Host "[2/3] Instalando Visual Studio Build Tools (C++)..." -ForegroundColor Cyan
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --accept-source-agreements --accept-package-agreements --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

Write-Host "[3/3] Dependências do app..." -ForegroundColor Cyan
Set-Location $PSScriptRoot
npm install

Write-Host ""
Write-Host "Pronto. Feche e reabra o terminal (para o PATH do Rust valer) e rode:" -ForegroundColor Green
Write-Host "    cd iara-os\apps\desktop"
Write-Host "    npm run dev"
Write-Host ""
Write-Host "Lembrete: o motor precisa estar de pe (cd iara-os\apps\web; npm run dev)."
