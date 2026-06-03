# LinkedIn Marketing Developer Platform (MDP) — Başvuru Taslağı

> **Hedef:** RanksUp'nin LinkedIn şirket sayfalarına post atabilmesi için **Community Management API** scope'larının (`r_organization_social`, `w_organization_social`, `rw_organization_admin`) onaylanması.

---

## 1. Başvuru nereden yapılır?

1. https://www.linkedin.com/developers/apps adresine git
2. RanksUp app'ini seç (Client ID: `77q0eezx9a74fb`)
3. **Products** sekmesinde **"Community Management API"** kartını bul → **Request access**
4. Form çıkar — aşağıdaki cevapları yapıştır

> Not: Önce **"Share on LinkedIn"** ve **"Sign In with LinkedIn using OpenID Connect"** ürünlerinin aktif olması gerekir (zaten aktif olmalı, kişisel LinkedIn çalışıyor).

---

## 2. Form alanları + örnek cevaplar

### Company / Organization
- **Company name:** Luvihost / RanksUp
- **Company website:** https://ranksup.ai
- **Company size:** 1–10
- **Industry:** Marketing & Advertising Technology (SaaS)
- **Country:** Türkiye

### Application overview

**1. What is the primary purpose of your integration?**
> RanksUp is an AI-driven SEO and content automation platform for Turkish SMBs. We help business owners audit their website's search visibility (Google + AI search engines like ChatGPT, Perplexity), generate brand-aligned long-form articles, and automatically publish content across their owned channels — including their LinkedIn Company Pages. Our LinkedIn integration lets verified Page admins schedule and publish company updates from a unified content calendar, with AI-generated copy that matches their brand voice. We are not a third-party advertising platform; we operate strictly on first-party content posting on behalf of authenticated Page administrators.

**2. Which scopes are you requesting and why?**
> - `r_organization_social` — to read the company's recent post performance so our analytics dashboard can show our customers how their LinkedIn content is performing alongside their other channels (X, Bluesky, GSC data).
> - `w_organization_social` — to publish text and image posts to the customer's LinkedIn Company Page on their behalf, only when they explicitly create or approve content in our calendar.
> - `rw_organization_admin` — to verify that the authenticated user is an actual admin of the Page they are connecting (via `organizationAcls` endpoint), preventing unauthorized page hijacking.

**3. Describe the user flow.**
> 1. A RanksUp customer (already authenticated in our dashboard) navigates to "Bağlantılar" (Connections) → clicks "LinkedIn (Şirket Sayfası)".
> 2. They are redirected to LinkedIn OAuth (`linkedin.com/oauth/v2/authorization`) with the requested scopes.
> 3. After granting consent, LinkedIn redirects back to `https://ranksup.ai/api/social/oauth/callback` with the auth code.
> 4. We exchange the code for an access token (PKCE flow), call `/v2/organizationAcls` to list the Pages the user administers, and present a selector ("Hangi şirket sayfasını yönetmek istiyorsun?").
> 5. The user picks a Page → we store the Page URN (`urn:li:organization:...`) and use it as the `author` field when publishing via `/v2/ugcPosts`.
> 6. Tokens are encrypted at rest with AES-256-GCM. Refresh flow is triggered before token expiry; if refresh fails, the user is asked to re-connect.

**4. Daily request volume estimate**
> - `ugcPosts` (write): ~5–15 posts per customer per week → at 1k customers ≈ **1,500 posts/day** at steady state.
> - `organizationAcls` (read): ~1 call per OAuth handshake + occasional re-verification → **<500 calls/day**.
> - `organizationPageStatistics` (read): 1 call per Page per day for analytics → **<2,000 calls/day**.

**5. Do you store LinkedIn data?**
> We store: the customer's Page URN, the externalName + avatar URL (for display in our UI), the encrypted access token and refresh token, and the post ID + publish timestamp after we successfully publish. We do not store post content beyond what the customer wrote themselves. We do not aggregate or resell any LinkedIn data. Tokens are revocable: when the customer disconnects, we delete the row.

**6. Privacy Policy URL**
> https://ranksup.ai/privacy

