/**
 * Cascade Manager — Session listing, creation, and monitoring.
 *
 * Provides high-level API to interact with Cascade conversations
 * using verified transport layer (CommandBridge + StateBridge).
 *
 * VERIFIED 2026-02-28: getDiagnostics.recentTrajectories returns clean JSON
 * with { googleAgentId, trajectoryId, summary, lastStepIndex, lastModifiedTime }.
 *
 * @module cascade/cascade-manager
 */

import { IDisposable, DisposableStore } from '../core/disposable';
import { EventEmitter, Event } from '../core/events';
import { Logger } from '../core/logger';
import type {
    ITrajectoryEntry,
    IAgentPreferences,
    IDiagnosticsInfo,
    ICreateSessionOptions,
} from '../core/types';
import { CommandBridge, AntigravityCommands } from '../transport/command-bridge';
import { StateBridge } from '../transport/state-bridge';

const log = new Logger('CascadeManager');

/**
 * Manages Cascade conversations.
 *
 * Primary data source: `antigravity.getDiagnostics` → `recentTrajectories`
 * Fallback: `antigravityUnifiedStateSync.trajectorySummaries` protobuf parsing
 *
 * @example
 * ```typescript
 * const manager = new CascadeManager(commands, state);
 * await manager.initialize();
 *
 * // List sessions (real titles from getDiagnostics)
 * const sessions = await manager.getSessions();
 * sessions.forEach(s => console.log(`${s.title} (step ${s.stepCount})`));
 *
 * // Read preferences (all 16 sentinel values)
 * const prefs = await manager.getPreferences();
 *
 * // Create & send
 * await manager.createSession({ task: 'Analyze coverage', background: true });
 * ```
 */
export class CascadeManager implements IDisposable {
    private readonly _disposables = new DisposableStore();
    private _sessions: ITrajectoryEntry[] = [];
    private _initialized = false;

    // Events
    private readonly _onSessionsChanged = this._disposables.add(new EventEmitter<ITrajectoryEntry[]>());
    /** Fires when the session list changes */
    public readonly onSessionsChanged: Event<ITrajectoryEntry[]> = this._onSessionsChanged.event;

    constructor(
        private readonly _commands: CommandBridge,
        private readonly _state: StateBridge,
    ) { }

    /**
     * Initialize the cascade manager.
     * Loads the initial session list from getDiagnostics.
     */
    async initialize(): Promise<void> {
        if (this._initialized) return;

        await this._loadSessions();
        this._initialized = true;
        log.info(`Initialized with ${this._sessions.length} sessions`);
    }

    // ─── Read API ───────────────────────────────────────────────────────────

    /**
     * Get all known Cascade sessions.
     *
     * Uses `getDiagnostics.recentTrajectories` (clean JSON with titles).
     *
     * @returns List of trajectory entries sorted by recency
     */
    async getSessions(): Promise<ITrajectoryEntry[]> {
        if (!this._initialized) {
            await this._loadSessions();
        }
        return [...this._sessions];
    }

    /**
     * Refresh the session list.
     *
     * @returns Updated session list
     */
    async refreshSessions(): Promise<ITrajectoryEntry[]> {
        await this._loadSessions();
        this._onSessionsChanged.fire(this._sessions);
        return [...this._sessions];
    }

    /**
     * Get agent preferences (all 16 sentinel values).
     */
    async getPreferences(): Promise<IAgentPreferences> {
        return this._state.getAgentPreferences();
    }

    /**
     * Get IDE diagnostics (176KB JSON with system info, logs, trajectories).
     *
     * Structure (verified):
     * - isRemote, systemInfo (OS, user, email)
     * - extensionLogs (Array[375])
     * - rendererLogs, mainThreadLogs, agentWindowConsoleLogs
     * - languageServerLogs
     * - recentTrajectories (Array[10])
     *
     * @returns Parsed diagnostics information
     */
    async getDiagnostics(): Promise<IDiagnosticsInfo> {
        const raw = await this._commands.execute<string>(AntigravityCommands.GET_DIAGNOSTICS);

        if (!raw || typeof raw !== 'string') {
            throw new Error('getDiagnostics returned unexpected type');
        }

        const parsed = JSON.parse(raw);

        return {
            isRemote: parsed.isRemote ?? false,
            systemInfo: {
                operatingSystem: parsed.systemInfo?.operatingSystem ?? 'unknown',
                timestamp: parsed.systemInfo?.timestamp ?? '',
                userEmail: parsed.systemInfo?.userEmail ?? '',
                userName: parsed.systemInfo?.userName ?? '',
            },
            raw: parsed,
        };
    }

