import { RehberArticlePage, rehberMetadata } from '@/components/rehber/rehber-article';
import { article } from '@/content/rehber/yapay-zeka-botlari-robots-txt';

export const metadata = rehberMetadata(article);

export default function Page() {
  return <RehberArticlePage article={article} />;
}
