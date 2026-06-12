import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-quick-calc-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule
  ],
  templateUrl: './quick-calc-dialog.component.html',
  styleUrls: ['./quick-calc-dialog.component.css']
})
export class QuickCalcDialogComponent implements OnInit {
  box: string = '';
  retail: string = '';
  discount: string = '';
  discount2: string = '';
  totalPrice: string = '';

  calculatedTotal: number = 0;
  largestChildRatio: number = 1; // Ratio to multiply Box when Enter is pressed

  constructor(
    public dialogRef: MatDialogRef<QuickCalcDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {}

  ngOnInit() {
    // Initialize with data from parent
    this.box = this.data.box?.toString() || '';
    this.retail = this.data.retail?.toString() || '';
    this.discount = this.data.discount?.toString() || '';
    this.discount2 = this.data.discount2?.toString() || '';
    this.totalPrice = this.data.totalPrice?.toString() || '';
    this.largestChildRatio = this.data.largestChildRatio || 1;

    // Calculate initial total
    this.calculate();
  }

  /**
   * Calculate total price from expression
   * Supports basic math: +, -, *, /
   */
  calculate() {
    try {
      // Evaluate each field if it's an expression
      const boxValue = this.evaluateExpression(this.box);
      const retailValue = this.evaluateExpression(this.retail);
      const discountValue = this.evaluateExpression(this.discount);
      const discount2Value = this.evaluateExpression(this.discount2);
      const totalValue = this.evaluateExpression(this.totalPrice);

      this.calculatedTotal = totalValue || 0;

      // Show calculated values in the UI
      this.updateCalculatedDisplay();
    } catch (error) {
      console.error('Calculation error:', error);
    }
  }

  /**
   * Evaluate mathematical expression
   * Example: "100*4" => 400
   */
  evaluateExpression(expr: string): number {
    if (!expr || expr.trim() === '') return 0;

    try {
      // Clean the expression
      const cleaned = expr.replace(/,/g, '').trim();

      // If it's just a number, return it
      if (/^-?\d+\.?\d*$/.test(cleaned)) {
        return Number(cleaned);
      }

      // Use Function constructor to safely evaluate math expressions
      // Only allow numbers and math operators
      if (!/^[\d\s+\-*/.()]+$/.test(cleaned)) {
        return 0;
      }

      const result = Function(`"use strict"; return (${cleaned})`)();
      return Number(result) || 0;
    } catch {
      return 0;
    }
  }

  private updateCalculatedDisplay() {
    // Update display with evaluated values
    const boxVal = this.evaluateExpression(this.box);
    const retailVal = this.evaluateExpression(this.retail);
    const discountVal = this.evaluateExpression(this.discount);
    const discount2Val = this.evaluateExpression(this.discount2);

    // Keep original expressions but show calculated results
  }

  onInputChange() {
    this.calculate();
  }

  onEnter(event: Event) {
    event.preventDefault();
    this.save();
  }

  save() {
    // Evaluate Box value and multiply by ratio BEFORE saving
    let boxValue = this.evaluateExpression(this.box);

    // Evaluate all expressions before saving
    const result = {
      saved: true,
      box: boxValue, // Use the multiplied value
      retail: this.evaluateExpression(this.retail),
      discount: this.evaluateExpression(this.discount),
      discount2: this.evaluateExpression(this.discount2),
      totalPrice: this.evaluateExpression(this.totalPrice)
    };

    this.dialogRef.close(result);
  }

  cancel() {
    this.dialogRef.close({ saved: false });
  }

  formatNumber(value: number): string {
    if (isNaN(value)) return '0';
    return value.toLocaleString('en-US');
  }
}
