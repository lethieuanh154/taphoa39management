import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { EmployeeService, Employee } from '../../services/employee.service';

interface Worker {
  id: string;
  name: string;
}

interface WorkerAssignment {
  workerId: string;
  workerName: string;
}

interface ScheduleCell {
  workers: WorkerAssignment[];
  startTime: string;
  endTime: string;
}

interface DayInfo {
  dayName: string;
  date: Date | null;
  dateString: string;
}

interface WeekSchedule {
  weekNumber: number;
  days: {
    [key: string]: {
      morning: ScheduleCell | null;
      afternoon: ScheduleCell | null;
      evening: ScheduleCell | null;
    };
  };
  dayInfos: DayInfo[];
}

@Component({
  selector: 'app-work-schedule-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatButtonModule,
    MatIconModule
  ],
  templateUrl: './work-schedule-page.component.html',
  styleUrl: './work-schedule-page.component.css',
})
export class WorkSchedulePageComponent implements OnInit {
  currentMonth: Date = new Date();
  searchWorkerName: string = '';
  startDate: Date = new Date();
  endDate: Date = new Date();

  dayHeaders = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
  shiftHeaders = ['Sáng', 'Chiều', 'Tối'];

  shiftTimes: { [key: string]: { start: string, end: string, min: string, max: string } } = {
    'Sáng': { start: '07:00', end: '12:00', min: '00:00', max: '11:59' },
    'Chiều': { start: '12:00', end: '17:00', min: '12:00', max: '16:59' },
    'Tối': { start: '17:00', end: '22:00', min: '17:00', max: '23:59' }
  };

  workers: Worker[] = [];

  weekSchedules: WeekSchedule[] = [];

  constructor(private employeeService: EmployeeService) {}

  ngOnInit() {
    this.initializeDateRange();
    this.loadEmployees();
    // Load schedules from API/IndexedDB instead of initializing empty
    this.loadSchedulesFromAPI();
  }

  loadEmployees() {
    // Load employees from service - only active employees (without ngayKetThuc)
    this.employeeService.getAllEmployees().subscribe({
      next: (employees: Employee[]) => {
        // Filter only active employees (those without ngayKetThuc)
        const activeEmployees = employees.filter(emp => !emp.ngayKetThuc);
        this.workers = activeEmployees.map(emp => ({
          id: emp.maNhanVien,
          name: emp.hoTen
        }));
        console.log('Loaded active employees:', this.workers);
      },
      error: (error) => {
        console.error('Error loading employees:', error);
        // Try loading from IndexedDB cache - only active employees
        const cached = this.employeeService.getActiveEmployees();
        this.workers = cached.map(emp => ({
          id: emp.maNhanVien,
          name: emp.hoTen
        }));
      }
    });
  }

  initializeDateRange() {
    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    this.startDate = firstDayOfMonth;
    this.endDate = lastDayOfMonth;
    this.currentMonth = today;
  }

  initializeSchedules() {
    if (!this.startDate || !this.endDate) return;

    this.weekSchedules = [];

    const start = new Date(this.startDate);
    const end = new Date(this.endDate);

    // Adjust to start from Monday
    const dayOfWeek = start.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    start.setDate(start.getDate() + diff);

    let weekNumber = 1;
    let currentDate = new Date(start);

    while (currentDate <= end || weekNumber === 1) {
      const weekSchedule: WeekSchedule = {
        weekNumber: weekNumber,
        days: {},
        dayInfos: []
      };

      // Create 7 days for the week (Monday to Sunday)
      for (let i = 0; i < 7; i++) {
        const dayName = this.dayHeaders[i];
        const dayDate = new Date(currentDate);

        const dayInfo: DayInfo = {
          dayName: dayName,
          date: dayDate,
          dateString: this.formatDate(dayDate)
        };

        weekSchedule.dayInfos.push(dayInfo);
        weekSchedule.days[dayName] = {
          morning: null,
          afternoon: null,
          evening: null
        };

        currentDate.setDate(currentDate.getDate() + 1);
      }

      this.weekSchedules.push(weekSchedule);
      weekNumber++;

      // Stop if we've gone past the end date
      if (currentDate > end && weekNumber > 1) {
        break;
      }
    }
  }

