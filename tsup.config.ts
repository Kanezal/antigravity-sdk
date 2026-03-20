import { defineConfig } from 'tsup';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// ── AG version check ───────────────────────────────────────────────────────

function parseVersion(v: string): number[] {
    return String(v).split('.').map(Number);
}

function cmpVersion(a: number[], b: number[]): number {
    for (let i = 0; i < 3; i++) {
        const diff = (a[i] || 0) - (b[i] || 0);
        if (diff !== 0) return diff < 0 ? -1 : 1;
    }
    return 0;
}

function satisfies(version: string, range: string): boolean {
    const v = parseVersion(version);
    return range.trim().split(/\s+/).every(part => {
        const m = part.match(/^(>=|<=|>|<|=)?(\d[\d.]*)$/);
        if (!m) return true; // skip malformed constraint
        const op = m[1] || '=';
        const ver = parseVersion(m[2]);
        const cmp = cmpVersion(v, ver);
        return op === '>=' ? cmp >= 0 : op === '<=' ? cmp <= 0 :
               op === '>'  ? cmp >  0 : op === '<'  ? cmp <  0 : cmp === 0;
    });
}

function checkAGVersion(): void {
    const sdkPkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const supported: string | undefined = sdkPkg.antigravityVersions;
    if (!supported) return;

    const localAppData = process.env.LOCALAPPDATA || '';
    const agPkgPath = join(localAppData, 'Programs', 'Antigravity', 'resources', 'app', 'package.json');

    if (!existsSync(agPkgPath)) {
        console.warn('[SDK build] WARNING: Antigravity not found — skipping version check.');
        return;
    }

    const agVersion: string = JSON.parse(readFileSync(agPkgPath, 'utf8')).version;
    if (!agVersion) return;

    const ok = satisfies(agVersion, supported);
    console.log(`[SDK build] AG v${agVersion} | supported: ${supported} | ${ok ? 'OK ✓' : 'INCOMPATIBLE ✗'}`);

    if (!ok) {
        console.error(`\nERROR: AG v${agVersion} is outside supported range (${supported}).`);
        console.error('Update antigravityVersions in package.json or use a compatible SDK version.\n');
        process.exit(1);
    }
}

checkAGVersion();

// ── tsup config ────────────────────────────────────────────────────────────

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ['vscode'],
    splitting: false,
    treeshake: true,
});
