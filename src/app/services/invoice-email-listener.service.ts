import { Injectable, OnDestroy, inject } from '@angular/core';
import { Subject, Subscription, interval } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import { GmailService, GmailEmail } from './gmail.service';

/**
 * Polls for new invoice emails every 3 minutes.
 * Emits on newInvoiceEmail$ when new emails are detected.
 */
@Injectable({ providedIn: 'root' })
export class InvoiceEmailListenerService implements OnDestroy {
  private readonly POLL_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes
  private readonly STORAGE_KEY = 'invoice_email_last_seen';

  private pollSub: Subscription | null = null;
  private gmailService = inject(GmailService);

  /** Emits when a new invoice email is detected */
  newInvoiceEmail$ = new Subject<{ subject: string; from: string; emailId: string }>();

  /**
   * Start polling for new emails.
   * Check Gmail token status first - skip polling if no tokens.
   * @param labelId Optional Gmail label ID to filter by
   */
  startListening(labelId?: string): void {
    this.stopListening();

    // Check if Gmail tokens exist before starting poll
    this.gmailService.checkAuthStatus().subscribe(status => {
      if (!status.hasTokens) {
        console.log('ℹ️ [InvoiceEmailListener] No Gmail tokens - skipping email poll');
        return;
      }

      // Poll immediately, then every POLL_INTERVAL_MS
      this.checkForNewEmails(labelId);

      this.pollSub = interval(this.POLL_INTERVAL_MS).pipe(
        switchMap(() => {
          return this.gmailService.listEmails(labelId, 1); // last 1 day
        }),
        catchError((err, caught) => {
          console.error('Invoice email poll error:', err);
          return caught; // re-subscribe on error
        })
      ).subscribe(emails => {
        this.processNewEmails(emails);
      });
    });
  }

  stopListening(): void {
    this.pollSub?.unsubscribe();
    this.pollSub = null;
  }

  ngOnDestroy(): void {
    this.stopListening();
    this.newInvoiceEmail$.complete();
  }

  private checkForNewEmails(labelId?: string): void {
    this.gmailService.listEmails(labelId, 1).subscribe({
      next: emails => this.processNewEmails(emails),
      error: err => console.warn('Invoice email check skipped:', err.message || err)
    });
  }

  private processNewEmails(emails: GmailEmail[]): void {
    if (!emails?.length) return;

    const lastSeen = parseInt(localStorage.getItem(this.STORAGE_KEY) || '0', 10);
    const newestDate = Math.max(...emails.map(e => e.internal_date));

    // Find emails newer than last seen
    const newEmails = emails.filter(e => e.internal_date > lastSeen);

    if (newEmails.length > 0) {
      // Update last seen
      localStorage.setItem(this.STORAGE_KEY, newestDate.toString());

      // Emit the most recent new email
      const latest = newEmails[0];
      this.newInvoiceEmail$.next({
        subject: latest.subject,
        from: latest.from_address,
        emailId: latest.gmail_id
      });
    }
  }
}