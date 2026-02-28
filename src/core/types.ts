/**
 * Core type definitions for Antigravity SDK.
 *
 * These types mirror the internal protobuf schemas used by Antigravity's
 * Language Server, extracted via reverse engineering of the minified source.
 *
 * @module types
 */

// ─── Enums ──────────────────────────────────────────────────────────────────

/**
 * Terminal command auto-execution policy.
 *
 * Controls how terminal commands are handled when the agent requests execution.
 */
export enum TerminalExecutionPolicy {
    /** Always ask user before running */
    OFF = 1,
    /** Auto-run safe commands, ask for potentially dangerous ones */
    AUTO = 2,
    /** Always auto-run without asking */
    EAGER = 3,
}

/**
 * Artifact review policy for code changes.
 */
export enum ArtifactReviewPolicy {
    /** Always show diff review */
    ALWAYS = 1,
    /** Skip review for simple changes */
    TURBO = 2,
    /** Automatically decide based on change complexity */
    AUTO = 3,
}

/**
 * Type of a Cortex step (tool call) in a trajectory.
 */
export enum CortexStepType {
    RunCommand = 'RunCommand',
    WriteToFile = 'WriteToFile',
    ViewFile = 'ViewFile',
    ViewFileOutline = 'ViewFileOutline',
    ViewCodeItem = 'ViewCodeItem',
    SearchWeb = 'SearchWeb',
    ReadUrlContent = 'ReadUrlContent',
    OpenBrowserUrl = 'OpenBrowserUrl',
    ReadBrowserPage = 'ReadBrowserPage',
    ListBrowserPages = 'ListBrowserPages',
    ListDirectory = 'ListDirectory',
    FindByName = 'FindByName',
    CodebaseSearch = 'CodebaseSearch',
    GrepSearch = 'GrepSearch',
    SendCommandInput = 'SendCommandInput',
    ReadTerminal = 'ReadTerminal',
    ShellExec = 'ShellExec',
    McpTool = 'McpTool',
    InvokeSubagent = 'InvokeSubagent',
    Memory = 'Memory',
    KnowledgeGeneration = 'KnowledgeGeneration',
    UserInput = 'UserInput',
    SystemMessage = 'SystemMessage',
    PlannerResponse = 'PlannerResponse',
    Wait = 'Wait',
    ProposeCode = 'ProposeCode',
    WriteCascadeEdit = 'WriteCascadeEdit',
}

/**
 * Status of a Cortex step.
 */
export enum StepStatus {
    /** Step is being processed */
    Running = 'running',
    /** Step completed successfully */
    Completed = 'completed',
    /** Step failed */
    Failed = 'failed',
    /** Step is waiting for user interaction */
    WaitingForUser = 'waiting_for_user',
    /** Step was cancelled */
    Cancelled = 'cancelled',
}

/**
 * Type of trajectory (conversation).
 */
export enum TrajectoryType {
    /** Standard chat conversation */
    Chat = 'chat',
    /** Agent mode (Cascade) */
    Cascade = 'cascade',
}

// ─── Interfaces ─────────────────────────────────────────────────────────────

/**
 * A single step (tool call) in a Cascade trajectory.
 */
export interface ICortexStep {
    /** Unique step identifier */
    readonly id: string;

    /** Step index within the trajectory */
    readonly index: number;

    /** Type of tool call */
    readonly type: CortexStepType;

    /** Current status */
    readonly status: StepStatus;

    /** Human-readable summary of what this step does */
    readonly summary: string;

    /** Step-specific data (command line, file path, etc.) */
    readonly data: Record<string, unknown>;

    /** Internal metadata not shown in UI */
    readonly metadata: IStepMetadata;

    /** Timestamp when step was created */
    readonly createdAt: Date;

    /** Timestamp when step completed (if completed) */
    readonly completedAt?: Date;
}

/**
 * Internal metadata attached to each step.
 */
export interface IStepMetadata {
    /** Raw protobuf fields from the server response */
    readonly rawFields: Record<string, unknown>;

    /** Token count for this step's input */
    readonly inputTokens?: number;

    /** Token count for this step's output */
    readonly outputTokens?: number;

    /** Model used for this step */
    readonly model?: string;

    /** Whether this step was auto-approved */
    readonly autoApproved?: boolean;
}

/**
 * A chat message in a conversation.
 */
export interface IChatMessage {
    /** Message role */
    readonly role: 'user' | 'assistant' | 'system';

    /** Message content */
    readonly content: string;

    /** Message ID */
    readonly id: string;

    /** Timestamp */
    readonly createdAt: Date;

    /** Hidden metadata */
    readonly metadata: Record<string, unknown>;
}

/**
 * Information about the current context window usage.
 */
export interface IContextInfo {
    /** Total tokens currently in context */
    readonly totalTokens: number;

    /** Maximum context window size */
    readonly maxTokens: number;

    /** Usage as percentage (0-100) */
    readonly usagePercent: number;

    /** Token breakdown by category */
    readonly breakdown: ITokenBreakdown;
}

/**
 * Token usage breakdown.
 */
export interface ITokenBreakdown {
    /** System prompt tokens */
    readonly system: number;
    /** User message tokens */
    readonly userMessages: number;
    /** Assistant response tokens */
    readonly assistantMessages: number;
    /** Tool call input tokens */
    readonly toolCalls: number;
    /** Tool result tokens */
    readonly toolResults: number;
}

/**
 * A Cascade session (conversation/trajectory).
 */
