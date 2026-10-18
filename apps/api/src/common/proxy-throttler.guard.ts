import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { clientIp } from './client-ip.js';

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
 * COZUM: istemci IP'si common/client-ip.ts ile okunur — once Cloudflare'in
 * CF-Connecting-IP basligi, yoksa X-Forwarded-For'a nginx'in SONA ekledigi
 * adres (soldaki adresler istemcinin kendi yazdigi, sahte olabilir; eskiden
 * ilk adres aliniyordu ve istenen bucket secilebiliyordu), o da yoksa soket.
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
    return clientIp(req) || 'unknown';
  }
}
