import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppliedFixService } from '../../audit/applied-fix.service.js';
import { AscService, type RequestingUser } from './asc.service.js';
import type { AscApiClient } from './asc-api.client.js';
import { explainAscError } from './asc-metadata.service.js';
import { pickVersion, versionStateOf } from './asc-metadata.js';
import { DISPLAY_TYPES, MAX_PER_SET, isDisplayType, thumbnailUrl, validateScreenshot, type DisplayType } from './asc-screenshots.js';

/** multer bellek deposu dosyasi (yalniz kullandigimiz alanlar — @types/multer gerekmez) */
export interface UploadedImage {
  originalname: string;
  size: number;
  buffer: Buffer;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Ekran goruntusu → App Store Connect. Her dosya AYRI istekte, senkron:
 * dogrula → alfa duzlestir → set bul/olustur → rezerve → parcalari yukle →
 * md5 ile isle. (Prod nginx 25 MB/istek: 10 PNG tek istege sigmaz; tek
 * dosyalik istekler is kuyrugu ve gecici disk gerektirmez.)
 *
 * Studio ciktilari canvas PNG'sidir ve HER ZAMAN alfa kanali tasir; Apple
 * "Images can't include alpha channels" der → sunucu duzlestirir (opak
 * goruntude kayipsiz; gercek saydamlik beyaza duzlenir ve bildirilir).
 * Incelemeye gonderme yok. Silme geri alinamaz → acik onay.
 */
@Injectable()
export class AscScreenshotsService {
  private readonly log = new Logger(AscScreenshotsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly asc: AscService,
    private readonly appliedFix: AppliedFixService,
  ) {}

  private async context(siteId: string, ascAppId: string, user: RequestingUser) {
    const app = await this.asc.loadApp(ascAppId, user);
    if (app.account.siteId !== siteId) throw new NotFoundException('App bulunamadı');
    return { app, client: await this.asc.getClient(app.accountId) };
  }

  private async target(client: AscApiClient, appleAppId: string) {
    const versions = (await client.listAppStoreVersions(appleAppId, 50, 'IOS')).data ?? [];
    const version = pickVersion(versions.map((v) => ({ id: v.id, versionString: v.attributes?.versionString ?? '?', state: versionStateOf(v.attributes) })));
    const locs = version ? (await client.listVersionLocalizations(version.id)).data ?? [] : [];
    return { version, locs };
  }

  private requireEditable(version: { editable: boolean; versionString: string; state: string } | null) {
    if (!version) throw new BadRequestException('App Store sürümü bulunamadı');
    if (!version.editable) {
      throw new BadRequestException(`Sürüm ${version.versionString} şu an ekran görüntüsü kabul etmiyor (durum: ${version.state}) — yeni sürüm oluştur ya da incelemeden çek`);
    }
  }

  /** Sunucu tarafi goruntu bilgisi */
  async inspect(file: UploadedImage) {
    if (!file?.buffer?.length) throw new BadRequestException('Dosya yok');
    const img = sharp(file.buffer, { limitInputPixels: 40_000_000 });
    const meta = await img.metadata().catch(() => null);
    if (!meta) throw new BadRequestException('Görüntü okunamadı');
    const opaque = meta.hasAlpha ? (await img.stats()).isOpaque : true;
    return {
      format: meta.format,
      width: meta.width,
      height: meta.height,
      bytes: file.size ?? file.buffer.length,
      alpha: !meta.hasAlpha ? ('none' as const) : opaque ? ('opaque' as const) : ('transparent' as const),
    };
  }

  async state(siteId: string, ascAppId: string, user: RequestingUser, locale?: string) {
    const { app, client } = await this.context(siteId, ascAppId, user);
    try {
      const { version, locs } = await this.target(client, app.appleAppId);
      const locales = locs.map((l) => l.attributes?.locale).filter(Boolean) as string[];
      const selected = locale && locales.includes(locale) ? locale : locales.includes('tr') ? 'tr' : locales[0] ?? null;
      const loc = locs.find((l) => l.attributes?.locale === selected);
      const sets = loc ? (await client.listScreenshotSets(loc.id)).data ?? [] : [];
      const known = sets.filter((s) => isDisplayType(s.attributes?.screenshotDisplayType));
      const withShots = await Promise.all(known.map(async (s) => ({
        id: s.id,
        displayType: s.attributes.screenshotDisplayType as DisplayType,
        screenshots: ((await client.listScreenshots(s.id)).data ?? []).map((x) => ({
          id: x.id,
          fileName: x.attributes?.fileName ?? '',
          state: x.attributes?.assetDeliveryState?.state ?? 'UNKNOWN',
          thumb: thumbnailUrl(x.attributes?.imageAsset),
        })),
      })));
      return {
        version,
        locales,
        locale: selected,
        sets: withShots,
        displayTypes: Object.fromEntries(Object.entries(DISPLAY_TYPES).map(([k, v]) => [k, { label: v.label, sizes: v.sizes }])),
        maxPerSet: MAX_PER_SET,
      };
    } catch (err) {
      throw new BadRequestException(explainAscError(err));
    }
  }

