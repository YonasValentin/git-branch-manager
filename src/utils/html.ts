/**
 * Escapes HTML special characters.
 * @param str - String to escape
 * @returns Escaped string
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Gets the health status color.
 * @param status - Health status
 * @returns CSS color variable
 */
export function getHealthColor(status?: string): string {
  switch (status) {
    case 'healthy': return 'var(--vscode-testing-iconPassed)';
    case 'warning': return 'var(--vscode-editorWarning-foreground)';
    case 'critical': return 'var(--vscode-editorError-foreground)';
    case 'danger': return 'var(--vscode-inputValidation-errorBorder)';
    default: return 'var(--vscode-foreground)';
  }
}
