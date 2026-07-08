#!/bin/zsh
# Doble clic para arrancar el mapa de geozonas de Aguascalientes.
# Levanta un servidor local en el puerto 8000 y abre el navegador.
cd "$(dirname "$0")"

# si ya hay un servidor en el 8000, solo abrir el navegador
if lsof -nP -iTCP:8000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "El servidor ya está corriendo."
else
  echo "Iniciando servidor en http://localhost:8000/web/ ..."
  python3 -m http.server 8000 &
  sleep 1
fi

open "http://localhost:8000/web/"
echo ""
echo "Mapa abierto. Deja esta ventana abierta mientras uses el mapa."
echo "Para detenerlo: cierra esta ventana o presiona Ctrl+C."
wait
