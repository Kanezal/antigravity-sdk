/**
 * Integrity Manager — Suppress Antigravity's "corrupt installation" warnings.
 *
 * When the SDK patches workbench.html, Antigravity's IntegrityService detects
 * the checksum mismatch and shows two warnings:
 *   1. Console WARN ("Installation has been modified on disk")
 *   2. UI Notification ("Your Antigravity installation appears to be corrupt")
 *
 * This class updates the SHA256 hash in product.json after patching, so
 * IntegrityService sees isPure=true and produces no warnings at all.
 *
 * Multi-extension coordination: a registry file (.ag-sdk-integrity.json)
 * in the workbench directory tracks active SDK namespaces and the original
 * hash, so the last extension to uninstall restores the original state.
 *
 * @module integration/integrity-manager
 *
 * @internal
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../core/logger';

const log = new Logger('IntegrityManager');

/** Coordination registry stored in the workbench directory. */
interface IIntegrityRegistry {
    /** Active SDK namespace slugs. */
    namespaces: string[];
    /** Original product.json hash for workbench.html (before any SDK patching). */
    originalHash: string | null;
}

/** Relative key for workbench.html in product.json checksums. */
const WORKBENCH_HTML_KEY = 'vs/code/electron-browser/workbench/workbench.html';

/** Registry filename — lives next to workbench.html. */
const REGISTRY_FILENAME = '.ag-sdk-integrity.json';

/**
 * Manages integrity check suppression for Antigravity's IntegrityService.
 *
 * After patching workbench.html, call `suppressCheck()` to update the SHA256
 * hash in product.json. IntegrityService will see `isPure = true` on next
 * restart, producing zero warnings (both console.warn AND UI notification).
 */
export class IntegrityManager {
    private readonly _productJsonPath: string;
    private readonly _workbenchHtmlPath: string;
    private readonly _registryPath: string;
    private readonly _namespace: string;

    /**
     * @param workbenchDir — Absolute path to the workbench directory
     *   (e.g. `%LOCALAPPDATA%/Programs/Antigravity/resources/app/out/vs/code/electron-browser/workbench/`)
     * @param namespace — Unique slug for this extension (e.g. 'kanezal-better-antigravity')
     */
    constructor(workbenchDir: string, namespace: string) {
        this._namespace = namespace;
        this._workbenchHtmlPath = path.join(workbenchDir, 'workbench.html');
        this._registryPath = path.join(workbenchDir, REGISTRY_FILENAME);

        // product.json is at resources/app/product.json
        // workbenchDir is resources/app/out/vs/code/electron-browser/workbench/
        this._productJsonPath = path.resolve(
            workbenchDir, '..', '..', '..', '..', '..', 'product.json',
        );
    }

    /**
     * Suppress the integrity check by updating workbench.html's hash in product.json.
     *
     * Call this after WorkbenchPatcher.install() has written the patched HTML.
     * The new hash will be picked up by IntegrityService on next AG restart.
     *
     * Safe to call multiple times — always recomputes from current file state.
     */
    suppressCheck(): void {
        try {
            // 1. Read product.json
            if (!fs.existsSync(this._productJsonPath)) {
                log.warn(`product.json not found at ${this._productJsonPath}`);
                return;
            }

            const productRaw = fs.readFileSync(this._productJsonPath, 'utf8');
            const productJson = JSON.parse(productRaw);

            if (!productJson.checksums || !(WORKBENCH_HTML_KEY in productJson.checksums)) {
                log.debug('No checksums entry for workbench.html — nothing to update');
                return;
            }

            // 2. Save original hash in registry (only if first SDK to register)
            const registry = this._readRegistry();
            if (registry.originalHash === null) {
                registry.originalHash = productJson.checksums[WORKBENCH_HTML_KEY];
                log.debug(`Saved original hash: ${registry.originalHash}`);
            }

            // 3. Register this namespace
            if (!registry.namespaces.includes(this._namespace)) {
                registry.namespaces.push(this._namespace);
            }
            this._writeRegistry(registry);

            // 4. Compute new hash of the patched workbench.html
            if (!fs.existsSync(this._workbenchHtmlPath)) {
                log.warn('workbench.html not found — cannot compute hash');
                return;
            }

            const content = fs.readFileSync(this._workbenchHtmlPath);
            const newHash = this._computeHash(content);

            // 5. Update product.json if hash differs
            const currentHash = productJson.checksums[WORKBENCH_HTML_KEY];
            if (currentHash === newHash) {
                log.debug('Hash already matches — no update needed');
                return;
            }

            productJson.checksums[WORKBENCH_HTML_KEY] = newHash;
            fs.writeFileSync(this._productJsonPath, JSON.stringify(productJson, null, '\t'), 'utf8');
            log.info(`Updated product.json hash: ${currentHash} -> ${newHash}`);
        } catch (err) {
            log.error('Failed to suppress integrity check', err);
        }
    }

