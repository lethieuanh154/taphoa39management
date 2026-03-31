import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { tap, map } from 'rxjs/operators';
import { IndexedDBService } from './indexed-db.service';
import { environment } from '../../environments/environment';

export interface Employee {
  id?: string;
  maNhanVien: string;
  hoTen: string;
  ngaySinh?: Date | string | null;
  gioiTinh?: string;
  soCCCD?: string;
  phongBan?: string;
  chucDanh?: string;
  ngayBatDau?: Date | string | null;
  ngayKetThuc?: Date | string | null;
  soDienThoai?: string;
  email?: string;
  diaChi?: string;
  hinhAnh?: string;
  nhanVienKhoan?: boolean; // Nhân viên khoán (contractor)
}

export interface WorkSchedule {
  id?: string;
  weekNumber: number;
  weekStartDate: string;
  weekEndDate?: string;
  days: {
    [key: string]: DaySchedule;
  };
  updatedAt?: Date | string;
}

export interface DaySchedule {
  date: string; // "yyyy-mm-dd"
  morning: ScheduleCell | null;
  afternoon: ScheduleCell | null;
  evening: ScheduleCell | null;
}

export interface ScheduleCell {
  workers: WorkerAssignment[];
  startTime: string;
  endTime: string;
}

export interface WorkerAssignment {
  workerId: string;
  workerName: string;
}

export interface AttendanceRecord {
  id?: string;
  date: string;
  workerId: string;
  workerName: string;
  startTime: string;
  endTime: string;
  totalHours: number;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PayrollRecord {
  id?: string;
  maNhanVien: string;
  hoTen: string;
  chucDanh?: string;
  period: string; // YYYY-MM format
  nhanVienKhoan: boolean;
  // Regular employee fields
  luongCoBan?: number;
  phuCapCaKeoDai?: number;
  phuCapTracNhiem?: number;
  phuCapQuanLyCa?: number;
  phuCapXang?: number;
  phuCapDienThoai?: number;
  phuCapAnTrua?: number;
  tongLuong?: number;
  bhxh?: number;
  bhyt?: number;
  bhtn?: number;
  tongTrichBH?: number;
  thucLinh?: number;
  // Contractor employee fields
  tongGioLam?: number;
  donGiaGio?: number;
  tienKhoan?: number;
  thuong?: number;
  phuCap?: number;
  tongTienCong?: number;
  thueTNCN?: number;
  thucTra?: number;
  // Metadata
  createdAt?: string;
  updatedAt?: string;
}

@Injectable({
  providedIn: 'root'
})
export class EmployeeService {
  private readonly baseUrl = '/api/firebase';

  // IndexedDB configuration
  private readonly DB_NAME = 'EmployeeDB';
  private readonly DB_VERSION = 6; // Bumped to create deleted_payrolls store
  private readonly STORE_NAME = 'employees';
  private readonly ATTENDANCE_STORE_NAME = 'attendance';
  private readonly WORK_SCHEDULES_STORE_NAME = 'work_schedules';
  private readonly PAYROLL_STORE_NAME = 'payroll';
  private readonly DELETED_PAYROLLS_STORE_NAME = 'deleted_payrolls';

  // BehaviorSubject to notify components of employee changes
  private employeesSubject = new BehaviorSubject<Employee[]>([]);
  public employees$ = this.employeesSubject.asObservable();

  // BehaviorSubject for attendance records
  private attendanceSubject = new BehaviorSubject<AttendanceRecord[]>([]);
  public attendance$ = this.attendanceSubject.asObservable();

  constructor(
    private http: HttpClient,
    private indexedDBService: IndexedDBService
  ) {
    this.initializeIndexedDB();
  }

  // ===============================
  // INDEXED DB METHODS
  // ===============================

