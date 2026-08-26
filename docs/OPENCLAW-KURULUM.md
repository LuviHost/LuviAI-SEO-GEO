# OpenClaw ile X taraması — kurulum ve bakım

RanksUp'ın intel boru hattı X kaynaklarını **gerçek bir tarayıcıdan** okur:
sunucuda OpenClaw'ın yönettiği headless Chrome, X'e giriş yapmış oturumla arama
sayfasını açar, postları okur, postlardaki GitHub depolarını da açıp inceler ve
sonucu JSON olarak `IntelCollectorService`'e verir.

Kod: [openclaw.service.ts](../apps/api/src/intel/openclaw.service.ts) →
[collector.service.ts](../apps/api/src/intel/collector.service.ts) `kind: 'x'`

> Bu belge **87.76.142.108** üzerinde fiilen uygulanmış kurulumu anlatır.
> Adımlar sırayla çalıştırılmış ve doğrulanmıştır.

---

## Tasarımın can alıcı noktası: sunucuda X'e giriş YAPMIYORUZ

Datacenter IP'sinden X'e giriş neredeyse her zaman SMS/e-posta doğrulama
duvarına takılır; headless tarayıcıda bunu aşmak mümkün değildir. Doğrulandı:
oturumsuz `x.com/search` yalnızca "Continue with phone" diyaloğunu döndürüyor,
tek bir sonuç bile gelmiyor.

Bunun yerine oturum çerezleri (`auth_token`, `ct0`) **geliştirici Mac'inden**
sunucudaki yönetilen profile yazılır. Sunucu hiçbir zaman parola görmez, giriş
formu doldurmaz.

> **Kabul edilmiş riskler.** Otomatik arama X kullanım koşullarına aykırıdır;
> hesap askıya alınabilir. X periyodik olarak yeniden doğrulama ister, o anda
> çerezler ölür ve sistem xAI yedeğine düşer. Ayrı/ikincil bir X hesabı
> kullanmak makul bir önlemdir.

---

## Kurulmuş durum (özet)

