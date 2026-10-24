#!/bin/bash
# Web'i KESINTISIZ yayina al (sunucuda calistirilir).
#
# NEDEN: `pnpm build` calisan surumun dosyalarini (.next/standalone/...) silip yeniden yaziyordu;
# build suren 2-3 dakika boyunca site 500 ve "ChunkLoadError" veriyordu (01.09.2026 canli kullanici).
# Burada build AYRI dizine alinir, ancak basarili olursa yer degistirilir; hata olursa calisan
# surume DOKUNULMAZ.
#
# Kullanim (sunucuda): bash scripts/deploy-web.sh
#
# YAYIN SIRASI — fiyat / plan degisikliginde ONCE API, sonra web: /, /pricing, /compare ve
# /ranksup.md plan verisini build aninda ve sonra ISR ile (600 sn) API'nin /billing/plans
# ucundan alir (tek kaynak apps/api/src/billing/plans.ts). Web once yayina alinirsa build
# ESKI fiyati onbellege yazar ve en fazla 10 dk eski fiyat gosterilir.
# Yalniz API yayina alindiysa (web degismediyse) sayfalari hemen yenilemek icin
# (web ortaminda REVALIDATE_SECRET tanimli olmali; yoksa uc 404 doner):
#   curl -fsS -X POST -H "x-revalidate-secret: $REVALIDATE_SECRET" http://localhost:3000/api/revalidate
# API plan vermiyorsa uc 503 doner ve hicbir sey yenilemez. ISR yenilemesinde API cevap vermezse
# sayfalar bos uretilmez; son basarili hali sunulur (apps/web/src/lib/isr-guard.ts).
set -euo pipefail

KOK="${KOK:-/var/www/luviai}"
WEB="$KOK/apps/web"
YENI=".next-yeni"
ESKI=".next-eski"

cd "$WEB"

echo "→ build ($YENI dizinine)"
rm -rf "$YENI"
NEXT_DIST_DIR="$YENI" pnpm build

# Standalone sunucu dosyasi yerinde mi? Yoksa devreye ALMA.
if [ ! -f "$YENI/standalone/apps/web/server.js" ]; then
  echo "HATA: $YENI/standalone/apps/web/server.js yok — devreye alinmadi, calisan surum korundu." >&2
  exit 1
fi

echo "→ devreye alma (yer degistirme)"
rm -rf "$ESKI"
[ -d .next ] && mv .next "$ESKI"
mv "$YENI" .next

echo "→ pm2 restart"
pm2 restart luviai-web --update-env >/dev/null

sleep 8
KOD=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ || echo 000)
echo "→ web: $KOD"
if [ "$KOD" != "200" ]; then
  echo "UYARI: web $KOD dondu; geri almak icin: mv .next .next-bozuk && mv $ESKI .next && pm2 restart luviai-web" >&2
  exit 1
fi

rm -rf "$ESKI"
echo "✓ yayinda"
