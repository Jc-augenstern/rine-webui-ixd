import { marked } from 'marked';
import sanitize from 'sanitize-html';
export function renderMarkdown(body: string): string {
  return sanitize(marked.parse(body, { async: false }) as string, {
    allowedTags: ['p', 'br', 'hr', 'strong', 'em', 's', 'blockquote', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a'],
    allowedAttributes: { a: ['href', 'title', 'rel', 'target'] }, allowedSchemes: ['http', 'https'], allowProtocolRelative: false,
    transformTags: { a: sanitize.simpleTransform('a', { rel: 'noopener noreferrer nofollow', target: '_blank' }) },
  });
}