| Ne | Nerede |
| --- | --- |
| Kullanıcı | `openclaw` (uid 1001), linger açık |
| Node | `/home/openclaw/.nvm/.../v24.19.0` — **sistem Node 20'ye dokunulmadı** |
| OpenClaw | 2026.7.1-2, npm global (openclaw kullanıcısının nvm'i) |
| Config | `/home/openclaw/.openclaw/openclaw.json` |
| Model anahtarı | `/home/openclaw/.openclaw/.env` (RanksUp'ın Anthropic anahtarı) |
| Gateway | systemd user unit `openclaw-gateway.service`, `127.0.0.1:18789`, token auth |
| Tarayıcı profili | `openclaw` (yerleşik yönetilen profil), headless |
| root köprüsü | `/usr/local/bin/openclaw-ranksup` |

---

## 1. Kullanıcı ve izole Node

Sistem Node'u **v20.20.2** ve pm2'deki üç üretim süreci onun üzerinde koşuyor.
OpenClaw 22.22.3+ istiyor; sistem Node'unu yükseltmek üçünü birden riske atar.
Bu yüzden ayrı kullanıcı + kendi nvm'i:

```bash
useradd -m -s /bin/bash openclaw
loginctl enable-linger openclaw      # oturum olmadan da servis ayakta kalsın
su - openclaw -c '
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  export NVM_DIR=$HOME/.nvm; . $NVM_DIR/nvm.sh
  nvm install 24
'
```

Chrome zaten kurulu (`/usr/bin/google-chrome`), ayrıca paket gerekmedi.

## 2. OpenClaw kurulumu

`--allow-scripts` **şart**: postinstall scripti yerleşik eklentileri açıyor.

```bash
su - openclaw -c '
  export NVM_DIR=$HOME/.nvm; . $NVM_DIR/nvm.sh
  npm install -g openclaw@latest \
    --allow-scripts=openclaw,@google/genai,protobufjs,tree-sitter-bash
'
```

## 3. Model anahtarı

Daemon altında çalışacağı için `~/.openclaw/.env` içine yazılmalı:

```bash
install -d -o openclaw -g openclaw -m 700 /home/openclaw/.openclaw
printf 'ANTHROPIC_API_KEY=%s\n' "$KEY" > /home/openclaw/.openclaw/.env
chown openclaw:openclaw /home/openclaw/.openclaw/.env
chmod 600 /home/openclaw/.openclaw/.env
```

## 4. Config

`/home/openclaw/.openclaw/openclaw.json` (600, openclaw sahipli):

```json
{
  "agents": {
    "defaults": { "model": "anthropic/claude-sonnet-5", "timeoutSeconds": 420 }
  },
  "browser": { "enabled": true },
  "gateway": {
    "port": 18789,
    "mode": "local",
    "bind": "loopback",
    "auth": { "mode": "token", "token": "<üretilmiş-token>" }
  }
}
```

Şema tuzakları (ikisi de denenip düzeltildi):

- Varsayılan model `models.default` **değil**, `agents.defaults.model`.
- `openclaw config patch` argümanı kabuktan geçerken bozuluyor; config dosyasını
  doğrudan yazıp `openclaw config validate` ile doğrulamak daha güvenilir.

## 5. Plugin registry'sini tazele — atlanırsa browser çalışmaz

İlk çalıştırmada `installed_plugin_index` "migration" gerekçesiyle yalnızca 33
sağlayıcı eklentisiyle oluşuyor ve **browser eklentisi dışarıda kalıyor**.
Belirti: `openclaw browser` → "OpenClaw does not know the command".

```bash
su - openclaw -c 'export NVM_DIR=$HOME/.nvm; . $NVM_DIR/nvm.sh
  openclaw plugins registry --refresh'      # → 49/67 enabled plugins indexed
```

(`registry rebuild` diye bir alt komut yok; `--refresh` bir bayrak.)

## 6. Gateway daemon

```bash
su - openclaw -c 'export NVM_DIR=$HOME/.nvm; . $NVM_DIR/nvm.sh
  openclaw daemon install && openclaw daemon start && openclaw gateway health'
```

Daemon sistem Node 20'yi reddedip izole Node 24'ü seçtiğini kendisi bildiriyor.
`openclaw daemon status`, nvm yolundan Node kullandığı için "version manager"
uyarısı verir — nvm sürümü değişirse unit'in yolu güncellenmeli.

## 7. Tarayıcı

Gateway üzerinden **kalıcı profil oluşturulamıyor** ("cannot mutate persistent
browser profiles"), o yüzden yerleşik `openclaw` profili kullanılıyor.
`DISPLAY` olmadığı için otomatik headless başlıyor.

```bash
su - openclaw -c 'export NVM_DIR=$HOME/.nvm; . $NVM_DIR/nvm.sh
  openclaw browser --browser-profile openclaw start
  openclaw browser --browser-profile openclaw open https://example.com
  openclaw browser --browser-profile openclaw snapshot'
```

## 8. X oturumunu Mac'ten aktar

Mac'te Chrome'da X oturumu açıkken, **repo kökünden**:

```bash
node scripts/x-oturum-aktar.mjs
```

- macOS Keychain izin penceresi çıkar → **Allow**.
- Yalnızca `auth_token` ve `ct0` çıkarılır; değerler ekrana basılmaz, diske
  yazılmaz, yalnızca SSH üzerinden sunucuya aktarılır.
- Script sonunda sunucuda X aramasını açıp snapshot alır ve "oturum açık" mı
  "hâlâ giriş ekranı" mı olduğunu söyler.

Ortam değişkenleriyle hedef değiştirilebilir: `OPENCLAW_HOST`,
`OPENCLAW_PROFILE`, `CHROME_PROFILE`.

## 9. RanksUp'ı bağla

RanksUp API root olarak koşuyor, OpenClaw ise `openclaw` kullanıcısında.
Köprü `/usr/local/bin/openclaw-ranksup`:

```bash
#!/bin/bash
exec sudo -u openclaw -H bash -lc 'export NVM_DIR=$HOME/.nvm; . "$NVM_DIR/nvm.sh"; exec openclaw "$@"' _ "$@"
```

Sunucudaki `/var/www/luviai/.env`:

```bash
OPENCLAW_ENABLED=1
OPENCLAW_BIN=/usr/local/bin/openclaw-ranksup
OPENCLAW_TIMEOUT_SEC=420
# Gateway aynı makinede ve config'den okunuyor; ikisi de boş kalabilir:
OPENCLAW_GATEWAY_URL=
OPENCLAW_TOKEN=
```

Sonra `pm2 restart luviai-api`. `/admin/intel` üstünde **"X tarayıcı açık
(OpenClaw)"** yazmalı; toplanan kayıtlarda `meta.via = openclaw-browser` olmalı.

---

## İki sekme birden taranır

X'in iki arama sekmesi ayrı işler görür, servis ikisini de sırayla tarar
(tek Chrome var, paralel tur olmaz) ve sonuçları URL'e göre tekilleştirir:

| Sekme | `f=` | Pencere | Ne getirir |
| --- | --- | --- | --- |
| En Son | `live` | 2 gün | Platform değişikliği, yeni ölçüm, anlık tartışma |
| Popüler | `top` | 180 gün | Araç duyuruları, açık kaynak çıkışları, referans threadler |

180 gün bilinçli: Popüler sekmesindeki bir araç duyurusu aylarca referans
kalır. Önce 90 gün denendi ve **yetmedi** — hedef örnek alınan "açık kaynak
GEO-SEO aracı" postu 124 günlüktü ve eleniyordu.

## Doğrulanmış uçtan uca testler

**1) En Son sekmesi** — `llms.txt OR GPTBot OR ClaudeBot OR "AI crawler" robots.txt`

- 152 saniye, ~13.6k çıktı token, `claude-sonnet-5`
- **12 post**, hepsi servisin URL filtresinden geçti
- Uydurma değil: dönen status ID'leri ham tarayıcı snapshot'ında da vardı
- Ayrıca root → wrapper yolundan tekrarlandı: 3 post, geçerli JSON

**2) Popüler sekmesi + depo inceleme** — `geo seo`, 180 gün

- 266 saniye, **15 post + 3 depo**
- Depolar gerçek meta veriyle döndü: `zubair-trabzada/geo-seo-claude`
  (9.347 yıldız, commit 2026-08-14), `mverab/eGEOagents` (158, 2026-08-12),
  `aaron-he-zhu/seo-geo-claude-skills` (151, 2026-07-13)
- 124 günlük hedef post yakalandı → 180 günlük pencere doğrulandı

**3) Üretim kod yolu** — deploy sonrası, derlenmiş `dist/intel/openclaw.service.js`
doğrudan çağrıldı (spawn → wrapper → gateway → tarayıcı → parse):

