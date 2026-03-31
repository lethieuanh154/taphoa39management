import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Promotion } from '../models/promotion.model';

@Injectable({
  providedIn: 'root'
})
export class PromotionService {
  private baseUrl = `${environment.domainUrl}/api/firebase/promotions`;

  constructor(private http: HttpClient) {}

  getAllPromotions(includeDisabled = true): Observable<Promotion[]> {
    return this.http.get<Promotion[]>(
      `${this.baseUrl}?include_disabled=${includeDisabled}`
    );
  }

  getActivePromotions(): Observable<Promotion[]> {
    return this.http.get<Promotion[]>(`${this.baseUrl}/active`);
  }

  getPromotion(id: string): Observable<Promotion> {
    return this.http.get<Promotion>(`${this.baseUrl}/${id}`);
  }

  getPromotionsForProduct(productId: string): Observable<Promotion[]> {
    return this.http.get<Promotion[]>(`${this.baseUrl}/by-product/${productId}`);
  }

  createPromotion(data: Partial<Promotion>): Observable<any> {
    return this.http.post(this.baseUrl, data);
  }

  updatePromotion(id: string, data: Partial<Promotion>): Observable<any> {
    return this.http.put(`${this.baseUrl}/${id}`, data);
  }

  deletePromotion(id: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/${id}`);
  }

  togglePromotion(id: string, enabled: boolean): Observable<any> {
    return this.http.put(`${this.baseUrl}/${id}/toggle`, { isEnabled: enabled });
  }
}
