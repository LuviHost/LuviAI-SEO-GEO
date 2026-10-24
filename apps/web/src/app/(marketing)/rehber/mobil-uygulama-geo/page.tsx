import { RehberArticlePage, rehberMetadata } from '@/components/rehber/rehber-article';
import { article } from '@/content/rehber/mobil-uygulama-geo';

export const metadata = rehberMetadata(article);

export default function Page() {
  return <RehberArticlePage article={article} />;
}
