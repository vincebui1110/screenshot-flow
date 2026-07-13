---
name: screenshot
description: "Screenshot Agent — Chụp ảnh app production có annotation (red box, arrow, step badge) cho user guide / help center. Dùng khi cần screenshot UI app hoặc fill ảnh cho bài user guide."
argument-hint: "[app_code] [mô tả màn hình cần chụp / path đến file UG]"
---

# Screenshot Capture — Help Center Images

Chụp ảnh annotated từ **production app** cho: **$ARGUMENTS**

## TOOLS

```
CAPTURE = ~/.claude/tools/capture.js    (Playwright CDP browser control + in-DOM annotation)
ANNOTATE = ~/.claude/tools/annotate.js  (Satori/Sharp framing engine)
COMPOSE = ~/.claude/tools/compose.js    (Ghép nhiều ảnh → 1 khung pastel, cho overview/composite)
CONFIG = ~/.claude/tools/config/annotation-rules.json
```

**Kiến trúc (A32, 2026-07):** highlight box / cursor / blur / crop làm **TRONG DOM trước khi chụp**
(browser tự lo toạ độ — không bao giờ lệch DPR/iframe). `annotate.js` chỉ còn lo khung đẹp
(pastel + frosted frame, render bằng satori CSS) + fallback vẽ-đè-sau khi không chụp lại được.

Lệnh mới của capture.js:

| Lệnh | Công dụng |
|------|-----------|
| `run stabilize` | Tắt animation/caret + chờ fonts, images, hết `aria-busy`/Polaris skeleton |
| `run shot <sel> <out> [pad]` | Chụp element (tự tìm trong app iframe trước) + padding, đã gồm highlight/cursor in-DOM |
| `run shot-stable <out> [tries]` | Chụp lặp tới khi 2 shot liên tiếp giống hệt (loại skeleton/loading) |
| `run highlight <sel> [pad] [style]` | Box đỏ BÁM element trong DOM — default `clean` (box trơn stroke-only, chuẩn UG PO chốt 07-07); `sketchy` = rough-notation |
| `run cursor <sel> [position]` | Đặt cursor overlay trong DOM, default `bottom-right` (chuẩn UG) |
| `run blur <sel>` | Blur PII (email/tên) bằng CSS — áp mọi element khớp selector |
| `run clear-annotations` | Gỡ toàn bộ overlay/style đã inject (trước khi chụp ảnh tiếp theo) |

## PRE-FLIGHT (BẮT BUỘC — chạy trước mọi workflow)

```bash
# Bước 1: Auto-launch browser nếu chưa chạy
# capture.js tự detect CDP và launch nếu cần — không cần làm thủ công
node ~/.claude/tools/capture.js run resize 1280 800
# Nếu lệnh này thành công → browser đang chạy
# Nếu lỗi sau 10s → báo user: "Chrome không khởi động được"

# Bước 2: Navigate đến app
node ~/.claude/tools/capture.js run goto "[APP_URL]"

# Bước 3: Kiểm tra session
node ~/.claude/tools/capture.js run check-login
# → { "loggedIn": true }  — tiếp tục bình thường
# → { "loggedIn": false } — xử lý theo store type bên dưới
```

### Nếu loggedIn: false

Session chưa đăng nhập / hết hạn.
→ Thông báo user: *"Shopify session chưa sẵn sàng. Bạn vui lòng login vào Chrome window vừa mở (`<YOUR_LOGIN_EMAIL>`), sau đó báo tôi."*
→ Chờ user confirm → chạy lại `check-login` → tiếp tục

> Profile Chrome tại `~/.chrome-debug-profile` (đổi bằng env `CHROME_DEBUG_PROFILE`) lưu session đăng nhập. Thường chỉ cần **login 1 lần** — session persist trong profile này. Xem README để login lần đầu.

### Kiểm tra đúng store

Sau khi navigate đến app URL, verify URL chứa đúng store handle của bạn (`<YOUR_STORE_HANDLE>`):

```bash
node ~/.claude/tools/capture.js run url
# → kiểm tra "url" field chứa "<YOUR_STORE_HANDLE>"
```

Nếu URL chứa store khác → navigate lại đúng URL:
```bash
node ~/.claude/tools/capture.js run goto "https://admin.shopify.com/store/<YOUR_STORE_HANDLE>/apps/<APP_HANDLE>"
```

