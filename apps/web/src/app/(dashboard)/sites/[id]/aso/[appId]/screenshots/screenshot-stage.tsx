'use client';

import { forwardRef } from 'react';
import { Stage, Layer, Rect, Image as KonvaImage, Text as KonvaText, Group } from 'react-konva';
import type Konva from 'konva';
import { PHONE_FRAMES } from './phone-frames';

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
  phoneTilt: number;
  phoneScale: number;
  phoneLayout?: 'single' | 'duo' | 'trio';        // multi-phone composition
  phoneVerticalAlign?: 'top' | 'center' | 'bottom'; // vertical position
  screenshot?: HTMLImageElement;
  screenshot2?: HTMLImageElement;  // for duo/trio
  screenshot3?: HTMLImageElement;
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

  // Compute phone positions based on layout
  const phonePositions = computePhonePositions(layout, width, phoneCenterY, slot.phoneScale, slot.phoneTilt);

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
              x={p.x}
              y={p.y}
              scale={p.scale}
              tilt={p.tilt}
              opacity={p.opacity}
              screenshot={screenshotIdx ?? slot.screenshot}
              canvasWidth={width}
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
            fontFamily="Inter, system-ui, -apple-system, sans-serif"
            fill={slot.textColor}
            align={align}
            lineHeight={lineHeightMul}
            shadowColor="rgba(0,0,0,0.3)"
            shadowBlur={6}
            shadowOffsetY={2}
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
            fontFamily="Inter, system-ui, sans-serif"
            fill={slot.textColor}
            align={align}
            opacity={0.9}
            lineHeight={subtitleLineHeight}
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

function PhoneFrame({ frameId, x, y, scale, tilt, opacity, screenshot, canvasWidth }: {
  frameId: string;
  x: number; y: number;
  scale: number;
  tilt: number;
  opacity: number;
  screenshot?: HTMLImageElement;
  canvasWidth: number;
}) {
  const frame = PHONE_FRAMES.find(f => f.id === frameId) ?? PHONE_FRAMES[0];
  const w = canvasWidth * scale * frame.aspectRatio;
  const h = w * (frame.height / frame.width);
  return (
    <Group x={x} y={y} rotation={tilt} offsetX={w / 2} offsetY={h / 2} opacity={opacity}>
      <Rect
        x={0} y={0} width={w} height={h}
        cornerRadius={w * 0.13}
        fill={frame.bodyColor}
        shadowColor="rgba(0,0,0,0.4)"
        shadowBlur={60}
        shadowOpacity={0.5}
        shadowOffset={{ x: 0, y: 30 }}
      />
      <Rect
        x={w * 0.012} y={h * 0.008} width={w * 0.976} height={h * 0.984}
        cornerRadius={w * 0.12}
        fill="#0a0a0a"
      />
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
          fill="#1a1a1a"
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
    </Group>
  );
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
