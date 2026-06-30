import { Component, OnInit, OnDestroy, ViewEncapsulation, ViewChild, Inject, Optional, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, FormArray } from '@angular/forms';

// Angular Material
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTableModule, MatTable } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatSelectModule } from '@angular/material/select';

import { Subject, firstValueFrom } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { HttpClient } from '@angular/common/http';
import { InvoiceProcessingService } from '../../../services/invoice-processing.service';
import { InvoiceServiceV2, AiInvoiceData, RecentAiInvoice } from '../../../services/invoice.service.v2';
import { RecentInvoicesDialogComponent } from './recent-invoices-dialog.component';
import { GmailService, GmailLabel, GmailEmail, EmailProcessResult } from '../../../services/gmail.service';
import { FuzzyMatchService, MatchResult } from '../../../services/fuzzy-match.service';
import { ProductService } from '../../../services/product.service';
import { InvoicePriceUpdateService, InvoiceItemForUpdate } from './invoice-price-update.service';
import { InvoiceProductMappingService, InvoiceProductMapping } from './invoice-product-mapping.service';
import { MatchReviewDialogComponent, MatchReviewItem, MatchReviewResult } from './match-review-dialog.component';
import { UnitRenameConfirmDialogComponent, UnitRenameCandidate, UnitRenameConfirmResult } from './unit-rename-confirm-dialog.component';
import { environment } from '../../../../environments/environment';
import {
  ProcessedInvoice,
  InvoiceItem,
  ProcessingStep,
  ValidationError,
  ProcessingResult
} from '../../../models/processed-invoice.model';

@Component({
  selector: 'app-invoice-processing-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatTableModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTooltipModule,
    MatDividerModule,
    MatDialogModule,
    MatSelectModule
  ],
  templateUrl: './invoice-processing-page.component.html',
  styleUrls: ['./invoice-processing-page.component.css'],
  encapsulation: ViewEncapsulation.None
})
export class InvoiceProcessingDialogComponent implements OnInit, OnDestroy {

  // XML file handling
  selectedFile: File | null = null;
  isDragOver = false;

  // PDF file handling
  selectedPdfFile: File | null = null;
  isPdfDragOver = false;

  // Processing state
  isProcessing = false;
  processingSteps: ProcessingStep[] = [];
  currentStepIndex = 0;

  // Results
  processingResult: ProcessingResult | null = null;
  validationErrors: ValidationError[] = [];

  // Flag for saving to Firestore
  isSavingToFirestore = false;
  savedToFirestore = false;

  // Form for display (read-only in dialog mode)
  invoiceForm!: FormGroup;

  // Table columns - with matched product column + actions
  displayedColumns: string[] = ['select', 'stt', 'description', 'unit', 'quantity', 'unit_price', 'amount', 'amount_after_vat', 'actions'];

  // === Tabs ===
  activeTab: 'upload' | 'pdf' | 'email' | 'clone_image' = 'upload';
  gmailLabels: GmailLabel[] = [];
  filteredLabels: GmailLabel[] = [];
  labelSearchText = '';
  gmailEmails: GmailEmail[] = [];
  selectedLabelId = '';
  isLoadingEmails = false;
  isLoadingLabels = false;
  showManualXmlImport = false;
  gmailConnected = false;

  // === Email metadata (for saving to Firestore) ===
  private currentEmailId = '';
  private currentEmailFrom = '';
  private currentEmailDate = '';
  private currentPortalUrl = '';
  private currentPortalPdfUrl = '';
  private currentInvoiceProvider = '';
  private currentPortalCredentials: Record<string, string> = {};
  private currentAttachmentType = '';

  // === Clone Image ===
  selectedCloneImageFile: File | null = null;
  isCloneDragOver = false;
  isCloneMode = false; // true when processing clone image

  // === Item Selection (checkbox) ===
  selectedItems: Set<number> = new Set();

  // === Fuzzy Match ===
  matchedProducts: Map<number, MatchResult[]> = new Map();
  userSelectedMatch: Map<number, MatchResult> = new Map();
  isMatching = false;
  private matchingCancelled = false;

  // === Per-tab state storage (prevent data bleed between tabs) ===
  private tabStates: Map<string, {
    processingResult: ProcessingResult | null;
    validationErrors: ValidationError[];
    matchedProducts: Map<number, MatchResult[]>;
    userSelectedMatch: Map<number, MatchResult>;
    savedToFirestore: boolean;
  }> = new Map();

  private http = inject(HttpClient);
  private gmailService = inject(GmailService);
  private fuzzyMatchService = inject(FuzzyMatchService);
  private productService = inject(ProductService);
  private priceUpdateService = inject(InvoicePriceUpdateService);
  private mappingService = inject(InvoiceProductMappingService);

  @ViewChild(MatTable) private itemsTable?: MatTable<any>;

  private destroy$ = new Subject<void>();

  constructor(
    private invoiceProcessingService: InvoiceProcessingService,
    private invoiceService: InvoiceServiceV2,
    private fb: FormBuilder,
    private snackBar: MatSnackBar,
    private dialog: MatDialog,
    @Optional() public dialogRef: MatDialogRef<InvoiceProcessingDialogComponent>,
    @Optional() @Inject(MAT_DIALOG_DATA) public data: any
  ) {}

  ngOnInit(): void {
    this.initForm();
    this.loadCache();

    // Pre-load Gmail labels so Email tab is ready without manual refresh
    this.loadLabels();

    // Subscribe to processing steps (for PDF tab stepper)
    this.invoiceProcessingService.processingSteps$
      .pipe(takeUntil(this.destroy$))
      .subscribe(steps => {
        this.processingSteps = steps;
        const processingIndex = steps.findIndex(s => s.status === 'processing');
        this.currentStepIndex = processingIndex !== -1 ? processingIndex : steps.filter(s => s.status === 'completed').length;
      });
  }

  ngOnDestroy(): void {
    this.matchingCancelled = true;
    this.saveCache();
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Initialize the reactive form
   */
  private initForm(): void {
    this.invoiceForm = this.fb.group({
      invoice_metadata: this.fb.group({
        invoice_date: [''],
        invoice_no: [''],
        invoice_serial: [''],
        tax_authority_code: ['']
      }),
      seller: this.fb.group({
        company_name: [''],
        tax_code: [''],
        address: ['']
      }),
      buyer: this.fb.group({
        company_name: [''],
        tax_code: [''],
        address: ['']
      }),
      items: this.fb.array([]),
      summary: this.fb.group({
        total_amount_before_vat: [0],
        vat_rate: ['10%'],
        vat_amount: [0],
        total_payment: [0],
        total_payment_in_words: ['']
      })
    });
  }

  /**
   * Get items FormArray
   */
  get itemsFormArray(): FormArray {
    return this.invoiceForm.get('items') as FormArray;
  }

  /**
   * Create a new item FormGroup
   */
  private createItemFormGroup(item?: InvoiceItem): FormGroup {
    const amount = item?.amount || 0;
    const vatAmount = item?.vat_amount || 0;
    return this.fb.group({
      stt: [item?.stt || this.itemsFormArray.length + 1],
      description: [item?.description || ''],
      unit: [item?.unit || ''],
      quantity: [item?.quantity || 0],
      unit_price: [item?.unit_price || 0],
      amount: [amount],
      vat_amount: [vatAmount],
      amount_after_vat: [item?.amount_after_vat != null ? item.amount_after_vat : (amount + vatAmount)]
    });
  }

  // =============================================================
  // TAB SWITCHING (isolate state per tab)
  // =============================================================

  switchTab(tab: 'upload' | 'pdf' | 'email' | 'clone_image'): void {
    if (tab === this.activeTab) return;

    // Save current tab state
    this.tabStates.set(this.activeTab, {
      processingResult: this.processingResult,
      validationErrors: [...this.validationErrors],
      matchedProducts: new Map(this.matchedProducts),
      userSelectedMatch: new Map(this.userSelectedMatch),
      savedToFirestore: this.savedToFirestore
    });

    // Switch tab
    this.activeTab = tab;
    this.isCloneMode = tab === 'clone_image';

    // Restore target tab state (or reset)
    const savedState = this.tabStates.get(tab);
    if (savedState) {
      this.processingResult = savedState.processingResult;
      this.validationErrors = savedState.validationErrors;
      this.matchedProducts = savedState.matchedProducts;
      this.userSelectedMatch = savedState.userSelectedMatch;
      this.savedToFirestore = savedState.savedToFirestore;

      if (savedState.processingResult?.invoice) {
        this.populateForm(savedState.processingResult.invoice);
      } else {
        this.resetForm();
      }
    } else {
      // No saved state for this tab - reset
      this.processingResult = null;
      this.validationErrors = [];
      this.matchedProducts.clear();
      this.userSelectedMatch.clear();
      this.savedToFirestore = false;
      this.resetForm();
    }

    // Tab-specific actions
    if (tab === 'email') {
      this.loadLabels();
    }
  }

  /**
   * Handle drag over event
   */
  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver = true;
  }

