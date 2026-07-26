# Tái hiện "bấm qua bấm lại": click ngẫu nhiên các mục sidebar liên tục nhiều vòng,
# xen kẽ Back/Forward của trình duyệt, click không chờ trang load xong (giống người thật).
# Bắt: trang trắng, pageerror (crash React), console error JS thật.
import random, sys, time
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:3002'
EMAIL, PASSWORD = 'admin@triosmart.local', '123456'
SHOT = '/private/tmp/claude-501/-Users-man-Downloads-Phuong/c8d5e9a4-99e2-4b5b-97c1-dd99207f1395/scratchpad'
NAV_ITEMS = ['Danh sách khách', 'Phân khúc', 'Việc của tôi', 'Tổng quan',
             'Hàng đợi gộp', 'Nhật ký đồng bộ', 'Nhật ký thao tác',
             'Kết nối', 'Người dùng', 'Cấu hình']
ROUNDS = 60
issues = []

def blank_check(page, step):
    body = page.inner_text('body').strip()
    if len(body) < 20:
        issues.append(f'BLANK sau bước {step} (url={page.url})')
        page.screenshot(path=f'{SHOT}/stress-blank-{len(issues)}.png')
        return True
    if 'Giao diện gặp lỗi' in body:
        err = page.locator('pre').first.inner_text() if page.locator('pre').count() else '?'
        issues.append(f'CRASH (ErrorBoundary) sau bước {step}: {err} (url={page.url})')
        page.screenshot(path=f'{SHOT}/stress-crash-{len(issues)}.png')
        page.click('button:has-text("Tải lại trang")')
        page.wait_for_timeout(800)
        return True
    return False

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    page.on('pageerror', lambda e: issues.append(f'PAGEERROR: {str(e)[:400]} (url={page.url})'))
    page.on('console', lambda m: issues.append(f'CONSOLE: {m.text[:300]}')
            if m.type == 'error' and 'Failed to load resource' not in m.text else None)

    page.goto(BASE); page.wait_for_load_state('networkidle')
    page.fill('input[type=email]', EMAIL)
    page.fill('input[type=password]', PASSWORD)
    page.click('button:has-text("Đăng nhập")')
    page.wait_for_timeout(1200)

    random.seed(2026)
    for i in range(ROUNDS):
        action = random.random()
        try:
            if action < 0.70:
                # click sidebar KHÔNG chờ — giống người bấm nhanh liên tục
                item = random.choice(NAV_ITEMS)
                page.click(f'.sidebar >> text={item}', timeout=3000)
            elif action < 0.85:
                page.go_back(timeout=5000)
            else:
                page.go_forward(timeout=5000)
        except Exception:
            pass                                    # back/forward hết lịch sử — bỏ qua
        page.wait_for_timeout(random.choice([80, 150, 400, 900]))
        if blank_check(page, i):
            break
        # thỉnh thoảng mở hồ sơ khách rồi quay ra
        if random.random() < 0.15:
            links = page.locator('td a')
            if links.count():
                try:
                    links.first.click(timeout=2000)
                    page.wait_for_timeout(random.choice([150, 600]))
                    if blank_check(page, f'{i}-profile'):
                        break
                except Exception:
                    pass

    # đi hết một vòng tuần tự lần cuối, chờ hẳn từng trang
    for item in NAV_ITEMS:
        try:
            page.click(f'.sidebar >> text={item}', timeout=3000)
            page.wait_for_timeout(700)
            if blank_check(page, f'final-{item}'):
                break
        except Exception as e:
            issues.append(f'NAV {item}: {str(e)[:200]}')
    browser.close()

print('\n===== KẾT QUẢ STRESS TEST =====')
if not issues:
    print(f'🎉 {ROUNDS} lượt điều hướng loạn xạ + back/forward — KHÔNG trắng trang, KHÔNG crash')
else:
    seen = set()
    for x in issues:
        if x not in seen:
            seen.add(x); print('❌', x)
    print(f'\n💥 {len(issues)} vấn đề')
sys.exit(0 if not issues else 1)
