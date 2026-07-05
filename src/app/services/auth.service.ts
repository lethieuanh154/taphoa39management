import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  Auth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  User,
  onAuthStateChanged,
  onIdTokenChanged
} from '@angular/fire/auth';
import { BehaviorSubject } from 'rxjs';
import { environment } from '../../environments/environment';

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface LoginResponse {
  success: boolean;
  user: {
    uid: string;
    email: string;
    display_name: string;
    photo_url: string;
  };
  refresh_token: string;
  kiotviet: {
    access_token: string;
    retailer: string;
    branch_id: string;
  };
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private auth = inject(Auth);
  private platformId = inject(PLATFORM_ID);

  private authState = new BehaviorSubject<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true
  });

  public authState$ = this.authState.asObservable();

  // Storage keys (same as TapHoa39BanHang for shared session)
  private readonly REFRESH_TOKEN_KEY = 'taphoa39_refresh_token';
  private readonly KV_ACCESS_TOKEN_KEY = 'kv_access_token';
  private readonly KV_RETAILER_KEY = 'kv_retailer';
  private readonly KV_BRANCH_ID_KEY = 'kv_branch_id';

  // Token refresh timer
  private refreshIntervalId: ReturnType<typeof setInterval> | null = null;
  private readonly CHECK_INTERVAL_MS = 2 * 60 * 1000;
  private readonly REFRESH_BUFFER_MS = 5 * 60 * 1000;

  // Concurrency lock
  private refreshPromise: Promise<boolean> | null = null;

  // Firebase ID token cache (gui qua header X-Id-Token cho backend admin-auth)
  private currentIdToken: string | null = null;

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.initAuthListener();
      onIdTokenChanged(this.auth, async (user) => {
        try {
          this.currentIdToken = user ? await user.getIdToken() : null;
        } catch {
          this.currentIdToken = null;
        }
      });
    }
  }

  /** ID token da cache (dong bo) de interceptor gan header X-Id-Token. */
  getCachedIdToken(): string | null {
    return this.currentIdToken;
  }

  private initAuthListener(): void {
    onAuthStateChanged(this.auth, async (user) => {
      if (user) {
        const hasRefreshToken = this.getRefreshToken();
        this.authState.next({
          user,
          isAuthenticated: !!hasRefreshToken,
          isLoading: false
        });
        // Resume token refresh if we have tokens
        if (hasRefreshToken) {
          this.scheduleTokenRefresh();
        }
      } else {
        this.authState.next({
          user: null,
          isAuthenticated: false,
          isLoading: false
        });
      }
    });
  }

  /**
   * Check if email is allowed before completing login
   */
  async verifyEmailAllowed(email: string): Promise<boolean> {
    try {
      const response = await fetch(`${environment.domainUrl}/api/auth/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await response.json();
      return data.allowed === true;
    } catch (error) {
      console.error('Error verifying email:', error);
      return false;
    }
  }

  /**
   * Sign in with Google (same Firebase project as TapHoa39BanHang)
   */
  async signInWithGoogle(): Promise<LoginResponse> {
    const provider = new GoogleAuthProvider();

    try {
      const result = await signInWithPopup(this.auth, provider);
      const user = result.user;

      // Check if email is allowed
      const isAllowed = await this.verifyEmailAllowed(user.email || '');
      if (!isAllowed) {
        await signOut(this.auth);
        throw new Error('Email không được phép đăng nhập');
      }

      // Get Firebase ID token
      const idToken = await user.getIdToken();

      // Exchange Firebase token for app tokens (same backend endpoint as BanHang)
      const response = await fetch(`${environment.domainUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_token: idToken })
      });

      if (!response.ok) {
        const error = await response.json();
        await signOut(this.auth);
        throw new Error(error.error || 'Login failed');
      }

      const loginData: LoginResponse = await response.json();

      // Store tokens
      this.storeTokens(loginData);

      // Update auth state
      this.authState.next({
        user,
        isAuthenticated: true,
        isLoading: false
      });

      return loginData;
    } catch (error: any) {
      console.error('Google Sign-In error:', error);
      throw error;
    }
  }

  private storeTokens(loginData: LoginResponse): void {
    if (!isPlatformBrowser(this.platformId)) return;

    localStorage.setItem(this.REFRESH_TOKEN_KEY, loginData.refresh_token);
    localStorage.setItem(this.KV_ACCESS_TOKEN_KEY, loginData.kiotviet.access_token);
    localStorage.setItem(this.KV_RETAILER_KEY, loginData.kiotviet.retailer);
    localStorage.setItem(this.KV_BRANCH_ID_KEY, loginData.kiotviet.branch_id);

    this.scheduleTokenRefresh();
  }

  getRefreshToken(): string | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    return localStorage.getItem(this.REFRESH_TOKEN_KEY);
  }

  getKiotVietToken(): string | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    return localStorage.getItem(this.KV_ACCESS_TOKEN_KEY);
  }

  /**
   * Refresh KiotViet token with concurrency lock
   */
  async refreshKiotVietToken(): Promise<boolean> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this._doRefresh();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async _doRefresh(): Promise<boolean> {
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) return false;

    try {
      const response = await fetch(`${environment.domainUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken })
      });

      if (!response.ok) {
        if (response.status === 401) {
          console.error('❌ [AuthService] Refresh token invalid, logging out');
          await this.logout();
          return false;
        }
        console.warn(`⚠️ [AuthService] Refresh failed with status ${response.status}`);
        return false;
      }

      const data = await response.json();

      if (isPlatformBrowser(this.platformId)) {
        localStorage.setItem(this.KV_ACCESS_TOKEN_KEY, data.kiotviet.access_token);
        localStorage.setItem(this.KV_RETAILER_KEY, data.kiotviet.retailer);
        localStorage.setItem(this.KV_BRANCH_ID_KEY, data.kiotviet.branch_id);
      }

      return true;
    } catch (error) {
      console.warn('⚠️ [AuthService] Network error during refresh:', error);
      return false;
    }
  }

  async getIdToken(): Promise<string | null> {
    const user = this.auth.currentUser;
    if (!user) return null;
    return await user.getIdToken();
  }

  scheduleTokenRefresh(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    this.stopTokenRefreshInterval();

    const token = this.getKiotVietToken();
    if (!token) return;

    const delayMs = this.getTimeUntilRefresh(token);
    if (delayMs <= 0) {
      this.refreshKiotVietToken();
    }

    this.refreshIntervalId = setInterval(() => {
      const currentToken = this.getKiotVietToken();
      if (!currentToken) {
        this.stopTokenRefreshInterval();
        return;
      }
      if (this.getTimeUntilRefresh(currentToken) <= 0) {
        this.refreshKiotVietToken();
      }
    }, this.CHECK_INTERVAL_MS);
  }

  private stopTokenRefreshInterval(): void {
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
      this.refreshIntervalId = null;
    }
  }

  private getTimeUntilRefresh(token: string): number {
    try {
      const payload = token.split('.')[1];
      const decoded = JSON.parse(atob(payload));

      if (decoded.exp) {
        return Math.max(0, decoded.exp * 1000 - this.REFRESH_BUFFER_MS - Date.now());
      }
      if (decoded.iat) {
        return Math.max(0, (decoded.iat + 3600) * 1000 - this.REFRESH_BUFFER_MS - Date.now());
      }
      return 50 * 60 * 1000;
    } catch {
      return 0;
    }
  }

  async logout(): Promise<void> {
    this.stopTokenRefreshInterval();

    const refreshToken = this.getRefreshToken();

    if (refreshToken) {
      try {
        await fetch(`${environment.domainUrl}/api/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken })
        });
      } catch (error) {
        console.error('Error revoking token:', error);
      }
    }

    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem(this.REFRESH_TOKEN_KEY);
      localStorage.removeItem(this.KV_ACCESS_TOKEN_KEY);
      localStorage.removeItem(this.KV_RETAILER_KEY);
      localStorage.removeItem(this.KV_BRANCH_ID_KEY);
    }

    await signOut(this.auth);

    this.authState.next({
      user: null,
      isAuthenticated: false,
      isLoading: false
    });
  }

  isAuthenticated(): boolean {
    return this.authState.value.isAuthenticated;
  }
}
