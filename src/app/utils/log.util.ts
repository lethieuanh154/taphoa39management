import { environment } from '../../environments/environment';

export const log = (...args: any[]): void => {
  if (!environment.production) console.log(...args);
};

export const logError = (...args: any[]): void => {
  if (!environment.production) console.error(...args);
};

export const logWarn = (...args: any[]): void => {
  if (!environment.production) console.warn(...args);
};
