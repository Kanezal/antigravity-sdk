/**
 * Lightweight event system for SDK.
 *
 * Follows VS Code's `Event<T>` / `EventEmitter<T>` pattern.
 * Supports subscription, disposal, and one-shot listeners.
 *
 * @module events
 */

import type { IDisposable } from './disposable';

/**
 * A function that represents a subscription to an event.
 * Call the returned disposable to unsubscribe.
 */
export type Event<T> = (listener: (e: T) => void) => IDisposable;

/**
 * Emits events to registered listeners.
 *
 * @example
 * ```typescript
 * const emitter = new EventEmitter<string>();
 *
 * const sub = emitter.event((msg) => console.log(msg));
 * emitter.fire('hello'); // logs: hello
 * sub.dispose();
 * emitter.fire('world'); // nothing happens
 * ```
 */
export class EventEmitter<T> implements IDisposable {
    private _listeners: Set<(e: T) => void> = new Set();
    private _disposed = false;

    /**
     * The event that listeners can subscribe to.
     */
    readonly event: Event<T> = (listener: (e: T) => void): IDisposable => {
        if (this._disposed) {
            throw new Error('EventEmitter has been disposed');
        }

        this._listeners.add(listener);

        return {
            dispose: () => {
                this._listeners.delete(listener);
            },
        };
    };

    /**
     * Fire the event, notifying all listeners.
     *
     * @param data - The event data to send to listeners
     */
    fire(data: T): void {
        if (this._disposed) {
            return;
        }

        for (const listener of this._listeners) {
            try {
                listener(data);
            } catch (error) {
                console.error('[AntigravitySDK] Event listener error:', error);
            }
        }
    }

    /**
     * Subscribe to the event, but only fire once.
     *
     * @param listener - Callback to invoke once
     * @returns Disposable to cancel before the event fires
     */
    once(listener: (e: T) => void): IDisposable {
        const sub = this.event((data) => {
            sub.dispose();
            listener(data);
        });
        return sub;
    }

    /**
     * Get the current number of listeners.
     */
    get listenerCount(): number {
        return this._listeners.size;
    }

    /**
     * Dispose of the emitter and all listeners.
     */
    dispose(): void {
        this._disposed = true;
        this._listeners.clear();
    }
}
