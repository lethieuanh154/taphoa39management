import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';

import { MatButtonModule } from '@angular/material/button';

import {  MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';

@Component({
  selector: 'low-stock-dialog', standalone: true,
  imports: [
    CommonModule,
    MatDialogModule, // Đảm bảo MatDialogModule được import
    MatTableModule,
    MatButtonModule
  ],
  templateUrl: './low-stock-dialog.component.html',
  styleUrls: ['./dialog.component.css']
})

export class LowStockDialog {
  displayedColumns: string[] = ['Code', 'FullName', 'OnHand'];
  filteredProducts: any[] = []; // Lưu danh sách sản phẩm đã lọc

  constructor(
    public dialogRef: MatDialogRef<LowStockDialog>,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {
    // Lọc bỏ các sản phẩm có đơn vị là "thùng"
    this.filteredProducts = data.products.filter((product: any) => {
      return !/thùng/i.test(product.Unit) && !/lốc/i.test(product.Unit);
    });
  }

  onNoClick(): void {
    this.dialogRef.close(false);
  }
}