export interface ISessionInfo {
    /** Unique session/cascade ID */
    readonly id: string;

    /** Session title (auto-generated or user-set) */
    readonly title: string;

    /** When the session was created */
    readonly createdAt: Date;

    /** When the session was last active */
    readonly lastActiveAt: Date;

    /** Type of trajectory */
    readonly type: TrajectoryType;

    /** Whether the session is currently active */
    readonly isActive: boolean;

    /** Tags applied to this session */
    readonly tags: string[];
}

/**
 * Agent preferences from USS (Unified State Sync).
 *
 * All 16 sentinel keys verified from live state.vscdb on 2026-02-28.
 */
export interface IAgentPreferences {
    /** Terminal command auto-execution policy (terminalAutoExecutionPolicySentinelKey) */
    readonly terminalExecutionPolicy: TerminalExecutionPolicy;

    /** Code change review policy (artifactReviewPolicySentinelKey) */
    readonly artifactReviewPolicy: ArtifactReviewPolicy;

    /** Planning mode (planningModeSentinelKey) */
    readonly planningMode: number;

    /** Whether strict/secure mode is enabled (secureModeSentinelKey) */
    readonly secureModeEnabled: boolean;

    /** Whether terminal sandbox is enabled (enableTerminalSandboxSentinelKey) */
    readonly terminalSandboxEnabled: boolean;

    /** Whether sandbox allows network access (sandboxAllowNetworkSentinelKey) */
    readonly sandboxAllowNetwork: boolean;

    /** Whether shell integration is enabled (enableShellIntegrationSentinelKey) */
    readonly shellIntegrationEnabled: boolean;

    /** Allow agent to access files outside workspace (allowAgentAccessNonWorkspaceFilesSentinelKey) */
    readonly allowNonWorkspaceFiles: boolean;

    /** Allow Cascade to read .gitignore files (allowCascadeAccessGitignoreFilesSentinelKey) */
    readonly allowGitignoreAccess: boolean;

    /** Explain and fix in current conversation (explainAndFixInCurrentConversationSentinelKey) */
    readonly explainFixInCurrentConvo: boolean;

    /** Auto-continue on max generator invocations (autoContinueOnMaxGeneratorInvocationsSentinelKey) */
    readonly autoContinueOnMax: number;

    /** Disable auto-open of edited files (disableAutoOpenEditedFilesSentinelKey) */
    readonly disableAutoOpenEdited: boolean;

    /** Enable sounds for special events (enableSoundsForSpecialEventsSentinelKey) */
    readonly enableSounds: boolean;

    /** Disable Cascade auto-fix for lint errors (disableCascadeAutoFixLintsSentinelKey) */
    readonly disableAutoFixLints: boolean;

    /** Explicitly allowed terminal commands (terminalAllowedCommandsSentinelKey) */
    readonly allowedCommands: string[];

    /** Explicitly denied terminal commands (terminalDeniedCommandsSentinelKey) */
    readonly deniedCommands: string[];
}

/**
 * Model configuration.
 */
export interface IModelConfig {
    /** Model identifier */
    readonly id: string;

    /** Human-readable model name */
    readonly name: string;

    /** Whether this model is currently selected */
    readonly isActive: boolean;

    /** Maximum context window size in tokens */
    readonly maxContextTokens: number;
}

/**
 * Options for creating a new Cascade session.
 */
export interface ICreateSessionOptions {
    /** Initial task/message to send */
    readonly task: string;

    /** Whether to run in background (don't focus the panel) */
    readonly background?: boolean;

    /** Model to use (defaults to current) */
    readonly model?: string;
}

/**
 * Agent state from the Agent Manager.
 */
export interface IAgentState {
    /** Whether the agent manager is enabled */
    readonly isEnabled: boolean;

    /** Whether the agent is currently processing */
    readonly isProcessing: boolean;

    /** Active cascade/conversation ID */
    readonly activeCascadeId: string | null;

    /** Current model in use */
    readonly currentModel: string;
}

/**
 * Trajectory entry from getDiagnostics.recentTrajectories.
 *
 * VERIFIED 2026-02-28: getDiagnostics returns clean JSON array with:
 * { googleAgentId, trajectoryId, summary, lastStepIndex, lastModifiedTime }
 */
export interface ITrajectoryEntry {
    /** Conversation UUID = googleAgentId */
    readonly id: string;

    /** Human-readable title = summary field */
    readonly title: string;

    /** Current step index in this conversation */
    readonly stepCount: number;

    /** Workspace URI (from USS protobuf fallback) */
    readonly workspaceUri: string;

    /** Internal trajectory UUID (from getDiagnostics) */
    readonly trajectoryId?: string;

    /** ISO timestamp of last modification (from getDiagnostics) */
    readonly lastModifiedTime?: string;
}

/**
 * Diagnostics info from `antigravity.getDiagnostics`.
 *
 * VERIFIED: returns 176KB JSON string with 8 top-level keys:
 * isRemote, systemInfo, extensionLogs, rendererLogs,
 * mainThreadLogs, agentWindowConsoleLogs, languageServerLogs,
 * recentTrajectories.
 */
export interface IDiagnosticsInfo {
    /** Whether IDE is running remotely (SSH) */
    readonly isRemote: boolean;

    /** System info */
    readonly systemInfo: {
        readonly operatingSystem: string;
        readonly timestamp: string;
        readonly userEmail: string;
        readonly userName: string;
    };

    /** Raw JSON for fields not yet typed */
    readonly raw: Record<string, unknown>;
}
