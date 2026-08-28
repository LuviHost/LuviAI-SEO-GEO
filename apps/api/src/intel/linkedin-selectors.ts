/**
 * LinkedIn arayuz etiketleri — TR/EN.
 *
 * NEDEN: Bot DOM seciciyle degil, OpenClaw snapshot'indaki ERISILEBILIRLIK
 * ETIKETIYLE eleman bulur (linkedin-outreach-rules.ts findRef). LinkedIn
 * class adlarini sik degistirir, etiket metni cok daha kararli. Hesabin dili
 * Turkce ya da Ingilizce olabilir; her etiketin iki hali de listelenir.
 * Yeni bir dil/etiket cikinca yalniz bu dosya guncellenir.
 */
export const LINKEDIN_LABELS = {
  /** Profildeki birincil "baglanti kur" dugmesi */
  baglantiKur: ['Bağlantı kur', 'Connect'],
  /** Baglanti isteginde not ekleme dugmesi */
  notEkle: ['Not ekle', 'Add a note'],
  /** Not / mesaj gonderme dugmesi */
  gonder: ['Gönder', 'Send'],
  /** Profildeki mesaj dugmesi (1. derece baglantilarda) */
  mesaj: ['Mesaj', 'Message'],
  /** Istek gonderilmis, kabul bekliyor */
  bekliyor: ['Bekliyor', 'Pending'],
  /** Takip et — "Baglanti kur" yerine birincil dugme olabilir */
  takipEt: ['Takip et', 'Follow'],
  /** Baglanti derecesi rozeti */
  derece1: ['1.', '1st'],
  /** Mesaj kutusunda okunmamis isareti */
  okunmamis: ['okunmamış', 'unread'],
  /** "Daha fazla" menusu — Baglanti kur bazen bunun altinda */
  daha: ['Daha fazla', 'More'],
  /** Not alani (textarea) — modal icindeki metin kutusu */
  notAlani: ['Not ekle', 'Add a note', 'not', 'note'],
  /** Mesaj yazma kutusu (contenteditable, role=textbox) */
  mesajKutusu: ['Mesaj yaz', 'Write a message', 'mesaj', 'message'],
  /**
   * Arama kutulari — metin kutusu ararken HER ZAMAN dislanir (uzunluktan
   * bagimsiz). "Mesajlarda ara" mesaj penceresinin ustundeki arama kutusudur;
   * mesaj kutusu sanilirsa DM yanlis yere yazilir.
   */
  aramaKutusu: ['Mesajlarda ara', 'Search messages', 'Ara', 'Search', 'Arama'],
} as const;

export type LinkedinLabelKey = keyof typeof LINKEDIN_LABELS;
