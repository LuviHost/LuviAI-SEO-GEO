import { RehberArticlePage, rehberMetadata } from '@/components/rehber/rehber-article';
import { article } from '@/content/rehber/ajanslar-icin-yapay-zeka-gorunurluk-raporu';

export const metadata = rehberMetadata(article);

export default function Page() {
  return <RehberArticlePage article={article} />;
}
