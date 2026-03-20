/**
 * State Bridge — reads Antigravity's USS state from the SQLite database.
 *
 * Antigravity stores settings, conversation metadata, and agent preferences
 * in `state.vscdb` (SQLite). This bridge provides read-only access to that data.
 *
 * VERIFIED against live state.vscdb on 2026-02-28.
 *
 * @module transport/state-bridge
 */

import * as path from 'path';
import * as fs from 'fs';
import { IDisposable } from '../core/disposable';
import { StateReadError } from '../core/errors';
import { Logger } from '../core/logger';
import type {
    IAgentPreferences,
    TerminalExecutionPolicy,
    ArtifactReviewPolicy,
} from '../core/types';

const log = new Logger('StateBridge');

/**
 * USS (Unified State Sync) keys in state.vscdb.
 *
 * VERIFIED: All keys listed below were confirmed to exist
 * in a live Antigravity v1.107.0 installation on 2026-02-28.
 * Values are Base64-encoded protobuf unless noted otherwise.
 */
export const USSKeys = {
    /** Agent preferences — terminal policy, review policy, secure mode, etc. (1020 bytes) */
    AGENT_PREFERENCES: 'antigravityUnifiedStateSync.agentPreferences',

    /** Conversation/trajectory summaries — titles, timestamps, workspace URIs (74KB+) */
    TRAJECTORY_SUMMARIES: 'antigravityUnifiedStateSync.trajectorySummaries',

    /** Agent manager window state (192 bytes) */
    AGENT_MANAGER_WINDOW: 'antigravityUnifiedStateSync.agentManagerWindow',

    /** Enterprise override store (56 bytes) */
    OVERRIDE_STORE: 'antigravityUnifiedStateSync.overrideStore',

    /** Model preferences — selected model, sentinel key */
    MODEL_PREFERENCES: 'antigravityUnifiedStateSync.modelPreferences',

    /** Artifact review state (1204 bytes) */
    ARTIFACT_REVIEW: 'antigravityUnifiedStateSync.artifactReview',

    /** Browser preferences (380 bytes) */
    BROWSER_PREFERENCES: 'antigravityUnifiedStateSync.browserPreferences',

    /** Editor preferences (108 bytes) */
    EDITOR_PREFERENCES: 'antigravityUnifiedStateSync.editorPreferences',

    /** Tab preferences (404 bytes) */
    TAB_PREFERENCES: 'antigravityUnifiedStateSync.tabPreferences',

    /** Window preferences (44 bytes) */
    WINDOW_PREFERENCES: 'antigravityUnifiedStateSync.windowPreferences',

    /** Scratch/playground workspaces (268 bytes) */
    SCRATCH_WORKSPACES: 'antigravityUnifiedStateSync.scratchWorkspaces',

    /** Sidebar workspaces — recent workspace list (5604 bytes) */
    SIDEBAR_WORKSPACES: 'antigravityUnifiedStateSync.sidebarWorkspaces',

    /** User status info (5196 bytes) */
    USER_STATUS: 'antigravityUnifiedStateSync.userStatus',

    /** Model credits/usage info */
    MODEL_CREDITS: 'antigravityUnifiedStateSync.modelCredits',

    /** Onboarding state (140 bytes) */
    ONBOARDING: 'antigravityUnifiedStateSync.onboarding',

    /** Seen NUX (new user experience) IDs (76 bytes) */
    SEEN_NUX_IDS: 'antigravityUnifiedStateSync.seenNuxIds',

    // ⚠️ Jetski-specific state (separate sync namespace)
    /** Agent manager initialization state — contains auth tokens, workspace map (5144 bytes) */
    AGENT_MANAGER_INIT: 'jetskiStateSync.agentManagerInitState',

    // ⚠️ Non-USS but relevant keys
    /** All user settings — JSON format */
    ALL_USER_SETTINGS: 'antigravityUserSettings.allUserSettings',

    /** Allowed model configs for commands */
    ALLOWED_COMMAND_MODEL_CONFIGS: 'antigravity_allowed_command_model_configs',

    /** Chat session store index (JSON: {"version":1,"entries":{}}) */
    CHAT_SESSION_INDEX: 'chat.ChatSessionStore.index',
} as const;