  private async initializeIndexedDB(): Promise<void> {
    try {
      const db = await this.indexedDBService.getDB(
        this.DB_NAME,
        this.DB_VERSION,
        (database) => {
          // Create employees object store if it doesn't exist
          if (!database.objectStoreNames.contains(this.STORE_NAME)) {
            const store = database.createObjectStore(this.STORE_NAME, {
              keyPath: 'maNhanVien'
            });
            // Create indexes
            store.createIndex('hoTen', 'hoTen', { unique: false });
            store.createIndex('phongBan', 'phongBan', { unique: false });
            store.createIndex('chucDanh', 'chucDanh', { unique: false });
            console.log('✅ Employee object store created with indexes');
          }

          // Create attendance object store if it doesn't exist
          if (!database.objectStoreNames.contains(this.ATTENDANCE_STORE_NAME)) {
            const attendanceStore = database.createObjectStore(this.ATTENDANCE_STORE_NAME, {
              keyPath: 'id'
            });
            // Create indexes for attendance
            attendanceStore.createIndex('workerId', 'workerId', { unique: false });
            attendanceStore.createIndex('date', 'date', { unique: false });
            attendanceStore.createIndex('workerName', 'workerName', { unique: false });
            console.log('✅ Attendance object store created with indexes');
          }

          // Create work_schedules object store if it doesn't exist
          if (!database.objectStoreNames.contains(this.WORK_SCHEDULES_STORE_NAME)) {
            const scheduleStore = database.createObjectStore(this.WORK_SCHEDULES_STORE_NAME, {
              keyPath: 'weekStartDate'
            });
            // Create indexes for work schedules
            scheduleStore.createIndex('weekNumber', 'weekNumber', { unique: false });
            console.log('✅ Work schedules object store created with indexes');
          }

          // Create payroll object store if it doesn't exist
          if (!database.objectStoreNames.contains(this.PAYROLL_STORE_NAME)) {
            const payrollStore = database.createObjectStore(this.PAYROLL_STORE_NAME, {
              keyPath: 'id'
            });
            // Create indexes for payroll
            payrollStore.createIndex('maNhanVien', 'maNhanVien', { unique: false });
            payrollStore.createIndex('period', 'period', { unique: false });
            payrollStore.createIndex('nhanVienKhoan', 'nhanVienKhoan', { unique: false });
            console.log('✅ Payroll object store created with indexes');
          }

          // Create deleted_payrolls object store if it doesn't exist
          if (!database.objectStoreNames.contains(this.DELETED_PAYROLLS_STORE_NAME)) {
            const deletedPayrollStore = database.createObjectStore(this.DELETED_PAYROLLS_STORE_NAME, {
              keyPath: 'id'
            });
            // Create index for period to efficiently query deleted IDs by period
            deletedPayrollStore.createIndex('period', 'period', { unique: false });
            console.log('✅ Deleted payrolls object store created with indexes');
          }
        }
      );
      console.log('✅ Employee IndexedDB initialized');

      // Load employees from IndexedDB on initialization
      await this.loadEmployeesFromIndexedDB();
    } catch (error) {
      console.error('❌ Error initializing Employee IndexedDB:', error);
    }
  }

  private async saveEmployeeToIndexedDB(employee: Employee): Promise<void> {
    try {
      const db = await this.indexedDBService.getDB(this.DB_NAME, this.DB_VERSION);
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      await tx.store.put(employee);
      await tx.done;
      console.log('✅ Employee saved to IndexedDB:', employee.maNhanVien);
    } catch (error) {
      console.error('❌ Error saving employee to IndexedDB:', error);
    }
  }

  private async saveEmployeesToIndexedDB(employees: Employee[]): Promise<void> {
    try {
      const db = await this.indexedDBService.getDB(this.DB_NAME, this.DB_VERSION);
      const tx = db.transaction(this.STORE_NAME, 'readwrite');

      // Clear existing data
      await tx.store.clear();

      // Add all employees
      for (const employee of employees) {
        await tx.store.put(employee);
      }

      await tx.done;
      console.log(`✅ ${employees.length} employees saved to IndexedDB`);
    } catch (error) {
      console.error('❌ Error saving employees to IndexedDB:', error);
    }
  }

  private async loadEmployeesFromIndexedDB(): Promise<Employee[]> {
    try {
      const employees = await this.indexedDBService.getAll<Employee>(
        this.DB_NAME,
        this.DB_VERSION,
        this.STORE_NAME
      );
      console.log(`✅ Loaded ${employees.length} employees from IndexedDB`);
      this.employeesSubject.next(employees);
      return employees;
    } catch (error) {
      console.error('❌ Error loading employees from IndexedDB:', error);
      return [];
    }
  }

  private async deleteEmployeeFromIndexedDB(maNhanVien: string): Promise<void> {
    try {
      const db = await this.indexedDBService.getDB(this.DB_NAME, this.DB_VERSION);
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      await tx.store.delete(maNhanVien);
      await tx.done;
      console.log('✅ Employee deleted from IndexedDB:', maNhanVien);
    } catch (error) {
      console.error('❌ Error deleting employee from IndexedDB:', error);
    }
  }

  // ===============================
  // API METHODS - EMPLOYEE LIST
  // ===============================

  getAllEmployees(useCache: boolean = true): Observable<Employee[]> {
    return this.http.get<Employee[]>(`${environment.domainUrl}${this.baseUrl}/get/employees`).pipe(
      tap(async (employees) => {
        // Save to IndexedDB
        await this.saveEmployeesToIndexedDB(employees);
        // Update BehaviorSubject
        this.employeesSubject.next(employees);
      })
    );
  }

  getEmployeeById(employeeId: string): Observable<Employee> {
    return this.http.get<Employee>(`${environment.domainUrl}${this.baseUrl}/employees/${employeeId}`);
  }

  addEmployee(employee: Employee): Observable<any> {
    return this.http.post<any>(`${environment.domainUrl}${this.baseUrl}/add_employee`, employee).pipe(
      tap(async (response) => {
        if (response.success) {
          // Save to IndexedDB
          await this.saveEmployeeToIndexedDB(response.data);
          // Reload all employees to update the list
          this.getAllEmployees().subscribe();
        }
      })
    );
  }