  /** Kuru kontrol — Apple'a yazma yok */
  async check(siteId: string, ascAppId: string, user: RequestingUser, file: UploadedImage, displayType: unknown) {
    await this.context(siteId, ascAppId, user);
    if (!isDisplayType(displayType)) throw new BadRequestException('Geçersiz görünüm türü');
    const facts = await this.inspect(file);
    const errors = validateScreenshot(facts, displayType);
    return {
      ok: errors.length === 0,
      errors,
      ...facts,
      note: facts.alpha === 'opaque' ? 'Alfa kanalı kaldırılacak (görüntü değişmez)' : facts.alpha === 'transparent' ? 'Saydam pikseller beyaza düzleştirilecek' : null,
    };
  }

  /** Apple'a gidecek baytlar: alfa kaldirilir; PNG kalir, JPEG dokunulmaz */
  private async prepare(file: UploadedImage, facts: { format?: string; alpha: string }) {
    if (facts.alpha === 'none') return { bytes: file.buffer, ext: facts.format === 'jpeg' ? 'jpg' : 'png' };
    const bytes = await sharp(file.buffer, { limitInputPixels: 40_000_000 }).flatten({ background: '#ffffff' }).png().toBuffer();
    return { bytes, ext: 'png' };
  }

  async upload(
    siteId: string,
    ascAppId: string,
    user: RequestingUser,
    file: UploadedImage,
    body: { locale?: unknown; displayType?: unknown; confirm?: unknown },
  ) {
    if (body?.confirm !== true && body?.confirm !== 'true') throw new BadRequestException('Yüklemek için açık onay gerekli');
    if (!isDisplayType(body?.displayType)) throw new BadRequestException('Geçersiz görünüm türü');
    const displayType = body.displayType;
    const locale = typeof body?.locale === 'string' ? body.locale : '';
    const facts = await this.inspect(file);
    const errors = validateScreenshot(facts, displayType);
    if (errors.length) throw new BadRequestException(errors.join(' · '));

    const { app, client } = await this.context(siteId, ascAppId, user);
    let screenshotId: string | null = null;
    try {
      const { version, locs } = await this.target(client, app.appleAppId);
      this.requireEditable(version);
      const loc = locs.find((l) => l.attributes?.locale === locale);
      if (!loc) throw new BadRequestException(`"${locale}" dili bu sürümde yok`);

      const sets = (await client.listScreenshotSets(loc.id)).data ?? [];
      const set = sets.find((s) => s.attributes?.screenshotDisplayType === displayType) ?? (await client.createScreenshotSet(loc.id, displayType)).data;
      const count = ((await client.listScreenshots(set.id)).data ?? []).length;
      if (count >= MAX_PER_SET) throw new BadRequestException(`${DISPLAY_TYPES[displayType].label} seti dolu (${MAX_PER_SET}) — önce birini sil`);

      const { bytes, ext } = await this.prepare(file, facts);
      const base = (file.originalname || 'screenshot').replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 80) || 'screenshot';
      const fileName = `${base}.${ext}`;
      const md5 = createHash('md5').update(bytes).digest('hex');

      const created = await client.createScreenshot(set.id, fileName, bytes.length);
      screenshotId = created.data.id;
      await client.uploadParts(created.data.attributes?.uploadOperations ?? [], bytes);
      const committed = await client.commitScreenshot(created.data.id, md5);
      let state: string = committed.data?.attributes?.assetDeliveryState?.state ?? 'UPLOAD_COMPLETE';
      // Kisa bekleme (≤ ~8 sn); islenmeye devam ederse panel yenilemesinde gorunur
      for (let i = 0; i < 5 && state !== 'COMPLETE' && state !== 'FAILED'; i++) {
        await sleep(1500);
        state = (await client.getScreenshot(created.data.id)).data?.attributes?.assetDeliveryState?.state ?? state;
      }
      await this.appliedFix.kaydet({
        siteId, userId: user.id, kind: 'asc_screenshot', fixType: 'asc_screenshot_upload',
        target: `asc:${app.appleAppId}:${locale}:${displayType}`, status: state === 'FAILED' ? 'FAILED' : 'APPLIED',
        detail: { ascAppId, screenshotId: created.data.id, fileName, locale, displayType, flattened: facts.alpha !== 'none', state },
      });
      return { screenshotId: created.data.id, fileName, state, flattened: facts.alpha !== 'none', width: facts.width, height: facts.height };
    } catch (err) {
      // Rezerve edilip tamamlanamayan kayit sette "bekleyen" olarak kalmasin
      if (screenshotId) await client.deleteScreenshot(screenshotId).catch(() => undefined);
      if (err instanceof BadRequestException || err instanceof NotFoundException) throw err;
      this.log.warn(`[asc-shot ${app.appleAppId}] yukleme hatasi: ${(err as Error)?.message}`);
      throw new BadRequestException(explainAscError(err));
    }
  }

