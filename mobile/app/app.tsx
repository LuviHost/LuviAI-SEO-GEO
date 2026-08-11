import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts, radii } from '../src/theme';
import { useLang } from '../src/i18n';
import { useAuth } from '../src/auth';
import { Icon, Logo, ScreenBg } from '../src/components';
import { AgentScreen } from '../src/screens/Agent';
import { VisibilityScreen } from '../src/screens/Visibility';
import { AsoScreen } from '../src/screens/Aso';
import { StudioScreen } from '../src/screens/Studio';

type Screen = 'home' | 'vis' | 'aso' | 'studio';

export default function AppShell() {
  const { t, lang, toggle } = useLang();
  const { connected } = useAuth();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // ?tab=vis|aso|studio ile derin bağlantı — sekmeye doğrudan açılış
  const params = useLocalSearchParams<{ tab?: string }>();
  const [screen, setScreen] = useState<Screen>((params.tab as Screen) || 'home');
  useEffect(() => {
    const validTabs: Screen[] = ['home', 'vis', 'aso', 'studio'];
    if (params.tab && validTabs.includes(params.tab as Screen)) setScreen(params.tab as Screen);
  }, [params.tab]);

  const tabs: { key: Screen; label: string; icon: 'tabAgent' | 'tabVis' | 'tabAso' | 'tabStudio' }[] = [
    { key: 'home', label: t.tab_agent, icon: 'tabAgent' },
    { key: 'vis', label: t.tab_vis, icon: 'tabVis' },
    { key: 'aso', label: 'ASO', icon: 'tabAso' },
    { key: 'studio', label: 'Studio', icon: 'tabStudio' },
  ];

  const renderTab = (tab: (typeof tabs)[number]) => {
    const on = screen === tab.key;
    const c = on ? colors.emberLite : 'rgba(247,240,234,0.38)';
    return (
      <Pressable key={tab.key} onPress={() => setScreen(tab.key)} style={{ alignItems: 'center', gap: 4, width: 62 }}>
        <Icon name={tab.icon} size={20} color={c} strokeWidth={2} />
        <Text style={{ fontFamily: fonts.bodyBold, fontSize: 9.5, color: c }}>{tab.label}</Text>
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
            <Text style={{ color: '#fff' }}>Ranks</Text>
            <Text style={{ color: colors.emberLite }}>Up</Text>
          </Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable onPress={toggle} style={{ flexDirection: 'row', alignItems: 'center', height: 30, paddingHorizontal: 11, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: 'rgba(33,23,18,0.8)', gap: 5 }}>
            <Text style={{ fontFamily: fonts.monoSemi, fontSize: 10, color: lang === 'tr' ? colors.emberLite : 'rgba(247,240,234,0.4)' }}>TR</Text>
            <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: 'rgba(247,240,234,0.25)' }}>/</Text>
            <Text style={{ fontFamily: fonts.monoSemi, fontSize: 10, color: lang === 'en' ? colors.emberLite : 'rgba(247,240,234,0.4)' }}>EN</Text>
          </Pressable>
          <View style={{ width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(33,23,18,0.8)' }}>
            <Icon name="bell" size={14} color="rgba(247,240,234,0.6)" strokeWidth={1.8} />
            <View style={{ position: 'absolute', top: 5, right: 6, width: 6, height: 6, borderRadius: 3, backgroundColor: colors.ember, borderWidth: 1.5, borderColor: colors.bg }} />
          </View>
          <Pressable onPress={() => router.push('/connect')} hitSlop={6}>
            <LinearGradient colors={['#7C3AED', '#4F46E5']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: fonts.displayBold, fontSize: 10, color: '#fff' }}>MK</Text>
            </LinearGradient>
            {/* Bağlı göstergesi */}
            <View style={{ position: 'absolute', bottom: -1, right: -1, width: 10, height: 10, borderRadius: 5, backgroundColor: connected ? colors.good : 'rgba(247,240,234,0.3)', borderWidth: 2, borderColor: colors.bg }} />
          </Pressable>
        </View>
      </View>

      {/* ── İçerik ── */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 104 + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        {screen === 'home' && <AgentScreen />}
        {screen === 'vis' && <VisibilityScreen />}
        {screen === 'aso' && <AsoScreen />}
        {screen === 'studio' && <StudioScreen />}
      </ScrollView>

      {/* ── Alt bar — 5 yuvalı, ortada yükseltilmiş analiz butonu ── */}
      <LinearGradient
        colors={['rgba(23,16,11,0)', 'rgba(23,16,11,0.92)', colors.bg]}
        locations={[0, 0.42, 1]}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 14, paddingTop: 22, paddingBottom: insets.bottom + 8 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.lineSoft, paddingTop: 9 }}>
          {tabs.slice(0, 2).map(renderTab)}

          {/* Orta — site analiz butonu (yükseltilmiş, sadece ikon) */}
          <Pressable onPress={() => router.push('/analyze')} style={({ pressed }) => ({ alignItems: 'center', width: 62, opacity: pressed ? 0.9 : 1 })} hitSlop={8}>
            <LinearGradient
              colors={[colors.ember, colors.emberDeep]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginTop: -26, borderWidth: 4, borderColor: colors.bg, shadowColor: colors.ember, shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 12 }}
            >
              <Icon name="search" size={23} color="#fff" strokeWidth={2.5} />
            </LinearGradient>
          </Pressable>

          {tabs.slice(2, 4).map(renderTab)}
        </View>
      </LinearGradient>
    </View>
  );
}