  formatDate(date: Date): string {
    const day = date.getDate();
    const month = date.getMonth() + 1;
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }

  getWeeksInMonth(date: Date): number {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const firstDayOfWeek = firstDay.getDay();

    return Math.ceil((daysInMonth + firstDayOfWeek) / 7);
  }

  onWorkerSelect(weekIndex: number, day: string, shift: string, workerId: string) {
    const worker = this.workers.find(w => w.id === workerId);

    if (worker) {
      const shiftKey = shift === 'Sáng' ? 'morning' : shift === 'Chiều' ? 'afternoon' : 'evening';
      const times = this.shiftTimes[shift];

      let cell = this.weekSchedules[weekIndex].days[day][shiftKey];

      // Create cell if it doesn't exist
      if (!cell) {
        cell = {
          workers: [],
          startTime: times.start,
          endTime: times.end
        };
        this.weekSchedules[weekIndex].days[day][shiftKey] = cell;
      }

      // Check if worker is already assigned
      const alreadyAssigned = cell.workers.some(w => w.workerId === worker.id);
      if (!alreadyAssigned) {
        cell.workers.push({
          workerId: worker.id,
          workerName: worker.name
        });
      }
    }
  }

  removeWorker(weekIndex: number, day: string, shift: string, workerId: string) {
    const shiftKey = shift === 'Sáng' ? 'morning' : shift === 'Chiều' ? 'afternoon' : 'evening';
    const cell = this.weekSchedules[weekIndex]?.days[day]?.[shiftKey];

    if (cell) {
      cell.workers = cell.workers.filter(w => w.workerId !== workerId);
    }
  }

  getAssignedWorkers(weekIndex: number, day: string, shift: string): WorkerAssignment[] {
    const shiftKey = shift === 'Sáng' ? 'morning' : shift === 'Chiều' ? 'afternoon' : 'evening';
    const cell = this.weekSchedules[weekIndex]?.days[day]?.[shiftKey];
    return cell?.workers || [];
  }

  isWorkerAssigned(weekIndex: number, day: string, shift: string, workerId: string): boolean {
    const assignedWorkers = this.getAssignedWorkers(weekIndex, day, shift);
    return assignedWorkers.some(w => w.workerId === workerId);
  }

  getAvailableWorkers(weekIndex: number, day: string, shift: string): Worker[] {
    return this.filteredWorkers.filter(worker =>
      !this.isWorkerAssigned(weekIndex, day, shift, worker.id)
    );
  }

  onStartDateChange(event: any) {
    this.startDate = event.value || this.startDate;
    this.loadSchedulesFromAPI();
  }

  onEndDateChange(event: any) {
    this.endDate = event.value || this.endDate;
    this.loadSchedulesFromAPI();
  }

  async loadSchedulesFromAPI() {
    if (!this.startDate || !this.endDate) {
      this.initializeSchedules();
      return;
    }

    // Step 1: Always initialize empty schedules first (create week structure)
    this.initializeSchedules();

    const fromDate = this.formatDateForStorage(this.startDate);
    const toDate = this.formatDateForStorage(this.endDate);

    console.log(`📅 Loading schedules from ${fromDate} to ${toDate}`);

    // Step 2: Try loading from IndexedDB first
    try {
      const cachedSchedules = await this.employeeService.loadWorkSchedulesWithSync(fromDate, toDate);
      console.log('📦 Cached schedules from IndexedDB:', cachedSchedules);

      if (cachedSchedules.length > 0) {
        // Merge cached data into initialized schedules
        this.mergeSchedulesData(cachedSchedules);
        console.log('✅ Merged schedules from IndexedDB:', this.weekSchedules);
        return;
      }
    } catch (error) {
      console.error('❌ Error loading from IndexedDB:', error);
    }

    // Step 3: If no cached data, fetch from API
    this.employeeService.getWorkSchedulesByDateRange(fromDate, toDate).subscribe({
      next: (response) => {
        console.log('🌐 API response:', response);
        if (response.success && response.data && response.data.length > 0) {
          // Merge API data into initialized schedules
          this.mergeSchedulesData(response.data);
          console.log('✅ Merged schedules from API:', this.weekSchedules);

          // Save to IndexedDB for future use
          for (const schedule of response.data) {
            this.employeeService.saveWorkScheduleToIndexedDB(schedule);
          }
        }
        // If no data from API, keep initialized empty schedules
      },
      error: (error) => {
        console.error('❌ Error loading from API:', error);
        // Keep initialized empty schedules on error
      }
    });
  }

