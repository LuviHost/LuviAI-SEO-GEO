import { PublishAdapter } from './base.js';
import type { PublishPayload, PublishResult } from './base.js';

/**
 * WordPress XML-RPC (eski sürüm WordPress için)
 * credentials: { siteUrl, username, password }
 * config: { postStatus, categories?, tags? }
 *
 * metaWeblog.newPost methodunu kullanır.
 * REST API olmayan WP < 4.7 için tek seçenek.
 */
export class WordPressXmlrpcAdapter extends PublishAdapter {
  async publish(payload: PublishPayload): Promise<PublishResult> {
    const { siteUrl, username, password } = this.credentials;
    const xmlrpcUrl = `${siteUrl.replace(/\/$/, '')}/xmlrpc.php`;

    const xml = this.buildNewPostXml({
      blogId: 1,
      username,
      password,
      title: payload.title,
      content: payload.bodyHtml,
      categories: this.config.categories ?? [],
      tags: this.config.tags ?? [],
      slug: payload.slug,
      excerpt: payload.metaDescription ?? '',
      status: this.config.postStatus ?? 'publish',
    });

    try {
      const res = await fetch(xmlrpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=UTF-8' },
        body: xml,
      });
      const body = await res.text();
      if (!res.ok) {
        return { ok: false, error: `XML-RPC ${res.status}` };
      }
      // WordPress XML-RPC <int>POST_ID</int> döner
      const idMatch = body.match(/<int>(\d+)<\/int>/);
      if (!idMatch) {
        const faultMatch = body.match(/<name>faultString<\/name>\s*<value>([^<]+)/);
        return { ok: false, error: faultMatch?.[1] ?? 'Unknown XML-RPC error' };
      }
      const postId = idMatch[1];
      return {
        ok: true,
        externalUrl: `${siteUrl}/?p=${postId}`,
        externalId: postId,
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  async test(): Promise<boolean> {
    const { siteUrl } = this.credentials;
    const res = await fetch(`${siteUrl}/xmlrpc.php`).catch(() => null);
    return !!res?.ok;
  }

  private buildNewPostXml(p: any): string {
    const escape = (s: string) =>
      String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' } as any)[c]);
    return `<?xml version="1.0"?>
<methodCall>
  <methodName>metaWeblog.newPost</methodName>
  <params>
    <param><value><int>${p.blogId}</int></value></param>
    <param><value><string>${escape(p.username)}</string></value></param>
    <param><value><string>${escape(p.password)}</string></value></param>
    <param><value><struct>
      <member><name>title</name><value><string>${escape(p.title)}</string></value></member>
      <member><name>description</name><value><string>${escape(p.content)}</string></value></member>
      <member><name>mt_excerpt</name><value><string>${escape(p.excerpt)}</string></value></member>
      <member><name>wp_slug</name><value><string>${escape(p.slug)}</string></value></member>
      <member><name>post_status</name><value><string>${escape(p.status)}</string></value></member>
    </struct></value></param>
    <param><value><boolean>${p.status === 'publish' ? 1 : 0}</boolean></value></param>
  </params>
</methodCall>`;
  }
}
