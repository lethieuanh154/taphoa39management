import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { DeliveryOrder, DeliveryRoute } from '../models/delivery.model';

const STORE_LAT = environment.storeLat;
const STORE_LNG = environment.storeLng;
const ROAD_FACTOR = 1.3;
const AVG_SPEED_KMH = 25;
/** Buffer per delivery stop (parking, walking, handoff) in minutes */
const STOP_BUFFER_MIN = 5;

@Injectable({ providedIn: 'root' })
export class DeliveryRouteService {

  constructor(private http: HttpClient) {}

  /** Convert raw orders (from OrderService) into DeliveryOrder list */
  ordersToDeliveryOrders(rawOrders: any[]): DeliveryOrder[] {
    return rawOrders
      .filter(o => o.wantDelivery)
      .map((o, i) => ({
        orderId: o.id,
        customerName: o.customer?.Name || '',
        customerPhone: o.customer?.ContactNumber || '',
        address: o.customer?.Address || '',
        lat: o.lat || 0,
        lng: o.lng || 0,
        distanceFromPrev: 0,
        cumulativeDistance: 0,
        estimatedArrival: '',
        desiredDeliveryDate: o.desiredDeliveryDate || '',
        desiredDeliveryTime: o.desiredDeliveryTime || '',
        status: o.deliveryStatus || 'pending',
        sequence: i + 1,
        note: o.note || '',
        totalPrice: o.totalPrice || 0
      }));
  }

  /** Main optimize: OSRM distance matrix → NN → 2-opt. Fallback: haversine */
  async optimizeRoute(orders: DeliveryOrder[]): Promise<DeliveryOrder[]> {
    if (orders.length <= 1) return this.recalcDistances(orders);
    let matrix: number[][] | null = null;
    try { matrix = await this.fetchOsrmMatrix(orders); } catch {}
    const route = matrix
      ? this.twoOptMatrix(this.nearestNeighborMatrix(orders, matrix), orders, matrix)
      : this.twoOptImprove(this.nearestNeighbor(orders));
    return this.recalcDistances(route);
  }

  /** Recalc distances/sequence without re-optimizing (for manual reorder) */
  recalcOrder(orders: DeliveryOrder[]): DeliveryOrder[] {
    return this.recalcDistances(orders);
  }

  /** Calculate schedule: estimated arrival at each stop */
  calculateSchedule(orders: DeliveryOrder[], startTime: string): DeliveryOrder[] {
    const [h, m] = startTime.split(':').map(Number);
    let currentMinutes = h * 60 + m;

    let prevLat = STORE_LAT;
    let prevLng = STORE_LNG;

    return orders.map((order, i) => {
      const hasCoords = !!(order.lat && order.lng);
      const dist = hasCoords
        ? this.haversineDistance(prevLat, prevLng, order.lat, order.lng) * ROAD_FACTOR
        : 0;
      const travelMin = (dist / AVG_SPEED_KMH) * 60;
      currentMinutes += travelMin + (i > 0 ? STOP_BUFFER_MIN : 0);

      const arrH = Math.floor(currentMinutes / 60) % 24;
      const arrM = Math.round(currentMinutes % 60);

      if (hasCoords) { prevLat = order.lat; prevLng = order.lng; }

      return {
        ...order,
        estimatedArrival: `${arrH.toString().padStart(2, '0')}:${arrM.toString().padStart(2, '0')}`
      };
    });
  }

  /** Build a DeliveryRoute object from optimized orders */
  buildRoute(orders: DeliveryOrder[], date: string, driverName: string, startTime: string): DeliveryRoute {
    const scheduled = this.calculateSchedule(orders, startTime);
    const totalKm = this.totalRouteDistance(scheduled);
    const totalMin = Math.ceil((totalKm / AVG_SPEED_KMH) * 60) + (scheduled.length * STOP_BUFFER_MIN);

    return {
      id: `DR-${Date.now()}`,
      date,
      driverName,
      orders: scheduled,
      totalDistanceKm: Math.ceil(totalKm * 10) / 10,
      estimatedDurationMinutes: totalMin,
      estimatedStartTime: startTime,
      optimized: true,
      status: 'planning',
      createdAt: new Date().toISOString()
    };
  }

