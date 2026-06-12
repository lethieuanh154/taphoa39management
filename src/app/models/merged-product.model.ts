import { CartItem } from './cart-item.model';
import { Customer } from './customer.model';

/**
 * Một item được lưu vào "Các Sản Phẩm Gộp"
 * Mỗi item đại diện cho một invoice KiotViet đã được tách ra khi GỘP=ON
 */
export interface MergedProductItem {
  id: string;                    // Unique ID cho item này
  invoiceId: string;             // ID của invoice gốc mà item này được tách ra
  invoiceName: string;           // Tên invoice gốc (để hiển thị)
  cartItems: CartItem[];         // Các cart items gốc (products KiotViet)
  customer: Customer | null;     // Customer của invoice gốc
  totalPrice: number;            // Tổng tiền của phần KiotViet
  discountAmount: number;        // Discount đã được phân bổ
  createdDate: string;           // Thời gian tạo
  note: string;                  // Ghi chú
  isBankTransfer?: boolean;      // true nếu thanh toán chuyển khoản
  isAutoMerge?: boolean;         // true nếu tạo bởi Auto Gộp CK
}

/**
 * State cho việc chọn items trong dialog
 */
export interface MergedProductSelection {
  itemId: string;
  cartItemIndex: number;
  selected: boolean;
}
