import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './login-page.component.html',
  styleUrls: ['./login-page.component.scss']
})
export class LoginPageComponent {
  isLoading = false;
  error = '';

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  async signInWithGoogle(): Promise<void> {
    this.error = '';
    this.isLoading = true;

    try {
      await this.authService.signInWithGoogle();
      this.router.navigate(['/orders']);
    } catch (err: any) {
      console.error('Login error:', err);
      this.handleAuthError(err);
    } finally {
      this.isLoading = false;
    }
  }

  private handleAuthError(err: any): void {
    const errorCode = err.code || '';
    const errorMessage = err.message || '';

    switch (errorCode) {
      case 'auth/popup-closed-by-user':
        this.error = 'Đăng nhập bị hủy';
        break;
      case 'auth/popup-blocked':
        this.error = 'Popup bị chặn. Vui lòng cho phép popup.';
        break;
      case 'auth/cancelled-popup-request':
        this.error = '';
        break;
      default:
        if (errorMessage.includes('không được phép')) {
          this.error = errorMessage;
        } else {
          this.error = 'Đăng nhập thất bại. Vui lòng thử lại.';
        }
    }
  }
}
