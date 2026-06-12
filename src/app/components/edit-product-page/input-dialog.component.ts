import { Component, OnInit, Inject } from '@angular/core';

import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';

import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { FormsModule } from '@angular/forms';

@Component({
    selector: 'input-dialog', standalone: true,
    imports: [
        CommonModule,
        MatDialogModule,
        MatButtonModule,
        MatTableModule,
        MatTooltipModule,
        FormsModule // 
    ],
    templateUrl: './input-dialog.component.html',
    styleUrls: ['./dialog.component.css']
})

export class InputDialog {
    displayedColumns: string[] = ['Box', 'Retail', 'Discount', 'Discount2', 'TotalPrice'];
    box: any = '';
    retail: any = '';
    discount: any = '';
    discount2: any = '';
    totalPrice: any = '';
    inputRows = [{}];
    constructor(
        public dialogRef: MatDialogRef<InputDialog>,
        @Inject(MAT_DIALOG_DATA) public data: any) { }
    private evaluateExpression(expr: any): string {
        if (!expr) return '';
        try {
            const result = Function(`"use strict"; return (${expr})`)();
            return result.toString();
        } catch {
            return 'Lỗi';
        }
    }
    onOkClick(): void {
        this.box = this.evaluateExpression(this.box) || 0;
        this.retail = this.evaluateExpression(this.retail) || 0;
        this.discount = this.evaluateExpression(this.discount) || 0;
        this.discount2 = this.evaluateExpression(this.discount2) || 0;
        this.totalPrice = this.evaluateExpression(this.totalPrice) || 0;
        this.inputRows.push(this.box, this.retail, this.discount, this.discount2, this.totalPrice)

        this.dialogRef.close({
            box: this.box,
            retail: this.retail,
            discount: this.discount,
            discount2: this.discount2,
            totalPrice: this.totalPrice
        });
    }
}