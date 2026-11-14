import { RehberArticlePage, rehberMetadata } from '@/components/rehber/rehber-article';
import { article } from '@/content/rehber/chatgpt-isletme-profili';

export const metadata = rehberMetadata(article);

export default function Page() {
  return <RehberArticlePage article={article} />;
}
