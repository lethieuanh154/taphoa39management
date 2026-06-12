/**
 * Một bản ghi thay đổi của product clone
 */
export type HistoryTag = 'checkout' | 'return' | 'edit' | 'invoice-edit';

export const HISTORY_TAG_LABELS: Record<HistoryTag, string> = {
  'checkout': 'Thanh toán',
  'return': 'Trả hàng',
  'edit': 'Thêm hàng',
  'invoice-edit': 'Sửa hàng'
};

export interface ProductChangeRecord {
  timestamp: string;           // ISO date string
  field: 'Code' | 'Name' | 'BasePrice' | 'Cost' | 'OnHandNV';
  fieldLabel: string;          // Tên hiển thị: "Mã Hàng", "Tên Hàng", etc.
  oldValue: string | number;
  newValue: string | number;
  changedBy?: string;          // Email người thay đổi (optional)
  tag?: HistoryTag;            // Nguồn thay đổi: checkout/return/edit
}

/**
 * Lịch sử thay đổi của một product clone
 */
export interface ProductChangeHistory {
  productId: number;           // ID của product (master)
  productCode: string;         // Code của product
  productName: string;         // Name của product
  records: ProductChangeRecord[];
}

/**
 * Field labels mapping
 */
export const FIELD_LABELS: Record<string, string> = {
  'Code': 'Mã Hàng',
  'Name': 'Tên Hàng',
  'BasePrice': 'Giá Bán',
  'Cost': 'Giá Vốn',
  'OnHandNV': 'Tồn Kho'
};

/**
 * Tracked fields for clone products
 */
export const TRACKED_FIELDS = ['Code', 'Name', 'BasePrice', 'Cost', 'OnHandNV'] as const;
export type TrackedField = typeof TRACKED_FIELDS[number];
