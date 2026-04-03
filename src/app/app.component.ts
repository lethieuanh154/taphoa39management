import { Component, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CommonModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  showEmployeeSubmenu = false;
  sidebarCollapsed = false;

  private authService = inject(AuthService);
  private router = inject(Router);

  authState$ = this.authService.authState$;

  toggleSidebar() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }

  async logout() {
    await this.authService.logout();
    this.router.navigate(['/login']);
  }
}