  /**
   * Handle drag leave event
   */
  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver = false;
  }

  /**
   * Handle file drop
   */
  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver = false;

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.handleFile(files[0]);
    }
  }

  /**
   * Handle file input change
   */
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.handleFile(input.files[0]);
    }
  }

  /**
   * Validate and set selected file
   */
  private handleFile(file: File): void {
    // Check file type
    if (!file.name.toLowerCase().endsWith('.xml')) {
      this.snackBar.open('Vui lòng chọn file XML', 'Đóng', {
        duration: 3000,
        panelClass: 'error-snackbar'
      });
      return;
    }

    // Check file size (max 10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      this.snackBar.open('File quá lớn. Vui lòng chọn file dưới 10MB', 'Đóng', {
        duration: 3000,
        panelClass: 'error-snackbar'
      });
      return;
    }

    this.selectedFile = file;
    this.processingResult = null;
    this.validationErrors = [];
    this.resetForm();
  }

  /**
   * Reset form to initial state
   */
  private resetForm(): void {
    this.initForm();
  }

  /**
   * Start processing the selected XML file
   */
  processFile(): void {
    if (!this.selectedFile) {
      this.snackBar.open('Vui lòng chọn file trước', 'Đóng', {
        duration: 3000,
        panelClass: 'error-snackbar'
      });
      return;
    }

    this.isProcessing = true;

    const formData = new FormData();
    formData.append('file', this.selectedFile);

    this.http.post<any>(`${environment.domainUrl}/api/v1/parse-xml`, formData)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (result) => {
          this.isProcessing = false;

          if (result.success && result.invoices?.length > 0) {
            this.populateFormFromXmlInvoice(result.invoices[0]);
            this.saveCache();
            this.snackBar.open(
              'Đọc XML thành công!',
              'Đóng',
              { duration: 3000, panelClass: 'success-snackbar' }
            );
          } else {
            this.snackBar.open(
              result.error || 'Không thể đọc dữ liệu từ file XML',
              'Đóng',
              { duration: 5000, panelClass: 'error-snackbar' }
            );
          }
        },
        error: (error) => {
          this.isProcessing = false;
          console.error('XML parse error:', error);
          this.snackBar.open(
            error.error?.error || 'Có lỗi xảy ra khi đọc file XML',
            'Đóng',
            { duration: 5000, panelClass: 'error-snackbar' }
          );
        }
      });
  }

  // =============================================================
  // PDF TAB METHODS
  // =============================================================

  onPdfDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isPdfDragOver = true;
  }

  onPdfDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isPdfDragOver = false;
  }

  onPdfDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isPdfDragOver = false;
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.handlePdfFile(files[0]);
    }
  }

  onPdfFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.handlePdfFile(input.files[0]);
    }
  }

  private handlePdfFile(file: File): void {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!allowedTypes.includes(file.type)) {
      this.snackBar.open('Vui lòng chọn file PDF, JPG hoặc PNG', 'Đóng', { duration: 3000, panelClass: 'error-snackbar' });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      this.snackBar.open('File quá lớn. Vui lòng chọn file dưới 10MB', 'Đóng', { duration: 3000, panelClass: 'error-snackbar' });
      return;
    }
    this.selectedPdfFile = file;
    this.processingResult = null;
    this.validationErrors = [];
    this.resetForm();
  }

  processPdfFile(): void {
    if (!this.selectedPdfFile) {
      this.snackBar.open('Vui lòng chọn file PDF trước', 'Đóng', { duration: 3000, panelClass: 'error-snackbar' });
      return;
    }

    this.isProcessing = true;
    this.invoiceProcessingService.resetProcessingSteps();

    this.invoiceProcessingService.processInvoice(this.selectedPdfFile)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (result) => {
          this.isProcessing = false;
          this.processingResult = result;

          if (result.success && result.invoice) {
            this.populateForm(result.invoice);
            this.validationErrors = result.validation_errors || [];
            this.mergePromotionalItems();
            this.saveCache();

            const methodLabel = result.processing_method === 'flash' ? 'Gemini Flash' : 'Gemini Pro';
            this.snackBar.open(`Xử lý thành công với ${methodLabel}!`, 'Đóng', { duration: 3000, panelClass: 'success-snackbar' });
          } else {
            this.snackBar.open(result.error || 'Có lỗi xảy ra khi xử lý hóa đơn', 'Đóng', { duration: 5000, panelClass: 'error-snackbar' });
          }
        },
        error: () => {
          this.isProcessing = false;
          this.snackBar.open('Có lỗi xảy ra khi xử lý hóa đơn', 'Đóng', { duration: 5000, panelClass: 'error-snackbar' });
        }
      });
  }

  clearPdf(): void {
    this.selectedPdfFile = null;
    this.processingResult = null;
    this.validationErrors = [];
    this.clearCache();
    this.invoiceProcessingService.resetProcessingSteps();
    this.resetForm();
  }

  /**
   * Populate form with extracted invoice data
   */
  private populateForm(invoice: ProcessedInvoice): void {
    // Clear existing items
    while (this.itemsFormArray.length > 0) {
      this.itemsFormArray.removeAt(0);
    }

    // Add items
    invoice.items.forEach(item => {
      this.itemsFormArray.push(this.createItemFormGroup(item));
    });

    // Patch other values
    this.invoiceForm.patchValue({
      invoice_metadata: invoice.invoice_metadata,
      seller: invoice.seller,
      buyer: invoice.buyer,
      summary: invoice.summary
    });
  }

  getStepIcon(step: ProcessingStep): string {
    switch (step.status) {
      case 'completed': return 'check_circle';
      case 'processing': return 'hourglass_empty';
      case 'error': return 'error';
      default: return 'radio_button_unchecked';
    }
  }

  getStepClass(step: ProcessingStep): string {
    return `step-${step.status}`;
  }

  /**
   * Clear all and start over
   */
  clearAll(): void {
    this.selectedFile = null;
    this.processingResult = null;
    this.validationErrors = [];
    this.selectedItems.clear();
    this.clearCache();
    this.resetForm();
  }

  clearSavedData(): void {
    this.clearAll();
  }

  // =============================================================
  // SESSION CACHE (persist invoice data across dialog open/close)
  // =============================================================

  private readonly CACHE_KEY = 'invoice_processing_cache';

  private saveCache(): void {
    if (!this.processingResult?.invoice) return;
    try {
      // Serialize Maps to arrays for JSON storage
      const matchedArr: [number, MatchResult[]][] = Array.from(this.matchedProducts.entries());
      const selectedArr: [number, MatchResult][] = Array.from(this.userSelectedMatch.entries());

      const cache = {
        processingResult: this.processingResult,
        validationErrors: this.validationErrors,
        savedToFirestore: this.savedToFirestore,
        activeTab: this.activeTab,
        isCloneMode: this.isCloneMode,
        matchedProducts: matchedArr,
        userSelectedMatch: selectedArr,
        matchingComplete: !this.isMatching
      };
      sessionStorage.setItem(this.CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
      console.warn('Failed to save invoice cache:', e);
    }
  }

  private loadCache(): boolean {
    try {
      const raw = sessionStorage.getItem(this.CACHE_KEY);
      if (!raw) return false;

      const cache = JSON.parse(raw);
      if (!cache?.processingResult?.invoice) return false;

      // Restore tab state first to ensure correct matching mode
      this.activeTab = cache.activeTab || 'upload';
      this.isCloneMode = cache.isCloneMode || false;

      this.processingResult = cache.processingResult;
      this.validationErrors = cache.validationErrors || [];
      this.savedToFirestore = cache.savedToFirestore || false;
      this.populateForm(cache.processingResult.invoice);

      // Restore cached match results if available
      const hasMatchCache = cache.matchedProducts?.length > 0 && cache.matchingComplete;
      if (hasMatchCache) {
        this.matchedProducts = new Map(cache.matchedProducts);
        this.userSelectedMatch = new Map(cache.userSelectedMatch || []);
        console.log('[CACHE] Restored match results:', this.matchedProducts.size, 'items');
      }
      return true;
    } catch (e) {
      console.warn('Failed to load invoice cache:', e);
      return false;
    }
  }

  private clearCache(): void {
    sessionStorage.removeItem(this.CACHE_KEY);
  }

  /**
   * Format currency for display
   */
  formatCurrency(value: number): string {
    return this.invoiceProcessingService.formatCurrency(value);
  }

  /**
   * Check if field has validation error
   */
  hasValidationError(fieldPath: string): boolean {
    return this.validationErrors.some(e => e.field === fieldPath);
  }

  /**
   * Get validation error message for field
   */
  getValidationError(fieldPath: string): string | null {
    const error = this.validationErrors.find(e => e.field === fieldPath);
    return error ? error.message : null;
  }

  /**
   * Update prices: close dialog and pass data back to edit-product-page
   */
  async updatePrices(): Promise<void> {
    if (!this.processingResult?.invoice?.items || this.selectedItems.size === 0) {
      this.snackBar.open('Không có dữ liệu hóa đơn', 'Đóng', { duration: 3000, panelClass: 'error-snackbar' });
      return;
    }

    this.isMatching = true;
    try {
      const allProducts = await this.productService.getAllProductsFromIndexedDB();
      if (!allProducts?.length) {
        this.snackBar.open('Không có sản phẩm trong IndexedDB', 'Đóng', { duration: 3000 });
        return;
      }

      const supplierTaxCode = (this.processingResult.invoice as any).seller?.tax_code || '';
      const existingMappings = supplierTaxCode
        ? await this.mappingService.getMappingsForSupplier(supplierTaxCode)
        : [];
      const mappingLookup = new Map<string, InvoiceProductMapping>(
        existingMappings.map(m => [m.normalizedDescription, m])
      );

      const isKm = (p: any) => (p.Name || p.FullName || '').toUpperCase().includes('(KM)') && Number(p.Cost) === 0;
      const nonKmIndices = allProducts.map((p: any, i: number) => (!isKm(p) ? i : -1)).filter(i => i >= 0);
      const selectedIndices = Array.from(this.selectedItems);
      const items = this.processingResult.invoice.items;
      const preMatchedIndices = new Set<number>();

      const regularItems: Array<{ index: number; name: string }> = [];
      const promoItems:   Array<{ index: number; name: string }> = [];
      for (const i of selectedIndices) {
        const item = items[i];
        if (!item?.description) continue;

        // Mark cache hit for default selection — still run fuzzy to populate matchedProducts
        const norm = this.mappingService.normalize(item.description);
        const cached = mappingLookup.get(norm);
        if (cached) {
          const found = allProducts.find((p: any) => String(p.Code) === cached.productCode);
          if (found) {
            this.userSelectedMatch.set(i, { product: found, score: 1.0 });
            preMatchedIndices.add(i);
          }
        }

        (item.amount === 0 && item.unit_price === 0 ? promoItems : regularItems).push({ index: i, name: item.description });
      }

      // DEBUG: check neptune products in IndexedDB vs nonKmIndices
      const neptuneDebug = allProducts
        .map((p: any, idx: number) => ({ idx, code: p.Code, name: p.Name, fullName: p.FullName }))
        .filter((p: any) => (p.name || '').toLowerCase().includes('neptune') || (p.fullName || '').toLowerCase().includes('neptune'));
      const nonKmSet = new Set(nonKmIndices);
      console.group('%c[DEBUG NEPTUNE] Products in IndexedDB', 'color:#E91E63;font-weight:bold');
      neptuneDebug.forEach((p: any) => {
        const inSubset = nonKmSet.has(p.idx);
        const raw = allProducts[p.idx];
        console.log(`[${p.idx}] inSubset=${inSubset} Code="${p.code}" Name="${p.name}" Cost=${raw.Cost} OnHand=${raw.OnHand} OnHandNV=${raw.OnHandNV} isClone=${raw.isClone}`);
      });
      console.log(`Total: ${neptuneDebug.length} neptune products, ${neptuneDebug.filter((p: any) => nonKmSet.has(p.idx)).length} in nonKmIndices`);
      console.groupEnd();

      const [regularMap, promoMapRaw] = await Promise.all([
        regularItems.length ? this.fuzzyMatchService.matchAllAsync(regularItems, allProducts, nonKmIndices, 10) : Promise.resolve(new Map<number, MatchResult[]>()),
        promoItems.length   ? this.fuzzyMatchService.matchAllAsync(promoItems,   allProducts, null, 10)    : Promise.resolve(new Map<number, MatchResult[]>()),
      ]);

      // Main-thread fallback: supplement worker results for items with too few candidates
      const subsetProducts = nonKmIndices.map(i => allProducts[i]);
      for (const ri of regularItems) {
        const workerMatches = regularMap.get(ri.index) || [];
        if (workerMatches.length < 5) {
          const mainMatches = this.fuzzyMatchService.findMatches(ri.name, subsetProducts, 10);
          // Merge: add main-thread results not already in worker results
          const existingCodes = new Set(workerMatches.map(m => String(m.product?.Code || '')));
          for (const mm of mainMatches) {
            if (!existingCodes.has(String(mm.product?.Code || ''))) {
              workerMatches.push(mm);
              existingCodes.add(String(mm.product?.Code || ''));
            }
          }
          workerMatches.sort((a, b) => b.score - a.score);
          regularMap.set(ri.index, workerMatches.slice(0, 10));
        }
      }

      const dedupByCode = (ms: MatchResult[]) => {
        const seenCode = new Set<string>();
        const seenName = new Set<string>();
        return ms.filter(m => {
          const c = String(m.product?.Code || '');
          const n = String(m.product?.Name || '').toLowerCase().trim();
          if (c && seenCode.has(c)) return false;
          if (n && seenName.has(n)) return false;
          if (c) seenCode.add(c);
          if (n) seenName.add(n);
          return true;
        });
      };

      regularMap.forEach((matches, i) => {
        if (!matches.length) return;
        if (preMatchedIndices.has(i)) {
          // Cache hit: put cached product first, others as alternatives
          const cached = this.userSelectedMatch.get(i)!;
          const cachedCode = String(cached.product?.Code || '');
          const others = dedupByCode(matches.filter(m => String(m.product?.Code) !== cachedCode));
          this.matchedProducts.set(i, [cached, ...others]);
        } else {
          const deduped = dedupByCode(matches);
          this.matchedProducts.set(i, deduped);
          this.userSelectedMatch.set(i, deduped[0]);
        }
      });
      promoMapRaw.forEach((matches, i) => {
        const boosted = dedupByCode(
          matches
            .map(m => ({ ...m, score: isKm(m.product) ? Math.min(m.score + 0.05, 1.0) : m.score }))
            .sort((a, b) => b.score - a.score)
        );
        if (!boosted.length) return;
        if (preMatchedIndices.has(i)) {
          const cached = this.userSelectedMatch.get(i)!;
          const cachedCode = String(cached.product?.Code || '');
          const others = dedupByCode(boosted.filter(m => String(m.product?.Code) !== cachedCode));
          this.matchedProducts.set(i, [cached, ...others]);
        } else {
          this.matchedProducts.set(i, boosted);
          this.userSelectedMatch.set(i, boosted[0]);
        }
      });

      // LOG: all match candidates per item
      console.group('%c[INVOICE MATCH] Fuzzy match results', 'color:#9C27B0;font-weight:bold');
      for (const i of selectedIndices) {
        const item = items[i];
        const ms = this.matchedProducts.get(i) || [];
        const cacheLabel = preMatchedIndices.has(i) ? ' 💾' : '';
        console.group(`[${i}]${cacheLabel} "${item.description}" — ${ms.length} candidates`);
        ms.forEach((m, j) => console.log(`  #${j+1} [${(m.score*100).toFixed(0)}%] ${m.product?.Code} "${m.product?.Name}"`));
        console.groupEnd();
      }
      console.groupEnd();

      // Detect unit mismatches from cached mappings for pre-matched items
      const unitRenameCandidates: UnitRenameCandidate[] = [];
      for (const i of Array.from(preMatchedIndices)) {
        const item = items[i];
        const norm = this.mappingService.normalize(item.description);
        const cached = mappingLookup.get(norm);
        const match = this.userSelectedMatch.get(i);
        if (cached && match?.product) {
          const productUnit = (match.product.Unit || '').trim().toLowerCase();
          const mappingUnit = (cached.unit || '').trim().toLowerCase();
          if (mappingUnit && productUnit && mappingUnit !== productUnit) {
            unitRenameCandidates.push({
              itemIndex: i,
              productCode: String(match.product.Code || ''),
              productName: match.product.Name || '',
              oldUnit: match.product.Unit || '',
              newUnit: cached.unit,
              mappingId: cached.id,
              score: match.score,
              confirmed: true,
            });
          }
        }
      }

      if (unitRenameCandidates.length > 0) {
        const unitRef = this.dialog.open(UnitRenameConfirmDialogComponent, {
          width: '640px',
          maxWidth: '95vw',
          autoFocus: false,
          panelClass: 'unit-rename-dialog-panel',
          data: { candidates: unitRenameCandidates },
        });
        const unitResult: UnitRenameConfirmResult | null | undefined = await firstValueFrom(unitRef.afterClosed());
        if (unitResult?.confirmed?.length) {
          const unitPromises: Promise<void>[] = [];
          for (const c of unitResult.confirmed) {
            const match = this.userSelectedMatch.get(c.itemIndex);
            if (match?.product) {
              match.product = { ...match.product, Unit: c.newUnit };
              this.userSelectedMatch.set(c.itemIndex, match);
              unitPromises.push(this.productService.updateProductFromIndexedDB({ ...match.product }));
              this.mappingService.updateUnit(c.mappingId, c.newUnit);
            }
          }
          if (unitPromises.length) await Promise.all(unitPromises);
        }
      }
    } finally {
      this.isMatching = false;
    }

    this.saveCache();

    // Show review dialog for ambiguous items (multiple candidates OR low-confidence top match)
    const reviewItems: MatchReviewItem[] = [];
    for (const i of Array.from(this.selectedItems)) {
      const candidates = this.matchedProducts.get(i) || [];
      if (candidates.length > 1 || candidates[0]?.score < 0.9) {
        const item = this.processingResult!.invoice!.items[i];
        const isPromo = item.amount === 0 && item.unit_price === 0;
        reviewItems.push({
          itemIndex: i,
          description: isPromo ? `${item.description} (KM)` : item.description,
          candidates,
          selectedIdx: 0,
          invoiceUnit: item.unit || '',
        });
      }
    }

    if (reviewItems.length > 0) {
      const reviewRef = this.dialog.open(MatchReviewDialogComponent, {
        width: '560px',
        maxWidth: '95vw',
        data: { items: reviewItems },
      });
      const result: MatchReviewResult | null | undefined = await firstValueFrom(reviewRef.afterClosed());
      if (!result) return;
      result.matches.forEach((match, idx) => this.userSelectedMatch.set(idx, match));

      const renamePromises: Promise<void>[] = [];

      result.renames.forEach((newName, idx) => {
        const match = this.userSelectedMatch.get(idx);
        if (match?.product) {
          match.product = { ...match.product, Name: newName };
          this.userSelectedMatch.set(idx, match);
          renamePromises.push(this.productService.updateProductFromIndexedDB({ ...match.product }));
        }
      });

      result.unitRenames.forEach((rename, idx) => {
        const match = this.userSelectedMatch.get(idx);
        if (match?.product) {
          match.product = { ...match.product, Unit: rename.newUnit };
          this.userSelectedMatch.set(idx, match);
          renamePromises.push(this.productService.updateProductFromIndexedDB({ ...match.product }));
        }
      });

      if (renamePromises.length > 0) await Promise.all(renamePromises);
    }

    this.executeUpdatePrices();
  }

  private executeUpdatePrices(): void {
    const items = this.processingResult!.invoice!.items;

    // Process only checked items
    const selectedIndices = Array.from(this.selectedItems).sort((a, b) => a - b);

    // Check unmatched among selected items
    const unmatchedCount = selectedIndices.filter(i => !this.userSelectedMatch.has(i)).length;

    if (unmatchedCount > 0) {
      this.snackBar.open(
        `${unmatchedCount} sản phẩm chưa được match. Vui lòng kiểm tra lại.`,
        'Đóng', { duration: 5000, panelClass: 'error-snackbar' }
      );
    }

    // Build confirmed matches: only for selected indices
    const confirmedMatches = new Map<number, MatchResult>();
    for (const index of selectedIndices) {
      const matches = this.matchedProducts.get(index);
      if (this.userSelectedMatch.has(index)) {
        confirmedMatches.set(index, this.userSelectedMatch.get(index)!);
      } else if (matches && matches.length > 0) {
        confirmedMatches.set(index, matches[0]);
      }
    }

    // Build invoice items for update — re-index to 0..N for selected items
    const invoiceItems: InvoiceItemForUpdate[] = [];
    const reindexedMatches = new Map<number, MatchResult>();
    selectedIndices.forEach((origIdx, newIdx) => {
      const item = items[origIdx];
      invoiceItems.push({
        description: item.description,
        unit: item.unit,
        quantity: item.quantity,
        unit_price: item.unit_price,
        amount: item.amount,
        isPromotional: item.amount === 0 && item.unit_price === 0
      });
      const match = confirmedMatches.get(origIdx);
      if (match) {
        reindexedMatches.set(newIdx, match);
      }
    });

    // === LOG ===
    console.group('%c[CẬP NHẬT GIÁ] Dữ liệu gửi đi', 'color: #2196F3; font-weight: bold');
    selectedIndices.forEach((origIdx, newIdx) => {
      const item = items[origIdx];
      const match = confirmedMatches.get(origIdx);
      const p = match?.product;
      console.log(
        `[${origIdx}→${newIdx}] "${item.description}" | unit=${item.unit} qty=${item.quantity} amount=${item.amount}`,
        p ? `→ Code=${p.Code} Name="${p.Name}" isClone=${(p as any).isClone} OnHandNV=${(p as any).OnHandNV} OnHand=${p.OnHand}` : '→ NO MATCH'
      );
    });
    console.groupEnd();

    // Collect search terms for refresh
    const searchTerms: string[] = [];
    reindexedMatches.forEach(match => {
      const code = match.product?.Code;
      if (code && !searchTerms.includes(code)) searchTerms.push(code);
    });

    // Save confirmed matches as product mappings (fire-and-forget)
    const supplierTaxCode = (this.processingResult!.invoice! as any).seller?.tax_code || '';
    if (supplierTaxCode) {
      const now = new Date().toISOString();
      const mappingsToSave: InvoiceProductMapping[] = [];
      confirmedMatches.forEach((match, origIdx) => {
        const item = items[origIdx];
        if (!match.product?.Code) return;
        const norm = this.mappingService.normalize(item.description);
        mappingsToSave.push({
          id: this.mappingService.buildId(supplierTaxCode, norm),
          supplierTaxCode,
          invoiceDescription: item.description,
          normalizedDescription: norm,
          productCode: String(match.product.Code),
          productName: match.product.Name || '',
          unit: item.unit || '',
          lastSeen: now,
          createdAt: now,
          previousDescriptions: [],
        });
      });
      if (mappingsToSave.length) {
        this.mappingService.saveMappings(mappingsToSave);
      }
    }

    // Remove selected items from dialog before closing
    if (selectedIndices.length < items.length) {
      this.removeSelectedItemsFromDialog(selectedIndices);
    }

    // Close dialog and return data for edit-product-page to handle
    this.dialogRef?.close({
      action: 'updatePrices',
      invoiceItems,
      matchedProducts: reindexedMatches,
      searchTerms
    });
  }

  /**
   * Save invoice to Firestore via API
   */
  saveToFirestore(): void {
    if (!this.processingResult?.invoice) {
      this.snackBar.open('Không có dữ liệu hóa đơn để lưu', 'Đóng', {
        duration: 3000,
        panelClass: 'error-snackbar'
      });
      return;
    }

    const invoice = this.processingResult.invoice;

    // Validate required fields
    if (!invoice.invoice_metadata?.invoice_no || !invoice.seller?.tax_code) {
      this.snackBar.open('Thiếu số hóa đơn hoặc MST nhà cung cấp', 'Đóng', {
        duration: 3000,
        panelClass: 'error-snackbar'
      });
      return;
    }

    // Convert ProcessedInvoice to AiInvoiceData format
    const aiInvoiceData: AiInvoiceData = {
      invoiceNo: invoice.invoice_metadata.invoice_no,
      invoiceSymbol: invoice.invoice_metadata.invoice_serial || '',
      invoiceDate: this.formatDateToISO(invoice.invoice_metadata.invoice_date),
      supplier: {
        name: invoice.seller.company_name || '',
        taxCode: invoice.seller.tax_code || '',
        address: invoice.seller.address || ''
      },
      buyer: {
        name: invoice.buyer?.company_name || '',
        taxCode: invoice.buyer?.tax_code || '',
        address: invoice.buyer?.address || ''
      },
      items: (invoice.items || []).map(item => ({
        name: item.description || '',
        unit: item.unit || '',
        quantity: item.quantity || 0,
        unitPrice: item.unit_price || 0,
        amount: item.amount || 0
      })),
      totalBeforeVat: invoice.summary?.total_amount_before_vat || 0,
      vatRate: this.parseVatRate(invoice.summary?.vat_rate),
      vatAmount: invoice.summary?.vat_amount || 0,
      totalAmount: invoice.summary?.total_payment || 0,
      confidence: 0.95,
      // Email + Portal metadata
      sourceTab: this.activeTab,
      gmailMessageId: this.currentEmailId || undefined,
      gmailFrom: this.currentEmailFrom || undefined,
      gmailDate: this.currentEmailDate || undefined,
      portalUrl: this.currentPortalUrl || undefined,
      portalPdfUrl: this.currentPortalPdfUrl || undefined,
      invoiceProvider: this.currentInvoiceProvider || undefined,
      portalCredentials: Object.keys(this.currentPortalCredentials).length > 0 ? this.currentPortalCredentials : undefined,
      processingMethod: this.processingResult?.processing_method || (this.activeTab === 'upload' ? 'xml_parse' : undefined),
      attachmentType: this.currentAttachmentType || undefined,
    };

    this.isSavingToFirestore = true;

    this.invoiceService.saveAiInvoice(aiInvoiceData)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.isSavingToFirestore = false;
          if (response.success) {
            this.savedToFirestore = true;
            this.snackBar.open(
              'Đã lưu hóa đơn vào hệ thống!',
              'Đóng',
              { duration: 3000, panelClass: 'success-snackbar' }
            );
          } else {
            this.snackBar.open(
              response.message || 'Không thể lưu hóa đơn',
              'Đóng',
              { duration: 5000, panelClass: 'error-snackbar' }
            );
          }
        },
        error: (error) => {
          this.isSavingToFirestore = false;
          console.error('Error saving to Firestore:', error);
          this.snackBar.open(
            error.message || 'Lỗi khi lưu hóa đơn',
            'Đóng',
            { duration: 5000, panelClass: 'error-snackbar' }
          );
        }
      });
  }

  /**
   * Format date string to ISO format (YYYY-MM-DD)
   */
  private formatDateToISO(dateStr: string | undefined): string {
    if (!dateStr) return '';

    // Handle common Vietnamese date formats: DD/MM/YYYY, DD-MM-YYYY
    const ddmmyyyy = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/;
    const match = dateStr.match(ddmmyyyy);
    if (match) {
      const day = match[1].padStart(2, '0');
      const month = match[2].padStart(2, '0');
      const year = match[3];
      return `${year}-${month}-${day}`;
    }

    // Already in ISO format
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return dateStr;
    }

    return dateStr;
  }

  /**
   * Parse VAT rate from string (e.g., "10%" -> 10)
   */
  private parseVatRate(vatRateStr: string | undefined): number {
    if (!vatRateStr) return 0;
    const num = parseFloat(vatRateStr.replace('%', '').trim());
    return isNaN(num) ? 0 : num;
  }

  /**
   * Mở dialog chọn hóa đơn đã xử lý trước đó
   */
  openRecentInvoices(): void {
    const dialogRef = this.dialog.open(RecentInvoicesDialogComponent, {
      width: '680px',
      maxWidth: '95vw',
      maxHeight: '85vh',
      panelClass: 'recent-invoices-dialog-panel',
      data: { days: 1 }
    });

    dialogRef.afterClosed().subscribe((selectedInvoice: RecentAiInvoice | null) => {
      if (selectedInvoice) {
        this.loadInvoiceFromRecent(selectedInvoice);
      }
    });
  }

  // =============================================================
  // EMAIL TAB METHODS
  // =============================================================

  loadLabels(): void {
    // Check Gmail auth status first
    this.gmailService.checkAuthStatus()
      .pipe(takeUntil(this.destroy$))
      .subscribe(status => {
        this.gmailConnected = status.hasRefreshToken;
      });

    this.isLoadingLabels = true;
    this.gmailService.listLabels()
      .pipe(takeUntil(this.destroy$))
      .subscribe(labels => {
        this.gmailLabels = labels;
        this.filteredLabels = labels;
        this.isLoadingLabels = false;
      });
  }

  filterLabels(): void {
    const search = this.labelSearchText.toLowerCase().trim();
    this.filteredLabels = search
      ? this.gmailLabels.filter(l => l.name.toLowerCase().includes(search))
      : [...this.gmailLabels];
  }

  onLabelDropdownOpened(): void {
    this.labelSearchText = '';
    this.filteredLabels = [...this.gmailLabels];
  }

  connectGmail(): void {
    this.gmailService.connectGmail().then(success => {
      if (success) {
        this.gmailConnected = true;
        this.snackBar.open('Đã kết nối Gmail thành công!', 'Đóng', { duration: 3000, panelClass: 'success-snackbar' });
        this.loadLabels();
      }
    });
  }

  loadEmails(): void {
    if (!this.selectedLabelId) return;
    this.isLoadingEmails = true;
    this.gmailEmails = [];

    this.gmailService.listEmails(this.selectedLabelId, 7)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: emails => {
          this.gmailEmails = emails;
          this.isLoadingEmails = false;
        },
        error: () => {
          this.isLoadingEmails = false;
          this.snackBar.open('Lỗi tải email', 'Đóng', { duration: 3000, panelClass: 'error-snackbar' });
        }
      });
  }

  selectEmail(email: GmailEmail): void {
    const badge = GmailService.getAttachmentBadge(email);

    if (badge === 'PDF') {
      this.snackBar.open(
        'Gmail này chỉ có file pdf, hãy download và sử dụng tính năng Upload XML',
        'Đóng', { duration: 7000 }
      );
      return;
    }

    if (badge === 'LINK') {
      this.snackBar.open('Đang tải XML từ portal...', 'Đóng', { duration: 30000 });
    }

    this.isProcessing = true;
    this.showManualXmlImport = false;

    // Save email metadata
    this.currentEmailId = email.gmail_id;
    this.currentEmailFrom = email.from_address;
    this.currentEmailDate = email.date;

    this.gmailService.processEmail(email.gmail_id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (result) => {
          this.isProcessing = false;

          if (!result.success) {
            this.snackBar.open(result.error || 'Lỗi xử lý email', 'Đóng', { duration: 5000, panelClass: 'error-snackbar' });
            return;
          }

          // Save portal URL info from response
          if (result.portalUrl) {
            this.currentPortalUrl = result.portalUrl;
            this.currentInvoiceProvider = result.invoiceProvider || '';
            this.currentPortalPdfUrl = result.portalPdfUrl || '';
            this.currentPortalCredentials = result.portalCredentials || {};
          }
          this.currentAttachmentType = result.type || '';

          switch (result.type) {
            case 'xml':
            case 'zip_xml':
            case 'portal_xml':
              if (result.invoices && result.invoices.length > 0) {
                this.populateFormFromXmlInvoice(result.invoices[0]);
                this.saveCache();
                const sourceLabel = result.type === 'zip_xml' ? 'ZIP→XML'
                  : result.type === 'portal_xml' ? 'Portal XML' : 'XML';
                this.snackBar.open(
                  `Đọc thành công từ ${sourceLabel}`,
                  'Đóng', { duration: 3000, panelClass: 'success-snackbar' }
                );
              }
              break;

            case 'none':
              this.showManualXmlImport = true;
              this.snackBar.open(
                result.message || 'Không có file đính kèm. Vui lòng import XML thủ công.',
                'Đóng', { duration: 5000 }
              );
              break;
          }
        },
        error: () => {
          this.isProcessing = false;
          this.snackBar.open('Lỗi xử lý email', 'Đóng', { duration: 5000, panelClass: 'error-snackbar' });
        }
      });
  }

  /**
   * Handle manual XML file import (for emails with only links)
   */
  onXmlFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0];

    const reader = new FileReader();
    reader.onload = () => {
      const xmlContent = reader.result as string;
      // Send XML to backend for parsing
      // For now, parse locally using the same backend endpoint
      this.snackBar.open('Import XML thủ công chưa được hỗ trợ client-side. Sẽ thêm sau.', 'Đóng', { duration: 3000 });
    };
    reader.readAsText(file);
  }

  /**
   * Convert XML parser output to ProcessedInvoice and populate form
   */
  private populateFormFromXmlInvoice(invoice: any): void {
    const processedInvoice: ProcessedInvoice = {
      invoice_metadata: {
        invoice_date: invoice.invoiceDate || invoice.invoice_date || '',
        invoice_no: invoice.invoiceNo || invoice.invoice_no || '',
        invoice_serial: invoice.invoiceSymbol || invoice.invoice_serial || '',
        tax_authority_code: invoice.lookupCode || ''
      },
      seller: {
        company_name: invoice.sellerName || invoice.seller_name || '',
        tax_code: invoice.sellerTaxCode || invoice.seller_tax_code || '',
        address: invoice.sellerAddress || invoice.seller_address || ''
      },
      buyer: {
        company_name: invoice.buyerName || invoice.buyer_name || '',
        tax_code: invoice.buyerTaxCode || invoice.buyer_tax_code || '',
        address: invoice.buyerAddress || invoice.buyer_address || ''
      },
      items: (invoice.items || [])
        .filter((item: any) => {
          // Filter out separator lines (e.g. "Hàng quảng cáo, khuyến mại...") - no unit AND no quantity
          const unit = item.unit || item.DVTinh || '';
          const qty = parseFloat(item.quantity || item.SLuong) || 0;
          return unit || qty > 0;
        })
        .map((item: any, index: number) => {
          const amount = parseFloat(item.amount || item.total || item.totalAmount || item.ThTien) || 0;
          const vatAmount = parseFloat(item.taxAmount || item.vat_amount || item.TThue) || 0;
          const rawAat = item.amountAfterTax != null ? parseFloat(item.amountAfterTax) : null;
          // Backend đã trả amountAfterTax đúng (đã trừ chiết khấu + gồm thuế). Chỉ fallback khi thiếu.
          const aat = (rawAat != null && rawAat > 0) ? rawAat : (vatAmount > 0 ? amount + vatAmount : null);
          if (index === 0) console.log('[XML DEBUG] item[0] amount=', amount, 'vatAmount=', vatAmount, 'rawAat=', rawAat, '→ aat=', aat);
          return {
            stt: index + 1,
            description: item.name || item.description || item.THHDVu || '',
            unit: item.unit || item.DVTinh || '',
            quantity: parseFloat(item.quantity || item.SLuong) || 0,
            unit_price: parseFloat(item.unitPrice || item.unit_price || item.DGia) || 0,
            amount,
            vat_amount: vatAmount,
            amount_after_vat: aat
          };
        }),
      summary: {
        total_amount_before_vat: parseFloat(invoice.totalBeforeVat || invoice.total_before_vat) || 0,
        vat_rate: `${invoice.vatRate || invoice.vat_rate || 0}%`,
        vat_amount: parseFloat(invoice.vatAmount || invoice.vat_amount) || 0,
        total_payment: parseFloat(invoice.totalAmount || invoice.total_amount) || 0,
        total_payment_in_words: invoice.totalAmountInWords || ''
      }
    };

    this.populateForm(processedInvoice);
    this.processingResult = {
      success: true,
      invoice: processedInvoice,
      validation_errors: [],
      processing_method: 'flash'
    };

    // Merge duplicate promotional items before matching
    this.mergePromotionalItems();

  }

  getAttachmentBadge(email: GmailEmail): string {
    return GmailService.getAttachmentBadge(email);
  }

  getAttachmentBadgeClass(email: GmailEmail): string {
    const badge = this.getAttachmentBadge(email);
    return badge === 'XML' ? 'badge-xml' : badge === 'ZIP' ? 'badge-zip' : badge === 'PDF' ? 'badge-pdf' : 'badge-link';
  }

  // =============================================================
  // FUZZY MATCHING METHODS
  // =============================================================

  async matchInvoiceItemsToProducts(): Promise<void> {
    if (!this.processingResult?.invoice?.items) return;
    this.isMatching = true;

    try {
      const allProducts = await this.productService.getAllProductsFromIndexedDB();
      if (!allProducts?.length) {
        this.snackBar.open('Không có sản phẩm trong IndexedDB', 'Đóng', { duration: 3000 });
        return;
      }

      const isKmProduct = (p: any) => (p.Name || p.FullName || '').toUpperCase().includes('(KM)') && Number(p.Cost) === 0;
      const nonKmIndices = allProducts.map((p: any, i: number) => (!isKmProduct(p) ? i : -1)).filter(i => i >= 0);
      const kmIndices    = allProducts.map((p: any, i: number) => ( isKmProduct(p) ? i : -1)).filter(i => i >= 0);

      this.matchedProducts.clear();
      this.userSelectedMatch.clear();

      const items = this.processingResult.invoice.items;
      const regularItems: Array<{ index: number; name: string }> = [];
      const promoItems:   Array<{ index: number; name: string }> = [];
      items.forEach((item, i) => {
        if (!item.description) return;
        (item.amount === 0 && item.unit_price === 0 ? promoItems : regularItems).push({ index: i, name: item.description });
      });

      const [regularMap, promoMapRaw] = await Promise.all([
        regularItems.length ? this.fuzzyMatchService.matchAllAsync(regularItems, allProducts, nonKmIndices)      : Promise.resolve(new Map<number, MatchResult[]>()),
        promoItems.length   ? this.fuzzyMatchService.matchAllAsync(promoItems,   allProducts, null, 10) : Promise.resolve(new Map<number, MatchResult[]>()),
      ]);

      if (this.matchingCancelled) return;

      const dedupMatches = (ms: MatchResult[]) => {
        const seenCode = new Set<string>();
        const seenName = new Set<string>();
        return ms.filter(m => {
          const c = String(m.product?.Code || '');
          const n = String(m.product?.Name || '').toLowerCase().trim();
          if (c && seenCode.has(c)) return false;
          if (n && seenName.has(n)) return false;
          if (c) seenCode.add(c);
          if (n) seenName.add(n);
          return true;
        });
      };

      // Apply KM boost to promo results
      promoMapRaw.forEach((matches, idx) => {
        const boosted = dedupMatches(
          matches
            .map(m => ({ ...m, score: isKmProduct(m.product) ? Math.min(m.score + 0.05, 1.0) : m.score }))
            .sort((a, b) => b.score - a.score)
        ).slice(0, 5);
        if (boosted.length) { this.matchedProducts.set(idx, boosted); this.userSelectedMatch.set(idx, boosted[0]); }
      });
      regularMap.forEach((matches, i) => {
        const deduped = dedupMatches(matches);
        this.matchedProducts.set(i, deduped);
        this.userSelectedMatch.set(i, deduped[0]);
      });

      console.group('%c[FUZZY MATCH] Kết quả matching', 'color: #9C27B0; font-weight: bold');
      console.log(`Products: ${allProducts.length} total, ${nonKmIndices.length} non-KM, ${kmIndices.length} KM`);
      items.forEach((item, i) => {
        const m = this.matchedProducts.get(i);
        console.log(`[${i}] "${item.description}" →`, m?.map(x => `${x.product.Name} (${(x.score * 100).toFixed(0)}%, Code=${x.product.Code})`).join(' | ') || 'NONE');
      });
      console.groupEnd();

    } catch (error) {
      console.error('Error matching products:', error);
    } finally {
      this.isMatching = false;
    }
  }

  onMatchSelected(index: number, match: MatchResult): void {
    this.userSelectedMatch.set(index, match);
  }

  getMatchScoreClass(score: number): string {
    if (score >= 0.9) return 'match-high';
    if (score >= 0.5) return 'match-medium';
    return 'match-low';
  }

  getMatchesForItem(index: number): MatchResult[] {
    return this.matchedProducts.get(index) || [];
  }

  getSelectedMatch(index: number): MatchResult | undefined {
    return this.userSelectedMatch.get(index);
  }

  // =============================================================
  // PROMOTIONAL ITEM HELPERS
  // =============================================================

  /**
   * Check if an invoice item is promotional (KM) - amount/unit_price = 0
   */
  isPromotionalItem(index: number): boolean {
    const item = this.itemsFormArray.at(index);
    if (!item) return false;
    const amount = item.get('amount')?.value || 0;
    const unitPrice = item.get('unit_price')?.value || 0;
    return amount === 0 && unitPrice === 0;
  }

  /**
   * Remove a single item from the invoice
   */
  removeItem(index: number): void {
    if (index < 0 || index >= this.itemsFormArray.length) return;

    // Remove from form array
    this.itemsFormArray.removeAt(index);

    // Remove from processingResult items
    if (this.processingResult?.invoice?.items) {
      this.processingResult.invoice.items.splice(index, 1);
    }

    // Rebuild match maps with shifted indices
    const newMatched = new Map<number, MatchResult[]>();
    const newSelected = new Map<number, MatchResult>();

    this.matchedProducts.forEach((matches, i) => {
      if (i < index) {
        newMatched.set(i, matches);
      } else if (i > index) {
        newMatched.set(i - 1, matches);
      }
      // i === index is removed
    });

    this.userSelectedMatch.forEach((match, i) => {
      if (i < index) {
        newSelected.set(i, match);
      } else if (i > index) {
        newSelected.set(i - 1, match);
      }
    });

    this.matchedProducts = newMatched;
    this.userSelectedMatch = newSelected;

    // Rebuild selectedItems with shifted indices
    const newChecked = new Set<number>();
    this.selectedItems.forEach(i => {
      if (i < index) newChecked.add(i);
      else if (i > index) newChecked.add(i - 1);
    });
    this.selectedItems = newChecked;

    // Update STT numbers
    for (let i = 0; i < this.itemsFormArray.length; i++) {
      this.itemsFormArray.at(i).get('stt')?.setValue(i + 1);
    }

    // Force mat-table to re-render rows
    this.itemsTable?.renderRows();

    this.saveCache();
  }

  // === Checkbox Selection ===
  toggleSelectItem(index: number): void {
    if (this.selectedItems.has(index)) {
      this.selectedItems.delete(index);
    } else {
      this.selectedItems.add(index);
    }
  }

  toggleSelectAll(): void {
    if (this.isAllSelected()) {
      this.selectedItems.clear();
    } else {
      for (let i = 0; i < this.itemsFormArray.length; i++) {
        this.selectedItems.add(i);
      }
    }
  }

  isAllSelected(): boolean {
    return this.itemsFormArray.length > 0 && this.selectedItems.size === this.itemsFormArray.length;
  }

  isSomeSelected(): boolean {
    return this.selectedItems.size > 0 && !this.isAllSelected();
  }

  private removeSelectedItemsFromDialog(selectedIndices: number[]): void {
    // Sort descending to remove from end first (avoid index shifting)
    const sorted = [...selectedIndices].sort((a, b) => b - a);
    for (const index of sorted) {
      this.itemsFormArray.removeAt(index);
      if (this.processingResult?.invoice?.items) {
        this.processingResult.invoice.items.splice(index, 1);
      }
    }

    // Rebuild match maps with shifted indices
    const newMatched = new Map<number, MatchResult[]>();
    const newSelected = new Map<number, MatchResult>();
    const removedSet = new Set(selectedIndices);

    // Build index mapping: old index -> new index
    let newIdx = 0;
    const indexMap = new Map<number, number>();
    for (let i = 0; i < this.itemsFormArray.length + removedSet.size; i++) {
      if (!removedSet.has(i)) {
        indexMap.set(i, newIdx++);
      }
    }

    this.matchedProducts.forEach((matches, i) => {
      if (indexMap.has(i)) {
        newMatched.set(indexMap.get(i)!, matches);
      }
    });

    this.userSelectedMatch.forEach((match, i) => {
      if (indexMap.has(i)) {
        newSelected.set(indexMap.get(i)!, match);
      }
    });

    this.matchedProducts = newMatched;
    this.userSelectedMatch = newSelected;

    // Update STT numbers
    for (let i = 0; i < this.itemsFormArray.length; i++) {
      this.itemsFormArray.at(i).get('stt')?.setValue(i + 1);
    }

    // Clear selection
    this.selectedItems.clear();

    this.saveCache();
  }

  /**
   * Merge duplicate promotional items (same description, amount=0).
   * Called after populateForm to consolidate promo rows.
   */
  private mergePromotionalItems(): void {
    if (!this.processingResult?.invoice?.items) return;

    const items = this.processingResult.invoice.items;
    const merged: typeof items = [];
    const promoMap = new Map<string, number>(); // description → index in merged

    for (const item of items) {
      const isPromo = item.amount === 0 && item.unit_price === 0;

      if (isPromo) {
        const key = item.description.trim().toLowerCase();
        if (promoMap.has(key)) {
          // Merge: add quantity to existing
          const existingIdx = promoMap.get(key)!;
          merged[existingIdx].quantity += item.quantity;
        } else {
          promoMap.set(key, merged.length);
          merged.push({ ...item });
        }
      } else {
        merged.push({ ...item });
      }
    }

    // Only update if something was merged
    if (merged.length < items.length) {
      this.processingResult.invoice.items = merged;
      // Re-number STT
      merged.forEach((item, i) => item.stt = i + 1);
      // Re-populate form
      while (this.itemsFormArray.length > 0) {
        this.itemsFormArray.removeAt(0);
      }
      merged.forEach(item => {
        this.itemsFormArray.push(this.createItemFormGroup(item));
      });
      console.log(`[MERGE] Merged promotional items: ${items.length} → ${merged.length}`);
    }
  }

  // =============================================================
  // CLONE IMAGE TAB METHODS
  // =============================================================

  onCloneDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isCloneDragOver = true;
  }

  onCloneDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isCloneDragOver = false;
  }

  onCloneDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isCloneDragOver = false;
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.handleCloneImageFile(files[0]);
    }
  }

  onCloneFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.handleCloneImageFile(input.files[0]);
    }
  }

  private handleCloneImageFile(file: File): void {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!allowedTypes.includes(file.type)) {
      this.snackBar.open('Vui lòng chọn file ảnh (JPG, PNG) hoặc PDF', 'Đóng', { duration: 3000, panelClass: 'error-snackbar' });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      this.snackBar.open('File quá lớn. Vui lòng chọn file dưới 10MB', 'Đóng', { duration: 3000, panelClass: 'error-snackbar' });
      return;
    }
    this.selectedCloneImageFile = file;
    this.processingResult = null;
    this.validationErrors = [];
    this.isCloneMode = true;
    this.resetForm();
  }

  processCloneImage(): void {
    if (!this.selectedCloneImageFile) {
      this.snackBar.open('Vui lòng chọn file trước', 'Đóng', { duration: 3000, panelClass: 'error-snackbar' });
      return;
    }

    this.isProcessing = true;
    this.isCloneMode = true;
    this.invoiceProcessingService.resetProcessingSteps();

    this.invoiceProcessingService.processImage(this.selectedCloneImageFile)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (result) => {
          this.isProcessing = false;
          this.processingResult = result;

          if (result.success && result.invoice) {
            this.populateForm(result.invoice);
            this.validationErrors = result.validation_errors || [];
            this.mergePromotionalItems();
            this.saveCache();

            const methodLabel = result.processing_method === 'flash' ? 'Gemini Flash' : 'Gemini Pro';
            const confidenceText = result.confidence ? ` (${(result.confidence * 100).toFixed(0)}%)` : '';
            this.snackBar.open(`Đọc ảnh Clone thành công với ${methodLabel}${confidenceText}!`, 'Đóng', { duration: 3000, panelClass: 'success-snackbar' });

          } else {
            this.snackBar.open(result.error || 'Có lỗi xảy ra khi đọc ảnh', 'Đóng', { duration: 5000, panelClass: 'error-snackbar' });
          }
        },
        error: () => {
          this.isProcessing = false;
          this.snackBar.open('Có lỗi xảy ra khi đọc ảnh', 'Đóng', { duration: 5000, panelClass: 'error-snackbar' });
        }
      });
  }

  clearCloneImage(): void {
    this.selectedCloneImageFile = null;
    this.processingResult = null;
    this.validationErrors = [];
    this.isCloneMode = false;
    this.clearCache();
    this.invoiceProcessingService.resetProcessingSteps();
    this.resetForm();
  }

  /**
   * Match invoice items to CLONE products only.
   * Clone detection: isClone===true || (OnHandNV>0 && OnHand===0) || KiotVietSync===false
   */
  async matchCloneItemsToProducts(): Promise<void> {
    if (!this.processingResult?.invoice?.items) return;
    this.isMatching = true;

    try {
      const allProducts = await this.productService.getAllProductsFromIndexedDB();
      if (!allProducts?.length) {
        this.snackBar.open('Không có sản phẩm trong IndexedDB', 'Đóng', { duration: 3000 });
        return;
      }

      const cloneIndices = allProducts.map((p: any, i: number) => this.isCloneProduct(p) ? i : -1).filter(i => i >= 0);
      if (cloneIndices.length === 0) {
        this.snackBar.open('Không tìm thấy sản phẩm Clone trong IndexedDB', 'Đóng', { duration: 3000, panelClass: 'error-snackbar' });
        return;
      }

      this.matchedProducts.clear();
      this.userSelectedMatch.clear();

      const invoiceItems = this.processingResult.invoice.items;
      const items = invoiceItems
        .map((item, i) => ({ index: i, name: this.cleanDescriptionForMatching(item.description, item.unit) }))
        .filter(item => !!item.name);

      const matchMap = await this.fuzzyMatchService.matchAllAsync(items, allProducts, cloneIndices);

      if (this.matchingCancelled) return;

      const dedupClone = (ms: MatchResult[]) => {
        const seenCode = new Set<string>();
        const seenName = new Set<string>();
        return ms.filter(m => {
          const c = String(m.product?.Code || '');
          const n = String(m.product?.Name || '').toLowerCase().trim();
          if (c && seenCode.has(c)) return false;
          if (n && seenName.has(n)) return false;
          if (c) seenCode.add(c);
          if (n) seenName.add(n);
          return true;
        });
      };

      matchMap.forEach((matches, i) => {
        const deduped = dedupClone(matches);
        this.matchedProducts.set(i, deduped);
        this.userSelectedMatch.set(i, deduped[0]);
      });

      console.group('%c[CLONE MATCH] Kết quả matching Clone', 'color: #FF5722; font-weight: bold');
      console.log(`Clone products: ${cloneIndices.length} / ${allProducts.length} total`);
      invoiceItems.forEach((item, i) => {
        const cleaned = this.cleanDescriptionForMatching(item.description, item.unit);
        const m = this.matchedProducts.get(i);
        console.log(`[${i}] "${item.description}"${item.description !== cleaned ? ` → cleaned: "${cleaned}"` : ''} →`, m?.map(x => `${x.product.Name} (${(x.score * 100).toFixed(0)}%, Code=${x.product.Code})`).join(' | ') || 'NONE');
      });
      console.groupEnd();

    } catch (error) {
      console.error('Error matching clone products:', error);
    } finally {
      this.isMatching = false;
    }
  }

  /**
   * Strip unit/quantity noise from invoice description before fuzzy matching.
   * E.g., "Gluxena Chai 30 chai" → "Gluxena" (unit=THÙNG is separate field)
   * This prevents unit words like "chai", "thùng" from polluting the match score.
   */
  private cleanDescriptionForMatching(description: string, unit?: string): string {
    if (!description) return '';
    let cleaned = description;

    // Remove common Vietnamese unit words (case-insensitive)
    const unitWords = [
      'thùng', 'thung', 'chai', 'lon', 'lốc', 'loc', 'gói', 'goi',
      'hộp', 'hop', 'bịch', 'bich', 'can', 'kg', 'gram', 'lít', 'lit',
      'ml', 'cuộn', 'cuon', 'bao', 'túi', 'tui', 'cây', 'cay',
      'ống', 'ong', 'hũ', 'hu', 'ly', 'kiện', 'kien', 'xấp', 'xap',
      'cái', 'cai', 'chiếc', 'chiec', 'tấm', 'tam', 'tờ', 'to',
      'bộ', 'bo',
    ];

    // Build regex: match unit words (possibly preceded by number) at word boundary
    // Handles: "Chai 30 chai", "30chai", "1 thùng", etc.
    const unitPattern = unitWords.join('|');
    // Remove patterns like "30 chai", "chai 30", standalone numbers between unit words
    cleaned = cleaned.replace(
      new RegExp(`\\b(?:\\d+\\s*)?(?:${unitPattern})(?:\\s*\\d+)?\\b`, 'gi'),
      ' '
    );
    // Remove standalone numbers (likely quantities) that remain
    cleaned = cleaned.replace(/\b\d+\b/g, ' ');
    // Remove the invoice unit if it appears in description
    if (unit) {
      cleaned = cleaned.replace(new RegExp(`\\b${unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), ' ');
    }
    // Collapse spaces and trim
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    // If cleaning removed everything, fall back to original
    return cleaned || description;
  }

  /**
   * Check if a product is a Clone product
   */
  private isCloneProduct(p: any): boolean {
    if (typeof p.isClone === 'boolean') return p.isClone;
    if (typeof p.isClone === 'string') return p.isClone.toLowerCase() === 'true';
    if (p.OnHandNV > 0 && (p.OnHand === 0 || !p.OnHand)) return true;
    if (p.KiotVietSync === false) return true;
    return false;
  }

  /**
   * Update Clone prices: close dialog and pass data back with clone action
   */
  async updateClonePrices(): Promise<void> {
    if (!this.processingResult?.invoice?.items || this.selectedItems.size === 0) {
      this.snackBar.open('Không có dữ liệu hóa đơn', 'Đóng', { duration: 3000, panelClass: 'error-snackbar' });
      return;
    }

    this.isMatching = true;
    try {
      const allProducts = await this.productService.getAllProductsFromIndexedDB();
      if (!allProducts?.length) {
        this.snackBar.open('Không có sản phẩm trong IndexedDB', 'Đóng', { duration: 3000 });
        return;
      }

      const cloneIndices = allProducts.map((p: any, i: number) => this.isCloneProduct(p) ? i : -1).filter(i => i >= 0);
      if (cloneIndices.length === 0) {
        this.snackBar.open('Không tìm thấy sản phẩm Clone', 'Đóng', { duration: 3000, panelClass: 'error-snackbar' });
        return;
      }

      const selectedIndices = Array.from(this.selectedItems);
      const items = this.processingResult.invoice.items;
      const matchItems = selectedIndices
        .filter(i => !!this.cleanDescriptionForMatching(items[i]?.description, items[i]?.unit))
        .map(i => ({ index: i, name: this.cleanDescriptionForMatching(items[i].description, items[i].unit) }));

      const matchMap = await this.fuzzyMatchService.matchAllAsync(matchItems, allProducts, cloneIndices);
      matchMap.forEach((matches, i) => { if (matches.length) this.userSelectedMatch.set(i, matches[0]); });
    } finally {
      this.isMatching = false;
    }

    this.executeUpdateClonePrices();
  }

  private executeUpdateClonePrices(): void {
    const items = this.processingResult!.invoice!.items;

    // Process only checked items
    const selectedIndices = Array.from(this.selectedItems).sort((a, b) => a - b);

    // Build confirmed matches: only for selected indices
    const confirmedMatches = new Map<number, MatchResult>();
    for (const index of selectedIndices) {
      const matches = this.matchedProducts.get(index);
      if (this.userSelectedMatch.has(index)) {
        confirmedMatches.set(index, this.userSelectedMatch.get(index)!);
      } else if (matches && matches.length > 0) {
        confirmedMatches.set(index, matches[0]);
      }
    }

    // Build invoice items — re-index to 0..N for selected items
    const invoiceItems: InvoiceItemForUpdate[] = [];
    const reindexedMatches = new Map<number, MatchResult>();
    selectedIndices.forEach((origIdx, newIdx) => {
      const item = items[origIdx];
      invoiceItems.push({
        description: item.description,
        unit: item.unit,
        quantity: item.quantity,
        unit_price: item.unit_price,
        amount: item.amount,
        isPromotional: item.amount === 0 && item.unit_price === 0
      });
      const match = confirmedMatches.get(origIdx);
      if (match) {
        reindexedMatches.set(newIdx, match);
      }
    });

    // LOG
    console.group('%c[CẬP NHẬT CLONE] Dữ liệu gửi đi', 'color: #FF5722; font-weight: bold');
    selectedIndices.forEach((origIdx, newIdx) => {
      const item = items[origIdx];
      const match = confirmedMatches.get(origIdx);
      const p = match?.product;
      console.log(
        `[${origIdx}→${newIdx}] "${item.description}" | unit=${item.unit} qty=${item.quantity} amount=${item.amount}`,
        p ? `→ Code=${p.Code} Name="${p.Name}" isClone=${(p as any).isClone} OnHandNV=${(p as any).OnHandNV}` : '→ NO MATCH'
      );
    });
    console.groupEnd();

    // Collect search terms
    const searchTerms: string[] = [];
    reindexedMatches.forEach(match => {
      const code = match.product?.Code;
      if (code && !searchTerms.includes(code)) searchTerms.push(code);
    });

    // Remove selected items from dialog before closing
    if (selectedIndices.length < items.length) {
      this.removeSelectedItemsFromDialog(selectedIndices);
    }

    // Close dialog with clone action
    this.dialogRef?.close({
      action: 'updateClonePrices',
      invoiceItems,
      matchedProducts: reindexedMatches,
      searchTerms
    });
  }

  // =============================================================
  // EXISTING METHODS (kept as-is)
  // =============================================================

  /**
   * Load dữ liệu từ hóa đơn đã chọn vào form
   */
  private loadInvoiceFromRecent(invoice: RecentAiInvoice): void {
    // Chuyển đổi RecentAiInvoice sang ProcessedInvoice format
    const processedInvoice: ProcessedInvoice = {
      invoice_metadata: {
        invoice_date: invoice.invoiceDate,
        invoice_no: invoice.invoiceNo,
        invoice_serial: invoice.invoiceSymbol || '',
        tax_authority_code: ''
      },
      seller: {
        company_name: invoice.supplier?.name || invoice.supplierName || '',
        tax_code: invoice.supplier?.taxCode || invoice.supplierTaxCode || '',
        address: invoice.supplier?.address || ''
      },
      buyer: {
        company_name: invoice.buyer?.name || invoice.buyerName || '',
        tax_code: invoice.buyer?.taxCode || invoice.buyerTaxCode || '',
        address: invoice.buyer?.address || ''
      },
      items: (invoice.items || []).map((item, index) => ({
        stt: index + 1,
        description: item.name,
        unit: item.unit || '',
        quantity: item.quantity,
        unit_price: item.unitPrice,
        amount: item.amount
      })),
      summary: {
        total_amount_before_vat: invoice.totalBeforeVat,
        vat_rate: `${invoice.vatRate}%`,
        vat_amount: invoice.vatAmount,
        total_payment: invoice.totalAmount,
        total_payment_in_words: ''
      }
    };

    // Populate form với dữ liệu đã chuyển đổi
    this.populateForm(processedInvoice);

    // Cập nhật processing result để hiển thị UI
    this.processingResult = {
      success: true,
      invoice: processedInvoice,
      validation_errors: [],
      processing_method: 'flash'
    };

    // Merge duplicate promotional items
    this.mergePromotionalItems();

    // Reset saved state vì đây là dữ liệu từ Firestore
    this.savedToFirestore = true;
    this.saveCache();

    this.snackBar.open(
      `Đã tải hóa đơn ${invoice.invoiceNo} từ ${invoice.supplierName}`,
      'Đóng',
      { duration: 3000, panelClass: 'success-snackbar' }
    );
  }
}
