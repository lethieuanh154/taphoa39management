# TapHoa39Management - Hệ thống Quản lý Nhân sự & Đơn hàng

## Tổng quan

TapHoa39Management là ứng dụng quản lý dành cho Song Minh Shop, xây dựng trên **Angular 20** (Standalone Components). Ứng dụng cung cấp các chức năng quản lý đơn hàng, nhân sự, lịch làm việc, chấm công, tính lương và khuyến mãi.

- **Dev server:** `ng serve --port 4201`
- **Build output:** `dist/taphoa39management/browser/`

---

## ⚠️ CODE MIRROR — TapHoa39BanHang

App này **copy code** từ `TapHoa39BanHang`, không share package. Fix một bên là bên kia vẫn còn lỗi.

| Vùng mirror | Mức trùng |
|---|---|
| `src/app/components/edit-product-page/**` | 51/58 file `.ts`/`.html` giống hệt byte-for-byte |
| `src/app/services/*.ts` | 23/37 file trùng tên giống hệt byte-for-byte |

**Bắt buộc sau mỗi lần sửa vùng mirror:** kiểm tra file cùng đường dẫn ở BanHang, sửa luôn hoặc nói rõ lý do bỏ qua, rồi build cả hai app.

```bash
diff -rq --exclude='*.css' --exclude='*.scss' \
  TapHoa39BanHang/src/app/components/edit-product-page \
  TapHoa39Management/src/app/components/edit-product-page
```

**Đã diverge có chủ đích — KHÔNG copy mù:** `auth.service.ts`, `indexed-db.service.ts` (BanHang có handler `onclose`), `product.service.ts`, `token-expired.service.ts`, `invoice.service.ts`, `order.service.ts`, `kiotviet.service.ts`, `merged-products.service.ts`, và trong `edit-product-page/`: `edit-product-page-refactored.component.ts` + `.html`, `services/product-edit.service.ts`, `invoice-processing-page.component.ts`, `match-review-dialog.component.ts`, `edit-product-dialog/`, `product-info-dialog/`.

**KHÔNG mirror:** `app.component.*` (Management có sidebar + auth `*ngIf`, BanHang chỉ `<router-outlet>` trần). Hai app **khác origin** → SalesDB / localStorage / sessionStorage **tách biệt hoàn toàn**; code phải đồng bộ nhưng không cần deploy đồng thời.

Doc chi tiết của `edit-product-page` nằm ở `TapHoa39BanHang/docs/components/edit-product-page/EDIT-PRODUCT-PAGE.md`. Rule đầy đủ: mục **MIRRORED CODE** trong `CLAUDE.md` thư mục gốc.

---

## Tech Stack

| Layer | Công nghệ |
|-------|-----------|
| Frontend | Angular 20, Angular Material 20, RxJS 7.8, TypeScript 5.8, SCSS |
| Auth | Firebase Auth (Google Sign-In) - project `quanlysongminh` |
| Database | Firebase Firestore (cloud) + IndexedDB (local cache) |
| Real-time | Firestore onSnapshot (project `taphoa39khachhang`) + WebSocket |
| Backend | Flask API (`http://127.0.0.1:5000`) - shared với TapHoa39BanHang |
| API tích hợp | KiotViet (token auto-refresh) |

---

## Routing

| Path | Component | Guard | Mô tả |
|------|-----------|-------|-------|
| `/login` | LoginPageComponent | loginGuard | Đăng nhập Google |
| `/orders` | OrderPageComponent | authGuard | Quản lý đơn hàng |
| `/employees` | EmployeeListPageComponent | authGuard | Quản lý nhân viên |
| `/work-schedule` | WorkSchedulePageComponent | authGuard | Lịch làm việc tuần |
| `/attendance` | AttendancePageComponent | authGuard | Chấm công |
| `/payroll` | PayrollPageComponent | authGuard | Tính lương |
| `/promotions` | PromotionListPageComponent | authGuard | Quản lý khuyến mãi |
| `/` | → redirect `/orders` | - | Mặc định |

---

## Cấu trúc Project

