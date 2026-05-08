import {
  Component, Input, OnChanges, SimpleChanges,
  AfterViewInit, OnDestroy, ElementRef, ViewChild,
  ChangeDetectionStrategy
} from '@angular/core';
import * as L from 'leaflet';
import { Subscription } from 'rxjs';
import { timeout } from 'rxjs/operators';
import { DeliveryOrder, DeliveryStatus } from '../../models/delivery.model';
import { environment } from '../../../environments/environment';
import { HttpClient } from '@angular/common/http';

// Fix Leaflet default icon path issue with bundlers
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const STATUS_COLORS: Record<DeliveryStatus, string> = {
  pending: '#2196F3',
  picking: '#FF9800',
  picked: '#FF9800',
  in_transit: '#FFC107',
  arrived: '#F44336',
  delivered: '#4CAF50',
  failed: '#9E9E9E'
};

const STATUS_LABELS: Record<DeliveryStatus, string> = {
  pending: 'Chờ giao',
  picking: 'Đang lấy hàng',
  picked: 'Đã lấy hàng',
  in_transit: 'Đang di chuyển',
  arrived: 'Đã đến',
  delivered: 'Đã giao',
  failed: 'Thất bại'
};

@Component({
  selector: 'app-delivery-map',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div #mapContainer class="delivery-map"></div>`,
  styles: [`
    .delivery-map {
      width: 100%;
      height: 100%;
      min-height: 400px;
      border-radius: 8px;
      z-index: 1;
    }
  `]
})
export class DeliveryMapComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('mapContainer') mapContainer!: ElementRef;
  @Input() orders: DeliveryOrder[] = [];
  @Input() activeOrderIndex = -1;
  @Input() showRoute = true;

  private map: L.Map | null = null;
  private markers: L.Marker[] = [];
  private routeLine: L.Polyline | null = null;
  private routeSub: Subscription | null = null;
  private polylineCoords: [number, number][] = [];

  constructor(private http: HttpClient) {}

  ngAfterViewInit(): void {
    this.initMap();
    this.updateMarkers();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.map && (changes['orders'] || changes['activeOrderIndex'] || changes['showRoute'])) {
      this.updateMarkers();
    }
  }

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
    this.map?.remove();
    this.map = null;
  }

  private initMap(): void {
    this.map = L.map(this.mapContainer.nativeElement, {
      center: [environment.storeLat, environment.storeLng],
      zoom: 14,
      zoomControl: true
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19
    }).addTo(this.map);

    // Store marker
    const storeIcon = L.divIcon({
      html: `<div style="background:#E91E63;color:#fff;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:16px;box-shadow:0 2px 6px rgba(0,0,0,0.3);border:2px solid #fff;">🏪</div>`,
      className: '',
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
    L.marker([environment.storeLat, environment.storeLng], { icon: storeIcon })
      .addTo(this.map)
      .bindPopup('<strong>Cửa hàng Song Minh</strong><br>25 Nguyễn Phước Tần, Cẩm Lệ');
  }

  private updateMarkers(): void {
    if (!this.map) return;

    // Clear old
    this.markers.forEach(m => m.remove());
    this.markers = [];
    this.routeLine?.remove();
    this.routeLine = null;
    this.polylineCoords = [];

    if (!this.orders.length) return;

    // Add order markers
    const bounds = L.latLngBounds([[environment.storeLat, environment.storeLng]]);

    this.orders.forEach((order, i) => {
      if (!order.lat || !order.lng) return;

      const color = STATUS_COLORS[order.status] || '#2196F3';
      const isActive = i === this.activeOrderIndex;
      const size = isActive ? 36 : 28;

      const icon = L.divIcon({
        html: `<div style="background:${color};color:#fff;width:${size}px;height:${size}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:${isActive ? 16 : 13}px;box-shadow:0 2px 6px rgba(0,0,0,0.3);border:${isActive ? '3px solid #fff' : '2px solid #fff'};">${order.sequence}</div>`,
        className: '',
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2]
      });

      const marker = L.marker([order.lat, order.lng], { icon })
        .addTo(this.map!)
        .bindPopup(`
          <strong>#${order.sequence} - ${order.customerName}</strong><br>
          ${order.address}<br>
          📞 ${order.customerPhone}<br>
          📏 ${order.distanceFromPrev}km từ điểm trước<br>
          ⏰ Dự kiến: ${order.estimatedArrival || '—'}<br>
          <span style="color:${color};font-weight:bold;">${STATUS_LABELS[order.status]}</span>
        `);

      this.markers.push(marker);
      bounds.extend([order.lat, order.lng] as L.LatLngTuple);
    });

    // Draw route line
    if (this.showRoute && this.orders.length > 0) {
      this.routeSub?.unsubscribe();
      this.drawRoute();
    }

    // Fit bounds
    this.map.fitBounds(bounds, { padding: [40, 40] });
  }

  /** Try OSRM for real road route, fallback to straight polyline */
  private drawRoute(): void {
    if (!this.map) return;

    const coords = [
      [environment.storeLng, environment.storeLat],
      ...this.orders.filter(o => o.lat && o.lng).map(o => [o.lng, o.lat])
    ];
    const coordStr = coords.map(c => `${c[0]},${c[1]}`).join(';');
    const osrmUrl = `${environment.domainUrl}/api/osrm/route?coords=${encodeURIComponent(coordStr)}`;

    this.routeSub = this.http.get<any>(osrmUrl).pipe(timeout(8000)).subscribe({
      next: (res) => {
        if (res.routes?.[0]?.geometry?.coordinates) {
          const latlngs = res.routes[0].geometry.coordinates.map(
            (c: number[]) => [c[1], c[0]] as L.LatLngTuple
          );
          this.polylineCoords = latlngs;
          this.routeLine = L.polyline(latlngs, {
            color: '#1976D2',
            weight: 4,
            opacity: 0.8,
            dashArray: '8, 4'
          }).addTo(this.map!);
        } else {
          this.drawStraightRoute();
        }
      },
      error: () => this.drawStraightRoute()
    });
  }

  private drawStraightRoute(): void {
    if (!this.map) return;
    const latlngs: L.LatLngTuple[] = [
      [environment.storeLat, environment.storeLng],
      ...this.orders.filter(o => o.lat && o.lng).map(o => [o.lat, o.lng] as L.LatLngTuple)
    ];
    this.routeLine = L.polyline(latlngs, {
      color: '#1976D2',
      weight: 3,
      opacity: 0.6,
      dashArray: '6, 6'
    }).addTo(this.map);
  }

  /** Get route polyline coordinates for tracking docs */
  getRoutePolyline(): [number, number][] {
    return this.polylineCoords;
  }
}
