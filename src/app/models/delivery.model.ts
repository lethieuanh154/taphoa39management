export type DeliveryStatus = 'pending' | 'picking' | 'picked' | 'in_transit' | 'arrived' | 'delivered' | 'failed';

export interface DeliveryOrder {
  orderId: string;
  customerName: string;
  customerPhone: string;
  address: string;
  lat: number;
  lng: number;
  distanceFromPrev: number;
  cumulativeDistance: number;
  estimatedArrival: string;
  desiredDeliveryDate: string;
  desiredDeliveryTime: string;
  status: DeliveryStatus;
  sequence: number;
  note: string;
}

export interface DeliveryRoute {
  id: string;
  date: string;
  driverName: string;
  orders: DeliveryOrder[];
  totalDistanceKm: number;
  estimatedDurationMinutes: number;
  estimatedStartTime: string;
  optimized: boolean;
  status: 'planning' | 'active' | 'completed';
  createdAt: string;
}

export interface DeliveryTrackingDoc {
  routeId: string;
  orderId: string;
  status: DeliveryStatus;
  driverName: string;
  driverLat?: number;
  driverLng?: number;
  estimatedArrival: string;
  sequence: number;
  totalOrders: number;
  routePolyline: [number, number][];
  storeLat: number;
  storeLng: number;
  customerLat: number;
  customerLng: number;
  updatedAt: string;
}
