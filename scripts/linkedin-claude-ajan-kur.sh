#!/bin/bash
# RanksUp — LinkedIn "Claude ile gönder" Mac ajanını kurar / günceller (launchd, oturum açılınca başlar).
# Kullanım: bash scripts/linkedin-claude-ajan-kur.sh
# Anahtar sonra da yazılabilir: panelde "Mac anahtarı oluştur"un verdiği komut ~/.ranksup/linkedin-claude.key
# dosyasını yazar; ajan her istekte dosyayı yeniden okur, yeniden başlatmak gerekmez.
set -euo pipefail
DIZIN="$HOME/.ranksup"
ETIKET="ai.ranksup.linkedin-claude"
PLIST="$HOME/Library/LaunchAgents/$ETIKET.plist"
KAYNAK="$(cd "$(dirname "$0")" && pwd)/linkedin-claude-ajan.mjs"

NODE_BIN="$(command -v node || true)"
CLAUDE_BIN="$(command -v claude || true)"
[ -n "$NODE_BIN" ] || { echo "node bulunamadı"; exit 1; }
[ -n "$CLAUDE_BIN" ] || { echo "claude (Claude Code) bulunamadı"; exit 1; }

mkdir -p "$DIZIN" "$HOME/Library/Logs/ranksup" "$HOME/Library/LaunchAgents"
cp "$KAYNAK" "$DIZIN/linkedin-claude-ajan.mjs"
[ -f "$DIZIN/linkedin-claude.key" ] && chmod 600 "$DIZIN/linkedin-claude.key"
[ -s "$DIZIN/linkedin-claude.key" ] || echo "Not: anahtar henüz yok — paneldeki 'Mac anahtarı oluştur' komutunu çalıştırınca ajan kendiliğinden bağlanır."

cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$ETIKET</string>
  <key>ProgramArguments</key>
  <array><string>$NODE_BIN</string><string>$DIZIN/linkedin-claude-ajan.mjs</string></array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CLAUDE_BIN</key><string>$CLAUDE_BIN</string>
    <key>PATH</key><string>$(dirname "$CLAUDE_BIN"):$(dirname "$NODE_BIN"):/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>/dev/null</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/ranksup/linkedin-claude.err.log</string>
</dict>
</plist>
PL

launchctl bootout "gui/$(id -u)/$ETIKET" 2>/dev/null || true
# NEDEN bekleme: bootout eski sureci kapatmadan bootstrap gelirse "Bootstrap failed: 5: Input/output error"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  launchctl print "gui/$(id -u)/$ETIKET" >/dev/null 2>&1 || break
  sleep 1
done
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Kuruldu. Kayıt: ~/Library/Logs/ranksup/linkedin-claude.log"
sleep 3
tail -n 3 "$HOME/Library/Logs/ranksup/linkedin-claude.log" 2>/dev/null || true
