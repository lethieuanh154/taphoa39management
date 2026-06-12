import { Routes } from '@angular/router';
import { OrderPageComponent } from './components/order-page/order-page.component';
import { EmployeeListPageComponent } from './components/employee-list-page/employee-list-page.component';
import { WorkSchedulePageComponent } from './components/work-schedule-page/work-schedule-page.component';
import { AttendancePageComponent } from './components/attendance-page/attendance-page.component';
import { PayrollPageComponent } from './components/payroll-page/payroll-page.component';
import { PromotionListPageComponent } from './components/promotion-list-page/promotion-list-page.component';
import { DeliveryRoutePageComponent } from './components/delivery-route-page/delivery-route-page.component';
import { LoginPageComponent } from './components/login-page/login-page.component';
import { EditProductPageRefactoredComponent } from './components/edit-product-page/edit-product-page-refactored.component';
import { authGuard, loginGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: 'login', component: LoginPageComponent, canActivate: [loginGuard] },
  { path: 'orders', component: OrderPageComponent, canActivate: [authGuard] },
  { path: 'delivery', component: DeliveryRoutePageComponent, canActivate: [authGuard] },
  { path: 'employees', component: EmployeeListPageComponent, canActivate: [authGuard] },
  { path: 'work-schedule', component: WorkSchedulePageComponent, canActivate: [authGuard] },
  { path: 'attendance', component: AttendancePageComponent, canActivate: [authGuard] },
  { path: 'payroll', component: PayrollPageComponent, canActivate: [authGuard] },
  { path: 'promotions', component: PromotionListPageComponent, canActivate: [authGuard] },
  { path: 'edit-products', component: EditProductPageRefactoredComponent, canActivate: [authGuard] },
  { path: '', redirectTo: '/orders', pathMatch: 'full' }
];