  /**
   * Merge saved schedule data into initialized week schedules
   */
  private mergeSchedulesData(savedSchedules: any[]) {
    for (const savedSchedule of savedSchedules) {
      // Find matching week by weekStartDate
      const weekStartDate = savedSchedule.weekStartDate;

      // Find the week in weekSchedules that matches this weekStartDate
      const matchingWeekIndex = this.weekSchedules.findIndex(week => {
        if (week.dayInfos.length === 0 || !week.dayInfos[0].date) return false;
        return this.formatDateForStorage(week.dayInfos[0].date) === weekStartDate;
      });

      if (matchingWeekIndex !== -1) {
        // Merge the days data
        const targetWeek = this.weekSchedules[matchingWeekIndex];

        for (const dayName of this.dayHeaders) {
          const savedDay = savedSchedule.days?.[dayName];
          if (savedDay) {
            // Merge shift data (morning, afternoon, evening)
            if (savedDay.morning) {
              targetWeek.days[dayName].morning = savedDay.morning;
            }
            if (savedDay.afternoon) {
              targetWeek.days[dayName].afternoon = savedDay.afternoon;
            }
            if (savedDay.evening) {
              targetWeek.days[dayName].evening = savedDay.evening;
            }
          }
        }

        console.log(`✅ Merged data for week ${targetWeek.weekNumber}`);
      }
    }
  }

  get filteredWorkers(): Worker[] {
    if (!this.searchWorkerName) {
      return this.workers;
    }
    return this.workers.filter(w =>
      w.name.toLowerCase().includes(this.searchWorkerName.toLowerCase())
    );
  }

  showDropdown: { [key: string]: boolean } = {};

  toggleDropdown(weekIndex: number, day: string, shift: string) {
    const key = `${weekIndex}-${day}-${shift}`;
    this.showDropdown[key] = !this.showDropdown[key];
  }

  isDropdownVisible(weekIndex: number, day: string, shift: string): boolean {
    const key = `${weekIndex}-${day}-${shift}`;
    return this.showDropdown[key] || false;
  }

  shouldHighlightWorker(workerName: string): boolean {
    if (!this.searchWorkerName || this.searchWorkerName.trim() === '') {
      return false;
    }
    return workerName.toLowerCase().includes(this.searchWorkerName.toLowerCase());
  }

  getStartTime(weekIndex: number, day: string, shift: string): string {
    const shiftKey = shift === 'Sáng' ? 'morning' : shift === 'Chiều' ? 'afternoon' : 'evening';
    const cell = this.weekSchedules[weekIndex]?.days[day]?.[shiftKey];

    if (cell && cell.startTime) {
      return cell.startTime;
    }

    // Return default shift start time
    const times = this.shiftTimes[shift];
    return times.start;
  }

  getEndTime(weekIndex: number, day: string, shift: string): string {
    const shiftKey = shift === 'Sáng' ? 'morning' : shift === 'Chiều' ? 'afternoon' : 'evening';
    const cell = this.weekSchedules[weekIndex]?.days[day]?.[shiftKey];

    if (cell && cell.endTime) {
      return cell.endTime;
    }

    // Return default shift end time
    const times = this.shiftTimes[shift];
    return times.end;
  }

