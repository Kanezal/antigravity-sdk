/**
 * Injection Manager — Public API for UI injection into Agent View.
 *
 * Orchestrates ScriptGenerator and WorkbenchPatcher to provide
 * a clean, developer-friendly API.
 *
 * @module injection/injection-manager
 *
 * @example
 * ```typescript
 * import { InjectionManager, InjectionPoint } from 'antigravity-sdk';
 *
 * const injector = new InjectionManager();
 *
 * injector.register({
 *   id: 'myStats',
 *   point: InjectionPoint.TOP_BAR,
 *   icon: '📊',
 *   tooltip: 'Show Stats',
 *   toast: {
 *     title: 'My Extension Stats',
 *     rows: [{ key: 'turns:', value: 'Dynamic data here' }],
 *   },
 * });
 *
 * injector.register({
 *   id: 'turnInfo',
 *   point: InjectionPoint.TURN_METADATA,
 *   metrics: ['turnNumber', 'userCharCount', 'separator', 'aiCharCount', 'codeBlocks'],
 * });
 *
 * await injector.install();
 * // Restart Antigravity to see changes
 * ```
 */

import * as fs from 'fs';
import { IDisposable } from '../core/disposable';
import { Logger } from '../core/logger';
import {
    InjectionConfig,
    InjectionPoint,
    IInjectionManager,
    IButtonInjection,
    ITurnMetaInjection,
    IUserBadgeInjection,
    IBotActionInjection,
    IDropdownInjection,
    ITitleInjection,
    IToastConfig,
} from './types';
import { ScriptGenerator } from './script-generator';
import { WorkbenchPatcher } from './workbench-patcher';

const log = new Logger('InjectionManager');

/**
 * Manages UI injections into the Antigravity Agent View.
 *
 * Provides a declarative API to register injection points,
 * generates a self-contained JavaScript file, and installs it
 * into Antigravity's workbench.
 *
 * Phase 4 features:
 * - **Theme-aware**: Adapts to dark/light mode automatically
 * - **Auto-repair**: Watches workbench.html and re-patches after updates
 * - **Dynamic update**: Re-generate script without re-patching workbench.html
 */
export class InjectionManager implements IInjectionManager, IDisposable {
    private readonly _configs: Map<string, InjectionConfig> = new Map();
    private readonly _generator = new ScriptGenerator();
    private readonly _patcher = new WorkbenchPatcher();
    private _watcher: fs.FSWatcher | null = null;
    private _autoRepairDebounce: ReturnType<typeof setTimeout> | null = null;

    // ─── Registration ──────────────────────────────────────────────────

    /**
     * Register a single injection point.
     *
     * @throws If an injection with the same ID already exists
     */
    register(config: InjectionConfig): void {
        if (this._configs.has(config.id)) {
            throw new Error(`Injection '${config.id}' is already registered`);
        }
        this._configs.set(config.id, config);
        log.debug(`Registered injection: ${config.id} (${config.point})`);
    }

    /**
     * Register multiple injection points at once.
     */
    registerMany(configs: InjectionConfig[]): void {
        for (const c of configs) {
            this.register(c);
        }
    }

    /**
     * Remove a registered injection by ID.
     */
    unregister(id: string): void {
        this._configs.delete(id);
        log.debug(`Unregistered injection: ${id}`);
    }

    /**
     * Get all registered injections.
     */
    getRegistered(): ReadonlyArray<InjectionConfig> {
        return Array.from(this._configs.values());
    }

    // ─── Convenience methods (fluent API) ──────────────────────────────

    /**
     * Add a button to the top bar (near +, refresh icons).
     */
    addTopBarButton(id: string, icon: string, tooltip?: string, toast?: IToastConfig): this {
        this.register({
            id,
            point: InjectionPoint.TOP_BAR,
            icon,
            tooltip,
            toast,
        } as IButtonInjection);
        return this;
    }

    /**
     * Add a button to the top-right corner (before X).
     */
    addTopRightButton(id: string, icon: string, tooltip?: string, toast?: IToastConfig): this {
        this.register({
            id,
            point: InjectionPoint.TOP_RIGHT,
            icon,
            tooltip,
            toast,
        } as IButtonInjection);
        return this;
    }

    /**
     * Add a button next to the send/voice buttons.
     */
    addInputButton(id: string, icon: string, tooltip?: string, toast?: IToastConfig): this {
        this.register({
            id,
            point: InjectionPoint.INPUT_AREA,
            icon,
            tooltip,
            toast,
        } as IButtonInjection);
        return this;
    }

