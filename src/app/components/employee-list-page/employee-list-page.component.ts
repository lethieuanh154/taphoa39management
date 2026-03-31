import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { Subscription } from 'rxjs';
import { AddWorkerDialogComponent } from '../employee-list-page/add-worker-dialog/add-worker-dialog.component';
import { EmployeeService, Employee } from '../../services/employee.service';

@Component({
  selector: 'app-employee-list-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatDialogModule,
    MatCheckboxModule
  ],
  templateUrl: './employee-list-page.component.html',
  styleUrl: './employee-list-page.component.css',
})
export class EmployeeListPageComponent implements OnInit, OnDestroy {
  searchText: string = '';
  employees: Employee[] = [];
  editingEmployeeId: string | null = null;
  editingEmployee: Employee | null = null;
  isLoading: boolean = false;

  private employeesSubscription?: Subscription;

  constructor(
    private dialog: MatDialog,
    private employeeService: EmployeeService
  ) {}

  ngOnInit() {
    this.loadEmployees();
  }

  ngOnDestroy() {
    this.employeesSubscription?.unsubscribe();
  }

  loadEmployees() {
    this.isLoading = true;

    // Subscribe to employees$ observable to get updates
    this.employeesSubscription = this.employeeService.employees$.subscribe({
      next: (employees) => {
        this.employees = employees;
        this.isLoading = false;
        console.log(`📋 Employee list updated: ${employees.length} employees`);
      },
      error: (error) => {
        console.error('❌ Error loading employees:', error);
        this.isLoading = false;
      }
    });

    // Trigger load from IndexedDB first, then sync with API
    this.employeeService.loadEmployeesWithSync();
  }

  get filteredEmployees(): Employee[] {
    let filtered = this.employees;

    if (this.searchText) {
      const search = this.searchText.toLowerCase();
      filtered = filtered.filter(emp =>
        emp.maNhanVien.toLowerCase().includes(search) ||
        emp.hoTen.toLowerCase().includes(search) ||
        (emp.soDienThoai?.includes(search) || false) ||
        (emp.email?.toLowerCase().includes(search) || false)
      );
    }

    // Sort: active employees first, then inactive ones
    return filtered.sort((a, b) => {
      if (a.ngayKetThuc && !b.ngayKetThuc) return 1;
      if (!a.ngayKetThuc && b.ngayKetThuc) return -1;
      return 0;
    });
  }

  formatDate(date: Date | string | null | undefined): string {
    if (!date) return '';
    const d = new Date(date);
    const day = d.getDate();
    const month = d.getMonth() + 1;
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }

  openAddEmployeeDialog() {
    const dialogRef = this.dialog.open(AddWorkerDialogComponent, {
      width: '800px',
      maxWidth: '90vw',
      disableClose: true,
      panelClass: 'custom-dialog-container'
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        // The dialog should call employeeService.addEmployee()
        // which will update the BehaviorSubject and trigger our subscription
        console.log('Dialog closed with result:', result);
      }
    });
  }

  editEmployee(employee: Employee) {
    this.editingEmployeeId = employee.id || employee.maNhanVien;
    this.editingEmployee = { ...employee };
  }

  saveEmployee(employee: Employee) {
    if (this.editingEmployee) {
      const employeeId = employee.id || employee.maNhanVien;
      this.employeeService.updateEmployee(employeeId, this.editingEmployee).subscribe({
        next: (response) => {
          console.log('✅ Employee updated:', response);
        },
        error: (error) => {
          console.error('❌ Error updating employee:', error);
          // Fallback: update locally
          const index = this.employees.findIndex(e => (e.id || e.maNhanVien) === employeeId);
          if (index !== -1) {
            this.employees[index] = { ...this.editingEmployee! };
          }
        }
      });
    }
    this.cancelEdit();
  }

  cancelEdit() {
    this.editingEmployeeId = null;
    this.editingEmployee = null;
  }

  isEditing(employee: Employee): boolean {
    const employeeId = employee.id || employee.maNhanVien;
    return this.editingEmployeeId === employeeId;
  }

  updateStartDate(dateString: string) {
    if (this.editingEmployee && dateString) {
      // Parse DD/MM/YYYY format
      const parts = dateString.split('/');
      if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
        const year = parseInt(parts[2], 10);
        this.editingEmployee.ngayBatDau = new Date(year, month, day);
      }
    } else if (this.editingEmployee) {
      this.editingEmployee.ngayBatDau = null;
    }
  }

  updateEndDate(dateString: string) {
    if (this.editingEmployee && dateString) {
      // Parse DD/MM/YYYY format
      const parts = dateString.split('/');
      if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
        const year = parseInt(parts[2], 10);
        this.editingEmployee.ngayKetThuc = new Date(year, month, day);
      }
    } else if (this.editingEmployee) {
      this.editingEmployee.ngayKetThuc = null;
    }
  }

  getDateInputValue(date: Date | string | null | undefined): string {
    if (!date) return '';
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }

  stopWorking(employee: Employee) {
    const confirmed = confirm(`Bạn có chắc chắn muốn đánh dấu nhân viên "${employee.hoTen}" ngừng làm việc?`);
    if (confirmed) {
      const employeeId = employee.id || employee.maNhanVien;
      const updates = { ngayKetThuc: new Date() };

      this.employeeService.updateEmployee(employeeId, updates).subscribe({
        next: () => {
          console.log('✅ Employee marked as stopped working');
        },
        error: (error) => {
          console.error('❌ Error updating employee:', error);
          // Fallback: update locally
          const index = this.employees.findIndex(e => (e.id || e.maNhanVien) === employeeId);
          if (index !== -1) {
            this.employees[index].ngayKetThuc = new Date();
          }
        }
      });
    }
  }

  shouldHighlight(text: string | undefined): boolean {
    if (!text || !this.searchText || this.searchText.trim() === '') {
      return false;
    }
    return text.toLowerCase().includes(this.searchText.toLowerCase());
  }

  refreshEmployees() {
    this.isLoading = true;
    this.employeeService.getAllEmployees().subscribe({
      next: () => {
        this.isLoading = false;
        console.log('✅ Employees refreshed from API');
      },
      error: (error) => {
        this.isLoading = false;
        console.error('❌ Error refreshing employees:', error);
      }
    });
  }

  deleteEmployee(employee: Employee) {
    const confirmed = confirm(`Bạn có chắc chắn muốn xóa nhân viên "${employee.hoTen}"? Hành động này không thể hoàn tác.`);
    if (confirmed) {
      const employeeId = employee.id || employee.maNhanVien;
      this.employeeService.deleteEmployee(employeeId).subscribe({
        next: (response) => {
          console.log('✅ Employee deleted:', response);
        },
        error: (error) => {
          console.error('❌ Error deleting employee:', error);
          alert('Lỗi khi xóa nhân viên. Vui lòng thử lại.');
        }
      });
    }
  }

  toggleNhanVienKhoan(employee: Employee) {
    const employeeId = employee.id || employee.maNhanVien;
    const newValue = !employee.nhanVienKhoan;

    this.employeeService.updateEmployee(employeeId, { nhanVienKhoan: newValue }).subscribe({
      next: () => {
        console.log(`✅ Employee "${employee.hoTen}" nhanVienKhoan updated to: ${newValue}`);
        // Update local state immediately for better UX
        employee.nhanVienKhoan = newValue;
      },
      error: (error) => {
        console.error('❌ Error updating nhanVienKhoan:', error);
        alert('Lỗi khi cập nhật trạng thái nhân viên khoán.');
      }
    });
  }
}
