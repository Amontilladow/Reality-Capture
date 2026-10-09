import type { CompanyRole } from '@engineeringos/types';
import type { HelpArticle, HelpCategoryKey } from './types';
import { HELP_CATEGORY_LABELS } from './types';
import { gettingStartedArticles } from './getting-started';
import { glossaryArticles } from './glossary';
import { faqArticles } from './faq';
import { troubleshootingArticles } from './troubleshooting';

export * from './types';

// Single source of truth for every article -- Phase 4D adds the
// remaining category files (dashboard/projects, floor plans, issues/
// snagging, rfi, drawings/documents, reports/progress, notifications/
// email, ai-assistant, user-management) here the same way.
export const ALL_HELP_ARTICLES: HelpArticle[] = [
  ...gettingStartedArticles,
  ...glossaryArticles,
  ...faqArticles,
  ...troubleshootingArticles,
];

const ARTICLES_BY_SLUG = new Map(ALL_HELP_ARTICLES.map((a) => [a.slug, a]));

export function getArticle(slug: string): HelpArticle | undefined {
  return ARTICLES_BY_SLUG.get(slug);
}

export function getArticlesByCategory(category: HelpCategoryKey): HelpArticle[] {
  return ALL_HELP_ARTICLES.filter((a) => a.category === category);
}

export function getRelatedArticles(article: HelpArticle): HelpArticle[] {
  return (article.relatedSlugs ?? []).map(getArticle).filter((a): a is HelpArticle => Boolean(a));
}

// Articles tagged for a specific company role, plus every untagged
// article (relevant to everyone). Project-role tagging works the same
// way via article.roles?.projectRoles, applied the same way by the
// caller -- kept as a single filter function below rather than two
// near-identical ones.
export function getArticlesForRole(companyRole: CompanyRole | undefined): HelpArticle[] {
  if (!companyRole) return ALL_HELP_ARTICLES;
  return ALL_HELP_ARTICLES.filter((a) => !a.roles?.companyRoles || a.roles.companyRoles.includes(companyRole));
}

// Local, in-memory search -- deliberately not a backend call or a paid
// search provider (brief: "start with local or backend search using the
// existing architecture"). Help content contains no project data and no
// confidential information, so there is nothing here that needs
// server-side access control; matching the content to a query can
// happen entirely in the browser. Matches title, summary, keywords, and
// category label as substrings (case-insensitive) -- simple, predictable,
// and correct for a corpus of this size (tens, not thousands, of
// articles).
export interface HelpSearchResult {
  article: HelpArticle;
  // Which field matched, for lightweight result context -- not used for
  // ranking beyond the order below (title match first, then keyword,
  // then summary).
  matchedOn: 'title' | 'keyword' | 'summary' | 'category';
}

export function searchHelpArticles(rawQuery: string): HelpSearchResult[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return [];

  const results: HelpSearchResult[] = [];
  for (const article of ALL_HELP_ARTICLES) {
    if (article.title.toLowerCase().includes(query)) {
      results.push({ article, matchedOn: 'title' });
      continue;
    }
    if (article.keywords?.some((k) => k.toLowerCase().includes(query))) {
      results.push({ article, matchedOn: 'keyword' });
      continue;
    }
    if (article.summary.toLowerCase().includes(query)) {
      results.push({ article, matchedOn: 'summary' });
      continue;
    }
    if (HELP_CATEGORY_LABELS[article.category].toLowerCase().includes(query)) {
      results.push({ article, matchedOn: 'category' });
    }
  }
  return results;
}
