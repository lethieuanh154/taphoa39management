import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, BehaviorSubject } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import {
  ProcessedInvoice,
  ProcessingResult,
  ProcessingStep,
  ProcessingLogEntry
} from '../models/processed-invoice.model';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class InvoiceProcessingService {

  // Backend API endpoints — Management dùng /api/v1/ (Nginx chỉ proxy /api/)
  private readonly PROCESS_INVOICE_URL = `${environment.domainUrl}/api/v1/process-invoice`;
  private readonly PROCESS_IMAGE_URL = `${environment.domainUrl}/api/v1/process-image`;
  private readonly HEALTH_URL = `${environment.domainUrl}/api/v1/health`;

  // Processing steps observable (OCR disabled, direct Gemini)
  private processingStepsSubject = new BehaviorSubject<ProcessingStep[]>([
    { id: 1, label: 'Upload File', status: 'pending' },
    { id: 2, label: 'Gemini Flash', status: 'pending' },
    { id: 3, label: 'Validation', status: 'pending' },
    { id: 4, label: 'Hoàn thành', status: 'pending' }
  ]);

  processingSteps$ = this.processingStepsSubject.asObservable();

  constructor(private http: HttpClient) {}

  /**
   * Reset processing steps to initial state
   */
  resetProcessingSteps(): void {
    this.processingStepsSubject.next([
      { id: 1, label: 'Upload File', status: 'pending' },
      { id: 2, label: 'Gemini Flash', status: 'pending' },
      { id: 3, label: 'Validation', status: 'pending' },
      { id: 4, label: 'Hoàn thành', status: 'pending' }
    ]);
  }

  /**
   * Update a specific step's status
   */
  private updateStep(stepId: number, status: ProcessingStep['status'], message?: string): void {
    const currentSteps = this.processingStepsSubject.value;
    const updatedSteps = currentSteps.map(step =>
      step.id === stepId ? { ...step, status, message } : step
    );
    this.processingStepsSubject.next(updatedSteps);
  }

  /**
   * Add Gemini Pro step when needed
   */
  private addGeminiProStep(): void {
    const currentSteps = this.processingStepsSubject.value;
    const hasProStep = currentSteps.some(s => s.label === 'Gemini Pro');

    if (!hasProStep) {
      const updatedSteps = [
        ...currentSteps.slice(0, 2),
        { id: 3, label: 'Gemini Pro', status: 'pending' as const },
        { id: 4, label: 'Validation', status: 'pending' as const },
        { id: 5, label: 'Hoàn thành', status: 'pending' as const }
      ];
      this.processingStepsSubject.next(updatedSteps);
    }
  }

  /**
   * Update steps from backend processing log
   */
  private updateStepsFromLog(log: ProcessingLogEntry[]): void {
    if (!log || log.length === 0) return;

    // Map backend step names to frontend step labels
    const stepMapping: { [key: string]: string } = {
      'flash': 'Gemini Flash',
      'validate': 'Validation',
      'pro': 'Gemini Pro'
    };

    // Check if Pro step was used
    const usedPro = log.some(entry => entry.step === 'pro');
    if (usedPro) {
      this.addGeminiProStep();
    }

    const currentSteps = this.processingStepsSubject.value;

    log.forEach(entry => {
      const label = stepMapping[entry.step];
      if (label) {
        const step = currentSteps.find(s => s.label === label);
        if (step) {
          this.updateStep(step.id, entry.status, entry.message);
        }
      }
    });
  }

  /**
   * Main processing flow - calls Backend unified endpoint
   * Backend handles: OCR -> Gemini Flash -> Validate -> Gemini Pro (if needed)
   */
  processInvoice(file: File): Observable<ProcessingResult> {
    this.resetProcessingSteps();
    this.updateStep(1, 'completed', 'File uploaded successfully');
    this.updateStep(2, 'processing', 'Đang đọc PDF với Gemini Flash...');

    const formData = new FormData();
    formData.append('file', file);

    return this.http.post<ProcessingResult>(this.PROCESS_INVOICE_URL, formData).pipe(
      tap(result => {
        // Update steps from backend processing log
        if (result.processing_log) {
          this.updateStepsFromLog(result.processing_log);
        }

        // Update final step based on result
        if (result.success) {
          const lastStepId = result.processing_method === 'pro' ? 5 : 4;
          this.updateStep(lastStepId, 'completed', 'Xử lý hoàn tất');
        }
      }),
      catchError(error => {
        console.error('Invoice processing error:', error);

        // Update steps to show error
        this.updateStep(2, 'error', 'Lỗi kết nối server');

        return of({
          success: false,
          error: error.message || 'Không thể kết nối đến server. Vui lòng kiểm tra backend.',
          processing_method: 'flash' as const
        });
      })
    );
  }

  /**
   * Process image file (JPG/PNG/PDF) for Clone product extraction.
   * Uses backend /v1/process-image which ignores handwritten text.
   */
  processImage(file: File): Observable<ProcessingResult> {
    this.resetProcessingSteps();
    this.updateStep(1, 'completed', 'File uploaded successfully');
    this.updateStep(2, 'processing', 'Đang đọc ảnh với Gemini Flash...');

    const formData = new FormData();
    formData.append('file', file);

    return this.http.post<ProcessingResult>(this.PROCESS_IMAGE_URL, formData).pipe(
      tap(result => {
        if (result.processing_log) {
          this.updateStepsFromLog(result.processing_log);
        }
        if (result.success) {
          const lastStepId = result.processing_method === 'pro' ? 5 : 4;
          this.updateStep(lastStepId, 'completed', 'Xử lý hoàn tất');
        }
      }),
      catchError(error => {
        console.error('Image processing error:', error);
        this.updateStep(2, 'error', 'Lỗi kết nối server');
        return of({
          success: false,
          error: error.message || 'Không thể kết nối đến server.',
          processing_method: 'flash' as const
        });
      })
    );
  }

  /**
   * Check backend health status
   */
  checkHealth(): Observable<{ status: string; ocr_available: boolean; version: string }> {
    return this.http.get<{ status: string; ocr_available: boolean; version: string }>(
      this.HEALTH_URL
    ).pipe(
      catchError(error => {
        console.error('Health check error:', error);
        return of({ status: 'unhealthy', ocr_available: false, version: 'unknown' });
      })
    );
  }

  /**
   * Format currency for display
   */
  formatCurrency(value: number): string {
    return new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency: 'VND'
    }).format(value);
  }

  /**
   * Export invoice to JSON file
   */
  exportToJson(invoice: ProcessedInvoice): void {
    const dataStr = JSON.stringify(invoice, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `invoice_${invoice.invoice_metadata.invoice_no}_${new Date().getTime()}.json`;
    link.click();

    URL.revokeObjectURL(url);
  }
}
