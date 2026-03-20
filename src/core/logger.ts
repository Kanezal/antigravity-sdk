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
    private static _outputFn: ((msg: string) => void) | null = null;

    /**
     * Set the global log level for all SDK loggers.
     *
     * @param level - Minimum level to output
     */
    static setLevel(level: LogLevel): void {
        Logger._globalLevel = level;
    }

    /**
     * Route SDK logs to a VS Code OutputChannel (or any line-based sink).
     * Pass `null` to disable.
     *
     * @example
     * ```typescript
     * const out = vscode.window.createOutputChannel('My Extension');
     * Logger.setOutput(msg => out.appendLine(msg));
     * ```
     */
    static setOutput(fn: ((msg: string) => void) | null): void {
        Logger._outputFn = fn;
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

        if (Logger._outputFn) {
            const levelStr = LogLevel[level].toUpperCase().padEnd(5);
            const extra = args.length
                ? ' ' + args.map(a => a instanceof Error ? a.message : String(a)).join(' ')
                : '';
            Logger._outputFn(`[SDK:${this.module}] ${levelStr} ${message}${extra}`);
        }
    }
}
