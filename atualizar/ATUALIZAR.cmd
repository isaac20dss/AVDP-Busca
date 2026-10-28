@echo off
rem Atualiza o AVDP Busca e o AVDP Busca Plugin neste computador, por cima da versao antiga.
rem   1. AVDP Busca         -> %LOCALAPPDATA%\AVDP Busca         (instalador /S; banco mantido)
rem   2. AVDP Busca Plugin  -> %LOCALAPPDATA%\AVDP Busca Plugin  (instalador /S; mesmo banco)
rem   3. avdp-consulta.exe  -> C:\AVDP Holyrics e aba Arquivos da biblioteca do Holyrics (se existirem)
rem O banco (%APPDATA%\br.avdp.busca) e o banco do modulo (C:\AVDP Holyrics\avdp-mensagens.db) NAO sao trocados.
rem Rode pelo Explorador (dois cliques). Para teste: AVDP_HOLYRICS_DIR, HOLYRICS_FILES, SEM_SETUP e SEM_PAUSA.
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if not defined AVDP_HOLYRICS_DIR set "AVDP_HOLYRICS_DIR=C:\AVDP Holyrics"
if not defined HOLYRICS_FILES set "HOLYRICS_FILES=C:\Holyrics\Holyrics\files\media\file"

echo.
echo  AVDP Busca - atualizacao
echo  ========================
echo  Feche o Holyrics, o AVDP Busca e o AVDP Busca Plugin antes de continuar.
echo.
if not defined SEM_PAUSA pause

set "APP="
set "PLUGIN="
for %%f in ("AVDP Busca_*_x64-setup.exe") do set "APP=%%~f"
for %%f in ("AVDP Busca Plugin_*_x64-setup.exe") do set "PLUGIN=%%~f"
if not defined APP goto faltou
if not defined PLUGIN goto faltou
if not exist "avdp-consulta.exe" goto faltou

echo  [1/3] AVDP Busca...
if defined SEM_SETUP (echo        pulado ^(teste^)) else (
  start "" /wait "%APP%" /S
  if errorlevel 1 goto setup
)
echo  [2/3] AVDP Busca Plugin...
if defined SEM_SETUP (echo        pulado ^(teste^)) else (
  start "" /wait "%PLUGIN%" /S
  if errorlevel 1 goto setup
)

echo  [3/3] avdp-consulta.exe do modulo do Holyrics...
set "ACHOU="
if exist "%AVDP_HOLYRICS_DIR%\" (
  copy /y "avdp-consulta.exe" "%AVDP_HOLYRICS_DIR%\avdp-consulta.exe" >nul || goto ocupado
  echo        %AVDP_HOLYRICS_DIR%
  set "ACHOU=1"
)
if exist "%HOLYRICS_FILES%\" (
  copy /y "avdp-consulta.exe" "%HOLYRICS_FILES%\avdp-consulta.exe" >nul || goto ocupado
  echo        %HOLYRICS_FILES%
  set "ACHOU=1"
)
if not defined ACHOU echo        modulo do Holyrics nao instalado neste computador ^(pulado^)

echo.
echo  Pronto. Bancos, temas, listas e configuracoes ficaram como estavam.
echo.
if not defined SEM_PAUSA pause
exit /b 0

:faltou
echo  Faltam arquivos ao lado deste. Extraia o zip inteiro primeiro: botao direito no zip, "Extrair tudo".
goto erro
:setup
echo  Um instalador falhou. Feche o AVDP Busca e o AVDP Busca Plugin e rode de novo.
goto erro
:ocupado
echo  Erro ao copiar o avdp-consulta.exe. Feche o Holyrics e rode de novo.
:erro
echo.
if not defined SEM_PAUSA pause
exit /b 1