    /**
     * Get the Chrome DevTools MCP URL.
     *
     * Verified: returns `http://127.0.0.1:{port}/mcp`
     *
     * @returns MCP URL string
     */
    async getMcpUrl(): Promise<string> {
        const result = await this._commands.execute<string>('antigravity.getChromeDevtoolsMcpUrl');
        return result ?? '';
    }

    /**
     * Check if a file is gitignored.
     *
     * @param filePath - Relative or absolute file path
     * @returns true if gitignored, false/null otherwise
     */
    async isFileGitIgnored(filePath: string): Promise<boolean> {
        const result = await this._commands.execute<boolean | null>('antigravity.isFileGitIgnored', filePath);
        return result === true;
    }

    // ─── Write API ──────────────────────────────────────────────────────────
    //
    // Two-layer architecture (VERIFIED 2026-02-28):
    //
    // Layer 1 — HEADLESS LS API (RECOMMENDED):
    //   Access: window.__xrayLS (from injected xray-inject.js in renderer)
    //   Method: Preact VNode tree → component.props.lsClient → 148 LS methods
    //   Creates cascade WITHOUT opening panel or switching UI.
    //   Usage:  await window.__xrayLS.createHeadless("prompt", 1018)
    //
    // Layer 2 — COMMAND API (FALLBACK, this file):
    //   Access: vscode.commands.executeCommand (extension host)
    //   Method: startNewConversation → sendPromptToAgentPanel → restore
    //   PROBLEM: Always switches UI, causes flickering, race conditions.
    //   Use only when renderer injection is not available.
    //
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Create a new Cascade conversation via VS Code commands.
     *
     * ⚠️ **FALLBACK APPROACH** — causes UI flickering.
     * For true headless creation, use `window.__xrayLS.createHeadless()`
     * from injected renderer scripts (see SDK injection module).
     *
     * VERIFIED 2026-02-28:
     * - `startNewConversation` ✅ creates new chat (but switches UI)
     * - `prioritized.chat.openNewConversation` ❌ does NOT create new
     * - `sendPromptToAgentPanel` ✅ sends to currently visible chat (always opens panel)
     * - `sendTextToChat` ❌ does not visibly work
     *
     * @param options - Session creation options
     * @returns Session ID (googleAgentId) or empty string if not detected
     */
    async createSession(options: ICreateSessionOptions): Promise<string> {
        log.info(`Creating session (command fallback): "${options.task.substring(0, 50)}..."`);

        // Snapshot current sessions to detect the new one
        const beforeIds = new Set(this._sessions.map(s => s.id));

        // Remember current active session (for background restore)
        let previousActiveId = '';
        if (options.background) {
            try {
                const raw = await this._commands.execute<string>(AntigravityCommands.GET_DIAGNOSTICS);
                if (raw && typeof raw === 'string') {
                    const diag = JSON.parse(raw);
                    if (Array.isArray(diag.recentTrajectories) && diag.recentTrajectories.length > 0) {
                        previousActiveId = diag.recentTrajectories[0].googleAgentId ?? '';
                    }
                }
            } catch { }
        }

        // Create new conversation (VERIFIED: startNewConversation works)
        await this._commands.execute(AntigravityCommands.START_NEW_CONVERSATION);
        await this._delay(1500); // Wait for UI to initialize

        // Send initial prompt
        if (options.task) {
            await this._commands.execute(AntigravityCommands.SEND_PROMPT_TO_AGENT, options.task);
        }

        // Mark as background if requested
        if (options.background) {
            await this._commands.execute(AntigravityCommands.TRACK_BACKGROUND_CONVERSATION);
        }

        // Wait for new session to appear in getDiagnostics
        const newId = await this._waitForNewSession(beforeIds, 8000);

        // If background: switch back to original conversation
        if (options.background && previousActiveId) {
            await this._delay(500);
            await this._commands.execute(AntigravityCommands.SET_VISIBLE_CONVERSATION, previousActiveId);
            log.info(`Background session created, restored to ${previousActiveId}`);
        }

        if (newId) {
            log.info(`Session created: ${newId}`);
        } else {
            log.warn('Session created but ID not detected within timeout');
        }

        return newId;
    }

