/**
 * DOM Selectors — Single source of truth for all Agent View selectors.
 *
 * Verified against Antigravity v1.107.0 DOM (2026-02-28).
 * If Antigravity updates break selectors, only THIS file needs updating.
 *
 * @module injection/selectors
 *
 * @internal
 */

export const Selectors = {
    /** The entire agent side panel container */
    PANEL: '.antigravity-agent-side-panel',

    /** Top bar with title and action icons */
    TOP_BAR: '.flex.items-center.justify-between',

    /** Icons area in top bar (contains +, refresh, ..., X) */
    TOP_ICONS: '.flex.items-center.gap-2',

    /** Chat title element */
    TITLE: '.flex.min-w-0.items-center.overflow-hidden',

    /** Main conversation scroll area */
    CONVERSATION: '#conversation',

    /** Message turns container (direct children are turns) */
    TURNS_CONTAINER: '#conversation .gap-y-3',

    /** User message bubble (inside turn) */
    USER_BUBBLE: '.rounded-lg',

    /** Input box container */
    INPUT_BOX: '#antigravity\\.agentSidePanelInputBox',

    /** 3-dot dropdown menu (appears dynamically) */
    DROPDOWN_MARKER_TEXT: ['Customization', 'Export'],

    /** Dropdown menu item class pattern */
    DROPDOWN_ITEM: '.cursor-pointer',

    /** Good/Bad feedback text markers */
    FEEDBACK_MARKERS: ['Good', 'Bad'],
} as const;

/**
 * CSS class prefixes used by X-Ray injections.
 * Used to identify and clean up injected elements.
 */
export const XR_PREFIX = 'xr-';

/**
 * Data attribute used to mark processed elements.
 */
export const XR_DATA_ATTR = 'data-xray';
