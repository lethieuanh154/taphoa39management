import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class BackendUrlService {
  private readonly PRIMARY_URL = 'https://taphoa39backend.onrender.com';
  private readonly BACKUP_URL = 'https://api.songminhcr.com';
  private readonly FAILURE_THRESHOLD = 2;
  private readonly HEALTH_CHECK_MS = 60_000;
  private readonly HEALTH_ENDPOINT = '/v1/health';

  /** Failover disabled: localhost (dev) hoặc same-origin (VN server) */
  private readonly failoverDisabled: boolean;
  private useBackup = false;
  private consecutiveFailures = 0;
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private urlChanged$ = new BehaviorSubject<string>(environment.domainUrl);

  constructor() {
    // Failover chỉ hoạt động khi frontend chạy trên Render (anhanhmy39.onrender.com)
    // Localhost (dev) và VN server (songminhcr.com) dùng domainUrl từ environment trực tiếp
    if (!environment.production) {
      this.failoverDisabled = true;
    } else if (typeof window !== 'undefined') {
      const host = window.location.hostname;
      this.failoverDisabled = (host === 'songminhcr.com' || host === '103.173.154.35');
    } else {
      this.failoverDisabled = false;
    }
  }

  getActiveUrl(): string {
    if (this.failoverDisabled) return environment.domainUrl;
    return this.useBackup ? this.BACKUP_URL : this.PRIMARY_URL;
  }

  getUrlChanges$(): Observable<string> {
    return this.urlChanged$.asObservable();
  }

  isUsingBackup(): boolean {
    return this.useBackup;
  }

  reportSuccess(): void {
    if (this.consecutiveFailures > 0) {
      this.consecutiveFailures = 0;
    }
  }

  reportFailure(): boolean {
    if (this.failoverDisabled) return false;

    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.FAILURE_THRESHOLD && !this.useBackup) {
      this.switchToBackup();
      return true; // switched
    }
    return false;
  }

  isBackendUrl(url: string): boolean {
    return url.startsWith(this.PRIMARY_URL) || url.startsWith(this.BACKUP_URL) || url.startsWith('/api/');
  }

  rewriteUrl(url: string): string {
    if (this.failoverDisabled || !this.useBackup) return url;
    if (url.startsWith(this.PRIMARY_URL)) {
      return url.replace(this.PRIMARY_URL, this.BACKUP_URL);
    }
    return url;
  }

  private switchToBackup(): void {
    console.warn('⚠️ [BackendUrl] Render down, switching to backup:', this.BACKUP_URL);
    this.useBackup = true;
    (environment as any).domainUrl = this.BACKUP_URL;
    this.urlChanged$.next(this.BACKUP_URL);
    this.startHealthCheck();
  }

  private switchToPrimary(): void {
    console.log('✅ [BackendUrl] Render recovered, switching back:', this.PRIMARY_URL);
    this.useBackup = false;
    this.consecutiveFailures = 0;
    (environment as any).domainUrl = this.PRIMARY_URL;
    this.urlChanged$.next(this.PRIMARY_URL);
    this.stopHealthCheck();
  }

  private startHealthCheck(): void {
    this.stopHealthCheck();
    this.healthCheckInterval = setInterval(async () => {
      try {
        const resp = await fetch(`${this.PRIMARY_URL}${this.HEALTH_ENDPOINT}`, {
          method: 'GET',
          signal: AbortSignal.timeout(5000)
        });
        if (resp.ok) {
          this.switchToPrimary();
        }
      } catch {
        // primary still down
      }
    }, this.HEALTH_CHECK_MS);
  }

  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }
}
