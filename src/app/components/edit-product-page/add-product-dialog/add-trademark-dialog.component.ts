import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { KiotvietService } from '../../../services/kiotviet.service';

@Component({
  selector: 'app-add-trademark-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule
  ],
  template: `
    <div class="add-trademark-dialog">
      <h2 mat-dialog-title>
        <mat-icon>add_business</mat-icon>
        Thêm thương hiệu
      </h2>

      <mat-dialog-content>
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Tên thương hiệu</mat-label>
          <input matInput [(ngModel)]="trademarkName" placeholder="Nhập tên thương hiệu" required />
          <mat-icon matPrefix>badge</mat-icon>
        </mat-form-field>
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button mat-button (click)="onCancel()" [disabled]="saving">Hủy</button>
        <button mat-raised-button color="primary" (click)="onSave()" [disabled]="!trademarkName.trim() || saving">
          <mat-spinner *ngIf="saving" diameter="20"></mat-spinner>
          <mat-icon *ngIf="!saving">save</mat-icon>
          <span>{{ saving ? 'Đang lưu...' : 'Lưu' }}</span>
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .add-trademark-dialog {
      min-width: 350px;
    }

    h2[mat-dialog-title] {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      padding: 16px 24px;
      background: linear-gradient(135deg, #1976d2 0%, #42a5f5 100%);
      color: white;
      border-radius: 4px 4px 0 0;
    }

    mat-dialog-content {
      padding: 24px;
    }

    .full-width {
      width: 100%;
      padding-top:10px;
    }

    mat-dialog-actions {
      padding: 8px 24px 16px;
      gap: 8px;
    }

    mat-dialog-actions button {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    mat-spinner {
      display: inline-block;
    }
  `]
})
export class AddTrademarkDialogComponent {
  trademarkName = '';
  saving = false;

  constructor(
    private dialogRef: MatDialogRef<AddTrademarkDialogComponent>,
    private kiotvietService: KiotvietService
  ) {}

  onCancel(): void {
    this.dialogRef.close();
  }

  async onSave(): Promise<void> {
    if (!this.trademarkName.trim()) return;

    this.saving = true;
    try {
      const result = await this.kiotvietService.createTrademark(this.trademarkName.trim());
      console.log('Created trademark:', result);

      // Return the created trademark data
      this.dialogRef.close({
        saved: true,
        trademark: result?.Data || { Id: null, Name: this.trademarkName.trim() }
      });
    } catch (error) {
      console.error('Error creating trademark:', error);
      alert('Lỗi khi tạo thương hiệu: ' + (error as Error).message);
      this.saving = false;
    }
  }
}
