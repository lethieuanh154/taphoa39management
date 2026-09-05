/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CUSTOMER PAGE COMPONENT - DANH MỤC KHÁCH HÀNG
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';

import { CustomerCatalogService } from '../../services/customer-catalog.service';
import {
  Customer,
  CustomerType,
  CustomerGroup,
  CustomerStatus,
  CustomerFilter,
  ContactInfo,
  BankAccount,
  CUSTOMER_TYPES,
  CUSTOMER_GROUPS,
  CUSTOMER_STATUS,
  formatFullAddress
} from '../../models/customer.models';

@Component({
  selector: 'app-customer-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './customer-page.component.html',
  styleUrl: './customer-page.component.css'
})
export class CustomerPageComponent implements OnInit, OnDestroy {

  private destroy$ = new Subject<void>();

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════════════

  customers: Customer[] = [];
  filteredCustomers: Customer[] = [];
  loading = false;

  // Filter
  filter: CustomerFilter = {
    search: '',
    status: 'ACTIVE'
  };

  // Selected
  selectedCustomer: Customer | null = null;

  // Modals
  showCreateModal = false;
  showDetailModal = false;
  showDeleteConfirm = false;
  isEditMode = false;

  // Form
  formData: Partial<Customer> = {};
  formContacts: ContactInfo[] = [];
  formBankAccounts: BankAccount[] = [];

  // Reference data
  customerTypes = CUSTOMER_TYPES;
  customerGroups = CUSTOMER_GROUPS;
  customerStatus = CUSTOMER_STATUS;

  // Stats
  stats = {
    total: 0,
    active: 0,
    inactive: 0,
    byGroup: {} as Record<CustomerGroup, number>
  };

  constructor(private customerService: CustomerCatalogService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════════

  ngOnInit(): void {
    this.loadCustomers();
    this.loadStats();

    this.customerService.loading$
      .pipe(takeUntil(this.destroy$))
      .subscribe(loading => this.loading = loading);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DATA LOADING
  // ═══════════════════════════════════════════════════════════════════════════

  loadCustomers(): void {
    this.customerService.getCustomers(this.filter)
      .pipe(takeUntil(this.destroy$))
      .subscribe(customers => {
        this.customers = customers;
        this.filteredCustomers = customers;
      });
  }

  loadStats(): void {
    this.customerService.customers$
      .pipe(takeUntil(this.destroy$))
      .subscribe(customers => {
        this.stats.total = customers.length;
        this.stats.active = customers.filter(c => c.status === 'ACTIVE').length;
        this.stats.inactive = customers.filter(c => c.status === 'INACTIVE').length;
      });

    this.customerService.getCountByGroup()
      .pipe(takeUntil(this.destroy$))
      .subscribe(counts => this.stats.byGroup = counts);
  }

  onFilterChange(): void {
    this.loadCustomers();
  }

  onStatusFilterChange(status: CustomerStatus | ''): void {
    this.filter.status = status || undefined;
    this.loadCustomers();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE / EDIT
  // ═══════════════════════════════════════════════════════════════════════════

  openCreateModal(): void {
    this.isEditMode = false;
    this.customerService.getNextCustomerCode()
      .pipe(takeUntil(this.destroy$))
      .subscribe(code => {
        this.formData = {
          code,
          customerType: 'COMPANY',
          customerGroup: 'RETAIL',
          status: 'ACTIVE',
          paymentTermDays: 0,
          accountCode: '131'
        };
        this.formContacts = [];
        this.formBankAccounts = [];
        this.showCreateModal = true;
      });
  }

  openEditModal(customer: Customer): void {
    this.isEditMode = true;
    this.selectedCustomer = customer;
    this.formData = { ...customer };
    this.formContacts = [...(customer.contacts || [])];
    this.formBankAccounts = [...(customer.bankAccounts || [])];
    this.showCreateModal = true;
  }

  closeCreateModal(): void {
    this.showCreateModal = false;
    this.formData = {};
    this.formContacts = [];
    this.formBankAccounts = [];
    this.selectedCustomer = null;
    this.isEditMode = false;
  }

  // Contact management
  addContact(): void {
    this.formContacts.push({ name: '', position: '', phone: '', email: '' });
  }

  removeContact(index: number): void {
    this.formContacts.splice(index, 1);
  }

  // Bank account management
  addBankAccount(): void {
    this.formBankAccounts.push({ bankName: '', accountNumber: '', accountHolder: '', branch: '' });
  }

  removeBankAccount(index: number): void {
    this.formBankAccounts.splice(index, 1);
  }

  saveCustomer(): void {
    if (!this.validateForm()) return;

    const customerData: Partial<Customer> = {
      ...this.formData,
      contacts: this.formContacts.filter(c => c.name),
      bankAccounts: this.formBankAccounts.filter(b => b.bankName && b.accountNumber)
    };

    if (this.isEditMode && this.selectedCustomer) {
      this.customerService.updateCustomer(this.selectedCustomer.id, customerData)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.closeCreateModal();
            this.loadCustomers();
            this.loadStats();
          },
          error: (err) => alert(err.message)
        });
    } else {
      this.customerService.createCustomer(customerData)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.closeCreateModal();
            this.loadCustomers();
            this.loadStats();
          },
          error: (err) => alert(err.message)
        });
    }
  }

  validateForm(): boolean {
    if (!this.formData.code?.trim()) {
      alert('Vui lòng nhập mã khách hàng');
      return false;
    }
    if (!this.formData.name?.trim()) {
      alert('Vui lòng nhập tên khách hàng');
      return false;
    }
    if (!this.formData.address?.trim()) {
      alert('Vui lòng nhập địa chỉ');
      return false;
    }
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VIEW DETAIL
  // ═══════════════════════════════════════════════════════════════════════════

  viewDetail(customer: Customer): void {
    this.selectedCustomer = customer;
    this.showDetailModal = true;
  }

  closeDetailModal(): void {
    this.showDetailModal = false;
    this.selectedCustomer = null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DELETE
  // ═══════════════════════════════════════════════════════════════════════════

  confirmDelete(customer: Customer): void {
    this.selectedCustomer = customer;
    this.showDeleteConfirm = true;
  }

  deleteCustomer(): void {
    if (!this.selectedCustomer) return;

    this.customerService.deleteCustomer(this.selectedCustomer.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.showDeleteConfirm = false;
          this.selectedCustomer = null;
          this.loadCustomers();
          this.loadStats();
        },
        error: (err) => alert(err.message)
      });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  getCustomerTypeLabel(type: CustomerType): string {
    return CUSTOMER_TYPES.find(t => t.value === type)?.label || type;
  }

  getCustomerGroupLabel(group: CustomerGroup): string {
    return CUSTOMER_GROUPS.find(g => g.value === group)?.label || group;
  }

  getStatusLabel(status: CustomerStatus): string {
    return status === 'ACTIVE' ? 'Hoạt động' : 'Ngừng HĐ';
  }

  getStatusClass(status: CustomerStatus): string {
    return status === 'ACTIVE' ? 'status-active' : 'status-inactive';
  }

  formatCurrency(amount: number | undefined): string {
    if (!amount) return '-';
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
  }

  formatFullAddress(customer: Customer): string {
    return formatFullAddress(customer);
  }
}
