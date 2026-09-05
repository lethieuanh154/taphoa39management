/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CUSTOMER CATALOG SERVICE - DANH MỤC KHÁCH HÀNG (kế toán)
 * Đổi tên khỏi CustomerService để tránh trùng với services/customer.service.ts (KiotViet)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of, map, delay } from 'rxjs';
import {
  Customer,
  CustomerType,
  CustomerGroup,
  CustomerStatus,
  CustomerFilter,
  CustomerDebtSummary,
  generateCustomerCode,
  validateCustomer
} from '../models/customer.models';

@Injectable({
  providedIn: 'root'
})
export class CustomerCatalogService {

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════════════

  private customersSubject = new BehaviorSubject<Customer[]>([]);
  public customers$ = this.customersSubject.asObservable();

  private loadingSubject = new BehaviorSubject<boolean>(false);
  public loading$ = this.loadingSubject.asObservable();

  constructor() {
    this.loadDemoData();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DEMO DATA
  // ═══════════════════════════════════════════════════════════════════════════

  private loadDemoData(): void {
    const demoCustomers: Customer[] = [
      {
        id: 'CUS-001',
        code: 'KH0001',
        name: 'Công ty TNHH ABC',
        shortName: 'ABC',
        customerType: 'COMPANY',
        customerGroup: 'WHOLESALE',
        taxCode: '0123456789',
        legalRepresentative: 'Nguyễn Văn A',
        address: '123 Nguyễn Văn Linh',
        district: 'Quận 7',
        province: 'TP. Hồ Chí Minh',
        phone: '028-1234-5678',
        email: 'contact@abc.com.vn',
        website: 'www.abc.com.vn',
        contacts: [
          { name: 'Trần Thị B', position: 'Kế toán trưởng', phone: '0901234567', email: 'b.tran@abc.com.vn' }
        ],
        bankAccounts: [
          { bankName: 'Vietcombank', accountNumber: '0071001234567', accountHolder: 'CONG TY TNHH ABC', branch: 'CN Quận 7' }
        ],
        paymentTermDays: 30,
        creditLimit: 500000000,
        accountCode: '131',
        status: 'ACTIVE',
        note: 'Khách hàng lớn, thanh toán đúng hạn',
        createdAt: new Date('2024-01-01'),
        createdBy: 'admin',
        updatedAt: new Date('2024-06-15')
      },
      {
        id: 'CUS-002',
        code: 'KH0002',
        name: 'Siêu thị Big C',
        shortName: 'Big C',
        customerType: 'COMPANY',
        customerGroup: 'WHOLESALE',
        taxCode: '0312345678',
        address: '456 Lê Văn Việt',
        district: 'Quận 9',
        province: 'TP. Hồ Chí Minh',
        phone: '028-9876-5432',
        email: 'mua@bigc.vn',
        contacts: [
          { name: 'Lê Văn C', position: 'Trưởng phòng mua hàng', phone: '0912345678' }
        ],
        bankAccounts: [],
        paymentTermDays: 45,
        creditLimit: 1000000000,
        accountCode: '131',
        status: 'ACTIVE',
        createdAt: new Date('2024-02-01'),
        createdBy: 'admin',
        updatedAt: new Date('2024-02-01')
      },
      {
        id: 'CUS-003',
        code: 'KH0003',
        name: 'Cửa hàng Bách Hóa Xanh',
        shortName: 'BHX',
        customerType: 'COMPANY',
        customerGroup: 'AGENCY',
        taxCode: '0398765432',
        address: '789 Võ Văn Ngân',
        district: 'Thủ Đức',
        province: 'TP. Hồ Chí Minh',
        phone: '028-5555-6666',
        contacts: [],
        bankAccounts: [],
        paymentTermDays: 15,
        creditLimit: 200000000,
        accountCode: '131',
        status: 'ACTIVE',
        createdAt: new Date('2024-03-01'),
        createdBy: 'admin',
        updatedAt: new Date('2024-03-01')
      },
      {
        id: 'CUS-004',
        code: 'KH0004',
        name: 'Nguyễn Văn Minh',
        customerType: 'INDIVIDUAL',
        customerGroup: 'RETAIL',
        address: '100 Nguyễn Thị Minh Khai',
        district: 'Quận 1',
        province: 'TP. Hồ Chí Minh',
        phone: '0909123456',
        contacts: [],
        bankAccounts: [],
        paymentTermDays: 0,
        accountCode: '131',
        status: 'ACTIVE',
        createdAt: new Date('2024-04-01'),
        createdBy: 'admin',
        updatedAt: new Date('2024-04-01')
      },
      {
        id: 'CUS-005',
        code: 'KH0005',
        name: 'Công ty CP XYZ',
        shortName: 'XYZ',
        customerType: 'COMPANY',
        customerGroup: 'WHOLESALE',
        taxCode: '0301111222',
        address: '200 Điện Biên Phủ',
        district: 'Quận Bình Thạnh',
        province: 'TP. Hồ Chí Minh',
        phone: '028-7777-8888',
        email: 'info@xyz.com.vn',
        contacts: [],
        bankAccounts: [],
        paymentTermDays: 30,
        creditLimit: 300000000,
        accountCode: '131',
        status: 'INACTIVE',
        note: 'Tạm ngừng hợp tác',
        createdAt: new Date('2024-01-15'),
        createdBy: 'admin',
        updatedAt: new Date('2024-12-01')
      }
    ];

    this.customersSubject.next(demoCustomers);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CRUD OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Lấy danh sách khách hàng
   */
  getCustomers(filter?: CustomerFilter): Observable<Customer[]> {
    return this.customers$.pipe(
      map(customers => {
        if (!filter) return customers;

        return customers.filter(c => {
          // Search
          if (filter.search) {
            const keyword = filter.search.toLowerCase();
            const searchFields = [c.code, c.name, c.shortName || '', c.taxCode || '', c.phone || ''].join(' ').toLowerCase();
            if (!searchFields.includes(keyword)) return false;
          }

          // Filter by type
          if (filter.customerType && c.customerType !== filter.customerType) return false;

          // Filter by group
          if (filter.customerGroup && c.customerGroup !== filter.customerGroup) return false;

          // Filter by status
          if (filter.status && c.status !== filter.status) return false;

          return true;
        });
      })
    );
  }

  /**
   * Lấy khách hàng theo ID
   */
  getCustomerById(id: string): Observable<Customer | undefined> {
    return this.customers$.pipe(
      map(customers => customers.find(c => c.id === id))
    );
  }

  /**
   * Lấy khách hàng theo mã
   */
  getCustomerByCode(code: string): Observable<Customer | undefined> {
    return this.customers$.pipe(
      map(customers => customers.find(c => c.code === code))
    );
  }

  /**
   * Tạo khách hàng mới
   */
  createCustomer(customer: Partial<Customer>): Observable<Customer> {
    const errors = validateCustomer(customer);
    if (errors.length > 0) {
      throw new Error(errors.join(', '));
    }

    const customers = this.customersSubject.value;

    // Check duplicate code
    if (customers.some(c => c.code === customer.code)) {
      throw new Error('Mã khách hàng đã tồn tại');
    }

    const now = new Date();
    const newCustomer: Customer = {
      id: `CUS-${String(customers.length + 1).padStart(3, '0')}`,
      code: customer.code!,
      name: customer.name!,
      shortName: customer.shortName,
      customerType: customer.customerType || 'COMPANY',
      customerGroup: customer.customerGroup || 'RETAIL',
      taxCode: customer.taxCode,
      businessLicense: customer.businessLicense,
      legalRepresentative: customer.legalRepresentative,
      address: customer.address!,
      ward: customer.ward,
      district: customer.district,
      province: customer.province,
      country: customer.country,
      phone: customer.phone,
      fax: customer.fax,
      email: customer.email,
      website: customer.website,
      contacts: customer.contacts || [],
      bankAccounts: customer.bankAccounts || [],
      paymentTermDays: customer.paymentTermDays || 0,
      creditLimit: customer.creditLimit,
      accountCode: customer.accountCode || '131',
      status: customer.status || 'ACTIVE',
      note: customer.note,
      createdAt: now,
      createdBy: 'admin',
      updatedAt: now
    };

    this.customersSubject.next([...customers, newCustomer]);
    return of(newCustomer).pipe(delay(300));
  }

  /**
   * Cập nhật khách hàng
   */
  updateCustomer(id: string, updates: Partial<Customer>): Observable<Customer> {
    const customers = this.customersSubject.value;
    const index = customers.findIndex(c => c.id === id);

    if (index === -1) {
      throw new Error('Không tìm thấy khách hàng');
    }

    // Check duplicate code if changing
    if (updates.code && updates.code !== customers[index].code) {
      if (customers.some(c => c.code === updates.code && c.id !== id)) {
        throw new Error('Mã khách hàng đã tồn tại');
      }
    }

    const updatedCustomer: Customer = {
      ...customers[index],
      ...updates,
      updatedAt: new Date(),
      updatedBy: 'admin'
    };

    customers[index] = updatedCustomer;
    this.customersSubject.next([...customers]);

    return of(updatedCustomer).pipe(delay(300));
  }

  /**
   * Xóa khách hàng
   */
  deleteCustomer(id: string): Observable<boolean> {
    const customers = this.customersSubject.value;
    const customer = customers.find(c => c.id === id);

    if (!customer) {
      throw new Error('Không tìm thấy khách hàng');
    }

    // TODO: Check if customer has transactions
    this.customersSubject.next(customers.filter(c => c.id !== id));
    return of(true).pipe(delay(300));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Lấy mã khách hàng tiếp theo
   */
  getNextCustomerCode(): Observable<string> {
    return this.customers$.pipe(
      map(customers => {
        const maxNum = customers.reduce((max, c) => {
          const num = parseInt(c.code.replace('KH', ''), 10);
          return num > max ? num : max;
        }, 0);
        return generateCustomerCode(maxNum + 1);
      })
    );
  }

  /**
   * Lấy danh sách khách hàng cho dropdown
   */
  getCustomerDropdown(): Observable<{ id: string; code: string; name: string }[]> {
    return this.customers$.pipe(
      map(customers =>
        customers
          .filter(c => c.status === 'ACTIVE')
          .map(c => ({ id: c.id, code: c.code, name: c.name }))
      )
    );
  }

  /**
   * Đếm số lượng theo nhóm
   */
  getCountByGroup(): Observable<Record<CustomerGroup, number>> {
    return this.customers$.pipe(
      map(customers => {
        const counts: Record<CustomerGroup, number> = {
          RETAIL: 0,
          WHOLESALE: 0,
          AGENCY: 0,
          VIP: 0,
          OTHER: 0
        };
        customers.forEach(c => {
          if (c.status === 'ACTIVE') {
            counts[c.customerGroup]++;
          }
        });
        return counts;
      })
    );
  }

  /**
   * Tìm kiếm nhanh
   */
  quickSearch(keyword: string): Observable<Customer[]> {
    return this.getCustomers({ search: keyword, status: 'ACTIVE' });
  }
}