---

## APP URLS (điền cho store của bạn)

Điền bảng dưới cho từng app bạn cần chụp. Store handle nằm trong URL admin: `https://admin.shopify.com/store/<STORE_HANDLE>/...`.
App handle nằm ngay sau `/apps/`.

| App | Code | App Name | Shopify Admin URL |
|-----|------|----------|-------------------|
| _(ví dụ)_ | ex | Your App Name | `https://admin.shopify.com/store/<STORE_HANDLE>/apps/<APP_HANDLE>` |
| … | … | … | … |

> **Nếu storefront có PASSWORD** — chụp storefront đi đường admin **Themes → nút "View your online store"** (`button[aria-label*='View your online store']`, force click vì ẩn tới khi hover) → popup preview bypass password; ẩn preview bar bằng CSS `#preview-bar-iframe{display:none}` + crop toolbar đáy (~32px CSS) trước khi dùng. Trang App Store listing muốn hiện nút **Install** (thay vì Open) → chụp bằng browser context incognito mới.

---

## WORKFLOW A: Single Screenshot

Chụp 1 ảnh cụ thể theo mô tả.

### Bước 1: Pre-flight (xem PRE-FLIGHT ở trên)

### Bước 2: Set viewport

```bash
node ~/.claude/tools/capture.js run resize 1280 800
```

### Bước 3: Navigate đến app

```bash
node ~/.claude/tools/capture.js run goto "https://admin.shopify.com/store/[STORE]/apps/[HANDLE]/[page]"
```

### Bước 4: Annotate in-DOM + chụp

```bash
# 4a. Ổn định trang (BẮT BUỘC trước mọi shot — tắt animation, chờ load xong)
node ~/.claude/tools/capture.js run stabilize

# 4b. Nếu step là Action → highlight + cursor TRONG DOM (toạ độ tự bám element)
node ~/.claude/tools/capture.js run highlight "button:has-text('Save')"
node ~/.claude/tools/capture.js run cursor "button:has-text('Save')"

# 4c. Nếu ảnh có PII (email, tên khách) → blur trước khi chụp
node ~/.claude/tools/capture.js run blur ".customer-email"

# 4d. Chụp:
#   - Vùng quanh element (thay crop thủ công):
node ~/.claude/tools/capture.js run shot ".Polaris-Page" /tmp/raw-screenshot.png 24
#   - Hoặc cả viewport, chống loading dở:
node ~/.claude/tools/capture.js run shot-stable /tmp/raw-screenshot.png

# 4e. Dọn overlay trước ảnh tiếp theo
node ~/.claude/tools/capture.js run clear-annotations
```

### Bước 5: Lên khung đẹp, output

Xem chi tiết ở phần **ANNOTATION PIPELINE** bên dưới.

---

## OVERVIEW RULES (A33 — lỗi hay gặp: ảnh overview size nhỏ, không cover đủ nội dung)

Ảnh cho màn **overview** (Dashboard, trang tổng quan) phải cho thấy TOÀN BỘ nội dung mà content mô tả:

1. **Viewport tối thiểu 1440×900** trước khi chụp overview: `run resize 1440 900`.
2. Chụp cả trang app (`run shot ".Polaris-Page" out.png 24` hoặc `run shot-stable`), **KHÔNG crop 1 góc**.
3. Nội dung dài hơn viewport / có dropdown-panel ẩn cần show → **tách nhiều ảnh + ghép 1 khung** bằng compose:

```bash
# Chụp màn chính + chụp riêng detail (vd dropdown đang mở), rồi ghép:
node ~/.claude/tools/compose.js '{
  "main": "/tmp/main.png",
  "details": ["/tmp/detail-dropdown.png"],
  "layout": "detail-left", "detailScale": 0.38, "overlap": 0.3
}' output.png
# → main card bên phải + detail card nổi bên trái đè nhẹ lên main, cùng khung pastel chuẩn
# Mỗi ảnh trong composite TỰ ĐỘNG được bọc sub-background frosted riêng (đúng spec Figma
# của ảnh đơn — PO duyệt 07-06). wrapPad default 36; truyền "wrapPad": 0 nếu cần ảnh trần.
```

> Ảnh compose ĐÃ có background pastel — KHÔNG đưa qua annotate.js thêm lần nữa.
> CẤM: overview có element cắt cụt giữa chừng (nửa card/nửa bảng); overview là crop selector đơn lẻ.

