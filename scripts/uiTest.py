# Quét tự động toàn bộ UI TRIOSMART: đăng nhập, mở từng trang, click tương tác chính,
# bắt console error + page error (crash trắng trang) + trang render rỗng.
# Chạy: python3 scripts/uiTest.py  (cần api :3002 + receiver :3001 + worker đang chạy)
import json, sys, time
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:3002'
EMAIL, PASSWORD = 'admin@triosmart.local', '123456'
SHOT_DIR = '/private/tmp/claude-501/-Users-man-Downloads-Phuong/c8d5e9a4-99e2-4b5b-97c1-dd99207f1395/scratchpad'

issues = []          # (page, kind, detail)
current = {'name': 'init'}

def note(kind, detail):
    issues.append((current['name'], kind, str(detail)[:600]))

def visit(page, name, path, expect_text=None):
    current['name'] = name
    page.goto(f'{BASE}{path}')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(600)
    body = page.inner_text('body').strip()
    if len(body) < 20:
        note('BLANK', f'trang gần như trắng (body {len(body)} ký tự)')
        page.screenshot(path=f'{SHOT_DIR}/blank-{name}.png')
    elif expect_text and expect_text not in body:
        note('MISSING', f'không thấy chữ "{expect_text}"')
    return body

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    # "Failed to load resource" là noise trình duyệt cho MỌI response non-2xx —
    # UI đã xử lý các mã đó bằng toast/redirect nên không phải bug; chỉ bắt lỗi JS thật.
    page.on('console', lambda m: note('CONSOLE', m.text)
            if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    page.on('pageerror', lambda e: note('PAGEERROR', e))

    # ---- login ----
    current['name'] = 'login'
    page.goto(BASE)
    page.wait_for_load_state('networkidle')
    if 'Đăng nhập' not in page.inner_text('body'):
        note('BLANK', 'trang login không hiện')
    page.fill('input[type=email]', EMAIL)
    page.fill('input[type=password]', PASSWORD)
    page.click('button:has-text("Đăng nhập")')
    page.wait_for_timeout(1200)
    if 'Tổng quan' not in page.inner_text('body'):
        note('LOGIN', 'đăng nhập không chuyển vào app')

    # ---- các trang chính ----
    visit(page, 'dashboard', '/', 'Tổng quan')
    visit(page, 'customers', '/customers', 'Danh sách khách hàng')

    # mở hồ sơ khách đầu tiên
    current['name'] = 'customer-profile'
    links = page.locator('td a').all()
    if links:
        links[0].click()
        page.wait_for_timeout(1000)
        body = page.inner_text('body')
        if 'Dòng thời gian' not in body:
            note('MISSING', 'hồ sơ 360 thiếu timeline')
        # thử sửa + lưu (kiểm tra toast trung thực)
        try:
            page.click('button:has-text("Sửa")')
            page.wait_for_timeout(300)
            page.fill('.field input.inp >> nth=0', f'Tên UI Test {int(time.time())}')
            page.click('button:has-text("Lưu")')
            page.wait_for_timeout(1500)
            toast = page.locator('.toast').all_inner_texts()
            if not toast:
                note('EDIT', 'lưu hồ sơ không hiện thông báo')
        except Exception as e:
            note('EDIT', e)
    else:
        note('MISSING', 'danh sách khách không có link nào')

    visit(page, 'segments', '/segments', 'Bảng phân khúc')
    # click 1 ô phân khúc → phải mở customers lọc sẵn
    current['name'] = 'segments-click'
    cards = page.locator('.seg-card').all()
    if cards:
        cards[0].click()
        page.wait_for_timeout(800)
        if '/customers' not in page.url:
            note('NAV', 'click phân khúc không mở danh sách')
    visit(page, 'my-work', '/my-work', 'Việc của tôi')
    visit(page, 'merge-queue', '/merge-queue', 'Hàng đợi gộp')
    visit(page, 'sync-logs', '/sync-logs', 'Nhật ký đồng bộ')

    # tab đợt đồng bộ + xem payload thô
    current['name'] = 'sync-logs-tabs'
    try:
        page.click('button:has-text("Đợt đồng bộ")')
        page.wait_for_timeout(500)
        page.click('button:has-text("Sự kiện webhook")')
        page.wait_for_timeout(500)
        det = page.locator('details.payload summary').first
        if det.count():
            det.click(); page.wait_for_timeout(300)
    except Exception as e:
        note('TAB', e)

    visit(page, 'audit', '/audit', 'Nhật ký thao tác')
    visit(page, 'connections', '/connections', 'Quản lý kết nối')

    # nút kiểm tra kết nối (mong đợi toast lỗi thật vì credential demo)
    current['name'] = 'connections-test'
    try:
        btn = page.locator('button:has-text("Kiểm tra kết nối")').first
        if btn.count():
            btn.click(); page.wait_for_timeout(2500)
            if not page.locator('.toast').all_inner_texts():
                note('CONN', 'bấm kiểm tra kết nối không hiện kết quả')
    except Exception as e:
        note('CONN', e)

    # wizard thêm kết nối bước 1 (không tạo thật — chỉ mở/đóng)
    current['name'] = 'connections-wizard'
    try:
        page.click('button:has-text("+ Thêm kết nối")')
        page.wait_for_timeout(400)
        if 'bước 1/3' not in page.inner_text('body'):
            note('WIZARD', 'modal wizard không mở')
        page.click('button:has-text("Đóng")')
    except Exception as e:
        note('WIZARD', e)

    visit(page, 'users', '/users', 'Người dùng và phân quyền')

    # tạo user staff rồi đăng nhập lại bằng user đó
    current['name'] = 'users-create'
    staff_email = f'staff-ui-{int(time.time())}@t.vn'
    try:
        page.click('button:has-text("+ Thêm người dùng")')
        page.wait_for_timeout(400)
        page.fill('.modal input.inp >> nth=0', staff_email)
        page.fill('.modal input.inp >> nth=1', 'Staff UI')
        page.fill('.modal input[type=password]', 'staffmk123')
        page.click('.modal button:has-text("Lưu")')
        page.wait_for_timeout(800)
        if staff_email not in page.inner_text('body'):
            note('USERS', 'user mới không xuất hiện trong bảng')
    except Exception as e:
        note('USERS', e)

    visit(page, 'settings', '/settings', 'Cấu hình hệ thống')
    current['name'] = 'settings-save'
    try:
        page.click('button:has-text("Lưu ngưỡng RFM")')
        page.wait_for_timeout(800)
        if not page.locator('.toast').all_inner_texts():
            note('SETTINGS', 'lưu RFM không hiện thông báo')
    except Exception as e:
        note('SETTINGS', e)

    # ---- đăng nhập bằng staff: menu phải ít đi ----
    current['name'] = 'staff-login'
    try:
        page.click('button:has-text("Đăng xuất")')
        page.wait_for_timeout(600)
        page.fill('input[type=email]', staff_email)
        page.fill('input[type=password]', 'staffmk123')
        page.click('button:has-text("Đăng nhập")')
        page.wait_for_timeout(1200)
        body = page.inner_text('body')
        if 'Danh sách khách' not in body:
            note('STAFF', 'staff đăng nhập không vào được app')
        if 'Kết nối' in body.split('Tài khoản')[0] or 'Cấu hình' in body.split('Tài khoản')[0]:
            note('STAFF', 'staff vẫn thấy menu quản trị')
        page.goto(f'{BASE}/sync-logs'); page.wait_for_timeout(800)
        if '/customers' not in page.url:
            note('STAFF', 'staff mở /sync-logs không bị đá về danh sách khách')
        if len(page.inner_text('body').strip()) < 20:
            note('BLANK', 'staff mở /sync-logs bị trắng trang')
    except Exception as e:
        note('STAFF', e)

    page.screenshot(path=f'{SHOT_DIR}/ui-final.png', full_page=True)
    browser.close()

print('\n===== KẾT QUẢ UI TEST =====')
if not issues:
    print('🎉 KHÔNG PHÁT HIỆN LỖI NÀO')
else:
    for pg, kind, detail in issues:
        print(f'❌ [{pg}] {kind}: {detail}')
    print(f'\n💥 {len(issues)} vấn đề')
sys.exit(0 if not issues else 1)