```
src/app/
├── guards/
│   └── auth.guard.ts .................. authGuard + loginGuard (CanActivateFn)
├── interceptors/
│   └── auth.interceptor.ts ........... KiotViet token injection, 401/403 auto-refresh
├── models/
│   ├── product.model.ts
│   ├── customer.model.ts
│   ├── invoice.model.ts
│   ├── cart-item.model.ts
│   └── promotion.model.ts
├── services/
│   ├── auth.service.ts ............... Google Sign-In, token management
│   ├── order.service.ts .............. Order CRUD (IndexedDB + Firestore)
│   ├── employee.service.ts ........... Employee/Attendance/Payroll CRUD
│   ├── promotion.service.ts .......... Promotion REST API
│   ├── firebase.service.ts ........... API endpoint constants
│   ├── indexed-db.service.ts ......... Generic IndexedDB wrapper (idb lib)
│   ├── order-websocket.service.ts .... Real-time order notifications
│   ├── order-to-invoice.service.ts ... Event bridge order→invoice
│   ├── vietnamese.service.ts ......... Normalize + n-gram search
│   ├── time-zone.service.ts .......... Vietnam timezone formatting
│   ├── print.service.ts .............. Print window utility
│   └── token-expired.service.ts ...... Token expiry redirect
├── components/
│   ├── login-page/ ................... Google Sign-In UI
│   ├── order-page/ ................... Danh sách đơn hàng + search/filter/pagination
│   │   └── view-selected-order/ ...... Dialog xem chi tiết đơn
│   ├── order-detail/ ................. Chi tiết & chỉnh sửa đơn hàng
│   ├── employee-list-page/ ........... Danh sách nhân viên + CRUD
│   │   └── add-worker-dialog/ ........ Dialog thêm nhân viên
│   ├── work-schedule-page/ ........... Lịch ca tuần (Sáng/Chiều/Tối)
│   ├── attendance-page/ .............. Chấm công theo ngày
│   ├── payroll-page/ ................. Tính lương (chính thức + khoán)
│   ├── promotion-list-page/ .......... Danh sách khuyến mãi
│   │   └── promotion-dialog/ ........ Dialog thêm/sửa khuyến mãi
│   └── confirm-popup/ ................ Dialog xác nhận dùng chung
├── app.routes.ts
├── app.component.ts
├── app.config.ts
└── main.ts
```

---

## Chức năng chính

### 1. Quản lý Đơn hàng (`order-page`)

- Hiển thị danh sách đơn hàng từ IndexedDB, sync real-time từ Firestore
- Tìm kiếm theo khách hàng/sản phẩm, lọc theo ngày
- Phân trang 10 đơn/trang
- Real-time updates qua Firestore `onSnapshot` (collection `orderNotifications`, project `taphoa39khachhang`)
- Xem chi tiết, chỉnh sửa, xóa, in đơn hàng
- Debounced sync để tránh gọi API thừa

### 2. Quản lý Nhân viên (`employee-list-page`)

- CRUD nhân viên: mã NV, họ tên, ngày sinh, CCCD, phòng ban, chức danh, liên hệ
- Phân biệt nhân viên đang làm vs đã nghỉ (dựa vào `ngayKetThuc`)
- Tìm kiếm theo mã NV, tên, SĐT, email
- Hỗ trợ nhân viên khoán (`nhanVienKhoan = true`)
- IndexedDB-first loading, sync từ API

### 3. Lịch làm việc (`work-schedule-page`)

- Lưới tuần: T2 → CN
- 3 ca: Sáng (7:00-12:00), Chiều (12:00-17:00), Tối (17:00-22:00)
- Gán nhân viên vào ca làm
- Lưu IndexedDB + sync API

### 4. Chấm công (`attendance-page`)

- Ghi nhận: ngày, nhân viên, giờ vào/ra, tổng giờ, ghi chú
- Lọc theo khoảng ngày
- Auto-sync kết quả chấm công sang payroll (`syncAttendanceToPayrollIndexedDB`)

### 5. Tính lương (`payroll-page`)

**Nhân viên chính thức:**
- Lương cơ bản + phụ cấp (ca, trách nhiệm, xăng xe, điện thoại, ăn trưa)
- Trừ BHXH, BHYT, BHTN → Thực lĩnh

