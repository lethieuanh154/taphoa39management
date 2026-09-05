# TapHoa39Management

HR & order management. Angular 20, Material 20, Firebase Auth (Google Sign-In).

## Routes
`/login` | `/orders` (default) | `/employees` | `/work-schedule` | `/attendance` | `/payroll` | `/promotions` | `/customers`

## Critical Rules
- **CODE MIRROR:** `components/edit-product-page/**` (51/58 file) + `services/*.ts` (23/37 file) là bản copy y hệt của TapHoa39BanHang. Sửa ở đây → PHẢI kiểm tra file cùng đường dẫn bên BanHang, sửa luôn hoặc nói rõ lý do bỏ qua, rồi build cả 2 app. Xem mục MIRRORED CODE trong CLAUDE.md gốc.
- Auth: Google Sign-In → email whitelist → Flask token → KiotViet token. Auto-refresh 2 min.
- IndexedDB-first: load cache → sync API background
- Real-time orders: Firestore onSnapshot (`orderNotifications`, project `taphoa39khachhang`)
- Payroll: `thucTra = (donGiaGio × tongGioLam + thuong + phuCap) × 0.9`
- Promotion: gift (type 6 KV), percentage (type 5 KV), fixed_amount
- **2 kiểu Customer khác nhau:** `models/customer.model.ts` (KiotViet, dùng bởi `customer.service.ts`) vs `models/customer.models.ts` (kế toán, dùng bởi `customer-catalog.service.ts` + `/customers`). Đừng lẫn.

## Firebase Projects
`quanlysongminh` (Auth + data) | `taphoa39khachhang` (order notifications)

## IndexedDB
EmployeeDB v6: employees, attendance, work_schedules, payroll, deleted_payrolls | OrderDB v3: order

## Docs
`docs/MANAGEMENT.md`
