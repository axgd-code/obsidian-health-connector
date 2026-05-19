/**
 * Simple logger with configurable log levels
 */

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

const LOG_LEVELS: Record<LogLevel, number> = {
    silent: 0,
    error: 1,
    warn: 2,
    info: 3,
    debug: 4
};

export class Logger {
    private level: LogLevel;

    constructor(level: LogLevel = 'error') {
        this.level = level;
    }

    setLevel(level: LogLevel): void {
        this.level = level;
    }

    getLevel(): LogLevel {
        return this.level;
    }

    private shouldLog(level: LogLevel): boolean {
        return LOG_LEVELS[level] <= LOG_LEVELS[this.level];
    }

    error(...args: any[]): void {
        if (this.shouldLog('error')) {
            console.error('❌', ...args);
        }
    }

    warn(...args: any[]): void {
        if (this.shouldLog('warn')) {
            console.warn('⚠️ ', ...args);
        }
    }

    info(...args: any[]): void {
        if (this.shouldLog('info')) {
            console.log('ℹ️ ', ...args);
        }
    }

    debug(...args: any[]): void {
        if (this.shouldLog('debug')) {
            console.log('🐛', ...args);
        }
    }
}

// Export a default instance
export const logger = new Logger();
