/**
 * Utility functions for URL security and credential sanitization
 */
/**
 * Sanitizes URLs by replacing password/credentials with asterisks.
 * Example:
 *  rtsp://admin:123456@192.168.1.1:554/stream
 *  -> rtsp://admin:***@192.168.1.1:554/stream
 */
export declare function sanitizeUrl(url: string | null | undefined): string;
//# sourceMappingURL=security.d.ts.map