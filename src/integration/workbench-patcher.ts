/**
 * Workbench Patcher — Fabric-style loader for AG SDK extensions.
 *
 * Patches workbench.html ONCE with a shared loader script.
 * Each extension writes its own script file + heartbeat.
 * The loader reads a manifest and loads all registered extension scripts.
 *
 * Architecture (like Fabric for Minecraft):
 *
 *   workbench.html  ←  ONE <script src="./ag-sdk-loader.js">
 *       │
 *       ▼
 *   ag-sdk-loader.js  ←  reads ag-sdk-manifest.json, loads all scripts
 *       │
 *       ▼
 *   ag-sdk-manifest.json  ←  {"extensions":["ns-a","ns-b"]}
 *       │
 *       ├── ag-sdk-ns-a.js  +  ag-sdk-ns-a-heartbeat
 *       └── ag-sdk-ns-b.js  +  ag-sdk-ns-b-heartbeat
 *
 * @module integration/workbench-patcher
 * @internal
 */

import * as fs from 'fs';
import * as path from 'path';

/** Shared file prefix */
const PREFIX = 'ag-sdk';

/** Shared HTML markers — ONE block, not per-extension */
const MARKER_START = '<!-- AG SDK -->';
const MARKER_END = '<!-- /AG SDK -->';

/** Manifest filename */
const MANIFEST_FILE = `${PREFIX}-manifest.json`;

/** Loader script filename */
const LOADER_FILE = `${PREFIX}-loader.js`;

/** Manifest schema */
interface ISDKManifest {
    /** Registered extension namespace slugs */
    extensions: string[];
}

/**
 * Manages the shared SDK loader in Antigravity's workbench.
 *
 * Flow:
 * 1. First extension: patches workbench.html with loader, writes manifest
 * 2. Next extensions: just add themselves to manifest + write their script
 * 3. Last extension uninstalling: removes loader from workbench.html
 */
export class WorkbenchPatcher {
    private readonly _workbenchDir: string;
    private readonly _workbenchHtml: string;
    private readonly _manifestPath: string;
    private readonly _loaderPath: string;
    private readonly _scriptPath: string;
    private readonly _heartbeatPath: string;
    private readonly _slug: string;

    /**
     * @param namespace - Unique slug for this extension (e.g. 'kanezal-better-antigravity').
     */
    constructor(namespace: string = 'default') {
        const appData = process.env.LOCALAPPDATA || '';
        this._workbenchDir = path.join(
            appData,
            'Programs', 'Antigravity', 'resources', 'app',
            'out', 'vs', 'code', 'electron-browser', 'workbench',
        );
        this._workbenchHtml = path.join(this._workbenchDir, 'workbench.html');
        this._manifestPath = path.join(this._workbenchDir, MANIFEST_FILE);
        this._loaderPath = path.join(this._workbenchDir, LOADER_FILE);

        this._slug = namespace.replace(/[^a-zA-Z0-9-]/g, '-');
        this._scriptPath = path.join(this._workbenchDir, `${PREFIX}-${this._slug}.js`);
        this._heartbeatPath = path.join(this._workbenchDir, `${PREFIX}-${this._slug}-heartbeat`);
    }

    // ─── Queries ──────────────────────────────────────────────────────

    /** Check if workbench.html exists and is accessible. */
    isAvailable(): boolean {
        return fs.existsSync(this._workbenchHtml);
    }

    /** Check if the shared SDK loader is installed in workbench.html. */
    isLoaderInstalled(): boolean {
        if (!this.isAvailable()) return false;
        try {
            return fs.readFileSync(this._workbenchHtml, 'utf8').includes(MARKER_START);
        } catch {
            return false;
        }
    }

    /** Check if THIS extension is registered in the manifest. */
    isInstalled(): boolean {
        const manifest = this._readManifest();
        return manifest.extensions.includes(this._slug);
    }

    /** Get all registered extension namespaces from manifest. */
    getRegisteredExtensions(): string[] {
        return this._readManifest().extensions;
    }

    // ─── Install ──────────────────────────────────────────────────────