  /** Setteki TUM goruntuleri sil (degistir modu) — geri alinamaz */
  async clear(siteId: string, ascAppId: string, user: RequestingUser, body: { locale?: unknown; displayType?: unknown; confirm?: unknown }) {
    if (body?.confirm !== true) throw new BadRequestException('Silmek için açık onay gerekli');
    if (!isDisplayType(body?.displayType)) throw new BadRequestException('Geçersiz görünüm türü');
    const { app, client } = await this.context(siteId, ascAppId, user);
    try {
      const { version, locs } = await this.target(client, app.appleAppId);
      this.requireEditable(version);
      const loc = locs.find((l) => l.attributes?.locale === body.locale);
      if (!loc) throw new BadRequestException(`"${String(body.locale)}" dili bu sürümde yok`);
      const set = ((await client.listScreenshotSets(loc.id)).data ?? []).find((s) => s.attributes?.screenshotDisplayType === body.displayType);
      const shots = set ? (await client.listScreenshots(set.id)).data ?? [] : [];
      for (const s of shots) await client.deleteScreenshot(s.id);
      await this.appliedFix.kaydet({
        siteId, userId: user.id, kind: 'asc_screenshot', fixType: 'asc_screenshot_clear',
        target: `asc:${app.appleAppId}:${String(body.locale)}:${body.displayType}`,
        detail: { ascAppId, deleted: shots.length, fileNames: shots.map((s) => s.attributes?.fileName ?? s.id) },
      });
      return { deleted: shots.length };
    } catch (err) {
      if (err instanceof BadRequestException || err instanceof NotFoundException) throw err;
      throw new BadRequestException(explainAscError(err));
    }
  }

  /** Tek goruntuyu sil — bu app'in duzenlenebilir surumundeki bir sette olmali */
  async remove(siteId: string, ascAppId: string, user: RequestingUser, screenshotId: string, body: { confirm?: unknown }) {
    if (body?.confirm !== true) throw new BadRequestException('Silmek için açık onay gerekli');
    const { app, client } = await this.context(siteId, ascAppId, user);
    try {
      const { version, locs } = await this.target(client, app.appleAppId);
      this.requireEditable(version);
      for (const loc of locs) {
        for (const set of (await client.listScreenshotSets(loc.id)).data ?? []) {
          const shot = ((await client.listScreenshots(set.id)).data ?? []).find((x) => x.id === screenshotId);
          if (!shot) continue;
          await client.deleteScreenshot(screenshotId);
          await this.appliedFix.kaydet({
            siteId, userId: user.id, kind: 'asc_screenshot', fixType: 'asc_screenshot_delete',
            target: `asc:${app.appleAppId}:${loc.attributes?.locale}:${set.attributes?.screenshotDisplayType}`,
            detail: { ascAppId, screenshotId, fileName: shot.attributes?.fileName ?? null },
          });
          return { deleted: 1 };
        }
      }
      throw new NotFoundException('Ekran görüntüsü bu uygulamanın düzenlenebilir sürümünde yok');
    } catch (err) {
      if (err instanceof BadRequestException || err instanceof NotFoundException) throw err;
      throw new BadRequestException(explainAscError(err));
    }
  }
}
