/**
 * Widget exports for klygo ChatGPT App
 */
export { SHARED_STYLES } from './shared-styles.js';
export { createAssessResultWidget, type AssessResultData } from './assess-result.js';
export { createLockAnalysisWidget, type LockAnalysisData } from './lock-analysis.js';
export { createRecommendationWidget, type RecommendationData } from './recommendation.js';

/**
 * Widget URIs for MCP resources
 */
export const WIDGET_URIS = {
  assessResult: 'ui://widget/assess-result.html',
  lockAnalysis: 'ui://widget/lock-analysis.html',
  recommendation: 'ui://widget/recommendation.html',
} as const;