  updateEmployee(employeeId: string, updates: Partial<Employee>): Observable<any> {
    return this.http.put<any>(`${environment.domainUrl}${this.baseUrl}/update_employee/${employeeId}`, updates).pipe(
      tap(async (response) => {
        if (response.success) {
          // Update in IndexedDB
          const currentEmployees = this.employeesSubject.value;
          const index = currentEmployees.findIndex(e => e.maNhanVien === employeeId);
          if (index !== -1) {
            const updatedEmployee = { ...currentEmployees[index], ...updates };
            await this.saveEmployeeToIndexedDB(updatedEmployee);
            currentEmployees[index] = updatedEmployee;
            this.employeesSubject.next([...currentEmployees]);
          }
        }
      })
    );
  }

  deleteEmployee(employeeId: string): Observable<any> {
    return this.http.delete<any>(`${environment.domainUrl}${this.baseUrl}/delete_employee/${employeeId}`).pipe(
      tap(async (response) => {
        if (response.success) {
          // Delete from IndexedDB
          await this.deleteEmployeeFromIndexedDB(employeeId);
          // Update BehaviorSubject
          const currentEmployees = this.employeesSubject.value;
          const filtered = currentEmployees.filter(e => e.maNhanVien !== employeeId);
          this.employeesSubject.next(filtered);
        }
      })
    );
  }

  // ===============================
  // API METHODS - WORK SCHEDULE
  // ===============================

  getAllWorkSchedules(): Observable<WorkSchedule[]> {
    return this.http.get<WorkSchedule[]>(`${environment.domainUrl}${this.baseUrl}/get/work_schedules`);
  }

  getWorkSchedulesByDateRange(fromDate: string, toDate: string): Observable<any> {
    const params = new HttpParams()
      .set('from_date', fromDate)
      .set('to_date', toDate);

    return this.http.get<any>(`${environment.domainUrl}${this.baseUrl}/work_schedules/filter`, { params });
  }

  saveWorkSchedule(schedule: WorkSchedule): Observable<any> {
    return this.http.put<any>(`${environment.domainUrl}${this.baseUrl}/save_work_schedule`, schedule).pipe(
      tap(async (response) => {
        if (response.success) {
          // Save to IndexedDB after successful API save
          await this.saveWorkScheduleToIndexedDB(schedule);
        }
      })
    );
  }

  // ===============================
  // INDEXED DB METHODS - WORK SCHEDULE
  // ===============================

  async saveWorkScheduleToIndexedDB(schedule: WorkSchedule): Promise<void> {
    try {
      const db = await this.indexedDBService.getDB(this.DB_NAME, this.DB_VERSION);
      const tx = db.transaction(this.WORK_SCHEDULES_STORE_NAME, 'readwrite');
      await tx.store.put(schedule);
      await tx.done;
      console.log('✅ Work schedule saved to IndexedDB:', schedule.weekStartDate);
    } catch (error) {
      console.error('❌ Error saving work schedule to IndexedDB:', error);
    }
  }

  async loadWorkSchedulesFromIndexedDB(): Promise<WorkSchedule[]> {
    try {
      const schedules = await this.indexedDBService.getAll<WorkSchedule>(
        this.DB_NAME,
        this.DB_VERSION,
        this.WORK_SCHEDULES_STORE_NAME
      );
      console.log(`✅ Loaded ${schedules.length} work schedules from IndexedDB`);
      return schedules;
    } catch (error) {
      console.error('❌ Error loading work schedules from IndexedDB:', error);
      return [];
    }
  }

  async filterWorkSchedulesFromIndexedDB(fromDate: string, toDate: string): Promise<WorkSchedule[]> {
    try {
      const allSchedules = await this.loadWorkSchedulesFromIndexedDB();

      // Filter schedules by date range
      const filteredSchedules = allSchedules.filter(schedule => {
        if (!schedule.weekStartDate) return false;
        return schedule.weekStartDate >= fromDate && schedule.weekStartDate <= toDate;
      });

      console.log(`📦 Filtered ${filteredSchedules.length}/${allSchedules.length} schedules from IndexedDB for date range ${fromDate} to ${toDate}`);
      return filteredSchedules;
    } catch (error) {
      console.error('❌ Error filtering work schedules from IndexedDB:', error);
      return [];
    }
  }

  /**
   * Load work schedules with IndexedDB-first strategy
   * Returns cached data immediately, then fetches from API if needed
   */
  async loadWorkSchedulesWithSync(fromDate: string, toDate: string): Promise<WorkSchedule[]> {
    try {
      // Step 1: Load from IndexedDB first (fast)
      const cachedSchedules = await this.filterWorkSchedulesFromIndexedDB(fromDate, toDate);
      console.log(`📦 Loaded ${cachedSchedules.length} work schedules from cache`);

      if (cachedSchedules.length > 0) {
        return cachedSchedules;
      }

      // Step 2: If no cached data, return empty and let API call handle it
      return [];
    } catch (error) {
      console.error('❌ Error in loadWorkSchedulesWithSync:', error);
      return [];
    }
  }

