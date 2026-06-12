import { environment } from '../../environments/environment';

export const log = (...args: any[]): void => {
  if (environment.debug) console.log(...args);
};

export const logError = (...args: any[]): void => {
  if (environment.debug) console.error(...args);
};

export const logWarn = (...args: any[]): void => {
  if (environment.debug) console.warn(...args);
};
