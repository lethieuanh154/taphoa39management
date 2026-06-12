import { Injectable, inject, NgZone } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Auth } from '@angular/fire/auth';
import { Observable, of, Subject } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface GmailLabel {
  id: string;
  name: string;
  type: string;
}

export interface GmailEmail {
  gmail_id: string;
  from_address: string;
  from_domain: string;
  subject: string;
  date: string;
  snippet: string;
  attachments: string[];
  internal_date: number;
}

export interface EmailProcessResult {
  success: boolean;
  type: 'xml' | 'zip_xml' | 'zip_pdf' | 'pdf' | 'portal_xml' | 'none';
  invoices?: any[];
  parse_errors?: string[];
  needs_gemini?: boolean;
  pdf_base64?: string;
  pdf_filename?: string;
  source_file?: string;
  message?: string;
  email?: GmailEmail;
  error?: string;
  // Portal URL fields (extracted from email body)
  portalUrl?: string;
  invoiceProvider?: string;
  portalPdfUrl?: string;
  portalCredentials?: Record<string, string>;
}

@Injectable({ providedIn: 'root' })
export class GmailService {
  private readonly BASE_URL = `${environment.domainUrl}/api/gmail`;
  private auth = inject(Auth);
  private http = inject(HttpClient);
  private ngZone = inject(NgZone);

  /** Emits when Gmail OAuth is completed successfully (popup closes) */
  gmailAuthSuccess$ = new Subject<void>();

  private messageListener: ((event: MessageEvent) => void) | null = null;

  constructor() {
    // Listen for postMessage from OAuth callback popup
    this.messageListener = (event: MessageEvent) => {
      if (event.data?.type === 'GMAIL_AUTH_SUCCESS') {
        this.ngZone.run(() => this.gmailAuthSuccess$.next());
      }
    };
    window.addEventListener('message', this.messageListener);
  }

  private getUid(): string | null {
    return this.auth.currentUser?.uid || null;
  }

  listLabels(): Observable<GmailLabel[]> {
    const uid = this.getUid();
    if (!uid) return of([]);
    return this.http.get<{ success: boolean; labels: GmailLabel[] }>(
      `${this.BASE_URL}/labels`, { params: { uid } }
    ).pipe(
      map(res => res.success ? res.labels : []),
      catchError(err => {
        this.handleGmailError(err);
        return of([]);
      })
    );
  }

  listEmails(labelId?: string, daysBack: number = 2): Observable<GmailEmail[]> {
    const uid = this.getUid();
    if (!uid) return of([]);
    const params: any = { uid, days_back: daysBack.toString() };
    if (labelId) params.label_id = labelId;

    return this.http.get<{ success: boolean; emails: GmailEmail[]; total: number }>(
      `${this.BASE_URL}/emails`, { params }
    ).pipe(
      map(res => res.success ? res.emails : []),
      catchError(err => {
        this.handleGmailError(err);
        return of([]);
      })
    );
  }

  processEmail(emailId: string): Observable<EmailProcessResult> {
    const uid = this.getUid();
    if (!uid) return of({ success: false, type: 'none' as const, error: 'User not authenticated' });
    return this.http.post<EmailProcessResult>(
      `${this.BASE_URL}/emails/${emailId}/process`,
      { uid }
    ).pipe(
      catchError(err => {
        console.error('Error processing email:', err);
        return of({
          success: false,
          type: 'none' as const,
          error: err.message || 'Lỗi xử lý email'
        });
      })
    );
  }

  /**
   * Open OAuth popup to connect/reconnect Gmail with refresh_token.
   * Returns a promise that resolves when the popup flow completes.
   */
  connectGmail(): Promise<boolean> {
    const uid = this.getUid();
    if (!uid) return Promise.resolve(false);

    const email = this.auth.currentUser?.email || '';
    const params: any = { uid };
    if (email) params.login_hint = email;

    return new Promise((resolve) => {
      this.http.get<{ success: boolean; url: string }>(
        `${this.BASE_URL}/auth/url`, { params }
      ).subscribe({
        next: (res) => {
          if (!res.success || !res.url) {
            resolve(false);
            return;
          }

          // Open popup
          const popup = window.open(res.url, 'gmail_auth', 'width=500,height=600,scrollbars=yes');

          // Listen for success message from popup
          const sub = this.gmailAuthSuccess$.subscribe(() => {
            sub.unsubscribe();
            resolve(true);
          });

          // Also check if popup is closed without completing
          const checkClosed = setInterval(() => {
            if (popup?.closed) {
              clearInterval(checkClosed);
              // Give a small delay for the message to arrive
              setTimeout(() => {
                sub.unsubscribe();
                resolve(false);
              }, 500);
            }
          }, 500);
        },
        error: () => resolve(false)
      });
    });
  }

  /**
   * Check if user has valid Gmail tokens (with refresh_token)
   */
  checkAuthStatus(): Observable<{ hasTokens: boolean; hasRefreshToken: boolean }> {
    const uid = this.getUid();
    if (!uid) return of({ hasTokens: false, hasRefreshToken: false });

    return this.http.get<{ success: boolean; hasTokens: boolean; hasRefreshToken: boolean }>(
      `${this.BASE_URL}/auth/status`, { params: { uid } }
    ).pipe(
      map(res => ({
        hasTokens: res.hasTokens || false,
        hasRefreshToken: res.hasRefreshToken || false
      })),
      catchError(() => of({ hasTokens: false, hasRefreshToken: false }))
    );
  }

  /**
   * Check if email has specific attachment types
   */
  static hasXml(email: GmailEmail): boolean {
    return email.attachments.some(a => a.toLowerCase().endsWith('.xml'));
  }

  static hasPdf(email: GmailEmail): boolean {
    return email.attachments.some(a => a.toLowerCase().endsWith('.pdf'));
  }

  static hasZip(email: GmailEmail): boolean {
    return email.attachments.some(a => a.toLowerCase().endsWith('.zip'));
  }

  static getAttachmentBadge(email: GmailEmail): string {
    if (GmailService.hasXml(email)) return 'XML';
    if (GmailService.hasZip(email)) return 'ZIP';
    if (GmailService.hasPdf(email)) return 'PDF';
    return 'LINK';
  }

  private handleGmailError(err: any): void {
    if (err.status === 401 || err.error?.code === 'TOKEN_EXPIRED') {
      // Chỉ log warning, KHÔNG tự mở popup OAuth khi auto-poll
      // User sẽ kết nối lại Gmail thủ công từ trang Kế toán
      console.warn('Gmail token expired. Cần kết nối lại Gmail từ trang Kế toán.');
    } else {
      console.error('Gmail API error:', err);
    }
  }
}
