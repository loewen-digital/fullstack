/**
 * Strip dangerous HTML and scripts from a string.
 *
 * This is a lightweight, zero-dependency sanitizer suitable for removing
 * obvious XSS vectors. For rich HTML (e.g. user-authored content with
 * formatting), use a dedicated library like DOMPurify or sanitize-html.
 */

// Tags that are outright removed including their content
const DANGEROUS_TAGS = /(<\s*script[\s\S]*?<\s*\/\s*script\s*>)/gi
// Attributes that can execute code
const DANGEROUS_ATTRS = /\s*on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi
// javascript: and data: in href/src
const DANGEROUS_PROTOCOLS = /(href|src|action)\s*=\s*["']?\s*(javascript:|data:|vbscript:)/gi
// All remaining HTML tags
const HTML_TAGS = /<[^>]*>/g

/**
 * Remove script tags, event handlers, and dangerous protocols from a string,
 * then strip all remaining HTML tags.
 *
 * Returns the plain-text content.
 */
export function sanitize(input: string): string {
  return input
    .replace(DANGEROUS_TAGS, '')
    .replace(DANGEROUS_ATTRS, '')
    .replace(DANGEROUS_PROTOCOLS, '$1=""')
    .replace(HTML_TAGS, '')
    .trim()
}

/**
 * Escape HTML special characters to entities.
 * Use when inserting untrusted strings into HTML attributes or text nodes.
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
