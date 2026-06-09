/**
 * Candidate Filtering — deterministic deduplication, annotation, ranking,
 * and drop recording for search result candidates.
 *
 * The Research Orchestrator applies Candidate Filtering before the Brain
 * selects sources, so the Brain only sees filtered, annotated candidates.
 */

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * Raw candidate as received from a search seam.
 * Domain-owned type to avoid depending on I/O infrastructure module.
 */
export interface RawCandidate {
  readonly url: string;
  readonly title: string;
  readonly snippet: string;
}

export interface AnnotatedCandidate extends RawCandidate {
  /** Normalized final URL (after dedup resolution). */
  readonly canonicalUrl: string;
  /** Whether this is a primary or official source. */
  readonly isPrimary: boolean;
  /** Calculated signal score (higher = better). */
  readonly signalScore: number;
  /** Brief reason for the signal score. */
  readonly signalReason: string;
}

export interface DropRecord {
  /** The URL that was dropped. */
  readonly url: string;
  /** The title when available. */
  readonly title: string;
  /** Why it was dropped. */
  readonly reason: string;
}

export interface FilterResult {
  /** Deduplicated, annotated, ranked candidates. */
  readonly candidates: AnnotatedCandidate[];
  /** Records of material drops. */
  readonly drops: DropRecord[];
  /** Whether any candidates remain after filtering. */
  readonly hasCandidates: boolean;
}

// ── Primary source markers ─────────────────────────────────────────────────

const PRIMARY_DOMAINS: ReadonlySet<string> = new Set([
  "github.com",
  "docs.github.com",
  "gitlab.com",
  "bitbucket.org",
  "npmjs.com",
  "pypi.org",
  "crates.io",
  "rubygems.org",
  "hub.docker.com",
  "registry.npmjs.org",
]);

const OFFICIAL_HOSTNAME_PATTERNS: RegExp[] = [
  /^docs\./i,
  /^developer\./i,
];

const OFFICIAL_TITLE_INDICATORS: RegExp[] = [
  /official/i,
  /reference/i,
  /manual/i,
  /specification/i,
  /standard/i,
  /documentation/i,
];

const LOW_SIGNAL_DOMAIN_PATTERNS: RegExp[] = [
  /forum/i,
  /reddit/i,
  /stackoverflow/i,
  /quora/i,
  /medium\.com/i,
  /dev\.to/i,
  /newsletter/i,
  /spam/i,
  /advertisement/i,
];

/** Only treat as blog if it's a subdomain or path, not a substring of the domain name. */
const BLOG_PATTERN: RegExp = /(?:^|\.)blog\.|\/blog\/?/i;

/**
 * Comparison query markers — when the research question is asking "how do X
 * and Y differ" or "X vs Y", third-party comparison articles on low-signal
 * platforms are essential evidence. They should be kept (downranked) rather
 * than dropped entirely.
 */
const COMPARISON_MARKERS: RegExp[] = [
  /\bvs\b/i,
  /\bversus\b/i,
  /\bdiffer/i,
  /\bcompar/i,
  /\bcompare/i,
  /\bcontrast/i,
  /\bbetween\s.*\band\b/i,
  /\bgap\b/i,
  /\bclose the gap\b/i,
  /\bhow does.*differ/i,
  /\bhow do.*differ/i,
  /\bwhat.*need.*to adopt/i,
  /\bwhich.*better/i,
  /\bwhat.*missing/i,
];

/**
 * Detect whether a query is asking for a comparison between two or more
 * entities. When true, third-party sources on low-signal platforms are kept
 * (downranked, not dropped) because they are essential comparison evidence.
 */
function isComparisonQuery(query: string): boolean {
  return COMPARISON_MARKERS.some((m) => m.test(query));
}

// ── CandidateFilter ─────────────────────────────────────────────────────────

/**
 * Filter and rank search result candidates.
 *
 * Deterministic pipeline:
 * 1. Deduplicate by URL (normalized)
 * 2. Annotate: isPrimary, signalScore, signalReason
 * 3. Sort by signalScore descending
 * 4. Return annotated candidates + drop records
 */
export class CandidateFilter {
  private readonly query: string;
  // For URL normalization: strip trailing slash, fragment, www prefix
  private readonly seenUrls: Set<string>;

  constructor(query: string) {
    this.query = query;
    this.seenUrls = new Set();
  }

