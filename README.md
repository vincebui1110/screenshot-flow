# Screenshot Flow — Help Center Image Capture

> **⚠️ Đọc trước — cơ chế đăng nhập (Cách 1, bán tự động):** gói này **KHÔNG chứa file
> credential/key nào**. Bạn **tự đăng nhập 1 lần** (Google/Shopify) trong cửa sổ Chrome mà tool
> mở ra — session lưu vào profile Chrome riêng trên máy bạn (`~/.chrome-debug-profile`), không ai
> khác đọc được. Sau đó AI chụp tự động. Khi session hết hạn (Shopify bắt đăng nhập lại sau vài
> ngày–tuần) thì bạn **đăng nhập lại 1 lần** rồi chạy tiếp. → Không nhập key vào bất kỳ file nào;
> không có bước "điền mật khẩu vào .env".

Chụp ảnh app Shopify (hoặc bất kỳ web nào cần login) có annotation đẹp
(highlight box đỏ, cursor, blur PII, khung pastel frosted) cho user guide / help center.

Kiến trúc: **Playwright điều khiển Chrome qua CDP** + annotate **in-DOM** (toạ độ do browser lo,
không lệch DPR/iframe) + engine lên khung (satori/sharp).

---

## 1. Yêu cầu (prerequisites)

| Thứ | Ghi chú |
|-----|---------|
| **Node.js ≥ 18** | `node -v` |
| **Google Chrome** (hoặc Chromium) | Luồng thật (`run`) điều khiển Chrome hệ thống của bạn qua CDP |
| macOS / Linux / Windows | Đường Chrome tự dò; đổi bằng env `CHROME_PATH` nếu cần |

---

## 2. Cài đặt

```bash
# 1. Clone repo
git clone https://github.com/vincebui1110/screenshot-flow.git
cd screenshot-flow

# 2. Cài deps + tạo profile
bash install.sh
```

Script `install.sh` sẽ: `npm install` trong `tools/` (playwright, satori, sharp, roughjs,
rough-notation, @resvg), cài Chromium cho Playwright (tùy chọn — chỉ cần cho lệnh `launch`),
tạo thư mục profile `~/.chrome-debug-profile`.

Xong bước này → sang **mục 3 (Login lần đầu)**: đăng nhập 1 lần trong cửa sổ Chrome, không nhập
key vào file nào.

### Hai cách dùng

- **A. Drop-in cho Claude Code** (khuyến nghị nếu bạn xài Claude Code): copy vào `~/.claude`:
  ```bash
  cp -R tools/*        ~/.claude/tools/
  cp -R skills/screenshot ~/.claude/skills/
  ```
  → mọi path `~/.claude/tools/...` trong SKILL.md chạy nguyên.
- **B. Standalone**: chạy trực tiếp từ thư mục gói, ví dụ `node tools/capture.js run goto url`.

---

## 3. ⭐ Login lần đầu (điểm mấu chốt — session KHÔNG đi kèm gói)

Luồng dùng **1 profile Chrome RIÊNG** (mặc định `~/.chrome-debug-profile`), **không** phải Chrome
thường của bạn — vì Chrome ≥136 chặn CDP trên profile mặc định (bảo mật). Session đăng nhập Shopify
**nằm bên trong profile riêng này**, nên phải **login 1 lần**; sau đó session persist mãi.

```bash
# Mở Chrome (profile riêng) rồi tự đăng nhập trong cửa sổ đó:
node tools/capture.js run goto "https://admin.shopify.com"
#   → 1 cửa sổ Chrome mới hiện ra (đang dùng profile riêng, CHƯA login)
#   → đăng nhập tài khoản Shopify của bạn NGAY TRONG cửa sổ đó
# Xác nhận đã login:
node tools/capture.js run check-login   # → {"loggedIn": true}
```

> Session giữ trong `~/.chrome-debug-profile`. Lần sau khỏi login lại (trừ khi cookie hết hạn).

