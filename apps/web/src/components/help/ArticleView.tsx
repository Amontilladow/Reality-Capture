import type { ReactNode } from 'react';
import { Alert } from '../ui/Alert';
import type { HelpArticle } from '../../content/help';
import { getRelatedArticles } from '../../content/help';
import { slugifySectionTitle } from './article-sections';

// Renders the brief's 16-field article template -- but only the fields a
// given article actually has.
export function ArticleView({ article, onOpenArticle }: { article: HelpArticle; onOpenArticle: (slug: string) => void }) {
  const related = getRelatedArticles(article);

  return (
    <article className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold text-ink-100">{article.title}</h1>
        <p className="text-sm text-ink-300 mt-1">{article.summary}</p>
      </header>

      {article.notYetAvailable && (
        <Alert tone="warning" title="Not yet available">
          This capability is planned but not yet available in EngineeringOS.
        </Alert>
      )}

      {article.whatItDoes && (
        <Section title="What this feature does"><p>{article.whatItDoes}</p></Section>
      )}
      {article.whenToUse && (
        <Section title="When to use it"><p>{article.whenToUse}</p></Section>
      )}
      {article.whoCanUse && (
        <Section title="Who can use it"><p>{article.whoCanUse}</p></Section>
      )}
      {article.requiredPermissions && (
        <Section title="Required permissions"><p>{article.requiredPermissions}</p></Section>
      )}
      {article.prerequisites && article.prerequisites.length > 0 && (
        <Section title="Prerequisites">
          <ul className="list-disc pl-5 space-y-1">{article.prerequisites.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </Section>
      )}
      {article.steps && article.steps.length > 0 && (
        <Section title="Step-by-step instructions">
          <ol className="list-decimal pl-5 space-y-1">{article.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        </Section>
      )}
      {article.infoToEnter && article.infoToEnter.length > 0 && (
        <Section title="Information you must enter">
          <ul className="list-disc pl-5 space-y-1">{article.infoToEnter.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </Section>
      )}
      {article.attachments && (
        <Section title="Attachments or supporting documents"><p>{article.attachments}</p></Section>
      )}
      {article.afterSubmission && (
        <Section title="What happens after submission"><p>{article.afterSubmission}</p></Section>
      )}
      {article.whoIsNotified && (
        <Section title="Who is notified"><p>{article.whoIsNotified}</p></Section>
      )}
      {article.reviewEditApproveClose && (
        <Section title="Who can review, edit, approve, or close the record"><p>{article.reviewEditApproveClose}</p></Section>
      )}
      {article.howToTrackProgress && (
        <Section title="How to track progress"><p>{article.howToTrackProgress}</p></Section>
      )}
      {article.commonMistakes && article.commonMistakes.length > 0 && (
        <Section title="Common mistakes">
          <ul className="list-disc pl-5 space-y-1">{article.commonMistakes.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </Section>
      )}
      {article.troubleshootingSteps && article.troubleshootingSteps.length > 0 && (
        <Section title="Troubleshooting">
          <div className="space-y-3">
            {article.troubleshootingSteps.map((t, i) => (
              <div key={i} className="panel p-3">
                <div className="font-medium text-ink-100 text-sm">{t.problem}</div>
                {t.likelyCause && <div className="text-xs text-ink-500 mt-0.5">Likely cause: {t.likelyCause}</div>}
                <div className="text-sm text-ink-300 mt-1">{t.fix}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {related.length > 0 && (
        <Section title="Related articles">
          <ul className="space-y-1">
            {related.map((r) => (
              <li key={r.slug}>
                <button onClick={() => onOpenArticle(r.slug)} className="text-blueprint hover:text-blueprint-hover text-sm underline">
                  {r.title}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </article>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section id={slugifySectionTitle(title)}>
      <h2 className="text-xs font-mono uppercase tracking-widest text-ink-500 mb-1.5">{title}</h2>
      <div className="text-sm text-ink-300 leading-relaxed">{children}</div>
    </section>
  );
}
