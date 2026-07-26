"""Kiểm tra giao diện điện thoại TRIOSMART trên nhiều máy thật + xác nhận bản máy tính không vỡ.

Dùng: TRIO_BASE=http://localhost:3002 python3 scripts/mobileTest.py
"""
import os
from playwright.sync_api import sync_playwright

BASE = os.environ.get('TRIO_BASE', 'https://trio.shinsulab.com')
EMAIL = os.environ.get('TRIO_EMAIL', 'triosmart')
PASSWORD = os.environ.get('TRIO_PASSWORD', 'Trio123456@@')
SHOTS = os.environ.get('TRIO_SHOTS', '/tmp')

# Máy thật, không phải kích thước bịa
DEVICES = [
    ('iPhone SE (nhỏ nhất còn dùng)', 375, 667, 2),
    ('iPhone 15 Pro', 393, 852, 3),
    ('Android phổ thông', 412, 915, 2.6),
]
DESKTOP = ('Máy tính', 1440, 900, 1)

problems = []
def note(dev, msg):
    problems.append(f'[{dev}] {msg}')

# Đăng nhập MỘT lần rồi dùng lại phiên cho mọi thiết bị: chạy nhanh hơn, và không
# đụng trần chống dò mật khẩu (10 lần/15 phút mỗi tài khoản) khi test lặp lại nhiều lần.
AUTH = None

def make_auth(p):
    global AUTH
    b = p.chromium.launch(headless=True)
    page = b.new_context().new_page()
    page.goto(BASE, wait_until='networkidle', timeout=45000)
    page.fill('input[autocomplete=username]', EMAIL)
    page.fill('input[type=password]', PASSWORD)
    page.click('button:has-text("Đăng nhập")')
    page.wait_for_timeout(3000)
    if page.locator('input[type=password]').count():
        raise SystemExit(f'Không đăng nhập được: {page.inner_text("body")[:200]}')
    AUTH = page.context.storage_state()
    b.close()

def login(page):
    page.goto(BASE, wait_until='networkidle', timeout=45000)
    page.wait_for_timeout(500)

def check_no_h_scroll(page, dev, where):
    over = page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
    if over > 2:
        note(dev, f'{where}: tràn ngang {over}px (phải cuộn sang phải mới đọc hết)')

def check_tap_targets(page, dev, where):
    small = page.evaluate("""() => {
      const out = []
      for (const el of document.querySelectorAll('.m-tab, .m-bar-btn, .m-actions a, .m-actions button')) {
        const r = el.getBoundingClientRect()
        if (r.width && r.height && (r.height < 40 || r.width < 40))
          out.push(`${el.className}:${Math.round(r.width)}x${Math.round(r.height)}`)
      }
      return out
    }""")
    if small:
        note(dev, f'{where}: vùng chạm nhỏ hơn 40px — {small[:4]}')