    /**
     * Install this extension's script into the SDK framework.
     *
     * - If loader is not in workbench.html → patch HTML (first extension)
     * - Writes/updates this extension's script file
     * - Registers in manifest
     * - Updates the loader script
     *
     * @param scriptContent — Generated JS for this extension
     */
    install(scriptContent: string): void {
        if (!this.isAvailable()) {
            throw new Error(`Workbench not found at: ${this._workbenchDir}`);
        }

        // Clean up legacy per-namespace HTML blocks + old files
        this._cleanupLegacy();

        // 1. Patch workbench.html with loader (only if not already there)
        if (!this.isLoaderInstalled()) {
            this._patchHtml();
        }

        // 2. Write this extension's script file
        fs.writeFileSync(this._scriptPath, scriptContent, 'utf8');

        // 3. Register in manifest
        const manifest = this._readManifest();
        if (!manifest.extensions.includes(this._slug)) {
            manifest.extensions.push(this._slug);
        }
        this._writeManifest(manifest);

        // 4. Regenerate the loader (reads manifest, loads all scripts)
        this._writeLoader();

        // 5. Create empty titles JSON (prevents console 404)
        const titlesPath = path.join(this._workbenchDir, `${PREFIX}-titles-${this._slug}.json`);
        if (!fs.existsSync(titlesPath)) {
            fs.writeFileSync(titlesPath, '{}', 'utf8');
        }
    }

    // ─── Uninstall ────────────────────────────────────────────────────

    /**
     * Uninstall this extension from the SDK framework.
     *
     * - Removes from manifest
     * - Deletes this extension's script + heartbeat + titles
     * - If last extension → removes loader from workbench.html + cleans up
     */
    uninstall(): void {
        if (!this.isAvailable()) return;

        // 1. Remove from manifest
        const manifest = this._readManifest();
        manifest.extensions = manifest.extensions.filter(ns => ns !== this._slug);

        // 2. Delete this extension's files
        this._tryDelete(this._scriptPath);
        this._tryDelete(this._heartbeatPath);
        this._tryDelete(path.join(this._workbenchDir, `${PREFIX}-titles-${this._slug}.json`));

        if (manifest.extensions.length === 0) {
            // Last extension — full cleanup
            this._unpatchHtml();
            this._tryDelete(this._loaderPath);
            this._tryDelete(this._manifestPath);
        } else {
            // Others remain — update manifest and regenerate loader
            this._writeManifest(manifest);
            this._writeLoader();
        }
    }

    // ─── Heartbeat ────────────────────────────────────────────────────

    /** Write/refresh heartbeat marker. */
    writeHeartbeat(): void {
        try {
            fs.writeFileSync(this._heartbeatPath, Date.now().toString(), 'utf8');
        } catch { /* workbench dir may not be writable */ }
    }

    /** Remove heartbeat marker. */
    removeHeartbeat(): void {
        this._tryDelete(this._heartbeatPath);
    }

    // ─── Accessors ────────────────────────────────────────────────────

    getWorkbenchDir(): string { return this._workbenchDir; }
    getScriptPath(): string { return this._scriptPath; }
    getHeartbeatPath(): string { return this._heartbeatPath; }

    // ─── Private: HTML patching ───────────────────────────────────────

    /** Add the shared loader <script> to workbench.html (ONE time). */
    private _patchHtml(): void {
        let html = fs.readFileSync(this._workbenchHtml, 'utf8');

        const loaderTag = [
            MARKER_START,
            `<script src="./${LOADER_FILE}"></script>`,
            MARKER_END,
        ].join('\n');

        html = html.replace('</html>', `${loaderTag}\n</html>`);
        fs.writeFileSync(this._workbenchHtml, html, 'utf8');
    }

    /** Remove the shared loader <script> from workbench.html. */
    private _unpatchHtml(): void {
        try {
            let html = fs.readFileSync(this._workbenchHtml, 'utf8');
            const regex = new RegExp(
                `\\n?${escapeRegex(MARKER_START)}[\\s\\S]*?${escapeRegex(MARKER_END)}\\n?`,
                'g',
            );
            html = html.replace(regex, '');
            fs.writeFileSync(this._workbenchHtml, html, 'utf8');
        } catch { /* ignore */ }
    }

    // ─── Private: Manifest ────────────────────────────────────────────

    private _readManifest(): ISDKManifest {
        try {
            if (fs.existsSync(this._manifestPath)) {
                const data = JSON.parse(fs.readFileSync(this._manifestPath, 'utf8'));
                return { extensions: Array.isArray(data.extensions) ? data.extensions : [] };
            }
        } catch { /* corrupt */ }
        return { extensions: [] };
    }