  /** Total route distance: Store → order1 → order2 → ... (no return) */
  totalRouteDistance(orders: DeliveryOrder[]): number {
    if (!orders.length) return 0;
    let total = 0;
    let prevLat = STORE_LAT;
    let prevLng = STORE_LNG;
    for (const o of orders) {
      if (!o.lat || !o.lng) continue;
      total += this.haversineDistance(prevLat, prevLng, o.lat, o.lng) * ROAD_FACTOR;
      prevLat = o.lat;
      prevLng = o.lng;
    }
    return total;
  }

  /** Haversine: straight-line distance in km */
  haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = this.toRad(lat2 - lat1);
    const dLng = this.toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(this.toRad(lat1))
      * Math.cos(this.toRad(lat2))
      * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // --- Private ---

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  /**
   * Fetch OSRM road distance matrix (meters).
   * Returns (N+1)×(N+1): index 0 = store, index i+1 = orders[i].
   * Orders without coords remain Infinity in the matrix.
   */
  private async fetchOsrmMatrix(orders: DeliveryOrder[]): Promise<number[][]> {
    const validIdx: number[] = [];
    orders.forEach((o, i) => { if (o.lat && o.lng) validIdx.push(i); });
    if (!validIdx.length) throw new Error('no coords');

    const coordStr = [
      `${STORE_LNG},${STORE_LAT}`,
      ...validIdx.map(i => `${orders[i].lng},${orders[i].lat}`)
    ].join(';');

    const res = await firstValueFrom(
      this.http.get<{ distances: number[][] }>(
        `${environment.domainUrl}/api/osrm/table?coords=${encodeURIComponent(coordStr)}`
      )
    );

    // Expand compact OSRM matrix → full (N+1)×(N+1)
    const N = orders.length + 1;
    const full = Array.from({ length: N }, (_, r) =>
      Array.from({ length: N }, (_, c) => r === c ? 0 : Infinity)
    );
    validIdx.forEach((orderIdx, k) => {
      const mr = k + 1; // row in OSRM response (0 = store)
      full[0][orderIdx + 1] = res.distances[0][mr];
      full[orderIdx + 1][0] = res.distances[mr][0];
      validIdx.forEach((otherIdx, m) => {
        full[orderIdx + 1][otherIdx + 1] = res.distances[mr][m + 1];
      });
    });
    return full;
  }

  /** Nearest Neighbor using OSRM road distance matrix */
  private nearestNeighborMatrix(orders: DeliveryOrder[], matrix: number[][]): DeliveryOrder[] {
    const remaining = orders.map((_, i) => i);
    const route: DeliveryOrder[] = [];
    let cur = 0; // matrix index (0 = store)

    while (remaining.length > 0) {
      let minDist = Infinity, minPos = 0;
      for (let pos = 0; pos < remaining.length; pos++) {
        const d = matrix[cur][remaining[pos] + 1];
        if (d < minDist) { minDist = d; minPos = pos; }
      }
      const orderIdx = remaining.splice(minPos, 1)[0];
      route.push(orders[orderIdx]);
      cur = orderIdx + 1;
    }
    return route;
  }

  /** 2-opt local search using OSRM road distance matrix */
  private twoOptMatrix(route: DeliveryOrder[], original: DeliveryOrder[], matrix: number[][]): DeliveryOrder[] {
    if (route.length < 3) return route;
    const idxMap = new Map<DeliveryOrder, number>();
    original.forEach((o, i) => idxMap.set(o, i + 1));
    const mi = (o: DeliveryOrder) => idxMap.get(o)!;
    const d = (a: number, b: number) => matrix[a]?.[b] ?? Infinity;

    let improved = true, iter = 0;
    while (improved && iter < 100) {
      improved = false; iter++;
      for (let i = 0; i < route.length - 1; i++) {
        for (let j = i + 2; j < route.length; j++) {
          const a = mi(route[i]), b = mi(route[i + 1]);
          const c = mi(route[j]);
          const e = j + 1 < route.length ? mi(route[j + 1]) : -1;
          const gain = d(a, b) + (e >= 0 ? d(c, e) : 0)
                     - d(a, c) - (e >= 0 ? d(b, e) : 0);
          if (gain > 1) { this.reverseSegment(route, i + 1, j); improved = true; }
        }
      }
    }
    return route;
  }

