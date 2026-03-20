/**
 * Language Server Bridge — Direct ConnectRPC calls to the local LS.
 *
 * UPDATED 2026-03-01 (v1.3.0):
 * Fixed CSRF token authentication (Issue #1).
 * The LS binary is launched with --csrf_token as a CLI argument.
 * Previous versions did not send this token, causing 401 "missing CSRF token".
 *
 * Discovery strategy (multi-layer):
 * 1. Process CLI args — extract --port and --csrf_token from LS process
 * 2. getDiagnostics console logs — fallback for port discovery
 * 3. Manual override — setConnection(port, csrfToken)
 *
 * Service: exa.language_server_pb.LanguageServerService
 * Protocol: HTTPS POST with JSON body + x-csrf-token header
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
 * Conversation annotation fields (from jetski_cortex.proto ConversationAnnotations).
 *
 * These are metadata annotations on a conversation that the user can set.
 * The LS stores these natively and they persist across sessions.
 */
export interface IConversationAnnotations {
    /** Custom user title -- overrides the auto-generated summary */
    title?: string;
    /** Tags/labels for organization */
    tags?: string[];
    /** Whether this conversation is archived */
    archived?: boolean;
    /** Whether this conversation is starred (pinned) */
    starred?: boolean;
}

/**
 * Direct bridge to the Language Server via ConnectRPC.
 *
 * Discovers the LS port and CSRF token from the LS process CLI args,
 * then makes authenticated HTTPS POST calls to the LS endpoints.
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
    private _csrfToken: string | null = null;
    private _useTls: boolean = false;
    private _executeCommand: <T = any>(command: string, ...args: any[]) => Promise<T>;

    constructor(executeCommand: <T = any>(command: string, ...args: any[]) => Promise<T>) {
        this._executeCommand = executeCommand;
    }

    /**
     * Discover the Language Server port and CSRF token.
     * Must be called before other methods.
     *
     * Discovery chain:
     * 1. Parse LS process CLI arguments (--port, --csrf_token)
     * 2. Fallback: getDiagnostics console logs (port only)
     * 3. Manual: call setConnection() after initialize() returns false
     */
    async initialize(): Promise<boolean> {
        // Strategy 1: discover from LS process CLI args (port + CSRF)
        const fromProcess = await this._discoverFromProcess();
        if (fromProcess) {
            this._port = fromProcess.port;
            this._csrfToken = fromProcess.csrfToken;
            this._useTls = fromProcess.useTls;
            log.info(`LS discovered from process: port=${this._port}, tls=${this._useTls}, csrf=${this._csrfToken ? 'found' : 'missing'}`);
            return true;
        }

        // Strategy 2: fallback to getDiagnostics logs (port only, no CSRF)
        this._port = await this._discoverPortFromDiagnostics();
        if (this._port) {
            log.warn(`LS port from diagnostics: ${this._port}, but CSRF token not found — RPC calls may fail with 401`);
            return true;
        }

        log.warn('Could not discover LS connection. Use setConnection(port, csrfToken) manually.');
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

    /** Whether CSRF token is available */
    get hasCsrfToken(): boolean {
        return this._csrfToken !== null;
    }

    /**
     * Manually set the LS connection parameters.
     *
     * Use this when auto-discovery fails (e.g., non-standard install,
     * or you've discovered the port/token through other means like `lsof`).
     *
     * @param port - LS port number
     * @param csrfToken - CSRF token from LS process CLI args
     * @param useTls - Whether to use HTTPS (default: false, extension_server uses HTTP)
     *
     * @example
     * ```typescript
     * const ls = new LSBridge(commandBridge);
     * const ok = await ls.initialize();
     * if (!ok) {
     *     // Manual fallback: get port and csrf from your own discovery
     *     ls.setConnection(54321, 'abc123-csrf-token');
     * }
     * ```
     */
    setConnection(port: number, csrfToken: string, useTls: boolean = false): void {
        this._port = port;
        this._csrfToken = csrfToken;
        this._useTls = useTls;
        log.info(`LS connection set manually: port=${port}, tls=${useTls}, csrf=${csrfToken ? 'provided' : 'empty'}`);
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

    // ─── Conversation Annotations API ───────────────────────────────

    /**
     * Native conversation annotations (verified from jetski_cortex.proto).
     *
     * ConversationAnnotations protobuf fields:
     *   - title (string)              — custom user title, overrides auto-summary
     *   - tags (string[])             — tags/labels
     *   - archived (bool)             — archive status  
     *   - starred (bool)              — pinned/starred
     *   - last_user_view_time (Timestamp)
     *
     * @param cascadeId - Conversation ID
     * @param annotations - Partial annotation fields to set
     * @param merge - If true, merge with existing annotations (default: true)
     */
    async updateAnnotations(
        cascadeId: string,
        annotations: IConversationAnnotations,
        merge: boolean = true,
    ): Promise<void> {
        this._ensureReady();

        // Convert camelCase to snake_case for protobuf
        const proto: Record<string, any> = {};
        if (annotations.title !== undefined) proto.title = annotations.title;
        if (annotations.starred !== undefined) proto.starred = annotations.starred;
        if (annotations.archived !== undefined) proto.archived = annotations.archived;
        if (annotations.tags !== undefined) proto.tags = annotations.tags;

        await this._rpc('UpdateConversationAnnotations', {
            cascadeId,
            annotations: proto,
            mergeAnnotations: merge,
        });
        log.info(`Annotations updated for ${cascadeId.substring(0, 8)}...`);
    }

    /**
     * Set a custom title for a conversation.
     *
     * This sets the `title` field in ConversationAnnotations.
     * When set, this title should be displayed instead of the
     * auto-generated `summary` from the LLM.
     *
     * @param cascadeId - Conversation ID
     * @param title - Custom title to set
     */
    async setTitle(cascadeId: string, title: string): Promise<void> {
        await this.updateAnnotations(cascadeId, { title });
    }

    /**
     * Star (pin) or unstar a conversation.
     *
     * This sets the `starred` field in ConversationAnnotations.
     *
     * @param cascadeId - Conversation ID
     * @param starred - true to star, false to unstar
     */
    async setStar(cascadeId: string, starred: boolean): Promise<void> {
        await this.updateAnnotations(cascadeId, { starred });
    }

    // ─── Conversation Read API ──────────────────────────────────────

    /**
     * Get details of a specific conversation.
     */
    async getConversation(cascadeId: string): Promise<any> {
        this._ensureReady();
        return this._rpc('GetConversation', { cascadeId });
    }

    /**
     * Get all cascade trajectories (conversation list).
     */
    async listCascades(): Promise<any> {
        this._ensureReady();
        log.debug('listCascades: fetching all trajectories');
        const resp = await this._rpc('GetAllCascadeTrajectories', {});
        const summaries = resp?.trajectorySummaries ?? {};
        log.debug(`listCascades: ${Object.keys(summaries).length} entries`);
        return summaries;
    }

    /**
     * Get trajectory descriptions (lighter than full trajectories).
     * Returns { trajectories: [...] }.
     */
    async getTrajectoryDescriptions(): Promise<any> {
        this._ensureReady();
        return this._rpc('GetUserTrajectoryDescriptions', {});
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
            items: [{ chunk: { case: 'text', value: text } }],
            cascadeConfig: {
                plannerConfig: {
                    plannerTypeConfig: {
                        case: plannerType || 'conversational',
                        value: {},
                    },
                    requestedModel: {
                        choice: { case: 'model', value: model || Models.GEMINI_FLASH },
                    },
                },
            },
        };

        await this._rpc('SendUserCascadeMessage', payload);
    }

    /**
     * Discover LS port and CSRF token from the Language Server process.
     *
     * VERIFIED 2026-03-01 from Antigravity extension.js source:
     *
     * 1. CSRF header is "x-codeium-csrf-token" (NOT x-csrf-token)
     * 2. CSRF value is --csrf_token from CLI (NOT --extension_server_csrf_token)
     * 3. ConnectRPC endpoint is on httpsPort (HTTPS) or httpPort (HTTP)
     *    These ports are NOT in CLI args (--random_port flag means random).
     *    We discover them via netstat/PID, excluding extension_server_port.
     *
     * Source code proof:
     *   n.header.set("x-codeium-csrf-token", e)        // header name
     *   address = `127.0.0.1:${te.httpsPort}`           // ConnectRPC address
     *   csrfToken = a = d.randomUUID() → --csrf_token   // token source
     *   t.headers["x-codeium-csrf-token"] === this.csrfToken ? ... : 403
     *
     * Discovery: 2 phases
     *   Phase 1: Get-CimInstance/ps → PID, --csrf_token, --extension_server_port
     *   Phase 2: netstat → find LISTENING ports for PID, exclude ext_server_port
     */
    private async _discoverFromProcess(): Promise<{ port: number; csrfToken: string; useTls: boolean } | null> {
        try {
            const platform = process.platform;

            // Phase 1: find LS process, extract PID, csrf_token, extension_server_port
            let processInfo = await this._findLSProcess(platform);
            if (!processInfo) {
                log.debug('No LS processes found');
                return null;
            }

            log.debug(`LS process found: PID=${processInfo.pid}, csrf=present, ext_port=${processInfo.extPort}`);

            // Phase 2: find actual ConnectRPC port via netstat
            const connectPort = await this._findConnectPort(platform, processInfo.pid, processInfo.extPort);
            if (!connectPort) {
                log.debug('Could not find ConnectRPC port via netstat, trying extension_server_port as fallback');
                // Fallback: try extension_server_port with HTTP
                if (processInfo.extPort) {
                    return { port: processInfo.extPort, csrfToken: processInfo.csrfToken, useTls: false };
                }
                return null;
            }

            return {
                port: connectPort.port,
                csrfToken: processInfo.csrfToken,
                useTls: connectPort.tls,
            };

        } catch (err) {
            log.debug('Process discovery failed', err);
        }
        return null;
    }

    /**
     * Phase 1: Find the LS process for this workspace.
     */
    private async _findLSProcess(
        platform: string,
    ): Promise<{ pid: number; csrfToken: string; extPort: number } | null> {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        let output: string;

        if (platform === 'win32') {
            // Use -EncodedCommand to avoid all PowerShell escaping issues with $_ and quotes
            const psScript = "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'language_server' -and $_.CommandLine -match 'csrf_token' } | ForEach-Object { $_.ProcessId.ToString() + '|' + $_.CommandLine }";
            const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
            const result = await execAsync(
                `powershell.exe -NoProfile -EncodedCommand ${encoded}`,
                { encoding: 'utf8', timeout: 10000, windowsHide: true },
            );
            output = result.stdout;
        } else {
            const result = await execAsync(
                'ps -eo pid,args 2>/dev/null | grep language_server | grep csrf_token | grep -v grep',
                { encoding: 'utf8', timeout: 5000 },
            );
            output = result.stdout;
        }

        const lines = output.split('\n').filter((l: string) => l.trim().length > 0);
        if (lines.length === 0) return null;

        const workspaceHint = this._getWorkspaceHint();
        let bestLine: string | null = null;

        if (workspaceHint) {
            for (const line of lines) {
                if (line.includes(workspaceHint)) {
                    bestLine = line;
                    break;
                }
            }
        }
        if (!bestLine) bestLine = lines[0];

        // Extract PID (first field before | on Windows, first token on Unix)
        let pid: number;
        if (platform === 'win32') {
            pid = parseInt(bestLine.split('|')[0].trim(), 10);
        } else {
            pid = parseInt(bestLine.trim().split(/\s+/)[0], 10);
        }

        const csrfToken = this._extractArg(bestLine, 'csrf_token');
        const extPortStr = this._extractArg(bestLine, 'extension_server_port');
        const extPort = extPortStr ? parseInt(extPortStr, 10) : 0;

        if (!csrfToken || isNaN(pid)) return null;

        return { pid, csrfToken, extPort };
    }

    /**
     * Phase 2: Find ConnectRPC port via netstat.
     *
     * The LS process listens on multiple ports:
     * - httpsPort (HTTPS, ConnectRPC) ← this is what we want
     * - httpPort  (HTTP, ConnectRPC)  ← also works
     * - lspPort   (LSP JSON-RPC)
     * - extension_server_port is separate (for Extension Host IPC)
     *
     * We find all LISTENING ports for the LS PID, exclude ext_server_port,
     * then try HTTPS first (preferred), fall back to HTTP.
     */
    private async _findConnectPort(
        platform: string,
        pid: number,
        extPort: number,
    ): Promise<{ port: number; tls: boolean } | null> {
        try {
            const { exec } = require('child_process');
            const { promisify } = require('util');
            const execAsync = promisify(exec);
            let output: string;

            if (platform === 'win32') {
                const result = await execAsync(
                    `netstat -aon | findstr "LISTENING" | findstr "${pid}"`,
                    { encoding: 'utf8', timeout: 5000, windowsHide: true },
                );
                output = result.stdout;
            } else {
                const result = await execAsync(
                    `ss -tlnp 2>/dev/null | grep "pid=${pid}" || netstat -tlnp 2>/dev/null | grep "${pid}"`,
                    { encoding: 'utf8', timeout: 5000 },
                );
                output = result.stdout;
            }

            // Extract all listening ports for this PID
            const portMatches = output.matchAll(/127\.0\.0\.1:(\d+)/g);
            const ports: number[] = [];
            for (const m of portMatches) {
                const p = parseInt(m[1], 10);
                // Exclude extension_server_port
                if (p !== extPort && !ports.includes(p)) {
                    ports.push(p);
                }
            }

            if (ports.length === 0) return null;

            log.debug(`LS ports (excl ext ${extPort}): ${ports.join(', ')}`);

            // Try to identify httpsPort vs httpPort by probing
            // Strategy: try HTTPS first on each port (httpsPort is preferred)
            for (const port of ports) {
                log.debug(`Probing port ${port} (HTTPS)...`);
                const tls = await this._probePort(port, true);
                if (tls) { log.debug(`Port ${port} accepted HTTPS`); return { port, tls: true }; }
            }

            // Fallback: try HTTP
            for (const port of ports) {
                log.debug(`Probing port ${port} (HTTP)...`);
                const http = await this._probePort(port, false);
                if (http) { log.debug(`Port ${port} accepted HTTP`); return { port, tls: false }; }
            }

        } catch (err) {
            log.debug('netstat port discovery failed', err);
        }
        return null;
    }

    /**
     * Quick probe: check if a port accepts ConnectRPC requests.
     * Returns true if the port responds (even with error) on the given protocol.
     */
    private _probePort(port: number, useTls: boolean): Promise<boolean> {
        const mod = useTls ? require('https') : require('http');
        const proto = useTls ? 'https' : 'http';
        return new Promise((resolve) => {
            const req = mod.request(`${proto}://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/GetUserStatus`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': 2 },
                rejectUnauthorized: false,
                timeout: 2000,
            }, (res: any) => {
                // 401 = correct endpoint, just missing CSRF (expected)
                // 200 = also correct (unlikely without CSRF but possible)
                resolve(res.statusCode === 401 || res.statusCode === 200);
            });
            req.on('error', () => resolve(false));
            req.on('timeout', () => { req.destroy(); resolve(false); });
            req.write('{}');
            req.end();
        });
    }

    /**
     * Get a workspace hint string used to match the correct LS process.
     *
     * The LS process has --workspace_id like:
     *   file_d_3A_programming_better_antigravity
     * which is an encoded version of the workspace URI.
     */
    private _getWorkspaceHint(): string {
        try {
            const vscode = require('vscode');
            const folders = vscode.workspace?.workspaceFolders;
            if (folders && folders.length > 0) {
                // Convert workspace path to LS workspace_id format
                // e.g., "d:\programming\better-antigravity" -> "better_antigravity"
                // (LS uses underscored path segments)
                const folder = folders[0].uri.fsPath;
                const parts = folder.replace(/\\/g, '/').split('/');
                // Use last 2-3 segments for matching
                return parts.slice(-2).join('_').replace(/[-.\s]/g, '_').toLowerCase();
            }
        } catch {
            // vscode not available (e.g., testing)
        }
        return '';
    }

    /**
     * Extract a CLI argument value from a command-line string.
     * Supports both --key=value and --key value formats.
     */
    private _extractArg(cmdLine: string, argName: string): string | null {
        // --argName=value
        const eqMatch = cmdLine.match(new RegExp(`--${argName}=([^\\s"]+)`));
        if (eqMatch) return eqMatch[1];

        // --argName value
        const spaceMatch = cmdLine.match(new RegExp(`--${argName}\\s+([^\\s"]+)`));
        if (spaceMatch) return spaceMatch[1];

        return null;
    }

    /**
     * Fallback: discover port from getDiagnostics console logs.
     * NOTE: This does NOT discover the CSRF token.
     * In recent Antigravity versions, the port URL may no longer appear in logs.
     */
    private async _discoverPortFromDiagnostics(): Promise<number | null> {
        try {
            const raw = await this._executeCommand<string>('antigravity.getDiagnostics');
            if (!raw || typeof raw !== 'string') return null;
            const diag = JSON.parse(raw);

            const logs: string = diag.agentWindowConsoleLogs || '';

            // Pattern: 127.0.0.1:{port}/exa.language_server_pb
            const m1 = logs.match(/127\.0\.0\.1:(\d+)\/exa\.language_server_pb/);
            if (m1) return parseInt(m1[1], 10);

            // Fallback: any 127.0.0.1:{port} in HTTPS context
            const m2 = logs.match(/https?:\/\/127\.0\.0\.1:(\d+)/);
            if (m2) return parseInt(m2[1], 10);

            // Check mainThreadLogs for port info
            if (diag.mainThreadLogs) {
                const mainLogs = typeof diag.mainThreadLogs === 'string'
                    ? diag.mainThreadLogs
                    : JSON.stringify(diag.mainThreadLogs);
                const m3 = mainLogs.match(/127\.0\.0\.1:(\d+)/);
                if (m3) return parseInt(m3[1], 10);
            }
        } catch (err) {
            log.error('Failed to discover LS port from diagnostics', err);
        }
        return null;
    }

    /**
     * Make an authenticated RPC call to the Language Server.
     * Sends x-csrf-token header when available.
     *
     * VERIFIED 2026-03-01:
     * - extension_server_port uses plain HTTP (no TLS)
     * - Main LS port (--random_port) uses HTTPS with self-signed cert
     */
    private async _rpc(method: string, payload: any): Promise<any> {
        const httpModule = this._useTls ? require('https') : require('http');
        const protocol = this._useTls ? 'https' : 'http';
        const url = `${protocol}://127.0.0.1:${this._port}/exa.language_server_pb.LanguageServerService/${method}`;

        log.debug(`RPC → ${method} (port=${this._port}, tls=${this._useTls}, csrf=${!!this._csrfToken})`);

        return new Promise((resolve, reject) => {
            const body = JSON.stringify(payload);
            const headers: Record<string, string | number> = {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
            };

            // CSRF header: "x-codeium-csrf-token" (verified from extension.js source)
            if (this._csrfToken) {
                headers['x-codeium-csrf-token'] = this._csrfToken;
            }

            const reqOptions: any = {
                method: 'POST',
                headers,
            };

            // Self-signed TLS when using HTTPS
            if (this._useTls) {
                reqOptions.rejectUnauthorized = false;
            }

            const req = httpModule.request(url, reqOptions, (res: any) => {
                let data = '';
                res.on('data', (chunk: string) => { data += chunk; });
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        log.debug(`RPC ← ${method} OK (${data.length} bytes)`);
                        try { resolve(JSON.parse(data)); }
                        catch { resolve(data); }
                    } else {
                        const hint = res.statusCode === 401
                            ? ' (CSRF token may be invalid or missing -- try setConnection() with the correct token)'
                            : '';
                        reject(new Error(`LS ${method}: ${res.statusCode} -- ${data.substring(0, 200)}${hint}`));
                    }
                });
            });
            req.on('error', (err: Error) => reject(err));
            req.write(body);
            req.end();
        });
    }
}
