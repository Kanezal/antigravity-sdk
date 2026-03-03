/**
 * Integration Manager — Public API for UI integration into Agent View.
 *
 * Orchestrates ScriptGenerator and WorkbenchPatcher to provide
 * a clean, developer-friendly API.
 *
 * @module integration/integration-manager
 *
 * @example
 * ```typescript
 * import { IntegrationManager, IntegrationPoint } from 'antigravity-sdk';
 *
 * const integrator = new IntegrationManager();
 *
 * integrator.register({
 *   id: 'myStats',
 *   point: IntegrationPoint.TOP_BAR,
 *   icon: '📊',
 *   tooltip: 'Show Stats',
 *   toast: {
 *     title: 'My Extension Stats',
 *     rows: [{ key: 'turns:', value: 'Dynamic data here' }],
 *   },
 * });
 *
 * integrator.register({
 *   id: 'turnInfo',
 *   point: IntegrationPoint.TURN_METADATA,
 *   metrics: ['turnNumber', 'userCharCount', 'separator', 'aiCharCount', 'codeBlocks'],
 * });
 *
 * await integrator.install();
 * // Restart Antigravity to see changes
 * ```
 */

import * as fs from 'fs';
import { IDisposable } from '../core/disposable';
import { Logger } from '../core/logger';
import {
    IntegrationConfig,
    IntegrationPoint,
    IIntegrationManager,
    IButtonIntegration,
    ITurnMetaIntegration,
    IUserBadgeIntegration,
    IBotActionIntegration,
    IDropdownIntegration,
    ITitleIntegration,
    IToastConfig,
} from './types';
import { ScriptGenerator } from './script-generator';
import { WorkbenchPatcher } from './workbench-patcher';
import { IntegrityManager } from './integrity-manager';
import { TitleManager } from './title-manager';
import { generateTitleProxyCode } from './title-proxy';

const log = new Logger('IntegrationManager');

/**
 * Manages UI integrations into the Antigravity Agent View.
 *
 * Provides a declarative API to register integration points,
 * generates a self-contained JavaScript file, and installs it
 * into Antigravity's workbench.
 *
 * Features:
 * - **Theme-aware**: Adapts to dark/light mode automatically
 * - **Auto-repair**: Watches workbench.html and re-patches after updates
 * - **Dynamic update**: Re-generate script without re-patching workbench.html
 */
export class IntegrationManager implements IIntegrationManager, IDisposable {
    private readonly _configs: Map<string, IntegrationConfig> = new Map();
    private readonly _generator = new ScriptGenerator();
    private readonly _patcher: WorkbenchPatcher;
    private readonly _integrity: IntegrityManager;
    private readonly _titles = new TitleManager();
    private readonly _namespace: string;
    private _watcher: fs.FSWatcher | null = null;
    private _autoRepairDebounce: ReturnType<typeof setTimeout> | null = null;
    private _titleProxyEnabled = false;

    /**
     * @param namespace - Unique slug that isolates this extension's files.
     *   Derived automatically from `context.extension.id` when using AntigravitySDK.
     *   Multiple SDK-based extensions can coexist without conflicts.
     */
    constructor(namespace: string = 'default') {
        this._namespace = namespace;
        this._patcher = new WorkbenchPatcher(namespace);
        this._integrity = new IntegrityManager(
            this._patcher.getWorkbenchDir(),
            namespace,
        );
    }

    // ─── Registration ──────────────────────────────────────────────────

    /**
     * Register a single integration point.
     *
     * @throws If an integration with the same ID already exists
     */
    register(config: IntegrationConfig): void {
        if (this._configs.has(config.id)) {
            throw new Error(`Integration '${config.id}' is already registered`);
        }
        this._configs.set(config.id, config);
        log.debug(`Registered integration: ${config.id} (${config.point})`);
    }

    /**
     * Register multiple integration points at once.
     */
    registerMany(configs: IntegrationConfig[]): void {
        for (const c of configs) {
            this.register(c);
        }
    }

    /**
     * Remove a registered integration by ID.
     */
    unregister(id: string): void {
        this._configs.delete(id);
        log.debug(`Unregistered integration: ${id}`);
    }

    /**
     * Get all registered integrations.
     */
    getRegistered(): ReadonlyArray<IntegrationConfig> {
        return Array.from(this._configs.values());
    }

