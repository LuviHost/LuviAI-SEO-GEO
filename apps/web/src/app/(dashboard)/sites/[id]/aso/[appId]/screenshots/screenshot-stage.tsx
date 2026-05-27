'use client';

import { forwardRef } from 'react';
import { Stage, Layer, Rect, Image as KonvaImage, Text as KonvaText, Group, Circle, RegularPolygon } from 'react-konva';
import type Konva from 'konva';
import { PHONE_FRAMES } from './phone-frames';
import type { FrameStyle } from './phone-frames';
import type { Decoration } from './panorama-themes';

export interface SlotData {
  background: { type: 'gradient' | 'solid' | 'image'; value: string; image?: HTMLImageElement };
  bgOverlay?: 'none' | 'dark' | 'light' | 'top-fade' | 'bottom-fade';
  hook: string;
  subtitle: string;
  hookFontSize: number;
  textColor: string;
  textPosition: 'top' | 'bottom';
  textAlign?: 'left' | 'center' | 'right';
  phoneFrameId: string;
  phoneFrameStyle?: FrameStyle;  // 'solid' (default) | 'glass' | 'outline'
  phoneTilt: number;
  phoneScale: number;
  phoneLayout?: 'single' | 'duo' | 'trio';
  phoneVerticalAlign?: 'top' | 'center' | 'bottom';
  // Drop shadow per element (0-100)
  phoneShadow?: number;       // default 70
  textShadow?: number;        // default 30
  // Hand-holding-phone mockup
  handMockup?: 'none' | 'left' | 'right' | 'bottom';  // hand silhouette behind phone
  handSkinTone?: string;       // hex color, default natural skin
  // Reflection — telefon altında ayna yansıması (shots.so polish)
  phoneReflection?: boolean;
  phoneReflectionOpacity?: number;  // 0-100, default 40
  screenshot?: HTMLImageElement;
  screenshot2?: HTMLImageElement;
  screenshot3?: HTMLImageElement;
  decorations?: Decoration[];
  // Typography
  fontFamily?: string;              // e.g. "Poppins", "Montserrat" — default "Inter"
  textGradient?: { from: string; to: string };  // hook'a gradient fill (her ikisi varsa textColor override)
}

interface ScreenshotStageProps {
  slot: SlotData;
  width: number;
  height: number;
  viewWidth: number;
}

function estimateTextLines(text: string, fontSize: number, maxWidth: number): number {
  if (!text) return 0;
  const avgCharWidth = fontSize * 0.55;
  const charsPerLine = Math.max(1, Math.floor(maxWidth / avgCharWidth));
  const words = text.split(/\s+/);
  let lines = 1;
  let currentLineLen = 0;
  for (const word of words) {
    const wordLen = word.length + 1;
    if (currentLineLen + wordLen > charsPerLine) {
      lines++;
      currentLineLen = wordLen;
    } else {
      currentLineLen += wordLen;
    }
  }
  return Math.max(1, lines);
}

