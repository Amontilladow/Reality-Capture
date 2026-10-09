import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/layout/PageHeader';
import { ArticleView } from '../components/help/ArticleView';
import { getArticleSectionTitles, slugifySectionTitle } from '../components/help/article-sections';
import {
  HELP_CATEGORIES, HELP_CATEGORY_LABELS,
  getArticle, getArticlesByCategory, getRelatedArticles, searchHelpArticles,
  type HelpArticle, type HelpCategoryKey,
} from '../content/help';
import { ROLE_GUIDE_SLUGS } from '../content/help/role-guides';
import { COMPANY_ROLE_LABELS } from '../lib/issue-constants';
import { useAuthStore } from '../store/auth.store';
import { setOnboardingCompleted } from '../lib/users.api';

const DEFAULT_CATEGORY: HelpCategoryKey = 'getting-started';

export default function HelpPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [showRoleGuide, setShowRoleGuide] = useState(false);
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const companyRole = user?.companyRole;

  function restartOnboarding() {
    if (!user) return;
    setUser({ ...user, onboardingCompleted: false });
    setOnboardingCompleted(user.id, false).catch(() => {
      // Best-effort -- the restart already took effect locally for this session.
    });
  }

  const activeSlug = searchParams.get('article');
  const activeCategory = (searchParams.get('category') as HelpCategoryKey | null) ?? DEFAULT_CATEGORY;
  const activeArticle = activeSlug ? getArticle(activeSlug) : undefined;

  function openArticle(slug: string) {
    setQuery('');
    setSearchParams({ article: slug });
  }
  function openCategory(category: HelpCategoryKey) {
    setShowRoleGuide(false);
    setSearchParams({ category });
  }
  function openRoleGuide() {
    setQuery('');
    setSearchParams({});
    setShowRoleGuide(true);
  }

  const roleGuideArticles: HelpArticle[] = companyRole
    ? ROLE_GUIDE_SLUGS[companyRole].map(getArticle).filter((a): a is HelpArticle => Boolean(a))
    : [];

  const searchResults = query.trim() ? searchHelpArticles(query) : [];
  const categoryArticles = getArticlesByCategory(activeCategory);
  const sectionTitles = activeArticle ? getArticleSectionTitles(activeArticle) : [];
  const relatedTips = activeArticle?.commonMistakes ?? [];

  return (
    <>
      <PageHeader eyebrow="Workspace" title="Help & Training" />

      <div className="p-6 space-y-4 max-w-6xl">
        <div className="relative max-w-md">
          <input
            type="search"
            className="field-input w-full"
            placeholder="Search articles, keywords, RFI, BIM, QA/QC…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search the Help Centre"
          />
        </div>

        {query.trim() ? (
          <SearchResultsPanel query={query} results={searchResults} onOpenArticle={openArticle} />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr_260px] gap-6">
            <nav aria-label="Help categories" className="space-y-0.5">
              {companyRole && (
                <button
                  onClick={openRoleGuide}
                  aria-current={!activeSlug && showRoleGuide ? 'true' : undefined}
                  className={`w-full text-left px-3 py-2 rounded text-sm font-medium transition-colors mb-2 border ${
                    !activeSlug && showRoleGuide
                      ? 'bg-signal/10 text-signal border-signal/30'
                      : 'text-ink-200 border-base-700 hover:bg-base-800'
                  }`}
                >
                  For My Role
                  <span className="block text-[11px] font-normal text-ink-500">{COMPANY_ROLE_LABELS[companyRole]}</span>
                </button>
              )}
              {HELP_CATEGORIES.map((key) => (
                <button
                  key={key}
                  onClick={() => openCategory(key)}
                  aria-current={!activeSlug && !showRoleGuide && key === activeCategory ? 'true' : undefined}
                  className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                    !activeSlug && !showRoleGuide && key === activeCategory ? 'bg-signal/10 text-signal' : 'text-ink-300 hover:bg-base-800'
                  }`}
                >
                  {HELP_CATEGORY_LABELS[key]}
                </button>
              ))}
              {user && (
                <button
                  onClick={restartOnboarding}
                  className="w-full text-left px-3 py-2 rounded text-xs text-ink-500 hover:text-ink-100 hover:bg-base-800 mt-2"
                >
                  Restart onboarding tour
                </button>
              )}
            </nav>

            <div className="panel tick-frame p-6 min-w-0">
              {activeArticle ? (
                <ArticleView article={activeArticle} onOpenArticle={openArticle} />
              ) : showRoleGuide && companyRole ? (
                <RoleGuideList roleLabel={COMPANY_ROLE_LABELS[companyRole]} articles={roleGuideArticles} onOpenArticle={openArticle} />
              ) : (
                <CategoryArticleList category={activeCategory} articles={categoryArticles} onOpenArticle={openArticle} />
              )}
            </div>

            <aside className="space-y-5">
              {activeArticle && sectionTitles.length > 1 && (
                <div>
                  <div className="field-label mb-2">On this page</div>
                  <ul className="space-y-1 text-sm">
                    {sectionTitles.map((title) => (
                      <li key={title}>
                        <a href={`#${slugifySectionTitle(title)}`} className="text-ink-300 hover:text-signal">{title}</a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {activeArticle && getRelatedArticles(activeArticle).length > 0 && (
                <div>
                  <div className="field-label mb-2">Related topics</div>
                  <ul className="space-y-1 text-sm">
                    {getRelatedArticles(activeArticle).map((r) => (
                      <li key={r.slug}>
                        <button onClick={() => openArticle(r.slug)} className="text-blueprint hover:text-blueprint-hover text-left">{r.title}</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {activeArticle && relatedTips.length > 0 && (
                <div>
                  <div className="field-label mb-2">Helpful tips</div>
                  <ul className="list-disc pl-4 space-y-1 text-xs text-ink-500">
                    {relatedTips.slice(0, 3).map((tip, i) => <li key={i}>{tip}</li>)}
                  </ul>
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
    </>
  );
}

function RoleGuideList({
  roleLabel, articles, onOpenArticle,
}: {
  roleLabel: string;
  articles: HelpArticle[];
  onOpenArticle: (slug: string) => void;
}) {
  return (
    <div>
      <h1 className="text-lg font-semibold text-ink-100 mb-1">Guide for {roleLabel}</h1>
      <p className="text-xs text-ink-500 mb-4">
        A quick-start subset of the Help Centre for your role -- the rest is still available via the categories on the left.
      </p>
      {articles.length === 0 ? (
        <div className="text-sm text-ink-500">No role-specific guide is available yet for {roleLabel}.</div>
      ) : (
        <ul className="space-y-3">
          {articles.map((a) => (
            <li key={a.slug}>
              <button onClick={() => onOpenArticle(a.slug)} className="text-left w-full panel p-4 hover:bg-base-800/60 transition-colors">
                <div className="text-[10px] font-mono uppercase tracking-widest text-ink-500">{HELP_CATEGORY_LABELS[a.category]}</div>
                <div className="font-medium text-ink-100 text-sm">{a.title}</div>
                <div className="text-xs text-ink-500 mt-0.5">{a.summary}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CategoryArticleList({
  category, articles, onOpenArticle,
}: {
  category: HelpCategoryKey;
  articles: ReturnType<typeof getArticlesByCategory>;
  onOpenArticle: (slug: string) => void;
}) {
  if (articles.length === 0) {
    return (
      <div className="text-sm text-ink-500">
        No articles in {HELP_CATEGORY_LABELS[category]} yet.
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-ink-100 mb-4">{HELP_CATEGORY_LABELS[category]}</h1>
      <ul className="space-y-3">
        {articles.map((a) => (
          <li key={a.slug}>
            <button onClick={() => onOpenArticle(a.slug)} className="text-left w-full panel p-4 hover:bg-base-800/60 transition-colors">
              <div className="font-medium text-ink-100 text-sm">{a.title}</div>
              <div className="text-xs text-ink-500 mt-0.5">{a.summary}</div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SearchResultsPanel({
  query, results, onOpenArticle,
}: {
  query: string;
  results: ReturnType<typeof searchHelpArticles>;
  onOpenArticle: (slug: string) => void;
}) {
  if (results.length === 0) {
    return (
      <div className="panel tick-frame p-8 text-center space-y-3">
        <p className="text-sm text-ink-300">No articles matched "{query}".</p>
        <p className="text-xs text-ink-500">
          Try a shorter term, or browse a category below: {HELP_CATEGORIES.slice(0, 4).map((c) => HELP_CATEGORY_LABELS[c]).join(', ')}.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-500">{results.length} result{results.length === 1 ? '' : 's'} for "{query}"</p>
      <ul className="space-y-2">
        {results.map(({ article }) => (
          <li key={article.slug}>
            <button onClick={() => onOpenArticle(article.slug)} className="text-left w-full panel p-4 hover:bg-base-800/60 transition-colors">
              <div className="text-[10px] font-mono uppercase tracking-widest text-ink-500">{HELP_CATEGORY_LABELS[article.category]}</div>
              <div className="font-medium text-ink-100 text-sm">{article.title}</div>
              <div className="text-xs text-ink-500 mt-0.5">{article.summary}</div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
