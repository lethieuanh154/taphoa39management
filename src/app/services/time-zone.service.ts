import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class TimeZoneService {

  constructor() { }

  formatDateToVietnamString(date: Date): string {
    // Vietnam timezone: UTC+7
    const vietnamOffset = 7 * 60; // 7 hours in minutes
    const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
    const vietnamTime = new Date(utc + (vietnamOffset * 60000));

    const year = vietnamTime.getFullYear();
    const month = String(vietnamTime.getMonth() + 1).padStart(2, '0');
    const day = String(vietnamTime.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  // Utility method để tạo Date object theo timezone Vietnam
  createVietnamDate(dateString: string): Date {
    // Tạo date theo Vietnam timezone (UTC+7)
    const date = new Date(dateString + 'T00:00:00+07:00');
    return date;
  }

  // Utility method để parse date từ API response
  parseApiDate(dateString: string): Date {
    // Giả sử API trả về ISO string hoặc format có timezone info
    return new Date(dateString);
  }
  formatVietnamISOString(date: Date): string {
    // Nếu máy đã ở UTC+7, chỉ cần format lại
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const sec = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');
    return `${year}-${month}-${day}T${hour}:${min}:${sec}.${ms}`;
  }

}
