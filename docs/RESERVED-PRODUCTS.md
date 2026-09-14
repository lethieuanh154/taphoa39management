# Hàng đang giữ cho đơn đặt (ReservedProductsPage)

Trang tổng hợp các mặt hàng đang bị đơn đặt online (DatHang) giữ chỗ. Có mặt ở **cả TapHoa39BanHang và TapHoa39Management** — code giống hệt nhau, thuộc vùng mirror.

## Truy cập

| App | Đường vào | Route |
|---|---|---|
| BanHang | Menu → **Hàng đang giữ** (cạnh "Đặt hàng") | `/reserved-products` |
| Management | Sidebar → **Hàng đang giữ** (dưới "Đơn hàng") | `/reserved-products` (có `authGuard`) |

## Nội dung trang

- Ba số tổng: số mặt hàng, số đơn vị đang giữ, số đơn đặt.
- Danh sách gom **theo sản phẩm**, bấm vào để xem các đơn đang giữ nó (mã đơn, khách, SĐT, số lượng, giờ đặt, còn bao lâu hết hạn).
- Tìm kiếm theo tên hàng, mã hàng, tên khách, SĐT hoặc mã đơn.
- Nút **Dọn đơn quá hạn** — gọi `POST /api/reservations/expire-overdue`, giải phóng hàng của đơn đã quá 24h và chuyển đơn sang `expired`.

Dòng có đơn sắp hết hạn (còn dưới 2h) hoặc đã hết hạn được tô màu để nhân viên ưu tiên xử lý.

## Nhả hàng — bốn điểm, đừng sót

`ReservationService.release(orderId, reason)` phải được gọi khi:

| Thời điểm | Nơi gọi | Lý do |
|---|---|---|
| Đơn thành hóa đơn | `main-page.component.ts` sau `updateOrderStatusToChecked()` | **Bắt buộc.** Hóa đơn trừ `OnHand` thật; bản giữ hàng còn sống thì tồn bị trừ **hai lần** |
| Hủy đơn (BanHang) | `order-page.component.ts` | Trả hàng về cho khách khác đặt |
| Hủy đơn (Management) | `order-page.component.ts` | Cùng lý do — đã làm ở cả hai app |
| Quá 24h | Scheduler backend, mỗi giờ | Không cần FE làm gì |

## Nguyên tắc nền

Số giữ hàng **không** nằm ở `OnHand`. `OnHand` bị `sync_products_from_kiotviet()` ghi đè mỗi lần full reload buổi sáng, nên trừ thẳng vào đó là mất trắng. Chi tiết: `TapHoa39BackEnd/docs/RESERVATION.md`.

Hệ quả: không có thao tác "restore OnHand". Nhả hàng chỉ là đổi `status` của bản ghi, không cộng trừ tồn kho.

## Mirror

| File | Trạng thái |
|---|---|
| `services/reservation.service.ts` | **Giống hệt byte-for-byte** — sửa một bên phải copy sang bên kia |
| `components/reserved-products-page/*` | **Giống hệt byte-for-byte** (cả .ts/.html/.css) |
| `app.routes.ts` | Khác có chủ đích: Management có `canActivate: [authGuard]`, BanHang không |
| Đường vào | Khác có chủ đích: BanHang qua menu-bar, Management qua sidebar |

## Bảo mật

`/api/reservations/*` nằm sau admin-auth gate (`X-Id-Token`), không thuộc `_SKIP_PREFIXES`. Cả hai app đã có interceptor tự gắn header nên service không cần xử lý gì thêm.
