/**
 * Integrity Manager — Suppress Antigravity's "corrupt installation" warnings.
 *
 * When the SDK patches workbench files, Antigravity's IntegrityService detects
 * checksum mismatches and shows two warnings:
 *   1. Console WARN ("Installation has been modified on disk")
 *   2. UI Notification ("Your Antigravity installation appears to be corrupt")
 *
 * This class updates ALL mismatched SHA256 hashes in product.json, so
 * IntegrityService sees isPure=true and produces no warnings at all.
 *
 * Handles not just workbench.html but also workbench.desktop.main.js (auto-run fix),
 * workbench-jetski-agent.html (agent manager patching), and any other modified files.
 *
 * Multi-extension coordination: a registry file (.ag-sdk-integrity.json)
 * in the workbench directory tracks active SDK namespaces and the original
 * hashes, so the last extension to uninstall restores the original state.
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
    /** Original product.json hashes for ALL checksummed files (before any patching). */
    originalHashes: Record<string, string>;
}

/** Registry filename — lives next to workbench.html. */
const REGISTRY_FILENAME = '.ag-sdk-integrity.json';

/**
 * Manages integrity check suppression for Antigravity's IntegrityService.
 *
 * Call `suppressCheck()` after any file patching (workbench.html, main.js, etc.).
 * It scans ALL files listed in product.json checksums, recomputes hashes for
 * any that have changed, and updates product.json. IntegrityService will see
 * `isPure = true` on next restart, producing zero warnings.
 */
export class IntegrityManager {
    private readonly _productJsonPath: string;
    private readonly _appOutDir: string;
    private readonly _registryPath: string;
    private readonly _namespace: string;

    /**
     * @param workbenchDir — Absolute path to the workbench directory
     *   (e.g. `%LOCALAPPDATA%/Programs/Antigravity/resources/app/out/vs/code/electron-browser/workbench/`)
     * @param namespace — Unique slug for this extension (e.g. 'kanezal-better-antigravity')
     */
    constructor(workbenchDir: string, namespace: string) {
        this._namespace = namespace;
        this._registryPath = path.join(workbenchDir, REGISTRY_FILENAME);

        // product.json is at resources/app/product.json
        // workbenchDir is resources/app/out/vs/code/electron-browser/workbench/
        const appDir = path.resolve(workbenchDir, '..', '..', '..', '..', '..');
        this._productJsonPath = path.join(appDir, 'product.json');
        this._appOutDir = path.join(appDir, 'out');
    }

    /**
     * Suppress the integrity check by updating ALL mismatched hashes in product.json.
     *
     * Scans every file listed in product.json checksums, recomputes SHA256 for each,
     * and updates any that have changed. This handles not just workbench.html but also
     * workbench.desktop.main.js (auto-run fix), jetskiAgent files, etc.
     *
     * Call this after any file patching. Safe to call multiple times.
     */
    suppressCheck(): void {
        try {
            if (!fs.existsSync(this._productJsonPath)) {
                log.warn(`product.json not found at ${this._productJsonPath}`);
                return;
            }

            const productJson = JSON.parse(fs.readFileSync(this._productJsonPath, 'utf8'));
            if (!productJson.checksums) {
                log.debug('No checksums in product.json — nothing to update');
                return;
            }

            // 1. Load or create registry, register this namespace
            const registry = this._readRegistry();
            if (!registry.namespaces.includes(this._namespace)) {
                registry.namespaces.push(this._namespace);
            }

            // 2. Scan ALL checksummed files, save originals & update mismatches
            let updatedCount = 0;
            for (const [relPath, storedHash] of Object.entries(productJson.checksums) as [string, string][]) {
                const filePath = path.join(this._appOutDir, relPath);

                let actualHash: string;
                try {
                    const content = fs.readFileSync(filePath);
                    actualHash = this._computeHash(content);
                } catch {
                    // File not found — skip (don't break other checks)
                    continue;
                }

                if (actualHash !== storedHash) {
                    // Save original hash if we haven't already
                    if (!(relPath in registry.originalHashes)) {
                        registry.originalHashes[relPath] = storedHash;
                        log.debug(`Saved original hash for ${relPath}`);
                    }

                    productJson.checksums[relPath] = actualHash;
                    updatedCount++;
                    log.info(`Updated hash: ${relPath} (${storedHash.substring(0, 8)}... -> ${actualHash.substring(0, 8)}...)`);
                }
            }

            // 3. Write registry
            this._writeRegistry(registry);

            // 4. Write product.json if anything changed
            if (updatedCount > 0) {
                fs.writeFileSync(this._productJsonPath, JSON.stringify(productJson, null, '\t'), 'utf8');
                log.info(`Updated ${updatedCount} hash(es) in product.json`);
            } else {
                log.debug('All hashes already match — no update needed');
            }
        } catch (err) {
            log.error('Failed to suppress integrity check', err);
        }
    }

    /**
     * Release the integrity check suppression.
     *
     * Call this when uninstalling the integration. If no other SDK namespaces
     * remain active, restores all original hashes in product.json.
     */
    releaseCheck(): void {
        try {
            const registry = this._readRegistry();

            // Remove this namespace
            registry.namespaces = registry.namespaces.filter(ns => ns !== this._namespace);
            this._writeRegistry(registry);

            if (registry.namespaces.length > 0) {
                // Other SDK extensions still active — recompute all hashes
                log.debug(`${registry.namespaces.length} other namespace(s) still active, recomputing hashes`);
                this.suppressCheck();
                return;
            }

            // Last extension uninstalling — restore ALL original hashes
            if (Object.keys(registry.originalHashes).length > 0) {
                this._restoreOriginalHashes(registry.originalHashes);
                log.info(`Restored ${Object.keys(registry.originalHashes).length} original hash(es)`);
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
     * Call this after auto-repair has re-patched files
     * (e.g. after an AG update that overwrote workbench files).
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
     * Restore all original hashes in product.json.
     */
    private _restoreOriginalHashes(originalHashes: Record<string, string>): void {
        if (!fs.existsSync(this._productJsonPath)) return;

        const productJson = JSON.parse(fs.readFileSync(this._productJsonPath, 'utf8'));
        if (!productJson.checksums) return;

        for (const [relPath, hash] of Object.entries(originalHashes)) {
            if (relPath in productJson.checksums) {
                productJson.checksums[relPath] = hash;
            }
        }

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

                // Migrate from old format (single originalHash) to new (originalHashes map)
                let originalHashes: Record<string, string> = {};
                if (data.originalHashes && typeof data.originalHashes === 'object') {
                    originalHashes = data.originalHashes;
                } else if (typeof data.originalHash === 'string') {
                    // Legacy v1.5.0 format: single hash for workbench.html
                    originalHashes['vs/code/electron-browser/workbench/workbench.html'] = data.originalHash;
                }

                return {
                    namespaces: Array.isArray(data.namespaces) ? data.namespaces : [],
                    originalHashes,
                };
            }
        } catch {
            // Corrupt or inaccessible — start fresh
        }
        return { namespaces: [], originalHashes: {} };
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
