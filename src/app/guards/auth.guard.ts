import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { filter, map, take } from 'rxjs/operators';

export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.authState$.pipe(
    // Chờ Firebase auth load xong trước khi quyết định
    filter(authState => !authState.isLoading),
    take(1),
    map(authState => {
      if (authState.isAuthenticated) {
        return true;
      }

      router.navigate(['/login'], { queryParams: { returnUrl: state.url } });
      return false;
    })
  );
};

export const loginGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.authState$.pipe(
    filter(authState => !authState.isLoading),
    take(1),
    map(authState => {
      if (authState.isAuthenticated) {
        router.navigate(['/orders']);
        return false;
      }
      return true;
    })
  );
};