**7. Terms of Service URL**
> https://ranksup.ai/terms

**8. Authorized redirect URL (must already be whitelisted in app settings)**
> https://ranksup.ai/api/social/oauth/callback

---

## 3. Başvuruyla birlikte ekstra istenebilecekler

LinkedIn inceleme ekibi bazen şunları ister — hazır tut:

- **Demo video (Loom):** OAuth handshake + Page selector + bir post taslağı yazıp Schedule etme akışını **2-3 dakikada** göster. (Production app'i kullanarak çek, screen recorder ile yeterli.)
- **Production'da çalışan örnek bir Page'in URL'i:** Şu an hangi şirket sayfasını yönetiyorsun? Onun URL'i (örn. `linkedin.com/company/luvihost`) cevap olarak yapıştırılabilir.
- **App icon / logo:** Developer panelinde "App logo" alanı doluysa atla; değilse 100x100 RanksUp logo yükle.

---

## 4. Reddedilme riski + alternatif yol

### Yaygın red sebepleri
- "Use case'i yeterince spesifik değil" → form taslağındaki #1 ve #3 cevaplarını daha **konkre** hale getir (örnek: "Customer X publishes 4 posts/week on their LinkedIn Page about AI-generated content")
- "Privacy Policy'de LinkedIn data handling açıkça anlatılmamış" → privacy sayfasına aşağıdaki **özel paragrafı** ekle (taslak hazır).

### Eğer reddedilirse
- LinkedIn 30 gün sonra yeniden başvuruya izin verir
- Bu sürede form cevaplarını revize et + demo videoyu daha net çek
- 2. denemede onay oranı genelde %85+

---

## 5. Privacy Policy'ye eklemen gereken paragraf

> `ranksup.ai/privacy` sayfasının "Third-party integrations" bölümüne şu paragrafı koy:

```markdown
## LinkedIn entegrasyonu

RanksUp, kullanıcının açık onayıyla LinkedIn kişisel profillerine ve şirket sayfalarına 
post yayınlamak için LinkedIn API'sini kullanır. Yetkilendirme sürecinde aşağıdaki veriler 
LinkedIn tarafından bizimle paylaşılır:

- Hesap adı ve avatar URL'i (panelde kanal etiketi göstermek için)
- Erişim ve yenileme tokenları (AES-256-GCM ile şifreli olarak saklanır)
- Yetkili olduğun şirket sayfalarının ID listesi (sayfa seçimi için)

RanksUp, LinkedIn'den çektiği hiçbir veriyi üçüncü taraflara satmaz, paylaşmaz veya 
analitik amaçla işlemez. Sadece sizin oluşturduğunuz post içeriklerini, sizin seçtiğiniz 
sayfaya, sizin belirlediğiniz zamanda yayınlamak için kullanır.

LinkedIn bağlantınızı istediğiniz an "Bağlantılar" sayfasından kaldırabilirsiniz; 
kaldırıldığında saklanan tüm LinkedIn verileri (token, sayfa URN, kanal kaydı) 
sistemimizden silinir.
```

---

## 6. Onay sonrası tek satırlık fix

LinkedIn onayı geldiğinde tek değişiklik:
[apps/api/src/social/adapters/registry.ts:78](apps/api/src/social/adapters/registry.ts#L78)

```diff
-  status: envKeysReady(['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET']) ? 'review' : 'config',
+  status: envKeysReady(['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET']) ? 'live' : 'config',
```

Sonra build + restart. UI otomatik aktif olur, badge kalkar.

---

## 7. Sıralı yapılacaklar listesi

- [ ] Privacy sayfasına LinkedIn entegrasyon paragrafını ekle
- [ ] Demo Loom videosu çek (OAuth flow + Page selector + post draft)
- [ ] LinkedIn Developer app'ine git → Products → Community Management API → Request access
- [ ] Yukarıdaki form cevaplarını yapıştır
- [ ] 2-6 hafta bekle
- [ ] Onay e-postası gelince registry.ts'de tek satırı `'live'` yap
- [ ] Build + restart
- [ ] UI'da "LinkedIn (Şirket Sayfası)" aktif olur
