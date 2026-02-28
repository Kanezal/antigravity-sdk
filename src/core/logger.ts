/**
 * Debug logger for SDK internals.
 *
 * Respects the `antigravitySDK.debug` setting.
 *
 * @module logger
 */

/**
 * Log levels for SDK logging.
 */
export enum LogLevel {
    Debug = 0,
    Info = 1,
    Warn = 2,
    Error = 3,
    Off = 4,
}

/**
 * SDK logger with level-based filtering.
 *
 * @example
 * ```typescript
 * const log = new Logger('CascadeManager');
 * log.debug('Loading sessions...');
 * log.info('Found 5 sessions');
 * log.error('Failed to load', err);
 * ```
 */
export class Logger {
    private static _globalLevel: LogLevel = LogLevel.Warn;

    /**
     * Set the global log level for all SDK loggers.
     *
     * @param level - Minimum level to output
     */
    static setLevel(level: LogLevel): void {
        Logger._globalLevel = level;
    }

    /**
     * Create a logger for a specific module.
     *
     * @param module - Module name (shown in log prefix)
     */
    constructor(private readonly module: string) { }

    /** Log a debug message. */
    debug(message: string, ...args: unknown[]): void {
        this._log(LogLevel.Debug, message, args);
    }

    /** Log an informational message. */
    info(message: string, ...args: unknown[]): void {
        this._log(LogLevel.Info, message, args);
    }

    /** Log a warning. */
    warn(message: string, ...args: unknown[]): void {
        this._log(LogLevel.Warn, message, args);
    }

    /** Log an error. */
    error(message: string, ...args: unknown[]): void {
        this._log(LogLevel.Error, message, args);
    }

    private _log(level: LogLevel, message: string, args: unknown[]): void {
        if (level < Logger._globalLevel) {
            return;
        }

        const prefix = `[AntigravitySDK:${this.module}]`;
        const fn =
            level === LogLevel.Error ? console.error
                : level === LogLevel.Warn ? console.warn
                    : level === LogLevel.Info ? console.info
                        : console.debug;

        fn(prefix, message, ...args);
    }
}