    /**
     * Add an icon to the bottom icon row (file, terminal, etc.).
     */
    addBottomIcon(id: string, icon: string, tooltip?: string, toast?: IToastConfig): this {
        this.register({
            id,
            point: InjectionPoint.BOTTOM_ICONS,
            icon,
            tooltip,
            toast,
        } as IButtonInjection);
        return this;
    }

    /**
     * Enable per-turn metadata display.
     */
    addTurnMetadata(id: string, metrics: ITurnMetaInjection['metrics'], clickable = true): this {
        this.register({
            id,
            point: InjectionPoint.TURN_METADATA,
            metrics,
            clickable,
        } as ITurnMetaInjection);
        return this;
    }

    /**
     * Add character count badges to user messages.
     */
    addUserBadges(id: string, display: IUserBadgeInjection['display'] = 'charCount'): this {
        this.register({
            id,
            point: InjectionPoint.USER_BADGE,
            display,
        } as IUserBadgeInjection);
        return this;
    }

    /**
     * Add an action button next to Good/Bad feedback.
     */
    addBotAction(id: string, icon: string, label: string, toast?: IToastConfig): this {
        this.register({
            id,
            point: InjectionPoint.BOT_ACTION,
            icon,
            label,
            toast,
        } as IBotActionInjection);
        return this;
    }

    /**
     * Add item(s) to the 3-dot dropdown menu.
     */
    addDropdownItem(id: string, label: string, icon?: string, toast?: IToastConfig, separator = false): this {
        this.register({
            id,
            point: InjectionPoint.DROPDOWN_MENU,
            label,
            icon,
            toast,
            separator,
        } as IDropdownInjection);
        return this;
    }

    /**
     * Enable chat title interaction.
     */
    addTitleInteraction(id: string, interaction: ITitleInjection['interaction'] = 'dblclick', hint?: string, toast?: IToastConfig): this {
        this.register({
            id,
            point: InjectionPoint.CHAT_TITLE,
            interaction,
            hint,
            toast,
        } as ITitleInjection);
        return this;
    }

    // ─── Build & Install ───────────────────────────────────────────────

    /**
     * Generate the injection script from all registered configs.
     *
     * @returns Complete JavaScript code as a string
     */
    build(): string {
        const configs = Array.from(this._configs.values());
        if (configs.length === 0) {
            throw new Error('No injection points registered');
        }
        log.info(`Building script for ${configs.length} injection(s)`);
        return this._generator.generate(configs);
    }

    /**
     * Install the generated script into workbench.html.
     *
     * ⚠️ Requires Antigravity restart to take effect.
     * ⚠️ Will be overwritten by Antigravity updates (use enableAutoRepair).
     */
    async install(): Promise<void> {
        if (!this._patcher.isAvailable()) {
            throw new Error('Antigravity workbench not found. Is Antigravity installed?');
        }

        const script = this.build();
        this._patcher.install(script);

        log.info(
            `Installed injection (${this._configs.size} points) → ${this._patcher.getScriptPath()}`,
        );
        log.info('Restart Antigravity to apply changes');
    }

    /**
     * Remove the injection from workbench.html.
     *
     * ⚠️ Requires Antigravity restart to take effect.
     */
    async uninstall(): Promise<void> {
        this._patcher.uninstall();
        this.disableAutoRepair();
        log.info('Uninstalled injection. Restart Antigravity to apply.');
    }

    /**
     * Check if an injection is currently installed.
     */
    isInstalled(): boolean {
        return this._patcher.isInstalled();
    }

    // ─── Phase 4: Dynamic Update ───────────────────────────────────────