**Nhân viên khoán:**
- `tienKhoan = donGiaGio × tongGioLam` (giờ lấy từ chấm công)
- `tongTienCong = tienKhoan + thuong + phuCap`
- `thueTNCN = 10% × tongTienCong`
- `thucTra = tongTienCong - thueTNCN`

- Lọc theo kỳ (YYYY-MM)
- Batch save, tracking payroll đã xóa (tránh lưu lại)

### 6. Khuyến mãi (`promotion-list-page`)

- 3 loại: `gift` (tặng kèm), `percentage` (giảm %), `fixed_amount` (giảm số tiền)
- Gắn theo sản phẩm mục tiêu + số lượng tối thiểu
- Ngày bắt đầu/kết thúc
- Bật/tắt không cần xóa
- Tích hợp KiotViet: `kiotVietCampaignId`, `kiotVietSalePromotionId`, `kiotVietPromotionType` (5=discount, 6=gift)

---

## Authentication & Security

### Flow đăng nhập
1. User nhấn "Đăng nhập Google" → Firebase `signInWithPopup(GoogleAuthProvider)`
2. Kiểm tra email trong whitelist (`verifyEmailAllowed`)
3. Exchange Firebase token → Flask backend (`/api/auth/login`) → nhận refresh token
4. Lấy KiotViet token → lưu `localStorage`
5. Redirect → `/orders`

### Token Management
- **Refresh token:** `localStorage['taphoa39_refresh_token']`
- **KiotViet token:** `localStorage['kv_access_token']` + `kv_retailer` + `kv_branch_id`
- Auto-check mỗi 2 phút, refresh trước khi hết hạn
- Concurrency lock tránh refresh đồng thời

### HTTP Interceptor
- Tự động gắn KiotViet token vào requests (trừ `/api/auth/*`)
- 401 → auto-refresh token + retry request
- 403 → validate + refresh token

### Mất session không được phá trang đang mở
`app.component.html` dùng **một `<router-outlet>` duy nhất**, KHÔNG bọc trong `*ngIf="auth.isAuthenticated"`.
Trước đây có 2 outlet nằm trong 2 nhánh `*ngIf` đối nghịch → mỗi lần `authState` đổi là component đang hiển thị bị destroy/recreate, mất sạch state trong RAM (rõ nhất ở `/edit-products`: danh sách sản phẩm biến mất). Nay chỉ sidebar + chat-bubble bị toggle; việc điều hướng user chưa đăng nhập do `authGuard` lo.

- `AuthService.clearSession()` (private): xoá token local + `signOut` + phát `authState`, KHÔNG gọi `/api/auth/logout`.
- `AuthService.logout()` (public): revoke refresh token trên server rồi mới `clearSession()`.
- `_doRefresh` gặp 401 → `clearSession()` + `TokenExpiredService.emitTokenExpired('refresh')` (không revoke lại token đã invalid).
- `onAuthStateChanged` mất session đã thiết lập mà không phải do user bấm Đăng xuất → `emitTokenExpired('firebase')`. Cờ `suppressExpiryNotice` chặn báo nhầm khi logout chủ động.
- `app.component.html` render **session banner** từ `TokenExpiredService.showExpiredDialog$` / `expiredMessage$` (nút "Đăng nhập lại" + đóng). Trước đó `emitTokenExpired()` không có UI nào → user bị đá về login không lời giải thích.

### Khôi phục state trang Edit Product
`edit-product-page-refactored.component.ts` snapshot `productGroups` / `searchTerm` / `activeQuery` / `pendingCloneSave` / `productColors` vào **sessionStorage** key `edit_product_page_state` (per-tab), khôi phục ở cuối `ngOnInit`. Giúp sống sót qua component re-create (auth flip, Chrome tab discard, reload).

Snapshot **chỉ để vẽ tạm**: sessionStorage sống qua cả F5 lẫn hard reload, nên `OnHand`/`Cost`/`BasePrice` trong đó đóng băng tại thời điểm search — máy khác sửa tồn kho thì reload bao nhiêu lần cũng thấy số cũ. `restoreState()` gọi tiếp `refreshRestoredData()`: chạy lại `queryProducts()` / `searchProducts()` trên IndexedDB rồi group lại. Re-query rỗng → giữ snapshot. `pendingCloneSave` → re-apply `applyCloneDataToProductGroups()` (clone chưa lưu nằm ở localStorage).

