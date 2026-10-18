import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts, radii, type } from '../src/theme';
import { useLang } from '../src/i18n';
import { useAuth } from '../src/auth';
import { getUnreadCount } from '../src/api';
import { initialsFrom } from '../src/account';
import { Icon, Logo, ScreenBg } from '../src/components';
import { HomeScreen } from '../src/screens/Home';
import { VisibilityScreen } from '../src/screens/Visibility';
import { AsoScreen } from '../src/screens/Aso';

// Studio sekmesi kaldirildi: cagirdigi /sites/:id/studio/text ucu 78ebd14'te (studio/sosyal/video
// API'si) silindi; her uretim 404 aliyordu ve ornek akis artik sunulmayan video/sosyal
// paylasimi tanitiyordu.
type Screen = 'home' | 'vis' | 'aso';
const VALID_TABS: Screen[] = ['home', 'vis', 'aso'];

function asScreen(v: unknown): Screen | null {
  return typeof v === 'string' && (VALID_TABS as string[]).includes(v) ? (v as Screen) : null;
}

type TabIcon = 'tabAgent' | 'tabVis' | 'tabAso' | 'user';

export default function AppShell() {
  const { t, lang, toggle } = useLang();
  const { connected, token, me } = useAuth();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // ?tab=vis|aso ile derin bağlantı — sekmeye doğrudan açılış (eski ?tab=studio ana sayfaya düşer)
  // ?analyze=<alan adı> — ilk açılıştaki "Siteni analiz et" analiz ekranını uygulamanın üstünde açar
  const params = useLocalSearchParams<{ tab?: string; analyze?: string }>();
  const [screen, setScreen] = useState<Screen>(asScreen(params.tab) ?? 'home');
  useEffect(() => {
    const tab = asScreen(params.tab);
    if (tab) setScreen(tab);
  }, [params.tab]);

  const handledAnalyze = useRef<string | null>(null);
  useEffect(() => {
    const domain = typeof params.analyze === 'string' ? params.analyze.trim() : '';
    if (!domain || handledAnalyze.current === domain) return;
    handledAnalyze.current = domain;
    router.push({ pathname: '/analyze', params: { domain } });
  }, [params.analyze, router]);

  // Zil yalnız gerçek okunmamış bildirim varsa işaretlenir (eskiden nokta hep yanıyordu)
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!token) {
      setUnread(0);
      return;
    }
    let alive = true;
    getUnreadCount(token)
      .then((n) => { if (alive) setUnread(n); })
      .catch(() => { if (alive) setUnread(0); });
    return () => { alive = false; };
  }, [token, screen]);

  const initials = connected ? initialsFrom(me?.name, me?.email) : '';

  const tabs: { key: Screen | 'account'; label: string; icon: TabIcon }[] = [
    { key: 'home', label: t.tab_home, icon: 'tabAgent' },
    { key: 'vis', label: t.tab_vis, icon: 'tabVis' },
    { key: 'aso', label: 'ASO', icon: 'tabAso' },
    // Hesap: bağlantı, yasal metinler ve hesap silme (5.1.1) tek dokunuşla
    { key: 'account', label: t.tab_account, icon: 'user' },
  ];

  const renderTab = (tab: (typeof tabs)[number]) => {
    const on = tab.key !== 'account' && screen === tab.key;
    const c = on ? colors.emberLite : colors.textFaint;
    const onPress = () => (tab.key === 'account' ? router.push('/connect') : setScreen(tab.key));
    return (
      <Pressable
        key={tab.key}
        onPress={onPress}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        accessibilityLabel={tab.label}
        style={{ alignItems: 'center', gap: 4, width: 62 }}
      >
        <Icon name={tab.icon} size={20} color={c} strokeWidth={2} />
        <Text style={{ ...type.micro, fontFamily: fonts.bodyBold, letterSpacing: 0, color: c }} numberOfLines={1}>{tab.label}</Text>
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      <ScreenBg />

      {/* ── Header ── */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: insets.top + 8, paddingBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <LinearGradient colors={[colors.ember, colors.emberDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 27, height: 27, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
            <Logo size={13} />
          </LinearGradient>
          <Text style={{ fontFamily: fonts.displayBold, fontSize: 15.5, letterSpacing: -0.4 }}>
            <Text style={{ color: colors.text }}>Ranks</Text>
            <Text style={{ color: colors.emberLite }}>Up</Text>
          </Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable onPress={toggle} accessibilityRole="button" accessibilityLabel={lang === 'tr' ? 'Dili İngilizce yap' : 'Switch to Turkish'} style={{ flexDirection: 'row', alignItems: 'center', height: 30, paddingHorizontal: 11, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.bgElev, gap: 5 }}>
            <Text style={{ ...type.data, fontFamily: fonts.monoSemi, color: lang === 'tr' ? colors.emberLite : colors.textFaint }}>TR</Text>
            <Text style={{ ...type.data, color: colors.textGhost }}>/</Text>
            <Text style={{ ...type.data, fontFamily: fonts.monoSemi, color: lang === 'en' ? colors.emberLite : colors.textFaint }}>EN</Text>
          </Pressable>
          {connected && (
            <Pressable
              onPress={() => setScreen('home')}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={unread > 0 ? t.hdr_bell_unread(unread) : t.hdr_bell}
              style={{ width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgElev }}
            >
              <Icon name="bell" size={14} color={colors.textDim} strokeWidth={1.8} />
              {unread > 0 && (
                <View style={{ position: 'absolute', top: 5, right: 6, width: 6, height: 6, borderRadius: 3, backgroundColor: colors.ember, borderWidth: 1.5, borderColor: colors.bg }} />
              )}
            </Pressable>
          )}
          <Pressable onPress={() => router.push('/connect')} hitSlop={6} accessibilityRole="button" accessibilityLabel={t.hdr_account}>
            {initials ? (
              <LinearGradient colors={[colors.ember, colors.emberDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ ...type.micro, fontFamily: fonts.displayBold, letterSpacing: 0, color: colors.text }}>{initials}</Text>
              </LinearGradient>
            ) : (
              <View style={{ width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgElev }}>
                <Icon name="user" size={14} color={colors.textDim} strokeWidth={1.8} />
              </View>
            )}
            {/* Bağlı göstergesi */}
            <View style={{ position: 'absolute', bottom: -1, right: -1, width: 10, height: 10, borderRadius: 5, backgroundColor: connected ? colors.good : colors.textGhost, borderWidth: 2, borderColor: colors.bg }} />
          </Pressable>
        </View>
      </View>

      {/* ── İçerik ── */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 104 + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        {screen === 'home' && <HomeScreen onOpenTab={setScreen} />}
        {screen === 'vis' && <VisibilityScreen />}
        {screen === 'aso' && <AsoScreen />}
      </ScrollView>

      {/* ── Alt bar — iki yanda ikişer sekme, ortada yükseltilmiş analiz butonu ── */}
      <LinearGradient
        colors={['rgba(23,16,11,0)', 'rgba(23,16,11,0.92)', colors.bg]}
        locations={[0, 0.42, 1]}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 14, paddingTop: 22, paddingBottom: insets.bottom + 8 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.lineSoft, paddingTop: 9 }}>
          {tabs.slice(0, 2).map(renderTab)}

          {/* Orta — site analiz butonu (yükseltilmiş, sadece ikon) */}
          <Pressable onPress={() => router.push('/analyze')} accessibilityRole="button" accessibilityLabel={t.tab_analyze} style={({ pressed }) => ({ alignItems: 'center', width: 62, opacity: pressed ? 0.9 : 1 })} hitSlop={8}>
            <LinearGradient
              colors={[colors.ember, colors.emberDeep]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginTop: -26, borderWidth: 4, borderColor: colors.bg, shadowColor: colors.ember, shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 12 }}
            >
              <Icon name="search" size={23} color={colors.text} strokeWidth={2.5} />
            </LinearGradient>
          </Pressable>

          {tabs.slice(2, 4).map(renderTab)}
        </View>
      </LinearGradient>
    </View>
  );
}