---

## WORKFLOW B: FromScript / FromPlaceholders (fill toàn bộ ảnh trong 1 bài)

**Ưu tiên 1 — `shots.md`** (A33): nếu guide có `userguide/[slug]/shots.md` (đã qua verify + PO duyệt theo
`~/.claude/skills/loop-verifier/shot-script-standard.md`) → chạy đúng theo script: mỗi shot có
section/purpose/type/page/prep/selector/blur/compose — thực thi tuần tự, đúng `purpose` từng ảnh.
KHÔNG tự chế thêm/bớt shot ngoài script; thấy script sai thì DỪNG báo PO, không tự sửa.

**Fallback — parse placeholders** từ file .md (bài cũ chưa có shots.md):

### Bước 1: Parse placeholders từ file

Đọc file `.md`, extract tất cả comments có format:
```
<!-- screenshot: [desc] | app: [code] | page: [path] | selector: [css] | annotate: yes/no -->
![alt](../images/[filename].png)
```

Build danh sách jobs (output resolve về absolute path dựa vào folder của file .md):
```
{
  desc: "Click Activate toggle on Dashboard",
  app: "cb",
  page: "/dashboard",
  selector: ".activation-toggle",
  annotate: true,
  output: "[project_root]/userguide/configure-cookie-bar/images/step1-activate.png"
}
```

> File .md nằm tại `userguide/[guide-slug]/content/[guide-slug].md`, nên `../images/foo.png` resolve thành `userguide/[guide-slug]/images/foo.png`.

### Bước 2: Với mỗi job

```
1. Navigate: goto BASE_URL + page
2. run stabilize (đợi iframe load + tắt animation + hết skeleton)
3. Nếu annotate: yes → run highlight [selector] + run cursor [selector]
4. Nếu có PII → run blur [selector-pii]
5. run shot [vùng-cần-chụp] /tmp/raw.png [padding]  (hoặc shot-stable nếu chụp cả trang)
6. run clear-annotations
7. annotate.js raw.png output.png '[]' + options chuẩn (chỉ lên khung pastel)
8. Save vào output path → báo cáo: ✓ [filename]
```

### Bước 3: Sau khi xong tất cả

Mở preview để user review:
```bash
# Tạo preview HTML nhanh với tất cả ảnh đã chụp
open [article-dir]/preview.html  # nếu có
# hoặc: open từng ảnh trong finder
open [images-dir]
```

---

## ANNOTATION PIPELINE

### Luồng chính (in-DOM — mặc định cho ảnh chụp mới)

Highlight/cursor/blur đã nằm TRONG ảnh từ Bước 4 (in-DOM), crop đã xong bằng `shot` selector+padding.
`annotate.js` chỉ lên khung — truyền annotations rỗng `'[]'`:

```bash
node ~/.claude/tools/annotate.js input.png output.png '[]' \
  '{"bgStyle": "pastel", "paddingX": 120, "paddingY": 100, "subPadding": 36, "imageRadius": 14, "outerRadius": 42}'
```

> Khung pastel render bằng **satori engine** (CSS layout — bg giữ nguyên SVG pastel, frame frosted
> theo spec Figma). Nếu satori lỗi sẽ tự fallback engine Sharp cũ (hoặc ép bằng `"engine": "sharp"`).

### Luồng fallback (vẽ-đè-sau — CHỈ khi không chụp lại được, vd ảnh có sẵn từ user)

**A. Crop browser chrome** — dùng Crop Tool để user chọn cropY:
```bash
open ~/.claude/tools/crop-tool.html
```

**B. Xác định vùng highlight** — ưu tiên selector:
```bash
node ~/.claude/tools/capture.js run iframe-bbox "[selector]"
# → {x, y, width, height} PAGE coords (KHÔNG cộng iframe offset)
```
Fallback: user vẽ tay qua `open ~/.claude/tools/annotation-tool.html` → copy JSON.

**C. Annotate** — box sketchy (roughjs hand-drawn) + cursor vẽ đè bằng Sharp:
```bash
node ~/.claude/tools/annotate.js input.png output.png \
  '{"box": {"x": 100, "y": 200, "width": 80, "height": 36}, "position": "bottom-right"}' \
  '{"style": "sketchy", "bgStyle": "pastel", "paddingX": 120, "paddingY": 100, "subPadding": 36, "imageRadius": 14, "outerRadius": 42}'
```