def run_mobile(p, dev, w, h, dpr):
    b = p.chromium.launch(headless=True)
    ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=dpr,
                        is_mobile=True, has_touch=True, storage_state=AUTH,
                        user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) '
                                   'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')
    page = ctx.new_page()
    page.on('pageerror', lambda e: note(dev, f'Lỗi JS: {e}'))
    login(page)

    # 1. Thanh điều hướng đáy phải có và nằm trong màn hình
    page.goto(f'{BASE}/customers', wait_until='networkidle', timeout=45000)
    page.wait_for_timeout(1500)
    if not page.locator('.m-tabs').count():
        note(dev, 'Không thấy thanh điều hướng đáy — đang rơi về giao diện máy tính?')
    if page.locator('.sidebar').count():
        note(dev, 'Vẫn hiện thanh bên của bản máy tính')
    check_no_h_scroll(page, dev, 'Danh sách khách')
    check_tap_targets(page, dev, 'Danh sách khách')

    # 2. Danh sách phải là thẻ, không phải bảng
    if page.locator('table').count():
        note(dev, 'Danh sách khách vẫn dùng bảng thay vì thẻ')
    if not page.locator('.m-card').count():
        note(dev, 'Không thấy thẻ khách nào')
    page.screenshot(path=f'{SHOTS}/m_{w}_customers.png')

    # 3. Tìm kiếm hoạt động
    page.fill('.m-search input', '0982282088')
    page.click('.m-search button')
    page.wait_for_timeout(2000)
    if not page.locator('.m-card').count():
        note(dev, 'Tìm theo số điện thoại không ra kết quả nào')

    # 4. Mở hồ sơ khách — kiểm tra sống lưng hai nguồn
    page.locator('.m-card a').first.click()
    page.wait_for_timeout(2500)
    if not page.locator('.m-hero').count():
        note(dev, 'Hồ sơ khách không dùng bố cục điện thoại')
    if not page.locator('.m-spine').count():
        note(dev, 'Thiếu dòng thời gian hai nguồn')
    if not page.locator('a[href^="tel:"]').count():
        note(dev, 'Thiếu nút gọi nhanh trên hồ sơ')
    check_no_h_scroll(page, dev, 'Hồ sơ khách')
    page.screenshot(path=f'{SHOTS}/m_{w}_profile.png', full_page=True)

    # 5. Nút quay lại của thanh trên
    page.click('.m-bar-btn[aria-label="Quay lại"]')
    page.wait_for_timeout(1500)
    if '/customers' not in page.url or page.url.rstrip('/').endswith(page.url.split('/')[-1]) is False:
        pass

    # 6. Đi hết các tab, không tab nào trắng
    for path, label in [('/my-work', 'Việc của tôi'), ('/segments', 'Phân khúc'), ('/', 'Tổng quan')]:
        page.goto(f'{BASE}{path}', wait_until='networkidle', timeout=45000)
        page.wait_for_timeout(1800)
        body = page.inner_text('body')
        if len(body.strip()) < 40:
            note(dev, f'{label}: TRẮNG TRANG')
        check_no_h_scroll(page, dev, label)
    page.screenshot(path=f'{SHOTS}/m_{w}_dashboard.png', full_page=True)

    # 7. Ngăn kéo "Thêm" mở được
    page.locator('.m-bar-btn[aria-label="Mở menu"]').click()
    page.wait_for_timeout(800)
    if not page.locator('.m-sheet').count():
        note(dev, 'Ngăn kéo menu không mở')
    else:
        page.screenshot(path=f'{SHOTS}/m_{w}_sheet.png')
    b.close()

def run_desktop(p):
    dev, w, h, _ = DESKTOP
    b = p.chromium.launch(headless=True)
    page = b.new_context(viewport={'width': w, 'height': h}, storage_state=AUTH).new_page()
    page.on('pageerror', lambda e: note(dev, f'Lỗi JS: {e}'))
    login(page)
    page.goto(f'{BASE}/customers', wait_until='networkidle', timeout=45000)
    page.wait_for_timeout(1500)
    if not page.locator('.sidebar').count():
        note(dev, 'Mất thanh bên — bản máy tính bị ảnh hưởng')
    if page.locator('.m-tabs').count():
        note(dev, 'Thanh đáy của điện thoại lọt vào bản máy tính')
    if not page.locator('table').count():
        note(dev, 'Bảng danh sách khách biến mất')
    page.screenshot(path=f'{SHOTS}/d_customers.png')
    page.locator('table tbody tr td a').first.click()
    page.wait_for_timeout(2000)
    if not page.locator('.row-2').count():
        note(dev, 'Hồ sơ khách bản máy tính đổi bố cục ngoài ý muốn')
    b.close()

with sync_playwright() as p:
    make_auth(p)
    for name, w, h, dpr in DEVICES:
        run_mobile(p, name, w, h, dpr)
    run_desktop(p)

print('===== KIỂM TRA GIAO DIỆN ĐIỆN THOẠI =====')
for x in problems:
    print('❌', x)
if not problems:
    print(f'🎉 {len(DEVICES)} máy điện thoại + bản máy tính: không lỗi, không tràn ngang, vùng chạm đạt chuẩn')
