/**
 * Workbench Patcher — Install/uninstall injection scripts into workbench.html.
 *
 * Handles the file-level modification of Antigravity's workbench.html
 * to include/remove custom script tags.
 *
 * @module injection/workbench-patcher
 *
 * @internal
 */

import * as fs from 'fs';
import * as path from 'path';

/** Marker comment used to identify our injections */
const MARKER_START = '<!-- X-Ray SDK Injection -->';
const MARKER_END = '<!-- /X-Ray SDK Injection -->';

/** Default script filename */
const SCRIPT_FILENAME = 'xray-sdk-inject.js';

/**
 * Manages patching/unpatching of Antigravity's workbench.html.
 */
export class WorkbenchPatcher {
    private readonly _workbenchDir: string;
    private readonly _workbenchHtml: string;
    private readonly _scriptPath: string;

    constructor() {
        // Resolve Antigravity install path
        const appData = process.env.LOCALAPPDATA || '';
        this._workbenchDir = path.join(
            appData,
            'Programs',
            'Antigravity',
            'resources',
            'app',
            'out',
            'vs',
            'code',
            'electron-browser',
            'workbench',
        );
        this._workbenchHtml = path.join(this._workbenchDir, 'workbench.html');
        this._scriptPath = path.join(this._workbenchDir, SCRIPT_FILENAME);
    }

    /**
     * Check if workbench.html exists and is accessible.
     */
    isAvailable(): boolean {
        return fs.existsSync(this._workbenchHtml);
    }

    /**
     * Check if our injection is currently installed.
     */
    isInstalled(): boolean {
        if (!this.isAvailable()) return false;
        try {
            const content = fs.readFileSync(this._workbenchHtml, 'utf8');
            return content.includes(MARKER_START);
        } catch {
            return false;
        }
    }

    /**
     * Install the injection script.
     *
     * 1. Writes the script file to the workbench directory
     * 2. Patches workbench.html to include a <script> tag
     *
     * @param scriptContent — The generated JavaScript code
     */
    install(scriptContent: string): void {
        if (!this.isAvailable()) {
            throw new Error(`Workbench not found at: ${this._workbenchDir}`);
        }

        // First uninstall any previous injection
        if (this.isInstalled()) {
            this.uninstall();
        }

        // Write the script file
        fs.writeFileSync(this._scriptPath, scriptContent, 'utf8');

        // Patch workbench.html
        let html = fs.readFileSync(this._workbenchHtml, 'utf8');

        // Insert before </html>
        const scriptTag = [
            MARKER_START,
            `<script src="./${SCRIPT_FILENAME}"></script>`,
            MARKER_END,
        ].join('\n');

        html = html.replace('</html>', `${scriptTag}\n</html>`);
        fs.writeFileSync(this._workbenchHtml, html, 'utf8');
    }

    /**
     * Remove the injection.
     *
     * 1. Removes the <script> tag from workbench.html
     * 2. Deletes the script file
     */
    uninstall(): void {
        if (!this.isAvailable()) return;

        // Remove from workbench.html
        try {
            let html = fs.readFileSync(this._workbenchHtml, 'utf8');
            const regex = new RegExp(
                `\\n?${escapeRegex(MARKER_START)}[\\s\\S]*?${escapeRegex(MARKER_END)}\\n?`,
                'g',
            );
            html = html.replace(regex, '');
            fs.writeFileSync(this._workbenchHtml, html, 'utf8');
        } catch {
            // Ignore errors during cleanup
        }

        // Remove script file
        try {
            if (fs.existsSync(this._scriptPath)) {
                fs.unlinkSync(this._scriptPath);
            }
        } catch {
            // Ignore
        }
    }

    /**
     * Get the path to the workbench directory.
     */
    getWorkbenchDir(): string {
        return this._workbenchDir;
    }

    /**
     * Get the path to the script file.
     */
    getScriptPath(): string {
        return this._scriptPath;
    }
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
