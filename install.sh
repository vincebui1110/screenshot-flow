#!/usr/bin/env bash
# Screenshot Flow — installer. Cài deps Node + Chromium (tùy chọn) + tạo profile dir.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "==> Screenshot Flow install"
echo "    bundle: $DIR"

# 1. Kiểm tra Node
if ! command -v node >/dev/null 2>&1; then
  echo "!! Node.js chưa cài. Cài Node ≥18 rồi chạy lại." >&2
  exit 1
fi
echo "    node: $(node -v)"

# 2. Cảnh báo nếu chưa có Chrome (luồng `run` cần Chrome hệ thống)
if [ "$(uname)" = "Darwin" ] && [ ! -d "/Applications/Google Chrome.app" ]; then
  echo "!! Chưa thấy Google Chrome ở /Applications — luồng chụp cần Chrome. Cài Chrome hoặc set CHROME_PATH."
fi

# 3. npm install trong tools/
echo "==> npm install (tools/)"
cd "$DIR/tools"
npm install

# 4. Chromium cho Playwright — chỉ cần cho lệnh `capture.js launch` (foreground). Tùy chọn.
echo "==> Cài Chromium cho Playwright (tùy chọn, dùng cho lệnh 'launch')"
npx playwright install chromium || echo "   (bỏ qua — không bắt buộc; luồng 'run' dùng Chrome hệ thống)"

# 5. Tạo profile dir
PROFILE="${CHROME_DEBUG_PROFILE:-$HOME/.chrome-debug-profile}"
mkdir -p "$PROFILE"
echo "==> Profile Chrome: $PROFILE"

echo ""
echo "✅ Xong. Bước kế — LOGIN LẦN ĐẦU (xem README mục 3):"
echo "   node \"$DIR/tools/capture.js\" run goto \"https://admin.shopify.com\""
echo "   → đăng nhập Shopify trong cửa sổ Chrome vừa mở, rồi:"
echo "   node \"$DIR/tools/capture.js\" run check-login"
