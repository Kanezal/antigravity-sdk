/**
 * Command Bridge — executes Antigravity internal commands via VS Code API.
 *
 * All commands go through `vscode.commands.executeCommand()` which is the
 * safe, official way to interact with Antigravity from extensions.
 *
 * VERIFIED: All commands listed below were confirmed to exist in
 * Antigravity v1.107.0 workbench.desktop.main.js and extension.js
 * on 2026-02-28.
 *
 * @module transport/command-bridge
 */

import * as vscode from 'vscode';
import { IDisposable } from '../core/disposable';
import { CommandExecutionError } from '../core/errors';
import { Logger } from '../core/logger';

const log = new Logger('CommandBridge');

/**
 * All known Antigravity commands, organized by category.
 *
 * Sources: workbench.desktop.main.js (160+ commands) + extension.js (45 commands)
 */
export const AntigravityCommands = {

    // ─── Agent Panel & UI (VERIFIED: .open/.focus suffix required) ────────

    /** Open the Cascade agent panel */
    OPEN_AGENT_PANEL: 'antigravity.agentPanel.open',
    /** Focus the Cascade agent panel */
    FOCUS_AGENT_PANEL: 'antigravity.agentPanel.focus',
    /** Open the agent side panel */
    OPEN_AGENT_SIDE_PANEL: 'antigravity.agentSidePanel.open',
    /** Focus the agent side panel */
    FOCUS_AGENT_SIDE_PANEL: 'antigravity.agentSidePanel.focus',
    /** Toggle side panel visibility */
    TOGGLE_SIDE_PANEL: 'antigravity.agentSidePanel.toggleVisibility',
    /** Open agent (generic) */
    OPEN_AGENT: 'antigravity.openAgent',
    /** Toggle chat focus */
    TOGGLE_CHAT_FOCUS: 'antigravity.toggleChatFocus',
    /** Switch between workspace editor and agent view */
    SWITCH_WORKSPACE_AGENT: 'antigravity.switchBetweenWorkspaceAndAgent',

    // ─── Conversation Management (Critical for SDK) ──────────────────────

    /** Start a new conversation */
    START_NEW_CONVERSATION: 'antigravity.startNewConversation',
    /** Send a prompt to the agent panel */
    SEND_PROMPT_TO_AGENT: 'antigravity.sendPromptToAgentPanel',
    /** Send text to chat */
    SEND_TEXT_TO_CHAT: 'antigravity.sendTextToChat',
    /** Send a chat action message */
    SEND_CHAT_ACTION: 'antigravity.sendChatActionMessage',
    /** Set which conversation is visible */
    SET_VISIBLE_CONVERSATION: 'antigravity.setVisibleConversation',
    /** Execute a cascade action */
    EXECUTE_CASCADE_ACTION: 'antigravity.executeCascadeAction',
    /** Broadcast conversation deletion to all windows */
    BROADCAST_CONVERSATION_DELETION: 'antigravity.broadcastConversationDeletion',
    /** Track that a background conversation was created */
    TRACK_BACKGROUND_CONVERSATION: 'antigravity.trackBackgroundConversationCreated',

    // ─── Agent Step Control (VERIFIED) ────────────────────────────────────

    /** Accept the current agent step */
    ACCEPT_AGENT_STEP: 'antigravity.agent.acceptAgentStep',
    /** Reject the current agent step */
    REJECT_AGENT_STEP: 'antigravity.agent.rejectAgentStep',
    /** Accept a pending command */
    COMMAND_ACCEPT: 'antigravity.command.accept',
    /** Reject a pending command */
    COMMAND_REJECT: 'antigravity.command.reject',
    /** Accept a terminal command */
    TERMINAL_ACCEPT: 'antigravity.terminalCommand.accept',
    /** Reject a terminal command */
    TERMINAL_REJECT: 'antigravity.terminalCommand.reject',
    /** Run a terminal command */
    TERMINAL_RUN: 'antigravity.terminalCommand.run',
    /** Open new conversation (prioritized) */
    OPEN_NEW_CONVERSATION: 'antigravity.prioritized.chat.openNewConversation',

    // ─── Terminal Integration ─────────────────────────────────────────────

    /** Notify terminal command started */
    TERMINAL_COMMAND_START: 'antigravity.onManagerTerminalCommandStart',
    /** Notify terminal command data */
    TERMINAL_COMMAND_DATA: 'antigravity.onManagerTerminalCommandData',
    /** Notify terminal command finished */
    TERMINAL_COMMAND_FINISH: 'antigravity.onManagerTerminalCommandFinish',
    /** Update last terminal command */
    UPDATE_TERMINAL_LAST_COMMAND: 'antigravity.updateTerminalLastCommand',
    /** Notify shell command completion */
    ON_SHELL_COMPLETION: 'antigravity.onShellCommandCompletion',
    /** Show managed terminal */
    SHOW_MANAGED_TERMINAL: 'antigravity.showManagedTerminal',
    /** Send terminal output to chat */
    SEND_TERMINAL_TO_CHAT: 'antigravity.sendTerminalToChat',
    /** Send terminal output to side panel */
    SEND_TERMINAL_TO_SIDE_PANEL: 'antigravity.sendTerminalToSidePanel',

    // ─── Agent & Mode ─────────────────────────────────────────────────────

    /** Initialize the agent */
    INITIALIZE_AGENT: 'antigravity.initializeAgent',

    // ─── Conversation Picker & Workspace ──────────────────────────────────

    /** Open conversation workspace picker */
    OPEN_CONVERSATION_PICKER: 'antigravity.openConversationWorkspaceQuickPick',
    /** Open conversation picker (alternative) */
    OPEN_CONV_PICKER_ALT: 'antigravity.openConversationPicker',
    /** Set working directories */
    SET_WORKING_DIRS: 'antigravity.setWorkingDirectories',

    // ─── Review & Diff ────────────────────────────────────────────────────

    /** Open review changes view */
    OPEN_REVIEW_CHANGES: 'antigravity.openReviewChanges',
    /** Open diff view */
    OPEN_DIFF_VIEW: 'antigravity.openDiffView',
    /** Open diff zones */
    OPEN_DIFF_ZONES: 'antigravity.openDiffZones',
    /** Close all diff zones */
    CLOSE_ALL_DIFF_ZONES: 'antigravity.closeAllDiffZones',

    // ─── Rules & Workflows ────────────────────────────────────────────────

    /** Create a new rule */
    CREATE_RULE: 'antigravity.createRule',
    /** Create a new workflow */
    CREATE_WORKFLOW: 'antigravity.createWorkflow',
    /** Create a global workflow */
    CREATE_GLOBAL_WORKFLOW: 'antigravity.createGlobalWorkflow',
    /** Open global rules */
    OPEN_GLOBAL_RULES: 'antigravity.openGlobalRules',
    /** Open workspace rules */
    OPEN_WORKSPACE_RULES: 'antigravity.openWorkspaceRules',

    // ─── Plugins & MCP ────────────────────────────────────────────────────

    /** Open configure plugins page */
    OPEN_CONFIGURE_PLUGINS: 'antigravity.openConfigurePluginsPage',
    /** Get Cascade plugin template */
    GET_PLUGIN_TEMPLATE: 'antigravity.getCascadePluginTemplate',
    /** Poll MCP server states */
    POLL_MCP_SERVERS: 'antigravity.pollMcpServerStates',
    /** Open MCP config file */
    OPEN_MCP_CONFIG: 'antigravity.openMcpConfigFile',
    /** Open MCP docs page */
    OPEN_MCP_DOCS: 'antigravity.openMcpDocsPage',
    /** Update plugin installation count */
    UPDATE_PLUGIN_COUNT: 'antigravity.updatePluginInstallationCount',

    // ─── Autocomplete ─────────────────────────────────────────────────────

    /** Enable autocomplete */
    ENABLE_AUTOCOMPLETE: 'antigravity.enableAutocomplete',
    /** Disable autocomplete */
    DISABLE_AUTOCOMPLETE: 'antigravity.disableAutocomplete',
    /** Accept completion */
    ACCEPT_COMPLETION: 'antigravity.acceptCompletion',
    /** Force supercomplete */
    FORCE_SUPERCOMPLETE: 'antigravity.forceSupercomplete',
    /** Snooze autocomplete temporarily */
    SNOOZE_AUTOCOMPLETE: 'antigravity.snoozeAutocomplete',
    /** Cancel snooze */
    CANCEL_SNOOZE: 'antigravity.cancelSnoozeAutocomplete',

    // ─── Auth & Account ───────────────────────────────────────────────────

    /** Login to Antigravity */
    LOGIN: 'antigravity.login',
    /** Cancel login */
    CANCEL_LOGIN: 'antigravity.cancelLogin',
    /** Handle auth refresh */
    HANDLE_AUTH_REFRESH: 'antigravity.handleAuthRefresh',
    /** Sign in to Antigravity */
    SIGN_IN: 'antigravity.SignInToAntigravity',

    // ─── Diagnostics & Debug ──────────────────────────────────────────────

    /** Get diagnostics info */
    GET_DIAGNOSTICS: 'antigravity.getDiagnostics',
    /** Download diagnostics bundle */
    DOWNLOAD_DIAGNOSTICS: 'antigravity.downloadDiagnostics',
    /** Capture traces */
    CAPTURE_TRACES: 'antigravity.captureTraces',
    /** Enable tracing */
    ENABLE_TRACING: 'antigravity.enableTracing',
    /** Clear and disable tracing */
    CLEAR_TRACING: 'antigravity.clearAndDisableTracing',
    /** Get manager trace */
    GET_MANAGER_TRACE: 'antigravity.getManagerTrace',
    /** Get workbench trace */
    GET_WORKBENCH_TRACE: 'antigravity.getWorkbenchTrace',
    /** Toggle debug info widget */
    TOGGLE_DEBUG_INFO: 'antigravity.toggleDebugInfoWidget',
    /** Open troubleshooting */
    OPEN_TROUBLESHOOTING: 'antigravity.openTroubleshooting',
    /** Open issue reporter */
    OPEN_ISSUE_REPORTER: 'antigravity.openIssueReporter',

    // ─── Language Server ──────────────────────────────────────────────────

    /** Restart the language server */
    RESTART_LANGUAGE_SERVER: 'antigravity.restartLanguageServer',
    /** Kill language server and reload window */
    KILL_LS_AND_RELOAD: 'antigravity.killLanguageServerAndReloadWindow',

    // ─── Git & Commit ─────────────────────────────────────────────────────

    /** Generate commit message via AI */
    GENERATE_COMMIT_MESSAGE: 'antigravity.generateCommitMessage',
    /** Cancel commit message generation */
    CANCEL_COMMIT_MESSAGE: 'antigravity.cancelGenerateCommitMessage',

    // ─── Browser ──────────────────────────────────────────────────────────

    /** Open browser */
    OPEN_BROWSER: 'antigravity.openBrowser',
    /** Get browser onboarding port (returns number, e.g. 57401) */
    GET_BROWSER_PORT: 'antigravity.getBrowserOnboardingPort',

    // ─── Settings & Import ────────────────────────────────────────────────

    /** Open quick settings panel */
    OPEN_QUICK_SETTINGS: 'antigravity.openQuickSettingsPanel',
    /** Open customizations tab */
    OPEN_CUSTOMIZATIONS: 'antigravity.openCustomizationsTab',
    /** Import VS Code settings */
    IMPORT_VSCODE_SETTINGS: 'antigravity.importVSCodeSettings',
    /** Import VS Code extensions */
    IMPORT_VSCODE_EXTENSIONS: 'antigravity.importVSCodeExtensions',
    /** Import Cursor settings */
    IMPORT_CURSOR_SETTINGS: 'antigravity.importCursorSettings',
    /** Import Cursor extensions */
    IMPORT_CURSOR_EXTENSIONS: 'antigravity.importCursorExtensions',

    // ─── Misc ─────────────────────────────────────────────────────────────

    /** Reload window */
    RELOAD_WINDOW: 'antigravity.reloadWindow',
    /** Open documentation */
    OPEN_DOCS: 'antigravity.openDocs',
    /** Open changelog */
    OPEN_CHANGELOG: 'antigravity.openChangeLog',
    /** Explain and fix problem (from diagnostics) */
    EXPLAIN_AND_FIX: 'antigravity.explainAndFixProblem',
    /** Open a URL */
    OPEN_URL: 'antigravity.openGenericUrl',
    /** Editor mode settings */
    EDITOR_MODE_SETTINGS: 'antigravity.editorModeSettings',

} as const;

