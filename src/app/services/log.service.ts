import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

export enum LogLevel {
  Debug = 0,
  Info = 1,
  Warn = 2,
  Error = 3,
  None = 4
}

@Injectable({
  providedIn: 'root'
})
export class LogService {
  private logLevel: LogLevel = environment.production ? LogLevel.Warn : LogLevel.Debug;

  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  debug(message: string, ...optionalParams: any[]): void {
    this.log(LogLevel.Debug, message, optionalParams);
  }

  info(message: string, ...optionalParams: any[]): void {
    this.log(LogLevel.Info, message, optionalParams);
  }

  warn(message: string, ...optionalParams: any[]): void {
    this.log(LogLevel.Warn, message, optionalParams);
  }

  error(message: string, error?: any, ...optionalParams: any[]): void {
    this.log(LogLevel.Error, message, error ? [error, ...optionalParams] : optionalParams);
  }

  group(label: string): void {
    if (this.shouldLog(LogLevel.Debug)) {
      console.group(label);
    }
  }

  groupEnd(): void {
    if (this.shouldLog(LogLevel.Debug)) {
      console.groupEnd();
    }
  }

  table(data: any): void {
    if (this.shouldLog(LogLevel.Debug)) {
      console.table(data);
    }
  }

  private log(level: LogLevel, message: string, params: any[]): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${LogLevel[level]}]`;

    switch (level) {
      case LogLevel.Debug:
        console.log(prefix, message, ...params);
        break;
      case LogLevel.Info:
        console.info(prefix, message, ...params);
        break;
      case LogLevel.Warn:
        console.warn(prefix, message, ...params);
        break;
      case LogLevel.Error:
        console.error(prefix, message, ...params);
        break;
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.logLevel;
  }
}