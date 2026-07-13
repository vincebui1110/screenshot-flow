/**
 * Composite screenshot tool (A33) — ghép nhiều ảnh vào 1 khung pastel
 * Dùng cho màn OVERVIEW không cover hết nội dung trong 1 shot:
 * main card + detail card(s) nổi bên cạnh, overlap kiểu floating (mẫu Figma UG).
 *
 * Usage:
 *   node compose.js '<spec.json | path/to/spec.json>' <output.png>
 *
 * Spec JSON:
 *   {
 *     "main": "path/main.png",              — ảnh chính (bắt buộc)
 *     "details": ["path/d1.png", ...],      — 1-3 ảnh detail, xếp cột dọc
 *     "layout": "detail-left"|"detail-right",  — cột detail nằm bên nào (default detail-left)
 *     "detailScale": 0.42,                  — width detail = tỉ lệ theo width main (default 0.42)
 *     "overlap": 0.35,                      — phần width detail ĐÈ LÊN main (default 0.35)
 *     "gap": 28,                            — khoảng cách giữa các detail trong cột
 *     "wrapPad": 24,                        — padding lớp card BỌC NGOÀI mỗi ảnh (mẫu Figma; 0 = ảnh trần)
 *     "paddingX": 120, "paddingY": 100,     — padding pastel bg (chuẩn SKILL.md)
 *     "imageRadius": 14, "outerRadius": 42
 *   }
 *
 * Mỗi ảnh được bọc trong 1 wrapper card trắng frosted (padding + bo góc + shadow) rồi mới ghép
 * — main và detail đều có "lớp bọc ngoài như 1 ảnh" riêng.
 *
 * Render: satori (CSS layout, position absolute) → resvg → PNG.
 * Background: NGUYÊN SVG pastel từ annotate.js (single source of truth).
 */

const sharp = require('sharp');
const fs = require('fs');
const { generateGradientBg } = require('./annotate.js');

async function toImg(file) {
  const buf = await sharp(file).png().toBuffer();
  const { width, height } = await sharp(buf).metadata();
  return { uri: `data:image/png;base64,${buf.toString('base64')}`, width, height };
}

