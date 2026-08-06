import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Cloudflare + nginx arkasinda DOGRU kullanici IP'siyle rate limit.
 *
 * NEDEN GEREKLI:
 * Varsayilan ThrottlerGuard req.ip kullanir. Bizim kurulumda nginx istegi
 * localhost:3001'e proxy'ler ve Express'te "trust proxy" ayarli olmadigi icin
 * req.ip HER ISTEKTE 127.0.0.1 olur. Sonuc: TUM kullanicilar tek bucket'a
 * duser ve 60/dk limiti tum site icin ortak sayilir — birkac kullanici (hatta
 * tek bir dashboard acilisi) siteyi herkese 429 ile kilitler. Yani rate limit
 * korumasi, farkinda olmadan bir oz-DoS'a donusur.
 *
 * COZUM: Gercek istemci IP'sini Cloudflare'in CF-Connecting-IP header'indan
 * okuruz (Cloudflare her istekte bunu set eder ve edge'de override eder, yani
 * son kullanici tarafindan spoof edilemez). Cloudflare devrede degilse
 * X-Forwarded-For'un ilk adresine, o da yoksa req.ip'ye duseriz.
 *
 * GUVENLIK NOTU: Origin dogrudan internete acik oldugu icin (nginx 443 herkese
 * gorunur), Cloudflare'i bypass eden bir istemci CF-Connecting-IP'yi kendisi
 * gonderip rate limit bucket'ini secebilir. Bu yalnizca rate-limit atlatmadir,
 * veri sizmasi degil; asil sertlestirme origin firewall'ini Cloudflare IP
 * araligina kisitlamaktir (ayri bir altyapi isi).
 */
@Injectable()
export class ProxyThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const headers = req?.headers ?? {};

    const cf = headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf.trim()) return cf.trim();

    const xff = headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.trim()) {
      // XFF bir zincirdir: "gercek-istemci, proxy1, proxy2". Ilk adres istemci.
      return xff.split(',')[0].trim();
    }

    return req?.ip ?? 'unknown';
  }
}