`productGroups` có **3 nguồn gốc**: query builder (`activeQuery`), text search/barcode (`searchTerm`), và **hóa đơn AI** (`lastSearchTerms` — union nhiều term, luồng này KHÔNG set `searchTerm`). `refreshRestoredData()` phải tái tạo đúng nguồn, nếu không SP của hóa đơn bị thay bằng kết quả của một `searchTerm` cũ còn sót → user mất hết dòng đang nhập số lượng. `lastSearchTerms` được persist vào snapshot và clear ở mọi luồng search/query/clear khác.

Realtime có **2 kênh**: `setupCrossTabSync()` (BroadcastChannel — chỉ tab khác cùng browser) và `setupRealtimeSync()` (`ProductService.productOnHandUpdated$` — WebSocket, **giữa các máy**). Cả hai đổ về `patchProductGroups()`, patch tại chỗ và **bỏ qua row `Edited === true`** để không nuốt giá trị user đang nhập.

`cleanOldEditingData()` KHÔNG còn xoá toàn bộ `editing_childProduct_*` — localStorage dùng chung giữa các tab nên xoá hết sẽ mất dữ liệu đang chờ lưu của tab khác. Nay dùng TTL 12h, theo dõi qua index `edit_page_editing_meta` (map key → thời điểm nhìn thấy lần đầu; key lạ được coi là mới).

---

## IndexedDB Schema

### EmployeeDB (v6)

| Store | Key | Dữ liệu |
|-------|-----|----------|
| `employees` | `maNhanVien` | Thông tin nhân viên |
| `attendance` | `id` | Bản ghi chấm công |
| `work_schedules` | `weekStartDate` | Lịch ca tuần |
| `payroll` | `id` | Bảng lương |
| `deleted_payrolls` | `id` | Track payroll đã xóa |

### OrderDB (v3)

| Store | Key | Dữ liệu |
|-------|-----|----------|
| `order` | `id` | Đơn hàng |

### SalesDB — version PHẢI lấy từ `sales-db.config.ts`

`SALES_DB_NAME` / `SALES_DB_VERSION` / `salesDBUpgrade` là nguồn duy nhất. **Không hardcode** tên DB, số version, hay viết `upgradeFn` riêng.

| Store | Key |
|-------|-----|
| `products` | `Id` |
| `categories` | `Id` (index `Name`, `Path`) |
| `categoriesMeta` | `key` |
| `promotions` | `id` |
| `invoiceDrafts` | `sessionId` |
| `invoiceProductMappings` | `id` (index `supplierTaxCode`) |

Trước đây SalesDB bị mở với 4 version khác nhau (7 / 6 / 3 / hardcode). Chưa vỡ chỉ vì `getDB()` cache connection **theo `dbName`, không theo version**, và `initSalesDB()` chạy ở `APP_INITIALIZER` nên mọi lời gọi sau đều hit cache và bỏ qua tham số version. Nay đã đồng bộ hết về `SALES_DB_VERSION`.

**Bẫy:** `ProductService.initDB()` fallback bằng `dbVersion + 1` khi thiếu store. Nếu `upgradeFn` chỉ tạo `products`, DB mới sẽ thiếu 5 store còn lại → `initSalesDB()` bump version lại ở lần boot sau → vòng lặp bump vô hạn. Vì vậy mọi upgrade SalesDB **bắt buộc** dùng `salesDBUpgrade`.

### Chống treo khi upgrade IndexedDB bị chặn
`IndexedDBService.getDB()` mở có version giờ có timeout `OPEN_TIMEOUT_MS = 10s` (`withOpenTimeout`). Một upgrade bị tab khác chặn thì `openDB` **không bao giờ settle** → trước đây treo mọi caller và kẹt spinner vĩnh viễn. Khi timeout/blocked, `openOrFallback()` mở lại theo version đang có trên đĩa để đọc/ghi vẫn chạy với các store hiện tại.

---

## Data Models

