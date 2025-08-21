@echo off
setlocal enabledelayedexpansion

:: Real-time WebRTC Multi-Object Detection Startup Script for Windows
title WebRTC Object Detection

:: Default configuration
set MODE=wasm
set PORT=3000
set USE_NGROK=false

:: Parse arguments
:parse_args
if "%~1"=="" goto :done_parsing
if "%~1"=="--ngrok" (
    set USE_NGROK=true
    shift
    goto :parse_args
)
if "%~1"=="--mode" (
    set MODE=%~2
    shift
    shift
    goto :parse_args
)
if "%~1"=="--port" (
    set PORT=%~2
    shift
    shift
    goto :parse_args
)
if "%~1"=="-h" goto :show_help
if "%~1"=="--help" goto :show_help
echo Unknown option %~1
exit /b 1

:show_help
echo Usage: %0 [OPTIONS]
echo Options:
echo   --mode [wasm^|server]  Processing mode (default: wasm)
echo   --port PORT          Server port (default: 3000)
echo   --ngrok              Use ngrok for phone connectivity
echo   -h, --help           Show this help
exit /b 0

:done_parsing

echo.
echo 🚀 Starting WebRTC Multi-Object Detection
echo Mode: %MODE%
echo Port: %PORT%
echo Ngrok: %USE_NGROK%
echo.

:: Check dependencies
where node >nul 2>nul
if errorlevel 1 (
    echo ❌ Node.js not found. Please install Node.js from https://nodejs.org/
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo ❌ npm not found. Please install Node.js from https://nodejs.org/
    exit /b 1
)

:: Install dependencies if needed
if not exist "node_modules" (
    echo 📦 Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo ❌ Failed to install dependencies
        exit /b 1
    )
)

if not exist "models" (
    echo 🧠 Setting up models...
    if exist "scripts\download_models.sh" (
        bash scripts/download_models.sh
    ) else (
        mkdir models
        echo Model setup placeholder > models\README.txt
    )
)

:: Start ngrok if requested
if "%USE_NGROK%"=="true" (
    where ngrok >nul 2>nul
    if errorlevel 1 (
        echo ❌ ngrok not found. Please install from https://ngrok.com/
        exit /b 1
    )
    
    echo 🌐 Starting ngrok tunnel...
    start /b ngrok http %PORT% > ngrok.log 2>&1
    timeout /t 3 /nobreak >nul
    echo 📱 Check ngrok.log for public URL
)

:: Set environment variables
set NODE_ENV=production

:: Start the server
echo 🎯 Starting server in %MODE% mode...

if "%MODE%"=="server" (
    start /b npm run start:server
) else (
    start /b npm run start:wasm
)

:: Wait a moment for server to start
timeout /t 3 /nobreak >nul

:: Open browser
start http://localhost:%PORT%

echo.
echo ✅ Server should be running! Check your browser.
echo 🌐 Desktop: http://localhost:%PORT%
echo 📱 Phone: Scan QR code or visit /phone
echo.
echo Press any key to stop the server...
pause >nul

:: Cleanup
echo 🧹 Stopping server...
taskkill /f /im node.exe 2>nul
if "%USE_NGROK%"=="true" (
    taskkill /f /im ngrok.exe 2>nul
)

echo ✅ Stopped
exit /b 0