/**
 * Bridges between the SDK and Antigravity's command system.
 *
 * All interactions with Antigravity go through registered VS Code commands,
 * ensuring we never bypass the official extension API.
 *
 * @example
 * ```typescript
 * const bridge = new CommandBridge();
 *
 * // Open the agent panel
 * await bridge.execute(AntigravityCommands.OPEN_AGENT_PANEL);
 *
 * // Start a new conversation
 * await bridge.execute(AntigravityCommands.START_NEW_CONVERSATION);
 *
 * // Send a prompt
 * await bridge.execute(AntigravityCommands.SEND_PROMPT_TO_AGENT, 'Hello!');
 * ```
 */
export class CommandBridge implements IDisposable {
    private _disposed = false;

    /**
     * Execute an Antigravity command.
     *
     * @param command - The command ID to execute
     * @param args - Arguments to pass to the command
     * @returns The command's return value
     * @throws {CommandExecutionError} If the command fails
     */
    async execute<T = unknown>(command: string, ...args: unknown[]): Promise<T> {
        if (this._disposed) {
            throw new CommandExecutionError(command, 'CommandBridge has been disposed');
        }

        log.debug(`Executing: ${command}`, args.length > 0 ? args : '');

        try {
            const result = await vscode.commands.executeCommand<T>(command, ...args);
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            log.error(`Command failed: ${command}`, message);
            throw new CommandExecutionError(command, message);
        }
    }

    /**
     * Check if a command is registered and available.
     *
     * @param command - Command ID to check
     * @returns true if the command exists
     */
    async isAvailable(command: string): Promise<boolean> {
        const commands = await vscode.commands.getCommands(true);
        return commands.includes(command);
    }

    /**
     * Get all registered Antigravity commands.
     *
     * @returns List of command IDs starting with 'antigravity.'
     */
    async getAntigravityCommands(): Promise<string[]> {
        const commands = await vscode.commands.getCommands(true);
        return commands.filter((cmd) => cmd.startsWith('antigravity.'));
    }

    /**
     * Register a command handler.
     *
     * @param command - Command ID to register
     * @param handler - Function to handle the command
     * @returns Disposable to unregister the command
     */
    register(command: string, handler: (...args: unknown[]) => unknown): IDisposable {
        return vscode.commands.registerCommand(command, handler);
    }

    dispose(): void {
        this._disposed = true;
    }
}