    /**
     * Re-generate and overwrite the injection script without re-patching workbench.html.
     *
     * Use this after registering/unregistering injection points at runtime.
     * The script file is updated in-place; the next Antigravity restart
     * will pick up the changes. workbench.html <script> tag is unchanged.
     *
     * @returns true if script was updated
     */
    updateScript(): boolean {
        if (!this._patcher.isInstalled()) {
            log.warn('Cannot update script — injection is not installed');
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

    // ─── Phase 4: Auto-Repair ──────────────────────────────────────────

    /**
     * Enable auto-repair: watches workbench.html for changes
     * and automatically re-applies the injection patch.
     *
     * This handles Antigravity updates that overwrite workbench.html.
     * The watcher detects when the file changes and re-patches it
     * if the injection marker is missing.
     *
     * @example
     * ```typescript
     * const injector = new InjectionManager();
     * injector.useXRayPreset();
     * await injector.install();
     * injector.enableAutoRepair(); // Survive Antigravity updates
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
                log.debug('Auto-repair: injection still present, no action needed');
                return;
            }

            if (this._configs.size === 0) {
                log.debug('Auto-repair: no configs registered, skipping');
                return;
            }

            log.info('Auto-repair: injection lost (Antigravity update?), re-patching...');
            const script = this.build();
            this._patcher.install(script);
            log.info('Auto-repair: ✅ Re-patched successfully. Restart Antigravity.');
        } catch (err) {
            log.error('Auto-repair failed', err);
        }
    }

    // ─── Preset ────────────────────────────────────────────────────────

    /**
     * Register the X-Ray preset — a complete demo of all 9 injection points.
     * Useful for testing and as a reference implementation.
     */
    useXRayPreset(): this {
        this.addTopBarButton('xray_overview', '\u{1F4E1}', 'X-Ray: Session Overview', {
            title: 'Session Overview',
            badge: { text: 'TOP_BAR', bgColor: 'rgba(79,195,247,.2)', textColor: '#4fc3f7' },
            rows: [
                { key: 'location:', value: 'Header icon bar' },
                { key: 'use case:', value: 'Session overview, navigation' },
            ],
        });

        this.addTopRightButton('xray_perf', '\u26A1', 'X-Ray: Performance', {
            title: 'Performance',
            badge: { text: 'TOP_RIGHT', bgColor: 'rgba(255,193,7,.2)', textColor: '#ffd54f' },
            rows: [
                { key: 'location:', value: 'Top right, before close' },
                { key: 'use case:', value: 'Status indicator' },
            ],
        });

        this.addInputButton('xray_stats', '\u{1F4CA}', 'X-Ray: Stats', {
            title: 'Input Stats',
            badge: { text: 'INPUT_AREA', bgColor: 'rgba(76,175,80,.2)', textColor: '#81c784' },
            rows: [
                { key: 'location:', value: 'Next to send button' },
                { key: 'use case:', value: 'Token counter, analytics' },
            ],
        });

        this.addBottomIcon('xray_actions', '\u2630', 'X-Ray: Quick Actions', {
            title: 'Quick Actions',
            badge: { text: 'BOTTOM_ICONS', bgColor: 'rgba(255,152,0,.2)', textColor: '#ffb74d' },
            rows: [
                { key: 'location:', value: 'Bottom icon row' },
                { key: 'use case:', value: 'Mode switches, quick actions' },
            ],
        });

        this.addTurnMetadata('xray_turns', [
            'turnNumber',
            'userCharCount',
            'separator',
            'aiCharCount',
            'codeBlocks',
            'thinkingIndicator',
        ]);

        this.addUserBadges('xray_ubadge', 'charCount');

        this.addBotAction('xray_inspect', '\u{1F50D}', 'inspect', {
            title: 'Response Inspector',
            badge: { text: 'BOT_ACTION', bgColor: 'rgba(156,39,176,.2)', textColor: '#ce93d8' },
            rows: [
                { key: 'location:', value: 'Next to Good/Bad' },
                { key: 'use case:', value: 'Response analysis' },
            ],
        });

        this.addDropdownItem('xray_menu_stats', 'X-Ray Stats', '\u{1F4CA}', {
            title: 'Extended Stats',
            badge: { text: 'DROPDOWN', bgColor: 'rgba(233,30,99,.2)', textColor: '#f48fb1' },
            rows: [
                { key: 'location:', value: '3-dot dropdown menu' },
                { key: 'use case:', value: 'Extended actions' },
            ],
        }, true);

        this.addDropdownItem('xray_menu_debug', 'X-Ray Debug', '\u{1F9EA}', {
            title: 'Debug Info',
            badge: { text: 'DEBUG', bgColor: 'rgba(255,87,34,.2)', textColor: '#ff8a65' },
            rows: [
                { key: 'location:', value: '3-dot dropdown menu' },
                { key: 'use case:', value: 'Debug, diagnostics' },
            ],
        });

        this.addTitleInteraction('xray_title', 'dblclick', 'dblclick', {
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
    }
}