```
OpenClaw [En Son]  … → 3 kayit (2 post, 1 depo)     ~237 sn
OpenClaw [Populer] … → 6 kayit (3 post, 3 depo)     ~348 sn
TOPLAM 8 kayit (tekillestirme sonrasi), 585 sn
```

Depolar: `letterstory/lettertrace` (41★), `zubair-trabzada/geo-seo-claude`
(9.347★), `nowork-studio/notfair-plugin` (3.357★).

### Süre bütçesi

Sorgu başına iki sekme ≈ **10 dakika** (Popüler sekmesi depo incelemesi
yüzünden daha uzun, ~350 sn — `OPENCLAW_TIMEOUT_SEC=420` sınırına yakın).
8 X sorgusu × günde 1 tur ≈ **80 dakika tarayıcı zamanı/gün**.

Toplama cron'u 3 saatte bir çalışır, kaynakların `intervalHours` değeri 24
olduğu için her sorgu günde bir kez döner. `acquireCronLock` turların üst üste
binmesini engeller. Süre sıkışırsa `MAX_REPOS` düşürülmeli — depo incelemesi
en pahalı adım.

## `openclaw agent` çağrısının iki tuzağı

Servis bu ikisine göre yazıldı; elle çağırırken de geçerli:

1. **Oturum seçici zorunlu.** Seçicisiz çağrı `No target session selected` ile
   anında düşer. Servis `OPENCLAW_AGENT` boşsa her tur için yeni bir
   `--session-key` üretir (sabit anahtar oturumu büyütür: ajan önceki
   taramaların tam metnini bağlamında taşır, maliyet her gün artar).
2. **Zarf şekli.** `openclaw agent --json` metni `result.payloads[].text`
   içinde döndürür. Dokümandaki düz `final` alanı `openclaw agent exec`'e
   aittir — ikisi farklı komut, farklı zarf.

Yan etki: her tur `~/.openclaw/agents/main/sessions/` altına bir `.jsonl`
bırakır (5 sorgu/gün ≈ 5 dosya/gün). Periyodik temizlik:

```bash
find /home/openclaw/.openclaw/agents/main/sessions -name '*.jsonl' -mtime +30 -delete
```

## Davranış ve sınırlar

- **Yedekli.** OpenClaw boş dönerse (tarayıcı hatası, oturum düşmesi) collector
  otomatik olarak xAI Live Search yoluna düşer. İkisi de kapalıysa X kaynakları
  sessizce atlanır; boru hattının geri kalanı çalışır.
- **Kaynak devre dışı bırakılmaz.** OpenClaw hataları `runAgent` içinde yutulur;
  geçici tarayıcı arızası X kaynaklarını kalıcı kapatmasın diye.
- **Sınırlar.** Sekme başına en fazla 15 post ve 3 depo. Pencere sekmeye göre
  2 / 180 gün. Hepsi `openclaw.service.ts` başındaki `MODES`, `MAX_POSTS`,
  `MAX_REPOS` sabitlerinde.
- **xAI yolu ölü.** Sunucudaki 5 X kaynağı 2026-08-13'ten beri
  `xAI HTTP 410: Live search is deprecated` veriyor, hiç kayıt toplanmamıştı.
  Yani OpenClaw yedek değil, tek çalışan yol. `XSearchService` yerinde
  bırakıldı; `x_search` + `grok-4.6` API'sine taşınırsa gerçek yedek olur.
- **Depolar ayrı bulgu.** Keşfedilen GitHub deposu kendi `IntelItem` kaydı olur
  (`meta.kind = 'repo'`), triage/analyst zincirinden bağımsız geçer.
