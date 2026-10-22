/**
 * PayTR test modu acik mi — PaytrService.testModeOn ile AYNI kural (tek kaynak).
 * '0' DISINDAKI her deger test sayilir (bos, satir ici yorumlu "1  # 1=test" vb.):
 * belirsiz ayarda satin almayi kapatmak daha ucuz hata. Test modunda satin alma
 * yalniz yoneticiye acik (paytr.service checkoutStatus).
 *
 * NEDEN ayri dosya: deneme bitis e-postalari (email.cron) "deneme bitince ne olur"
 * sorusunu buna gore yanitlar; PaytrService EmailService'e bagimli oldugu icin
 * e-posta modulu onu enjekte edemez (dongusel bagimlilik).
 */
export function checkoutTestModeOn(raw: string | undefined = process.env.PAYTR_TEST_MODE): boolean {
  return (raw ?? '1').trim() !== '0';
}