    // ─── Convenience methods (fluent API) ──────────────────────────────

    /**
     * Add a button to the top bar (near +, refresh icons).
     */
    addTopBarButton(id: string, icon: string, tooltip?: string, toast?: IToastConfig): this {
        this.register({
            id,
            point: IntegrationPoint.TOP_BAR,
            icon,
            tooltip,
            toast,
        } as IButtonIntegration);
        return this;
    }

    /**
     * Add a button to the top-right corner (before X).
     */
    addTopRightButton(id: string, icon: string, tooltip?: string, toast?: IToastConfig): this {
        this.register({
            id,
            point: IntegrationPoint.TOP_RIGHT,
            icon,
            tooltip,
            toast,
        } as IButtonIntegration);
        return this;
    }

    /**
     * Add a button next to the send/voice buttons.
     */
    addInputButton(id: string, icon: string, tooltip?: string, toast?: IToastConfig): this {
        this.register({
            id,
            point: IntegrationPoint.INPUT_AREA,
            icon,
            tooltip,
            toast,
        } as IButtonIntegration);
        return this;
    }

    /**
     * Add an icon to the bottom icon row (file, terminal, etc.).
     */
    addBottomIcon(id: string, icon: string, tooltip?: string, toast?: IToastConfig): this {
        this.register({
            id,
            point: IntegrationPoint.BOTTOM_ICONS,
            icon,
            tooltip,
            toast,
        } as IButtonIntegration);
        return this;
    }

    /**
     * Enable per-turn metadata display.
     */
    addTurnMetadata(id: string, metrics: ITurnMetaIntegration['metrics'], clickable = true): this {
        this.register({
            id,
            point: IntegrationPoint.TURN_METADATA,
            metrics,
            clickable,
        } as ITurnMetaIntegration);
        return this;
    }

    /**
     * Add character count badges to user messages.
     */
    addUserBadges(id: string, display: IUserBadgeIntegration['display'] = 'charCount'): this {
        this.register({
            id,
            point: IntegrationPoint.USER_BADGE,
            display,
        } as IUserBadgeIntegration);
        return this;
    }

    /**
     * Add an action button next to Good/Bad feedback.
     */
    addBotAction(id: string, icon: string, label: string, toast?: IToastConfig): this {
        this.register({
            id,
            point: IntegrationPoint.BOT_ACTION,
            icon,
            label,
            toast,
        } as IBotActionIntegration);
        return this;
    }

    /**
     * Add item(s) to the 3-dot dropdown menu.
     */
    addDropdownItem(id: string, label: string, icon?: string, toast?: IToastConfig, separator = false): this {
        this.register({
            id,
            point: IntegrationPoint.DROPDOWN_MENU,
            label,
            icon,
            toast,
            separator,
        } as IDropdownIntegration);
        return this;
    }

    /**
     * Enable chat title interaction.
     */
    addTitleInteraction(id: string, interaction: ITitleIntegration['interaction'] = 'dblclick', hint?: string, toast?: IToastConfig): this {
        this.register({
            id,
            point: IntegrationPoint.CHAT_TITLE,
            interaction,
            hint,
            toast,
        } as ITitleIntegration);
        return this;
    }

    // ─── Title Proxy ─────────────────────────────────────────────────

    /**
     * Enable the title proxy feature.
     *
     * Adds renderer-side code that intercepts the summaries provider
     * and injects custom chat titles. Uses structural matching to find
     * the provider (obfuscation-safe).
     *
     * After enabling, call `install()` or `updateScript()` to apply.
     *
     * @example
     * ```typescript
     * const sdk = new AntigravitySDK(context);
     * await sdk.initialize();
     *
     * sdk.integration.enableTitleProxy();
     * await sdk.integration.install();
     *
     * // Now rename from extension host:
     * sdk.integration.titles.rename(cascadeId, 'My Custom Title');
     * ```
     */
    enableTitleProxy(): this {
        this._titleProxyEnabled = true;
        if (this._patcher.isAvailable()) {
            this._titles.initialize(this._patcher.getWorkbenchDir(), this._namespace);
        }
        log.info('Title proxy enabled');
        return this;
    }

