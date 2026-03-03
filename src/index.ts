/**
 * Antigravity SDK — Community SDK for Antigravity IDE.
 *
 * @packageDocumentation
 *
 * @example
 * ```typescript
 * import { AntigravitySDK } from 'antigravity-sdk';
 *
 * export function activate(context: vscode.ExtensionContext) {
 *   const sdk = new AntigravitySDK(context);
 *   await sdk.initialize();
 *
 *   // Read preferences
 *   const prefs = await sdk.cascade.getPreferences();
 *   console.log('Terminal policy:', prefs.terminalExecutionPolicy);
 *
 *   // List sessions
 *   const sessions = await sdk.cascade.getSessions();
 *   console.log(`${sessions.length} conversations`);
 *
 *   // Get diagnostics
 *   const diag = await sdk.cascade.getDiagnostics();
 *   console.log(`User: ${diag.systemInfo.userName}`);
 * }
 * ```
 */

// Core
export {
    // Types
    TerminalExecutionPolicy,
    ArtifactReviewPolicy,
    CortexStepType,
    StepStatus,
    TrajectoryType,
    // Interfaces
    type ICortexStep,
    type IStepMetadata,
    type IChatMessage,
    type IContextInfo,
    type ITokenBreakdown,
    type ISessionInfo,
    type IAgentPreferences,
    type IModelConfig,
    type ICreateSessionOptions,
    type IAgentState,
    type ITrajectoryEntry,
    type IDiagnosticsInfo,
} from './core/types';

export { Event, EventEmitter } from './core/events';
export { IDisposable, DisposableStore, toDisposable } from './core/disposable';
export {
    AntigravitySDKError,
    AntigravityNotFoundError,
    CommandExecutionError,
    StateReadError,
    SessionNotFoundError,
} from './core/errors';
export { Logger, LogLevel } from './core/logger';

// Transport
export { CommandBridge, AntigravityCommands } from './transport/command-bridge';
export { StateBridge, USSKeys } from './transport/state-bridge';
export { EventMonitor, type IStateChange, type IStepCountChange, type IActiveSessionChange } from './transport/event-monitor';
export { LSBridge, Models, type ModelId, type IHeadlessCascadeOptions, type ISendMessageOptions, type IConversationAnnotations } from './transport/ls-bridge';

// Cascade
export { CascadeManager } from './cascade/cascade-manager';

// Integration
export { IntegrationManager, IntegrityManager, TitleManager, IntegrationPoint } from './integration';
export type {
    IntegrationConfig,
    IButtonIntegration,
    ITurnMetaIntegration,
    IUserBadgeIntegration,
    IBotActionIntegration,
    IDropdownIntegration,
    ITitleIntegration,
    IToastConfig,
    TurnMetric,
} from './integration';

// SDK
export { AntigravitySDK, type ISDKOptions } from './sdk';
