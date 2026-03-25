/**
 * Query Relevance Validator
 *
 * Fast keyword-based pre-screening that runs BEFORE any AI call to determine
 * whether the user's natural-language query can be answered from the SAP
 * Order-to-Cash dataset.  Keeps the AI from wasting tokens on unrelated requests
 * and gives the user an immediate, explanatory error with better suggestions.
 */

export interface ValidationResult {
  valid: boolean;
  /** Human-readable explanation when the query is not applicable */
  reason?: string;
  /** Concrete example queries the user can try instead */
  suggestions?: string[];
}

// ─── O2C entity keyword map ───────────────────────────────

/**
 * Maps each SAP O2C entity to plain-English keywords a user might write.
 * If any keyword appears in the NL query, the query is considered relevant.
 */
const ENTITY_KEYWORDS: Record<string, readonly string[]> = {
  billing: [
    "bill", "billing", "invoice", "invoiced", "invoices", "billed",
    "revenue", "net amount", "total amount", "fiscal invoice", "cancell",
  ],
  sales_orders: [
    "sales order", "order", "orders", "purchase order",
    "placed order", "order value", "open order", "so ",
  ],
  sales_items: [
    "order item", "line item", "sales item", "material ordered",
    "order quantity", "ordered quantity",
  ],
  deliveries: [
    "delivery", "deliveries", "delivered", "shipment", "shipped",
    "picking", "goods movement", "outbound", "dispatch",
  ],
  payments: [
    "payment", "payments", "paid", "receivable", "accounts receivable",
    "outstanding", "overdue", "cleared", "clearing", "ar ",
    "unpaid", "due", "collected",
  ],
  customers: [
    "customer", "customers", "client", "clients",
    "business partner", "sold-to", "sold to party", "buyer", "buyers",
    "account", "accounts",
  ],
  products: [
    "product", "products", "material", "materials",
    "item", "items", "sku", "article", "catalog", "part",
  ],
  journal: [
    "journal", "journal entry", "accounting", "ledger",
    "gl account", "posting", "debit", "credit", "fiscal year",
  ],
  plants: [
    "plant", "plants", "factory", "production site",
    "production plant", "storage", "location",
  ],
};

/**
 * Generic analytical phrases that indicate the user wants a BI-style query,
 * even if they didn't name a specific SAP entity.  E.g. "show top 10 by total".
 */
const ANALYTICAL_KEYWORDS: readonly string[] = [
  "top", "bottom", "total", "sum", "count", "average", "avg",
  "trend", "breakdown", "distribution", "summary", "highest",
  "lowest", "most", "least", "show me", "list all", "how many",
  "what is", "which", "compare", "group by", "rank", "per month",
  "by month", "by year", "monthly", "quarterly", "yearly", "daily",
  "by status", "over time", "last year", "this year",
  "analyze", "analysis", "explore", "insight", "report",
];

/** Topics clearly outside the O2C domain */
const UNRELATED_TOPICS: ReadonlyArray<{ pattern: RegExp; topic: string }> = [
  {
    pattern:
      /\b(weather|temperature|forecast|rainfall|climate|hurricane|storm)\b/i,
    topic: "weather data",
  },
  {
    pattern:
      /\b(stock price|stock market|share price|dividend|equity|nasdaq|nyse|ticker symbol)\b/i,
    topic: "stock market data",
  },
  {
    pattern:
      /\b(employee|payroll|salary|human resources|headcount|hire|fired|vacation|leave)\b/i,
    topic: "HR / payroll data",
  },
  {
    pattern: /\b(recipe|ingredient|cooking|baking|microwave|boil|sauté|kitchen)\b/i,
    topic: "recipes / cooking",
  },
  {
    pattern:
      /\b(twitter|instagram|facebook|social media|tweet|follower|like|retweet|linkedin post)\b/i,
    topic: "social media data",
  },
  {
    pattern: /\b(poem|poetry|write a story|essay|translate this|write me a)\b/i,
    topic: "creative writing — not a data query",
  },
  {
    pattern:
      /\b(debug|fix my code|variable|function\s*\(|programming|software bug|compile error)\b/i,
    topic: "programming assistance",
  },
  {
    pattern:
      /\b(covid|vaccine|hospital|doctor|patient|medical record|disease|virus|diagnosis)\b/i,
    topic: "healthcare data",
  },
  {
    pattern:
      /\b(flight|airline|airport|departure|landing|boarding pass|ticket number)\b/i,
    topic: "airline / travel data",
  },
  {
    pattern: /\b(nfl|nba|fifa|football match|soccer score|basketball|cricket|tennis)\b/i,
    topic: "sports data",
  },
];

const DEFAULT_SUGGESTIONS: readonly string[] = [
  "Top 10 customers by billing amount",
  "Monthly revenue trend for 2025",
  "Delivery status breakdown",
  "Open vs cleared payments",
  "Top materials by order quantity",
];

// ─── Main export ─────────────────────────────────────────

/**
 * Returns a ValidationResult indicating whether the NL query is likely
 * answerable from the SAP O2C dataset.
 *
 * This is a fast pre-screen; the AI model performs the definitive interpretation.
 * Call this BEFORE invoking the AI to save tokens and give instant feedback.
 */
export function validateQueryRelevance(nlQuery: string): ValidationResult {
  const lower = nlQuery.toLowerCase().trim();

  // ── Minimum length guard ─────────────────────────────
  if (lower.length < 4) {
    return {
      valid: false,
      reason:
        "Query is too short to interpret. Please describe what data you want to explore.",
      suggestions: [...DEFAULT_SUGGESTIONS],
    };
  }

  // ── Clearly unrelated topic detection ───────────────
  for (const { pattern, topic } of UNRELATED_TOPICS) {
    if (pattern.test(lower)) {
      return {
        valid: false,
        reason: `This query appears to be about ${topic}, which is not available in the SAP Order-to-Cash dataset.`,
        suggestions: [...DEFAULT_SUGGESTIONS],
      };
    }
  }

  // ── O2C entity keyword match ─────────────────────────
  const matchedEntities = Object.entries(ENTITY_KEYWORDS).filter(
    ([, keywords]) => keywords.some((kw) => lower.includes(kw))
  );

  if (matchedEntities.length > 0) {
    return { valid: true };
  }

  // ── Generic analytical intent ────────────────────────
  const hasAnalyticalIntent = ANALYTICAL_KEYWORDS.some((kw) =>
    lower.includes(kw)
  );

  if (hasAnalyticalIntent) {
    return { valid: true };
  }

  // ── No O2C concept found ─────────────────────────────
  return {
    valid: false,
    reason:
      "Could not identify any SAP Order-to-Cash entities in your query. " +
      "The dataset covers: billing, sales orders, deliveries, payments, " +
      "customers, products, and accounting entries.",
    suggestions: [...DEFAULT_SUGGESTIONS],
  };
}
