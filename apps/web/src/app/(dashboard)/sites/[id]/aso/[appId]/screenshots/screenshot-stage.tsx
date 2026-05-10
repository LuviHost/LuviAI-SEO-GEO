'use client';

import { forwardRef, useEffect, useState } from 'react';
import { Stage, Layer, Rect, Image as KonvaImage, Text as KonvaText, Group } from 'react-konva';
import type Konva from 'konva';
import { PHONE_FRAMES } from './phone-frames';

interface SlotData {
  background: { type: 'gradient' | 'solid' | 'image'; value: string; image?: HTMLImageElement };
  hook: string;
  subtitle: string;
  hookFontSize: number;
  textColor: string;
  textPosition: 'top' | 'bottom';
  phoneFrameId: string;
  phoneTilt: number;
  phoneScale: number;
  screenshot?: HTMLImageElement;
}

interface ScreenshotStageProps {
  slot: SlotData;
  width: number;       // canvas full resolution (e.g. 1290)
  height: number;      // 2796
  viewWidth: number;   // displayed width (e.g. 320)
}

/**
 * Hook'un kaç satıra wrap olacağını text length + max width + font size'a göre tahmin et.
 * Bu Konva'nın iç wrap mantığıyla %95 örtüşür — ek render gerek yok.
 */
function estimateTextLines(text: string, fontSize: number, maxWidth: number): number {
  if (!text) return 0;
  // Average char width ≈ fontSize * 0.55 (Inter font için)
  const avgCharWidth = fontSize * 0.55;
  const charsPerLine = Math.max(1, Math.floor(maxWidth / avgCharWidth));
  // Word-wrap respecting words: split by space, simulate
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

  // Dynamic layout calculation
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

  const padding = height * 0.025; // 2.5% padding
  const topMargin = height * 0.06;
  const bottomMargin = height * 0.04;

  // Compute text block + phone Y depending on position
  let hookY: number, subtitleY: number, phoneCenterY: number;

  if (slot.textPosition === 'top') {
    hookY = topMargin;
    subtitleY = hookY + hookHeight + padding;
    const textBlockBottom = subtitleY + subtitleHeight + padding;
    // Phone center: between text block bottom and canvas bottom
    const remainingSpace = height - textBlockBottom - bottomMargin;
    phoneCenterY = textBlockBottom + remainingSpace / 2;
  } else {
    // text on bottom
    const textBlockHeight = hookHeight + (slot.subtitle ? padding + subtitleHeight : 0);
    hookY = height - bottomMargin - textBlockHeight;
    subtitleY = hookY + hookHeight + padding;
    // Phone center: between top margin and text block top
    const phoneAreaTop = topMargin;
    const phoneAreaBottom = hookY - padding;
    phoneCenterY = (phoneAreaTop + phoneAreaBottom) / 2;
  }

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

        {/* Phone frame + screenshot — once, position computed above */}
        <PhoneFrame
          frameId={slot.phoneFrameId}
          x={width / 2}
          y={phoneCenterY}
          scale={slot.phoneScale}
          tilt={slot.phoneTilt}
          screenshot={slot.screenshot}
          canvasWidth={width}
        />

        {/* Hook + subtitle */}
        {slot.hook && (
          <KonvaText
            text={slot.hook}
            x={width * 0.05}
            y={hookY}
            width={hookMaxWidth}
            fontSize={hookFontSize}
            fontStyle="bold"
            fontFamily="Inter, system-ui, -apple-system, sans-serif"
            fill={slot.textColor}
            align="center"
            lineHeight={lineHeightMul}
            shadowColor="rgba(0,0,0,0.3)"
            shadowBlur={6}
            shadowOffsetY={2}
          />
        )}
        {slot.subtitle && (
          <KonvaText
            text={slot.subtitle}
            x={width * 0.1}
            y={subtitleY}
            width={subtitleMaxWidth}
            fontSize={subtitleFontSize}
            fontFamily="Inter, system-ui, sans-serif"
            fill={slot.textColor}
            align="center"
            opacity={0.9}
            lineHeight={subtitleLineHeight}
          />
        )}
      </Layer>
    </Stage>
  );
});

ScreenshotStage.displayName = 'ScreenshotStage';

function PhoneFrame({ frameId, x, y, scale, tilt, screenshot, canvasWidth }: {
  frameId: string;
  x: number; y: number;
  scale: number;
  tilt: number;
  screenshot?: HTMLImageElement;
  canvasWidth: number;
}) {
  const frame = PHONE_FRAMES.find(f => f.id === frameId) ?? PHONE_FRAMES[0];
  const w = canvasWidth * scale * frame.aspectRatio;
  const h = w * (frame.height / frame.width);
  return (
    <Group x={x} y={y} rotation={tilt} offsetX={w / 2} offsetY={h / 2}>
      {/* Phone body — outer frame */}
      <Rect
        x={0} y={0} width={w} height={h}
        cornerRadius={w * 0.13}
        fill={frame.bodyColor}
        shadowColor="rgba(0,0,0,0.4)"
        shadowBlur={60}
        shadowOpacity={0.5}
        shadowOffset={{ x: 0, y: 30 }}
      />
      {/* Inner bezel (slightly darker) */}
      <Rect
        x={w * 0.012} y={h * 0.008} width={w * 0.976} height={h * 0.984}
        cornerRadius={w * 0.12}
        fill="#0a0a0a"
      />
      {/* Screen */}
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
      {/* Dynamic Island (Pro models) */}
      {frame.hasDynamicIsland && (
        <Rect
          x={w / 2 - w * 0.16} y={h * 0.018}
          width={w * 0.32} height={h * 0.022}
          cornerRadius={h * 0.011}
          fill="#000000"
        />
      )}
      {/* Notch (older models) */}
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