  // ===============================
  // API METHODS - TIME SHEET
  // ===============================

  getAllTimeSheets(): Observable<any[]> {
    return this.http.get<any[]>(`${environment.domainUrl}${this.baseUrl}/get/time_sheets`);
  }

  addTimeSheet(timeSheet: any): Observable<any> {
    return this.http.post<any>(`${environment.domainUrl}${this.baseUrl}/add_time_sheet`, timeSheet);
  }

  // ===============================
  // API METHODS - PAYROLL
  // ===============================

  getAllPayrolls(): Observable<any[]> {
    return this.http.get<any[]>(`${environment.domainUrl}${this.baseUrl}/get/payrolls`);
  }

  addPayroll(payroll: any): Observable<any> {
    return this.http.post<any>(`${environment.domainUrl}${this.baseUrl}/add_payroll`, payroll);
  }

  savePayroll(payroll: PayrollRecord): Observable<any> {
    return this.http.put<any>(`${environment.domainUrl}${this.baseUrl}/save_payroll`, payroll).pipe(
      tap(async (response) => {
        if (response.success) {
          // Save to IndexedDB after successful API save
          const payrollWithId = { ...payroll, id: response.id || `${payroll.maNhanVien}_${payroll.period}` };
          await this.savePayrollToIndexedDB(payrollWithId);
        }
      })
    );
  }

  savePayrollsBatch(payrolls: PayrollRecord[]): Observable<any> {
    return this.http.put<any>(`${environment.domainUrl}${this.baseUrl}/save_payrolls_batch`, { payrolls }).pipe(
      tap(async (response) => {
        if (response.success) {
          // Save all to IndexedDB
          await this.savePayrollsToIndexedDB(payrolls);
        }
      })
    );
  }

  getPayrollsByPeriod(period: string): Observable<any> {
    const params = new HttpParams().set('period', period);
    return this.http.get<any>(`${environment.domainUrl}${this.baseUrl}/payrolls/filter`, { params });
  }

  deletePayroll(payrollId: string): Observable<any> {
    return this.http.delete<any>(`${environment.domainUrl}${this.baseUrl}/delete_payroll/${payrollId}`).pipe(
      tap(async (response) => {
        if (response.success) {
          // Delete from IndexedDB
          await this.deletePayrollFromIndexedDB(payrollId);
        }
      })
    );
  }

  // ===============================
  // INDEXED DB METHODS - PAYROLL
  // ===============================

  async savePayrollToIndexedDB(payroll: PayrollRecord): Promise<void> {
    try {
      const db = await this.indexedDBService.getDB(this.DB_NAME, this.DB_VERSION);
      const tx = db.transaction(this.PAYROLL_STORE_NAME, 'readwrite');
      await tx.store.put(payroll);
      await tx.done;
      console.log('✅ Payroll saved to IndexedDB:', payroll.id);
    } catch (error) {
      console.error('❌ Error saving payroll to IndexedDB:', error);
    }
  }

  async savePayrollsToIndexedDB(payrolls: PayrollRecord[]): Promise<void> {
    try {
      const db = await this.indexedDBService.getDB(this.DB_NAME, this.DB_VERSION);
      const tx = db.transaction(this.PAYROLL_STORE_NAME, 'readwrite');

      for (const payroll of payrolls) {
        const id = payroll.id || `${payroll.maNhanVien}_${payroll.period}`;
        await tx.store.put({ ...payroll, id });
      }

      await tx.done;
      console.log(`✅ ${payrolls.length} payroll records saved to IndexedDB`);
    } catch (error) {
      console.error('❌ Error saving payrolls to IndexedDB:', error);
    }
  }

  async loadPayrollsFromIndexedDB(): Promise<PayrollRecord[]> {
    try {
      const payrolls = await this.indexedDBService.getAll<PayrollRecord>(
        this.DB_NAME,
        this.DB_VERSION,
        this.PAYROLL_STORE_NAME
      );
      console.log(`✅ Loaded ${payrolls.length} payroll records from IndexedDB`);
      return payrolls;
    } catch (error) {
      console.error('❌ Error loading payrolls from IndexedDB:', error);
      return [];
    }
  }

  async filterPayrollsFromIndexedDB(period: string): Promise<PayrollRecord[]> {
    try {
      const allPayrolls = await this.loadPayrollsFromIndexedDB();
      const filteredPayrolls = allPayrolls.filter(p => p.period === period);
      console.log(`📦 Filtered ${filteredPayrolls.length}/${allPayrolls.length} payrolls for period ${period}`);
      return filteredPayrolls;
    } catch (error) {
      console.error('❌ Error filtering payrolls from IndexedDB:', error);
      return [];
    }
  }

