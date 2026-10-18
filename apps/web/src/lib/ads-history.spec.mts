/**
 * Ads otopilot gecmisi: basarisiz duraklatma "duraklatildi" diye yazilmaz.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { describe, expect, it } from 'vitest';
import { abPausedAdsText, abTestDetail, abTestGroupLabel, abWinnerRateLabel, historyReasonLabel } from './ads-history';

describe('abTestDetail', () => {
  it('kismi basari: onaylanan ve duraklatilamayan ayri', () => {
    expect(abTestDetail({ action: 'ab-test-winner', pausedCount: 2, failedCount: 1 })).toBe('2 varyant duraklatıldı, 1 varyant duraklatılamadı');
    expect(abTestDetail({ action: 'ab-test-winner', pausedCount: 3, failedCount: 0 })).toBe('3 varyant duraklatıldı');
  });

  it('hicbiri duraklatilamadi', () => {
    expect(abTestDetail({ action: 'ab-test-pause-failed', failedCount: 3 })).toBe('3 varyant duraklatılamadı');
    expect(abTestDetail({ action: 'ab-test-pause-failed' })).toBe('Diğer varyantlar duraklatılamadı');
  });

  it('failedCount tasimayan kayit (eski surum onaysiz yaziyordu) "duraklatildi" demez', () => {
    const t = abTestDetail({ action: 'ab-test-winner', pausedCount: 2 });
    expect(t).toBe('2 varyant duraklatılmak üzere seçildi');
    expect(t).not.toMatch(/duraklatıldı/);
  });

  it('A/B disi kayit icin metin yok', () => {
    expect(abTestDetail({ action: 'budget-up' })).toBeNull();
    expect(abTestDetail({ action: 'ab-test-winner', pausedCount: 0, failedCount: 0 })).toBeNull();
  });
});

describe('S10: grup basina A/B kaydi (reklam grubu / reklam seti)', () => {
  it('yeni kayit hangi grupta oldugunu soyler; Google reklam grubu, Meta reklam seti; ad yoksa kimlik', () => {
    expect(abTestDetail({ action: 'ab-test-winner', groupId: '2', groupName: 'Marka', pausedCount: 1, failedCount: 0 }, 'google_ads'))
      .toBe('Reklam grubu “Marka”: 1 varyant duraklatıldı');
    expect(abTestDetail({ action: 'ab-test-pause-failed', groupId: '71', groupName: 'Trafik', failedCount: 2 }, 'meta_ads'))
      .toBe('Reklam seti “Trafik”: 2 varyant duraklatılamadı');
    expect(abTestGroupLabel({ groupId: '71' }, 'meta_ads')).toBe('Reklam seti 71');
    // Eski kayit (groupId yok): grup uydurulmaz
    expect(abTestGroupLabel({ groupName: 'X' }, 'google_ads')).toBeNull();
    expect(abTestDetail({ action: 'ab-test-winner', pausedCount: 2, failedCount: 0 }, 'google_ads')).toBe('2 varyant duraklatıldı');
  });

  it('sonucu bilinmeyen istek "duraklatılamadı" denmez, dogrulanamadigi soylenir', () => {
    const t = abTestDetail({ action: 'ab-test-winner', groupId: '2', pausedCount: 0, failedCount: 0, uncertainCount: 1 }, 'google_ads');
    expect(t).toBe('Reklam grubu 2: 1 varyantın duraklatılıp duraklatılmadığı doğrulanamadı, reklam hesabında kontrol et');
    expect(t).not.toMatch(/duraklatılamadı|duraklatıldı/);
  });

  it('kazanan oran etiketi: yeni Meta kaydi baglanti tiklama orani, digerleri tiklama orani', () => {
    expect(abWinnerRateLabel({ groupId: '71' }, 'meta_ads')).toBe('Kazanan bağlantı tıklama oranı');
    expect(abWinnerRateLabel({}, 'meta_ads')).toBe('Kazanan tıklama oranı');
    expect(abWinnerRateLabel({ groupId: '2' }, 'google_ads')).toBe('Kazanan tıklama oranı');
  });

  it('duraklatilan reklam kimlikleri (musteri bulup yeniden acabilsin); gecersiz kimlik gosterilmez', () => {
    expect(abPausedAdsText({ pausedAdIds: ['22'] })).toBe('Duraklatılan reklamın kimliği: 22');
    expect(abPausedAdsText({ pausedAdIds: ['22', '33', '<b>'] })).toBe('Duraklatılan reklamların kimlikleri: 22, 33');
    expect(abPausedAdsText({})).toBeNull();
    expect(abPausedAdsText({ pausedAdIds: [] })).toBeNull();
  });
});

describe('S10 yan etkisi: kesilmis kimlik listesi ve ozet kayit (api ab-test-manager pausedIdsFields / abSummaryEntry)', () => {
  const kimlikler = (n: number, bas = 9001) => Array.from({ length: n }, (_, i) => String(bas + i));

  it('kesilmis liste "ilk N" diye gosterilir, tam liste gibi "kimlikleri" denmez (pausedAdIdsTotal)', () => {
    // Meta reklam setinde 12 kaybeden: kayit ilk 10 kimligi ve toplami tasir
    const t = abPausedAdsText({ pausedAdIds: kimlikler(10), pausedAdIdsTotal: 12 });
    expect(t).toBe(`Duraklatılan 12 reklamın ilk 10 kimliği: ${kimlikler(10).join(', ')}`);
    expect(t).not.toMatch(/kimlikleri:/);
  });

  it('pausedAdIdsTruncated isareti de taninir; toplam listeye esitse ya da alan yoksa liste tamdir', () => {
    expect(abPausedAdsText({ pausedAdIds: kimlikler(10), pausedAdIdsTruncated: true })).toBe(`Duraklatılan reklamların ilk 10 kimliği: ${kimlikler(10).join(', ')}`);
    expect(abPausedAdsText({ pausedAdIds: kimlikler(3), pausedAdIdsTotal: 3 })).toBe(`Duraklatılan reklamların kimlikleri: ${kimlikler(3).join(', ')}`);
    expect(abPausedAdsText({ pausedAdIds: ['22'], pausedAdIdsTotal: 'bozuk', pausedAdIdsTruncated: 'evet' })).toBe('Duraklatılan reklamın kimliği: 22');
    expect(abPausedAdsText({ pausedAdIds: ['22', '33'] })).toBe('Duraklatılan reklamların kimlikleri: 22, 33');
  });

  it('rv15 G9: 25 grupta duraklatan tur — sigmayan gruplarin ozet kaydi "N reklam grubunun toplamı" der, sayilar toplamdir', () => {
    const ozet = { action: 'ab-test-winner', groupCount: 16, groupIds: kimlikler(16, 100), pausedCount: 16, failedCount: 1, pausedAdIds: kimlikler(16) };
    expect(abTestGroupLabel(ozet, 'google_ads')).toBe('16 reklam grubunun toplamı');
    expect(abTestDetail(ozet, 'google_ads')).toBe('16 reklam grubunun toplamı: 16 varyant duraklatıldı, 1 varyant duraklatılamadı');
    expect(abTestDetail({ action: 'ab-test-pause-failed', groupCount: 3, failedCount: 3 }, 'meta_ads')).toBe('3 reklam setinin toplamı: 3 varyant duraklatılamadı');
    // Ozette 100'den fazla kimlik: kesilir, toplam yazilir
    expect(abPausedAdsText({ pausedAdIds: kimlikler(100), pausedAdIdsTotal: 130 })).toMatch(/^Duraklatılan 130 reklamın ilk 100 kimliği: 9001, /);
    // Eski kayit (groupId de groupCount da yok) ve bicimsiz groupCount: grup uydurulmaz
    expect(abTestGroupLabel({ groupCount: 0 }, 'google_ads')).toBeNull();
    expect(abTestGroupLabel({ groupCount: '16' }, 'google_ads')).toBeNull();
    expect(abTestGroupLabel({ groupCount: 2.5 }, 'google_ads')).toBeNull();
    // Grup kaydi groupCount tasisa da kendi grubunu soyler
    expect(abTestGroupLabel({ groupId: '2', groupName: 'Marka', groupCount: 16 }, 'google_ads')).toBe('Reklam grubu “Marka”');
  });
});

describe('historyReasonLabel', () => {
  it('A/B kaydindaki neden duraklatma hatasidir, AI gerekcesi degil', () => {
    expect(historyReasonLabel('ab-test-pause-failed')).toBe('Duraklatma hatası');
    expect(historyReasonLabel('ab-test-winner')).toBe('Duraklatma hatası');
    expect(historyReasonLabel('add-negative-keywords')).toBeNull();
  });
});
