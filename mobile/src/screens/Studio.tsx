import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts, radii } from '../theme';
import { useLang } from '../i18n';
import { useAuth } from '../auth';
import { studioGenerateText } from '../api';
import { Icon, Spinner, T, DemoBadge } from '../components';

type Gen = 'idle' | 'busy' | 'done';
const VCH = ['#E8E4DE', '#38BDF8', '#F472B6'];
const VBG = ['rgba(232,228,222,0.08)', 'rgba(56,189,248,0.1)', 'rgba(244,114,182,0.1)'];

export function StudioScreen() {
  const { t } = useLang();
  const { connected, token, activeSite } = useAuth();
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [gen, setGen] = useState<Gen>('idle');
  const [realText, setRealText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [channels, setChannels] = useState({ x: true, li: true, ig: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const live = connected && !!token && !!activeSite;

  const generate = async () => {
    setError(null);
    if (live) {
      if (!prompt.trim()) { setError('Önce ne üreteceğini yaz.'); return; }
      setGen('busy'); setRealText(null);
      try {
        const r = await studioGenerateText(token!, activeSite!.id, { prompt: prompt.trim(), format: 'medium', language: 'tr' });
        setRealText(r.text);
        setGen('done');
      } catch (e: any) {
        setError(e?.message ?? 'Üretim başarısız.');
        setGen('idle');
      }
    } else {
      // Bağlı değil → örnek (demo) akışı
      setRealText(null);
      setGen('busy');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setGen('done'), 1600);
    }
  };

  const chip = (active: boolean) =>
    active
      ? { bg: 'rgba(243,109,50,0.14)', border: 'rgba(243,109,50,0.5)', color: colors.emberLite }
      : { bg: 'transparent', border: colors.lineStrong, color: colors.textMute };
  const cx = chip(channels.x); const cli = chip(channels.li); const cig = chip(channels.ig);

  return (
    <View>
      <Text style={[T.display(24, '#fff'), { marginTop: 6 }]}>Studio</Text>
      <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.textMute, marginTop: 2, marginBottom: 12 }}>{t.st_sub}</Text>

      {live ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: 'rgba(52,211,153,0.1)', borderWidth: 1, borderColor: 'rgba(52,211,153,0.3)', marginBottom: 14 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.good }} />
          <Text style={{ fontFamily: fonts.monoSemi, fontSize: 9.5, color: colors.good }}>Canlı · {activeSite!.name}</Text>
        </View>
      ) : (
        <Pressable onPress={() => router.push('/connect')}>
          <DemoBadge note="Örnek üretim · bağlanmak için dokun" />
        </Pressable>
      )}

      {/* Prompt kartı */}
      <View style={{ borderRadius: radii.xl, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineStrong, padding: 15 }}>
        <TextInput
          value={prompt}
          onChangeText={(v) => { setPrompt(v); if (error) setError(null); }}
          placeholder={t.st_ph}
          placeholderTextColor="rgba(247,240,234,0.4)"
          multiline
          style={{ color: colors.text, fontFamily: fonts.body, fontSize: 13.5, lineHeight: 20, minHeight: 58, textAlignVertical: 'top' }}
        />
        <View style={{ flexDirection: 'row', gap: 7, marginTop: 10, flexWrap: 'wrap' }}>
          <ChanChip label="𝕏" {...cx} onPress={() => setChannels((c) => ({ ...c, x: !c.x }))} />
          <ChanChip label="LinkedIn" {...cli} onPress={() => setChannels((c) => ({ ...c, li: !c.li }))} />
          <ChanChip label="Instagram" {...cig} onPress={() => setChannels((c) => ({ ...c, ig: !c.ig }))} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 13 }}>
          <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap' }}>
            {(live ? ['Claude Haiku 4.5'] : ['GPT-5', 'DALL-E', 'Sora 2']).map((m) => (
              <View key={m} style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: 'rgba(247,240,234,0.06)' }}>
                <Text style={{ fontFamily: fonts.mono, fontSize: 8.5, color: colors.textMute }}>{m}</Text>
              </View>
            ))}
          </View>
          <Pressable onPress={generate} disabled={gen === 'busy'}>
            <LinearGradient colors={[colors.ember, colors.emberDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ height: 38, paddingHorizontal: 18, borderRadius: radii.md, flexDirection: 'row', alignItems: 'center', gap: 7, opacity: gen === 'busy' ? 0.7 : 1 }}>
              <Icon name="sparkle" size={12} color="#fff" strokeWidth={2} />
              <Text style={{ fontFamily: fonts.bodyBold, fontSize: 12.5, color: '#fff' }}>{t.st_gen}</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </View>

      {error && <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.crit, marginTop: 10 }}>{error}</Text>}

      {gen === 'busy' && (
        <View style={{ marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: radii.lg, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: 'rgba(243,109,50,0.2)' }}>
          <Spinner size={18} />
          <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 12, color: colors.textDim }}>{live ? 'AI üretiyor…' : t.st_busy}</Text>
        </View>
      )}

      {/* Gerçek üretim sonucu (bağlıyken) */}
      {gen === 'done' && realText && (
        <View style={{ marginTop: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <Text style={{ fontFamily: fonts.bodyBold, fontSize: 13.5, color: '#fff' }}>Sonuç</Text>
            <Text style={{ fontFamily: fonts.mono, fontSize: 9, color: colors.good }}>CANLI · Claude</Text>
          </View>
          <View style={{ borderRadius: 16, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, padding: 14 }}>
            <Text style={{ fontFamily: fonts.body, fontSize: 13, lineHeight: 21, color: 'rgba(247,240,234,0.88)' }}>{realText}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
              <View style={{ flex: 1, height: 34, borderRadius: 10, backgroundColor: 'rgba(243,109,50,0.12)', borderWidth: 1, borderColor: 'rgba(243,109,50,0.3)', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: fonts.bodyBold, fontSize: 11.5, color: colors.emberLite }}>{t.st_share}</Text>
              </View>
              <Pressable onPress={generate} style={{ flex: 1, height: 34, borderRadius: 10, borderWidth: 1, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: fonts.bodySemi, fontSize: 11.5, color: 'rgba(247,240,234,0.65)' }}>Yeniden üret</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {/* Örnek varyantlar (bağlı değilken) */}
      {gen === 'done' && !realText && (
        <View style={{ marginTop: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <Text style={{ fontFamily: fonts.bodyBold, fontSize: 13.5, color: '#fff' }}>{t.st_variants}</Text>
            <Text style={{ fontFamily: fonts.mono, fontSize: 9, color: colors.textFaint }}>ÖRNEK</Text>
          </View>
          <View style={{ gap: 10 }}>
            {t.variants.map((v, i) => (
              <View key={i} style={{ borderRadius: 16, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, padding: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
                  <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 5, backgroundColor: VBG[i] }}>
                    <Text style={{ fontFamily: fonts.monoSemi, fontSize: 8.5, letterSpacing: 1.4, color: VCH[i] }}>{v.channel}</Text>
                  </View>
                  <Text style={{ fontFamily: fonts.mono, fontSize: 9, color: colors.textGhost }}>{v.len}</Text>
                </View>
                <Text style={{ fontFamily: fonts.body, fontSize: 12.5, lineHeight: 20, color: 'rgba(247,240,234,0.8)' }}>{v.text}</Text>
                <Pressable onPress={() => router.push('/connect')} style={{ marginTop: 12, height: 34, borderRadius: 10, backgroundColor: 'rgba(243,109,50,0.12)', borderWidth: 1, borderColor: 'rgba(243,109,50,0.3)', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontFamily: fonts.bodyBold, fontSize: 11.5, color: colors.emberLite }}>Canlı üretim için bağlan</Text>
                </Pressable>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

function ChanChip({ label, bg, border, color, onPress }: { label: string; bg: string; border: string; color: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: radii.pill, backgroundColor: bg, borderWidth: 1, borderColor: border }}>
      <Text style={{ fontFamily: fonts.bodyBold, fontSize: 11.5, color }}>{label}</Text>
    </Pressable>
  );
}