async function compose(spec, outputPath) {
  const { default: satori } = await import('satori');
  const { Resvg } = require('@resvg/resvg-js');

  const layout = spec.layout || 'detail-left';
  const detailScale = spec.detailScale || 0.42;
  const overlap = spec.overlap != null ? spec.overlap : 0.35;
  const gap = spec.gap || 28;
  const padX = spec.paddingX || 120;
  const padY = spec.paddingY || 100;
  const imageRadius = spec.imageRadius || 14;
  const outerRadius = spec.outerRadius != null ? spec.outerRadius : 42;
  const wrapPad = spec.wrapPad != null ? spec.wrapPad : 36; // padding sub-background (khớp subPadding chuẩn)
  const BORDER = 2; // border sub-frame — tính vào kích thước wrapper

  const main = await toImg(spec.main);
  const detailPaths = spec.details || [];
  if (!detailPaths.length) throw new Error('spec.details cần ít nhất 1 ảnh — nếu chỉ 1 ảnh dùng annotate.js');

  const detailWrapPad = Math.max(12, Math.round(wrapPad * 0.75)); // detail card nhỏ → padding nhỏ hơn
  const details = [];
  for (const p of detailPaths) {
    const d = await toImg(typeof p === 'string' ? p : p.path);
    const scale = (typeof p === 'object' && p.scale) || detailScale;
    d.dispW = Math.round(main.width * scale);
    d.dispH = Math.round(d.height * (d.dispW / d.width));
    d.wrapW = d.dispW + detailWrapPad * 2 + BORDER * 2; // kích thước CẢ lớp bọc (padding + border)
    d.wrapH = d.dispH + detailWrapPad * 2 + BORDER * 2;
    details.push(d);
  }

  const mainWrapW = main.width + wrapPad * 2 + BORDER * 2;
  const mainWrapH = main.height + wrapPad * 2 + BORDER * 2;
  const detailW = Math.max(...details.map(d => d.wrapW));
  const detailColH = details.reduce((s, d) => s + d.wrapH, 0) + gap * (details.length - 1);
  const overhang = Math.round(detailW * (1 - overlap)); // phần detail thò ra ngoài main
  const contentW = mainWrapW + overhang;
  const contentH = Math.max(mainWrapH, detailColH);
  const W = contentW + padX * 2;
  const H = contentH + padY * 2;

  const bgPng = await generateGradientBg(W, H, 'pastel');
  const bgUri = `data:image/png;base64,${bgPng.toString('base64')}`;

  const detailLeft = layout === 'detail-left';
  const cardShadow = '0 12px 40px rgba(30,30,60,0.16), 0 2px 8px rgba(30,30,60,0.08)';

  // Lớp bọc ngoài mỗi ảnh — FROSTED SUB-BACKGROUND đúng spec Figma trong SKILL.md
  // (bán trong suốt thấy pastel xuyên qua — GIỐNG HỆT sub-frame của ảnh đơn annotate.js):
  // bg linear-gradient(180deg, #E9EDF5/30% → #DCE7FB/10%), border 2px trắng, shadow 2 2 17 /12%,
  // radius theo công thức chuẩn subR = imageRadius + round(pad × 0.6)
  const wrapCard = (img, pad, extraStyle) => ({
    type: 'div',
    props: {
      style: {
        display: 'flex',
        padding: pad,
        background: 'linear-gradient(180deg, rgba(233,237,245,0.30) 0%, rgba(220,231,251,0.10) 100%)',
        border: '2px solid rgba(255,255,255,0.9)',
        borderRadius: imageRadius + Math.round(pad * 0.6),
        boxShadow: '2px 2px 17px rgba(0,0,0,0.12)',
        ...extraStyle,
      },
      children: {
        type: 'img',
        props: {
          src: img.uri, width: img.dispW || img.width, height: img.dispH || img.height,
          style: { borderRadius: imageRadius, boxShadow: '0 4px 16px rgba(30,30,60,0.12)' },
        },
      },
    },
  });

  // Cột detail: absolute, căn giữa dọc, mỗi ảnh 1 wrapper card
  let dy = Math.round((contentH - detailColH) / 2);
  const detailNodes = details.map(d => {
    const node = wrapCard(d, detailWrapPad, {
      position: 'absolute',
      top: dy,
      [detailLeft ? 'left' : 'right']: 0,
    });
    dy += d.wrapH + gap;
    return node;
  });

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
        type: 'div',
        props: {
          style: { display: 'flex', position: 'relative', width: contentW, height: contentH },
          children: [
            // main wrapper card — vẽ trước, detail đè lên trên
            wrapCard(main, wrapPad, {
              position: 'absolute',
              top: Math.round((contentH - mainWrapH) / 2),
              [detailLeft ? 'left' : 'right']: overhang,
            }),
            ...detailNodes,
          ],
        },
      },
    },
  };

  const svg = await satori(tree, { width: W, height: H, fonts: [] });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng();
  fs.writeFileSync(outputPath, png);
  return { ok: true, output: outputPath, width: W, height: H, main: spec.main, details: detailPaths.length, layout };
}

async function mainCli() {
  const specArg = process.argv[2];
  const outputPath = process.argv[3];
  if (!specArg || !outputPath) {
    console.log("Usage: node compose.js '<spec.json>' <output.png>");
    console.log('Spec: { "main": "m.png", "details": ["d.png"], "layout": "detail-left", "detailScale": 0.42, "overlap": 0.35 }');
    process.exit(1);
  }
  const spec = specArg.trim().startsWith('{') ? JSON.parse(specArg) : JSON.parse(fs.readFileSync(specArg, 'utf-8'));
  console.log(JSON.stringify(await compose(spec, outputPath)));
}

module.exports = { compose };

if (require.main === module) {
  mainCli().catch(e => {
    console.error(JSON.stringify({ ok: false, error: e.message }));
    process.exit(1);
  });
}
