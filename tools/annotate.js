/**
 * Screenshot annotation tool — Sharp-based
 * Adds red highlight rectangles, cursor pointer icons, and step badges
 *
 * Usage:
 *   node annotate.js <input.png> <output.png> <annotation.json> [options.json]
 *
 * Annotation JSON:
 *   Single:  { "box": { "x": 100, "y": 200, "width": 300, "height": 50 }, "position": "top-left" }
 *   Multi:   [{ "box": {...}, "stepNumber": 1 }, { "box": {...}, "stepNumber": 2 }]
 *
 * Or use CSS selector (requires CDP browser running):
 *   { "selector": "button:has-text('Save')", "position": "auto" }
 *
 * Position: "top-left" (default) | "top-right" | "bottom-left" | "bottom-right" | "center"
 *
 * Options JSON:
 *   { "imageRadius": 16, "paddingX": 60, "paddingY": 50, "noBackground": false, "style": "sketchy"|"clean",
 *     "engine": "satori"|"sharp" }
 *   bgStyle "pastel" mặc định render khung bằng SATORI (CSS layout, A32); truyền engine:"sharp" để ép engine cũ.
 *   Highlight box giờ vẽ bằng roughjs (hand-drawn thật, seed cố định).
 */

const sharp = require('sharp');
const fs = require('fs');
const rough = require('roughjs');

const RED = '#E8364F';

// ── Highlight rectangle — hand-drawn qua roughjs generator (Excalidraw-style thật) ──

function sketchyRect(box, opts = {}) {
  const pad = opts.padding || 5;
  const x = box.x - pad, y = box.y - pad;
  const w = box.width + pad * 2, h = box.height + pad * 2;
  const sw = opts.strokeWidth || 2.5;

  const gen = rough.generator();
  const drawable = gen.rectangle(x, y, w, h, {
    roughness: 1.2, bowing: 1.2, stroke: RED, strokeWidth: sw,
    seed: opts.seed || 7, // seed cố định — cùng box ra cùng nét (deterministic)
  });
  return gen.toPaths(drawable).map(p =>
    `<path d="${p.d}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" fill="none" opacity="0.9" stroke-linecap="round" stroke-linejoin="round"/>`
  ).join('\n');
}

// ── Clean (corporate) primitives — matches GitBook style ──