    /**
     * Release the integrity check suppression.
     *
     * Call this when uninstalling the integration. If no other SDK namespaces
     * remain active, restores the original hash in product.json.
     */
    releaseCheck(): void {
        try {
            const registry = this._readRegistry();

            // Remove this namespace
            registry.namespaces = registry.namespaces.filter(ns => ns !== this._namespace);
            this._writeRegistry(registry);

            if (registry.namespaces.length > 0) {
                // Other SDK extensions still active — recompute hash for current state
                log.debug(`${registry.namespaces.length} other namespace(s) still active, recomputing hash`);
                this._updateProductJsonHash();
                return;
            }

            // Last extension uninstalling — restore original hash
            if (registry.originalHash) {
                this._restoreOriginalHash(registry.originalHash);
                log.info(`Restored original hash: ${registry.originalHash}`);
            }

            // Clean up registry file
            this._deleteRegistry();
        } catch (err) {
            log.error('Failed to release integrity check', err);
        }
    }

    /**
     * Re-apply integrity suppression after auto-repair.
     *
     * Call this after auto-repair has re-patched workbench.html
     * (e.g. after an AG update that overwrote the file).
     */
    repair(): void {
        log.info('Repairing integrity check suppression...');
        this.suppressCheck();
    }

    // ── Private helpers ─────────────────────────────────────────────

    /**
     * Compute SHA256 hash matching Antigravity's ChecksumService format:
     * base64 WITHOUT trailing '=' padding.
     */
    private _computeHash(content: Buffer): string {
        return crypto.createHash('sha256')
            .update(content)
            .digest('base64')
            .replace(/=+$/, '');
    }

    /**
     * Update product.json with the current workbench.html hash.
     */
    private _updateProductJsonHash(): void {
        if (!fs.existsSync(this._productJsonPath) || !fs.existsSync(this._workbenchHtmlPath)) {
            return;
        }

        const productJson = JSON.parse(fs.readFileSync(this._productJsonPath, 'utf8'));
        if (!productJson.checksums) return;

        const content = fs.readFileSync(this._workbenchHtmlPath);
        const newHash = this._computeHash(content);
        productJson.checksums[WORKBENCH_HTML_KEY] = newHash;
        fs.writeFileSync(this._productJsonPath, JSON.stringify(productJson, null, '\t'), 'utf8');
    }

    /**
     * Restore the original hash in product.json.
     */
    private _restoreOriginalHash(originalHash: string): void {
        if (!fs.existsSync(this._productJsonPath)) return;

        const productJson = JSON.parse(fs.readFileSync(this._productJsonPath, 'utf8'));
        if (!productJson.checksums) return;

        productJson.checksums[WORKBENCH_HTML_KEY] = originalHash;
        fs.writeFileSync(this._productJsonPath, JSON.stringify(productJson, null, '\t'), 'utf8');
    }

    /**
     * Read the coordination registry from disk.
     */
    private _readRegistry(): IIntegrityRegistry {
        try {
            if (fs.existsSync(this._registryPath)) {
                const raw = fs.readFileSync(this._registryPath, 'utf8');
                const data = JSON.parse(raw);
                return {
                    namespaces: Array.isArray(data.namespaces) ? data.namespaces : [],
                    originalHash: typeof data.originalHash === 'string' ? data.originalHash : null,
                };
            }
        } catch {
            // Corrupt or inaccessible — start fresh
        }
        return { namespaces: [], originalHash: null };
    }

    /**
     * Write the coordination registry to disk.
     */
    private _writeRegistry(registry: IIntegrityRegistry): void {
        try {
            fs.writeFileSync(this._registryPath, JSON.stringify(registry, null, 2), 'utf8');
        } catch (err) {
            log.error('Failed to write integrity registry', err);
        }
    }

    /**
     * Delete the coordination registry file.
     */
    private _deleteRegistry(): void {
        try {
            if (fs.existsSync(this._registryPath)) {
                fs.unlinkSync(this._registryPath);
            }
        } catch {
            // Ignore
        }
    }
}
