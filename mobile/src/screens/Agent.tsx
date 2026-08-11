import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { colors, fonts, radii } from '../theme';
import { useLang, FEED_ICONS } from '../i18n';
import { Orb, Icon, PathIcon, T } from '../components';

type Approval = 'open' | 'approved' | 'rejected';

export function AgentScreen() {
  const { t } = useLang();
  const [approval, setApproval] = useState<Approval>('open');

  return (
    <View>
      {/* Hero */}
      <View style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 20 }}>
        <Orb size={64} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 15 }}>
          <Dot />
          <Text style={{ fontFamily: fonts.monoSemi, fontSize: 9.5, letterSpacing: 3, color: colors.emberLite }}>{t.home_kicker}</Text>
          <Dot />
        </View>
        <Text style={[T.display(23, '#fff', 'bold'), { textAlign: 'center', marginTop: 10, maxWidth: 290, lineHeight: 29 }]}>{t.home_title}</Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.textMute, marginTop: 6 }}>{t.home_sub}</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
          <MiniChip text="+12 citation" color={colors.emberLite} bg="rgba(243,109,50,0.1)" border="rgba(243,109,50,0.25)" />
          <MiniChip text="−23% CPI" color={colors.good} bg="rgba(52,211,153,0.08)" border="rgba(52,211,153,0.22)" />
          <MiniChip text={`3 ${t.home_newkw}`} color={colors.warn} bg="rgba(251,191,36,0.08)" border="rgba(251,191,36,0.22)" />
        </View>
      </View>

      {/* Timeline */}
      <View style={{ paddingLeft: 26 }}>
        <View style={{ position: 'absolute', left: 8, top: 8, bottom: 8, width: 2, backgroundColor: 'rgba(243,109,50,0.18)' }} />

        {/* Onay bekleyen kart */}
        <View style={{ marginBottom: 12 }}>
          <View style={[dotStyle, { backgroundColor: colors.ember, shadowColor: colors.ember, shadowOpacity: 0.8, shadowRadius: 6, shadowOffset: { width: 0, height: 0 }, elevation: 6 }]} />
          <View style={{ borderRadius: radii.xl, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: approval === 'open' ? 'rgba(243,109,50,0.35)' : colors.line, padding: 15 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
              <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: badgeBg(approval), }}>
                <Text style={{ fontFamily: fonts.monoSemi, fontSize: 8.5, letterSpacing: 1.7, color: badgeColor(approval) }}>{badgeText(approval, t)}</Text>
              </View>
              <Text style={{ fontFamily: fonts.mono, fontSize: 9.5, color: colors.textGhost }}>{t.now}</Text>
            </View>
            <Text style={{ fontFamily: fonts.bodyBold, fontSize: 14, color: '#fff', lineHeight: 19 }}>{t.pend_title}</Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 12, lineHeight: 18.5, color: colors.textDim, marginTop: 5 }}>{t.pend_desc}</Text>

            {approval === 'open' ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 13 }}>
                <Pressable onPress={() => setApproval('approved')} style={{ flex: 1 }}>
                  <View style={{ height: 38, borderRadius: radii.md, backgroundColor: colors.ember, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    <Icon name="check" size={12} color="#fff" strokeWidth={3} />
                    <Text style={{ fontFamily: fonts.bodyBold, fontSize: 12.5, color: '#fff' }}>{t.approve}</Text>
                  </View>
                </Pressable>
                <Pressable onPress={() => setApproval('rejected')} style={{ flex: 1 }}>
                  <View style={{ height: 38, borderRadius: radii.md, borderWidth: 1, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontFamily: fonts.bodySemi, fontSize: 12.5, color: 'rgba(247,240,234,0.7)' }}>{t.reject}</Text>
                  </View>
                </Pressable>
              </View>
            ) : (
              <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 11, backgroundColor: approval === 'approved' ? 'rgba(52,211,153,0.1)' : 'rgba(247,240,234,0.05)', borderWidth: 1, borderColor: approval === 'approved' ? 'rgba(52,211,153,0.3)' : colors.line }}>
                <Icon name="check" size={14} color={approval === 'approved' ? colors.good : colors.textMute} strokeWidth={3} />
                <Text style={{ flex: 1, fontFamily: fonts.bodyBold, fontSize: 12, color: approval === 'approved' ? colors.good : colors.textMute }}>
                  {approval === 'approved' ? t.approved_msg : t.rejected_msg}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Feed */}
        {t.feed.map((f, i) => {
          const [iconColor, iconPath] = FEED_ICONS[i % FEED_ICONS.length];
          const badge = f.badge === 'auto' ? t.auto : f.badge === 'queued' ? t.queued : null;
          return (
            <View key={i} style={{ marginBottom: 12 }}>
              <View style={[dotStyle, { backgroundColor: colors.bgElev2 }]} />
              <View style={{ borderRadius: radii.xl, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft, paddingHorizontal: 15, paddingVertical: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                    <PathIcon d={iconPath} color={iconColor} size={13} />
                    <Text style={{ fontFamily: fonts.bodyBold, fontSize: 13, color: '#fff' }}>{f.title}</Text>
                  </View>
                  <Text style={{ fontFamily: fonts.mono, fontSize: 9.5, color: colors.textGhost }}>{f.time}</Text>
                </View>
                <Text style={{ fontFamily: fonts.body, fontSize: 12, lineHeight: 18, color: colors.textDim }}>{f.desc}</Text>
                {badge && (
                  <View style={{ alignSelf: 'flex-start', marginTop: 8, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5, borderWidth: 1, borderColor: f.badge === 'queued' ? 'rgba(251,191,36,0.3)' : colors.lineStrong, backgroundColor: f.badge === 'queued' ? 'rgba(251,191,36,0.07)' : 'transparent' }}>
                    <Text style={{ fontFamily: fonts.monoSemi, fontSize: 8.5, letterSpacing: 1.3, color: f.badge === 'queued' ? colors.warn : colors.textGhost }}>{badge}</Text>
                  </View>
                )}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const dotStyle = { position: 'absolute' as const, left: -24, top: 16, width: 12, height: 12, borderRadius: 6, borderWidth: 3, borderColor: colors.bg, zIndex: 2 };

function Dot() {
  return <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.ember }} />;
}
function MiniChip({ text, color, bg, border }: { text: string; color: string; bg: string; border: string }) {
  return (
    <View style={{ paddingHorizontal: 11, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: bg, borderWidth: 1, borderColor: border }}>
      <Text style={{ fontFamily: fonts.monoSemi, fontSize: 10, color }}>{text}</Text>
    </View>
  );
}
function badgeText(a: Approval, t: ReturnType<typeof useLang>['t']) {
  return a === 'approved' ? t.approved_badge : a === 'rejected' ? t.rejected_badge : t.pend_badge;
}
function badgeColor(a: Approval) {
  return a === 'approved' ? colors.good : a === 'rejected' ? colors.textMute : colors.emberLite;
}
function badgeBg(a: Approval) {
  return a === 'approved' ? 'rgba(52,211,153,0.12)' : a === 'rejected' ? 'rgba(247,240,234,0.06)' : 'rgba(243,109,50,0.12)';
}