  async deletePayrollFromIndexedDB(payrollId: string): Promise<void> {
    try {
      const db = await this.indexedDBService.getDB(this.DB_NAME, this.DB_VERSION);
      const tx = db.transaction(this.PAYROLL_STORE_NAME, 'readwrite');
      await tx.store.delete(payrollId);
      await tx.done;
      console.log('✅ Payroll deleted from IndexedDB:', payrollId);
    } catch (error) {
      console.error('❌ Error deleting payroll from IndexedDB:', error);
    }
  }

  // ===============================
  // INDEXED DB METHODS - DELETED PAYROLLS TRACKING
  // ===============================

  /**
   * Get all deleted payroll IDs for a specific period
   * @param period - The period in YYYY-MM format
   * @returns Array of deleted payroll IDs
   */
  async getDeletedPayrollIdsFromIndexedDB(period: string): Promise<string[]> {
    try {
      const db = await this.indexedDBService.getDB(this.DB_NAME, this.DB_VERSION);
      const tx = db.transaction(this.DELETED_PAYROLLS_STORE_NAME, 'readonly');
      const index = tx.store.index('period');
      const deletedRecords = await index.getAll(period);
      await tx.done;
      const ids = deletedRecords.map(record => record.id);
      console.log(`✅ Loaded ${ids.length} deleted payroll IDs for period ${period}`);
      return ids;
    } catch (error) {
      console.error('❌ Error loading deleted payroll IDs from IndexedDB:', error);
      return [];
    }
  }

  /**
   * Add a payroll ID to the deleted list
   * @param payrollId - The payroll ID to mark as deleted
   * @param period - The period in YYYY-MM format
   */
  async addDeletedPayrollIdToIndexedDB(payrollId: string, period: string): Promise<void> {
    try {
      const db = await this.indexedDBService.getDB(this.DB_NAME, this.DB_VERSION);
      const tx = db.transaction(this.DELETED_PAYROLLS_STORE_NAME, 'readwrite');
      await tx.store.put({ id: payrollId, period, deletedAt: new Date().toISOString() });
      await tx.done;
      console.log('✅ Added payroll ID to deleted list:', payrollId);
    } catch (error) {
      console.error('❌ Error adding payroll ID to deleted list:', error);
    }
  }

  /**
   * Remove a payroll ID from the deleted list (for re-saving)
   * @param payrollId - The payroll ID to remove from deleted list
   * @param _period - Optional period parameter (unused, kept for API compatibility)
   */
  async removeDeletedPayrollIdFromIndexedDB(payrollId: string, _period?: string): Promise<void> {
    try {
      const db = await this.indexedDBService.getDB(this.DB_NAME, this.DB_VERSION);
      const tx = db.transaction(this.DELETED_PAYROLLS_STORE_NAME, 'readwrite');
      await tx.store.delete(payrollId);
      await tx.done;
      console.log('✅ Removed payroll ID from deleted list:', payrollId);
    } catch (error) {
      console.error('❌ Error removing payroll ID from deleted list:', error);
    }
  }

  /**
   * Get all deleted payroll IDs (all periods)
   * @returns Array of deleted payroll IDs
   */
  async getAllDeletedPayrollIdsFromIndexedDB(): Promise<string[]> {
    try {
      const db = await this.indexedDBService.getDB(this.DB_NAME, this.DB_VERSION);
      const tx = db.transaction(this.DELETED_PAYROLLS_STORE_NAME, 'readonly');
      const allRecords = await tx.store.getAll();
      await tx.done;
      const ids = allRecords.map(record => record.id);
      console.log(`✅ Loaded ${ids.length} total deleted payroll IDs`);
      return ids;
    } catch (error) {
      console.error('❌ Error loading all deleted payroll IDs from IndexedDB:', error);
      return [];
    }
  }

  // ===============================
  // SYNC ATTENDANCE TO PAYROLL
  // ===============================