**Options chuẩn (không thay đổi giữa các ảnh):**

| Option | Value | Mô tả |
|--------|-------|-------|
| `bgStyle` | `"pastel"` | Pastel gradient (blue-pink-peach) |
| `paddingX` | `120` | Outer padding ngang |
| `paddingY` | `100` | Outer padding dọc |
| `subPadding` | `36` | Gap giữa screenshot và frame |
| `imageRadius` | `14` | Bo góc screenshot (ảnh app, native px) |
| `outerRadius` | `42` | Bo góc canvas ngoài cùng (native px) |

**Standard 3 lớp bo góc (native px @ ~2800px width):**

| Lớp | Native radius | Visible @ display ~800px |
|-----|--------------|---------------------------|
| Ảnh app (innermost) | `imageRadius: 14` | ~4px |
| Sub-bg frame | `subR = 36` (auto = `imageRadius + round(subPadding × 0.6)`) | ~10px |
| Bg ngoài cùng | `outerRadius: 42` | ~12px |

> Outer 42px được tính để khi ảnh được render trong HTML/GitBook ở display ~800px sẽ visible ~12px, match với CSS `border-radius: 12px` của thẻ `<img>` HTML preview. Đổi display width thì điều chỉnh: `outerRadius = displayRadius × (nativeWidth / displayWidth)`.

Sub-background frame spec (Figma): `border-radius: 20px`, `border: 2px solid #FFF (gradient opacity)`, `background: linear-gradient(180deg, rgba(233,237,245,0.30) → rgba(220,231,251,0.10))`, `box-shadow: 2px 2px 17px rgba(0,0,0,0.12)`.

---

## ANNOTATION RULES

### Verb-based decision (từ step description):

| Verb nhóm | Ví dụ | Annotate? |
|-----------|-------|-----------|
| **Action** | Click, Toggle, Enter, Select, Enable, Upload, Paste, Save | **Yes** — red box + arrow |
| **Observation** | Review, Verify, Check, Notice, See, Confirm | **No** — plain screenshot |
| **Transient** | Wait, Loading, Saving | **Skip** — không chụp |

> Luôn ưu tiên `annotate:` field trong placeholder nếu đã có sẵn.

### Annotation style:
- **`clean`** (default — PO chốt 07-07) — box đỏ trơn stroke-only, bo góc 8px
- **`sketchy`** — hand-drawn Excalidraw-like (chỉ dùng khi PO yêu cầu)

---

## SELECTOR TIPS

```
# Button by text
button:has-text('Save')

# Polaris components
.Polaris-Button--primary
.Polaris-Select
.Polaris-TextField
[role='switch']
[role='tab']

# Inside iframe
node ~/.claude/tools/capture.js run iframe-wait ".Polaris-Page"
node ~/.claude/tools/capture.js run iframe-click "button:has-text('Save')"
```

---

## OUTPUT PATH (BẮT BUỘC — match user-guide skill)

Mọi screenshot phải lưu vào folder `images/` của bài tương ứng theo cấu trúc cố định:

```
[project_root]/userguide/[guide-slug]/images/[filename].png
```

Tên file: `stepN-[action].png` hoặc `NN-[descriptor].png` (zero-padded để sort đúng).

**Ví dụ:**
```
~/Downloads/CB-userguide-drafts/userguide/plans-pricing/images/01-overview.png
~/Downloads/CB-userguide-drafts/userguide/plans-pricing/images/02-billing-toggle.png
~/Downloads/CB-userguide-drafts/userguide/configure-cookie-bar/images/step1-activate.png
~/Downloads/CB-userguide-drafts/userguide/configure-cookie-bar/images/step2-style-tab.png
```

**Path tham chiếu trong file `.md`:** Vì `content/` và `images/` cùng cha là folder guide, file `.md` (nằm trong `content/`) reference ảnh qua `../images/[filename].png`.

**Quy tắc:**
- KHÔNG share folder `images/` giữa các bài
- KHÔNG dùng cấu trúc cũ `images/[slug]/...`
- Khi placeholder trong .md ghi `../images/foo.png` → output thực tế phải là `[guide_root]/images/foo.png`
