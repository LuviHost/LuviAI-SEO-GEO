import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle, type TextStyle } from 'react-native';
import Svg, { Path, Circle, Rect, Defs, RadialGradient, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import type { ProviderKey } from './api';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import { colors, fonts, radii } from './theme';

/* ══════════════ İkonlar ══════════════ */
type IconName =
  | 'arrowRight' | 'check' | 'bell' | 'sparkle' | 'globe' | 'upArrow' | 'search'
  | 'geo' | 'tabAgent' | 'tabVis' | 'tabAso' | 'tabStudio';

const P: Record<IconName, { d: string[]; fill?: boolean }> = {
  arrowRight: { d: ['M5 12h14', 'M13 6l6 6-6 6'] },
  search: { d: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14', 'M20.5 20.5L16.5 16.5'] },
  check: { d: ['M4 12.5l5 5L20 6.5'] },
  bell: { d: ['M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9', 'M13.7 21a2 2 0 0 1-3.4 0'] },
  sparkle: { d: ['M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z'] },
  globe: { d: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', 'M3 12h18', 'M12 3a14 14 0 0 1 0 18', 'M12 3a14 14 0 0 0 0 18'] },
  upArrow: { d: ['M12 19V5', 'M5 12l7-7 7 7'] },
  geo: { d: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', 'M15.5 8.5l-2 5-5 2 2-5Z'] },
  tabAgent: { d: ['M12 8.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4', 'M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1'] },
  tabVis: { d: ['M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z', 'M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9Z'] },
  tabAso: { d: ['M5 20V10', 'M12 20V4', 'M19 20v-7'] },
  tabStudio: { d: ['M3 5h18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z', 'M10 9.5l4.5 2.5-4.5 2.5Z'] },
};

export function Icon({
  name, size = 20, color = colors.text, strokeWidth = 2,
}: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  const def = P[name];
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {def.d.map((d, i) => (
        <Path key={i} d={d} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </Svg>
  );
}

/** feed satırı gibi keyfi tek-path stroke ikon */
export function PathIcon({ d, color, size = 13, strokeWidth = 2.2 }: { d: string; color: string; size?: number; strokeWidth?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d={d} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/* ══════════════ RanksUp logosu ══════════════ */
export function Logo({ size = 13, color = '#fff' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <Path d="M10 30 L30 10" stroke={color} strokeWidth={5.5} strokeLinecap="round" />
      <Path d="M17 8.5 L31.5 8.5 L31.5 23" stroke={color} strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/* ══════════════ Google "G" logosu (giriş butonu) ══════════════ */
export function GoogleG({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
      <Path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
      <Path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
      <Path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571.001-.001.002-.001.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
    </Svg>
  );
}

/* ══════════════ Apple logosu (Apple ile devam et) ══════════════ */
export function AppleLogo({ size = 18, color = '#fff' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </Svg>
  );
}

/* ══════════════ AI motoru marka logoları (birebir SVG) ══════════════ */
/** Web'deki VendorLogo ile aynı kaynaklar — açık zemin (tile) üzerinde doğal renklerinde. */
export function VendorLogo({ provider, size = 22 }: { provider: ProviderKey; size?: number }) {
  switch (provider) {
    case 'openai':
      return (
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Path fill="#10a37f" fillRule="evenodd" d="M20.348 0h59.304C90.891 0 100 9.184 100 20.516v58.968C100 90.816 90.89 100 79.652 100H20.348C9.109 100 0 90.816 0 79.484V20.516C0 9.184 9.11 0 20.348 0m0 0" />
          <Path fill="#fff" d="M73.96 44.926a13.95 13.95 0 0 0-1.194-11.45 14.11 14.11 0 0 0-15.184-6.761 13.94 13.94 0 0 0-10.426-4.688h-.12a14.1 14.1 0 0 0-13.411 9.762 13.94 13.94 0 0 0-9.32 6.758 14.17 14.17 0 0 0-1.907 7.078 14.1 14.1 0 0 0 3.641 9.45 13.96 13.96 0 0 0 1.195 11.45 14.105 14.105 0 0 0 15.184 6.76 13.93 13.93 0 0 0 10.422 4.688h.125a14.1 14.1 0 0 0 13.414-9.766 13.94 13.94 0 0 0 9.32-6.762 14.09 14.09 0 0 0-1.738-16.52m-21.026 29.39h-.016a10.47 10.47 0 0 1-6.695-2.43q.165-.087.332-.187l11.136-6.433c.567-.32.914-.922.918-1.575V47.977l4.707 2.718a.17.17 0 0 1 .09.13v13.007c-.004 5.781-4.691 10.473-10.472 10.484m-22.528-9.62a10.5 10.5 0 0 1-1.25-7.028c.082.05.227.14.332.2L40.625 64.3a1.81 1.81 0 0 0 1.832 0l13.598-7.852v5.438l.004.008a.18.18 0 0 1-.07.136l-11.259 6.5a10.506 10.506 0 0 1-14.324-3.836m-2.93-24.321a10.44 10.44 0 0 1 5.458-4.594c0 .094-.004.266-.004.383v12.879c0 .652.347 1.25.914 1.574L47.44 58.47l-4.707 2.718a.16.16 0 0 1-.156.012l-11.262-6.504a10.5 10.5 0 0 1-5.238-9.082c0-1.84.485-3.644 1.399-5.234Zm38.684 9.004-13.597-7.852 4.707-2.718a.17.17 0 0 1 .156-.016l11.261 6.504a10.48 10.48 0 0 1 5.243 9.078c0 4.395-2.743 8.324-6.86 9.84V50.949c0-.648-.347-1.25-.91-1.57m4.688-7.055q-.167-.1-.332-.195l-11.141-6.434a1.8 1.8 0 0 0-1.828 0l-13.602 7.852v-5.445a.17.17 0 0 1 .07-.137l11.258-6.496a10.5 10.5 0 0 1 5.239-1.403c5.789 0 10.484 4.696 10.484 10.485q0 .892-.148 1.773m-29.461 9.692-4.707-2.72a.17.17 0 0 1-.094-.128V36.164c.004-5.789 4.7-10.48 10.484-10.48 2.453.003 4.825.859 6.711 2.43a9 9 0 0 0-.332.187l-11.14 6.433c-.563.32-.914.922-.914 1.575v.007Zm2.558-5.512 6.055-3.5 6.059 3.496v6.996L50 56.992l-6.055-3.496Zm0 0" />
        </Svg>
      );
    case 'anthropic':
      return (
        <Svg width={size} height={size} viewBox="0 0 512 512">
          <Rect width="512" height="512" fill="#CC9B7A" rx="104.187" ry="105.042" />
          <Path fill="#1F1F1E" fillRule="nonzero" d="M318.663 149.787h-43.368l78.952 212.423 43.368.004zm-125.326 0-78.952 212.427h44.255l15.932-44.608 82.846-.004 16.107 44.612h44.255l-79.126-212.427zm-4.251 128.341 26.91-74.701 27.083 74.701z" />
        </Svg>
      );
    case 'gemini':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path fill="#8E75B2" d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81" />
        </Svg>
      );
    case 'perplexity':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path fill="#1FB8CD" d="M22.3977 7.0896h-2.3106V.0676l-7.5094 6.3542V.1577h-1.1554v6.1966L4.4904 0v7.0896H1.6023v10.3976h2.8882V24l6.932-6.3591v6.2005h1.1554v-6.0469l6.9318 6.1807v-6.4879h2.8882V7.0896zm-3.4657-4.531v4.531h-5.355l5.355-4.531zm-13.2862.0676 4.8691 4.4634H5.6458V2.6262zM2.7576 16.332V8.245h7.8476l-6.1149 6.1147v1.9723H2.7576zm2.8882 5.0404v-3.8852h.0001v-2.6488l5.7763-5.7764v7.0111l-5.7764 5.2993zm12.7086.0248-5.7766-5.1509V9.0618l5.7766 5.7766v6.5588zm2.8882-5.0652h-1.733v-1.9723L13.3948 8.245h7.8478v8.087z" />
        </Svg>
      );
    case 'xai':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path fill="#000000" d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z" />
        </Svg>
      );
    case 'deepseek':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path fill="#4D6BFE" d="M23.748 4.482c-.254-.124-.364.113-.512.234-.051.039-.094.09-.137.136-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.156-.708-.311-.955-.65-.172-.241-.219-.51-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.093.172.187.129.323-.082.28-.18.552-.266.833-.055.179-.137.217-.329.14a5.5 5.5 0 0 1-1.736-1.18c-.857-.828-1.631-1.742-2.597-2.458a11 11 0 0 0-.689-.471c-.985-.957.13-1.743.388-1.836.27-.098.093-.432-.779-.428s-1.67.295-2.687.684a3 3 0 0 1-.465.137 9.6 9.6 0 0 0-2.883-.102c-1.885.21-3.39 1.102-4.497 2.623C.082 8.606-.231 10.684.152 12.85c.403 2.284 1.569 4.175 3.36 5.653 1.858 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.133-.284 4.994-1.86.47.234.962.327 1.78.397.63.059 1.236-.03 1.705-.128.735-.156.684-.837.419-.961-2.155-1.004-1.682-.595-2.113-.926 1.096-1.296 2.746-2.642 3.392-7.003.05-.347.007-.565 0-.845-.004-.17.035-.237.23-.256a4.2 4.2 0 0 0 1.545-.475c1.396-.763 1.96-2.015 2.093-3.517.02-.23-.004-.467-.247-.588zM11.581 18c-2.089-1.642-3.102-2.183-3.52-2.16-.392.024-.321.471-.235.763.09.288.207.486.371.739.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.167-1.361-.802-2.5-1.86-3.301-3.307-.774-1.393-1.224-2.887-1.298-4.482-.02-.386.093-.522.477-.592a4.7 4.7 0 0 1 1.529-.039c2.132.312 3.946 1.265 5.468 2.774.868.86 1.525 1.887 2.202 2.891.72 1.066 1.494 2.082 2.48 2.914.348.292.625.514.891.677-.802.09-2.14.11-3.054-.614m1-6.44a.306.306 0 0 1 .415-.287.3.3 0 0 1 .2.288.306.306 0 0 1-.31.307.303.303 0 0 1-.304-.308zm3.11 1.596c-.2.081-.399.151-.59.16a1.25 1.25 0 0 1-.798-.254c-.274-.23-.47-.358-.552-.758a1.7 1.7 0 0 1 .016-.588c.07-.327-.008-.537-.239-.727-.187-.156-.426-.199-.688-.199a.56.56 0 0 1-.254-.078.253.253 0 0 1-.114-.358c.028-.054.16-.186.192-.21.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.391.451.462.576.685.914.176.265.336.537.445.848.067.195-.019.354-.25.452" />
        </Svg>
      );
    case 'meta':
      return (
        <Svg width={size} height={size} viewBox="0 0 200 200">
          <Defs>
            <SvgLinearGradient id="metaGrad" x1="0%" y1="100%" x2="100%" y2="0%">
              <Stop offset="0%" stopColor="#3CE4B6" />
              <Stop offset="35%" stopColor="#4A8DFF" />
              <Stop offset="65%" stopColor="#9747FF" />
              <Stop offset="100%" stopColor="#FF7DB1" />
            </SvgLinearGradient>
          </Defs>
          <Circle cx="100" cy="100" r="78" fill="none" stroke="url(#metaGrad)" strokeWidth="22" strokeLinecap="round" />
        </Svg>
      );
    default:
      return null;
  }
}

/* ══════════════ Alan adı favicon'u (Google s2) — yüklenene kadar harf yedeği, boş kutu olmaz ══════════════ */
export function DomainFavicon({ domain, brand, size = 44 }: { domain: string; brand?: string; size?: number }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const letter = (brand || domain || '?').charAt(0).toUpperCase();
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.29, backgroundColor: '#F5F0EA', borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {/* Favicon gelene kadar (veya hata) marka harfi göster — asla boş kalmaz */}
      {(!loaded || failed) && (
        <Text style={{ fontFamily: fonts.displayXBold, fontSize: size * 0.4, color: colors.emberDeep }}>{letter}</Text>
      )}
      {!failed && (
        <Image
          source={{ uri: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64` }}
          style={{ position: 'absolute', width: size * 0.62, height: size * 0.62, opacity: loaded ? 1 : 0 }}
          resizeMode="contain"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
    </View>
  );
}

/* ══════════════ Nefes alan orb ══════════════ */
export function Orb({ size = 64 }: { size?: number }) {
  const scale = useSharedValue(1);
  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.06, { duration: 1600, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View
      style={[
        {
          width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center',
          shadowColor: colors.ember, shadowOpacity: 0.65, shadowRadius: 22, shadowOffset: { width: 0, height: 0 },
          elevation: 16,
        },
        style,
      ]}
    >
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="orb" cx="32%" cy="28%" r="80%">
            <Stop offset="0%" stopColor="#F9A03F" />
            <Stop offset="45%" stopColor={colors.ember} />
            <Stop offset="100%" stopColor={colors.emberDeep} />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill="url(#orb)" />
      </Svg>
      <Logo size={size * 0.4} />
    </Animated.View>
  );
}

/* ══════════════ Ateş gradyanlı buton ══════════════ */
export function EmberButton({
  label, onPress, iconRight, style, height = 50,
}: { label: string; onPress?: () => void; iconRight?: React.ReactNode; style?: StyleProp<ViewStyle>; height?: number }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }, style]}>
      <LinearGradient
        colors={[colors.ember, colors.emberDeep]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.emberBtn, { height }]}
      >
        <Text style={styles.emberLabel}>{label}</Text>
        {iconRight}
      </LinearGradient>
    </Pressable>
  );
}

/* ══════════════ Ekran zemini (radyal ateş parıltısı) ══════════════ */
export function ScreenBg() {
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <RadialGradient id="glow" cx="50%" cy="-4%" r="62%">
          <Stop offset="0%" stopColor={colors.ember} stopOpacity={0.22} />
          <Stop offset="100%" stopColor={colors.ember} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={colors.bg} />
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#glow)" />
    </Svg>
  );
}

/* ══════════════ Dönen halka (spinner) ══════════════ */
export function Spinner({ size = 18, color = colors.ember, track = 'rgba(243,109,50,0.25)', border = 2, duration = 800 }:
  { size?: number; color?: string; track?: string; border?: number; duration?: number }) {
  const rot = useSharedValue(0);
  useEffect(() => {
    rot.value = withRepeat(withTiming(360, { duration, easing: Easing.linear }), -1, false);
  }, [rot, duration]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}deg` }] }));
  return (
    <Animated.View
      style={[
        { width: size, height: size, borderRadius: size / 2, borderWidth: border, borderColor: track, borderTopColor: color },
        style,
      ]}
    />
  );
}

/* ══════════════ "Örnek veri" rozeti (henüz canlıya bağlı değil) ══════════════ */
export function DemoBadge({ note = 'Örnek veri · hesap bağlanınca canlı' }: { note?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: 'rgba(251,191,36,0.1)', borderWidth: 1, borderColor: 'rgba(251,191,36,0.28)', marginBottom: 14 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.warn }} />
      <Text style={{ fontFamily: fonts.monoSemi, fontSize: 9.5, letterSpacing: 0.3, color: colors.warn }}>{note}</Text>
    </View>
  );
}

/* ══════════════ Kart / Pill ══════════════ */
export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Pill({ text, color, bg, border }: { text: string; color: string; bg: string; border: string }) {
  return (
    <View style={{ paddingHorizontal: 11, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: bg, borderWidth: 1, borderColor: border }}>
      <Text style={{ fontFamily: fonts.monoSemi, fontSize: 10, color }}>{text}</Text>
    </View>
  );
}

/* ══════════════ Metin yardımcıları ══════════════ */
export const T = {
  display: (size: number, color = '#fff', weight: 'bold' | 'xbold' | 'semi' = 'xbold'): TextStyle => ({
    fontFamily: weight === 'xbold' ? fonts.displayXBold : weight === 'bold' ? fonts.displayBold : fonts.displaySemi,
    fontSize: size, color, letterSpacing: -size * 0.03,
  }),
  body: (size: number, color = colors.text): TextStyle => ({ fontFamily: fonts.body, fontSize: size, color }),
  mono: (size: number, color = colors.textFaint): TextStyle => ({ fontFamily: fonts.mono, fontSize: size, color }),
};

const styles = StyleSheet.create({
  emberBtn: {
    borderRadius: radii.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    shadowColor: colors.emberMid, shadowOpacity: 0.4, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 8,
  },
  emberLabel: { fontFamily: fonts.bodyBold, fontSize: 14.5, color: '#fff' },
  card: { borderRadius: radii.xl, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft },
});
