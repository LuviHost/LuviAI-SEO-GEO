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
  /** Profildeki birincil "baglanti kur" dugmesi (yeni arayuzde LINK) */
  baglantiKur: ['Bağlantı kur', 'Connect', 'bağlantı kurmak için davet et', 'to connect'],
  /** Baglanti isteginde not ekleme dugmesi */
  notEkle: ['Not ekle', 'Add a note'],
  /** Not / mesaj gonderme dugmesi */
  gonder: ['Gönder', 'Send'],
  /** Profildeki mesaj dugmesi (1. derece baglantilarda) */
  mesaj: ['Mesaj gönder', 'Mesaj', 'Send message', 'Message'],
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
  mesajKutusu: ['Bir mesaj yazın…', 'Bir mesaj yazın', 'Mesaj yaz', 'Write a message…', 'Write a message', 'mesaj', 'message'],
  /**
   * Arama kutulari — metin kutusu ararken HER ZAMAN dislanir (uzunluktan
   * bagimsiz). "Mesajlarda ara" mesaj penceresinin ustundeki arama kutusudur;
   * mesaj kutusu sanilirsa DM yanlis yere yazilir.
   */
  aramaKutusu: ['Mesajlarda ara', 'Search messages', 'Ara', 'Search', 'Arama'],
  /** InMail (Premium) penceresindeki konu alani */
  konuAlani: ['Konu (isteğe bağlı)', 'Konu', 'Subject (optional)', 'Subject'],
  /**
   * InMail kredisi bitti / gonderilemiyor uyarilari — gorulurse SERVIS DURUR.
   * NEDEN: kredi bitince LinkedIn pencereyi acar ama gonderim sessizce basarisiz olur;
   * bot bunu "gonderildi" sanip kaydi MESSAGED yapardi.
   */
  inmailKrediYok: [
    // NEDEN dar kalip: "14 InMail kredisi arasından 1 krediyi kullan" NORMAL durumdur; genis kalip
    // ("InMail kredi") bunu "kredi bitti" sanip botu duraklatti (31.08). Yalniz TUKENME ifadeleri.
    'InMail kredisi kalmadı', 'InMail krediniz kalmadı', 'InMail kredin kalmadı',
    'kredi kalmadı', 'krediniz kalmadı', 'yeterli InMail krediniz yok', 'InMail krediniz yok',
    'You have no InMail credits', 'no InMail credits left', 'out of InMail credits',
    "You've used all your InMail", 'not enough InMail credits',
  ],
  /** InMail compose penceresi acildiginin isareti */
  inmailRozet: ['InMail'],
} as const;

export type LinkedinLabelKey = keyof typeof LINKEDIN_LABELS;
