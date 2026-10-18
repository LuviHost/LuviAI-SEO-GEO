import { Injectable } from '@nestjs/common';
import type { WikidataDraft } from './knowledge-graph-builder.service.js';

export interface SubmitResult {
  ok: boolean;
  itemId?: string;
  url?: string;
  error?: string;
  warning?: string;
  /** true: gonderim yapilmadi, taslak elle eklenmek uzere dondu */
  manual?: boolean;
  /** Elle ekleme sayfasi (Wikidata Special:NewItem / Wikipedia) */
  createUrl?: string;
  /** Sunucuda sitenin kendi verisinden uretilen taslak (istemcinin taslagi degil) */
  draft?: WikidataDraft;
}

const WIKIDATA_NEW_ITEM_URL = 'https://www.wikidata.org/wiki/Special:NewItem';

/**
 * Knowledge Submitter — Wikidata/Wikipedia'ya OTOMATIK GONDERIM YAPMAZ;
 * taslagi elle ekleme icin dondurur.
 *
 * NEDEN KALDIRILDI: submitWikidata eskiden RanksUp'in KENDI bot hesabiyla
 * (WIKIDATA_BOT_USER / WIKIDATA_BOT_PASS) oturum acip istemcinin gonderdigi
 * etiket ve aciklamalarla yeni oge olusturuyordu (wbeditentity new=item).
 * Herhangi bir site sahibi RanksUp adina istedigi ogeyi acabiliyordu.
 * Taslagi sunucuda uretmek de bunu cozmez: etiket sitenin adidir ve onu
 * kullanici belirler; her tiklama da yeni (cogu zaman mukerrer) oge demekti.
 * Wikidata kurallari bu kullanimi bot hesabinin sahibine yukler:
 *  - "The contributions of a bot account remain the responsibility of its
 *    operator" ve "Bot accounts should not be used for contributions that do
 *    not fall within the scope of the bot's designated tasks"; zarar
 *    olcusune gore "an administrator may block the bot"
 *    (https://www.wikidata.org/wiki/Wikidata:Bots).
 *  - Kayda degerlik olcutlerini karsilamayan veri "won't be accepted" ve
 *    silinme talebine acilabilir (https://www.wikidata.org/wiki/Wikidata:Notability).
 * Musterinin kendi hesabiyla, kendi sorumlulugunda eklemesi dogru yol; panel
 * zaten "Elle: Wikidata'da yeni öğe oluştur" baglantisini veriyor.
 *
 * Kullanici aksiyonu: WIKIDATA_BOT_USER / WIKIDATA_BOT_PASS uretim ortamindan
 * kaldirilabilir; artik hicbir kod yolu okumuyor.
 */
@Injectable()
export class KnowledgeSubmitterService {
  /**
   * @param draft Sunucuda KnowledgeGraphBuilderService.buildWikidata(siteId)
   *   ile uretilen taslak — istemciden gelen taslak buraya verilmez.
   */
  async submitWikidata(draft: WikidataDraft): Promise<SubmitResult> {
    return {
      ok: false,
      manual: true,
      warning: 'RanksUp, Wikidata\'ya sizin adınıza öğe göndermez. Taslağı kopyalayıp "Wikidata\'da yeni öğe oluştur" bağlantısından kendi Wikidata hesabınızla ekleyin; kayda değerlik kuralları uygulanır.',
      createUrl: draft?.createUrl || WIKIDATA_NEW_ITEM_URL,
      draft,
    };
  }

  /**
   * Wikipedia'ya hic gonderim yapilmadi (eski surum de yalniz uyari donuyordu).
   * Rehber sayfalari (Ekim 2026'da dogrulandi): EN "Articles for creation
   * (AfC) lets you write an article as a draft and submit it for review"
   * (https://en.wikipedia.org/wiki/Wikipedia:Articles_for_creation); TR yeni
   * editorler icin ilk madde rehberi (https://tr.wikipedia.org/wiki/Vikipedi:%C4%B0lk_maddeniz).
   */
  async submitWikipedia(lang: 'tr' | 'en' = 'tr'): Promise<SubmitResult> {
    return {
      ok: false,
      manual: true,
      warning: 'RanksUp, Wikipedia\'ya sizin adınıza makale göndermez. Taslağı kendi Wikipedia hesabınızla, güvenilir kaynaklarıyla birlikte ekleyin.',
      createUrl: lang === 'en'
        ? 'https://en.wikipedia.org/wiki/Wikipedia:Articles_for_creation'
        : 'https://tr.wikipedia.org/wiki/Vikipedi:%C4%B0lk_maddeniz',
    };
  }
}
