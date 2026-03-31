import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FormsModule } from '@angular/forms';
import { Promotion } from '../../models/promotion.model';
import { PromotionService } from '../../services/promotion.service';
import { PromotionDialogComponent, PromotionDialogData } from '../promotion-dialog/promotion-dialog.component';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-promotion-list-page',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatSlideToggleModule,
    MatSnackBarModule,
    MatTooltipModule,
    FormsModule,
  ],
  templateUrl: './promotion-list-page.component.html',
  styleUrls: ['./promotion-list-dialog.component.css'],
})
export class PromotionListPageComponent implements OnInit {
  promotions: Promotion[] = [];
  isLoading = false;

  constructor(
    private dialog: MatDialog,
    private promotionService: PromotionService,
    private snackBar: MatSnackBar,
    private http: HttpClient
  ) {}

  ngOnInit() {
    this.loadPromotions();
  }

  loadPromotions() {
    this.isLoading = true;
    this.promotionService.getAllPromotions(true).subscribe({
      next: (promos) => {
        this.promotions = promos;
        this.isLoading = false;
      },
      error: (err) => {
        console.error('Load promotions error:', err);
        this.snackBar.open('Lỗi khi tải danh sách khuyến mại', 'OK', { duration: 3000 });
        this.isLoading = false;
      }
    });
  }

  getTypeBadges(promo: Promotion): { label: string; cssClass: string }[] {
    const badges: { label: string; cssClass: string }[] = [];
    const hasGift = promo.hasGift ?? promo.type === 'gift';
    const hasDiscount = (promo.hasPercentDiscount ?? promo.type === 'percentage')
                     || (promo.hasFixedDiscount ?? promo.type === 'fixed_amount');

    if (hasGift) {
      badges.push({ label: 'Tặng kèm', cssClass: 'type-gift' });
    } else if (hasDiscount && promo.giftProductId) {
      badges.push({ label: 'Mua A giảm B', cssClass: 'type-percent' });
    } else if (hasDiscount) {
      badges.push({ label: 'Giảm giá', cssClass: 'type-fixed' });
    }
    return badges;
  }

  getPromoDetail(promo: Promotion): string {
    const hasGift = promo.hasGift ?? promo.type === 'gift';
    const hasPct = promo.hasPercentDiscount ?? promo.type === 'percentage';
    const hasFixed = promo.hasFixedDiscount ?? promo.type === 'fixed_amount';
    const hasDiscount = hasPct || hasFixed;
    const discountText = hasPct && promo.discountPercent
      ? `${promo.discountPercent}%`
      : hasFixed && promo.discountAmount
        ? `${promo.discountAmount.toLocaleString()}đ`
        : '';

    if (hasGift && promo.giftProductName) {
      return `Tặng ${promo.giftQuantity} x ${promo.giftProductName}`;
    }
    if (hasDiscount && promo.giftProductId && promo.giftProductName) {
      return `Giảm ${discountText} cho ${promo.giftQuantity} x ${promo.giftProductName}`;
    }
    if (hasDiscount) {
      return `Giảm ${discountText}`;
    }
    return '';
  }

  isExpired(promo: Promotion): boolean {
    if (!promo.toDate) return false;
    return new Date(promo.toDate) < new Date();
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('vi-VN');
  }

  onToggle(promo: Promotion) {
    this.promotionService.togglePromotion(promo.id, promo.isEnabled).subscribe({
      next: () => {
        this.snackBar.open(
          promo.isEnabled ? 'Đã BẬT khuyến mại' : 'Đã TẮT khuyến mại',
          'OK', { duration: 2000 }
        );
      },
      error: (err) => {
        console.error('Toggle error:', err);
        promo.isEnabled = !promo.isEnabled;
        this.snackBar.open('Lỗi khi cập nhật trạng thái', 'OK', { duration: 3000 });
      }
    });
  }

  onEdit(promo: Promotion) {
    const dialogRef = this.dialog.open(PromotionDialogComponent, {
      width: '700px',
      data: { mode: 'edit', promotion: promo } as PromotionDialogData,
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result?.saved) {
        this.loadPromotions();
      }
    });
  }

  onDelete(promo: Promotion) {
    if (!confirm(`Xóa khuyến mại "${promo.name}"?`)) return;

    const campaignId = (promo as any).kiotVietCampaignId;
    if (campaignId) {
      this.deleteKiotVietCampaign(campaignId);
    }

    this.promotionService.deletePromotion(promo.id).subscribe({
      next: () => {
        this.promotions = this.promotions.filter(p => p.id !== promo.id);
        this.snackBar.open('Đã xóa khuyến mại', 'OK', { duration: 2000 });
      },
      error: (err) => {
        console.error('Delete error:', err);
        this.snackBar.open('Lỗi khi xóa khuyến mại', 'OK', { duration: 3000 });
      }
    });
  }

  private deleteKiotVietCampaign(campaignId: number) {
    const url = `${environment.domainUrl}/api/kiotviet/campaigns/${campaignId}`;
    this.http.delete<any>(url).subscribe({
      next: (res) => {
        if (res.success) {
          console.log('KiotViet campaign deleted:', campaignId);
          this.snackBar.open('Đã xóa KM trên KiotViet', 'OK', { duration: 2000 });
        }
      },
      error: (err) => {
        console.error('KiotViet campaign delete error:', err);
      }
    });
  }

  onCreate() {
    const dialogRef = this.dialog.open(PromotionDialogComponent, {
      width: '700px',
      data: { mode: 'create' } as PromotionDialogData,
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result?.saved) {
        this.loadPromotions();
      }
    });
  }
}
