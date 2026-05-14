'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Trash2, Folder, Image as ImageIcon, Video, Sparkles, Globe, Upload, Edit3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useSiteContext } from '../site-context';
import { api } from '@/lib/api';

type MediaSource = 'UPLOAD' | 'UNSPLASH' | 'AI_GENERATED' | 'URL_IMPORT';

interface MediaAsset {
  id: string;
  url: string;
  thumbnail?: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  folder?: string | null;
  altText?: string | null;
  tags?: string[] | null;
  source: MediaSource;
  usageCount: number;
  createdAt: string;
}

const SOURCE_ICON: Record<MediaSource, React.ComponentType<any>> = {
  UPLOAD: Upload,
  UNSPLASH: Globe,
  AI_GENERATED: Sparkles,
  URL_IMPORT: Globe,
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MediaLibraryPage() {
  const { site } = useSiteContext();
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<MediaSource | 'ALL'>('ALL');
  const [loading, setLoading] = useState(true);
  const [editAsset, setEditAsset] = useState<MediaAsset | null>(null);
  const [editAlt, setEditAlt] = useState('');
  const [editFolder, setEditFolder] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [list, fols] = await Promise.all([
        api.listMediaLibrary({
          siteId: site.id,
          folder: activeFolder ?? undefined,
          source: sourceFilter === 'ALL' ? undefined : sourceFilter,
        }),
        api.listMediaFolders(site.id),
      ]);
      setAssets(list ?? []);
      setFolders(fols ?? []);
    } catch (err: any) {
      toast.error(`Media library yüklenemedi: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [site.id, activeFolder, sourceFilter]);

  const remove = async (id: string) => {
    if (!confirm('Bu görsel/videoyu silmek istediğinden emin misin?')) return;
    try {
      await api.deleteMediaAsset(id);
      setAssets(prev => prev.filter(a => a.id !== id));
      toast.success('Silindi');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const saveEdit = async () => {
    if (!editAsset) return;
    try {
      const updated = await api.updateMediaAsset(editAsset.id, {
        altText: editAlt || null,
        folder: editFolder || null,
      });
      setAssets(prev => prev.map(a => a.id === editAsset.id ? { ...a, ...updated } as any : a));
      setEditAsset(null);
      toast.success('Güncellendi');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <div className="p-6 max-w-[1500px] mx-auto">
      <div className="mb-4 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Media Library</h1>
          <p className="text-sm text-muted-foreground">
            {assets.length} asset · {folders.length} klasör · yeniden kullanılabilir görsel/video
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={sourceFilter}
            onChange={e => setSourceFilter(e.target.value as any)}
            className="h-9 px-2 rounded-md border border-input text-sm bg-background"
          >
            <option value="ALL">Tüm kaynaklar</option>
            <option value="UPLOAD">Upload</option>
            <option value="UNSPLASH">Unsplash</option>
            <option value="AI_GENERATED">AI</option>
            <option value="URL_IMPORT">URL</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-4">
        {/* Folder sidebar */}
        <Card>
          <CardContent className="p-2 space-y-1">
            <button
              onClick={() => setActiveFolder(null)}
              className={`w-full text-left px-2 py-1.5 rounded text-sm hover:bg-muted/60 transition-colors flex items-center gap-2 ${activeFolder === null ? 'bg-muted font-medium' : ''}`}
            >
              <Folder className="h-4 w-4" /> Tümü
              <span className="ml-auto text-xs text-muted-foreground">{assets.length}</span>
            </button>
            {folders.map(f => (
              <button
                key={f}
                onClick={() => setActiveFolder(f)}
                className={`w-full text-left px-2 py-1.5 rounded text-sm hover:bg-muted/60 transition-colors flex items-center gap-2 ${activeFolder === f ? 'bg-muted font-medium' : ''}`}
              >
                <Folder className="h-4 w-4" /> {f}
              </button>
            ))}
            <div className="border-t my-2" />
            <p className="text-[11px] text-muted-foreground px-2">
              Klasör eklemek için bir asset'i düzenleyip folder alanını doldur.
            </p>
          </CardContent>
        </Card>

        {/* Grid */}
        <div>
          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="aspect-square" />)}
            </div>
          ) : assets.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center text-sm text-muted-foreground">
                <ImageIcon className="h-12 w-12 mx-auto mb-3 opacity-30" />
                Bu filtre için asset yok. Article veya post oluştururken yüklenen görseller buraya akar.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {assets.map(asset => {
                const SrcIcon = SOURCE_ICON[asset.source];
                const isVideo = asset.mimeType.startsWith('video/');
                return (
                  <Card key={asset.id} className="group overflow-hidden">
                    <div className="aspect-square bg-muted relative">
                      {isVideo ? (
                        <video src={asset.url} className="w-full h-full object-cover" muted />
                      ) : (
                        <img src={asset.thumbnail ?? asset.url} alt={asset.altText ?? asset.filename} className="w-full h-full object-cover" />
                      )}
                      <div className="absolute top-1 left-1 bg-background/90 rounded p-1">
                        {isVideo ? <Video className="h-3 w-3" /> : <SrcIcon className="h-3 w-3" />}
                      </div>
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                        <Button size="sm" variant="secondary" onClick={() => { setEditAsset(asset); setEditAlt(asset.altText ?? ''); setEditFolder(asset.folder ?? ''); }}>
                          <Edit3 className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => remove(asset.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <CardContent className="p-2">
                      <div className="text-xs font-medium truncate">{asset.filename}</div>
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>{asset.width && asset.height ? `${asset.width}×${asset.height}` : '—'}</span>
                        <span>{formatSize(asset.sizeBytes)}</span>
                      </div>
                      {asset.altText && (
                        <div className="text-[10px] text-muted-foreground italic line-clamp-1 mt-0.5">alt: {asset.altText}</div>
                      )}
                      {asset.usageCount > 0 && (
                        <div className="text-[10px] text-emerald-600 mt-0.5">
                          {asset.usageCount} kez kullanıldı
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Edit modal */}
      {editAsset && (
        <div className="fixed inset-0 bg-black/50 z-50 grid place-items-center p-4" onClick={() => setEditAsset(null)}>
          <Card className="max-w-md w-full" onClick={e => e.stopPropagation()}>
            <CardContent className="p-5 space-y-3">
              <h2 className="font-bold">Asset düzenle</h2>
              <div>
                <label className="text-xs font-medium block mb-1">Alt text (SEO + erişilebilirlik)</label>
                <Input value={editAlt} onChange={e => setEditAlt(e.target.value)} placeholder="Görselin kısa açıklaması" />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1">Klasör</label>
                <Input value={editFolder} onChange={e => setEditFolder(e.target.value)} placeholder="örn: campaigns/q1-2026" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setEditAsset(null)}>İptal</Button>
                <Button onClick={saveEdit}>Kaydet</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
