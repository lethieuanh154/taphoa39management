import { Injectable } from '@angular/core';
import { Subject, Observable } from 'rxjs';

export interface Notification {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
  duration?: number;
  action?: string;
}

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private notificationSubject = new Subject<Notification>();
  public notifications$: Observable<Notification> = this.notificationSubject.asObservable();

  private idCounter = 0;

  success(message: string, duration: number = 3000, action?: string): void {
    this.show('success', message, duration, action);
  }

  error(message: string, duration: number = 5000, action?: string): void {
    this.show('error', message, duration, action);
  }

  info(message: string, duration: number = 3000, action?: string): void {
    this.show('info', message, duration, action);
  }

  warning(message: string, duration: number = 4000, action?: string): void {
    this.show('warning', message, duration, action);
  }

  private show(type: Notification['type'], message: string, duration?: number, action?: string): void {
    const notification: Notification = {
      id: `notification-${++this.idCounter}-${Date.now()}`,
      type,
      message,
      duration,
      action
    };
    this.notificationSubject.next(notification);
  }
}