**Bảo mật:** gói này **không** chứa cookie/đăng nhập của ai — mỗi người tự login vào profile của mình.

---

## 4. Dùng nhanh

```bash
# Điều hướng
node tools/capture.js run goto "https://admin.shopify.com/store/<STORE>/apps/<APP_HANDLE>"
# Ổn định trang (tắt animation, chờ load), rồi chụp 1 vùng + padding
node tools/capture.js run stabilize
node tools/capture.js run highlight "button:has-text('Save')"   # box đỏ bám nút Save
node tools/capture.js run cursor    "button:has-text('Save')"   # cursor overlay
node tools/capture.js run shot ".Polaris-Page" /tmp/raw.png 24  # chụp 2x retina
node tools/capture.js run clear-annotations                     # dọn overlay
# Lên khung pastel:
node tools/annotate.js /tmp/raw.png /tmp/final.png '[]' \
  '{"bgStyle":"pastel","paddingX":120,"paddingY":100,"subPadding":36,"imageRadius":14,"outerRadius":42}'
```

Chi tiết workflow (single / from-script / overview / compose) xem `skills/screenshot/SKILL.md`.

---

## 5. Portability — biến môi trường (override, default giữ nguyên)

| Env | Default | Khi nào đổi |
|-----|---------|-------------|
| `CHROME_DEBUG_PROFILE` | `~/.chrome-debug-profile` | Muốn profile ở chỗ khác / nhiều profile cho nhiều store |
| `CDP_PORT` | `9222` | Cổng 9222 đã bị Chrome debug khác chiếm |
| `CHROME_PATH` | tự dò theo OS | Chrome cài chỗ lạ, hoặc muốn ép Chromium |

Ví dụ dùng store thứ 2 với profile + port riêng:
```bash
CHROME_DEBUG_PROFILE="$HOME/.chrome-store2" CDP_PORT=9333 \
  node tools/capture.js run goto "https://admin.shopify.com"
```

---

## 6. Lưu ý: 2 cơ chế Chrome (đừng nhầm)

- **Luồng này (capture.js)** = Playwright CDP trên profile riêng `~/.chrome-debug-profile`. Dùng cho **chụp ảnh**.
- Nếu bạn cũng xài Claude Code có **`claude-in-chrome` (MCP extension)** — đó là cơ chế KHÁC, chạy trên
  Chrome thường của bạn, dùng cho **tương tác web tự do**. Hai cái tách biệt, session KHÔNG chung.
  Muốn chụp Shopify đúng account → luôn dùng **capture.js**, không dùng MCP extension.

---

## 7. Troubleshoot

| Triệu chứng | Xử lý |
|-------------|-------|
| `Chrome không khởi động` sau 20s | Kiểm tra Google Chrome đã cài; set `CHROME_PATH` |
| `loggedIn: false` mãi | Login trong cửa sổ Chrome profile riêng (mục 3), không phải Chrome thường |
| Cổng 9222 bận | Đặt `CDP_PORT=9333` (và dùng cùng giá trị cho mọi lệnh) |
| Ảnh 1x không nét | Bình thường tool tự chụp 2x qua CDP; nếu fallback 1x là do CDP session lỗi — thử lại |
| satori/sharp lỗi cài | Cần build tool native cho `sharp`; xem log `npm install` |

---

## 8. Danh sách file trong gói

```
README.md                         ← file này
install.sh                        ← cài deps + tạo profile
skills/screenshot/SKILL.md        ← hướng dẫn luồng (đã genericize, không còn store Avada)
tools/capture.js                  ← điều khiển Chrome CDP + annotate in-DOM (đã patch đa nền + env)
tools/annotate.js                 ← engine khung pastel (satori/sharp)
tools/compose.js                  ← ghép nhiều ảnh 1 khung
tools/config/annotation-rules.json
tools/crop-tool.html              ← fallback crop tay
tools/annotation-tool.html        ← fallback vẽ box tay
tools/package.json + package-lock.json
```
