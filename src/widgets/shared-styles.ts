/**
 * Shared CSS styles for all klygo widgets
 * Following ChatGPT Apps SDK design guidelines:
 * - System fonts (SF Pro / Roboto)
 * - System colors
 * - WCAG AA contrast
 * - Responsive design
 */
export const SHARED_STYLES = `
  :root {
    --color-text-primary: #0d0d0d;
    --color-text-secondary: #6b6b6b;
    --color-text-tertiary: #8e8e8e;
    --color-bg-primary: #ffffff;
    --color-bg-secondary: #f7f7f8;
    --color-border: #e5e5e5;
    --color-accent: #10a37f;
    --color-accent-hover: #0d8a6a;
    --color-warning: #f59e0b;
    --color-danger: #ef4444;
    --color-success: #22c55e;
    --radius-sm: 8px;
    --radius-md: 12px;
    --radius-lg: 16px;
    --spacing-xs: 4px;
    --spacing-sm: 8px;
    --spacing-md: 12px;
    --spacing-lg: 16px;
    --spacing-xl: 24px;
  }

  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: var(--color-text-primary);
    background: var(--color-bg-primary);
    -webkit-font-smoothing: antialiased;
  }

  .widget-card {
    padding: var(--spacing-lg);
    max-width: 400px;
  }

  .widget-header {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-md);
  }

  .widget-icon {
    font-size: 20px;
  }

  .widget-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .widget-divider {
    height: 1px;
    background: var(--color-border);
    margin: var(--spacing-md) 0;
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--spacing-sm) 0;
  }

  .info-label {
    color: var(--color-text-secondary);
    font-size: 13px;
  }

  .info-value {
    font-weight: 500;
    color: var(--color-text-primary);
    font-size: 14px;
  }

  .info-value.highlight {
    color: var(--color-accent);
  }

  .info-value.warning {
    color: var(--color-warning);
  }

  .info-value.danger {
    color: var(--color-danger);
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: var(--spacing-xs);
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: var(--radius-sm);
    font-size: 12px;
    font-weight: 500;
  }

  .badge-success {
    background: #dcfce7;
    color: #166534;
  }

  .badge-warning {
    background: #fef3c7;
    color: #92400e;
  }

  .badge-danger {
    background: #fee2e2;
    color: #991b1b;
  }

  .badge-info {
    background: #e0f2fe;
    color: #0369a1;
  }

  .cost-range {
    background: var(--color-bg-secondary);
    border-radius: var(--radius-md);
    padding: var(--spacing-md);
    margin: var(--spacing-md) 0;
  }

  .cost-label {
    font-size: 12px;
    color: var(--color-text-secondary);
    margin-bottom: var(--spacing-xs);
  }

  .cost-value {
    font-size: 18px;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .cost-note {
    font-size: 11px;
    color: var(--color-text-tertiary);
    margin-top: var(--spacing-xs);
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-sm);
    padding: var(--spacing-sm) var(--spacing-lg);
    border-radius: var(--radius-sm);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    border: none;
    transition: background 0.2s, transform 0.1s;
    width: 100%;
  }

  .btn:active {
    transform: scale(0.98);
  }

  .btn-primary {
    background: var(--color-accent);
    color: white;
  }

  .btn-primary:hover {
    background: var(--color-accent-hover);
  }

  .btn-secondary {
    background: var(--color-bg-secondary);
    color: var(--color-text-primary);
    border: 1px solid var(--color-border);
  }

  .btn-secondary:hover {
    background: var(--color-border);
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    margin-top: var(--spacing-lg);
  }

  .disclaimer {
    font-size: 11px;
    color: var(--color-text-tertiary);
    text-align: center;
    margin-top: var(--spacing-md);
    padding-top: var(--spacing-md);
    border-top: 1px solid var(--color-border);
  }

  .difficulty-meter {
    display: flex;
    gap: 4px;
    margin-top: var(--spacing-xs);
  }

  .difficulty-bar {
    width: 24px;
    height: 6px;
    border-radius: 3px;
    background: var(--color-border);
  }

  .difficulty-bar.active {
    background: var(--color-accent);
  }

  .difficulty-bar.active.warning {
    background: var(--color-warning);
  }

  .difficulty-bar.active.danger {
    background: var(--color-danger);
  }

  .tip-box {
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    border-radius: var(--radius-md);
    padding: var(--spacing-md);
    margin: var(--spacing-md) 0;
  }

  .tip-box.warning {
    background: #fffbeb;
    border-color: #fde68a;
  }

  .tip-title {
    font-size: 13px;
    font-weight: 600;
    color: #166534;
    margin-bottom: var(--spacing-xs);
  }

  .tip-box.warning .tip-title {
    color: #92400e;
  }

  .tip-text {
    font-size: 12px;
    color: #15803d;
  }

  .tip-box.warning .tip-text {
    color: #a16207;
  }

  .link-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--spacing-sm);
    margin-top: var(--spacing-md);
  }

  .link-item {
    display: inline-flex;
    align-items: center;
    gap: var(--spacing-xs);
    padding: var(--spacing-xs) var(--spacing-sm);
    background: var(--color-bg-secondary);
    border-radius: var(--radius-sm);
    font-size: 12px;
    color: var(--color-text-secondary);
    text-decoration: none;
    cursor: pointer;
  }

  .link-item:hover {
    background: var(--color-border);
    color: var(--color-text-primary);
  }
`;