function cleanRect(box, opts = {}) {
  const pad = opts.padding || 4;
  const x = box.x - pad, y = box.y - pad;
  const w = box.width + pad * 2, h = box.height + pad * 2;
  const r = opts.borderRadius || 4;
  const sw = opts.strokeWidth || 2;

  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}"
    fill="none" stroke="${RED}" stroke-width="${sw}" opacity="0.9"/>`;
}

// ── Cursor pointer icon (replaces arrow) ──

function cursorPointer(x, y, opts = {}) {
  const scale = opts.scale || 1.4;
  // Standard cursor pointer SVG path — tip at (0,0), pointing top-left
  // Scaled to ~32px tall at scale=1.4
  return `
    <g transform="translate(${x}, ${y}) scale(${scale})">
      <path d="M 0,0 L 0,21 L 4.5,17 L 8.5,24 L 11.5,22.5 L 7.5,15.5 L 13,15.5 Z"
        fill="white" stroke="#222222" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    </g>`;
}

function stepBadge(x, y, stepNumber) {
  const r = 14;
  return `
    <g>
      <circle cx="${x}" cy="${y}" r="${r + 2}" fill="white" opacity="0.95"/>
      <circle cx="${x}" cy="${y}" r="${r}" fill="${RED}" opacity="0.9"/>
      <text x="${x}" y="${y}" dy="0.35em" text-anchor="middle"
        fill="white" font-family="'Inter','Helvetica Neue',Arial,sans-serif"
        font-weight="700" font-size="15px">${stepNumber}</text>
    </g>`;
}

// ── Caption (text below image) ──

function captionSvg(text, imgWidth, imgHeight) {
  const fontSize = 14;
  const padding = 10;
  const y = imgHeight + padding + fontSize;
  return {
    svg: `<text x="${imgWidth / 2}" y="${fontSize + 4}" text-anchor="middle"
      fill="#6B7280" font-family="'Inter','Helvetica Neue',Arial,sans-serif"
      font-size="${fontSize}px" font-style="italic">${escapeXml(text)}</text>`,
    extraHeight: fontSize + padding * 2
  };
}

function escapeXml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Cursor placement ──
// Place cursor tip at a fixed position relative to the highlight box.
// Default: top-left corner of the box (offset slightly outside).

function placeCursor(box, position, imgW, imgH) {
  const pad = 5; // padding used in rect
  let x, y;

  // Position cursor tip relative to the box
  switch (position) {
    case 'top-right':
      x = box.x + box.width + pad + 4;
      y = box.y - pad - 6;
      break;
    case 'bottom-left':
      x = box.x - pad - 2;
      y = box.y + box.height + pad + 4;
      break;
    case 'bottom-right':
      x = box.x + box.width + pad + 4;
      y = box.y + box.height + pad + 4;
      break;
    case 'center':
      x = box.x + box.width / 2;
      y = box.y + box.height / 2;
      break;
    case 'top-left':
      x = box.x - pad - 2;
      y = box.y - pad - 6;
      break;
    default:
      // Default: bottom-right
      x = box.x + box.width + pad + 4;
      y = box.y + box.height + pad + 4;
      break;
  }

  // Clamp to image bounds
  x = Math.max(2, Math.min(x, imgW - 20));
  y = Math.max(2, Math.min(y, imgH - 35));

  return { x, y };
}

// ── Background wrapper ──

async function generateGradientBg(width, height, bgStyle = 'dark') {
  let svg;
  if (bgStyle === 'card') {
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect width="${width}" height="${height}" fill="#FFFFFF"/>
    </svg>`;
  } else if (bgStyle === 'pastel') {
    // Soft pastel — light blue (TL) → pink (center) → peach (BR), Figma-style
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs>
        <linearGradient id="base" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#D6E4F5"/>
          <stop offset="100%" stop-color="#FBE4D0"/>
        </linearGradient>
        <radialGradient id="blue" cx="15%" cy="20%" r="55%">
          <stop offset="0%" stop-color="#B8D4F2" stop-opacity="0.9"/>
          <stop offset="100%" stop-color="#B8D4F2" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="pink" cx="55%" cy="35%" r="45%">
          <stop offset="0%" stop-color="#F2C8D7" stop-opacity="0.85"/>
          <stop offset="100%" stop-color="#F2C8D7" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="peach" cx="90%" cy="85%" r="55%">
          <stop offset="0%" stop-color="#FAD2B0" stop-opacity="0.9"/>
          <stop offset="100%" stop-color="#FAD2B0" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#base)"/>
      <rect width="${width}" height="${height}" fill="url(#blue)"/>
      <rect width="${width}" height="${height}" fill="url(#pink)"/>
      <rect width="${width}" height="${height}" fill="url(#peach)"/>
    </svg>`;
  } else {
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs>
        <linearGradient id="base" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0055CC"/>
          <stop offset="50%" stop-color="#0022AA"/>
          <stop offset="100%" stop-color="#1a0066"/>
        </linearGradient>
        <radialGradient id="cyan" cx="0%" cy="0%" r="60%">
          <stop offset="0%" stop-color="#00BFFF" stop-opacity="0.8"/>
          <stop offset="100%" stop-color="#0022AA" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="purple" cx="85%" cy="40%" r="50%">
          <stop offset="0%" stop-color="#7744CC" stop-opacity="0.7"/>
          <stop offset="100%" stop-color="#0022AA" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="amber" cx="95%" cy="95%" r="45%">
          <stop offset="0%" stop-color="#DDAA55" stop-opacity="0.8"/>
          <stop offset="100%" stop-color="#0022AA" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#base)"/>
      <rect width="${width}" height="${height}" fill="url(#cyan)"/>
      <rect width="${width}" height="${height}" fill="url(#purple)"/>
      <rect width="${width}" height="${height}" fill="url(#amber)"/>
    </svg>`;
  }
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function roundCorners(buffer, radius) {
  const { width, height } = await sharp(buffer).metadata();
  const mask = Buffer.from(
    `<svg width="${width}" height="${height}">
      <rect width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="white"/>
    </svg>`);
  return sharp(buffer)
    .composite([{ input: await sharp(mask).png().toBuffer(), blend: 'dest-in' }])
    .png()
    .toBuffer();
}