export const ScreenshotStage = forwardRef<Konva.Stage, ScreenshotStageProps>(({ slot, width, height, viewWidth }, ref) => {
  const viewHeight = (viewWidth * height) / width;
  const scale = viewWidth / width;

  const hookFontSize = slot.hookFontSize;
  const subtitleFontSize = Math.max(28, hookFontSize * 0.4);
  const lineHeightMul = 1.15;
  const subtitleLineHeight = 1.35;

  const hookMaxWidth = width * 0.9;
  const subtitleMaxWidth = width * 0.8;

  const hookLines = estimateTextLines(slot.hook, hookFontSize, hookMaxWidth);
  const subtitleLines = estimateTextLines(slot.subtitle, subtitleFontSize, subtitleMaxWidth);

  const hookHeight = slot.hook ? hookLines * hookFontSize * lineHeightMul : 0;
  const subtitleHeight = slot.subtitle ? subtitleLines * subtitleFontSize * subtitleLineHeight : 0;

  const padding = height * 0.025;
  const topMargin = height * 0.06;
  const bottomMargin = height * 0.04;
  const align = slot.textAlign ?? 'center';

  let hookY: number, subtitleY: number, phoneCenterY: number;

  if (slot.textPosition === 'top') {
    hookY = topMargin;
    subtitleY = hookY + hookHeight + padding;
    const textBlockBottom = subtitleY + subtitleHeight + padding;
    const remainingSpace = height - textBlockBottom - bottomMargin;
    const verticalAlign = slot.phoneVerticalAlign ?? 'center';
    if (verticalAlign === 'top') phoneCenterY = textBlockBottom + remainingSpace * 0.3;
    else if (verticalAlign === 'bottom') phoneCenterY = textBlockBottom + remainingSpace * 0.7;
    else phoneCenterY = textBlockBottom + remainingSpace * 0.5;
  } else {
    const textBlockHeight = hookHeight + (slot.subtitle ? padding + subtitleHeight : 0);
    hookY = height - bottomMargin - textBlockHeight;
    subtitleY = hookY + hookHeight + padding;
    const phoneAreaTop = topMargin;
    const phoneAreaBottom = hookY - padding;
    const verticalAlign = slot.phoneVerticalAlign ?? 'center';
    if (verticalAlign === 'top') phoneCenterY = phoneAreaTop + (phoneAreaBottom - phoneAreaTop) * 0.3;
    else if (verticalAlign === 'bottom') phoneCenterY = phoneAreaTop + (phoneAreaBottom - phoneAreaTop) * 0.7;
    else phoneCenterY = (phoneAreaTop + phoneAreaBottom) / 2;
  }

  const layout = slot.phoneLayout ?? 'single';

  // Phone canvas'a sığsın: max 1.0 — eski slot kayıtlarındaki >1.0 değerler de clamp edilir.
  const safePhoneScale = Math.min(Math.max(slot.phoneScale, 0), 1.0);

  // Compute phone positions based on layout
  const phonePositions = computePhonePositions(layout, width, phoneCenterY, safePhoneScale, slot.phoneTilt);

  return (
    <Stage ref={ref} width={viewWidth} height={viewHeight} scaleX={scale} scaleY={scale}>
      <Layer>
        {/* Background */}
        {slot.background.type === 'image' && slot.background.image ? (
          <KonvaImage image={slot.background.image} x={0} y={0} width={width} height={height} />
        ) : slot.background.type === 'solid' ? (
          <Rect x={0} y={0} width={width} height={height} fill={slot.background.value} />
        ) : (
          <Rect
            x={0} y={0} width={width} height={height}
            fillLinearGradientStartPoint={{ x: 0, y: 0 }}
            fillLinearGradientEndPoint={{ x: width, y: height }}
            fillLinearGradientColorStops={parseGradient(slot.background.value)}
          />
        )}

        {/* Panorama decorations — slot sınırlarını aşar, komşu slotlarda yarım yarım görünür */}
        {slot.decorations && slot.decorations.length > 0 && slot.decorations.map((d, i) => {
          if (d.type === 'circle') {
            return <Circle key={`dec-${i}`} x={d.cx} y={d.cy} radius={d.size} fill={d.fill} opacity={d.opacity ?? 1} />;
          }
          if (d.type === 'ring') {
            return <Circle key={`dec-${i}`} x={d.cx} y={d.cy} radius={d.size} stroke={d.stroke ?? d.fill} strokeWidth={d.strokeWidth ?? 4} fillEnabled={false} opacity={d.opacity ?? 1} />;
          }
          if (d.type === 'triangle') {
            return <RegularPolygon key={`dec-${i}`} sides={3} x={d.cx} y={d.cy} radius={d.size} rotation={d.rotation ?? 0} fill={d.fill} opacity={d.opacity ?? 1} />;
          }
          if (d.type === 'rect') {
            return (
              <Rect
                key={`dec-${i}`}
                x={d.cx} y={d.cy}
                width={d.size * 2} height={d.size * 2}
                offsetX={d.size} offsetY={d.size}
                rotation={d.rotation ?? 0}
                fill={d.fill}
                opacity={d.opacity ?? 1}
              />
            );
          }
          return null;
        })}

        {/* Background overlay (for text legibility on busy backgrounds) */}
        {slot.bgOverlay && slot.bgOverlay !== 'none' && (
          <BackgroundOverlay overlay={slot.bgOverlay} width={width} height={height} />
        )}

        {/* Phones — multi-layout composition */}
        {phonePositions.map((p, i) => {
          const screenshotIdx = i === 0 ? slot.screenshot : i === 1 ? slot.screenshot2 : slot.screenshot3;
          return (
            <PhoneFrame
              key={i}
              frameId={slot.phoneFrameId}
              frameStyle={slot.phoneFrameStyle ?? 'solid'}
              x={p.x}
              y={p.y}
              scale={p.scale}
              tilt={p.tilt}
              opacity={p.opacity}
              screenshot={screenshotIdx ?? slot.screenshot}
              canvasWidth={width}
              shadowIntensity={slot.phoneShadow ?? 70}
              reflection={slot.phoneReflection ?? false}
              reflectionOpacity={slot.phoneReflectionOpacity ?? 40}
            />
          );
        })}

        {/* Hook */}
        {slot.hook && (
          <KonvaText
            text={slot.hook}
            x={align === 'left' ? width * 0.06 : align === 'right' ? width * 0.04 : width * 0.05}
            y={hookY}
            width={hookMaxWidth}
            fontSize={hookFontSize}
            fontStyle="bold"
            fontFamily={`${slot.fontFamily ?? 'Inter'}, system-ui, -apple-system, sans-serif`}
            {...(slot.textGradient
              ? {
                  fillLinearGradientStartPoint: { x: 0, y: 0 },
                  fillLinearGradientEndPoint: { x: hookMaxWidth, y: hookFontSize * 1.4 },
                  fillLinearGradientColorStops: [0, slot.textGradient.from, 1, slot.textGradient.to],
                }
              : { fill: slot.textColor })}
            align={align}
            lineHeight={lineHeightMul}
            shadowColor={`rgba(0,0,0,${(slot.textShadow ?? 30) / 100})`}
            shadowBlur={Math.max(0, (slot.textShadow ?? 30) / 100 * 20)}
            shadowOffsetY={Math.max(0, (slot.textShadow ?? 30) / 100 * 6)}
            shadowOpacity={1}
          />
        )}

        {/* Subtitle */}
        {slot.subtitle && (
          <KonvaText
            text={slot.subtitle}
            x={align === 'left' ? width * 0.08 : align === 'right' ? width * 0.06 : width * 0.1}
            y={subtitleY}
            width={subtitleMaxWidth}
            fontSize={subtitleFontSize}
            fontFamily={`${slot.fontFamily ?? 'Inter'}, system-ui, sans-serif`}
            fill={slot.textColor}
            align={align}
            opacity={0.9}
            lineHeight={subtitleLineHeight}
            shadowColor={`rgba(0,0,0,${(slot.textShadow ?? 30) / 100 * 0.7})`}
            shadowBlur={Math.max(0, (slot.textShadow ?? 30) / 100 * 12)}
            shadowOffsetY={Math.max(0, (slot.textShadow ?? 30) / 100 * 4)}
            shadowOpacity={1}
          />
        )}
      </Layer>
    </Stage>
  );
});

