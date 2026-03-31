import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { EmployeeService, Employee, AttendanceRecord as ServiceAttendanceRecord, ScheduleCell } from '../../services/employee.service';

interface AttendanceRecord {
  id: string;
  date: Date;
  dateString: string;
  workerId: string;
  workerName: string;
  startTime: string;
  endTime: string;
  totalHours: number;
  notes: string;
  isSaved: boolean;
  isNew: boolean;
  isDirty: boolean; // Track if record has been modified
  hasError: boolean; // Track if record has validation error
}

@Component({
  selector: 'app-attendance-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatButtonModule,
    MatSelectModule,
    MatSnackBarModule
  ],
  templateUrl: './attendance-page.component.html',
  styleUrl: './attendance-page.component.css',
})
export class AttendancePageComponent implements OnInit {
  startDate: Date = new Date();
  endDate: Date = new Date();
  searchWorkerName: string = '';

  employees: Employee[] = [];
  attendanceRecords: AttendanceRecord[] = [];

  constructor(
    private employeeService: EmployeeService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit() {
    this.initializeDateRange();
    this.loadEmployees();
    this.loadAttendanceRecords();
  }

  async loadEmployees() {
    // Load employees from IndexedDB via EmployeeService - only active employees
    this.employeeService.activeEmployees$.subscribe(employees => {
      this.employees = employees;
    });

    // Trigger loading with sync (IndexedDB first, then API)
    await this.employeeService.loadEmployeesWithSync();
  }

  async loadAttendanceRecords() {
    // Subscribe to attendance changes
    this.employeeService.attendance$.subscribe(records => {
      // Convert service records to component records
      const existingNewRecords = this.attendanceRecords.filter(r => r.isNew && !r.isSaved);
      this.attendanceRecords = [
        ...existingNewRecords,
        ...records.map(r => this.convertToComponentRecord(r))
      ];
    });

    // Load attendance with date range filter
    const fromDate = this.formatDateForAPI(this.startDate);
    const toDate = this.formatDateForAPI(this.endDate);
    await this.employeeService.loadAttendanceWithSync(fromDate, toDate);
  }

  convertToComponentRecord(record: ServiceAttendanceRecord): AttendanceRecord {
    const date = record.date ? new Date(record.date) : new Date();
    return {
      id: record.id || '',
      date: date,
      dateString: this.formatDate(date),
      workerId: record.workerId,
      workerName: record.workerName,
      startTime: record.startTime,
      endTime: record.endTime,
      totalHours: record.totalHours,
      notes: record.notes || '',
      isSaved: true,
      isNew: false,
      isDirty: false,
      hasError: false
    };
  }

  initializeDateRange() {
    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    this.startDate = firstDayOfMonth;
    this.endDate = lastDayOfMonth;
  }

  onStartDateChange(event: any) {
    this.startDate = event.value || this.startDate;
    this.filterAttendanceByDate();
  }

  onEndDateChange(event: any) {
    this.endDate = event.value || this.endDate;
    this.filterAttendanceByDate();
  }

  async filterAttendanceByDate() {
    const fromDate = this.formatDateForAPI(this.startDate);
    const toDate = this.formatDateForAPI(this.endDate);

    // Use IndexedDB-first strategy - only calls API if no cached data
    await this.employeeService.loadAttendanceWithSync(fromDate, toDate);
  }

  get filteredRecords(): AttendanceRecord[] {
    if (!this.searchWorkerName) {
      return this.attendanceRecords;
    }
    return this.attendanceRecords.filter(r =>
      r.workerName.toLowerCase().includes(this.searchWorkerName.toLowerCase())
    );
  }

  formatDate(date: Date): string {
    const day = date.getDate();
    const month = date.getMonth() + 1;
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }

  formatDateForAPI(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  addNewRecord() {
    // Check if there's any record without a selected worker
    const incompleteRecord = this.attendanceRecords.find(r => !r.workerId || r.workerId.trim() === '');

    if (incompleteRecord) {
      // Highlight the incomplete record
      incompleteRecord.hasError = true;

      this.snackBar.open('Vui lòng chọn nhân viên cho bản ghi hiện tại trước khi thêm mới!', 'Đóng', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'top',
        panelClass: ['error-snackbar']
      });
      return;
    }

    const newRecord: AttendanceRecord = {
      id: `temp_${Date.now()}`,
      date: new Date(),
      dateString: this.formatDate(new Date()),
      workerId: '',
      workerName: '',
      startTime: '07:00',
      endTime: '17:00',
      totalHours: 10,
      notes: '',
      isSaved: false,
      isNew: true,
      isDirty: true,
      hasError: false
    };
    this.attendanceRecords.unshift(newRecord);
  }

  deleteRecord(record: AttendanceRecord) {
    if (record.isNew && !record.isSaved) {
      // Just remove from local array if not saved
      this.attendanceRecords = this.attendanceRecords.filter(r => r.id !== record.id);
      return;
    }

    // Delete from API and IndexedDB
    this.employeeService.deleteAttendance(record.id).subscribe({
      next: (response) => {
        if (response.success) {
          this.attendanceRecords = this.attendanceRecords.filter(r => r.id !== record.id);
          this.snackBar.open('Đã xóa bản ghi thành công!', 'Đóng', {
            duration: 2000,
            horizontalPosition: 'center',
            verticalPosition: 'top',
            panelClass: ['success-snackbar']
          });
        }
      },
      error: (error) => {
        console.error('Error deleting attendance:', error);
        this.snackBar.open('Lỗi khi xóa bản ghi!', 'Đóng', {
          duration: 3000,
          horizontalPosition: 'center',
          verticalPosition: 'top',
          panelClass: ['error-snackbar']
        });
      }
    });
  }

  onDateChange(record: AttendanceRecord, event: any) {
    record.date = event.value || record.date;
    record.dateString = this.formatDate(record.date);
    this.markAsDirty(record);
  }

  onWorkerChange(record: AttendanceRecord, maNhanVien: string) {
    const employee = this.employees.find(e => e.maNhanVien === maNhanVien);
    if (employee) {
      record.workerId = employee.maNhanVien;
      record.workerName = employee.hoTen;
      record.hasError = false; // Clear error when worker is selected
      this.markAsDirty(record);
    }
  }

  onTimeChange(record: AttendanceRecord) {
    this.calculateTotalHours(record);
    this.markAsDirty(record);
  }

  onNotesChange(record: AttendanceRecord) {
    this.markAsDirty(record);
  }

  markAsDirty(record: AttendanceRecord) {
    record.isDirty = true;
  }

  calculateTotalHours(record: AttendanceRecord) {
    if (!record.startTime || !record.endTime) {
      record.totalHours = 0;
      return;
    }

    const [startHour, startMin] = record.startTime.split(':').map(Number);
    const [endHour, endMin] = record.endTime.split(':').map(Number);

    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;

    let diffMinutes = endMinutes - startMinutes;

    // Handle case where end time is on next day
    if (diffMinutes < 0) {
      diffMinutes += 24 * 60;
    }

    record.totalHours = Math.round((diffMinutes / 60) * 100) / 100; // Round to 2 decimal places
  }

  saveRecord(record: AttendanceRecord) {
    // Validate: check if employee is selected
    if (!record.workerId || record.workerId.trim() === '') {
      this.snackBar.open('Vui lòng chọn nhân viên trước khi lưu!', 'Đóng', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'top',
        panelClass: ['error-snackbar']
      });
      return;
    }

    // Prepare data for API
    const attendanceData: ServiceAttendanceRecord = {
      date: this.formatDateForAPI(record.date),
      workerId: record.workerId,
      workerName: record.workerName,
      startTime: record.startTime,
      endTime: record.endTime,
      totalHours: record.totalHours,
      notes: record.notes
    };

    if (record.isNew) {
      // Add new record
      this.employeeService.addAttendance(attendanceData).subscribe({
        next: async (response) => {
          if (response.success) {
            // Update the record with the real ID from server
            record.id = response.id;
            record.isSaved = true;
            record.isNew = false;
            record.isDirty = false;

            // Sync to payroll IndexedDB
            await this.syncToPayrollIndexedDB();

            this.snackBar.open('Đã lưu bản ghi thành công!', 'Đóng', {
              duration: 2000,
              horizontalPosition: 'center',
              verticalPosition: 'top',
              panelClass: ['success-snackbar']
            });
          }
        },
        error: (error) => {
          console.error('Error saving attendance:', error);
          this.snackBar.open('Lỗi khi lưu bản ghi!', 'Đóng', {
            duration: 3000,
            horizontalPosition: 'center',
            verticalPosition: 'top',
            panelClass: ['error-snackbar']
          });
        }
      });
    } else {
      // Update existing record
      this.employeeService.updateAttendance(record.id, attendanceData).subscribe({
        next: async (response) => {
          if (response.success) {
            record.isSaved = true;
            record.isDirty = false;

            // Sync to payroll IndexedDB
            await this.syncToPayrollIndexedDB();

            this.snackBar.open('Đã cập nhật bản ghi thành công!', 'Đóng', {
              duration: 2000,
              horizontalPosition: 'center',
              verticalPosition: 'top',
              panelClass: ['success-snackbar']
            });
          }
        },
        error: (error) => {
          console.error('Error updating attendance:', error);
          this.snackBar.open('Lỗi khi cập nhật bản ghi!', 'Đóng', {
            duration: 3000,
            horizontalPosition: 'center',
            verticalPosition: 'top',
            panelClass: ['error-snackbar']
          });
        }
      });
    }
  }

