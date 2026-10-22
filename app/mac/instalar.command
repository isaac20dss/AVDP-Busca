#!/bin/bash
# AVDP Busca (Mac): coloca o banco de dados no lugar e instala o app em Aplicativos.
# O banco que já existir neste Mac vai para uma pasta de backup (nada é apagado).
# Equivalente ao INSTALAR.cmd do Windows.
cd "$(dirname "$0")" || exit 1
DADOS="$HOME/Library/Application Support/br.avdp.busca"
APP="/Applications/AVDP Busca.app"

echo
echo " AVDP Busca - instalação com o banco de dados"
echo " ============================================"
echo

pausa() { echo; read -r -p " Aperte Enter para fechar." _; }

if [ ! -f "banco/avdp.db" ]; then
  echo " Não achei \"banco/avdp.db\" ao lado deste arquivo."
  echo " Extraia o zip inteiro primeiro (dois cliques no zip)."
  pausa; exit 1
fi

# instalador: o .dmg certo para o processador deste Mac (Apple Silicon = aarch64, Intel = x64)
case "$(uname -m)" in
  arm64) DMG=$(ls AVDP\ Busca_*_aarch64.dmg 2>/dev/null | head -1) ;;
  *)     DMG=$(ls AVDP\ Busca_*_x64.dmg 2>/dev/null | head -1) ;;
esac
if [ -z "$DMG" ]; then
  echo " Não achei o instalador \"AVDP Busca_..._$( [ "$(uname -m)" = arm64 ] && echo aarch64 || echo x64 ).dmg\" ao lado deste arquivo."
  pausa; exit 1
fi

while pgrep -f "AVDP Busca.app/Contents/MacOS" >/dev/null; do
  echo " O AVDP Busca está aberto. Feche o programa (Cmd+Q) e aperte Enter."
  read -r _
done

mkdir -p "$DADOS"

# banco antigo (ou sobra de -wal/-shm, que estragaria o banco novo): vai para o backup
if [ -e "$DADOS/avdp.db" ] || [ -e "$DADOS/avdp.db-wal" ] || [ -e "$DADOS/avdp.db-shm" ]; then
  BK="$DADOS/backup-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$BK"
  echo " Já havia um banco aqui: guardado em $BK"
  for f in avdp.db avdp.db-wal avdp.db-shm; do
    [ -e "$DADOS/$f" ] && mv "$DADOS/$f" "$BK/"
  done
  [ -d "$DADOS/fundos" ] && cp -R "$DADOS/fundos" "$BK/fundos"
fi

echo " Copiando o banco de dados..."
if ! cp "banco/avdp.db" "$DADOS/avdp.db"; then
  echo " Erro ao copiar o banco. Nada mais foi feito."
  pausa; exit 1
fi
if [ -d "banco/fundos" ]; then
  mkdir -p "$DADOS/fundos"
  cp -R banco/fundos/. "$DADOS/fundos/"
fi
echo " Banco copiado para $DADOS"
echo

echo " Instalando o app em Aplicativos..."
VOL=$(hdiutil attach -nobrowse -noautoopen "$DMG" | awk -F'\t' '/\/Volumes\//{print $NF; exit}')
if [ -z "$VOL" ] || [ ! -d "$VOL/AVDP Busca.app" ]; then
  echo " Não consegui abrir o $DMG. Abra o .dmg e arraste o AVDP Busca para Aplicativos."
  [ -n "$VOL" ] && hdiutil detach -quiet "$VOL"
  pausa; exit 1
fi
rm -rf "$APP"
cp -R "$VOL/AVDP Busca.app" /Applications/
hdiutil detach -quiet "$VOL"
# app sem certificado da Apple: tira a marca de "baixado da internet" para o Mac não bloquear
xattr -dr com.apple.quarantine "$APP" 2>/dev/null

echo
echo " Pronto. Abra o AVDP Busca pela pasta Aplicativos ou pelo Launchpad."
pausa
exit 0