ScreenshotStage.displayName = 'ScreenshotStage';

/**
 * Multi-phone layout — telefon pozisyon, scale, tilt'lerini hesaplar.
 * 'single' → ortada 1 telefon
 * 'duo' → 2 telefon yan yana, ufak tilt
 * 'trio' → 3 telefon kademeli (orta büyük, kenarlar küçük + arkada)
 */
function computePhonePositions(
  layout: 'single' | 'duo' | 'trio',
  canvasWidth: number,
  centerY: number,
  baseScale: number,
  baseTilt: number,
): Array<{ x: number; y: number; scale: number; tilt: number; opacity: number }> {
  if (layout === 'single') {
    return [{ x: canvasWidth / 2, y: centerY, scale: baseScale, tilt: baseTilt, opacity: 1 }];
  }

  if (layout === 'duo') {
    const offset = canvasWidth * 0.18;
    return [
      { x: canvasWidth / 2 - offset, y: centerY, scale: baseScale * 0.9, tilt: baseTilt - 8, opacity: 1 },
      { x: canvasWidth / 2 + offset, y: centerY + 60, scale: baseScale * 0.9, tilt: baseTilt + 8, opacity: 1 },
    ];
  }

  // trio
  const offset = canvasWidth * 0.22;
  return [
    { x: canvasWidth / 2 - offset, y: centerY + 80, scale: baseScale * 0.78, tilt: baseTilt - 12, opacity: 0.92 },
    { x: canvasWidth / 2,           y: centerY,      scale: baseScale,         tilt: baseTilt,        opacity: 1 },
    { x: canvasWidth / 2 + offset, y: centerY + 80, scale: baseScale * 0.78, tilt: baseTilt + 12, opacity: 0.92 },
  ];
}

