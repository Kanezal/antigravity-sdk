/**
 * Event Monitor — polls state.vscdb and getDiagnostics for changes.
 *
 * Detects:
 * - USS key changes (trajectory summaries, preferences, etc.)
 * - Step count changes per session (via getDiagnostics.recentTrajectories)
 * - Active session switches
 * - New conversations
 *
 * @module transport/event-monitor
 */

import * as vscode from 'vscode';
import { IDisposable, DisposableStore } from '../core/disposable';
import { EventEmitter, Event } from '../core/events';
import { Logger } from '../core/logger';
import { StateBridge, USSKeys } from './state-bridge';

const log = new Logger('EventMonitor');

/**
 * USS key change event.
 */
export interface IStateChange {
    /** Which USS key changed */
    readonly key: string;
    /** New data size */
    readonly newSize: number;
    /** Previous data size */
    readonly previousSize: number;
}

/**
 * Step count change event — fired when the agent adds/processes steps.
 */
export interface IStepCountChange {
    /** Conversation UUID (googleAgentId) */
    readonly sessionId: string;
    /** Conversation title */
    readonly title: string;
    /** Previous step count */
    readonly previousCount: number;
    /** New step count */
    readonly newCount: number;
    /** Number of new steps added */
    readonly delta: number;
}

/**
 * Active session change event.
 */
export interface IActiveSessionChange {
    /** New active session ID */
    readonly sessionId: string;
    /** New active session title */
    readonly title: string;
    /** Previous active session ID (empty if first detection) */
    readonly previousSessionId: string;
}

/**
 * Snapshot of a trajectory from getDiagnostics.
 */
interface ITrajectorySnapshot {
    id: string;
    title: string;
    stepCount: number;
    lastModified: string;
}

/**
 * Monitors Antigravity state for changes.
 *
 * Two polling modes:
 * 1. **USS polling** — watches state.vscdb keys for size changes (lightweight)
 * 2. **Trajectory polling** — watches getDiagnostics for step count changes (heavier, optional)
 *
 * @example
 * ```typescript
 * const monitor = new EventMonitor(stateBridge);
 *
 * // React to step changes (agent is working)
 * monitor.onStepCountChanged((e) => {
 *   console.log(`${e.title}: +${e.delta} steps (now ${e.newCount})`);
 * });
 *
 * // React to conversation switches
 * monitor.onActiveSessionChanged((e) => {
 *   console.log(`Switched to: ${e.title}`);
 * });
 *
 * monitor.start(3000);
 * ```
 */
export class EventMonitor implements IDisposable {
    private readonly _disposables = new DisposableStore();
    private _ussTimer: ReturnType<typeof setInterval> | null = null;
    private _trajTimer: ReturnType<typeof setInterval> | null = null;
    private _ussSnapshots = new Map<string, number>();
    private _trajSnapshots = new Map<string, ITrajectorySnapshot>();
    private _activeSessionId = '';
    private _running = false;

    // ─── USS Events ─────────────────────────────────────────────────────

    private readonly _onStateChanged = this._disposables.add(new EventEmitter<IStateChange>());
    /** Fires when any monitored USS key changes size */
    public readonly onStateChanged: Event<IStateChange> = this._onStateChanged.event;

    private readonly _onNewConversation = this._disposables.add(new EventEmitter<void>());
    /** Fires when trajectory summaries grow (new conversation likely) */
    public readonly onNewConversation: Event<void> = this._onNewConversation.event;

    // ─── Trajectory Events ──────────────────────────────────────────────

    private readonly _onStepCountChanged = this._disposables.add(new EventEmitter<IStepCountChange>());
    /** Fires when a session's step count changes (agent made progress) */
    public readonly onStepCountChanged: Event<IStepCountChange> = this._onStepCountChanged.event;

    private readonly _onActiveSessionChanged = this._disposables.add(new EventEmitter<IActiveSessionChange>());
    /** Fires when the active (most recent) session changes */
    public readonly onActiveSessionChanged: Event<IActiveSessionChange> = this._onActiveSessionChanged.event;

    /** Keys we monitor for USS changes */
    private readonly _watchedKeys = [
        USSKeys.TRAJECTORY_SUMMARIES,
        USSKeys.AGENT_PREFERENCES,
        USSKeys.USER_STATUS,
    ];

    constructor(private readonly _state: StateBridge) { }

