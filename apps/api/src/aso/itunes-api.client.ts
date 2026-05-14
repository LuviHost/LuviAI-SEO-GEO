import { Injectable, Logger } from '@nestjs/common';

/**
 * iTunes Search API wrapper — App Store verileri için ücretsiz, auth'suz.
 *
 * TypeScript port of claude-code-aso-skill/lib/itunes_api.py (MIT).
 * https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/
 *
 * Kullanım:
 *   const itunes = new ItunesApiClient();
 *   const app = await itunes.getAppByName('Todoist');
 *   const competitors = await itunes.getCompetitors('productivity', 10);
 */

export interface RawITunesApp {
  trackId?: number;
  trackName?: string;
  bundleId?: string;
  artistName?: string;
  primaryGenreName?: string;
  genres?: string[];
  description?: string;
  averageUserRating?: number;
  userRatingCount?: number;
  formattedPrice?: string;
  releaseDate?: string;
  version?: string;
  fileSizeBytes?: string;
  contentAdvisoryRating?: string;
  screenshotUrls?: string[];
  ipadScreenshotUrls?: string[];
  artworkUrl512?: string;
  artworkUrl100?: string;
  trackViewUrl?: string;
}

export interface ITunesSearchResponse {
  resultCount: number;
  results: RawITunesApp[];
  error?: string;
}

export interface ITunesAppMetadata {
  app_id: number | undefined;
  app_name: string | undefined;
  bundle_id: string | undefined;
  developer: string | undefined;
  category: string | undefined;
  genres: string[];
  description: string;
  rating: number;
  ratings_count: number;
  price: string;
  release_date: string | undefined;
  current_version: string | undefined;
  file_size: string | undefined;
  content_rating: string | undefined;
  screenshots: string[];
  ipad_screenshots: string[];
  icon_url: string | undefined;
  app_store_url: string | undefined;
}

@Injectable()
export class ItunesApiClient {
  private readonly log = new Logger(ItunesApiClient.name);
  private static readonly BASE_URL = 'https://itunes.apple.com/search';
  private static readonly TIMEOUT_MS = 10_000;

  /**
   * Search apps by keyword.
   * @param country Two-letter country code (default: 'us'; TR için 'tr')
   */
  async searchApps(
    term: string,
    limit = 10,
    entity: 'software' | 'iPadSoftware' = 'software',
    country = 'us',
  ): Promise<ITunesSearchResponse> {
    const params = new URLSearchParams({
      term,
      country,
      entity,
      limit: String(Math.min(200, Math.max(1, limit))),
    });
    return this.fetchJson(`${ItunesApiClient.BASE_URL}?${params}`);
  }

  /** App Store ID ile detay getir */
  async getAppById(appId: string, country = 'us'): Promise<RawITunesApp | null> {
    const params = new URLSearchParams({ id: appId, country, entity: 'software' });
    const res = await this.fetchJson<ITunesSearchResponse>(`${ItunesApiClient.BASE_URL}?${params}`);
    return res.resultCount > 0 ? res.results[0]! : null;
  }

  /** İsimle ara, ilk match'i döndür */
  async getAppByName(name: string, country = 'us'): Promise<RawITunesApp | null> {
    const res = await this.searchApps(name, 1, 'software', country);
    return res.resultCount > 0 ? res.results[0]! : null;
  }

  /** Kategori top app'lerini getir */
  async getCompetitors(category: string, limit = 10, country = 'us'): Promise<RawITunesApp[]> {
    const res = await this.searchApps(category, limit, 'software', country);
    return res.results ?? [];
  }

  /** Birden çok competitor adından batch metadata */
  async compareCompetitors(competitorNames: string[], country = 'us'): Promise<ITunesAppMetadata[]> {
    const apps = await Promise.all(competitorNames.map(n => this.getAppByName(n, country)));
    return apps.filter((a): a is RawITunesApp => a !== null).map(a => this.extractMetadata(a));
  }

  /** Raw iTunes payload → ASO-analiz için temizlenmiş metadata */
  extractMetadata(app: RawITunesApp): ITunesAppMetadata {
    return {
      app_id: app.trackId,
      app_name: app.trackName,
      bundle_id: app.bundleId,
      developer: app.artistName,
      category: app.primaryGenreName,
      genres: app.genres ?? [],
      description: app.description ?? '',
      rating: app.averageUserRating ?? 0,
      ratings_count: app.userRatingCount ?? 0,
      price: app.formattedPrice ?? 'Free',
      release_date: app.releaseDate,
      current_version: app.version,
      file_size: app.fileSizeBytes,
      content_rating: app.contentAdvisoryRating,
      screenshots: app.screenshotUrls ?? [],
      ipad_screenshots: app.ipadScreenshotUrls ?? [],
      icon_url: app.artworkUrl512 ?? app.artworkUrl100,
      app_store_url: app.trackViewUrl,
    };
  }

  private async fetchJson<T = ITunesSearchResponse>(url: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ItunesApiClient.TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        return { resultCount: 0, results: [], error: `HTTP ${res.status}` } as unknown as T;
      }
      return (await res.json()) as T;
    } catch (err: any) {
      this.log.warn(`iTunes API request failed: ${err.message}`);
      return { resultCount: 0, results: [], error: err.message } as unknown as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}
