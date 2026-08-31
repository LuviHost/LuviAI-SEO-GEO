#!/bin/bash
# LinkedIn otomasyon tarayicisini hazirla: gateway'i tazele, Chrome'u baslat, PENCEREYI GIZLE.
#
# NEDEN gizleme: tarama Mac'te kosmak zorunda (LinkedIn veri merkezi IP'sini 429 + yonlendirme
# donguSuyle kesiyor, 29.08.2026). Gorunur pencere kullaniciyi rahatsiz ediyordu; headless ise
# LinkedIn tarafindan tespit edilebilir. macOS "uygulamayi gizle" (Cmd+H esdegeri) ikisini de cozer:
# tarayici normal calisir, pencere ekranda gorunmez, CDP komutlari pencereyi one getirmez.
#
# Kullanim:  scripts/linkedin-tarayici.sh [gizle|goster|durum]
set -euo pipefail
export PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:$PATH
KOMUT="${1:-gizle}"

# NEDEN Helper elenir: yardimci surecler de ayni user-data-dir ile calisiyor; AppleScript yalniz
# ANA uygulama surecini taniyor ("Can't get process ... Invalid index" hatasi buradan geliyordu).
chrome_pid() {
  # NEDEN pgrep + tur suzgeci: `ps | grep <desen>` ciktisina GREP/AWK SURECININ KENDISI dusuyordu
  # (donen pid AppleScript'te "Invalid index" veriyordu); comm alani da bosluk icerdigi icin awk ile
  # bolunuyordu. pgrep kendi surecini listelemez; `--type=` iceren satirlar renderer/helper alt sureclerdir.
  local pid args
  for pid in $(pgrep -f -- "--user-data-dir=$HOME/.openclaw/browser/openclaw" 2>/dev/null); do
    args=$(ps -o args= -p "$pid" 2>/dev/null)
    case "$args" in *"--type="*) continue;; esac
    case "$args" in *"MacOS/Google Chrome"*) echo "$pid"; return 0;; esac
  done
  return 1
}


gizle() {
  local pid; pid=$(chrome_pid)
  [ -z "$pid" ] && { echo "openclaw Chrome calismiyor"; return 1; }
  osascript -e "tell application \"System Events\" to set visible of (first process whose unix id is $pid) to false" >/dev/null
  echo "tarayici gizlendi (pid $pid)"
}

case "$KOMUT" in
  gizle)
    # Gateway uzun calisinca yavasliyor (21 saat sonra tek komut 25 sn) → tazele
    launchctl kickstart -k gui/"$(id -u)"/ai.openclaw.gateway >/dev/null 2>&1 || true
    sleep 6
    openclaw browser start --json >/dev/null 2>&1 || true
    sleep 3
    # NEDEN once oturum kontrolu, sonra gizleme: tarayici komutu (CDP baglantisi) pencereyi
    # one getiriyor — gizleme en son adim olmali
    openclaw browser evaluate --fn '() => document.title' 2>/dev/null | head -c 120; echo
    # Mac uyursa tarama durur
    pgrep -f "caffeinate -i -s" >/dev/null || { caffeinate -i -s & disown; echo "caffeinate acildi"; }
    sleep 1
    gizle
    ;;
  goster)
    pid=$(chrome_pid); [ -z "$pid" ] && { echo "calismiyor"; exit 1; }
    osascript -e "tell application \"System Events\" to set visible of (first process whose unix id is $pid) to true" >/dev/null
    echo "tarayici goruntulendi (pid $pid)"
    ;;
  durum)
    pid=$(chrome_pid)
    if [ -z "$pid" ]; then echo "Chrome: kapali"; else
      echo "Chrome: pid $pid · gorunur=$(osascript -e "tell application \"System Events\" to get visible of (first process whose unix id is $pid)")"
    fi
    pgrep -f "ssh.*-R 127.0.0.1:18790" >/dev/null && echo "tunel: acik" || echo "tunel: KAPALI"
    pgrep -f "caffeinate -i -s" >/dev/null && echo "caffeinate: acik" || echo "caffeinate: kapali"
    ;;
  *) echo "kullanim: $0 [gizle|goster|durum]"; exit 2;;
esac