  /** Nearest Neighbor heuristic (haversine fallback) */
  private nearestNeighbor(orders: DeliveryOrder[]): DeliveryOrder[] {
    const remaining = [...orders];
    const route: DeliveryOrder[] = [];
    let curLat = STORE_LAT;
    let curLng = STORE_LNG;

    while (remaining.length > 0) {
      let minDist = Infinity;
      let minIdx = 0;
      for (let i = 0; i < remaining.length; i++) {
        const d = (remaining[i].lat && remaining[i].lng)
          ? this.haversineDistance(curLat, curLng, remaining[i].lat, remaining[i].lng)
          : Infinity;
        if (d < minDist) { minDist = d; minIdx = i; }
      }
      const next = remaining.splice(minIdx, 1)[0];
      route.push(next);
      if (next.lat && next.lng) { curLat = next.lat; curLng = next.lng; }
    }
    return route;
  }

  /** 2-opt local search improvement (haversine fallback) */
  private twoOptImprove(orders: DeliveryOrder[]): DeliveryOrder[] {
    if (orders.length < 3) return orders;

    const route = [...orders];
    let improved = true;
    let iterations = 0;
    const maxIterations = 100;

    while (improved && iterations < maxIterations) {
      improved = false;
      iterations++;
      for (let i = 0; i < route.length - 1; i++) {
        for (let j = i + 2; j < route.length; j++) {
          if (this.twoOptGain(route, i, j) > 0) {
            this.reverseSegment(route, i + 1, j);
            improved = true;
          }
        }
      }
    }
    return route;
  }

  /** Calculate distance gain from 2-opt swap */
  private twoOptGain(route: DeliveryOrder[], i: number, j: number): number {
    const prevI = i === 0
      ? { lat: STORE_LAT, lng: STORE_LNG }
      : route[i];
    const nextA = route[i + 1];
    const b = route[j];
    const nextB = j + 1 < route.length ? route[j + 1] : null;

    const d1 = this.haversineDistance(prevI.lat, prevI.lng, nextA.lat, nextA.lng);
    const d2 = nextB
      ? this.haversineDistance(b.lat, b.lng, nextB.lat, nextB.lng)
      : 0;

    const d3 = this.haversineDistance(prevI.lat, prevI.lng, b.lat, b.lng);
    const d4 = nextB
      ? this.haversineDistance(nextA.lat, nextA.lng, nextB.lat, nextB.lng)
      : 0;

    return (d1 + d2) - (d3 + d4);
  }

  private reverseSegment(arr: DeliveryOrder[], start: number, end: number): void {
    while (start < end) {
      [arr[start], arr[end]] = [arr[end], arr[start]];
      start++;
      end--;
    }
  }

  /** Recalculate distanceFromPrev, cumulativeDistance, sequence */
  private recalcDistances(orders: DeliveryOrder[]): DeliveryOrder[] {
    let cumDist = 0;
    let prevLat = STORE_LAT;
    let prevLng = STORE_LNG;

    return orders.map((o, i) => {
      const hasCoords = !!(o.lat && o.lng);
      const segDist = hasCoords
        ? Math.ceil(this.haversineDistance(prevLat, prevLng, o.lat, o.lng) * ROAD_FACTOR * 10) / 10
        : 0;
      cumDist += segDist;
      if (hasCoords) { prevLat = o.lat; prevLng = o.lng; }
      return {
        ...o,
        sequence: i + 1,
        distanceFromPrev: segDist,
        cumulativeDistance: Math.ceil(cumDist * 10) / 10
      };
    });
  }
}
