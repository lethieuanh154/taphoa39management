import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { InvoiceTab } from '../models/invoice.model';

export interface OrderToInvoiceData {
  order: InvoiceTab;
  orderId: string;
}

@Injectable({
  providedIn: 'root'
})
export class OrderToInvoiceService {
  private orderProcessedSubject = new Subject<OrderToInvoiceData>();
  public orderProcessed$ = this.orderProcessedSubject.asObservable();

  constructor() { }

  // Emit event when order is processed
  processOrder(order: InvoiceTab, orderId: string): void {
    this.orderProcessedSubject.next({ order, orderId });
  }
} 