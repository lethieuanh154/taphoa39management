import { HttpInterceptorFn, HttpRequest, HttpHandlerFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { TokenExpiredService } from '../services/token-expired.service';

export const authInterceptor: HttpInterceptorFn = (req: HttpRequest<unknown>, next: HttpHandlerFn) => {
  const authService = inject(AuthService);
  const tokenExpiredService = inject(TokenExpiredService);

  // Skip auth endpoints
  const skipUrls = ['/api/auth/login', '/api/auth/verify-email', '/api/auth/refresh'];
  if (skipUrls.some(url => req.url.includes(url))) {
    return next(req);
  }

  // Add KiotViet token (Authorization, cho backend goi KiotViet) + Firebase ID token
  // (X-Id-Token, cho backend admin-auth xac thuc nguoi dung Management)
  const kvToken = authService.getKiotVietToken();
  const idToken = authService.getCachedIdToken();
  const setHeaders: Record<string, string> = {};
  if (kvToken) setHeaders['Authorization'] = kvToken;
  if (idToken) setHeaders['X-Id-Token'] = idToken;
  const authReq = Object.keys(setHeaders).length ? req.clone({ setHeaders }) : req;

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401) {
        return from(authService.refreshKiotVietToken()).pipe(
          switchMap((success) => {
            if (success) {
              authService.scheduleTokenRefresh();
              const newToken = authService.getKiotVietToken();
              const retryReq = req.clone({
                setHeaders: { Authorization: newToken || '' }
              });
              return next(retryReq);
            } else {
              if (!authService.getRefreshToken()) {
                tokenExpiredService.emitTokenExpired('refresh');
                setTimeout(() => tokenExpiredService.redirectToLogin(true), 2000);
              }
              return throwError(() => error);
            }
          }),
          catchError(() => {
            if (!authService.getRefreshToken()) {
              tokenExpiredService.emitTokenExpired('refresh');
              setTimeout(() => tokenExpiredService.redirectToLogin(true), 2000);
            }
            return throwError(() => error);
          })
        );
      }

      if (error.status === 403) {
        const errorBody = error.error;
        const isTokenError = errorBody?.message?.toLowerCase().includes('token') ||
                            errorBody?.error?.toLowerCase().includes('expired') ||
                            errorBody?.error?.toLowerCase().includes('unauthorized');

        if (isTokenError) {
          return from(authService.refreshKiotVietToken()).pipe(
            switchMap((success) => {
              if (success) {
                authService.scheduleTokenRefresh();
                const newToken = authService.getKiotVietToken();
                const retryReq = req.clone({
                  setHeaders: { Authorization: newToken || '' }
                });
                return next(retryReq);
              }
              if (!authService.getRefreshToken()) {
                tokenExpiredService.emitTokenExpired('kiotviet');
                setTimeout(() => tokenExpiredService.redirectToLogin(true), 2000);
              }
              return throwError(() => error);
            }),
            catchError(() => throwError(() => error))
          );
        }
      }

      return throwError(() => error);
    })
  );
};
