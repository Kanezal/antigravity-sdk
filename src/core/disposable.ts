/**
 * Disposable pattern for resource cleanup.
 *
 * @module disposable
 */

/**
 * An object that can release resources when no longer needed.
 */
export interface IDisposable {
    dispose(): void;
}

/**
 * Collects multiple disposables and disposes them all at once.
 *
 * @example
 * ```typescript
 * const store = new DisposableStore();
 * store.add(someEventSub);
 * store.add(anotherSub);
 * // Later:
 * store.dispose(); // cleans up everything
 * ```
 */
export class DisposableStore implements IDisposable {
    private readonly _disposables: IDisposable[] = [];
    private _disposed = false;

    /**
     * Add a disposable to the store.
     *
     * @param disposable - The disposable to track
     * @returns The same disposable (for chaining)
     */
    add<T extends IDisposable>(disposable: T): T {
        if (this._disposed) {
            disposable.dispose();
            console.warn('[AntigravitySDK] Adding disposable to already disposed store');
        } else {
            this._disposables.push(disposable);
        }
        return disposable;
    }

    /**
     * Dispose all tracked disposables.
     */
    dispose(): void {
        if (this._disposed) {
            return;
        }
        this._disposed = true;

        for (const d of this._disposables) {
            try {
                d.dispose();
            } catch (error) {
                console.error('[AntigravitySDK] Dispose error:', error);
            }
        }
        this._disposables.length = 0;
    }
}

/**
 * Creates a disposable from a cleanup function.
 *
 * @param fn - Cleanup function to call on dispose
 */
export function toDisposable(fn: () => void): IDisposable {
    return { dispose: fn };
}