### Product
```
Id, Code, Name, FullName, CategoryId, Unit, Cost, BasePrice
OnHand (KiotViet), OnHandNV (nội bộ/clone)
isClone, CloneSourceId, Tax, Description, Image
NormalizedName, NormalizedCode, OrderTemplate
```

### Customer
```
Code, Name, ContactNumber, RewardPoint, TotalPoint, TotalInvoiced
Debt, Groups, Organization, RegistrationBonus
BirthDate, Address, Email, TaxCode, IsActive, Uuid
```

### Invoice / InvoiceTab
```
id, name, createdDate, cartItems[], customer
totalPrice, discountAmount, totalQuantity
customerPaid, debt, totalCost, invoiceVAT
isMergeEnabled, appliedPromotions[], status, onHandSynced
```

### CartItem
```
product, quantity, unitPrice, totalPrice, unitPriceSaleOff
isGift, isPromotionItem, promotionId, promotionName, parentProductId
kiotVietCampaignId, kiotVietSalePromotionId, kiotVietPromotionType
```

### Promotion
```
id, name, type ('gift'|'percentage'|'fixed_amount')
isEnabled, priority, targetProductId/Code/Name, minQuantity
discountPercent/Amount, giftProductId/Code/Name/BasePrice/Quantity
fromDate, toDate, kiotVietCampaignId, kiotVietSalePromotionId
kiotVietPromotionType (5=discount, 6=gift), kiotVietSynced
```

### Employee
```
id, maNhanVien, hoTen, ngaySinh, gioiTinh, soCCCD
phongBan, chucDanh, ngayBatDau, ngayKetThuc
soDienThoai, email, diaChi, hinhAnh, nhanVienKhoan
```

### AttendanceRecord
```
id, date, workerId, workerName
startTime, endTime, totalHours, notes
```

### PayrollRecord
```
id, maNhanVien, hoTen, chucDanh, period (YYYY-MM), nhanVienKhoan
Chính thức: luongCoBan, phuCap*, tongLuong, bhxh, bhyt, bhtn, thucLinh
Khoán: tongGioLam, donGiaGio, tienKhoan, thuong, phuCap, tongTienCong, thueTNCN, thucTra
```

---

## API Endpoints (Flask Backend)

### Auth
- `POST /api/auth/login` - Exchange Firebase token
- `POST /api/auth/verify-email` - Kiểm tra email whitelist
- `POST /api/auth/refresh` - Refresh token
- `POST /api/auth/logout` - Revoke token

### Employee
- `GET /api/firebase/get/employees`
- `POST/PUT/DELETE /api/firebase/*_employee/*`

### Work Schedule
- `GET/POST/PUT/DELETE /api/firebase/work_schedules*`

### Attendance
- `GET/POST/PUT/DELETE /api/firebase/attendance*`

### Payroll
- `GET/POST/PUT/DELETE /api/firebase/payroll*`

### Promotions
- `GET /api/firebase/promotions` - Tất cả
- `GET /api/firebase/promotions/active` - Đang hoạt động
- `GET /api/firebase/promotions/by-product/{productId}` - Theo sản phẩm
- `POST/PUT/DELETE /api/firebase/promotions*`

### Firebase (proxy)
- `GET/POST /api/firebase/invoices/*`
- `GET/POST /api/firebase/add_customer`, `/get/customers`
- `GET/POST /api/firebase/products/*`
- `GET /api/firebase/daily_summary`, `/monthly_summary`, `/yearly_summary`

---

## State Management Pattern

```
IndexedDB (persistent cache)
    ↕ sync
BehaviorSubject (in-memory reactive state)
    ↓ subscribe
Components (UI render)
    ↓ user action
Services (CRUD operations)
    ↕ HTTP
Flask API → Firestore
```

- **IndexedDB-first:** Load từ cache trước, sync API background
- **BehaviorSubject:** `authState$`, `employees$`, `attendance$`, `orderCreated$`, `orderUpdated$`, `orderDeleted$`
- **Event-driven:** Services emit events khi data thay đổi

---

## Kiến trúc Standalone Components

