import type { VideoBrief, VideoGenerationResult, VideoProvider, VideoProviderInfo } from './types.js';

/**
 * Google Veo 3 — Vertex AI üzerinden veya Gemini API.
 *
 * Endpoint: https://us-central1-aiplatform.googleapis.com/v1/projects/{project}/locations/us-central1/publishers/google/models/veo-3.0-generate-001:predictLongRunning
 *
 * Auth: Google Cloud OAuth2 service account → access token
 *
 * Akış:
 *   1) predictLongRunning → operation.name döner
 *   2) operation.poll (5–30sn aralıkla) → done=true olunca response.predictions[0].mimeType + bytesBase64Encoded
 *   3) Base64 video'yu disk'e yaz, public URL döndür
 *
 * NOT: Bu adapter şu an SCAFFOLD — production kullanımı için service account
 * GOOGLE_APPLICATION_CREDENTIALS env key'i + Vertex AI API enabled lazım.
 */

export class VeoVideoProvider implements VideoProvider {
  key = 'VEO' as const;

  info(): VideoProviderInfo {
    const ready = !!(
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      process.env.GCP_PROJECT_ID ||
      process.env.VEO_API_KEY
    );
    return {
      key: 'VEO',
      label: 'Google Veo 3',
      description:
        'Google\'ın yeni nesil video AI\'si — fotogerçekçi, sinematik. 8sn klipler, ses içerebilir. Vertex AI quota gerek.',
      estTime: '2–5 dk',
      costBand: '$0.50–0.75 / 8sn klip',
      quality: 5,
      requiredEnvKeys: ['GCP_PROJECT_ID', 'GOOGLE_APPLICATION_CREDENTIALS (service account JSON path)'],
      ready,
      note: ready
        ? 'Vertex AI bağlantısı hazır görünüyor. Quota request ile prod kullanımı için Google Cloud project\'inde Veo 3 API enabled olmalı.'
        : 'Service account JSON yolu (GOOGLE_APPLICATION_CREDENTIALS) ve GCP_PROJECT_ID .env\'de tanımlı olmalı.',
      bestFor: ['Sinematik B-roll', 'Yüksek kalite reklam', 'Fotogerçekçi sahneler'],
    };
  }

  async generate(brief: VideoBrief): Promise<VideoGenerationResult> {
    if (!process.env.GCP_PROJECT_ID || !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      throw new Error(
        'Veo: GCP_PROJECT_ID ve GOOGLE_APPLICATION_CREDENTIALS .env\'de tanımlı olmalı. Service account oluştur: https://cloud.google.com/iam/docs/service-accounts-create',
      );
    }

    // SCAFFOLD: gerçek Vertex AI çağrısı için google-auth-library + axios kullanılacak.
    // Şimdilik açık bir hata mesajıyla iade ediyoruz ki kullanıcı eksik adımı görsün.
    throw new Error(
      'Veo provider kodu yazıldı ama Vertex AI auth flow tamamlanmadı. ' +
        'Gerekli adımlar: (1) GCP project + Vertex AI API enable, (2) service account + JSON key, ' +
        '(3) bu adapter\'a google-auth-library ile predictLongRunning + operation polling ekle.',
    );
  }
}