  /**
   * Sync attendance records to payroll IndexedDB
   * This should be called after saving attendance records
   * @param attendanceRecords - The attendance records to sync
   */
  async syncAttendanceToPayrollIndexedDB(attendanceRecords: AttendanceRecord[]): Promise<void> {
    try {
      console.log(`🔄 Syncing ${attendanceRecords.length} attendance records to payroll...`);

      if (attendanceRecords.length === 0) {
        console.log('⚠️ No attendance records to sync');
        return;
      }

      // Group attendance by workerId and period (month)
      const payrollMap = new Map<string, PayrollRecord>();

      // Get employees to check nhanVienKhoan status
      let employees = this.employeesSubject.value;

      // If no employees in cache, try to load from IndexedDB
      if (employees.length === 0) {
        console.log('📦 Loading employees from IndexedDB for sync...');
        employees = await this.loadEmployeesFromIndexedDB();
      }

      const employeeMap = new Map(employees.map(e => [e.maNhanVien, e]));
      console.log(`👥 Found ${employees.length} employees for mapping`);

      // Get deleted payroll IDs
      const deletedIds = await this.getAllDeletedPayrollIdsFromIndexedDB();
      const deletedSet = new Set(deletedIds);

      for (const record of attendanceRecords) {
        // Get period from date (YYYY-MM)
        const date = new Date(record.date);
        const period = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const payrollId = `${record.workerId}_${period}`;

        // Skip if this payroll was deleted
        if (deletedSet.has(payrollId)) {
          console.log(`⏭️ Skipping deleted payroll: ${payrollId}`);
          continue;
        }

        const employee = employeeMap.get(record.workerId);
        const isContractor = employee?.nhanVienKhoan || false;

        if (!payrollMap.has(payrollId)) {
          // Create new payroll record for ALL employees (both regular and contractor)
          payrollMap.set(payrollId, {
            id: payrollId,
            maNhanVien: record.workerId,
            hoTen: record.workerName,
            chucDanh: employee?.chucDanh,
            period: period,
            nhanVienKhoan: isContractor,
            // Contractor fields - accumulate hours
            tongGioLam: record.totalHours,
            donGiaGio: 0,
            tienKhoan: 0,
            thuong: 0,
            phuCap: 0,
            tongTienCong: 0,
            thueTNCN: 0,
            thucTra: 0,
            // Regular fields
            luongCoBan: 0,
            phuCapCaKeoDai: 0,
            phuCapTracNhiem: 0,
            phuCapQuanLyCa: 0,
            phuCapXang: 0,
            phuCapDienThoai: 0,
            phuCapAnTrua: 0,
            tongLuong: 0,
            bhxh: 0,
            bhyt: 0,
            bhtn: 0,
            tongTrichBH: 0,
            thucLinh: 0
          });
        } else {
          // Add hours to existing payroll record
          const existing = payrollMap.get(payrollId)!;
          existing.tongGioLam = (existing.tongGioLam || 0) + record.totalHours;
        }
      }

      console.log(`📊 Generated ${payrollMap.size} payroll records from attendance`);

      // Merge with existing payroll data to preserve user-entered values
      const existingPayrolls = await this.loadPayrollsFromIndexedDB();
      const existingMap = new Map(existingPayrolls.map(p => [p.id, p]));

      const payrollsToSave: PayrollRecord[] = [];
      for (const [id, newPayroll] of payrollMap) {
        const existing = existingMap.get(id);
        if (existing) {
          // Merge: keep user-entered values, update tongGioLam from attendance
          payrollsToSave.push({
            ...existing,
            tongGioLam: newPayroll.tongGioLam, // Always update from attendance
            hoTen: newPayroll.hoTen,
            chucDanh: newPayroll.chucDanh
          });
        } else {
          payrollsToSave.push(newPayroll);
        }
      }

      if (payrollsToSave.length > 0) {
        await this.savePayrollsToIndexedDB(payrollsToSave);
        console.log(`✅ Synced ${payrollsToSave.length} payroll records to IndexedDB`);
      } else {
        console.log('⚠️ No payroll records to save');
      }
    } catch (error) {
      console.error('❌ Error syncing attendance to payroll IndexedDB:', error);
    }
  }

  // ===============================
  // API METHODS - ATTENDANCE BATCH
  // ===============================

  saveAttendanceBatch(records: any[]): Observable<any> {
    return this.http.put<any>(`${environment.domainUrl}${this.baseUrl}/save_attendance_batch`, { records }).pipe(
      tap(async (response) => {
        if (response.success) {
          // Save all to IndexedDB
          await this.saveAttendanceRecordsToIndexedDB(records);
        }
      })
    );
  }

  // ===============================
  // HELPER METHODS
  // ===============================

  getEmployeesFromCache(): Employee[] {
    return this.employeesSubject.value;
  }

  /**
   * Get only active employees (those without ngayKetThuc or ngayKetThuc is null)
   */
  getActiveEmployees(): Employee[] {
    return this.employeesSubject.value.filter(emp => !emp.ngayKetThuc);
  }

  /**
   * Get active employees as Observable
   */
  get activeEmployees$(): Observable<Employee[]> {
    return this.employees$.pipe(
      map(employees => employees.filter(emp => !emp.ngayKetThuc))
    );
  }

  /**
   * Load employees with IndexedDB-first strategy:
   * 1. Load from IndexedDB immediately for fast UI
   * 2. Fetch from API to get latest data
   * 3. Update IndexedDB and UI if data changed
   */
  async loadEmployeesWithSync(): Promise<void> {
    try {
      // Step 1: Load from IndexedDB first (fast)
      const cachedEmployees = await this.loadEmployeesFromIndexedDB();
      console.log(`📦 Loaded ${cachedEmployees.length} employees from cache`);

      // Step 2: Fetch from API in background
      this.getAllEmployees().subscribe({
        next: (apiEmployees) => {
          console.log(`🌐 Fetched ${apiEmployees.length} employees from API`);
          // Data is automatically saved to IndexedDB and BehaviorSubject in getAllEmployees()
        },
        error: (error) => {
          console.warn('⚠️ Failed to fetch from API, using cached data:', error);
          // Keep using cached data if API fails
        }
      });
    } catch (error) {
      console.error('❌ Error in loadEmployeesWithSync:', error);
      // Fallback: try to fetch from API directly
      this.getAllEmployees().subscribe({
        error: (err) => console.error('❌ API fallback also failed:', err)
      });
    }
  }

