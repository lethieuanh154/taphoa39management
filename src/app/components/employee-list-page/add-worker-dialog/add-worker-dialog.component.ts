import { Component, Inject, Optional, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { EmployeeService, Employee } from '../../../services/employee.service';

interface Worker {
  maNhanVien: string;
  hoTen: string;
  ngaySinh: Date | null;
  gioiTinh: string;
  soCCCD: string;
  phongBan: string;
  chucDanh: string;
  ngayBatDau: Date | null;
  soDienThoai: string;
  email: string;
  diaChi: string;
  hinhAnh: string;
}

@Component({
  selector: 'app-add-worker-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatButtonModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './add-worker-dialog.component.html',
  styleUrl: './add-worker-dialog.component.css',
})
export class AddWorkerDialogComponent implements OnInit {
  worker: Worker = {
    maNhanVien: '',
    hoTen: '',
    ngaySinh: null,
    gioiTinh: '',
    soCCCD: '',
    phongBan: '',
    chucDanh: '',
    ngayBatDau: null,
    soDienThoai: '',
    email: '',
    diaChi: '',
    hinhAnh: ''
  };

  genderOptions = ['Nam', 'Nữ', 'Khác'];
  departments = ['Bán hàng', 'Kho', 'Kế toán', 'Quản lý'];
  positions = ['Nhân viên', 'Trưởng phòng', 'Phó phòng', 'Giám đốc'];

  selectedFile: File | null = null;
  imagePreview: string | null = null;
  isEditMode: boolean = false;
  isLoading: boolean = false;
  originalMaNhanVien: string = '';

  constructor(
    @Optional() public dialogRef: MatDialogRef<AddWorkerDialogComponent>,
    @Optional() @Inject(MAT_DIALOG_DATA) public data: { employee?: Employee, mode?: 'add' | 'edit' },
    private employeeService: EmployeeService
  ) {}

  ngOnInit() {
    // Check if we're in edit mode
    if (this.data && this.data.employee) {
      this.isEditMode = this.data.mode === 'edit';
      this.originalMaNhanVien = this.data.employee.maNhanVien;

      // Populate form with existing employee data
      this.worker = {
        maNhanVien: this.data.employee.maNhanVien || '',
        hoTen: this.data.employee.hoTen || '',
        ngaySinh: this.data.employee.ngaySinh ? new Date(this.data.employee.ngaySinh) : null,
        gioiTinh: this.data.employee.gioiTinh || '',
        soCCCD: this.data.employee.soCCCD || '',
        phongBan: this.data.employee.phongBan || '',
        chucDanh: this.data.employee.chucDanh || '',
        ngayBatDau: this.data.employee.ngayBatDau ? new Date(this.data.employee.ngayBatDau) : null,
        soDienThoai: this.data.employee.soDienThoai || '',
        email: this.data.employee.email || '',
        diaChi: this.data.employee.diaChi || '',
        hinhAnh: this.data.employee.hinhAnh || ''
      };

      // Set image preview if available
      if (this.worker.hinhAnh) {
        this.imagePreview = this.worker.hinhAnh;
      }
    }
  }

  get dialogTitle(): string {
    return this.isEditMode ? 'Sửa Thông Tin Nhân Viên' : 'Thêm Nhân Viên';
  }

  get submitButtonText(): string {
    return this.isEditMode ? 'Cập nhật' : 'Thêm';
  }

  onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      this.selectedFile = file;

      // Preview image
      const reader = new FileReader();
      reader.onload = (e: any) => {
        this.imagePreview = e.target.result;
        this.worker.hinhAnh = e.target.result;
      };
      reader.readAsDataURL(file);
    }
  }

  onCancel() {
    if (this.dialogRef) {
      this.dialogRef.close();
    }
  }

  onSubmit() {
    // Validate required fields
    if (!this.worker.maNhanVien || !this.worker.hoTen) {
      alert('Vui lòng điền đầy đủ thông tin bắt buộc!');
      return;
    }

    // If file is selected, handle upload
    if (this.selectedFile && this.imagePreview) {
      this.worker.hinhAnh = this.imagePreview;
    }

    this.isLoading = true;

    if (this.isEditMode) {
      // Update existing employee
      this.updateEmployee();
    } else {
      // Add new employee
      this.addEmployee();
    }
  }

  private addEmployee() {
    const employeeData: Employee = {
      maNhanVien: this.worker.maNhanVien,
      hoTen: this.worker.hoTen,
      ngaySinh: this.worker.ngaySinh ? this.worker.ngaySinh.toISOString() : null,
      gioiTinh: this.worker.gioiTinh,
      soCCCD: this.worker.soCCCD,
      phongBan: this.worker.phongBan,
      chucDanh: this.worker.chucDanh,
      ngayBatDau: this.worker.ngayBatDau ? this.worker.ngayBatDau.toISOString() : null,
      soDienThoai: this.worker.soDienThoai,
      email: this.worker.email,
      diaChi: this.worker.diaChi,
      hinhAnh: this.worker.hinhAnh
    };

    this.employeeService.addEmployee(employeeData).subscribe({
      next: (response) => {
        this.isLoading = false;
        if (response.success) {
          alert('Thêm nhân viên thành công!');
          if (this.dialogRef) {
            this.dialogRef.close({ success: true, employee: response.data });
          }
        } else {
          alert(`Lỗi: ${response.message}`);
        }
      },
      error: (error) => {
        this.isLoading = false;
        console.error('Error adding employee:', error);
        alert(`Có lỗi khi thêm nhân viên: ${error.error?.message || error.message}`);
      }
    });
  }

  private updateEmployee() {
    const updates: Partial<Employee> = {
      hoTen: this.worker.hoTen,
      ngaySinh: this.worker.ngaySinh ? this.worker.ngaySinh.toISOString() : null,
      gioiTinh: this.worker.gioiTinh,
      soCCCD: this.worker.soCCCD,
      phongBan: this.worker.phongBan,
      chucDanh: this.worker.chucDanh,
      ngayBatDau: this.worker.ngayBatDau ? this.worker.ngayBatDau.toISOString() : null,
      soDienThoai: this.worker.soDienThoai,
      email: this.worker.email,
      diaChi: this.worker.diaChi,
      hinhAnh: this.worker.hinhAnh
    };

    // Remove empty or null values
    Object.keys(updates).forEach(key => {
      const value = updates[key as keyof typeof updates];
      if (value === null || value === undefined || value === '') {
        delete updates[key as keyof typeof updates];
      }
    });

    this.employeeService.updateEmployee(this.originalMaNhanVien, updates).subscribe({
      next: (response) => {
        this.isLoading = false;
        if (response.success) {
          alert('Cập nhật thông tin nhân viên thành công!');
          if (this.dialogRef) {
            this.dialogRef.close({ success: true, employee: { ...this.worker, maNhanVien: this.originalMaNhanVien } });
          }
        } else {
          alert(`Lỗi: ${response.message}`);
        }
      },
      error: (error) => {
        this.isLoading = false;
        console.error('Error updating employee:', error);
        alert(`Có lỗi khi cập nhật nhân viên: ${error.error?.message || error.message}`);
      }
    });
  }

  triggerFileInput() {
    const fileInput = document.getElementById('fileInput') as HTMLInputElement;
    if (fileInput) {
      fileInput.click();
    }
  }
}