/**
 * Keys that contain sensitive data and MUST NOT be exposed through the SDK.
 *
 * VERIFIED 2026-02-28:
 * - oauthToken: OAuth access token (732 bytes)
 * - agentManagerInitState: Contains LIVE ya29.* access token + g1//* refresh token!
 * - antigravityAuthStatus: Auth status
 */
const SENSITIVE_KEYS = new Set([
    'antigravityUnifiedStateSync.oauthToken',
    'jetskiStateSync.agentManagerInitState',
    'antigravityAuthStatus',
]);

/**
 * Protobuf sentinel keys found in agentPreferences.
 *
 * ALL 16 sentinel keys verified from live state.vscdb on 2026-02-28.
 * Each sentinel key string is followed by a small Base64 value encoding
 * a protobuf varint (the actual preference value).
 */
const SENTINEL_KEYS = {
    PLANNING_MODE: 'planningModeSentinelKey',
    ARTIFACT_REVIEW_POLICY: 'artifactReviewPolicySentinelKey',
    TERMINAL_AUTO_EXECUTION_POLICY: 'terminalAutoExecutionPolicySentinelKey',
    TERMINAL_ALLOWED_COMMANDS: 'terminalAllowedCommandsSentinelKey',
    TERMINAL_DENIED_COMMANDS: 'terminalDeniedCommandsSentinelKey',
    ALLOW_NON_WORKSPACE_FILES: 'allowAgentAccessNonWorkspaceFilesSentinelKey',
    ALLOW_GITIGNORE_ACCESS: 'allowCascadeAccessGitignoreFilesSentinelKey',
    SECURE_MODE: 'secureModeSentinelKey',
    EXPLAIN_FIX_IN_CONVO: 'explainAndFixInCurrentConversationSentinelKey',
    AUTO_CONTINUE_ON_MAX: 'autoContinueOnMaxGeneratorInvocationsSentinelKey',
    DISABLE_AUTO_OPEN_EDITED: 'disableAutoOpenEditedFilesSentinelKey',
    ENABLE_SOUNDS: 'enableSoundsForSpecialEventsSentinelKey',
    DISABLE_AUTO_FIX_LINTS: 'disableCascadeAutoFixLintsSentinelKey',
    ENABLE_SHELL_INTEGRATION: 'enableShellIntegrationSentinelKey',
    SANDBOX_ALLOW_NETWORK: 'sandboxAllowNetworkSentinelKey',
    ENABLE_TERMINAL_SANDBOX: 'enableTerminalSandboxSentinelKey',
} as const;

/**
 * Reads Antigravity's internal state from the SQLite database.
 *
 * Uses **sql.js** (pure JavaScript SQLite, compiled to WASM) which is
 * verified to work in Antigravity's Extension Host (unlike better-sqlite3
 * which fails due to ABI mismatch with Electron v22.21.1 / ABI v140).
 *
 * @example
 * ```typescript
 * const bridge = new StateBridge();
 * await bridge.initialize();
 *
 * const prefs = await bridge.getAgentPreferences();
 * console.log(prefs.terminalExecutionPolicy);
 * ```
 */
export class StateBridge implements IDisposable {
    private _dbPath: string | null = null;
    private _db: any = null; // sql.js Database instance
    private _disposed = false;