- **Kaynak tüketimi.** Headless Chrome ~15 süreç. Ölçüm sırasında 15 GB'ın
  11 GB'ı boştaydı.

## Sorun giderme

| Belirti | Bakılacak yer |
| --- | --- |
| `openclaw browser` bilinmeyen komut | `openclaw plugins registry --refresh` (adım 5) |
| `GatewayCredentialsRequiredError` | `gateway.auth` yok veya daemon kapalı |
| Snapshot'ta "Continue with phone" | Çerezler düşmüş → adım 8'i tekrarla |
| `BrowserProfileNotFoundError` | Profil adı `openclaw` olmalı, `ranksup` değil |
| `OpenClaw calistirilamadi` | `OPENCLAW_BIN` yolu / wrapper izinleri (755) |
| Tur `timeout` dönüyor | `OPENCLAW_TIMEOUT_SEC` artır veya `MAX_REPOS` düşür |
| `models: Invalid input` | Model `agents.defaults.model` altına yazılmalı |
| `No target session selected` | `--session-key` veya `--agent` geçilmemiş |
| Ajan çalışıyor ama sonuç boş | Zarf `result.payloads[].text`, `final` değil |

## Bakım

- Oturum ~aylık yeniden doğrulama isteyebilir → adım 8'i tekrar çalıştırın.
- `openclaw browser --browser-profile openclaw doctor --deep` sağlık kontrolü.
- nvm Node sürümü değişirse `openclaw daemon install` ile unit'i yenileyin.
- Bellek darsa `MAX_POSTS`/`MAX_REPOS` düşürün veya `intervalHours` artırın.

---

## 10. X kürasyonu — yer işaretleri kaynak kutusu (LLM yok)

Kullanıcı SEO/GEO gönderilerini X'te **Yer İşaretleri**'ne ekler
("ranksup.ai" klasörü). Hedef `https://x.com/i/bookmarks#folder=ranksup.ai`: klasör URL'si (`/i/history/bookmarks/<id>`) soğuk yüklemede "Bir hata oluştu" veriyor, servis sayfayı açıp "Yer İşaretleri" sekmesine ve adı eşleşen klasöre tıklıyor.
`apps/api/src/intel/x-curation.service.ts` o sayfayı **aynı OpenClaw
tarayıcısında** açar, gönderileri ve içlerindeki linkleri toplar,
`IntelCollectorService`'e verir. `openclaw agent` (model çağrısı)
**kullanılmaz** — yalnızca `openclaw browser open / evaluate / close`; maliyet sıfır.

> **DM neden değil:** 27.08.2026'da denendi. X'in yeni XChat'i uçtan uca şifreli;
> çerez senkronuyla açılan oturumda sohbet "Disconnected / mesajlarınız yüklenemedi"
> kalıyor — şifreleme anahtarları kullanıcının cihazında. Yer işaretleri sayfası
> şifresiz, aynı oturumla ilk denemede okundu (3 gönderi + t.co linkleri).

- Kaynak: `source-registry.ts` → `x-curated` (kind `x-curation`, target = sayfa URL'leri,
  virgülle çoklu; panelden `targetOverride` ile değiştirilebilir). Günde 1 kez.
- Atıf: gönderi kaynak değil, **keşif kanalı**. İşaret ettiği makale kendi
  yayıncısına yazılır (`meta.attributeTo` → katalogdaki RSS kaynağı, host eşlemesi
  `x-curation-links.ts`). İki-kaynak kuralı bozulmaz; katalogda olmayan
  yayıncılar `x-curated` kovasında (community, ağırlık 30) kalır.
- t.co linkleri yönlendirme takibiyle çözülür; gönderiler `api.fxtwitter.com`
  (anahtarsız) ile açılır, içindeki linkler alınır; link yoksa gönderi kendisi kayıt olur.
- Ayrı bayrak: `OPENCLAW_X_CURATION_ENABLED=1` (`OPENCLAW_ENABLED`'dan bağımsız).
  `OPENCLAW_BIN` aynı köprü.
- Oturum düşmüşse (giriş duvarı) toplayıcı **açık hata** verir; kaynak kartında
  `lastError: "X oturumu yok — ..."` görünür. Ardışık hatalarda kaynak kendini
  kapatır; oturum tazelenince panelden aç.
- Gürültü: yer işaretlerindeki SEO dışı gönderiler de toplanır; triage (ucuz eleme)
  ilgisizleri eler. Daha temiz akış için Premium yer-işareti klasörü kullanılabilir.

> **Risk notu:** otomasyonla okumak X koşullarına aykırıdır; günde tek sayfa
> yüklemesi arama taramasından çok daha düşük hacimdir ama hesap askıya alınabilir.
