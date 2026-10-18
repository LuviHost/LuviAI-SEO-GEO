import { Injectable } from '@nestjs/common';

export interface SubmitResult {
  ok: boolean;
  itemId?: string;
  url?: string;
  error?: string;
  warning?: string;
}

/**
 * Knowledge Submitter — Wikidata/Wikipedia'ya OTOMATIK GONDERIM YAPMAZ.
 *
 * NEDEN KALDIRILDI: submitWikidata eskiden RanksUp'in KENDI bot hesabiyla
 * (WIKIDATA_BOT_USER / WIKIDATA_BOT_PASS) oturum acip istemcinin gonderdigi
 * etiket ve aciklamalarla yeni oge olusturuyordu (wbeditentity new=item):
 * herhangi bir site sahibi RanksUp adina istedigi ogeyi acabiliyordu.
 * Taslagi sunucuda uretmek de yetmez — etiket sitenin adidir (kullanici
 * girdisi) ve her cagri yeni bir oge demekti. Wikidata bot politikasi her
 * otomatik gorev icin onay ister ("a request must be made at
 * Wikidata:Requests for permissions/Bot"), bot hesabini onayli gorevlerle
 * sinirlar ("Bot accounts should not be used for contributions that do not
 * fall within the scope of the bot's designated tasks") ve zarar halinde
 * engellenebilecegini yazar ("Depending on the scale of the damage, an
 * administrator may block the bot") — https://www.wikidata.org/wiki/Wikidata:Bots
 * (18.10.2026). Musteri taslagi panelden kopyalayip kendi hesabiyla ekler;
 * panel "Elle: Wikidata'da yeni öğe oluştur" baglantisini zaten veriyor.
 *
 * WIKIDATA_BOT_USER / WIKIDATA_BOT_PASS artik hicbir kod yolunda okunmuyor.
 */
@Injectable()
export class KnowledgeSubmitterService {
  async submitWikidata(): Promise<SubmitResult> {
    return {
      ok: false,
      warning:
        "Wikidata'ya RanksUp hesabıyla otomatik gönderim kapalı. Taslaktaki etiket, açıklama ve özellikleri kopyalayıp \"Elle: Wikidata'da yeni öğe oluştur\" bağlantısından kendi Wikidata hesabınla ekleyebilirsin.",
    };
  }

  /** Wikipedia'ya hicbir surumde gonderim yapilmadi; davranis ayni, metin duzeltildi. */
  async submitWikipedia(): Promise<SubmitResult> {
    return {
      ok: false,
      warning: "RanksUp Wikipedia'ya otomatik gönderim yapmıyor. Taslağı kopyalayıp kendi Wikipedia hesabınla ekleyebilirsin.",
    };
  }
}
