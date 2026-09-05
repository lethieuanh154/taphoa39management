/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * DANH MỤC KHÁCH HÀNG - CUSTOMER MASTER
 * Quản lý thông tin khách hàng cho hóa đơn bán ra, công nợ phải thu (TK 131)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Loại khách hàng
 */
export type CustomerType =
  | 'COMPANY'      // Doanh nghiệp
  | 'INDIVIDUAL'   // Cá nhân
  | 'GOVERNMENT';  // Cơ quan nhà nước

/**
 * Nhóm khách hàng
 */
export type CustomerGroup =
  | 'RETAIL'       // Bán lẻ
  | 'WHOLESALE'    // Bán buôn
  | 'AGENCY'       // Đại lý
  | 'VIP'          // VIP
  | 'OTHER';       // Khác

/**
 * Trạng thái khách hàng
 */
export type CustomerStatus = 'ACTIVE' | 'INACTIVE';

// ═══════════════════════════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Thông tin liên hệ
 */
export interface ContactInfo {
  name: string;
  position?: string;
  phone?: string;
  email?: string;
}

/**
 * Thông tin ngân hàng
 */
export interface BankAccount {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  branch?: string;
}

/**
 * Khách hàng
 */
export interface Customer {
  id: string;
  code: string;                    // Mã KH: KH001
  name: string;                    // Tên khách hàng
  shortName?: string;              // Tên viết tắt
  customerType: CustomerType;
  customerGroup: CustomerGroup;

  // Thông tin pháp lý
  taxCode?: string;                // Mã số thuế
  businessLicense?: string;        // Số ĐKKD
  legalRepresentative?: string;    // Người đại diện pháp luật

  // Địa chỉ
  address: string;
  ward?: string;                   // Phường/Xã
  district?: string;               // Quận/Huyện
  province?: string;               // Tỉnh/Thành phố
  country?: string;                // Quốc gia

  // Liên hệ
  phone?: string;
  fax?: string;
  email?: string;
  website?: string;
  contacts: ContactInfo[];         // Danh sách người liên hệ

  // Ngân hàng
  bankAccounts: BankAccount[];

  // Điều khoản thanh toán
  paymentTermDays: number;         // Số ngày được nợ (mặc định 0)
  creditLimit?: number;            // Hạn mức công nợ

  // Kế toán
  accountCode: string;             // TK công nợ (mặc định 131)

  // Trạng thái
  status: CustomerStatus;

  // Ghi chú
  note?: string;

  // Audit
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy?: string;
}

/**
 * Filter tìm kiếm khách hàng
 */
export interface CustomerFilter {
  search?: string;                 // Tìm theo mã, tên, MST
  customerType?: CustomerType;
  customerGroup?: CustomerGroup;
  status?: CustomerStatus;
  hasDebt?: boolean;               // Có công nợ
}

/**
 * Tổng hợp công nợ khách hàng
 */
export interface CustomerDebtSummary {
  customerId: string;
  customerCode: string;
  customerName: string;
  openingDebit: number;            // Dư nợ đầu kỳ
  openingCredit: number;           // Dư có đầu kỳ
  periodDebit: number;             // Phát sinh nợ trong kỳ
  periodCredit: number;            // Phát sinh có trong kỳ
  closingDebit: number;            // Dư nợ cuối kỳ
  closingCredit: number;           // Dư có cuối kỳ
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

export const CUSTOMER_TYPES: { value: CustomerType; label: string }[] = [
  { value: 'COMPANY', label: 'Doanh nghiệp' },
  { value: 'INDIVIDUAL', label: 'Cá nhân' },
  { value: 'GOVERNMENT', label: 'Cơ quan nhà nước' }
];

export const CUSTOMER_GROUPS: { value: CustomerGroup; label: string }[] = [
  { value: 'RETAIL', label: 'Bán lẻ' },
  { value: 'WHOLESALE', label: 'Bán buôn' },
  { value: 'AGENCY', label: 'Đại lý' },
  { value: 'VIP', label: 'VIP' },
  { value: 'OTHER', label: 'Khác' }
];

export const CUSTOMER_STATUS: { value: CustomerStatus; label: string }[] = [
  { value: 'ACTIVE', label: 'Đang hoạt động' },
  { value: 'INACTIVE', label: 'Ngừng hoạt động' }
];

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Tạo mã khách hàng tự động
 */
export function generateCustomerCode(sequence: number): string {
  return `KH${String(sequence).padStart(4, '0')}`;
}

/**
 * Validate thông tin khách hàng
 */
export function validateCustomer(customer: Partial<Customer>): string[] {
  const errors: string[] = [];

  if (!customer.code?.trim()) {
    errors.push('Mã khách hàng là bắt buộc');
  }

  if (!customer.name?.trim()) {
    errors.push('Tên khách hàng là bắt buộc');
  }

  if (!customer.address?.trim()) {
    errors.push('Địa chỉ là bắt buộc');
  }

  if (customer.taxCode && !isValidTaxCode(customer.taxCode)) {
    errors.push('Mã số thuế không hợp lệ');
  }

  if (customer.email && !isValidEmail(customer.email)) {
    errors.push('Email không hợp lệ');
  }

  if (customer.creditLimit !== undefined && customer.creditLimit < 0) {
    errors.push('Hạn mức công nợ không được âm');
  }

  return errors;
}

/**
 * Kiểm tra MST hợp lệ (10 hoặc 13 số)
 */
export function isValidTaxCode(taxCode: string): boolean {
  if (!taxCode) return true;
  const cleaned = taxCode.replace(/[-\s]/g, '');
  return /^[0-9]{10}$/.test(cleaned) || /^[0-9]{13}$/.test(cleaned);
}

/**
 * Kiểm tra email hợp lệ
 */
export function isValidEmail(email: string): boolean {
  if (!email) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Format địa chỉ đầy đủ
 */
export function formatFullAddress(customer: Customer): string {
  const parts = [customer.address];
  if (customer.ward) parts.push(customer.ward);
  if (customer.district) parts.push(customer.district);
  if (customer.province) parts.push(customer.province);
  return parts.filter(p => p).join(', ');
}

/**
 * Tạo khách hàng mới với giá trị mặc định
 */
export function createDefaultCustomer(sequence: number): Partial<Customer> {
  return {
    code: generateCustomerCode(sequence),
    customerType: 'COMPANY',
    customerGroup: 'RETAIL',
    status: 'ACTIVE',
    paymentTermDays: 0,
    accountCode: '131',
    contacts: [],
    bankAccounts: []
  };
}
