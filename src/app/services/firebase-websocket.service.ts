import { Injectable, NgZone, inject, OnDestroy } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Subject, Observable, Subscription } from 'rxjs';
import { filter, map, skip, distinctUntilChanged } from 'rxjs/operators';
import { BackendUrlService } from './backend-url.service';

type AnyEvent = { namespace: string; event: string; args: any[] };

/**
 * Firebase real-time communication service using Socket.IO
 * Note: Configured to use HTTP long-polling only (WebSocket transport disabled)
 * This ensures compatibility with all server configurations.
 */
@Injectable({ providedIn: 'root' })
export class FirebaseWebsocketService implements OnDestroy {
  private backendUrlService = inject(BackendUrlService);
  private urlChangeSub: Subscription | null = null;
  private namespacePaths = {
    products: '/api/websocket/products',
    customers: '/api/websocket/customers',
    invoices: '/api/websocket/invoices',
    orders: '/api/websocket/orders',
  } as const;

  private sockets: Partial<Record<keyof typeof this.namespacePaths, Socket | null>> = {
    products: null,
    customers: null,
    invoices: null,
    orders: null,
  };

  private anySubject = new Subject<AnyEvent>();
  public any$: Observable<AnyEvent> = this.anySubject.asObservable();

  constructor(private zone: NgZone) {
    // Reconnect all sockets when backend URL changes (failover)
    this.urlChangeSub = this.backendUrlService.getUrlChanges$().pipe(
      skip(1),
      distinctUntilChanged()
    ).subscribe((newUrl) => {
      console.log('🔄 [FirebaseWebsocket] Backend URL changed, reconnecting to:', newUrl);
      this.disconnectAll();
      this.connect();
    });
  }

  connect(): void {
    // Create a socket for every namespace if not already connected
    for (const ns of Object.keys(this.namespacePaths) as Array<keyof typeof this.namespacePaths>) {
      if (this.sockets[ns]) {
        continue;
      }
      try {
        const url = this.backendUrlService.getActiveUrl() || window.location.origin;
        const socket = io(`${url}${this.namespacePaths[ns]}`, {
          transports: ['polling'],  // Use polling only, WebSocket disabled
          reconnectionAttempts: 5,
          reconnectionDelay: 1000
        });
        // forward any event
        socket.onAny((event: string, ...args: any[]) => {
          // Run inside Angular zone so subscribers trigger change detection
          this.zone.run(() => this.anySubject.next({ namespace: ns as string, event, args }));
        });
        socket.on('connect', () => {
          this.zone.run(() => this.anySubject.next({ namespace: ns as string, event: 'connect', args: [] }));
        });
        socket.on('disconnect', (reason: any) => {
          this.zone.run(() => this.anySubject.next({ namespace: ns as string, event: 'disconnect', args: [reason] }));
        });
        this.sockets[ns] = socket;
      } catch (err) {
        // best-effort: swallow and continue
        // emit an error event
        this.zone.run(() => this.anySubject.next({ namespace: ns as string, event: 'error', args: [err] }));
      }
    }
  }

  disconnectAll(): void {
    for (const ns of Object.keys(this.sockets) as Array<keyof typeof this.sockets>) {
      const s = this.sockets[ns];
      if (s) {
        try {
          s.removeAllListeners();
          s.disconnect();
        } catch {
          // ignore
        }
        this.sockets[ns] = null;
      }
    }
  }

  isConnected(namespaceName: keyof typeof this.namespacePaths): boolean {
    const s = this.sockets[namespaceName];
    return !!(s && (s as any).connected);
  }

  // Allow server-side rooms subscription via the namespace `subscribe` event
  async joinRoom(namespaceName: keyof typeof this.namespacePaths, room: string): Promise<void> {
    const s = this.sockets[namespaceName];
    if (!s) return;
    s.emit('subscribe', { rooms: [room] });
  }

  async leaveRoom(namespaceName: keyof typeof this.namespacePaths, room: string): Promise<void> {
    const s = this.sockets[namespaceName];
    if (!s) return;
    s.emit('unsubscribe', { rooms: [room] });
  }

  // Convenience filtered observables
  public invoiceCreated$(): Observable<any> {
    return this.any$.pipe(
      filter(e => e.namespace === 'invoices' && (e.event === 'created' || e.event === 'invoice_created' || e.event === 'invoice:created')),
      map(e => e.args[0])
    );
  }

  public invoiceUpdated$(): Observable<any> {
    return this.any$.pipe(
      filter(e => e.namespace === 'invoices' && (e.event === 'updated' || e.event === 'invoice_updated' || e.event === 'invoice:updated')),
      map(e => e.args[0])
    );
  }

  public invoiceDeleted$(): Observable<any> {
    return this.any$.pipe(
      filter(e => e.namespace === 'invoices' && (e.event === 'deleted' || e.event === 'invoice_deleted' || e.event === 'invoice:deleted')),
      map(e => e.args[0])
    );
  }

  public productEvents$(): Observable<AnyEvent> {
    return this.any$.pipe(filter(e => e.namespace === 'products'));
  }

  public customerEvents$(): Observable<AnyEvent> {
    return this.any$.pipe(filter(e => e.namespace === 'customers'));
  }

  public orderEvents$(): Observable<AnyEvent> {
    return this.any$.pipe(filter(e => e.namespace === 'orders'));
  }

  /**
   * Generic notify stream. Filters common notify event names.
   * If `namespaceName` is provided, only notifications from that namespace are returned.
   */
  public notify$(namespaceName?: keyof typeof this.namespacePaths): Observable<any> {
    const notifyNames = new Set(['notify', 'changed', 'data_changed', 'update', 'updated', 'sync_needed']);
    return this.any$.pipe(
      filter(e => notifyNames.has(e.event) && (!namespaceName || e.namespace === namespaceName)),
      map(e => e.args[0])
    );
  }

  ngOnDestroy(): void {
    this.urlChangeSub?.unsubscribe();
    this.disconnectAll();
  }
}
