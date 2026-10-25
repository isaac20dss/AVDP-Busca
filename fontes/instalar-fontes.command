#!/bin/sh
# Mac: instala as fontes dos temas do AVDP Busca para o usuário atual
cd "$(dirname "$0")" || exit 1
mkdir -p "$HOME/Library/Fonts"
cp -f ./*.ttf "$HOME/Library/Fonts/" && echo "Fontes instaladas em ~/Library/Fonts."