    private _writeManifest(manifest: ISDKManifest): void {
        fs.writeFileSync(this._manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    }

    // ─── Private: Loader ──────────────────────────────────────────────

    /**
     * Generate and write the shared loader script.
     *
     * The loader runs in the renderer. On startup it:
     * 1. Fetches the manifest to get the list of extensions
     * 2. For each extension, checks its heartbeat (skip if stale >48h)
     * 3. Creates <script> tags to load each active extension's script
     */
    private _writeLoader(): void {
        const manifest = this._readManifest();

        // Build a static list of scripts to load (known at install time)
        // The loader still checks heartbeats at runtime for liveness
        const scriptEntries = manifest.extensions.map(ns => ({
            ns,
            script: `${PREFIX}-${ns}.js`,
            heartbeat: `${PREFIX}-${ns}-heartbeat`,
        }));

        const loaderCode = `(function agSDKLoader() {
'use strict';
if (window.__agSDKLoader) return;
window.__agSDKLoader = true;

var MAX_AGE = 172800000; // 48h
var entries = ${JSON.stringify(scriptEntries)};

function checkHeartbeat(hbFile, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', './' + hbFile + '?t=' + Date.now(), true);
    xhr.onload = function() {
        if (xhr.status === 200) {
            var ts = parseInt(xhr.responseText, 10);
            callback(!isNaN(ts) && (Date.now() - ts) < MAX_AGE);
        } else {
            callback(false);
        }
    };
    xhr.onerror = function() { callback(false); };
    xhr.send();
}

function loadScript(src) {
    var s = document.createElement('script');
    s.src = './' + src;
    s.async = false;
    document.head.appendChild(s);
}

entries.forEach(function(entry) {
    checkHeartbeat(entry.heartbeat, function(alive) {
        if (alive) {
            loadScript(entry.script);
            console.log('[AG-SDK] Loaded: ' + entry.ns);
        } else {
            console.log('[AG-SDK] Skipped (stale heartbeat): ' + entry.ns);
        }
    });
});

console.log('[AG-SDK] Loader initialized (' + entries.length + ' extension(s))');
})();`;

        fs.writeFileSync(this._loaderPath, loaderCode, 'utf8');
    }

    // ─── Private: Cleanup ─────────────────────────────────────────────

    /**
     * Clean up legacy per-namespace HTML blocks and old files
     * from previous SDK versions that used per-extension HTML patching.
     */
    private _cleanupLegacy(): void {
        // Remove old per-namespace HTML blocks: <!-- AG SDK [ns] --> ... <!-- /AG SDK [ns] -->
        try {
            const html = fs.readFileSync(this._workbenchHtml, 'utf8');
            const cleaned = html.replace(
                /\n?<!-- AG SDK \[[^\]]+\] -->[\s\S]*?<!-- \/AG SDK \[[^\]]+\] -->\n?/g,
                '',
            );
            if (cleaned !== html) {
                fs.writeFileSync(this._workbenchHtml, cleaned, 'utf8');
            }
        } catch { /* ignore */ }

        // Remove legacy non-namespaced files
        const legacyFiles = [
            'ag-sdk-integrate.js',
            'ag-sdk-heartbeat',
            'ag-sdk-titles.json',
            'ag-sdk-titles-undefined.json',
            'ag-sdk-titles-default.json',
        ];
        for (const name of legacyFiles) {
            this._tryDelete(path.join(this._workbenchDir, name));
        }

        // Remove old X-Ray SDK markers
        try {
            const html = fs.readFileSync(this._workbenchHtml, 'utf8');
            const cleaned = html
                .replace(/<script src="\.\/ag-sdk-integrate\.js"><\/script>\n?/g, '')
                .replace(/<!-- X-Ray SDK Integration -->\n?<script[^>]*ag-sdk-integrate[^>]*><\/script>\n?<!-- \/X-Ray SDK Integration -->\n?/g, '');
            if (cleaned !== html) {
                fs.writeFileSync(this._workbenchHtml, cleaned, 'utf8');
            }
        } catch { /* ignore */ }
    }

    private _tryDelete(filePath: string): void {
        try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch { /* ignore */ }
    }
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