    /**
     * Start polling for state changes.
     *
     * @param intervalMs - USS polling interval (default: 3000ms)
     * @param trajectoryIntervalMs - Trajectory polling interval (default: 5000ms).
     *   Set to 0 to disable trajectory polling (saves CPU).
     */
    start(intervalMs: number = 3000, trajectoryIntervalMs: number = 5000): void {
        if (this._running) return;

        this._running = true;
        log.info(`Starting event monitor (USS: ${intervalMs}ms, Traj: ${trajectoryIntervalMs}ms)`);

        // Initial USS snapshot
        this._takeUSSSnapshot().catch(() => { });

        // USS polling
        this._ussTimer = setInterval(async () => {
            try {
                await this._pollUSS();
            } catch (error) {
                log.error('USS poll error', error);
            }
        }, intervalMs);

        // Trajectory polling (optional, heavier)
        if (trajectoryIntervalMs > 0) {
            this._pollTrajectories().catch(() => { });

            this._trajTimer = setInterval(async () => {
                try {
                    await this._pollTrajectories();
                } catch (error) {
                    log.error('Trajectory poll error', error);
                }
            }, trajectoryIntervalMs);
        }
    }

    /**
     * Stop polling.
     */
    stop(): void {
        if (this._ussTimer) {
            clearInterval(this._ussTimer);
            this._ussTimer = null;
        }
        if (this._trajTimer) {
            clearInterval(this._trajTimer);
            this._trajTimer = null;
        }
        this._running = false;
        log.info('Event monitor stopped');
    }

    /** Check if the monitor is currently running. */
    get isRunning(): boolean {
        return this._running;
    }

    /** Get the currently active session ID. */
    get activeSessionId(): string {
        return this._activeSessionId;
    }

    // ─── USS Polling ────────────────────────────────────────────────────

    private async _takeUSSSnapshot(): Promise<void> {
        for (const key of this._watchedKeys) {
            try {
                const value = await this._state.getRawValue(key);
                this._ussSnapshots.set(key, value ? value.length : 0);
            } catch {
                this._ussSnapshots.set(key, 0);
            }
        }
    }

    private async _pollUSS(): Promise<void> {
        for (const key of this._watchedKeys) {
            try {
                const value = await this._state.getRawValue(key);
                const newSize = value ? value.length : 0;
                const previousSize = this._ussSnapshots.get(key) ?? 0;

                if (newSize !== previousSize) {
                    log.debug(`USS change: ${key} (${previousSize} -> ${newSize})`);
                    this._ussSnapshots.set(key, newSize);
                    this._onStateChanged.fire({ key, newSize, previousSize });

                    if (key === USSKeys.TRAJECTORY_SUMMARIES && newSize > previousSize) {
                        this._onNewConversation.fire();
                    }
                }
            } catch {
                // Skip errors during polling
            }
        }
    }

    // ─── Trajectory Polling ─────────────────────────────────────────────

    private async _pollTrajectories(): Promise<void> {
        let trajectories: Array<{
            googleAgentId: string;
            trajectoryId: string;
            summary: string;
            lastStepIndex: number;
            lastModifiedTime: string;
        }>;

        try {
            const raw = await vscode.commands.executeCommand<string>('antigravity.getDiagnostics');
            if (!raw || typeof raw !== 'string') return;
            const diag = JSON.parse(raw);
            if (!Array.isArray(diag.recentTrajectories)) return;
            trajectories = diag.recentTrajectories;
        } catch {
            return;
        }

        // Check for step count changes in each trajectory
        for (const traj of trajectories) {
            const id = traj.googleAgentId;
            if (!id) continue;

            const prev = this._trajSnapshots.get(id);
            const newCount = traj.lastStepIndex ?? 0;

            if (prev && prev.stepCount !== newCount) {
                const delta = newCount - prev.stepCount;
                log.debug(`Step change: "${traj.summary}" ${prev.stepCount} -> ${newCount} (+${delta})`);

                this._onStepCountChanged.fire({
                    sessionId: id,
                    title: traj.summary ?? 'Untitled',
                    previousCount: prev.stepCount,
                    newCount,
                    delta,
                });
            }

            this._trajSnapshots.set(id, {
                id,
                title: traj.summary ?? 'Untitled',
                stepCount: newCount,
                lastModified: traj.lastModifiedTime ?? '',
            });
        }

        // Check for active session change (first entry = most recent)
        if (trajectories.length > 0) {
            const newActiveId = trajectories[0].googleAgentId;
            if (newActiveId && newActiveId !== this._activeSessionId) {
                const previousId = this._activeSessionId;
                this._activeSessionId = newActiveId;

                // Only fire event after initial snapshot (not on first detection)
                if (previousId !== '') {
                    log.debug(`Active session changed: "${trajectories[0].summary}"`);
                    this._onActiveSessionChanged.fire({
                        sessionId: newActiveId,
                        title: trajectories[0].summary ?? 'Untitled',
                        previousSessionId: previousId,
                    });
                }
            }
        }
    }

    dispose(): void {
        this.stop();
        this._disposables.dispose();
    }
}