  /**
   * Sync saved attendance records to payroll IndexedDB
   */
  async syncToPayrollIndexedDB() {
    // Get all saved attendance records
    const savedRecords = this.attendanceRecords
      .filter(r => r.isSaved && !r.isNew)
      .map(r => ({
        id: r.id,
        date: this.formatDateForAPI(r.date),
        workerId: r.workerId,
        workerName: r.workerName,
        startTime: r.startTime,
        endTime: r.endTime,
        totalHours: r.totalHours,
        notes: r.notes
      }));

    if (savedRecords.length > 0) {
      await this.employeeService.syncAttendanceToPayrollIndexedDB(savedRecords);
    }
  }

  shouldHighlightWorker(workerName: string): boolean {
    if (!this.searchWorkerName || this.searchWorkerName.trim() === '') {
      return false;
    }
    return workerName.toLowerCase().includes(this.searchWorkerName.toLowerCase());
  }

  /**
   * Tạo bản ghi chấm công tự động từ lịch làm việc (work schedule)
   */
  generateRecordsFromSchedule() {
    const fromDate = this.formatDateForAPI(this.startDate);
    const toDate = this.formatDateForAPI(this.endDate);

    this.employeeService.getWorkSchedulesByDateRange(fromDate, toDate).subscribe({
      next: (response) => {
        if (response.success && response.data && response.data.length > 0) {
          const schedules = response.data;
          let generatedCount = 0;
          let skippedCount = 0;

          // Lấy danh sách attendance đã tồn tại
          const existingKeys = new Set(
            this.attendanceRecords
              .filter(r => r.isSaved || !r.isNew)
              .map(r => `${this.formatDateForAPI(r.date)}_${r.workerId}`)
          );

          for (const schedule of schedules) {
            // Duyệt qua từng ngày trong tuần
            for (const dayKey of Object.keys(schedule.days)) {
              const daySchedule = schedule.days[dayKey];
              if (!daySchedule || !daySchedule.date) continue;

              const dateStr = daySchedule.date;

              // Duyệt qua các ca: morning, afternoon, evening
              const shifts: Array<{ key: 'morning' | 'afternoon' | 'evening', cell: ScheduleCell | null }> = [
                { key: 'morning', cell: daySchedule.morning },
                { key: 'afternoon', cell: daySchedule.afternoon },
                { key: 'evening', cell: daySchedule.evening }
              ];

              for (const shift of shifts) {
                if (!shift.cell || !shift.cell.workers || shift.cell.workers.length === 0) continue;

                // Tạo bản ghi cho mỗi worker trong ca
                for (const worker of shift.cell.workers) {
                  const recordKey = `${dateStr}_${worker.workerId}`;

                  // Kiểm tra trùng lặp
                  if (existingKeys.has(recordKey)) {
                    skippedCount++;
                    continue;
                  }

                  // Tính tổng giờ làm
                  const totalHours = this.calculateHoursFromTime(shift.cell.startTime, shift.cell.endTime);

                  const newRecord: AttendanceRecord = {
                    id: `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    date: new Date(dateStr),
                    dateString: this.formatDate(new Date(dateStr)),
                    workerId: worker.workerId,
                    workerName: worker.workerName,
                    startTime: shift.cell.startTime,
                    endTime: shift.cell.endTime,
                    totalHours: totalHours,
                    notes: '',
                    isSaved: false,
                    isNew: true,
                    isDirty: true,
                    hasError: false
                  };

                  this.attendanceRecords.push(newRecord);
                  existingKeys.add(recordKey);
                  generatedCount++;
                }
              }
            }
          }

          // Sắp xếp theo ngày mới nhất
          this.attendanceRecords.sort((a, b) => b.date.getTime() - a.date.getTime());

          if (generatedCount > 0) {
            this.snackBar.open(
              `Đã tạo ${generatedCount} bản ghi từ lịch làm việc${skippedCount > 0 ? ` (bỏ qua ${skippedCount} trùng lặp)` : ''}`,
              'Đóng',
              {
                duration: 4000,
                horizontalPosition: 'center',
                verticalPosition: 'top',
                panelClass: ['success-snackbar']
              }
            );
          } else {
            this.snackBar.open(
              skippedCount > 0
                ? `Tất cả ${skippedCount} bản ghi đã tồn tại`
                : 'Không có lịch làm việc nào trong khoảng thời gian này',
              'Đóng',
              {
                duration: 3000,
                horizontalPosition: 'center',
                verticalPosition: 'top',
                panelClass: ['warning-snackbar']
              }
            );
          }
        } else {
          this.snackBar.open('Không tìm thấy lịch làm việc trong khoảng thời gian này', 'Đóng', {
            duration: 3000,
            horizontalPosition: 'center',
            verticalPosition: 'top',
            panelClass: ['warning-snackbar']
          });
        }
      },
      error: (error) => {
        console.error('Error loading work schedules:', error);
        this.snackBar.open('Lỗi khi tải lịch làm việc!', 'Đóng', {
          duration: 3000,
          horizontalPosition: 'center',
          verticalPosition: 'top',
          panelClass: ['error-snackbar']
        });
      }
    });
  }

  /**
   * Tính số giờ từ startTime và endTime
   */
  private calculateHoursFromTime(startTime: string, endTime: string): number {
    if (!startTime || !endTime) return 0;

    const [startHour, startMin] = startTime.split(':').map(Number);
    const [endHour, endMin] = endTime.split(':').map(Number);

    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;

    let diffMinutes = endMinutes - startMinutes;
    if (diffMinutes < 0) {
      diffMinutes += 24 * 60;
    }

    return Math.round((diffMinutes / 60) * 100) / 100;
  }

  /**
   * Lưu tất cả bản ghi đang hiển thị (filtered records)
   */
  saveAllRecords() {
    // Filter records that need to be saved (either new or dirty)
    const recordsToSave = this.filteredRecords.filter(r => r.isDirty || r.isNew);

    if (recordsToSave.length === 0) {
      this.snackBar.open('Không có bản ghi nào cần lưu!', 'Đóng', {
        duration: 2000,
        horizontalPosition: 'center',
        verticalPosition: 'top',
        panelClass: ['warning-snackbar']
      });
      return;
    }

    // Validate: check if all records have a selected worker
    const invalidRecords = recordsToSave.filter(r => !r.workerId || r.workerId.trim() === '');
    if (invalidRecords.length > 0) {
      invalidRecords.forEach(r => r.hasError = true);
      this.snackBar.open(`${invalidRecords.length} bản ghi chưa chọn nhân viên!`, 'Đóng', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'top',
        panelClass: ['error-snackbar']
      });
      return;
    }

    // Prepare data for API
    const attendanceDataList = recordsToSave.map(record => ({
      id: record.isNew ? undefined : record.id,
      date: this.formatDateForAPI(record.date),
      workerId: record.workerId,
      workerName: record.workerName,
      startTime: record.startTime,
      endTime: record.endTime,
      totalHours: record.totalHours,
      notes: record.notes
    }));

    this.employeeService.saveAttendanceBatch(attendanceDataList).subscribe({
      next: async (response) => {
        if (response.success) {
          // Mark all saved records as saved and not dirty
          recordsToSave.forEach(record => {
            record.isSaved = true;
            record.isNew = false;
            record.isDirty = false;
          });

          // Sync to payroll IndexedDB
          await this.syncToPayrollIndexedDB();

          this.snackBar.open(`Đã lưu ${recordsToSave.length} bản ghi thành công!`, 'Đóng', {
            duration: 2000,
            horizontalPosition: 'center',
            verticalPosition: 'top',
            panelClass: ['success-snackbar']
          });
        }
      },
      error: (error) => {
        console.error('Error saving attendance batch:', error);
        this.snackBar.open('Lỗi khi lưu các bản ghi!', 'Đóng', {
          duration: 3000,
          horizontalPosition: 'center',
          verticalPosition: 'top',
          panelClass: ['error-snackbar']
        });
      }
    });
  }
}