// ── Satori engine (A32): khung pastel mô tả bằng CSS, background giữ NGUYÊN SVG pastel ──
// satori render CSS→SVG, resvg raster hoá — không tính toạ độ layer nào bằng tay.

async function addBackgroundSatori(imageBuffer, opts) {
  const { default: satori } = await import('satori');
  const { Resvg } = require('@resvg/resvg-js');

  const { width, height } = await sharp(imageBuffer).metadata();
  const padX = opts.paddingX || 60;
  const padY = opts.paddingY || 50;
  const imageRadius = opts.imageRadius || 16;
  const subPad = opts.subPadding != null ? opts.subPadding : 28;
  const subR = imageRadius + Math.round(subPad * 0.6);
  const outerRadius = opts.outerRadius != null ? opts.outerRadius : 42;
  const W = width + padX * 2;
  const H = height + padY * 2;

  // background = đúng SVG pastel hiện tại (single source of truth) → data URI
  const bgPng = await generateGradientBg(W, H, 'pastel');
  const bgUri = `data:image/png;base64,${bgPng.toString('base64')}`;
  const imgUri = `data:image/png;base64,${(await sharp(imageBuffer).png().toBuffer()).toString('base64')}`;

  const tree = {
    type: 'div',
    props: {
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: '100%', height: '100%',
        backgroundImage: `url(${bgUri})`, backgroundSize: '100% 100%',
        borderRadius: outerRadius,
      },
      children: {
        type: 'div', // frosted sub-frame — spec Figma trong SKILL.md
        props: {
          style: {
            display: 'flex',
            padding: subPad,
            background: 'linear-gradient(180deg, rgba(233,237,245,0.30) 0%, rgba(220,231,251,0.10) 100%)',
            border: '2px solid rgba(255,255,255,0.9)',
            borderRadius: subR,
            boxShadow: '2px 2px 17px rgba(0,0,0,0.12)',
          },
          children: {
            type: 'img',
            props: {
              src: imgUri, width, height,
              style: { borderRadius: imageRadius, boxShadow: '0 6px 24px rgba(30,30,60,0.14)' },
            },
          },
        },
      },
    },
  };

  const svg = await satori(tree, { width: W, height: H, fonts: [] });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng());
}

