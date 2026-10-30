/**
 * Site durumu YALNIZ ILERI gider — tarama ve beyin uretimi geri dusuremez.
 *
 * NEDEN VAR: runAudit her taramada kosulsuz 'AUDIT_COMPLETE', beyin uretimi
 * kosulsuz 'AUDIT_PENDING' yaziyordu. ACTIVE durumunu yalniz kurulum zinciri
 * (worker ONBOARDING_CHAIN sonu) ve kurulum "Kaydet"i (completeOnboarding)
 * yaziyor. Gunluk GSC sira kaydi, haftalik rapor e-postasi, icerik firsatlari,
 * urun radari, haftalik plan gibi isler YALNIZ status='ACTIVE' siteleri seciyor.
 * Sonuc: kurulumu bitmis bir site kullanici "Yeniden tara" dedigi (ya da beyin
 * yeniden uretildigi) anda bu islerin hepsinden sessizce dusuyordu.
 *
 * Kural:
 *  - Tarama yalniz ONBOARDING / AUDIT_PENDING'i AUDIT_COMPLETE'e ilerletir.
 *  - Beyin uretimi yalniz ONBOARDING'i AUDIT_PENDING'e ilerletir (zincirde
 *    beyin ve tarama paralel kosar; tarama once biterse beyin onu
 *    AUDIT_PENDING'e geri cekmemeli).
 *  - ACTIVE / PAUSED / AUDIT_COMPLETE (beyin icin) dokunulmaz.
 *  - ERROR de dokunulmaz: bu durumu yazan otomatik bir yol yok, yalniz elle
 *    (yonetici) verilir. Basarili bir tarama sitenin kurulumu bittigini
 *    kanitlamaz; ERROR'dan cikis bilincli bir karar olmali, taramanin yan
 *    etkisi degil.
 *
 * Kosul guncellemenin WHERE'inde (updateMany) — once okuyup sonra yazmak
 * zincirin son ACTIVE yazimiyla yarisirdi.
 */
export const AUDIT_ADVANCES_FROM = ['ONBOARDING', 'AUDIT_PENDING'] as const;
export const BRAIN_ADVANCES_FROM = ['ONBOARDING'] as const;
