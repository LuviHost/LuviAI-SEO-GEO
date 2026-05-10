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

export const ScreenshotStage = forwardRef<Konva.Stage, ScreenshotStageProps>(({ slot, width, height, viewWidth }, ref) => {
  const viewHeight = (viewWidth * height) / width;
  const scale = viewWidth / width;

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

        {/* Hook + subtitle — top */}
        {slot.textPosition === 'top' && (
          <>
            {slot.hook && (
              <KonvaText
                text={slot.hook}
                x={width * 0.05}
                y={height * 0.06}
                width={width * 0.9}
                fontSize={slot.hookFontSize}
                fontStyle="bold"
                fontFamily="Inter, system-ui, -apple-system, sans-serif"
                fill={slot.textColor}
                align="center"
                lineHeight={1.1}
                shadowColor="rgba(0,0,0,0.3)"
                shadowBlur={6}
                shadowOffsetY={2}
              />
            )}
            {slot.subtitle && (
              <KonvaText
                text={slot.subtitle}
                x={width * 0.1}
                y={height * 0.06 + slot.hookFontSize * 1.4 + 30}
                width={width * 0.8}
                fontSize={Math.max(28, slot.hookFontSize * 0.4)}
                fontFamily="Inter, system-ui, sans-serif"
                fill={slot.textColor}
                align="center"
                opacity={0.9}
                lineHeight={1.3}
              />
            )}
          </>
        )}

        {/* Phone frame + screenshot */}
        <PhoneFrame
          frameId={slot.phoneFrameId}
          x={width / 2}
          y={height / 2 + (slot.textPosition === 'top' ? 250 : -200)}
          scale={slot.phoneScale}
          tilt={slot.phoneTilt}
          screenshot={slot.screenshot}
          canvasWidth={width}
        />

        {/* Hook + subtitle — bottom */}
        {slot.textPosition === 'bottom' && (
          <>
            {slot.hook && (
              <KonvaText
                text={slot.hook}
                x={width * 0.05}
                y={height * 0.78}
                width={width * 0.9}
                fontSize={slot.hookFontSize}
                fontStyle="bold"
                fontFamily="Inter, system-ui, sans-serif"
                fill={slot.textColor}
                align="center"
                lineHeight={1.1}
                shadowColor="rgba(0,0,0,0.3)"
                shadowBlur={6}
                shadowOffsetY={2}
              />
            )}
            {slot.subtitle && (
              <KonvaText
                text={slot.subtitle}
                x={width * 0.1}
                y={height * 0.78 + slot.hookFontSize * 1.4 + 30}
                width={width * 0.8}
                fontSize={Math.max(28, slot.hookFontSize * 0.4)}
                fontFamily="Inter, system-ui, sans-serif"
                fill={slot.textColor}
                align="center"
                opacity={0.9}
                lineHeight={1.3}
              />
            )}
          </>
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
