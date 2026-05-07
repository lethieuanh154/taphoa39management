# TapHoa39Management

HR & order management. Angular 20, Material 20, Firebase Auth (Google Sign-In).

## Routes
`/login` | `/orders` (default) | `/employees` | `/work-schedule` | `/attendance` | `/payroll` | `/promotions`

## Critical Rules
- Auth: Google Sign-In → email whitelist → Flask token → KiotViet token. Auto-refresh 2 min.
- IndexedDB-first: load cache → sync API background
- Real-time orders: Firestore onSnapshot (`orderNotifications`, project `taphoa39khachhang`)
- Payroll: `thucTra = (donGiaGio × tongGioLam + thuong + phuCap) × 0.9`
- Promotion: gift (type 6 KV), percentage (type 5 KV), fixed_amount

## Firebase Projects
`quanlysongminh` (Auth + data) | `taphoa39khachhang` (order notifications)

## IndexedDB
EmployeeDB v6: employees, attendance, work_schedules, payroll, deleted_payrolls | OrderDB v3: order

## Docs
`docs/MANAGEMENT.md`
