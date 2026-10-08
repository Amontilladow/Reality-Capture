import { Injectable } from '@nestjs/common';

export interface DomainGuardResult {
  inDomain: boolean;
  reason: string;
}

// Spec section 5/6: "do not send obviously irrelevant requests to the
// paid/free AI provider" and "do not rely only on the system prompt." This
// runs as plain, synchronous, zero-cost TypeScript BEFORE any provider call
// -- no network, no tokens spent -- so a blocked question never touches
// AiUsageService's quota accounting either (see AiService.ask()).
//
// Off-topic signals are checked first and win outright: a question that
// trips one of them is blocked even if it also happens to contain an
// in-domain word (e.g. "tell me a joke about RFIs" is still a joke
// request). A question matching neither list is blocked by default --
// ambiguous is the safer default for a controlled assistant, not a
// permissive one.
const OFF_TOPIC_PATTERNS: RegExp[] = [
  /\bjoke\b/i, /\bpoem\b/i, /\blyrics?\b/i, /\briddle\b/i, /\btrivia\b/i,
  /\bhoroscope\b/i, /\bdating (message|profile|bio)\b/i, /\bpickup line\b/i,
  /\brecipe\b/i, /\bcook(ing)?\b/i,
  /\bweather\b/i, /\bforecast\b/i,
  /\bbitcoin\b/i, /\bcrypto(currency)?\b/i, /\bstock (price|market)\b/i,
  /\bpresident\b/i, /\bprime minister\b/i, /\belection\b/i, /\bpolitic(s|al)\b/i,
  /\bcelebrit(y|ies)\b/i, /\bmovie\b/i, /\btv show\b/i, /\bcelebrity\b/i,
  /\bwrite (a |an )?(python|javascript|java|c\+\+|code|program|script|function)\b/i,
  /\btranslate\b/i, /\bhow (do|does) .* work\b/i,
  /\bwho is\b/i, /\bwhat is the capital\b/i, /\bcapital of\b/i,
  /\bsports? (score|game|team)\b/i, /\bfootball\b/i, /\bbasketball\b/i,
];

const IN_DOMAIN_PATTERNS: RegExp[] = [
  /\bproject(s)?\b/i, /\brfi(s)?\b/i, /\bissue(s)?\b/i, /\bsnag(ging|s)?\b/i,
  /\brisk(s)?\b/i, /\bprogress\b/i, /\breport(s)?\b/i, /\bdocument(s)?\b/i,
  /\bcapture(s)?\b/i, /\bbim\b/i, /\bsubmittal(s)?\b/i, /\btransmittal(s)?\b/i,
  /\b(qa|quality assurance)\b/i, /\binspection(s)?\b/i, /\bdrawing(s)?\b/i,
  /\bdeadline(s)?\b/i, /\boverdue\b/i, /\bassign(ed|ment)?\b/i, /\bdiscipline\b/i,
  /\bzone\b/i, /\bbuilding\b/i, /\blevel\b/i, /\blocation\b/i, /\belement\b/i,
  /\bcontractor\b/i, /\bconsultant\b/i, /\bdesigner\b/i,
  /\bsummar(y|ize|ise)\b/i, /\bdraft\b/i, /\bexplain\b/i, /\bstatus\b/i,
  /\bpriority\b/i, /\bcritical\b/i, /\btrend\b/i, /\bclose(d)?\b/i, /\bopen\b/i,
  /\bconstruction\b/i, /\bengineer(ing)?\b/i, /\bsite\b/i, /\bworksite\b/i,
];

@Injectable()
export class DomainGuardService {
  evaluate(question: string): DomainGuardResult {
    const trimmed = question.trim();
    if (!trimmed) return { inDomain: false, reason: 'empty_question' };

    for (const pattern of OFF_TOPIC_PATTERNS) {
      if (pattern.test(trimmed)) return { inDomain: false, reason: `off_topic_match:${pattern.source}` };
    }
    for (const pattern of IN_DOMAIN_PATTERNS) {
      if (pattern.test(trimmed)) return { inDomain: true, reason: `in_domain_match:${pattern.source}` };
    }
    return { inDomain: false, reason: 'no_domain_signal' };
  }

  static readonly REJECTION_MESSAGE =
    "I'm the RealityCapture Engineering Assistant. I can help with project information, RFIs, issues, snags, risks, progress, documents and other functions available within RealityCapture.";
}
