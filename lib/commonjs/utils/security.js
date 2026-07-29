"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.sanitizeUrl = sanitizeUrl;
/**
 * Utility functions for URL security and credential sanitization
 */

/**
 * Sanitizes URLs by replacing password/credentials with asterisks.
 * Example:
 *  rtsp://admin:123456@192.168.1.1:554/stream
 *  -> rtsp://admin:***@192.168.1.1:554/stream
 */
function sanitizeUrl(url) {
  if (!url) return '';
  try {
    return url.replace(/(:\/\/[^:]+:)[^@]+(@)/, '$1***$2');
  } catch (_e) {
    return '[REDACTED_URL]';
  }
}
//# sourceMappingURL=security.js.map