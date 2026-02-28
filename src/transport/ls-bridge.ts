/**
 * Language Server Bridge — Direct ConnectRPC calls to the local LS.
 *
 * VERIFIED 2026-02-28:
 * The Antigravity Language Server listens on 127.0.0.1:{port} using
 * ConnectRPC (gRPC-Web compatible) with self-signed TLS.
 *
 * Service: exa.language_server_pb.LanguageServerService
 * Protocol: HTTPS POST with JSON body (Content-Type: application/json)
 *
 * This bridge enables FULLY HEADLESS cascade creation from the
 * extension host — no UI switching, no panel opening.
 *
 * @module transport/ls-bridge
 */

import { Logger } from '../core/logger';

const log = new Logger('LSBridge');

/** Known model IDs (verified 2026-02-28) */
export const Models = {
    GEMINI_FLASH: 1018,
    GEMINI_PRO_LOW: 1164,
    GEMINI_PRO_HIGH: 1165,
    CLAUDE_SONNET: 1163,
    CLAUDE_OPUS: 1154,
    GPT_OSS: 342,
} as const;

export type ModelId = typeof Models[keyof typeof Models] | number;

/** Options for creating a headless cascade */
export interface IHeadlessCascadeOptions {
    /** Text prompt to send */
    text: string;
    /** Model ID (default: Gemini 3 Flash = 1018) */
    model?: ModelId;
    /** Planner type: 'conversational' (default) or 'normal' */
    plannerType?: 'conversational' | 'normal';
}

/** Options for sending a message to existing cascade */
export interface ISendMessageOptions {
    /** Target cascade ID */
    cascadeId: string;
    /** Text to send */
    text: string;
    /** Model ID (default: Gemini 3 Flash = 1018) */
    model?: ModelId;
}

/**
 * Direct bridge to the Language Server via ConnectRPC.
 *
 * Discovers the LS port from getDiagnostics console logs,
 * then makes HTTPS POST calls to the LS endpoints.
 *
 * @example
 * ```typescript
 * const ls = new LSBridge(commandBridge);
 * await ls.initialize();
 *
 * // Create a headless cascade
 * const cascadeId = await ls.createCascade({
 *     text: 'Analyze test coverage',
 *     model: Models.GEMINI_FLASH,
 * });
 *
 * // Send follow-up
 * await ls.sendMessage({ cascadeId, text: 'Focus on edge cases' });
 *
 * // Switch UI to it
 * await ls.focusCascade(cascadeId);
 * ```
 */
export class LSBridge {
    private _port: number | null = null;
    private _executeCommand: <T = any>(command: string, ...args: any[]) => Promise<T>;

    constructor(executeCommand: <T = any>(command: string, ...args: any[]) => Promise<T>) {
        this._executeCommand = executeCommand;
    }

    /** Discover the Language Server port. Must be called before other methods. */
    async initialize(): Promise<boolean> {
        this._port = await this._discoverPort();
        if (this._port) {
            log.info(`LS port discovered: ${this._port}`);
            return true;
        }
        log.warn('Could not discover LS port');
        return false;
    }

    /** Whether the bridge is ready (port discovered) */
    get isReady(): boolean {
        return this._port !== null;
    }

    /** The discovered LS port */
    get port(): number | null {
        return this._port;
    }

    // ─── Headless Cascade API ────────────────────────────────────────

    /**
     * Create a new cascade and optionally send a message.
     * Fully headless — no UI panel opened, no conversation switched.
     *
     * @returns cascadeId or null on failure
     */
    async createCascade(options: IHeadlessCascadeOptions): Promise<string | null> {
        this._ensureReady();

        // Step 1: StartCascade
        const startResp = await this._rpc('StartCascade', { source: 0 });
        const cascadeId = startResp?.cascadeId;
        if (!cascadeId) {
            log.error('StartCascade returned no cascadeId');
            return null;
        }
        log.info(`Cascade created: ${cascadeId}`);

        // Step 2: SendUserCascadeMessage
        if (options.text) {
            await this._sendMessage(cascadeId, options.text, options.model, options.plannerType);
            log.info(`Message sent to: ${cascadeId}`);
        }

        return cascadeId;
    }