    /**
     * Initialize the state bridge by locating and opening state database.
     *
     * @throws {StateReadError} If the database cannot be found
     */
    async initialize(): Promise<void> {
        const dbPath = this._findStateDb();

        if (!dbPath) {
            throw new StateReadError('state.vscdb', 'Could not locate Antigravity state database');
        }

        this._dbPath = dbPath;

        // Open with sql.js (pure JS — verified working in Extension Host)
        try {
            const path = require('path');
            const fs = require('fs');

            // Try to load sql.js from multiple locations:
            // 1. Adjacent sql-wasm.js (for VSIX bundles where consumer copies it to dist/)
            // 2. Standard require('sql.js') (for npm install / dev setups)
            let initSqlJs: any;
            const localSqlJs = path.join(__dirname, 'sql-wasm.js');
            if (fs.existsSync(localSqlJs)) {
                initSqlJs = require(localSqlJs);
            } else {
                initSqlJs = require('sql.js');
            }

            // Auto-locate sql-wasm.wasm — try multiple paths so devs
            // don't need to manually copy anything after `npm install`
            const candidates = [
                // 1. Adjacent to this file (if wasm was bundled/copied to dist/)
                path.join(__dirname, 'sql-wasm.wasm'),
                // 2. sql.js package dist/ (standard npm install)
                path.resolve(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
                // 3. Hoisted node_modules (monorepo / npm workspaces)
                path.resolve(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
                // 4. Walk up to find it (deep hoisting)
                path.resolve(__dirname, '..', '..', '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
            ];

            // Try require.resolve — works in all layouts
            try {
                const sqlJsMain = require.resolve('sql.js');
                candidates.unshift(path.join(path.dirname(sqlJsMain), 'sql-wasm.wasm'));
            } catch {
                // sql.js might not have a resolvable main in all setups
            }

            let wasmPath: string | null = null;
            for (const p of candidates) {
                if (fs.existsSync(p)) {
                    wasmPath = p;
                    break;
                }
            }

            if (!wasmPath) {
                throw new Error('sql-wasm.wasm not found in any expected location');
            }
            log.debug(`sql-wasm.wasm located at: ${wasmPath}`);

            const SQL = await initSqlJs({
                locateFile: () => wasmPath!,
            });
            const fileBuffer = fs.readFileSync(dbPath);
            const fileSizeKb = (fileBuffer.length / 1024).toFixed(1);
            this._db = new SQL.Database(fileBuffer);
            log.info(`State database opened via sql.js: ${dbPath} (${fileSizeKb} KB)`);
        } catch (error) {
            log.warn('sql.js not available, will use child_process fallback', error);
        }
    }

    /**
     * Read a raw value from the state database.
     *
     * @param key - The SQLite key to read
     * @returns The raw string value, or null if not found
     * @throws {StateReadError} If the key is sensitive or read fails
     */
    async getRawValue(key: string): Promise<string | null> {
        if (this._disposed) {
            throw new StateReadError(key, 'StateBridge has been disposed');
        }

        if (!this._dbPath) {
            throw new StateReadError(key, 'StateBridge not initialized');
        }

        // Block access to sensitive keys
        if (SENSITIVE_KEYS.has(key)) {
            log.warn(`Blocked access to sensitive key: ${key}`);
            throw new StateReadError(key, 'Access to sensitive keys is blocked by the SDK for security');
        }

        log.debug(`getRawValue: ${key} (${this._db ? 'sql.js' : 'child_process'})`);

        try {
            if (this._db) {
                return this._querySqlJs(key);
            }
            return await this._queryChildProcess(key);
        } catch (error) {
            if (error instanceof StateReadError) throw error;
            const msg = error instanceof Error ? error.message : String(error);
            throw new StateReadError(key, msg);
        }
    }

    /**
     * Get agent preferences from USS.
     *
     * @returns Parsed agent preferences
     */
    async getAgentPreferences(): Promise<IAgentPreferences> {
        log.debug('getAgentPreferences: reading USS key');
        const raw = await this.getRawValue(USSKeys.AGENT_PREFERENCES);

        if (!raw) {
            log.warn('No agent preferences found, returning defaults');
            return this._defaultPreferences();
        }

        log.debug(`getAgentPreferences: raw value length=${raw.length}, parsing protobuf sentinels`);
        try {
            const prefs = this._parseAgentPreferences(raw);
            log.debug(`getAgentPreferences: terminalPolicy=${prefs.terminalExecutionPolicy}, secureMode=${prefs.secureModeEnabled}`);
            return prefs;
        } catch (error) {
            log.error('Failed to parse preferences, returning defaults', error);
            return this._defaultPreferences();
        }
    }

    /**
     * Get all stored USS keys from the state database.
     *
     * @returns List of key names related to Antigravity (excludes sensitive keys)
     */
    async getAntigravityKeys(): Promise<string[]> {
        if (!this._dbPath) {
            throw new StateReadError('*', 'StateBridge not initialized');
        }

        let keys: string[];

        if (this._db) {
            const result = this._db.exec(
                "SELECT key FROM ItemTable WHERE key LIKE '%antigravity%' OR key LIKE '%jetskiStateSync%' OR key LIKE 'chat.%'",
            );
            keys = result.length > 0 ? result[0].values.map((r: any[]) => r[0] as string) : [];
        } else {
            const result = await this._queryChildProcess('*');
            keys = result ? result.split('\n').map((l: string) => l.trim()).filter(Boolean) : [];
        }

        // Filter out sensitive keys
        return keys.filter((k) => !SENSITIVE_KEYS.has(k));
    }

    /**
     * Query using sql.js (in-process, pure JS).
     */
    private _querySqlJs(key: string): string | null {
        const stmt = this._db.prepare('SELECT value FROM ItemTable WHERE key = $key');
        stmt.bind({ $key: key });
        if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            return (row.value as string) ?? null;
        }
        stmt.free();
        return null;
    }

    /**
     * Query using child_process sqlite3 CLI (fallback).
     */
    private async _queryChildProcess(key: string): Promise<string | null> {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        const sql =
            key === '*'
                ? "SELECT key FROM ItemTable WHERE key LIKE '%antigravity%' OR key LIKE '%jetskiStateSync%'"
                : `SELECT value FROM ItemTable WHERE key = '${key.replace(/'/g, "''")}'`;

        try {
            const { stdout } = await execAsync(`sqlite3 "${this._dbPath}" "${sql}"`, {
                encoding: 'utf8',
                timeout: 5000,
            });
            return stdout.trim() || null;
        } catch {
            return null;
        }
    }

    /**
     * Locate the state.vscdb file across platforms.
     */
    private _findStateDb(): string | null {
        const candidates: string[] = [];

        // Windows (VERIFIED: this is the correct path)
        const appData = process.env.APPDATA;
        if (appData) {
            candidates.push(path.join(appData, 'Antigravity', 'User', 'globalStorage', 'state.vscdb'));
        }

        // macOS
        const home = process.env.HOME;
        if (home) {
            candidates.push(
                path.join(
                    home,
                    'Library',
                    'Application Support',
                    'Antigravity',
                    'User',
                    'globalStorage',
                    'state.vscdb',
                ),
            );
        }

        // Linux
        if (home) {
            candidates.push(
                path.join(home, '.config', 'Antigravity', 'User', 'globalStorage', 'state.vscdb'),
            );
        }

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }

        return null;
    }

    /**
     * Parse agent preferences from Base64(Protobuf).
     *
     * The protobuf structure uses "sentinel keys" as string fields:
     * - `planningModeSentinelKey` → nested message with Base64(varint)
     * - `terminalAutoExecutionPolicySentinelKey` → nested message with Base64(varint)
     * - `artifactReviewPolicySentinelKey` → nested message with Base64(varint)
     *
     * Each sentinel value is itself a small Base64 string (e.g., "EAM=" = varint 3 = EAGER).
     */
    private _parseAgentPreferences(raw: string): IAgentPreferences {
        const buffer = Buffer.from(raw, 'base64');
        const text = buffer.toString('utf8');

        // Extract all sentinel values
        const terminalPolicy = this._extractSentinelValue(text, SENTINEL_KEYS.TERMINAL_AUTO_EXECUTION_POLICY);
        const artifactPolicy = this._extractSentinelValue(text, SENTINEL_KEYS.ARTIFACT_REVIEW_POLICY);
        const planningMode = this._extractSentinelValue(text, SENTINEL_KEYS.PLANNING_MODE);
        const secureMode = this._extractSentinelValue(text, SENTINEL_KEYS.SECURE_MODE);
        const terminalSandbox = this._extractSentinelValue(text, SENTINEL_KEYS.ENABLE_TERMINAL_SANDBOX);
        const sandboxNetwork = this._extractSentinelValue(text, SENTINEL_KEYS.SANDBOX_ALLOW_NETWORK);
        const shellIntegration = this._extractSentinelValue(text, SENTINEL_KEYS.ENABLE_SHELL_INTEGRATION);
        const nonWorkspaceFiles = this._extractSentinelValue(text, SENTINEL_KEYS.ALLOW_NON_WORKSPACE_FILES);
        const gitignoreAccess = this._extractSentinelValue(text, SENTINEL_KEYS.ALLOW_GITIGNORE_ACCESS);
        const explainFix = this._extractSentinelValue(text, SENTINEL_KEYS.EXPLAIN_FIX_IN_CONVO);
        const autoContinue = this._extractSentinelValue(text, SENTINEL_KEYS.AUTO_CONTINUE_ON_MAX);
        const disableAutoOpen = this._extractSentinelValue(text, SENTINEL_KEYS.DISABLE_AUTO_OPEN_EDITED);
        const enableSounds = this._extractSentinelValue(text, SENTINEL_KEYS.ENABLE_SOUNDS);
        const disableAutoFix = this._extractSentinelValue(text, SENTINEL_KEYS.DISABLE_AUTO_FIX_LINTS);

        return {
            terminalExecutionPolicy: (terminalPolicy ?? 1) as TerminalExecutionPolicy,
            artifactReviewPolicy: (artifactPolicy ?? 1) as ArtifactReviewPolicy,
            planningMode: planningMode ?? 0,
            secureModeEnabled: (secureMode ?? 0) === 1,
            terminalSandboxEnabled: (terminalSandbox ?? 0) === 1,
            sandboxAllowNetwork: (sandboxNetwork ?? 0) === 1,
            shellIntegrationEnabled: (shellIntegration ?? 1) === 1,
            allowNonWorkspaceFiles: (nonWorkspaceFiles ?? 0) === 1,
            allowGitignoreAccess: (gitignoreAccess ?? 0) === 1,
            explainFixInCurrentConvo: (explainFix ?? 0) === 1,
            autoContinueOnMax: autoContinue ?? 0,
            disableAutoOpenEdited: (disableAutoOpen ?? 0) === 1,
            enableSounds: (enableSounds ?? 0) === 1,
            disableAutoFixLints: (disableAutoFix ?? 0) === 1,
            allowedCommands: [],
            deniedCommands: [],
        };
    }

    /**
     * Extract a varint value from a protobuf sentinel key.
     *
     * The structure is: sentinel_key_string followed by a small
     * Base64 value like "EAM=" (which decodes to a protobuf varint).
     *
     * Known mappings:
     * - "CAE=" → field 1, value 1 (OFF / ALWAYS)
     * - "EAI=" → field 2, value 2 (AUTO / TURBO)
     * - "EAM=" → field 2, value 3 (EAGER / AUTO)
     */
    private _extractSentinelValue(text: string, sentinelKey: string): number | null {
        const idx = text.indexOf(sentinelKey);
        if (idx === -1) return null;

        // After the sentinel key, look for a small Base64 fragment
        const after = text.substring(idx + sentinelKey.length, idx + sentinelKey.length + 30);

        // Match a Base64 chunk (typically 4-8 chars ending with =)
        const b64Match = after.match(/([A-Za-z0-9+/]{2,8}={0,2})/);
        if (!b64Match) return null;

        try {
            const decoded = Buffer.from(b64Match[1], 'base64');
            // Protobuf varint: last byte of the value
            // For simple single-byte varints, the value is in the lower 7 bits
            if (decoded.length >= 2) {
                // The first byte is (field_number << 3 | wire_type)
                // The second byte is the actual value
                return decoded[1];
            } else if (decoded.length === 1) {
                return decoded[0];
            }
        } catch {
            // Not valid base64
        }

        return null;
    }

    private _defaultPreferences(): IAgentPreferences {
        return {
            terminalExecutionPolicy: 1 as TerminalExecutionPolicy, // OFF
            artifactReviewPolicy: 1 as ArtifactReviewPolicy, // ALWAYS
            planningMode: 0,
            secureModeEnabled: false,
            terminalSandboxEnabled: false,
            sandboxAllowNetwork: false,
            shellIntegrationEnabled: true,
            allowNonWorkspaceFiles: false,
            allowGitignoreAccess: false,
            explainFixInCurrentConvo: false,
            autoContinueOnMax: 0,
            disableAutoOpenEdited: false,
            enableSounds: false,
            disableAutoFixLints: false,
            allowedCommands: [],
            deniedCommands: [],
        };
    }

    dispose(): void {
        this._disposed = true;

        if (this._db) {
            try {
                this._db.close();
            } catch {
                // Ignore close errors
            }
            this._db = null;
        }

        this._dbPath = null;
    }
}