Project sử dụng Angular 20 Standalone Components (không dùng NgModules truyền thống):
- Mỗi component tự import dependencies
- `standalone: true` trên tất cả components
- HTTP/Router/Material config trong `appConfig`
- Interceptors & Guards là functions (không phải classes)
- Ưu điểm: bundle nhỏ hơn, dependency rõ ràng, tree-shaking tốt hơn

---

## Firebase Projects

| Project | Mục đích |
|---------|----------|
| `quanlysongminh` | Auth + Firestore data chính (shared với TapHoa39BanHang) |
| `taphoa39khachhang` | Real-time order notifications (`orderNotifications` collection) |

---

## Edit Product Page - Product Row (Action Column)

Cột "Thao tác" (desktop) gom các nút vào 1 icon (`more_horiz`); hover xổ ra flyout danh sách nút (CSS `.action-hover-wrapper` / `.action-flyout`). iPad vẫn dùng mat-menu.
- **In mã vạch** — `onPrintBarcodeClick()` → `printBarcode()`: prompt số lượng (mặc định = tồn kho), mở window in tem bằng JsBarcode (CDN). Khớp format KiotViet `PrintBarCode2Label`/`Base2Label`: **trang tem 72×22mm chứa 2 tem (36mm/tem)**, CODE128 encode Mã hàng, nội dung Tên → barcode → mã số → giá + "VND".
- Các nút khác: Sync (KV), Clone (KV), Edit/History (Clone), Bỏ khỏi danh sách, Xóa.

---

## Edit Product Page - KiotViet Nhập hàng (XML → phiếu nhập)

Nút toolbar **"Kiotviet Nhập hàng"** (`openKiotVietPurchaseOrder()`) → `KiotVietPurchaseOrderDialogComponent` (`components/edit-product-page/kiotviet-purchase-order-dialog/`). Mục đích: tạo phiếu nhập tự động thay vì gõ tay trên web KiotViet. **Giống hệt bản TapHoa39BanHang.**

**Flow:** Import XML hóa đơn → BE `/v1/parse-xml` → auto-match SP + NCC qua KiotViet autocomplete → review candidate → bảng data → `POST /api/purchaseOrders`.

**Bảng:** STT | Mã hàng | Tên hàng | ĐVT | Số lượng | Đơn giá | Giảm giá | Thành tiền (SL/ĐG/CK sửa được, `Thành tiền = SL × ĐG − CK`).

**Match SP (theo tên + ĐƠN VỊ):** autocomplete KiotViet trả mỗi đơn vị 1 row cùng tên → `pickBestMatch` ưu tiên row khớp ĐVT hóa đơn (tránh nhập nhầm đơn vị gốc, vd "thùng" → "ly"). Auto-nhận khi tên trùng 100% VÀ đúng đơn vị, HOẶC trùng lựa chọn user đã ghi nhớ (localStorage `kvPurchaseOrderMatches`, key = tên+đơn-vị); còn lại mở `PurchaseMatchReviewDialogComponent` (candidate hiện tag đơn vị, cảnh báo khi chọn sai đơn vị, % giống tô màu, ô tìm thủ công, option bỏ qua). Lựa chọn user lưu localStorage → lần import sau tự khôi phục.

**2 nút submit:** "Lưu tạm" (`Complete: false`) / "Hoàn thành" (`Complete: true`) — chỉ khác field `Complete` của payload; disable khi còn dòng chưa khớp SP. Lỗi KiotViet (`ResponseStatus.Message`) hiện banner đỏ, dialog giữ nguyên dữ liệu để gửi lại.

**Cache nháp (localStorage `kvPurchaseOrderDraft`):** state sau import (lines + SP + NCC + số HĐ) lưu tự động → đóng/mở lại dialog tự khôi phục (badge "Khôi phục từ lần trước"), không cần import lại. Nút "Nhập mới" xóa nháp; tạo phiếu thành công tự xóa. Fetch KiotViet có retry lỗi mạng (3 lần, backoff) + chặn import chồng nhau.

**Services:** `KiotVietPurchaseOrderService` (`services/kiotviet-purchase-order.service.ts`) + 3 method mới trong `KiotvietService`: `autocompletePurchaseProducts()`, `autocompleteSuppliers()`, `createPurchaseOrder()`.
