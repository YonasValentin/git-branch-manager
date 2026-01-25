import { BranchTemplate } from './types';

/**
 * Predefined branch templates for quick branch creation.
 */
export const BRANCH_TEMPLATES: BranchTemplate[] = [
  { name: 'Feature', pattern: 'feature/{description}', example: 'feature/add-user-auth' },
  { name: 'Bugfix', pattern: 'bugfix/{description}', example: 'bugfix/fix-login-error' },
  { name: 'Hotfix', pattern: 'hotfix/{description}', example: 'hotfix/critical-payment-fix' },
  { name: 'Release', pattern: 'release/{version}', example: 'release/v1.2.0' },
  { name: 'Experiment', pattern: 'exp/{description}', example: 'exp/new-algorithm' },
];
