import { Component } from '@angular/core';
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
export class KiotVietPurchaseOrderDialogComponent {
  lines: PurchaseLine[] = [];
  supplier: KiotVietSupplier | null = null;
  sellerName = '';
  invoiceNumber = '';

  fileName = '';
  isParsing = false;
  isSubmitting = false;
  submitError = '';

  constructor(
    public dialogRef: MatDialogRef<KiotVietPurchaseOrderDialogComponent>,
    private dialog: MatDialog,
    private purchaseOrderService: KiotVietPurchaseOrderService,
    private snackBar: MatSnackBar
  ) {}

  // ============ Import XML ============

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // cho phép chọn lại cùng file
    if (!file) return;

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
      // Chọn sẵn SP đang gán, không có thì gợi ý candidate đầu tiên
      selectedIdx: line.product
        ? Math.max(0, line.candidates.findIndex(c => c.Id === line.product!.Id))
        : (line.candidates.length ? 0 : -1)
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
    log('[KVPurchaseOrderDialog] review xong, còn chưa khớp:', this.unmatchedCount);

    this.notify(
      this.unmatchedCount > 0
        ? `Còn ${this.unmatchedCount} dòng chưa khớp sản phẩm`
        : 'Đã khớp đủ sản phẩm'
    );
  }

  removeLine(index: number): void {
    this.lines.splice(index, 1);
    this.lines.forEach((line, i) => (line.stt = i + 1));
  }

  // ============ Sửa số liệu trên bảng ============

  /** Đổi SL / đơn giá / chiết khấu → tính lại Thành tiền = SL × ĐG − CK */
  recalcLine(line: PurchaseLine): void {
    const quantity = Number(line.quantity) || 0;
    const unitPrice = Number(line.unitPrice) || 0;
    const discount = Number(line.discount) || 0;
    line.amount = Math.round(quantity * unitPrice - discount);
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