    /**
     * Create a background Cascade conversation via commands.
     *
     * ⚠️ **FALLBACK** — Uses quick-switch approach (UI flickers briefly).
     * For true headless background sessions, use the renderer-side API:
     * ```javascript
     * // From injected JS (xray-inject.js):
     * const cascadeId = await window.__xrayLS.createHeadless("task", 1018);
     * ```
     *
     * @param task - Initial task/prompt to send
     * @returns Session ID or empty string
     */
    async createBackgroundSession(task: string): Promise<string> {
        return this.createSession({ task, background: true });
    }

    /**
     * Send a message to the active Cascade conversation.
     *
     * Uses `antigravity.sendTextToChat` — the primary text sending command.
     */
    async sendMessage(text: string): Promise<void> {
        await this._commands.execute(AntigravityCommands.SEND_TEXT_TO_CHAT, text);
    }

    /**
     * Send a prompt directly to the agent panel.
     *
     * Uses `antigravity.sendPromptToAgentPanel` — focuses the agent panel.
     */
    async sendPrompt(text: string): Promise<void> {
        await this._commands.execute(AntigravityCommands.SEND_PROMPT_TO_AGENT, text);
    }

    /**
     * Send a chat action message (e.g., typing indicator, feedback).
     *
     * Uses `antigravity.sendChatActionMessage`.
     */
    async sendChatAction(action: string): Promise<void> {
        await this._commands.execute(AntigravityCommands.SEND_CHAT_ACTION, action);
    }

    /**
     * Switch to a specific conversation.
     *
     * @param sessionId - Conversation UUID (googleAgentId)
     */
    async focusSession(sessionId: string): Promise<void> {
        await this._commands.execute(AntigravityCommands.SET_VISIBLE_CONVERSATION, sessionId);
    }

    /**
     * Open a new conversation in the agent panel (prioritized command).
     *
     * Uses `antigravity.prioritized.chat.openNewConversation` which both
     * opens the panel AND creates a fresh conversation.
     */
    async openNewConversation(): Promise<void> {
        await this._commands.execute(AntigravityCommands.OPEN_NEW_CONVERSATION);
    }

    /**
     * Execute a Cascade action.
     *
     * Uses `antigravity.executeCascadeAction`.
     *
     * @param action - Action data to execute
     */
    async executeCascadeAction(action: unknown): Promise<void> {
        await this._commands.execute(AntigravityCommands.EXECUTE_CASCADE_ACTION, action);
    }

    // ─── Step Control ───────────────────────────────────────────────────────

    /**
     * Accept the current agent step (code edit, file write, etc.).
     *
     * Uses `antigravity.agent.acceptAgentStep`.
     */
    async acceptStep(): Promise<void> {
        await this._commands.execute(AntigravityCommands.ACCEPT_AGENT_STEP);
    }

    /** Reject the current agent step. */
    async rejectStep(): Promise<void> {
        await this._commands.execute(AntigravityCommands.REJECT_AGENT_STEP);
    }

    /**
     * Accept a pending command (non-terminal, e.g. file edit confirmation).
     *
     * Uses `antigravity.command.accept`.
     * This is DIFFERENT from terminalCommand.accept.
     */
    async acceptCommand(): Promise<void> {
        await this._commands.execute(AntigravityCommands.COMMAND_ACCEPT);
    }

    /** Reject a pending command (non-terminal). */
    async rejectCommand(): Promise<void> {
        await this._commands.execute(AntigravityCommands.COMMAND_REJECT);
    }

    // ─── Terminal Control ───────────────────────────────────────────────────

    /**
     * Accept a pending terminal command.
     *
     * Uses `antigravity.terminalCommand.accept`.
     */
    async acceptTerminalCommand(): Promise<void> {
        await this._commands.execute(AntigravityCommands.TERMINAL_ACCEPT);
    }

    /** Reject a pending terminal command. */
    async rejectTerminalCommand(): Promise<void> {
        await this._commands.execute(AntigravityCommands.TERMINAL_REJECT);
    }

    /** Run a pending terminal command. */
    async runTerminalCommand(): Promise<void> {
        await this._commands.execute(AntigravityCommands.TERMINAL_RUN);
    }

    // ─── Panel Control ──────────────────────────────────────────────────────

    /** Open the Cascade agent panel */
    async openPanel(): Promise<void> {
        await this._commands.execute(AntigravityCommands.OPEN_AGENT_PANEL);
    }

