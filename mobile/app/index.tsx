import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors, fonts, radii } from '../src/theme';
import { useLang } from '../src/i18n';
import { Orb, Icon, EmberButton, ScreenBg, Spinner, T } from '../src/components';

type Phase = 'ob1' | 'ob2' | 'ob3';

export default function Onboarding() {
  const { t } = useLang();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('ob1');
  const [url, setUrl] = useState('');
  const [scanStep, setScanStep] = useState(0);

  // AI analiz simülasyonu — 750ms adımlarla 5 satır, sonra "Hazır"
  useEffect(() => {
    if (phase !== 'ob2') return;
    setScanStep(0);
    const iv = setInterval(() => {
      setScanStep((s) => {
        const n = s + 1;
        if (n >= 5) {
          clearInterval(iv);
          setTimeout(() => setPhase('ob3'), 700);
        }
        return n;
      });
    }, 750);
    return () => clearInterval(iv);
  }, [phase]);

  const top = insets.top + 20;
  const finish = () => router.replace('/app');

  return (
    <View style={{ flex: 1 }}>
      <ScreenBg />

      {phase === 'ob1' && (
        <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: top }}>
          <View style={{ alignItems: 'flex-end', paddingTop: 6 }}>
            <Pressable onPress={() => setPhase('ob2')} hitSlop={10}>
              <Text style={{ fontFamily: fonts.bodySemi, fontSize: 12, color: 'rgba(247,240,234,0.45)', padding: 6 }}>{t.skip}</Text>
            </Pressable>
          </View>

          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Orb size={64} />
            <Text style={{ fontFamily: fonts.monoSemi, fontSize: 9.5, letterSpacing: 3, color: colors.emberLite, marginTop: 22 }}>
              AI VISIBILITY PLATFORM
            </Text>
            <Text style={[T.display(27, '#fff'), { textAlign: 'center', marginTop: 12, maxWidth: 300, lineHeight: 33 }]}>
              {t.ob1_title}
            </Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 13, lineHeight: 21, color: colors.textMute, textAlign: 'center', marginTop: 10, maxWidth: 280 }}>
              {t.ob1_sub}
            </Text>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 26, width: '100%', maxWidth: 330 }}>
              <View style={{ flex: 1, height: 50, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 16, borderRadius: radii.lg, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineStrong }}>
                <Icon name="globe" size={15} color="rgba(247,240,234,0.4)" strokeWidth={2} />
                <TextInput
                  value={url}
                  onChangeText={setUrl}
                  placeholder={t.ob1_ph}
                  placeholderTextColor="rgba(247,240,234,0.35)"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  style={{ flex: 1, color: colors.text, fontFamily: fonts.mono, fontSize: 13 }}
                />
              </View>
            </View>

            <EmberButton
              label={t.ob1_cta}
              onPress={() => setPhase('ob2')}
              iconRight={<Icon name="arrowRight" size={13} color="#fff" strokeWidth={2.6} />}
              style={{ marginTop: 12, width: '100%', maxWidth: 330 }}
            />
            <Text style={{ fontFamily: fonts.mono, fontSize: 9.5, letterSpacing: 0.8, color: 'rgba(247,240,234,0.35)', marginTop: 14 }}>
              {t.ob1_note}
            </Text>
          </View>
        </View>
      )}

      {phase === 'ob2' && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingTop: top }}>
          <View style={{ width: 120, height: 120, alignItems: 'center', justifyContent: 'center' }}>
            <Spinner size={120} border={2} color="rgba(243,109,50,0.4)" track="transparent" duration={7000} />
            <View style={{ position: 'absolute' }}>
              <Orb size={56} />
            </View>
          </View>
          <Text style={{ fontFamily: fonts.monoSemi, fontSize: 9.5, letterSpacing: 3, color: colors.emberLite, marginTop: 24 }}>{t.ob2_kicker}</Text>
          <Text style={[T.display(23, '#fff', 'bold'), { marginTop: 10 }]}>{t.scan_titles[Math.min(scanStep, 5)]}</Text>
          <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.textMute, marginTop: 6 }}>{url.trim() || 'kobipratik.com'}</Text>

          <View style={{ marginTop: 26, width: '100%', maxWidth: 310, gap: 9 }}>
            {t.scan_steps.map((label, i) => {
              const done = i < Math.min(scanStep, 5);
              const active = i === Math.min(scanStep, 5);
              return (
                <View
                  key={i}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 13,
                    backgroundColor: done ? 'rgba(52,211,153,0.06)' : active ? 'rgba(243,109,50,0.08)' : 'rgba(33,23,18,0.6)',
                    borderWidth: 1, borderColor: done ? 'rgba(52,211,153,0.25)' : active ? 'rgba(243,109,50,0.35)' : colors.lineSoft,
                  }}
                >
                  {done ? (
                    <Icon name="check" size={15} color={colors.good} strokeWidth={3} />
                  ) : active ? (
                    <Spinner size={13} border={2} />
                  ) : (
                    <View style={{ width: 13, height: 13, borderRadius: 7, borderWidth: 1.5, borderColor: 'rgba(247,240,234,0.15)' }} />
                  )}
                  <Text style={{ flex: 1, fontFamily: fonts.bodySemi, fontSize: 12.5, color: done ? colors.text : active ? colors.emberLite : 'rgba(247,240,234,0.35)' }}>{label}</Text>
                  <Text style={{ fontFamily: fonts.mono, fontSize: 9, color: 'rgba(247,240,234,0.3)' }}>{done ? 'OK' : active ? '···' : ''}</Text>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {phase === 'ob3' && (
        <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingTop: top, paddingBottom: 30 }}>
          <View style={{ width: 66, height: 66, borderRadius: 33, backgroundColor: 'rgba(52,211,153,0.12)', borderWidth: 1.5, borderColor: 'rgba(52,211,153,0.4)', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={28} color={colors.good} strokeWidth={2.6} />
          </View>
          <Text style={[T.display(26, '#fff'), { marginTop: 18, textAlign: 'center' }]}>{t.ob3_title}</Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 13, lineHeight: 21, color: colors.textMute, textAlign: 'center', marginTop: 8, maxWidth: 280 }}>{t.ob3_sub}</Text>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 24, width: '100%', maxWidth: 320 }}>
            <StatBox k={t.ob3_sector} v="KOBİ finans" />
            <StatBox k="KEYWORD" v={`50 ${t.ob3_found}`} />
            <StatBox k={t.ob3_comp} v={`3 ${t.ob3_found}`} />
            <StatBox k={t.ob3_plan} v={t.ob3_ready} accent />
          </View>

          <EmberButton
            label={t.ob3_cta}
            onPress={finish}
            iconRight={<Icon name="arrowRight" size={13} color="#fff" strokeWidth={2.6} />}
            style={{ marginTop: 24, width: '100%', maxWidth: 320 }}
          />
        </ScrollView>
      )}
    </View>
  );
}

function StatBox({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <View style={{ width: '47.5%', flexGrow: 1, borderRadius: 15, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: accent ? 'rgba(243,109,50,0.3)' : colors.line, padding: 13 }}>
      <Text style={{ fontFamily: fonts.mono, fontSize: 8.5, letterSpacing: 1.2, color: accent ? colors.emberLite : colors.textFaint }}>{k}</Text>
      <Text style={{ fontFamily: fonts.bodyBold, fontSize: 13, color: accent ? colors.emberLite : '#fff', marginTop: 4 }}>{v}</Text>
    </View>
  );
}
