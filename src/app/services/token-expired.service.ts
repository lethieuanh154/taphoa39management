import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Subject } from 'rxjs';

export interface TokenExpiredEvent {
  type: 'kiotviet' | 'firebase' | 'refresh';
  message: string;
  timestamp: Date;
}

@Injectable({
  providedIn: 'root'
})
export class TokenExpiredService {
  private tokenExpiredSubject = new Subject<TokenExpiredEvent>();
  public tokenExpired$ = this.tokenExpiredSubject.asObservable();

  private showExpiredDialogSubject = new BehaviorSubject<boolean>(false);
  public showExpiredDialog$ = this.showExpiredDialogSubject.asObservable();

  private expiredMessage = new BehaviorSubject<string>('');
  public expiredMessage$ = this.expiredMessage.asObservable();

  private isRedirecting = false;

  constructor(private router: Router) {}

  emitTokenExpired(type: 'kiotviet' | 'firebase' | 'refresh', customMessage?: string): void {
    if (this.isRedirecting) return;

    const messages: Record<string, string> = {
      kiotviet: 'Phiên đăng nhập KiotViet đã hết hạn. Vui lòng đăng nhập lại.',
      firebase: 'Phiên đăng nhập Google đã hết hạn. Vui lòng đăng nhập lại.',
      refresh: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại để tiếp tục.'
    };

    const event: TokenExpiredEvent = {
      type,
      message: customMessage || messages[type],
      timestamp: new Date()
    };

    this.tokenExpiredSubject.next(event);
    this.expiredMessage.next(event.message);
    this.showExpiredDialogSubject.next(true);
  }

  redirectToLogin(clearTokens: boolean = true): void {
    if (this.isRedirecting) return;

    this.isRedirecting = true;
    this.showExpiredDialogSubject.next(false);

    if (clearTokens) {
      this.clearAllTokens();
    }

    const currentUrl = this.router.url;
    this.router.navigate(['/login'], {
      queryParams: {
        returnUrl: currentUrl !== '/login' ? currentUrl : undefined,
        reason: 'token_expired'
      }
    }).then(() => {
      this.isRedirecting = false;
    });
  }

  private clearAllTokens(): void {
    ['taphoa39_refresh_token', 'kv_access_token', 'kv_retailer', 'kv_branch_id']
      .forEach(key => localStorage.removeItem(key));
  }

  dismissDialog(): void {
    this.showExpiredDialogSubject.next(false);
  }

  reset(): void {
    this.isRedirecting = false;
    this.showExpiredDialogSubject.next(false);
    this.expiredMessage.next('');
  }
}
