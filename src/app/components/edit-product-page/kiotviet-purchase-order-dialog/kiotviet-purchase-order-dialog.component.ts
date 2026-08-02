import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import {
  KiotVietPurchaseOrderService,
  PurchaseLine
} from '../../../services/kiotviet-purchase-order.service';
import { KiotVietSupplier } from '../../../services/kiotviet.service';
import {
  PurchaseMatchReviewDialogComponent,
  PurchaseMatchReviewItem,
  PurchaseMatchReviewResult
} from './purchase-match-review-dialog.component';
import { log, logError } from '../../../utils/log.util';

@Component({
  selector: 'kiotviet-purchase-order-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    MatSnackBarModule
  ],
  templateUrl: './kiotviet-purchase-order-dialog.component.html',
  styleUrls: ['./kiotviet-purchase-order-dialog.component.css']
})
export class KiotVietPurchaseOrderDialogComponent implements OnInit {
  lines: PurchaseLine[] = [];
  supplier: KiotVietSupplier | null = null;
  sellerName = '';
  invoiceNumber = '';

  fileName = '';
  isParsing = false;
  isSubmitting = false;
  submitError = '';
  restoredFromCache = false;

  /** localStorage: lưu nháp phiếu nhập đã import để mở lại không cần import lại */
  private readonly DRAFT_KEY = 'kvPurchaseOrderDraft';

  constructor(
    public dialogRef: MatDialogRef<KiotVietPurchaseOrderDialogComponent>,
    private dialog: MatDialog,
    private purchaseOrderService: KiotVietPurchaseOrderService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    if (this.loadDraft()) {
      this.restoredFromCache = true;
      this.notify(`Đã khôi phục phiếu nhập từ lần trước (${this.lines.length} dòng)`);
    }
  }

  // ============ Cache nháp (localStorage) ============

  /** Lưu toàn bộ state hiện tại vào localStorage (bỏ cờ tạm `searching`) */
  private cacheState(): void {
    try {
      if (!this.lines.length) {
        localStorage.removeItem(this.DRAFT_KEY);
        return;
      }
      const draft = {
        fileName: this.fileName,
        sellerName: this.sellerName,
        invoiceNumber: this.invoiceNumber,
        supplier: this.supplier,
        lines: this.lines.map(l => ({ ...l, searching: false })),
        savedAt: Date.now()
      };
      localStorage.setItem(this.DRAFT_KEY, JSON.stringify(draft));
    } catch (error) {
      logError('[KVPurchaseOrderDialog] cacheState error:', error);
    }
  }

  private loadDraft(): boolean {
    try {
      const raw = localStorage.getItem(this.DRAFT_KEY);
      if (!raw) return false;
      const draft = JSON.parse(raw);
      if (!draft?.lines?.length) return false;
      this.fileName = draft.fileName || '';
      this.sellerName = draft.sellerName || '';
      this.invoiceNumber = draft.invoiceNumber || '';
      this.supplier = draft.supplier || null;
      this.lines = draft.lines;
      return true;
    } catch (error) {
      logError('[KVPurchaseOrderDialog] loadDraft error:', error);
      return false;
    }
  }

  /** Xóa nháp + reset màn hình để nhập hóa đơn mới */
  clearDraft(): void {
    localStorage.removeItem(this.DRAFT_KEY);
    this.lines = [];
    this.supplier = null;
    this.sellerName = '';
    this.invoiceNumber = '';
    this.fileName = '';
    this.submitError = '';
    this.restoredFromCache = false;
  }

  /** Ghi nhớ khi user sửa số hóa đơn */
  onInvoiceNumberChange(): void {
    this.cacheState();
  }

  // ============ Import XML ============

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // cho phép chọn lại cùng file
    if (!file) return;

    // Chặn parse chồng nhau (bắn dồn nhiều fetch → KiotViet lỗi "Failed to fetch")
    if (this.isParsing) {
      this.notify('Đang xử lý file trước, vui lòng đợi...');
      return;
    }

    if (!file.name.toLowerCase().endsWith('.xml')) {
      this.notify('Vui lòng chọn file XML hóa đơn');
      return;
    }

