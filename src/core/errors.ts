/**
 * SDK-specific error classes.
 *
 * @module errors
 */

/**
 * Base error for all Antigravity SDK errors.
 */
export class AntigravitySDKError extends Error {
    constructor(message: string) {
        super(`[AntigravitySDK] ${message}`);
        this.name = 'AntigravitySDKError';
    }
}

/**
 * Thrown when Antigravity IDE is not detected or not running.
 */
export class AntigravityNotFoundError extends AntigravitySDKError {
    constructor() {
        super('Antigravity IDE not detected. Make sure this extension is running inside Antigravity.');
        this.name = 'AntigravityNotFoundError';
    }
}

/**
 * Thrown when a command fails to execute.
 */
export class CommandExecutionError extends AntigravitySDKError {
    constructor(
        public readonly command: string,
        public readonly reason: string,
    ) {
        super(`Command "${command}" failed: ${reason}`);
        this.name = 'CommandExecutionError';
    }
}

/**
 * Thrown when the state database cannot be read.
 */
export class StateReadError extends AntigravitySDKError {
    constructor(
        public readonly key: string,
        public readonly reason: string,
    ) {
        super(`Failed to read state key "${key}": ${reason}`);
        this.name = 'StateReadError';
    }
}

/**
 * Thrown when a session/conversation is not found.
 */
export class SessionNotFoundError extends AntigravitySDKError {
    constructor(public readonly sessionId: string) {
        super(`Session "${sessionId}" not found`);
        this.name = 'SessionNotFoundError';
    }
}