    /**
     * Access the title manager for programmatic title control.
     *
     * Requires `enableTitleProxy()` to be called first.
     *
     * @example
     * ```typescript
     * sdk.integration.titles.rename(cascadeId, 'My Title');
     * sdk.integration.titles.remove(cascadeId);
     * const all = sdk.integration.titles.getAll();
     * ```
     */
    get titles(): TitleManager {
        if (!this._titleProxyEnabled) {
            log.warn('Title proxy not enabled. Call enableTitleProxy() first.');
        }
        return this._titles;
    }

    // ─── Build & Install ───────────────────────────────────────────────

    /**
     * Generate the integration script from all registered configs.
     *
     * If title proxy is enabled, appends the title proxy renderer code.
     *
     * @returns Complete JavaScript code as a string
     */
    build(): string {
        const configs = Array.from(this._configs.values());
        if (configs.length === 0 && !this._titleProxyEnabled) {
            throw new Error('No integration points registered and title proxy not enabled');
        }

        let script = '';
        if (configs.length > 0) {
            log.info(`Building script for ${configs.length} integration(s)`);
            script = this._generator.generate(configs);
        }

        if (this._titleProxyEnabled) {
            log.info('Appending title proxy code');
            script += '\n' + generateTitleProxyCode(this._namespace);
        }

        return script;
    }

    /**
     * Install the generated script into workbench.html.
     *
     * For seamless hot-reload behavior, use `installSeamless()` instead.
     *
     * @returns true if the script content actually changed on disk
     */
    async install(): Promise<boolean> {
        if (!this._patcher.isAvailable()) {
            throw new Error('Antigravity workbench not found. Is Antigravity installed?');
        }

        const script = this.build();

        // Read existing script to detect changes
        const scriptPath = this._patcher.getScriptPath();
        let oldContent = '';
        try {
            if (fs.existsSync(scriptPath)) {
                oldContent = fs.readFileSync(scriptPath, 'utf8');
            }
        } catch { /* ignore */ }

        this._patcher.install(script);
        this._integrity.suppressCheck();
        this._patcher.writeHeartbeat();

        const changed = oldContent !== script;
        log.info(
            `Installed integration (${this._configs.size} points, titleProxy: ${this._titleProxyEnabled}) -> ${scriptPath} [${changed ? 'CHANGED' : 'unchanged'}]`,
        );

        return changed;
    }

    /**
     * Seamless install — handles everything automatically.
     *
     * This is the **recommended** install method for extension developers.
     * It handles the entire lifecycle:
     *
     * 1. **First install:** Writes script + patches HTML + prompts user to reload
     * 2. **Update:** Compares content, if changed → auto-reloads window (no prompt)
     * 3. **No change:** Does nothing
     *
     * The developer never needs to think about reload.
     *
     * @param executeCommand - Function to execute VS Code commands
     *   (pass `vscode.commands.executeCommand` or equivalent)
     *
     * @example
     * ```typescript
     * const sdk = new AntigravitySDK(context);
     * await sdk.initialize();
     *
     * sdk.integration.enableTitleProxy();
     * // That's it. SDK handles install, reload, everything.
     * await sdk.integration.installSeamless(
     *   (cmd) => vscode.commands.executeCommand(cmd),
     *   (msg, ...items) => vscode.window.showInformationMessage(msg, ...items),
     * );
     * ```
     */
    async installSeamless(
        executeCommand: (command: string) => Thenable<any>,
        showMessage?: (message: string, ...items: string[]) => Thenable<string | undefined>,
    ): Promise<void> {
        const wasInstalled = this._patcher.isInstalled();

        // Snapshot old content before install
        const scriptPath = this._patcher.getScriptPath();
        let oldContent = '';
        try {
            if (fs.existsSync(scriptPath)) {
                oldContent = fs.readFileSync(scriptPath, 'utf8');
            }
        } catch { /* ignore */ }

        const changed = await this.install();

        if (!wasInstalled) {
            // First install: prompt user
            log.info('First install. Prompting for reload.');
            if (showMessage) {
                const action = await showMessage(
                    'Better Antigravity installed. Reload to activate.',
                    'Reload Now',
                );
                if (action === 'Reload Now') {
                    await executeCommand('workbench.action.reloadWindow');
                }
            }
        } else if (changed) {
            // Update: auto-reload (no prompt)
            log.info('Script changed on disk. Auto-reloading window...');
            // Small delay to let extension finish activation
            setTimeout(() => executeCommand('workbench.action.reloadWindow'), 500);
        } else {
            log.debug('Script unchanged. No reload needed.');
        }
    }

