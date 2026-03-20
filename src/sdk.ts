/**
 * Main SDK entry point.
 *
 * Provides a unified interface to Antigravity's agent system
 * via verified transport layer (CommandBridge + StateBridge + EventMonitor).
 *
 * @module AntigravitySDK
 *
 * @example
 * ```typescript
 * import { AntigravitySDK } from 'antigravity-sdk';
 *
 * export function activate(context: vscode.ExtensionContext) {
 *   const sdk = new AntigravitySDK(context);
 *   await sdk.initialize();
 *
 *   // List conversations
 *   const sessions = await sdk.cascade.getSessions();
 *   console.log(`${sessions.length} conversations`);
 *
 *   // Read preferences (all 16 sentinel values)
 *   const prefs = await sdk.cascade.getPreferences();
 *   console.log('Terminal policy:', prefs.terminalExecutionPolicy);
 *
 *   // Monitor for new conversations
 *   sdk.monitor.onNewConversation(() => {
 *     console.log('New conversation detected!');
 *   });
 *   sdk.monitor.start(3000);
 *
 *   // Clean up
 *   context.subscriptions.push(sdk);
 * }
 * ```
 */

import * as vscode from 'vscode';
import { DisposableStore, IDisposable } from './core/disposable';
import { Logger, LogLevel } from './core/logger';
import { AntigravityNotFoundError } from './core/errors';
import { CommandBridge } from './transport/command-bridge';
import { StateBridge } from './transport/state-bridge';
import { EventMonitor } from './transport/event-monitor';
import { LSBridge } from './transport/ls-bridge';
import { CascadeManager } from './cascade/cascade-manager';
import { IntegrationManager } from './integration/integration-manager';
import { detectAGVersion, AGVersionInfo } from './core/ag-version';

const log = new Logger('SDK');

/**
 * SDK initialization options.
 */
export interface ISDKOptions {
    /** Enable debug logging */
    debug?: boolean;
}

/**
 * The main Antigravity SDK class.
 *
 * Provides access to:
 * - `commands` — Execute Antigravity internal commands
 * - `state` — Read agent preferences and state from USS
 * - `cascade` — Manage Cascade conversations, send messages, read preferences
 * - `monitor` — Watch for state changes (new conversations, preference updates)
 *
 * @example
 * ```typescript
 * const sdk = new AntigravitySDK(context);
 * await sdk.initialize();
 * const sessions = await sdk.cascade.getSessions();
 * ```
 */
export class AntigravitySDK implements IDisposable {
    private readonly _disposables = new DisposableStore();
    private _initialized = false;
    private _agVersion: AGVersionInfo | null = null;

    /** Command bridge for executing Antigravity commands */
    public readonly commands: CommandBridge;

    /** State bridge for reading USS data */
    public readonly state: StateBridge;

    /** Cascade manager for conversations, preferences, diagnostics */
    public readonly cascade: CascadeManager;

    /** Event monitor for watching state changes */
    public readonly monitor: EventMonitor;

    /** Integration manager for Agent View UI customization */
    public readonly integration: IntegrationManager;

    /**
     * Language Server bridge for headless cascade operations.
     * Use this for background cascade creation without UI switching.
     *
     * @example
     * ```typescript
     * const id = await sdk.ls.createCascade({ text: 'Analyze coverage' });
     * await sdk.ls.sendMessage({ cascadeId: id, text: 'Focus on tests' });
     * await sdk.ls.focusCascade(id); // Only when ready to show
     * ```
     */
    public readonly ls: LSBridge;

    /**
     * Create a new Antigravity SDK instance.
     *
     * @param context - VS Code extension context
     * @param options - SDK options
     */
    constructor(
        private readonly _context: vscode.ExtensionContext,
        options?: ISDKOptions,
    ) {
        if (options?.debug) {
            Logger.setLevel(LogLevel.Debug);
        }

        // Derive namespace from extension ID for file isolation
        // e.g. 'kanezal.better-antigravity' -> 'kanezal-better-antigravity'
        const namespace = this._context.extension.id.replace(/\./g, '-');

        this.commands = this._disposables.add(new CommandBridge());
        this.state = this._disposables.add(new StateBridge());
        this.cascade = this._disposables.add(new CascadeManager(this.commands, this.state));
        this.monitor = this._disposables.add(new EventMonitor(this.state));
        this.integration = this._disposables.add(new IntegrationManager(namespace));
        this.ls = new LSBridge(
            <T = any>(cmd: string, ...args: any[]) => Promise.resolve(vscode.commands.executeCommand<T>(cmd, ...args))
        );

        log.info(`SDK created (namespace: ${namespace})`);
    }

    /**
     * Initialize the SDK and verify Antigravity is running.
     *
     * Call this before using any SDK features.
     *
     * @throws {AntigravityNotFoundError} If Antigravity is not detected
     */
    async initialize(): Promise<void> {
        if (this._initialized) {
            return;
        }

        log.info('Initializing SDK...');

        // Check installed AG version against supported range
        this._agVersion = detectAGVersion();
        if (this._agVersion) {
            const { version, compatible, supportedRange } = this._agVersion;
            if (!compatible) {
                log.warn(`AG v${version} is outside supported range (${supportedRange}) — some features may not work`);
            } else {
                log.info(`AG v${version} detected (supported: ${supportedRange})`);
            }
        }

        // Verify we're running inside Antigravity
        const isAntigravity = await this._detectAntigravity();
        if (!isAntigravity) {
            throw new AntigravityNotFoundError();
        }

        // Initialize state bridge (opens state.vscdb via sql.js)
        await this.state.initialize();

        // Initialize cascade manager (loads session list)
        await this.cascade.initialize();

        // Initialize LS bridge (discovers Language Server port + CSRF token)
        const lsOk = await this.ls.initialize();
        if (lsOk) {
            log.info(`LS bridge ready on port ${this.ls.port} (csrf: ${this.ls.hasCsrfToken ? 'ok' : 'missing'})`);
        } else {
            log.warn('LS bridge not available — use sdk.ls.setConnection(port, csrfToken) or command fallback');
        }

        // Refresh integration heartbeat (so renderer script knows extension is active)
        this.integration.signalActive();

        this._initialized = true;
        log.info('SDK initialized successfully');
    }

    /**
     * Check if the SDK has been initialized.
     */
    get isInitialized(): boolean {
        return this._initialized;
    }

    /**
     * Get the SDK version.
     */
    get version(): string {
        try {
            return require('../package.json').version;
        } catch {
            return 'unknown';
        }
    }

    /**
     * Get info about the installed Antigravity version and SDK compatibility.
     * Available after initialize().
     */
    get agVersion(): AGVersionInfo | null {
        return this._agVersion;
    }

    /**
     * Detect if we're running inside Antigravity IDE.
     */
    private async _detectAntigravity(): Promise<boolean> {
        try {
            // Check for Antigravity-specific commands (VERIFIED naming)
            const commands = await this.commands.getAntigravityCommands();
            const hasAgentPanel = commands.includes('antigravity.agentPanel.open');

            if (hasAgentPanel) {
                log.debug(`Detected Antigravity (${commands.length} commands)`);
                return true;
            }

            // Fallback: check env
            const appName = vscode.env.appName;
            if (appName?.toLowerCase().includes('antigravity')) {
                log.debug(`Detected Antigravity via appName: ${appName}`);
                return true;
            }

            return false;
        } catch {
            return false;
        }
    }

    /**
     * Dispose of the SDK and all its resources.
     */
    dispose(): void {
        log.info('Disposing SDK');
        this._disposables.dispose();
    }
}
