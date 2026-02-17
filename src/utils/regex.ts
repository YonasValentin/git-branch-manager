/**
 * Regex validation utilities to prevent ReDoS attacks.
 * Validates user-provided patterns before execution.
 */

export interface RegexValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates a regex pattern for safety before compilation.
 * Rejects patterns with nested quantifiers that cause catastrophic backtracking.
 * @param pattern - The regex pattern string to validate
 * @returns Validation result with error message if invalid
 */
export function validateRegexPattern(pattern: string): RegexValidationResult {
  if (pattern.length > 200) {
    return { valid: false, error: 'Pattern too long (max 200 characters)' };
  }

  // Detect ReDoS-prone patterns (nested/repeated quantifiers)
  const dangerousPatterns = [
    /\([^)]*[+*]\)[+*{]/,         // (x+)+, (x+)*, (x*)+, (x*)*
    /\([^|]*\|[^)]*\)[+*{]/,      // (a|b)+, (a|b)*
    /\.\*\.\*/,                     // .*.* (multiple unbounded wildcards)
  ];

  for (const dangerous of dangerousPatterns) {
    if (dangerous.test(pattern)) {
      return {
        valid: false,
        error: 'Pattern contains quantifiers that may cause performance issues',
      };
    }
  }

  try {
    new RegExp(pattern);
    return { valid: true };
  } catch (e) {
    return {
      valid: false,
      error: `Invalid regex: ${e instanceof Error ? e.message : 'unknown error'}`,
    };
  }
}

/**
 * Safely tests a string against a regex pattern with validation.
 * @param pattern - Regex pattern string
 * @param input - String to test
 * @param maxInputLength - Maximum input length (default 1000)
 * @returns Match result or error
 */
export function safeRegexTest(
  pattern: string,
  input: string,
  maxInputLength = 1000
): { matches: boolean; error?: string } {
  const validation = validateRegexPattern(pattern);
  if (!validation.valid) {
    return { matches: false, error: validation.error };
  }

  if (input.length > maxInputLength) {
    return { matches: false, error: `Input too long (max ${maxInputLength} characters)` };
  }

  try {
    const regex = new RegExp(pattern);
    return { matches: regex.test(input) };
  } catch (e) {
    return { matches: false, error: `Regex failed: ${e instanceof Error ? e.message : 'unknown'}` };
  }
}
