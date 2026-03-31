import { Routes } from '@angular/router';
import { OrderPageComponent } from './components/order-page/order-page.component';
import { EmployeeListPageComponent } from './components/employee-list-page/employee-list-page.component';
import { WorkSchedulePageComponent } from './components/work-schedule-page/work-schedule-page.component';
import { AttendancePageComponent } from './components/attendance-page/attendance-page.component';
import { PayrollPageComponent } from './components/payroll-page/payroll-page.component';
import { PromotionListPageComponent } from './components/promotion-list-page/promotion-list-page.component';

export const routes: Routes = [
  { path: 'orders', component: OrderPageComponent },
  { path: 'employees', component: EmployeeListPageComponent },
  { path: 'work-schedule', component: WorkSchedulePageComponent },
  { path: 'attendance', component: AttendancePageComponent },
  { path: 'payroll', component: PayrollPageComponent },
  { path: 'promotions', component: PromotionListPageComponent },
  { path: '', redirectTo: '/orders', pathMatch: 'full' }
];