  async searchEmployees(searchTerm: string): Promise<Employee[]> {
    const allEmployees = this.employeesSubject.value;

    if (!searchTerm || searchTerm.trim() === '') {
      return allEmployees;
    }

    const term = searchTerm.toLowerCase();
    return allEmployees.filter(emp =>
      emp.hoTen?.toLowerCase().includes(term) ||
      emp.maNhanVien?.toLowerCase().includes(term) ||
      emp.soDienThoai?.toLowerCase().includes(term) ||
      emp.email?.toLowerCase().includes(term)
    );
  }

  // ===============================
  // API METHODS - ATTENDANCE
  // ===============================

  getAllAttendance(): Observable<AttendanceRecord[]> {
    return this.http.get<AttendanceRecord[]>(`${environment.domainUrl}${this.baseUrl}/get/attendance`).pipe(
      tap(async (records) => {
        // Save to IndexedDB
        await this.saveAttendanceRecordsToIndexedDB(records);
        // Update BehaviorSubject
        this.attendanceSubject.next(records);
      })
    );
  }

  getAttendanceByDateRange(fromDate: string, toDate: string): Observable<any> {
    const params = new HttpParams()
      .set('from_date', fromDate)
      .set('to_date', toDate);

    return this.http.get<any>(`${environment.domainUrl}${this.baseUrl}/attendance/filter`, { params }).pipe(
      tap(async (response) => {
        if (response.success && response.data) {
          // Save to IndexedDB
          await this.saveAttendanceRecordsToIndexedDB(response.data);
          // Update BehaviorSubject
          this.attendanceSubject.next(response.data);
        }
      })
    );
  }

  addAttendance(attendance: AttendanceRecord): Observable<any> {
    return this.http.post<any>(`${environment.domainUrl}${this.baseUrl}/add_attendance`, attendance).pipe(
      tap(async (response) => {
        if (response.success && response.data) {
          // Save to IndexedDB
          const recordWithId = { ...response.data, id: response.id };
          await this.saveAttendanceToIndexedDB(recordWithId);
          // Update BehaviorSubject
          const currentRecords = this.attendanceSubject.value;
          this.attendanceSubject.next([recordWithId, ...currentRecords]);
        }
      })
    );
  }

  updateAttendance(attendanceId: string, updates: Partial<AttendanceRecord>): Observable<any> {
    return this.http.put<any>(`${environment.domainUrl}${this.baseUrl}/update_attendance/${attendanceId}`, updates).pipe(
      tap(async (response) => {
        if (response.success) {
          // Update in IndexedDB
          const currentRecords = this.attendanceSubject.value;
          const index = currentRecords.findIndex(r => r.id === attendanceId);
          if (index !== -1) {
            const updatedRecord = { ...currentRecords[index], ...updates };
            await this.saveAttendanceToIndexedDB(updatedRecord);
            currentRecords[index] = updatedRecord;
            this.attendanceSubject.next([...currentRecords]);
          }
        }
      })
    );
  }

  deleteAttendance(attendanceId: string): Observable<any> {
    return this.http.delete<any>(`${environment.domainUrl}${this.baseUrl}/delete_attendance/${attendanceId}`).pipe(
      tap(async (response) => {
        if (response.success) {
          // Delete from IndexedDB
          await this.deleteAttendanceFromIndexedDB(attendanceId);
          // Update BehaviorSubject
          const currentRecords = this.attendanceSubject.value;
          const filtered = currentRecords.filter(r => r.id !== attendanceId);
          this.attendanceSubject.next(filtered);
        }
      })
    );
  }

  // ===============================
  // INDEXED DB METHODS - ATTENDANCE
  // ===============================

  async saveAttendanceToIndexedDB(record: AttendanceRecord): Promise<void> {
    try {
      const db = await this.indexedDBService.getDB(this.DB_NAME, this.DB_VERSION);
      const tx = db.transaction(this.ATTENDANCE_STORE_NAME, 'readwrite');
      await tx.store.put(record);
      await tx.done;
      console.log('✅ Attendance record saved to IndexedDB:', record.id);
    } catch (error) {
      console.error('❌ Error saving attendance to IndexedDB:', error);
    }
  }

