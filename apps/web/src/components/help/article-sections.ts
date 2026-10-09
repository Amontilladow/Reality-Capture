import type { HelpArticle } from '../../content/help';

export function slugifySectionTitle(title: string): string {
  return `section-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`;
}

// Single source of truth for which sections a given article renders --
// used both by ArticleView itself and by the right-panel table of
// contents (HelpPage), so the two can never disagree about what's
// actually present. Every entry here is conditional on the article
// actually having that field (brief: "where a field... is not
// supported... omit it" -- a short FAQ/glossary entry with just a title
// and summary produces an empty list and renders nothing beyond those).
export function getArticleSectionTitles(article: HelpArticle): string[] {
  const titles: string[] = [];
  if (article.whatItDoes) titles.push('What this feature does');
  if (article.whenToUse) titles.push('When to use it');
  if (article.whoCanUse) titles.push('Who can use it');
  if (article.requiredPermissions) titles.push('Required permissions');
  if (article.prerequisites?.length) titles.push('Prerequisites');
  if (article.steps?.length) titles.push('Step-by-step instructions');
  if (article.infoToEnter?.length) titles.push('Information you must enter');
  if (article.attachments) titles.push('Attachments or supporting documents');
  if (article.afterSubmission) titles.push('What happens after submission');
  if (article.whoIsNotified) titles.push('Who is notified');
  if (article.reviewEditApproveClose) titles.push('Who can review, edit, approve, or close the record');
  if (article.howToTrackProgress) titles.push('How to track progress');
  if (article.commonMistakes?.length) titles.push('Common mistakes');
  if (article.troubleshootingSteps?.length) titles.push('Troubleshooting');
  if (article.relatedSlugs?.length) titles.push('Related articles');
  return titles;
}