    /** Focus the Cascade agent panel */
    async focusPanel(): Promise<void> {
        await this._commands.execute(AntigravityCommands.FOCUS_AGENT_PANEL);
    }

    /** Open the agent side panel */
    async openSidePanel(): Promise<void> {
        await this._commands.execute(AntigravityCommands.OPEN_AGENT_SIDE_PANEL);
    }

    /** Focus the agent side panel */
    async focusSidePanel(): Promise<void> {
        await this._commands.execute(AntigravityCommands.FOCUS_AGENT_SIDE_PANEL);
    }

    /**
     * Get the browser integration port (e.g., 57401).
     */
    async getBrowserPort(): Promise<number> {
        return this._commands.execute<number>(AntigravityCommands.GET_BROWSER_PORT);
    }

    // ─── Private ────────────────────────────────────────────────────────────

    /**
     * Load sessions from getDiagnostics.recentTrajectories (clean JSON).
     *
     * VERIFIED structure per entry:
     * {
     *   googleAgentId: "uuid",      ← conversation ID
     *   trajectoryId:  "uuid",      ← internal trajectory ID
     *   summary:       "title",     ← human-readable title
     *   lastStepIndex: 992,         ← step count
     *   lastModifiedTime: "ISO"     ← last activity
     * }
     */
    private async _loadSessions(): Promise<void> {
        try {
            // Primary: getDiagnostics.recentTrajectories (10 most recent, with titles)
            const raw = await this._commands.execute<string>(AntigravityCommands.GET_DIAGNOSTICS);
            if (raw && typeof raw === 'string') {
                const diag = JSON.parse(raw);
                if (Array.isArray(diag.recentTrajectories)) {
                    this._sessions = diag.recentTrajectories.map((entry: any) => ({
                        id: entry.googleAgentId ?? '',
                        title: entry.summary ?? 'Untitled',
                        stepCount: entry.lastStepIndex ?? 0,
                        workspaceUri: '',
                        lastModifiedTime: entry.lastModifiedTime ?? '',
                        trajectoryId: entry.trajectoryId ?? '',
                    }));
                    log.debug(`Loaded ${this._sessions.length} sessions from getDiagnostics`);
                    return;
                }
            }
        } catch (error) {
            log.warn('getDiagnostics failed, falling back to USS', error);
        }

        // Fallback: parse trajectory summaries protobuf
        try {
            await this._loadSessionsFromUSS();
        } catch (error) {
            log.error('Failed to load sessions from USS', error);
            this._sessions = [];
        }
    }

    /**
     * Fallback: extract sessions from USS trajectory summaries protobuf.
     */
    private async _loadSessionsFromUSS(): Promise<void> {
        const raw = await this._state.getRawValue('antigravityUnifiedStateSync.trajectorySummaries');
        if (!raw) {
            this._sessions = [];
            return;
        }

        const buffer = Buffer.from(raw, 'base64');
        const text = buffer.toString('utf8');

        // Extract UUIDs
        const uuids = [...new Set(text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) || [])];

        this._sessions = uuids.map((id, i) => ({
            id,
            title: `Conversation ${i + 1}`,
            stepCount: 0,
            workspaceUri: '',
        }));

        log.debug(`Loaded ${this._sessions.length} sessions from USS (fallback)`);
    }

    /**
     * Wait for a new session to appear in getDiagnostics.
     * Polls every 500ms up to timeoutMs.
     *
     * @returns New session ID or empty string if timeout
     */
    private async _waitForNewSession(beforeIds: Set<string>, timeoutMs: number): Promise<string> {
        const deadline = Date.now() + timeoutMs;
        const pollInterval = 500;

        while (Date.now() < deadline) {
            await this._delay(pollInterval);

            try {
                const raw = await this._commands.execute<string>(AntigravityCommands.GET_DIAGNOSTICS);
                if (!raw || typeof raw !== 'string') continue;

                const diag = JSON.parse(raw);
                if (!Array.isArray(diag.recentTrajectories)) continue;

                for (const entry of diag.recentTrajectories) {
                    const id = entry.googleAgentId;
                    if (id && !beforeIds.has(id)) {
                        // Update local session list
                        await this._loadSessions();
                        return id;
                    }
                }
            } catch {
                // ignore, retry
            }
        }

        return '';
    }

    /**
     * Simple delay utility.
     */
    private _delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    dispose(): void {
        this._disposables.dispose();
    }
}