function BackgroundOverlay({ overlay, width, height }: { overlay: string; width: number; height: number }) {
  if (overlay === 'dark') {
    return <Rect x={0} y={0} width={width} height={height} fill="rgba(0,0,0,0.35)" />;
  }
  if (overlay === 'light') {
    return <Rect x={0} y={0} width={width} height={height} fill="rgba(255,255,255,0.35)" />;
  }
  if (overlay === 'top-fade') {
    return (
      <Rect
        x={0} y={0} width={width} height={height * 0.4}
        fillLinearGradientStartPoint={{ x: 0, y: 0 }}
        fillLinearGradientEndPoint={{ x: 0, y: height * 0.4 }}
        fillLinearGradientColorStops={[0, 'rgba(0,0,0,0.55)', 1, 'rgba(0,0,0,0)']}
      />
    );
  }
  if (overlay === 'bottom-fade') {
    return (
      <Rect
        x={0} y={height * 0.6} width={width} height={height * 0.4}
        fillLinearGradientStartPoint={{ x: 0, y: 0 }}
        fillLinearGradientEndPoint={{ x: 0, y: height * 0.4 }}
        fillLinearGradientColorStops={[0, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,0.55)']}
      />
    );
  }
  return null;
}

function PhoneFrame({ frameId, frameStyle = 'solid', x, y, scale, tilt, opacity, screenshot, canvasWidth, shadowIntensity = 70, reflection = false, reflectionOpacity = 40 }: {
  frameId: string;
  frameStyle?: FrameStyle;
  x: number; y: number;
  scale: number;
  tilt: number;
  opacity: number;
  screenshot?: HTMLImageElement;
  canvasWidth: number;
  shadowIntensity?: number; // 0-100
  reflection?: boolean;
  reflectionOpacity?: number; // 0-100
}) {
  const frame = PHONE_FRAMES.find(f => f.id === frameId) ?? PHONE_FRAMES[0];
  const w = canvasWidth * scale * frame.aspectRatio;
  const h = w * (frame.height / frame.width);

  // Shadow intensity 0-100 → blur 0-100, opacity 0-0.7, offset 0-40
  // Glass style ekstra glow için shadow opacity'i artırır (cam efekti hissi).
  const isGlass = frameStyle === 'glass';
  const isOutline = frameStyle === 'outline';
  const shadowOpacity = (shadowIntensity / 100) * (isGlass ? 0.85 : 0.7);
  const shadowBlur = (shadowIntensity / 100) * (isGlass ? 130 : 100);
  const shadowOffsetY = (shadowIntensity / 100) * 40;

  // Body color: solid → frame.bodyColor; glass → frame.bodyColor + alpha; outline → transparent (stroke ile çizilir)
  const bodyFill = isGlass
    ? hexToRgba(frame.bodyColor, 0.35)
    : isOutline
      ? 'rgba(0,0,0,0)'
      : frame.bodyColor;

  return (
    <Group x={x} y={y} rotation={tilt} offsetX={w / 2} offsetY={h / 2} opacity={opacity}>
      <Rect
        x={0} y={0} width={w} height={h}
        cornerRadius={w * 0.13}
        fill={bodyFill}
        stroke={isOutline ? frame.bodyColor : isGlass ? hexToRgba(frame.bodyColor, 0.9) : undefined}
        strokeWidth={isOutline ? w * 0.018 : isGlass ? w * 0.006 : 0}
        shadowColor={isGlass ? hexToRgba(frame.bodyColor, 0.9) : 'rgba(0,0,0,1)'}
        shadowBlur={shadowBlur}
        shadowOpacity={shadowOpacity}
        shadowOffset={{ x: 0, y: shadowOffsetY }}
      />
      {/* Screen bezel — outline modunda gizli, glass modunda ince */}
      {!isOutline && (
        <Rect
          x={w * 0.012} y={h * 0.008} width={w * 0.976} height={h * 0.984}
          cornerRadius={w * 0.12}
          fill={isGlass ? 'rgba(10,10,10,0.4)' : '#0a0a0a'}
        />
      )}
      {screenshot ? (
        <KonvaImage
          image={screenshot}
          x={w * 0.025} y={h * 0.014}
          width={w * 0.95} height={h * 0.972}
          cornerRadius={w * 0.108}
        />
      ) : (
        <Rect
          x={w * 0.025} y={h * 0.014}
          width={w * 0.95} height={h * 0.972}
          cornerRadius={w * 0.108}
          fill={isOutline ? 'rgba(255,255,255,0.05)' : '#1a1a1a'}
        />
      )}
      {frame.hasDynamicIsland && (
        <Rect
          x={w / 2 - w * 0.16} y={h * 0.018}
          width={w * 0.32} height={h * 0.022}
          cornerRadius={h * 0.011}
          fill="#000000"
        />
      )}
      {frame.hasNotch && (
        <Rect
          x={w / 2 - w * 0.22} y={h * 0.014}
          width={w * 0.44} height={h * 0.025}
          cornerRadius={h * 0.012}
          fill="#000000"
        />
      )}
      {/* Reflection — telefon altında ayna yansıması (üst opaque, alt transparan fade) */}
      {reflection && (
        <Group y={h + h * 0.015}>
          {/* Body silüeti (flipped) */}
          <Rect
            x={0} y={0} width={w} height={h * 0.45}
            cornerRadius={w * 0.13}
            fill={bodyFill}
            opacity={(reflectionOpacity / 100) * 0.8}
          />
          {/* Screen ekran (flipped) — sadece üst kısmı (gerçek yansıma kısa olur) */}
          {!isOutline && (
            <Rect
              x={w * 0.012} y={h * 0.008} width={w * 0.976} height={h * 0.42}
              cornerRadius={w * 0.12}
              fill={isGlass ? 'rgba(10,10,10,0.3)' : '#0a0a0a'}
              opacity={reflectionOpacity / 100}
            />
          )}
          {screenshot && !isOutline && (
            <KonvaImage
              image={screenshot}
              x={w * 0.025} y={h * 0.014}
              width={w * 0.95} height={h * 0.4}
              cornerRadius={w * 0.108}
              opacity={(reflectionOpacity / 100) * 0.6}
            />
          )}
          {/* Alpha fade overlay — üstte sıfır maske (yansıma görünür), altta tam maske (yansıma gizlenir) */}
          <Rect
            x={-w * 0.05} y={0}
            width={w * 1.1} height={h * 0.5}
            fillLinearGradientStartPoint={{ x: 0, y: 0 }}
            fillLinearGradientEndPoint={{ x: 0, y: h * 0.5 }}
            fillLinearGradientColorStops={[0, 'rgba(255,255,255,0)', 1, 'rgba(255,255,255,1)']}
            globalCompositeOperation="destination-out"
          />
        </Group>
      )}
    </Group>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function parseGradient(css: string): (number | string)[] {
  const matches = css.match(/#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}/g);
  if (!matches || matches.length < 2) return [0, '#667eea', 1, '#764ba2'];
  const stops: (number | string)[] = [];
  matches.forEach((color, i) => {
    stops.push(i / (matches.length - 1));
    stops.push(color);
  });
  return stops;
}