async function addBackground(imageBuffer, opts) {
  const { width, height } = await sharp(imageBuffer).metadata();
  const padX = opts.paddingX || 60;
  const padY = opts.paddingY || 50;
  const totalW = width + padX * 2;
  const totalH = height + padY * 2;
  const r = opts.imageRadius || 16;
  const bgStyle = opts.bgStyle || 'dark';
  const isCard = bgStyle === 'card';
  const subPad = opts.subPadding != null
    ? opts.subPadding
    : (isCard ? 28 : (bgStyle === 'pastel' ? 28 : 0));
  const subR = isCard ? (r + Math.round(subPad * 0.9)) : (r + Math.round(subPad * 0.6));

  const bgBuffer = await generateGradientBg(totalW, totalH, bgStyle);

  const isPastelShadow = bgStyle === 'pastel';
  const shadowOpacity = isCard ? 0.10 : (isPastelShadow ? 0.12 : 0.35);
  const shDx = isPastelShadow ? 2 : 0;
  const shDy = isPastelShadow ? 2 : (isCard ? 4 : 6);
  const shStd = isPastelShadow ? 9 : (isCard ? 12 : 18);
  const shadowSvg = Buffer.from(
    `<svg width="${totalW}" height="${totalH}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="s" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="${shDx}" dy="${shDy}" stdDeviation="${shStd}" flood-color="rgba(0,0,0,${shadowOpacity})" flood-opacity="1"/>
        </filter>
      </defs>
      <rect x="${padX - subPad}" y="${padY - subPad}" width="${width + subPad * 2}" height="${height + subPad * 2}"
        rx="${subR}" ry="${subR}" fill="${isPastelShadow ? 'rgba(0,0,0,0.001)' : 'white'}" filter="url(#s)"/>
    </svg>`);
  const shadowLayer = await sharp(shadowSvg).png().toBuffer();

  // Add rounded corners to the screenshot for pastel/card
  let imgToComposite = imageBuffer;
  if (bgStyle === 'pastel' || isCard) {
    imgToComposite = await roundCorners(imageBuffer, r);
  }

  const layers = [{ input: shadowLayer, top: 0, left: 0 }];

  // Frame around screenshot
  if (subPad > 0) {
    const frameW = width + subPad * 2;
    const frameH = height + subPad * 2;
    const isPastel = bgStyle === 'pastel';
    const frameStrokeW = isCard ? 2 : 2;
    let frameSvg;
    if (isPastel) {
      // Figma spec: border-radius 20, border 2 white, bg linear-gradient(180deg, #E9EDF5/30% → #DCE7FB/10%)
      frameSvg = Buffer.from(
        `<svg width="${frameW}" height="${frameH}" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="frameFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#E9EDF5" stop-opacity="0.30"/>
              <stop offset="100%" stop-color="#DCE7FB" stop-opacity="0.10"/>
            </linearGradient>
            <linearGradient id="frameStroke" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#FFFFFF" stop-opacity="1"/>
              <stop offset="50%" stop-color="#FFFFFF" stop-opacity="0.5"/>
              <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0.5"/>
            </linearGradient>
          </defs>
          <rect x="${frameStrokeW/2}" y="${frameStrokeW/2}" width="${frameW - frameStrokeW}" height="${frameH - frameStrokeW}"
            rx="${subR}" ry="${subR}"
            fill="url(#frameFill)"
            stroke="url(#frameStroke)" stroke-width="${frameStrokeW}"/>
        </svg>`);
    } else {
      const frameFill = isCard ? '#FFFFFF' : 'rgba(255,255,255,0.55)';
      const frameStroke = isCard ? '#E5E7EB' : 'rgba(255,255,255,0.85)';
      frameSvg = Buffer.from(
        `<svg width="${frameW}" height="${frameH}" xmlns="http://www.w3.org/2000/svg">
          <rect x="${frameStrokeW/2}" y="${frameStrokeW/2}" width="${frameW - frameStrokeW}" height="${frameH - frameStrokeW}"
            rx="${subR}" ry="${subR}"
            fill="${frameFill}"
            stroke="${frameStroke}" stroke-width="${frameStrokeW}"/>
        </svg>`);
    }
    const frameLayer = await sharp(frameSvg).png().toBuffer();
    layers.push({ input: frameLayer, top: padY - subPad, left: padX - subPad });
  }

  layers.push({ input: imgToComposite, top: padY, left: padX });

  return sharp(bgBuffer)
    .composite(layers)
    .png()
    .toBuffer();
}

// ── Main ──

