Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "Starting CredChain Services" -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan

$coreDir = Join-Path $PSScriptRoot "member-1-blockchain-core"
$appDir = Join-Path $PSScriptRoot "member-2-blockchain-application"
$frontendDir = Join-Path $PSScriptRoot "member-1-blockchain-core\frontend"

# 1. Start Hardhat Node in a standalone PowerShell window
Write-Host "[1/4] Launching Hardhat Blockchain Node on port 8545..." -ForegroundColor Yellow
Start-Process powershell.exe -ArgumentList "-NoExit", "-Command", "Write-Host 'CredChain Hardhat Blockchain Node' -ForegroundColor Cyan; cd '$coreDir'; npx hardhat node"

# Wait for Hardhat Node to come online on port 8545
Write-Host "Waiting for blockchain node to listen on port 8545..." -ForegroundColor Yellow
$retries = 25
$nodeReady = $false
while ($retries -gt 0) {
    Start-Sleep -Seconds 1
    $conn = Get-NetTCPConnection -LocalPort 8545 -ErrorAction SilentlyContinue
    if ($conn) { 
        $nodeReady = $true
        break 
    }
    $retries--
}

if (-not $nodeReady) {
    Write-Host "Error: Hardhat node did not start in time." -ForegroundColor Red
    exit 1
}
Write-Host "Hardhat node is live on port 8545!" -ForegroundColor Green

# 2. Deploy Smart Contracts
Write-Host "[2/4] Deploying Smart Contracts..." -ForegroundColor Yellow
cd $coreDir
npx hardhat run scripts/deploy.js --network localhost

# 3. Start Member 2 Backend Server in standalone window
Write-Host "[3/4] Launching Member 2 Backend on port 3000..." -ForegroundColor Yellow
Start-Process powershell.exe -ArgumentList "-NoExit", "-Command", "Write-Host 'CredChain Member 2 Backend Server' -ForegroundColor Cyan; cd '$appDir'; node server.js"

# Wait for Backend to listen on port 3000
$retries = 20
$backendReady = $false
while ($retries -gt 0) {
    Start-Sleep -Seconds 1
    $conn = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
    if ($conn) { 
        $backendReady = $true
        break 
    }
    $retries--
}

if (-not $backendReady) {
    Write-Host "Error: Backend did not start in time." -ForegroundColor Red
    exit 1
}
Write-Host "Backend server is live on port 3000!" -ForegroundColor Green

# 4. Start Member 1 React Platform in standalone window
Write-Host "[4/4] Launching Member 1 React Frontend on port 5173..." -ForegroundColor Yellow
Start-Process powershell.exe -ArgumentList "-NoExit", "-Command", "Write-Host 'CredChain React Frontend' -ForegroundColor Cyan; cd '$frontendDir'; npm run dev"

# Wait for Frontend to listen on port 5173
$retries = 20
$frontendReady = $false
while ($retries -gt 0) {
    Start-Sleep -Seconds 1
    $conn = Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue
    if ($conn) { 
        $frontendReady = $true
        break 
    }
    $retries--
}

if (-not $frontendReady) {
    Write-Host "Error: Frontend did not start in time." -ForegroundColor Red
    exit 1
}
Write-Host "Frontend is live on port 5173!" -ForegroundColor Green

# 5. Open browser portals
Write-Host "Opening portals in default web browser..." -ForegroundColor Cyan
Start-Process "http://localhost:5173"
Start-Process "http://localhost:3000/verify.html"
Start-Process "http://localhost:3000/index.html"

Write-Host "===================================================" -ForegroundColor Green
Write-Host "All CredChain services launched successfully!" -ForegroundColor Green
Write-Host "- React Platform:         http://localhost:5173" -ForegroundColor White
Write-Host "- Public Verifier Portal: http://localhost:3000/verify.html" -ForegroundColor White
Write-Host "- Issuer Portal:          http://localhost:3000/index.html" -ForegroundColor White
Write-Host "- Hardhat Node RPC:       http://127.0.0.1:8545" -ForegroundColor White
Write-Host "===================================================" -ForegroundColor Green