    this.isParsing = true;
    this.submitError = '';
    this.fileName = file.name;
    try {
      const parsed = await this.purchaseOrderService.parseXmlFile(file);
      this.lines = parsed.lines;
      this.sellerName = parsed.sellerName;
      this.invoiceNumber = parsed.invoiceNumber;

      // Khớp SP + NCC với KiotViet
      await Promise.all([
        this.purchaseOrderService.autoMatchLines(this.lines),
        this.purchaseOrderService
          .matchSupplier(parsed.sellerName)
          .then(s => (this.supplier = s))
      ]);
      this.isParsing = false;

      this.restoredFromCache = false;
      this.cacheState();

      // Dòng nào không khớp 100% → mở dialog cho user chọn candidate
      if (this.reviewCount > 0) {
        await this.openMatchReview();
      } else {
        this.notify(`Đã đọc ${this.lines.length} dòng, khớp đủ sản phẩm`);
      }
    } catch (error: any) {
      logError('[KVPurchaseOrderDialog] parse error:', error);
      this.notify(error?.message || 'Lỗi khi đọc file XML');
      this.fileName = '';
      this.isParsing = false;
    }
  }

  // ============ Review khớp sản phẩm ============

  /** Mở dialog xác nhận SP. `index` = chỉ review 1 dòng, bỏ trống = review mọi dòng chưa chắc chắn. */
  async openMatchReview(index?: number): Promise<void> {
    const targets = index !== undefined
      ? [{ line: this.lines[index], index }]
      : this.lines
          .map((line, i) => ({ line, index: i }))
          .filter(({ line }) => line.needsReview);

    if (!targets.length) {
      this.notify('Tất cả sản phẩm đã khớp');
      return;
    }

    const items: PurchaseMatchReviewItem[] = targets.map(({ line, index: i }) => ({
      lineIndex: i,
      description: line.xmlName,
      invoiceUnit: line.unit,
      candidates: [...line.candidates],
      selectedIdx: this.defaultSelectedIdx(line)
    }));

    const dialogRef = this.dialog.open(PurchaseMatchReviewDialogComponent, {
      width: '680px',
      maxWidth: '96vw',
      data: { items }
    });

    const result = (await firstValueFrom(dialogRef.afterClosed())) as PurchaseMatchReviewResult | undefined;
    if (!result) return;

    result.forEach((product, lineIndex) => {
      this.purchaseOrderService.setLineProduct(this.lines[lineIndex], product);
    });
    this.cacheState();
    log('[KVPurchaseOrderDialog] review xong, còn chưa khớp:', this.unmatchedCount);

    this.notify(
      this.unmatchedCount > 0
        ? `Còn ${this.unmatchedCount} dòng chưa khớp sản phẩm`
        : 'Đã khớp đủ sản phẩm'
    );
  }

  /** Candidate chọn sẵn: SP đang gán → ưu tiên candidate khớp đơn vị hóa đơn → candidate đầu */
  private defaultSelectedIdx(line: PurchaseLine): number {
    if (line.product) {
      return Math.max(0, line.candidates.findIndex(c => c.Id === line.product!.Id));
    }
    const targetUnit = this.purchaseOrderService.normalizeUnit(line.unit);
    if (targetUnit) {
      const unitIdx = line.candidates.findIndex(
        c => this.purchaseOrderService.normalizeUnit(c.Unit) === targetUnit
      );
      if (unitIdx >= 0) return unitIdx;
    }
    return line.candidates.length ? 0 : -1;
  }

  removeLine(index: number): void {
    this.lines.splice(index, 1);
    this.lines.forEach((line, i) => (line.stt = i + 1));
    this.cacheState();
  }

  // ============ Sửa số liệu trên bảng ============

  /** Đổi SL / đơn giá / chiết khấu → tính lại Thành tiền = SL × ĐG − CK */
  recalcLine(line: PurchaseLine): void {
    const quantity = Number(line.quantity) || 0;
    const unitPrice = Number(line.unitPrice) || 0;
    const discount = Number(line.discount) || 0;
    line.amount = Math.round(quantity * unitPrice - discount);
    this.cacheState();
  }

  matchPercent(line: PurchaseLine): number {
    return Math.round((line.matchScore || 0) * 100);
  }

  // ============ Tổng hợp ============

  get total(): number {
    return this.lines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
  }

  get totalQuantity(): number {
    return this.lines.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
  }

  get unmatchedCount(): number {
    return this.lines.filter(l => !l.product).length;
  }

  get reviewCount(): number {
    return this.lines.filter(l => l.needsReview).length;
  }

  get canSubmit(): boolean {
    return this.lines.length > 0 && this.unmatchedCount === 0 && !this.isSubmitting && !this.isParsing;
  }

  // ============ Gửi lên KiotViet ============

  saveDraft(): void {
    this.submit(false);
  }

  complete(): void {
    this.submit(true);
  }

  private async submit(complete: boolean): Promise<void> {
    if (!this.canSubmit) {
      if (this.unmatchedCount > 0) {
        this.notify(`Còn ${this.unmatchedCount} dòng chưa khớp sản phẩm KiotViet`);
      }
      return;
    }

    const label = complete ? 'Hoàn thành' : 'Lưu tạm';
    this.isSubmitting = true;
    this.submitError = '';
    try {
      const result = await this.purchaseOrderService.createPurchaseOrder(
        this.lines,
        this.supplier,
        this.invoiceNumber.trim(),
        complete
      );
      // Tạo phiếu thành công → xóa nháp để lần mở sau bắt đầu mới
      localStorage.removeItem(this.DRAFT_KEY);
      this.notify(`${label} phiếu nhập ${result?.Code || ''} thành công`);
      this.dialogRef.close({ created: true, complete, purchaseOrder: result });
    } catch (error: any) {
      // Giữ nguyên dữ liệu trên bảng để user sửa và gửi lại
      this.submitError = `${label} thất bại: ${error?.message || 'Lỗi không xác định'}`;
      logError('[KVPurchaseOrderDialog] submit error:', error);
      this.notify(this.submitError);
    } finally {
      this.isSubmitting = false;
    }
  }

  private notify(message: string): void {
    this.snackBar.open(message, 'Đóng', { duration: 5000 });
  }
}
