# E-posta gönderen alan adını ranksup.ai'ye taşıma

## Durum

Müşteriye giden bütün mailler **`noreply@ai.luvihost.com`** adresinden gidiyor.

Koddaki varsayılan zaten doğru (`RanksUp <noreply@ranksup.ai>` — `email.service.ts`),
ama sunucudaki `.env` içindeki `EMAIL_FROM` bunu eziyor.

## Neden tek satırda değiştirilmedi

Resend, gönderen alan adının **doğrulanmış** olmasını şart koşuyor. 14 Ağustos 2026'da
DNS ölçüldü:

| Kayıt | `ai.luvihost.com` | `ranksup.ai` |
|---|---|---|
| `resend._domainkey` (DKIM) | var | **yok** |
| `send.` MX (Amazon SES) | var | **yok** |
| SPF | Resend'e ait | Namecheap mail yönlendirme |

`EMAIL_FROM` şimdi değiştirilirse Resend **her maili reddeder** — hoş geldin,
makale hazır, ödeme başarısız, haftalık rapor, hepsi düşer. Bu yüzden kod
tarafı hazırlandı, geçiş tek env değişikliğine indirildi, ama anahtar
çevrilmedi.

## Yapılması gerekenler

### 1. Resend'de alan adını ekle

Resend paneli → **Domains** → **Add Domain**.

**Alt alan adı öner:** `mail.ranksup.ai` (veya `send.ranksup.ai`).

Gerekçe: `ranksup.ai` kök alanının SPF kaydı şu anda Namecheap mail
yönlendirmesine ait (`include:spf.efwd.registrar-servers.com`). Kök alanı
kullanmak için o SPF'i Resend'inkiyle **birleştirmek** gerekir; bir alan adında
birden fazla SPF kaydı olamaz, yanlış birleştirme gelen mail yönlendirmesini de
bozar. Alt alan adı bu riski tamamen ortadan kaldırır ve gönderim itibarını
kök alandan ayırır.

Kök alanı (`noreply@ranksup.ai`) kullanmakta ısrar edilirse SPF şuna
dönüştürülmeli — mevcut kayıt silinmeden, `include` eklenerek:

```
v=spf1 include:spf.efwd.registrar-servers.com include:amazonses.com ~all
```

### 2. DNS kayıtlarını ekle

Resend üç kayıt verecek (Namecheap → Advanced DNS):

| Tür | Host | Değer |
|---|---|---|
| TXT | `resend._domainkey.mail` | Resend'in verdiği uzun anahtar |
| MX | `send.mail` | `feedback-smtp.<bölge>.amazonses.com` (öncelik 10) |
| TXT | `send.mail` | `v=spf1 include:amazonses.com ~all` |

Yayılma genelde 15 dakika – 1 saat. Resend panelinde durum **Verified** olana
kadar bekle.

### 3. Sunucudaki .env'i değiştir

```bash
ssh luvi
nano /var/www/luviai/.env
# EMAIL_FROM=noreply@ai.luvihost.com
# yerine:
# EMAIL_FROM=RanksUp <bildirim@mail.ranksup.ai>
pm2 restart luviai-api luviai-worker --update-env
```

Görünen ad ("RanksUp") **açık yazılmalı** — yoksa gelen kutusunda yalnızca
e-posta adresi görünür.

### 4. Doğrula

Açılış logunda şu satır görünmeli:

```
[EmailService] E-posta gonderen: RanksUp <bildirim@mail.ranksup.ai>
```

Alan adı `ranksup.ai` ile bitmiyorsa servis açılışta **uyarı** basar:

```
[EmailService] E-posta gonderen alan adi marka disi: "..."
```

Bu uyarı bilerek eklendi: eski sapma tam olarak sessiz olduğu için aylarca
fark edilmedi.

Sonra tek bir gerçek mail gönderip Resend panelinden teslim edildiğini
doğrula. Test için en zararsızı `welcome_day7` — hiçbir yan etkisi yok.

## Geri alma

`EMAIL_FROM` değerini `noreply@ai.luvihost.com` yapıp servisleri yeniden
başlatmak yeterli. Eski alan adı doğrulanmış durumda kaldığı sürece anında
çalışır.

## İlgili dosyalar

- `apps/api/src/email/email.service.ts` — gönderen seçimi ve uyarı
- `apps/api/src/email/email-layout.ts` — mail düzeni ve marka paleti
- `apps/api/src/email/email-template.spec.ts` — marka ve istemci uyumluluğu testleri
