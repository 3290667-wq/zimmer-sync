/**
 * Input sanitization utilities for security
 */

// Characters that could be used for XSS attacks
const DANGEROUS_PATTERNS = [
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  /javascript:/gi,
  /on\w+\s*=/gi,
  /<iframe/gi,
  /<object/gi,
  /<embed/gi,
  /<link/gi,
  /data:/gi,
  /vbscript:/gi,
];

/**
 * Sanitize a string by removing potentially dangerous content
 */
export function sanitizeString(input: string): string {
  if (typeof input !== 'string') return '';

  let sanitized = input.trim();

  // Remove dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    sanitized = sanitized.replace(pattern, '');
  }

  // Encode HTML entities
  sanitized = sanitized
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');

  return sanitized;
}

/**
 * Sanitize for display (removes dangerous patterns and encodes HTML)
 */
export function sanitizeForDisplay(input: string): string {
  if (typeof input !== 'string') return '';

  let sanitized = input.trim();

  // Remove dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    sanitized = sanitized.replace(pattern, '');
  }

  // Encode HTML entities to prevent XSS
  sanitized = sanitized
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');

  return sanitized;
}

/**
 * Decode HTML entities for editing (reverse of sanitizeForDisplay)
 */
export function decodeForEdit(input: string): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'");
}

/**
 * Validate and sanitize phone number
 * Allows only digits, +, -, spaces, parentheses
 */
export function sanitizePhone(input: string): string {
  if (typeof input !== 'string') return '';
  return input.replace(/[^0-9+\-\s()]/g, '').trim().slice(0, 20);
}

/**
 * Validate Israeli phone number format
 */
export function isValidIsraeliPhone(phone: string): boolean {
  if (!phone) return true; // Optional field
  const cleaned = phone.replace(/\D/g, '');
  // Israeli numbers: 05X-XXXXXXX (10 digits) or 972-5X-XXXXXXX (12 digits)
  return /^(05\d{8}|9725\d{8})$/.test(cleaned);
}

/**
 * Sanitize URL (only allow http/https)
 */
export function sanitizeUrl(input: string): string {
  if (typeof input !== 'string') return '';
  const trimmed = input.trim();

  // Only allow http and https protocols
  if (!/^https?:\/\//i.test(trimmed)) {
    return '';
  }

  // Remove any javascript: or data: that might be embedded
  if (/javascript:|data:|vbscript:/i.test(trimmed)) {
    return '';
  }

  return trimmed;
}

/**
 * Validate file type for upload
 */
export function isValidImageFile(file: File): boolean {
  const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
  const maxSize = 2 * 1024 * 1024; // 2MB

  return validTypes.includes(file.type) && file.size <= maxSize;
}

/**
 * Sanitize object recursively
 */
export function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeForDisplay(value);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizeObject(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized as T;
}