    /**
     * Send a message to an existing cascade.
     *
     * @returns true if sent successfully
     */
    async sendMessage(options: ISendMessageOptions): Promise<boolean> {
        this._ensureReady();
        await this._sendMessage(options.cascadeId, options.text, options.model);
        return true;
    }

    /**
     * Switch the UI to show a specific cascade conversation.
     */
    async focusCascade(cascadeId: string): Promise<void> {
        this._ensureReady();
        await this._rpc('SmartFocusConversation', { cascadeId });
    }

    /**
     * Cancel a running cascade invocation.
     */
    async cancelCascade(cascadeId: string): Promise<void> {
        this._ensureReady();
        await this._rpc('CancelCascadeInvocation', { cascadeId });
    }

    /**
     * Get all cascade trajectories (conversation list).
     */
    async listCascades(): Promise<any> {
        this._ensureReady();
        const resp = await this._rpc('GetAllCascadeTrajectories', {});
        return resp?.trajectorySummaries ?? {};
    }

    /**
     * Get user status (tier, models, etc.)
     */
    async getUserStatus(): Promise<any> {
        this._ensureReady();
        return this._rpc('GetUserStatus', {});
    }

    /**
     * Make a raw RPC call to any LS method.
     * @param method - RPC method name (e.g. 'StartCascade')
     * @param payload - JSON payload
     */
    async rawRPC(method: string, payload: any): Promise<any> {
        this._ensureReady();
        return this._rpc(method, payload);
    }

    // ─── Internal ────────────────────────────────────────────────────

    private _ensureReady(): void {
        if (!this._port) {
            throw new Error('LSBridge not initialized. Call initialize() first.');
        }
    }

    private async _sendMessage(
        cascadeId: string,
        text: string,
        model?: ModelId,
        plannerType?: string,
    ): Promise<void> {
        const payload: any = {
            cascadeId,
            items: [{ chunk: { text } }],
            cascadeConfig: {
                plannerConfig: {
                    requestedModel: { model: model || Models.GEMINI_FLASH },
                } as any,
            },
        };

        // Set planner type
        const pt = plannerType || 'conversational';
        payload.cascadeConfig.plannerConfig[pt] = {};

        await this._rpc('SendUserCascadeMessage', payload);
    }

    private async _discoverPort(): Promise<number | null> {
        try {
            const raw = await this._executeCommand<string>('antigravity.getDiagnostics');
            if (!raw || typeof raw !== 'string') return null;
            const diag = JSON.parse(raw);

            const logs: string = diag.agentWindowConsoleLogs || '';

            // Pattern: 127.0.0.1:{port}/exa.language_server_pb
            const m1 = logs.match(/127\.0\.0\.1:(\d+)\/exa\.language_server_pb/);
            if (m1) return parseInt(m1[1], 10);

            // Fallback: any 127.0.0.1:{port}
            const m2 = logs.match(/https?:\/\/127\.0\.0\.1:(\d+)/);
            if (m2) return parseInt(m2[1], 10);
        } catch (err) {
            log.error('Failed to discover LS port', err);
        }
        return null;
    }

    private async _rpc(method: string, payload: any): Promise<any> {
        const https = require('https');
        const url = `https://127.0.0.1:${this._port}/exa.language_server_pb.LanguageServerService/${method}`;

        return new Promise((resolve, reject) => {
            const body = JSON.stringify(payload);
            const req = https.request(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                },
                rejectUnauthorized: false, // Self-signed TLS
            }, (res: any) => {
                let data = '';
                res.on('data', (chunk: string) => { data += chunk; });
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        try { resolve(JSON.parse(data)); }
                        catch { resolve(data); }
                    } else {
                        reject(new Error(`LS ${method}: ${res.statusCode} — ${data.substring(0, 200)}`));
                    }
                });
            });
            req.on('error', (err: Error) => reject(err));
            req.write(body);
            req.end();
        });
    }
}