async function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  const annotationArg = process.argv[4];
  const optsArg = process.argv[5];

  if (!inputPath || !outputPath || !annotationArg) {
    console.log('Usage: node annotate.js <input.png> <output.png> <annotation.json> [options.json]');
    console.log('');
    console.log('Annotation JSON (single):');
    console.log('  { "box": { "x": 100, "y": 200, "width": 300, "height": 50 }, "position": "auto" }');
    console.log('');
    console.log('Annotation JSON (multi-step):');
    console.log('  [{ "box": {...}, "stepNumber": 1 }, { "box": {...}, "stepNumber": 2 }]');
    console.log('');
    console.log('Options: { "style": "sketchy"|"clean", "noBackground": false, "caption": "Edit code" }');
    process.exit(1);
  }

  let annotations;
  if (annotationArg.startsWith('[') || annotationArg.startsWith('{')) {
    annotations = JSON.parse(annotationArg);
  } else {
    annotations = JSON.parse(fs.readFileSync(annotationArg, 'utf-8'));
  }

  // Normalize to array
  if (!Array.isArray(annotations)) annotations = [annotations];

  let opts = {};
  if (optsArg) {
    opts = optsArg.startsWith('{') ? JSON.parse(optsArg) : JSON.parse(fs.readFileSync(optsArg, 'utf-8'));
  }

  const style = opts.style || 'sketchy';
  const imageRadius = opts.imageRadius || 16;

  // Read input image
  const screenshotBuffer = fs.readFileSync(inputPath);
  const { width, height } = await sharp(screenshotBuffer).metadata();

  // Build SVG overlay
  const totalSteps = annotations.length;
  const svgParts = [];

  for (const ann of annotations) {
    const box = ann.box;
    if (!box) continue;

    const position = ann.position || 'top-left';

    // Rectangle (stroke only)
    if (style === 'clean') {
      svgParts.push(cleanRect(box, { padding: ann.padding || 4 }));
    } else {
      svgParts.push(sketchyRect(box, { padding: ann.padding || 5 }));
    }

    // Cursor pointer
    const cursorPos = placeCursor(box, position, width, height);
    svgParts.push(cursorPointer(cursorPos.x, cursorPos.y));

    // Step badge (placed near cursor)
    if (totalSteps > 1 && ann.stepNumber) {
      svgParts.push(stepBadge(cursorPos.x + 20, cursorPos.y - 12, ann.stepNumber));
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${svgParts.join('\n')}</svg>`;

  // Compose annotation onto screenshot
  let result = await sharp(screenshotBuffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();

  const bgStyle = opts.bgStyle || 'dark';
  const useSatori = bgStyle === 'pastel' && opts.engine !== 'sharp';

  if (opts.noBackground !== true && useSatori) {
    // Satori engine (A32): bo góc ảnh + frame + outer radius đều là CSS — không roundCorners tay
    let satoriDone = false;
    try {
      result = await addBackgroundSatori(result, {
        paddingX: opts.paddingX || 60,
        paddingY: opts.paddingY || 50,
        imageRadius,
        subPadding: opts.subPadding,
        outerRadius: opts.outerRadius,
      });
      satoriDone = true;
    } catch (e) {
      console.error(JSON.stringify({ warn: 'satori engine failed, falling back to sharp', error: e.message }));
    }
    if (!satoriDone) {
      if (imageRadius > 0) result = await roundCorners(result, imageRadius);
      result = await addBackground(result, {
        paddingX: opts.paddingX || 60, paddingY: opts.paddingY || 50,
        imageRadius, bgStyle, subPadding: opts.subPadding,
      });
      const outerRadius = opts.outerRadius != null ? opts.outerRadius : 42;
      if (outerRadius > 0) result = await roundCorners(result, outerRadius);
    }
  } else {
    // Sharp engine (dark/card, hoặc engine:"sharp" ép buộc)
    if (imageRadius > 0) {
      result = await roundCorners(result, imageRadius);
    }
    if (opts.noBackground !== true) {
      result = await addBackground(result, {
        paddingX: opts.paddingX || 60,
        paddingY: opts.paddingY || 50,
        imageRadius,
        bgStyle,
        subPadding: opts.subPadding,
      });
      // Round outer canvas corners (baked-in, not CSS).
      // Default 42px @ native res ≈ 12px visible when displayed at ~800px (HTML preview / GitBook).
      const outerRadius = opts.outerRadius != null ? opts.outerRadius : 42;
      if (outerRadius > 0) {
        result = await roundCorners(result, outerRadius);
      }
    }
  }

  // Add caption if provided
  if (opts.caption) {
    const finalMeta = await sharp(result).metadata();
    const captionHeight = 30;
    const captionBg = Buffer.from(
      `<svg width="${finalMeta.width}" height="${captionHeight}">
        <text x="${finalMeta.width / 2}" y="20" text-anchor="middle"
          fill="#6B7280" font-family="Inter,Helvetica Neue,Arial,sans-serif"
          font-size="14px" font-style="italic">${escapeXml(opts.caption)}</text>
      </svg>`);

    result = await sharp(result)
      .extend({ bottom: captionHeight, background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .composite([{ input: await sharp(captionBg).png().toBuffer(), top: finalMeta.height, left: 0 }])
      .png()
      .toBuffer();
  }

  await sharp(result).toFile(outputPath);
  const finalMeta = await sharp(outputPath).metadata();

  console.log(JSON.stringify({
    ok: true,
    input: inputPath,
    output: outputPath,
    width: finalMeta.width,
    height: finalMeta.height,
    annotations: annotations.length,
    style,
  }));
}

module.exports = { generateGradientBg, roundCorners, sketchyRect, cursorPointer, RED };

if (require.main === module) {
  main().catch(e => {
    console.error(JSON.stringify({ ok: false, error: e.message }));
    process.exit(1);
  });
}