  onTimeChange(weekIndex: number, day: string, shift: string, type: 'start' | 'end', event: any) {
    const shiftKey = shift === 'Sáng' ? 'morning' : shift === 'Chiều' ? 'afternoon' : 'evening';
    let cell = this.weekSchedules[weekIndex]?.days[day]?.[shiftKey];

    const inputValue = event.target.value;
    const shiftInfo = this.shiftTimes[shift];

    // Validate time is within shift range
    if (inputValue < shiftInfo.min || inputValue > shiftInfo.max) {
      alert(`Thời gian phải nằm trong khoảng ${shiftInfo.min} - ${shiftInfo.max} cho ca ${shift}`);
      // Reset to default value
      event.target.value = type === 'start' ? shiftInfo.start : shiftInfo.end;
      return;
    }

    // If cell doesn't exist, create it with default values
    if (!cell) {
      const times = this.shiftTimes[shift];
      cell = {
        workers: [],
        startTime: times.start,
        endTime: times.end
      };
      this.weekSchedules[weekIndex].days[day][shiftKey] = cell;
    }

    // Update the time
    if (type === 'start') {
      cell.startTime = inputValue;

      // Validate start time is before end time
      if (cell.endTime && inputValue >= cell.endTime) {
        alert('Thời gian bắt đầu phải nhỏ hơn thời gian kết thúc');
        event.target.value = shiftInfo.start;
        cell.startTime = shiftInfo.start;
      }
    } else {
      cell.endTime = inputValue;

      // Validate end time is after start time
      if (cell.startTime && inputValue <= cell.startTime) {
        alert('Thời gian kết thúc phải lớn hơn thời gian bắt đầu');
        event.target.value = shiftInfo.end;
        cell.endTime = shiftInfo.end;
      }
    }
  }

  getMinTime(shift: string): string {
    return this.shiftTimes[shift].min;
  }

  getMaxTime(shift: string): string {
    return this.shiftTimes[shift].max;
  }

  saveWeekSchedule(weekIndex: number) {
    const weekSchedule = this.weekSchedules[weekIndex];

    if (!weekSchedule) {
      alert('Không tìm thấy lịch làm việc cho tuần này');
      return;
    }

    // Prepare payload for API - embed date into each day
    const daysWithDate: { [key: string]: any } = {};
    for (const dayInfo of weekSchedule.dayInfos) {
      const dayName = dayInfo.dayName;
      daysWithDate[dayName] = {
        date: this.formatDateForStorage(dayInfo.date),
        morning: weekSchedule.days[dayName]?.morning || null,
        afternoon: weekSchedule.days[dayName]?.afternoon || null,
        evening: weekSchedule.days[dayName]?.evening || null
      };
    }

    const payload = {
      weekNumber: weekSchedule.weekNumber,
      weekStartDate: this.formatDateForStorage(weekSchedule.dayInfos[0].date),
      days: daysWithDate
    };

    console.log('📤 Saving schedule payload:', payload);

    // Save to Firebase via API
    this.employeeService.saveWorkSchedule(payload).subscribe({
      next: (response) => {
        console.log('📥 API response:', response);
        if (response.success) {
          alert(`Đã lưu lịch Tuần ${weekSchedule.weekNumber} thành công!`);
          console.log('✅ Schedule saved:', response);
        } else {
          alert(`Lỗi: ${response.message}`);
        }
      },
      error: (error) => {
        console.error('❌ Error saving schedule:', error);
        // Still try to save to IndexedDB even if API fails
        this.employeeService.saveWorkScheduleToIndexedDB(payload);
        alert(`Lỗi API, đã lưu offline: ${error.error?.message || error.message}`);
      }
    });
  }

  private formatDateForStorage(date: Date | null): string {
    if (!date) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
