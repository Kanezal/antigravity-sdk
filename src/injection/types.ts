/**
 * Injection module types — standardized UI injection points
 * for the Antigravity Agent View.
 *
 * @module injection/types
 */

// ─── Injection Points ──────────────────────────────────────────────────

/**
 * Standardized injection points in the Agent View UI.
 *
 * Each point corresponds to a specific DOM location in the
 * Antigravity chat interface (verified 2026-02-28).
 */
export enum InjectionPoint {
    /** Top bar — next to +, refresh, ... icons */
    TOP_BAR = 'topBar',
    /** Top right corner — before the X (close) button */
    TOP_RIGHT = 'topRight',
    /** Input area — next to voice/send buttons */
    INPUT_AREA = 'inputArea',
    /** Bottom icon row — file, terminal, artifact, chrome icons */
    BOTTOM_ICONS = 'bottomIcons',
    /** Per-turn metadata — appended inside each conversation turn */
    TURN_METADATA = 'turnMeta',
    /** User message badge — small badge inside user message bubbles */
    USER_BADGE = 'userBadge',
    /** Bot response action — button next to Good/Bad feedback */
    BOT_ACTION = 'botAction',
    /** 3-dot dropdown menu — extra items in the overflow menu */
    DROPDOWN_MENU = 'dropdownMenu',
    /** Chat title bar — interaction on conversation title */
    CHAT_TITLE = 'chatTitle',
}

// ─── Configuration Interfaces ──────────────────────────────────────────

/**
 * Base configuration for all injection points.
 */
export interface IInjectionBase {
    /** Unique ID for this injection (prevents duplicates) */
    id: string;
    /** Which injection point to target */
    point: InjectionPoint;
    /** Whether this injection is enabled (default: true) */
    enabled?: boolean;
}

/**
 * Configuration for button-type injections (top bar, input area, etc.).
 */
export interface IButtonInjection extends IInjectionBase {
    point:
    | InjectionPoint.TOP_BAR
    | InjectionPoint.TOP_RIGHT
    | InjectionPoint.INPUT_AREA
    | InjectionPoint.BOTTOM_ICONS;
    /** Icon (emoji or text glyph) */
    icon: string;
    /** Tooltip text */
    tooltip?: string;
    /** Toast to show on click */
    toast?: IToastConfig;
    /** CSS class override */
    className?: string;
}

/**
 * Configuration for turn-level metadata injection.
 */
export interface ITurnMetaInjection extends IInjectionBase {
    point: InjectionPoint.TURN_METADATA;
    /** Which metrics to display */
    metrics: TurnMetric[];
    /** Whether turns are clickable to show details toast */
    clickable?: boolean;
}

/**
 * Configuration for user message badges.
 */
export interface IUserBadgeInjection extends IInjectionBase {
    point: InjectionPoint.USER_BADGE;
    /** What to show in the badge */
    display: 'charCount' | 'wordCount' | 'custom';
    /** Custom formatter function body (receives `textLength` as arg) */
    customFormat?: string;
}

/**
 * Configuration for bot response action buttons.
 */
export interface IBotActionInjection extends IInjectionBase {
    point: InjectionPoint.BOT_ACTION;
    /** Icon */
    icon: string;
    /** Label text */
    label: string;
    /** Toast config on click */
    toast?: IToastConfig;
}

/**
 * Configuration for dropdown menu items.
 */
export interface IDropdownInjection extends IInjectionBase {
    point: InjectionPoint.DROPDOWN_MENU;
    /** Menu item icon */
    icon?: string;
    /** Menu item label */
    label: string;
    /** Add separator before this item */
    separator?: boolean;
    /** Toast config on click */
    toast?: IToastConfig;
}

/**
 * Configuration for chat title interaction.
 */
export interface ITitleInjection extends IInjectionBase {
    point: InjectionPoint.CHAT_TITLE;
    /** Interaction type */
    interaction: 'click' | 'dblclick' | 'hover';
    /** Hint text shown on hover */
    hint?: string;
    /** Toast config on interaction */
    toast?: IToastConfig;
}

/**
 * Toast popup configuration.
 */
export interface IToastConfig {
    /** Toast title */
    title: string;
    /** Badge label and colors */
    badge?: {
        text: string;
        bgColor: string;
        textColor: string;
    };
    /** Key-value rows to display */
    rows: IToastRow[];
    /** Auto-dismiss after N milliseconds (default: 6000) */
    duration?: number;
}

/**
 * A row in a toast popup.
 */
export interface IToastRow {
    /** Label (left side) */
    key: string;
    /**
     * Value (right side).
     * Can be a static string or a dynamic expression.
     * Dynamic expressions are JS code that runs in the renderer,
     * with access to `getStats()` which returns conversation stats.
     */
    value: string;
    /** If true, `value` is treated as a JS expression */
    dynamic?: boolean;
}

/**
 * Metrics available for turn metadata display.
 */
export type TurnMetric =
    | 'turnNumber'
    | 'userCharCount'
    | 'aiCharCount'
    | 'codeBlocks'
    | 'thinkingIndicator'
    | 'ratio'
    | 'separator';

/**
 * Union type of all injection configurations.
 */
export type InjectionConfig =
    | IButtonInjection
    | ITurnMetaInjection
    | IUserBadgeInjection
    | IBotActionInjection
    | IDropdownInjection
    | ITitleInjection;

// ─── Manager Interface ────────────────────────────────────────────────

/**
 * Public interface for the Injection Manager.
 */
export interface IInjectionManager {
    /** Register a single injection point */
    register(config: InjectionConfig): void;
    /** Register multiple injection points at once */
    registerMany(configs: InjectionConfig[]): void;
    /** Remove a registered injection by ID */
    unregister(id: string): void;
    /** Get all registered injections */
    getRegistered(): ReadonlyArray<InjectionConfig>;
    /** Generate the injection script from all registered configs */
    build(): string;
    /** Install the generated script into workbench.html */
    install(): Promise<void>;
    /** Remove the injection from workbench.html */
    uninstall(): Promise<void>;
    /** Check if an injection is currently installed */
    isInstalled(): boolean;
}
