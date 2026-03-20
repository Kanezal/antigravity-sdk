/**
 * Antigravity version detection and compatibility checking.
 *
 * Reads the installed AG version at runtime and validates it against the
 * `antigravityVersions` range declared in the SDK's own package.json.
 *
 * @module ag-version
 */

import * as path from 'path';
import * as fs from 'fs';

/** Parse "1.107.3" → [1, 107, 3] */
function parseVersion(v: string): number[] {
    return String(v).split('.').map(Number);
}

/** Compare two version arrays. Returns -1 / 0 / 1. */
function cmpVersion(a: number[], b: number[]): number {
    for (let i = 0; i < 3; i++) {
        const diff = (a[i] || 0) - (b[i] || 0);
        if (diff !== 0) return diff < 0 ? -1 : 1;
    }
    return 0;
}

/** One semver constraint, e.g. `{ op: '>=', ver: [1, 107, 0] }` */
interface Constraint { op: string; ver: number[]; }

function parseRange(range: string): Constraint[] {
    return range.trim().split(/\s+/).map(part => {
        const m = part.match(/^(>=|<=|>|<|=)?(\d[\d.]*)$/);
        if (!m) throw new Error(`Invalid AG version constraint: "${part}"`);
        return { op: m[1] || '=', ver: parseVersion(m[2]) };
    });
}

function satisfies(version: string, rangeStr: string): boolean {
    const v = parseVersion(version);
    return parseRange(rangeStr).every(({ op, ver }) => {
        const cmp = cmpVersion(v, ver);
        switch (op) {
            case '>=': return cmp >= 0;
            case '<=': return cmp <= 0;
            case '>':  return cmp >  0;
            case '<':  return cmp <  0;
            case '=':  return cmp === 0;
            default:   return false;
        }
    });
}

export interface AGVersionInfo {
    /** Installed AG version string, e.g. "1.107.3" */
    version: string;
    /** Whether it satisfies the SDK's antigravityVersions range */
    compatible: boolean;
    /** The supported range declared in the SDK's package.json */
    supportedRange: string;
}

/**
 * Detect the installed Antigravity version.
 *
 * Reads from `%LOCALAPPDATA%\Programs\Antigravity\resources\app\package.json`.
 *
 * @returns AGVersionInfo, or null if AG is not found / version unreadable.
 */
export function detectAGVersion(): AGVersionInfo | null {
    try {
        const localAppData = process.env.LOCALAPPDATA || '';
        const agPkgPath = path.join(localAppData, 'Programs', 'Antigravity', 'resources', 'app', 'package.json');

        if (!fs.existsSync(agPkgPath)) return null;

        const agPkg = JSON.parse(fs.readFileSync(agPkgPath, 'utf8'));
        const version: string = agPkg.version;
        if (!version) return null;

        // Read supported range from this SDK's own package.json
        const sdkPkgPath = path.join(__dirname, '..', '..', 'package.json');
        const sdkPkg = JSON.parse(fs.readFileSync(sdkPkgPath, 'utf8'));
        const supportedRange: string = sdkPkg.antigravityVersions ?? '*';

        const compatible = supportedRange === '*' || satisfies(version, supportedRange);

        return { version, compatible, supportedRange };
    } catch {
        return null;
    }
}
