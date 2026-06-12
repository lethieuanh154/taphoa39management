import { Injectable, OnDestroy } from '@angular/core';
import { Subject, Observable } from 'rxjs';

export interface ProductOnHandUpdate {
  Id: number;
  OnHand: number;
  OnHandNV?: number;
  BasePrice?: number;
  Cost?: number;
}

@Injectable({ providedIn: 'root' })
export class CrossTabSyncService implements OnDestroy {
  private channel: BroadcastChannel;
  private updatesSubject = new Subject<ProductOnHandUpdate[]>();

  onHandUpdated$: Observable<ProductOnHandUpdate[]> = this.updatesSubject.asObservable();

  constructor() {
    this.channel = new BroadcastChannel('product-onhand-sync');
    this.channel.onmessage = (event: MessageEvent) => {
      if (event.data?.type === 'onhand-update' && Array.isArray(event.data.updates)) {
        this.updatesSubject.next(event.data.updates);
      }
    };
  }

  broadcastOnHandUpdate(updates: ProductOnHandUpdate[]): void {
    if (!updates || updates.length === 0) return;
    this.channel.postMessage({ type: 'onhand-update', updates });
  }

  ngOnDestroy(): void {
    this.channel.close();
    this.updatesSubject.complete();
  }
}
