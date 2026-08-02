import { Component, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from './services/auth.service';
import { TokenExpiredService } from './services/token-expired.service';
import { ChatBubbleComponent } from './components/chat-bubble/chat-bubble.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CommonModule, ChatBubbleComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  showEmployeeSubmenu = false;
  sidebarCollapsed = false;

  private authService = inject(AuthService);
  private tokenExpiredService = inject(TokenExpiredService);
  private router = inject(Router);

  authState$ = this.authService.authState$;
  sessionExpired$ = this.tokenExpiredService.showExpiredDialog$;
  sessionMessage$ = this.tokenExpiredService.expiredMessage$;

  toggleSidebar() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }

  relogin() {
    this.tokenExpiredService.redirectToLogin(true);
  }

  dismissSessionBanner() {
    this.tokenExpiredService.dismissDialog();
  }

  async logout() {
    await this.authService.logout();
    this.router.navigate(['/login']);
  }
}