    /**
     * Remove the integration from workbench.html.
     *
     * ⚠️ Requires Antigravity restart to take effect.
     */
    async uninstall(): Promise<void> {
        this._patcher.uninstall();
        this._integrity.releaseCheck();
        this._patcher.removeHeartbeat();
        this.disableAutoRepair();
        log.info('Uninstalled integration. Restart Antigravity to apply.');
    }

    /**
     * Check if an integration is currently installed.
     */
    isInstalled(): boolean {
        return this._patcher.isInstalled();
    }

    /**
     * Signal that the extension is active.
     *
     * Call this in your extension's `activate()` function.
     * The integration script checks for this heartbeat;
     * if it's missing or stale (>48h), the script won't start.
     *
     * This prevents orphaned integrations from running after
     * an extension is disabled or uninstalled.
     *
     * @example
     * ```typescript
     * export function activate(context: vscode.ExtensionContext) {
     *   const sdk = new AntigravitySDK(context);
     *   sdk.integration.signalActive();
     *   // ...
     * }
     * ```
     */
    signalActive(): void {
        this._patcher.writeHeartbeat();
        log.debug('Heartbeat refreshed');
    }

    // ─── Dynamic Update ─────────────────────────────────────────────────

    /**
     * Re-generate and overwrite the integration script without re-patching workbench.html.
     *
     * Use this after registering/unregistering integration points at runtime.
     * The script file is updated in-place; the next Antigravity restart
     * will pick up the changes. workbench.html <script> tag is unchanged.
     *
     * @returns true if script was updated
     */
    updateScript(): boolean {
        if (!this._patcher.isInstalled()) {
            log.warn('Cannot update script — integration is not installed');
            return false;
        }

        try {
            const script = this.build();
            fs.writeFileSync(this._patcher.getScriptPath(), script, 'utf8');
            log.info(`Script updated (${this._configs.size} points)`);
            return true;
        } catch (err) {
            log.error('Failed to update script', err);
            return false;
        }
    }

    // ─── Auto-Repair ────────────────────────────────────────────────────

    /**
     * Enable auto-repair: watches workbench.html for changes
     * and automatically re-applies the integration patch.
     *
     * This handles Antigravity updates that overwrite workbench.html.
     * The watcher detects when the file changes and re-patches it
     * if the integration marker is missing.
     *
     * @example
     * ```typescript
     * const integrator = new IntegrationManager();
     * integrator.useDemoPreset();
     * await integrator.install();
     * integrator.enableAutoRepair(); // Survive Antigravity updates
     * ```
     */
    enableAutoRepair(): void {
        if (this._watcher) return;

        const htmlPath = this._patcher.getWorkbenchDir() + '\\workbench.html';
        if (!fs.existsSync(htmlPath)) {
            log.warn('Cannot enable auto-repair — workbench.html not found');
            return;
        }

        try {
            this._watcher = fs.watch(htmlPath, (eventType) => {
                if (eventType !== 'change') return;

                // Debounce — Antigravity may write multiple times
                if (this._autoRepairDebounce) clearTimeout(this._autoRepairDebounce);
                this._autoRepairDebounce = setTimeout(() => {
                    this._tryRepair();
                }, 2000);
            });

            log.info('Auto-repair enabled — watching workbench.html');
        } catch (err) {
            log.error('Failed to enable auto-repair', err);
        }
    }

    /**
     * Disable auto-repair watcher.
     */
    disableAutoRepair(): void {
        if (this._watcher) {
            this._watcher.close();
            this._watcher = null;
            log.info('Auto-repair disabled');
        }
        if (this._autoRepairDebounce) {
            clearTimeout(this._autoRepairDebounce);
            this._autoRepairDebounce = null;
        }
    }

    /**
     * Whether auto-repair is active.
     */
    get isAutoRepairEnabled(): boolean {
        return this._watcher !== null;
    }

