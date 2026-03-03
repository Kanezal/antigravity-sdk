/**
 * Integration module — re-exports.
 * @module integration
 */
export { IntegrationManager } from './integration-manager';
export { IntegrityManager } from './integrity-manager';
export { TitleManager } from './title-manager';
export { IntegrationPoint } from './types';
export type {
    IntegrationConfig,
    IIntegrationManager,
    IButtonIntegration,
    ITurnMetaIntegration,
    IUserBadgeIntegration,
    IBotActionIntegration,
    IDropdownIntegration,
    ITitleIntegration,
    IToastConfig,
    IToastRow,
    TurnMetric,
} from './types';