  async saveAttendanceRecordsToIndexedDB(records: AttendanceRecord[], clearExisting: boolean = false): Promise<void> {
    try {
      const db = await this.indexedDBService.getDB(this.DB_NAME, this.DB_VERSION);
      const tx = db.transaction(this.ATTENDANCE_STORE_NAME, 'readwrite');

      // Only clear existing data if explicitly requested
      if (clearExisting) {
        await tx.store.clear();
      }

      // Add/update all records (put will update if exists)
      for (const record of records) {
        await tx.store.put(record);
      }

      await tx.done;
      console.log(`✅ ${records.length} attendance records saved to IndexedDB`);
    } catch (error) {
      console.error('❌ Error saving attendance records to IndexedDB:', error);
    }
  }

  async loadAttendanceFromIndexedDB(): Promise<AttendanceRecord[]> {
    try {
      const records = await this.indexedDBService.getAll<AttendanceRecord>(
        this.DB_NAME,
        this.DB_VERSION,
        this.ATTENDANCE_STORE_NAME
      );
      console.log(`✅ Loaded ${records.length} attendance records from IndexedDB`);
      return records;
    } catch (error) {
      console.error('❌ Error loading attendance from IndexedDB:', error);
      return [];
    }
  }

  /**
   * Filter attendance records from IndexedDB by date range
   */
  async filterAttendanceFromIndexedDB(fromDate: string, toDate: string): Promise<AttendanceRecord[]> {
    try {
      const allRecords = await this.loadAttendanceFromIndexedDB();

      // Parse dates for comparison
      const from = new Date(fromDate);
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999); // End of day

      // Filter records by date range
      const filteredRecords = allRecords.filter(record => {
        if (!record.date) return false;
        const recordDate = new Date(record.date);
        return recordDate >= from && recordDate <= to;
      });

      console.log(`📦 Filtered ${filteredRecords.length}/${allRecords.length} records from IndexedDB for date range ${fromDate} to ${toDate}`);
      return filteredRecords;
    } catch (error) {
      console.error('❌ Error filtering attendance from IndexedDB:', error);
      return [];
    }
  }

  async deleteAttendanceFromIndexedDB(id: string): Promise<void> {
    try {
      const db = await this.indexedDBService.getDB(this.DB_NAME, this.DB_VERSION);
      const tx = db.transaction(this.ATTENDANCE_STORE_NAME, 'readwrite');
      await tx.store.delete(id);
      await tx.done;
      console.log('✅ Attendance deleted from IndexedDB:', id);
    } catch (error) {
      console.error('❌ Error deleting attendance from IndexedDB:', error);
    }
  }

  /**
   * Load attendance with IndexedDB-first strategy
   * Only calls API if no data found in IndexedDB for the date range
   */
  async loadAttendanceWithSync(fromDate?: string, toDate?: string): Promise<void> {
    try {
      let cachedRecords: AttendanceRecord[] = [];

      // Step 1: Load from IndexedDB first (fast)
      if (fromDate && toDate) {
        cachedRecords = await this.filterAttendanceFromIndexedDB(fromDate, toDate);
      } else {
        cachedRecords = await this.loadAttendanceFromIndexedDB();
      }

      // Update BehaviorSubject with cached data immediately
      this.attendanceSubject.next(cachedRecords);
      console.log(`📦 Loaded ${cachedRecords.length} attendance records from cache`);

      // Step 2: Only fetch from API if no data in cache
      if (cachedRecords.length === 0) {
        console.log('📡 No cached data found, fetching from API...');
        if (fromDate && toDate) {
          this.getAttendanceByDateRange(fromDate, toDate).subscribe({
            next: (response) => {
              if (response.success) {
                console.log(`🌐 Fetched ${response.data.length} attendance records from API`);
              }
            },
            error: (error) => {
              console.warn('⚠️ Failed to fetch attendance from API:', error);
            }
          });
        } else {
          this.getAllAttendance().subscribe({
            next: (records) => {
              console.log(`🌐 Fetched ${records.length} attendance records from API`);
            },
            error: (error) => {
              console.warn('⚠️ Failed to fetch attendance from API:', error);
            }
          });
        }
      }
    } catch (error) {
      console.error('❌ Error in loadAttendanceWithSync:', error);
    }
  }

  /**
   * Force refresh attendance data from API
   * Use this when you need to ensure data is up-to-date
   */
  async forceRefreshAttendance(fromDate?: string, toDate?: string): Promise<void> {
    console.log('🔄 Force refreshing attendance from API...');
    if (fromDate && toDate) {
      this.getAttendanceByDateRange(fromDate, toDate).subscribe({
        next: (response) => {
          if (response.success) {
            console.log(`🌐 Force fetched ${response.data.length} attendance records from API`);
          }
        },
        error: (error) => {
          console.warn('⚠️ Failed to fetch attendance from API:', error);
        }
      });
    } else {
      this.getAllAttendance().subscribe({
        next: (records) => {
          console.log(`🌐 Force fetched ${records.length} attendance records from API`);
        },
        error: (error) => {
          console.warn('⚠️ Failed to fetch attendance from API:', error);
        }
      });
    }
  }

  getAttendanceFromCache(): AttendanceRecord[] {
    return this.attendanceSubject.value;
  }
}
