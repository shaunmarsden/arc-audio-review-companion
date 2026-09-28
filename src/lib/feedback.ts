// Links to the repo's GitHub issue forms, with technical details pre-filled so reports are useful.
// Only non-sensitive details are included: never document text, comments or API keys.
import { IS_HOSTED } from './backend';

const NEW_ISSUE = 'https://github.com/shaunmarsden/arc-audio-review-companion/issues/new';

export type FeedbackKind = 'bug' | 'idea' | 'feedback';

const TEMPLATES: Record<FeedbackKind, string> = {
  bug: 'bug_report.yml',
  idea: 'idea.yml',
  feedback: 'feedback.yml',
};

export function feedbackUrl(kind: FeedbackKind, context: { readMode?: string; lastError?: string | null } = {}) {
  const details = [
    `ARC ${__APP_VERSION__} (${IS_HOSTED ? 'website' : 'self-hosted'})`,
    `Browser: ${navigator.userAgent}`,
    `Screen: ${window.innerWidth}x${window.innerHeight}`,
    context.readMode && `Reading mode: ${context.readMode}`,
    context.lastError && `Last error shown: ${context.lastError.slice(0, 300)}`,
  ].filter(Boolean).join('\n');
  const params = new URLSearchParams({ template: TEMPLATES[kind], environment: details });
  if (kind === 'bug') params.set('version', IS_HOSTED ? 'The website (shaunmarsden.github.io)' : 'Running it myself (npm run dev)');
  return `${NEW_ISSUE}?${params.toString()}`;
}