  /**
   * Run the filtering pipeline on a batch of raw search results.
   * Call this each time `options.search()` returns results.
   */
  filter(rawResults: RawCandidate[]): FilterResult {
    const drops: DropRecord[] = [];
    const candidates: AnnotatedCandidate[] = [];

    for (const result of rawResults) {
      const canonicalUrl = normalizeUrl(result.url);

      // 1. Dedup
      if (this.seenUrls.has(canonicalUrl)) {
        drops.push({
          url: result.url,
          title: result.title,
          reason: "Duplicate URL (already seen this round)",
        });
        continue;
      }
      this.seenUrls.add(canonicalUrl);

      // 2. Annotate
      const isPrimary = checkIsPrimary(result.url, result.title);

      // 3. Score
      const { signalScore, signalReason, isLowSignal } = scoreCandidate(
        result,
        this.query,
        isPrimary,
      );

      // 4. Downrank (drop only if explicitly low-signal AND not primary)
      //    Exception: comparison queries keep third-party sources because
      //    they're the only ones that actually compare the two subjects.
      if (isLowSignal && !isPrimary) {
        if (isComparisonQuery(this.query)) {
          // Keep but annotate as a comparison source on a low-signal platform
          candidates.push({
            ...result,
            canonicalUrl,
            isPrimary: false,
            signalScore,
            signalReason: `${signalReason}; Comparison source — kept for comparative question`,
          });
          continue;
        }
        drops.push({
          url: result.url,
          title: result.title,
          reason: `Low-signal source: ${signalReason}`,
        });
        continue;
      }

      candidates.push({
        ...result,
        canonicalUrl,
        isPrimary,
        signalScore,
        signalReason,
      });
    }

    // 5. Sort by signalScore descending
    candidates.sort((a, b) => b.signalScore - a.signalScore);

    return {
      candidates,
      drops,
      hasCandidates: candidates.length > 0,
    };
  }
}

// ── URL normalization ──────────────────────────────────────────────────────

/** Normalize a URL for deduplication (trailing slash, fragment, www). */
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    // Remove fragment
    u.hash = "";
    // Remove trailing slash from path
    if (u.pathname.endsWith("/") && u.pathname.length > 1) {
      u.pathname = u.pathname.slice(0, -1);
    }
    // Normalize www prefix
    if (u.hostname.startsWith("www.")) {
      u.hostname = u.hostname.slice(4);
    }
    // Lowercase hostname
    u.hostname = u.hostname.toLowerCase();
    return u.toString();
  } catch {
    // If URL parsing fails, use the raw string
    return url;
  }
}

// ── Annotation helpers ─────────────────────────────────────────────────────

/** Check if a URL is a primary or official source. */
function checkIsPrimary(url: string, title: string): boolean {
  try {
    const u = new URL(url);
    const hostname = u.hostname.replace(/^www\./, "").toLowerCase();

    if (PRIMARY_DOMAINS.has(hostname)) return true;

    // Check hostname against prefix patterns (e.g. docs.example.com)
    for (const pattern of OFFICIAL_HOSTNAME_PATTERNS) {
      if (pattern.test(hostname)) return true;
    }

    // Check against path patterns (e.g. example.com/docs/)
    if (/\/docs\//i.test(url) || /\/documentation\//i.test(url)) return true;

    // Check title against text indicators
    for (const pattern of OFFICIAL_TITLE_INDICATORS) {
      if (pattern.test(title)) return true;
    }
  } catch {
    // If URL is invalid, not primary
  }

  return false;
}

/** Score a candidate's signal value and determine if it's low-signal. */
function scoreCandidate(
  result: RawCandidate,
  query: string,
  isPrimary: boolean,
): { signalScore: number; signalReason: string; isLowSignal: boolean } {
  let score = 50; // baseline
  const reasons: string[] = [];

  // Primary/official boost
  if (isPrimary) {
    score += 30;
    reasons.push("Primary/official source");
  }

  // Title relevance — check if query terms appear in title
  const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const titleLower = result.title.toLowerCase();
  const titleMatches = queryWords.filter((w) => titleLower.includes(w)).length;
  if (titleMatches >= queryWords.length * 0.5) {
    score += 15;
    reasons.push("Title matches query");
  }

  // Snippet depth
  const snippetLen = (result.snippet ?? "").length;
  if (snippetLen > 200) {
    score += 10;
    reasons.push("Rich snippet");
  } else if (snippetLen < 50) {
    score -= 10;
    reasons.push("Thin snippet");
  }

  // Low-signal penalty
  const isLowSignal = checkLowSignal(result.url, isPrimary);
  if (isLowSignal) {
    score -= 25;
    reasons.push("Low-signal platform");
  }

  // Clamp to 0-100
  score = Math.max(0, Math.min(100, score));

  return {
    signalScore: score,
    signalReason: reasons.join("; ") || "Baseline",
    isLowSignal,
  };
}

/** Check if a URL is from a low-signal platform. */
function checkLowSignal(url: string, isPrimary: boolean): boolean {
  if (isPrimary) return false;
  for (const pattern of LOW_SIGNAL_DOMAIN_PATTERNS) {
    if (pattern.test(url)) return true;
  }
  if (BLOG_PATTERN.test(url)) return true;
  return false;
}