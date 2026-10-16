import { Injectable } from '@nestjs/common';

export interface DomainGuardResult {
  inDomain: boolean;
  reason: string;
  // Only meaningful when inDomain is true. 'strong' = matched a word
  // specific enough to this platform that AiService trusts it immediately,
  // no extra check. 'weak' = matched a word that's common enough in
  // ordinary English that AiService should get a second opinion from
  // classifyRequest() before actually answering (see AiService.ask()) --
  // see this file's own header comment for why presence-of-word alone
  // isn't a strong enough signal for every pattern in the list below.
  strength?: 'strong' | 'weak';
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
//
// Verified gap (owner request, "make sure users won't use the AI assistant
// beyond the platform"): a single-keyword-presence regex is bypassable by
// any sufficiently generic English word that also happens to appear in
// construction vocabulary -- "Explain the theory of relativity", "What
// level is this video game on?", "Who was the designer of the iPhone?" all
// used to pass as in-domain. Two changes close this:
//   1. The clearest offenders (bare verbs/adjectives with no construction
//      noun attached -- explain/status/summarize/critical/open/closed/
//      trend/draft/assigned) are removed outright: every existing "must
//      stay allowed" test case already also contains a genuine
//      construction noun, so removing these costs zero legitimate recall.
//   2. The remaining patterns are split into STRONG (jargon that's
//      essentially never used outside this domain -- skip the extra
//      check, keep the common case free) and WEAK (a real construction
//      term, but also common enough in general English -- "building",
//      "level", "zone", "designer" -- that AiService runs one extra
//      classifyRequest() call before trusting it). This isn't a rebuild:
//      classifyRequest() was already implemented on every provider and
//      already had its own passing tests -- it just was never called.
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
  /\bwho is\b/i, /\bwho (built|made) (the|this famous|that famous)\b/i,
  /\bwhat is the capital\b/i, /\bcapital of\b/i,
  /\bsports? (score|game|team)\b/i, /\bfootball\b/i, /\bbasketball\b/i,
  /\bvideo ?game\b/i, /\balgorithm\b/i,
];

// Jargon essentially unique to this platform/domain -- the common case,
// kept free of the extra classifyRequest() round trip.
const STRONG_IN_DOMAIN_PATTERNS: RegExp[] = [
  /\bproject(s)?\b/i, /\brfi(s)?\b/i, /\bissue(s)?\b/i, /\bsnag(ging|s)?\b/i,
  /\brisk(s)?\b/i, /\bprogress\b/i, /\breport(s)?\b/i,
  /\bbim\b/i, /\bsubmittal(s)?\b/i, /\btransmittal(s)?\b/i,
  /\b(qa|quality assurance)\b/i, /\binspection(s)?\b/i, /\bncr(s)?\b/i,
  /\boverdue\b/i, /\bconstruction\b/i, /\bworksite\b/i,
];

// A real construction term, but common enough in everyday English that
// presence alone isn't trusted -- AiService runs classifyRequest() before
// treating a match here as in-domain.
const WEAK_IN_DOMAIN_PATTERNS: RegExp[] = [
  /\bdocument(s)?\b/i, /\bcapture(s)?\b/i, /\bdrawing(s)?\b/i,
  /\bdeadline(s)?\b/i, /\bdiscipline\b/i,
  /\bzone\b/i, /\bbuilding\b/i, /\blevel\b/i, /\blocation\b/i, /\belement\b/i,
  /\bcontractor\b/i, /\bconsultant\b/i, /\bdesigner\b/i,
  /\bpriority\b/i, /\bengineer(ing)?\b/i, /\bsite\b/i,
];

@Injectable()
export class DomainGuardService {
  evaluate(question: string): DomainGuardResult {
    const trimmed = question.trim();
    if (!trimmed) return { inDomain: false, reason: 'empty_question' };

    for (const pattern of OFF_TOPIC_PATTERNS) {
      if (pattern.test(trimmed)) return { inDomain: false, reason: `off_topic_match:${pattern.source}` };
    }
    for (const pattern of STRONG_IN_DOMAIN_PATTERNS) {
      if (pattern.test(trimmed)) return { inDomain: true, reason: `in_domain_match:${pattern.source}`, strength: 'strong' };
    }
    for (const pattern of WEAK_IN_DOMAIN_PATTERNS) {
      if (pattern.test(trimmed)) return { inDomain: true, reason: `in_domain_match:${pattern.source}`, strength: 'weak' };
    }
    return { inDomain: false, reason: 'no_domain_signal' };
  }

  static readonly REJECTION_MESSAGE =
    "I'm the RealityCapture Engineering Assistant. I can help with project information, RFIs, NCRs, issues, snags, risks, progress, documents and other functions available within RealityCapture.";
}