    private _tryRepair(): void {
        try {
            if (this._patcher.isInstalled()) {
                log.debug('Auto-repair: integration still present, no action needed');
                return;
            }

            if (this._configs.size === 0) {
                log.debug('Auto-repair: no configs registered, skipping');
                return;
            }

            log.info('Auto-repair: integration lost (Antigravity update?), re-patching...');
            const script = this.build();
            this._patcher.install(script);
            this._integrity.repair();
            log.info('Auto-repair: re-patched successfully. Restart Antigravity.');
        } catch (err) {
            log.error('Auto-repair failed', err);
        }
    }

    // ─── Preset ────────────────────────────────────────────────────────

    /**
     * Register the Demo preset — a complete demo of all 9 integration points.
     * Useful for testing and as a reference implementation.
     */
    useDemoPreset(): this {
        this.addTopBarButton('demo_overview', '\u{1F4E1}', 'SDK: Session Overview', {
            title: 'Session Overview',
            badge: { text: 'TOP_BAR', bgColor: 'rgba(79,195,247,.2)', textColor: '#4fc3f7' },
            rows: [
                { key: 'location:', value: 'Header icon bar' },
                { key: 'use case:', value: 'Session overview, navigation' },
            ],
        });

        this.addTopRightButton('demo_perf', '\u26A1', 'SDK: Performance', {
            title: 'Performance',
            badge: { text: 'TOP_RIGHT', bgColor: 'rgba(255,193,7,.2)', textColor: '#ffd54f' },
            rows: [
                { key: 'location:', value: 'Top right, before close' },
                { key: 'use case:', value: 'Status indicator' },
            ],
        });

        this.addInputButton('demo_stats', '\u{1F4CA}', 'SDK: Stats', {
            title: 'Input Stats',
            badge: { text: 'INPUT_AREA', bgColor: 'rgba(76,175,80,.2)', textColor: '#81c784' },
            rows: [
                { key: 'location:', value: 'Next to send button' },
                { key: 'use case:', value: 'Token counter, analytics' },
            ],
        });

        this.addBottomIcon('demo_actions', '\u2630', 'SDK: Quick Actions', {
            title: 'Quick Actions',
            badge: { text: 'BOTTOM_ICONS', bgColor: 'rgba(255,152,0,.2)', textColor: '#ffb74d' },
            rows: [
                { key: 'location:', value: 'Bottom icon row' },
                { key: 'use case:', value: 'Mode switches, quick actions' },
            ],
        });

        this.addTurnMetadata('demo_turns', [
            'turnNumber',
            'userCharCount',
            'separator',
            'aiCharCount',
            'codeBlocks',
            'thinkingIndicator',
        ]);

        this.addUserBadges('demo_ubadge', 'charCount');

        this.addBotAction('demo_inspect', '\u{1F50D}', 'inspect', {
            title: 'Response Inspector',
            badge: { text: 'BOT_ACTION', bgColor: 'rgba(156,39,176,.2)', textColor: '#ce93d8' },
            rows: [
                { key: 'location:', value: 'Next to Good/Bad' },
                { key: 'use case:', value: 'Response analysis' },
            ],
        });

        this.addDropdownItem('demo_menu_stats', 'SDK Stats', '\u{1F4CA}', {
            title: 'Extended Stats',
            badge: { text: 'DROPDOWN', bgColor: 'rgba(233,30,99,.2)', textColor: '#f48fb1' },
            rows: [
                { key: 'location:', value: '3-dot dropdown menu' },
                { key: 'use case:', value: 'Extended actions' },
            ],
        }, true);

        this.addDropdownItem('demo_menu_debug', 'SDK Debug', '\u{1F9EA}', {
            title: 'Debug Info',
            badge: { text: 'DEBUG', bgColor: 'rgba(255,87,34,.2)', textColor: '#ff8a65' },
            rows: [
                { key: 'location:', value: '3-dot dropdown menu' },
                { key: 'use case:', value: 'Debug, diagnostics' },
            ],
        });

        this.addTitleInteraction('demo_title', 'dblclick', 'dblclick', {
            title: 'Chat Title',
            badge: { text: 'TITLE', bgColor: 'rgba(0,150,136,.2)', textColor: '#80cbc4' },
            rows: [
                { key: 'location:', value: 'Conversation title' },
                { key: 'use case:', value: 'Rename, bookmark' },
            ],
        });

        return this;
    }

    // ─── Dispose ───────────────────────────────────────────────────────

    dispose(): void {
        this.disableAutoRepair();
        this._configs.clear();
        this._titles.dispose();
    }
}
