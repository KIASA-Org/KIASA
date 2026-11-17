import { plainText } from "../jobs/links";
import type { Profile } from "./schema";

/**
 * KIASA's résumé match score: how well a tailored résumé covers a job's
 * description, 0 to 100, as an applicant tracking system's keyword scan sees
 * it. A résumé below PASS_SCORE is not sent.
 *
 * The same résumé and description always give the same score. The description
 * is split into its sections: benefits, pay, equal-opportunity text and "about
 * the company" are left out; what is under a "preferred" or "nice to have"
 * heading (or a line saying "a plus") counts as preferred, and the rest as
 * required. In what is kept, the skills, tools and practices it names are found
 * from a list of known ones (with their other spellings), and so are product
 * names it repeats (HorizonDB twice). Each weighs 3 when required, 1 when
 * preferred, one more when the description says it three times or more. The
 * job's title is a tenth of the score: its words in the résumé's headline.
 */
export const PASS_SCORE = 96;
/** Fix rounds after the tailoring answer, for a résumé under PASS_SCORE:
 * ChatGPT is asked to add what it lacks; still under it after the last, it is
 * rejected (not kept, no PDF). */
export const FIX_ROUNDS = 2;

export type ScoreLevel = "required" | "preferred";
export interface ScoredTerm {
  /** As shown, and as asked for: "Kubernetes", "CI/CD". */
  term: string;
  level: ScoreLevel;
  weight: number;
  /** How many times the description says it. */
  mentions: number;
  found: boolean;
}
export interface ResumeScore {
  /** 0 to 100, rounded down: 95.9 is 95. */
  score: number;
  needed: number;
  pass: boolean;
  required: { found: number; total: number };
  preferred: { found: number; total: number };
  /** The job's title, and the words of it the résumé's headline lacks. */
  title: { wanted: string; missing: string[] };
  missing: { required: string[]; preferred: string[] };
  /** Fewer than three keywords in the description: the score says little. */
  thin: boolean;
}
export interface ScoreDetail extends ResumeScore {
  terms: ScoredTerm[];
}

/** A known keyword: how it is shown, then its other spellings (lower case,
 * matched whole). `exact`: case-sensitive patterns, for names that are also
 * plain words ("Go", "Spark", "Swift"). */
type Known = { term: string; also?: string[]; exact?: RegExp };

const KNOWN: Known[] = [
  // Languages
  { term: "Python" }, { term: "Java" }, { term: "JavaScript", also: ["ecmascript", "es6"], exact: /\bJS\b/ },
  { term: "TypeScript" }, { term: "C++", also: ["cpp"] }, { term: "C#", also: ["c sharp", "csharp"] },
  { term: "C", exact: /(?<![\w+#./-])(?<!Series )C(?![\w+#]|-(?:level|suite)|\/C\+\+)/ },
  { term: "Go", also: ["golang"], exact: /\bGo(?![\w-])/ }, { term: "Rust" }, { term: "Ruby" },
  { term: "Ruby on Rails", also: ["ror"], exact: /\bRails\b/ }, { term: "PHP" }, { term: "Scala" }, { term: "Kotlin" },
  { term: "Swift", exact: /\bSwift(?:UI)?\b/ }, { term: "Objective-C", also: ["objective c", "objc"] },
  { term: "Elixir" }, { term: "Erlang" }, { term: "Haskell" }, { term: "Clojure" }, { term: "Perl" },
  { term: "R", exact: /(?<![\w&/-])R(?![\w&'’/-])/ }, { term: "MATLAB" }, { term: "Lua" }, { term: "Dart" },
  { term: "SQL" }, { term: "PL/SQL", also: ["plsql"] }, { term: "T-SQL", also: ["tsql"] }, { term: "Bash", also: ["shell scripting"] },
  { term: "PowerShell" }, { term: "Solidity" }, { term: "COBOL" }, { term: "Fortran" }, { term: "VBA" }, { term: "Groovy" },
  // The web
  { term: "React", also: ["react.js", "reactjs"] }, { term: "React Native" }, { term: "Next.js", also: ["nextjs"] },
  { term: "Angular", also: ["angularjs", "angular.js"] }, { term: "Vue.js", also: ["vue", "vuejs", "nuxt", "nuxt.js"] },
  { term: "Svelte", also: ["sveltekit"] }, { term: "Redux" }, { term: "HTML", also: ["html5"] }, { term: "CSS", also: ["css3"] },
  { term: "Sass", also: ["scss"] }, { term: "Tailwind CSS", also: ["tailwind", "tailwindcss"] }, { term: "Webpack" }, { term: "Vite" },
  { term: "jQuery" }, { term: "Node.js", also: ["nodejs", "node"] }, { term: "Express.js", also: ["expressjs"] },
  { term: "NestJS", also: ["nest.js"] }, { term: "Django" }, { term: "Flask" }, { term: "FastAPI" },
  { term: "Spring Boot", also: ["spring framework", "spring mvc"], exact: /\bSpring\b/ }, { term: "Hibernate" },
  { term: ".NET", also: [".net core", "dotnet", "asp.net", "asp.net core"] }, { term: "Laravel" }, { term: "Celery" },
  { term: "GraphQL" }, { term: "gRPC" }, { term: "Protocol Buffers", also: ["protobuf", "protobufs"] },
  { term: "REST APIs", also: ["rest api", "restful", "restful api", "restful services", "rest services", "rest"] },
  { term: "WebSockets", also: ["websocket"] }, { term: "OAuth", also: ["oauth2", "oauth 2.0", "openid connect", "oidc"] },
  { term: "SSO", also: ["single sign on"] }, { term: "SAML" }, { term: "JWT" },
  { term: "Accessibility", also: ["wcag", "a11y"] }, { term: "Responsive design" },
  // Mobile
  { term: "iOS" }, { term: "Android" }, { term: "Flutter" }, { term: "Xamarin" }, { term: "Jetpack Compose" },
  // Data stores
  { term: "PostgreSQL", also: ["postgres"] }, { term: "MySQL" }, { term: "SQL Server", also: ["mssql", "ms sql"] },
  { term: "Oracle", exact: /\bOracle\b/ }, { term: "MongoDB", also: ["mongo"] }, { term: "DynamoDB" }, { term: "Cassandra" },
  { term: "Redis" }, { term: "Memcached" }, { term: "Elasticsearch", also: ["elastic search", "elk", "elk stack"] }, { term: "OpenSearch" },
  { term: "Neo4j" }, { term: "SQLite" }, { term: "MariaDB" }, { term: "CockroachDB" }, { term: "ClickHouse" }, { term: "RocksDB" },
  { term: "Snowflake", exact: /\bSnowflake\b/ }, { term: "BigQuery" }, { term: "Redshift" }, { term: "Databricks" },
  { term: "NoSQL" }, { term: "Vector databases", also: ["vector database", "vector db", "pinecone", "pgvector", "weaviate", "milvus"] },
  // Data and ML
  { term: "Apache Spark", also: ["pyspark", "spark sql"], exact: /\bSpark\b/ }, { term: "Hadoop" }, { term: "Hive", exact: /\bHive\b/ },
  { term: "Apache Flink", also: ["flink"] }, { term: "Kafka", also: ["apache kafka"] }, { term: "RabbitMQ" }, { term: "ActiveMQ" },
  { term: "Airflow", also: ["apache airflow"] }, { term: "dbt", exact: /\bdbt\b/ }, { term: "Pandas" }, { term: "NumPy" },
  { term: "scikit-learn", also: ["sklearn", "scikit learn"] }, { term: "TensorFlow" }, { term: "PyTorch" }, { term: "Keras" },
  { term: "Hugging Face", also: ["huggingface"] }, { term: "LangChain" }, { term: "LlamaIndex" }, { term: "MLflow" }, { term: "Kubeflow" },
  { term: "Jupyter" }, { term: "MLOps" }, { term: "ETL", also: ["elt", "etl pipelines"] },
  { term: "Data pipelines", also: ["data pipeline"] }, { term: "Data modeling", also: ["data modelling"] },
  { term: "Data warehousing", also: ["data warehouse"] }, { term: "Data lake", also: ["data lakehouse", "lakehouse"] },
  { term: "Big data" }, { term: "Stream processing", also: ["streaming data", "real-time streaming", "event streaming"] },
  { term: "Machine learning", exact: /\bML\b/ }, { term: "Deep learning" },
  { term: "NLP", also: ["natural language processing"] }, { term: "Computer vision" },
  { term: "LLMs", also: ["llm", "large language model", "large language models"] },
  { term: "Generative AI", also: ["genai", "gen ai"] }, { term: "RAG", also: ["retrieval augmented generation", "retrieval-augmented generation"] },
  { term: "Prompt engineering" }, { term: "AI", exact: /\bAI\b/ }, { term: "Recommendation systems", also: ["recommender systems", "recommendation system"] },
  { term: "A/B testing", also: ["ab testing", "experimentation platform"] }, { term: "Statistics", also: ["statistical analysis", "statistical modeling"] },
  { term: "Tableau" }, { term: "Power BI", also: ["powerbi"] }, { term: "Looker" }, { term: "Excel", exact: /\bExcel\b/ },
  // Cloud
  { term: "AWS", also: ["amazon web services"] }, { term: "Azure", also: ["microsoft azure"] },
  { term: "GCP", also: ["google cloud", "google cloud platform"] }, { term: "EC2" }, { term: "S3" },
  { term: "AWS Lambda", exact: /\bLambda\b/ }, { term: "ECS" }, { term: "EKS" }, { term: "RDS" }, { term: "Aurora", exact: /\bAurora\b/ },
  { term: "CloudFormation" }, { term: "CloudWatch" }, { term: "IAM" }, { term: "API Gateway" }, { term: "Step Functions" },
  { term: "SQS" }, { term: "SNS" }, { term: "Kinesis" }, { term: "Athena", exact: /\bAthena\b/ }, { term: "AWS Glue", exact: /\bGlue\b/ },
  { term: "EMR" }, { term: "SageMaker" }, { term: "Bedrock", exact: /\bBedrock\b/ }, { term: "Vertex AI" }, { term: "Pub/Sub", also: ["pubsub"] },
  { term: "AKS" }, { term: "GKE" }, { term: "Cloud Run" }, { term: "Azure Functions" }, { term: "Azure DevOps" },
  { term: "Serverless" }, { term: "Cloud-native", also: ["cloud native"] }, { term: "Multi-cloud", also: ["multi cloud", "hybrid cloud"] },
  // Infrastructure and delivery
  { term: "Docker", also: ["containers", "containerization"] }, { term: "Kubernetes", also: ["k8s"] }, { term: "Helm" },
  { term: "Terraform" }, { term: "Ansible" }, { term: "Pulumi" }, { term: "Chef", exact: /\bChef\b/ }, { term: "Puppet", exact: /\bPuppet\b/ },
  { term: "Jenkins" }, { term: "GitHub Actions" }, { term: "GitLab CI", also: ["gitlab ci/cd", "gitlab"] }, { term: "CircleCI" },
  { term: "Argo CD", also: ["argocd", "argo"] }, { term: "Spinnaker" }, { term: "Git" }, { term: "Nginx" }, { term: "Istio" },
  { term: "Envoy", exact: /\bEnvoy\b/ }, { term: "Service mesh" }, { term: "HashiCorp Vault", exact: /\bVault\b/ },
  { term: "CI/CD", also: ["ci cd", "cicd", "continuous integration", "continuous delivery", "continuous deployment"] },
  { term: "Infrastructure as code", also: ["iac"] }, { term: "GitOps" }, { term: "DevOps" }, { term: "DevSecOps" },
  { term: "SRE", also: ["site reliability", "site reliability engineering"] }, { term: "Linux" }, { term: "Unix" },
  { term: "Windows Server" }, { term: "Networking", also: ["tcp/ip", "tcp ip"] }, { term: "DNS" }, { term: "HTTP", also: ["http/2", "https"] },
  { term: "Load balancing", also: ["load balancer", "load balancers"] }, { term: "CDN", also: ["cloudfront", "content delivery network"] },
  // Observability
  { term: "Observability" }, { term: "Monitoring", also: ["alerting"] }, { term: "Datadog" }, { term: "Splunk" }, { term: "Grafana" },
  { term: "Prometheus" }, { term: "New Relic" }, { term: "OpenTelemetry", also: ["otel"] }, { term: "PagerDuty" }, { term: "Sentry" },
  { term: "On-call", also: ["on call", "incident response", "incident management"] },
  // Architecture and practice
  { term: "Microservices", also: ["microservice", "micro services", "service oriented architecture", "soa"] },
  { term: "Distributed systems", also: ["distributed system", "distributed computing"] },
  { term: "Event-driven architecture", also: ["event driven", "event-driven", "event sourcing", "cqrs"] },
  { term: "System design", also: ["systems design", "software architecture", "solution architecture"] },
  { term: "API design", also: ["api development"] }, { term: "Scalability", also: ["scalable", "high scale", "at scale"] },
  { term: "High availability", also: ["fault tolerance", "fault tolerant", "resilience"] },
  { term: "Performance optimization", also: ["performance tuning", "latency optimization"] },
  { term: "Caching" }, { term: "Concurrency", also: ["multithreading", "multi-threading", "multithreaded", "parallel processing"] },
  { term: "Data structures" }, { term: "Algorithms" }, { term: "Object-oriented programming", also: ["object oriented", "oop", "ood"] },
  { term: "Functional programming" }, { term: "Design patterns" }, { term: "Domain-driven design", also: ["domain driven design", "ddd"] },
  { term: "Test-driven development", also: ["tdd", "test driven"] }, { term: "Unit testing", also: ["unit tests", "unit test"] },
  { term: "Integration testing", also: ["integration tests"] }, { term: "End-to-end testing", also: ["e2e testing", "e2e tests"] },
  { term: "Automated testing", also: ["test automation"] }, { term: "Jest" }, { term: "Cypress" }, { term: "Playwright" },
  { term: "Selenium" }, { term: "JUnit" }, { term: "pytest" }, { term: "Mocha" }, { term: "Code review", also: ["code reviews"] },
  { term: "Agile" }, { term: "Scrum" }, { term: "Kanban" }, { term: "Jira" },
  { term: "Mentoring", also: ["mentorship", "mentor engineers", "mentoring engineers"] },
  { term: "Technical leadership", also: ["tech lead", "technical lead"] },
  // Security and compliance
  { term: "Application security", also: ["appsec", "secure coding", "owasp"] }, { term: "Encryption" },
  { term: "SOC 2", also: ["soc2"] }, { term: "PCI DSS", also: ["pci", "pci-dss"] }, { term: "HIPAA" }, { term: "GDPR" },
  { term: "FedRAMP" }, { term: "Zero trust" },
  // Domains
  { term: "Payments", also: ["payment processing", "payment systems"] }, { term: "Fintech" }, { term: "E-commerce", also: ["ecommerce"] },
  { term: "Healthcare" }, { term: "Ad tech", also: ["adtech", "advertising technology"] }, { term: "Geospatial", also: ["gis"] },
  { term: "Geocoding" }, { term: "Fraud detection" }, { term: "Search relevance", also: ["search ranking", "information retrieval", "search engine", "search infrastructure"] },
  { term: "Embedded systems", also: ["embedded software", "firmware"] }, { term: "IoT", also: ["internet of things"] }, { term: "SaaS" }, { term: "B2B" },
];

/** Product names found by their shape (HorizonDB, OpenSearch) that are not keywords. */
const NOT_KEYWORDS = new Set(["linkedin", "youtube", "iphone", "ipad", "macos", "github", "glassdoor", "fortune", "wellbeing", "covid",
  "workday", "greenhouse", "lever", "ashby", "jobright", "hubspot", "paypal", "openai", "chatgpt", "bigtech", "faang"]);

/** Words of a page's text run together ("DegreePreferred"): not a product's name. */
const PAGE_WORDS = new Set(["degree", "preferred", "required", "education", "bachelor", "bachelors", "master", "masters", "discipline", "profession",
  "travel", "less", "more", "software", "engineering", "location", "locations", "remote", "hybrid", "years", "experience", "level", "time",
  "type", "full", "work", "job", "role", "team", "skills", "qualifications", "responsibilities", "benefits", "salary", "about", "apply",
  "description", "posted", "category", "department", "employment", "schedule", "shift", "clearance", "minimum", "basic", "additional",
  "facebook", "twitter", "email", "copy", "share", "print", "save", "link", "x"]);

/** Headings whose section is left out: benefits, pay, the law's text, the company's story. */
const DROP_HEADING = /\b(benefits?|perks|compensation|salary|pay (range|transparency)|total rewards|what we offer|we offer|equal (employment )?opportunit|eeo|e-verify|accommodations?|privacy|disclaimer|diversity|inclusion|why (join|work|you'?ll love)|best place to work|life at|our (mission|values|culture|story|benefits|investors)|who we are|how to apply|application process|interview process|hiring process|recruit(ing|ers?)|location requirements?|work authori[sz]ation|physical requirements|working conditions|legal|notice)\b/i;
const PREFERRED_HEADING = /\b(preferred|nice[ -]to[ -]haves?|bonus|pluses|a plus|desired|desirable|good to have|ideal(ly)?|extra credit|not required|optional|stand out|even better|would be great)\b/i;
const PREFERRED_LINE = /\b(preferred|nice[ -]to[ -]have|(is|are|a) (big |huge |strong )?plus|bonus points?|ideally|desired|desirable|not required|optional)\b/i;
const DROP_LINE = /(equal opportunity|regardless of|without regard to|\$\s?\d|\b\d{2,3}k\b|salary|401\(?k|health insurance|dental|vision insurance|paid time off|\bpto\b|parental leave|reasonable accommodation|e-verify|visa sponsorship|pay range|base pay|stock options|equity package|^(title|company|location|posting url|job id|req(uisition)? id):)/i;
const BULLET = /^\s*(?:[•·▪◦‣∙*–—-]|\d+[.)])\s*/;
const LEVEL_WORDS = new Set(["senior", "sr", "junior", "jr", "lead", "principal", "staff", "mid", "level", "entry", "associate", "intern", "remote",
  "hybrid", "onsite", "contract", "contractor", "full", "time", "part", "temporary", "i", "ii", "iii", "iv", "v", "1", "2", "3", "4", "5",
  "the", "of", "and", "for", "with", "to", "in", "at", "a", "an", "or", "new", "us", "usa", "team"]);

const REQUIRED_WEIGHT = 3;
const PREFERRED_WEIGHT = 1;
/** The title's share of the score. */
const TITLE_SHARE = 0.1;

/** Lower case, dashes and underscores as spaces, smart quotes plain, single spaces. */
function fold(text: string): string {
  return text
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐‑‒–—−_]/g, "-")
    .replace(/ /g, " ")
    .toLowerCase()
    .replace(/(?<=[a-z0-9])-(?=[a-z0-9])/g, " ")
    .replace(/\s+/g, " ");
}
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
/** A spelling as a whole-word pattern: spaces as any space, and a plural allowed. */
function spelling(alias: string): string {
  const body = escape(fold(alias)).replace(/ /g, "\\s+");
  return /[a-z]$/.test(alias) ? `${body}(?:s|es)?` : body;
}
type Matcher = { term: string; loose: RegExp | null; exact: RegExp | null };
const MATCHERS: Matcher[] = KNOWN.map(({ term, also = [], exact }) => {
  const aliases = [term, ...also].filter(alias => !(exact && alias === term && /^[A-Za-z]{1,2}$/.test(alias)));
  // Names that are also plain words ("Go", "Spark") are only found by their exact pattern.
  const loose = aliases.filter(alias => !(exact && alias === term && exact.test(term)));
  return {
    term,
    loose: loose.length ? new RegExp(`(?<![a-z0-9+#])(?:${loose.map(spelling).join("|")})(?![a-z0-9+#])`, "g") : null,
    exact: exact ? new RegExp(exact.source, "g") : null,
  };
});
function count(matcher: Matcher, folded: string, raw: string): number {
  return (matcher.loose ? folded.match(matcher.loose)?.length ?? 0 : 0) + (matcher.exact ? raw.match(matcher.exact)?.length ?? 0 : 0);
}

type Section = { level: ScoreLevel; lines: string[] };

/** A line that is a heading: short, and ends with a colon, or reads as a title (no full stop, starts with a capital). */
function isHeading(line: string, bulleted: boolean): boolean {
  if (bulleted || line.length > 70) return false;
  if (/^#{1,6}\s/.test(line) || /^\*\*[^*]+\*\*:?$/.test(line)) return true;
  if (/:$/.test(line)) return true;
  return /^[A-Z]/.test(line) && !/[.!,;]$/.test(line) && line.split(/\s+/).length <= 8;
}

/** The description's sections that count, each required or preferred. Before
 * any heading (an introduction) counts as preferred. */
export function descriptionSections(jd: string): Section[] {
  const sections: Section[] = [];
  let current: Section | null = { level: "preferred", lines: [] };
  let afterBullet = false;
  // A description kept as the page's HTML: its text, a paragraph or point a line.
  const plain = /<\/?(p|div|li|br|span|ul|ol|b|strong|h[1-6])\b[^>]*>/i.test(jd) || jd.includes("&lt;") ? plainText(jd) : jd;
  for (const rawLine of plain.replace(/\r/g, "").split("\n")) {
    const line = rawLine.trim();
    // Empty, or a label a copied posting starts with (Title:, Company:, Location:).
    if (!line || /^(title|company|location|work model|posting url|job id|req(uisition)? id)\s*:/i.test(line)) continue;
    // A bullet alone on its line (as pages give lists): the next line is its item.
    if (/^[•·▪◦‣∙*–—-]$/.test(line)) { afterBullet = true; continue; }
    const bulleted = afterBullet || BULLET.test(line);
    afterBullet = false;
    const text = line.replace(BULLET, "").replace(/^#{1,6}\s*/, "").replace(/\*\*/g, "").trim();
    if (!text) continue;
    if (isHeading(line, bulleted)) {
      const heading = text.replace(/:$/, "");
      const about = /^about\b/i.test(heading) && !/\b(role|position|job|team|opportunity|you|this|work)\b/i.test(heading);
      if (DROP_HEADING.test(heading) || about) { current = null; continue; }
      current = { level: PREFERRED_HEADING.test(heading) ? "preferred" : "required", lines: [] };
      sections.push(current);
      // A heading can name a keyword itself ("Python & AWS").
      current.lines.push(heading);
      continue;
    }
    if (!current || DROP_LINE.test(text)) continue;
    if (!sections.includes(current)) sections.push(current);
    current.lines.push(text);
  }
  return sections;
}

/** The keywords a description asks for: known ones, and product names it repeats. */
export function descriptionKeywords(jd: string, company = ""): Omit<ScoredTerm, "found">[] {
  const found = new Map<string, { level: ScoreLevel; mentions: number }>();
  const note = (term: string, level: ScoreLevel, mentions: number) => {
    if (!mentions) return;
    const was = found.get(term);
    found.set(term, { level: was?.level === "required" || level === "required" ? "required" : "preferred", mentions: (was?.mentions ?? 0) + mentions });
  };
  const companyWords = new Set(fold(company).split(/[^a-z0-9]+/).filter(word => word.length > 2));
  const shapes = new Map<string, { term: string; level: ScoreLevel; mentions: number }>();
  for (const section of descriptionSections(jd)) {
    for (const line of section.lines) {
      const level: ScoreLevel = section.level === "required" && PREFERRED_LINE.test(line) ? "preferred" : section.level;
      const folded = fold(line);
      for (const matcher of MATCHERS) if (!companyWords.has(fold(matcher.term))) note(matcher.term, level, count(matcher, folded, line));
      // Product names by their shape: HorizonDB, MapLibre, Socket.IO.
      for (const name of line.match(/\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+\b|\b[A-Za-z][A-Za-z0-9]*\.(?:js|io|ai)\b/g) ?? []) {
        const key = fold(name);
        const parts = name.match(/[A-Z][a-z0-9]*|\.[a-z]+/g) ?? [];
        if (NOT_KEYWORDS.has(key) || [...companyWords].some(word => key.startsWith(word))) continue;
        // "PhDs", "DoD": too short to be a product; "DegreePreferred": a page's words run together.
        if ((parts[0]?.length ?? 0) < 3 || parts.some(part => PAGE_WORDS.has(part.toLowerCase().replace(/\d+$/, "")))) continue;
        if (MATCHERS.some(matcher => count(matcher, key, name) > 0)) continue;
        const was = shapes.get(key);
        shapes.set(key, { term: was?.term ?? name, level: was?.level === "required" || level === "required" ? "required" : "preferred", mentions: (was?.mentions ?? 0) + 1 });
      }
    }
  }
  // A product name said once may be the company's own story; twice, the job
  // asks for it. Found by its shape, not known, it weighs as preferred.
  const guessed = new Set<string>();
  for (const shape of shapes.values()) if (shape.mentions >= 2) { note(shape.term, shape.level, shape.mentions); guessed.add(shape.term); }
  return [...found].map(([term, { level, mentions }]) => {
    const base = level === "required" && !guessed.has(term) ? REQUIRED_WEIGHT : PREFERRED_WEIGHT;
    return { term, level, mentions, weight: base + (mentions >= 3 ? 1 : 0) };
  }).sort((a, b) => b.weight - a.weight || b.mentions - a.mentions || a.term.localeCompare(b.term));
}

/** Everything in the résumé an applicant tracking system reads. */
export function resumeText(profile: Profile): string {
  return [
    profile.info.title,
    profile.summary,
    ...profile.skills.flatMap(group => [group.category, group.skills.join(", ")]),
    ...profile.experience.flatMap(role => [role.title, ...role.descriptionLines]),
    ...profile.certifications.map(item => `${item.name} ${item.issuer}`),
    ...profile.education.map(item => `${item.degree} ${item.major}`),
  ].filter(Boolean).join("\n");
}

/** A word's plain form, for titles: "engineering" and "engineers" are "engineer". */
const stem = (word: string) => word.replace(/ing$/, "").replace(/s$/, "").replace(/er$/, "") || word;
/** The words of a job title that matter: not its level, place or kind of contract. */
export function titleWords(title: string): string[] {
  const plain = fold(title.replace(/\([^)]*\)/g, " ")).split(/[^a-z0-9+#.]+/).map(word => word.replace(/\.$/, ""));
  return [...new Set(plain.filter(word => word.length > 0 && !LEVEL_WORDS.has(word)))];
}

/** The score of a résumé for a job. */
export function scoreResume(profile: Profile, job: { title?: string | null; company?: string | null; jd: string }): ScoreDetail {
  const raw = resumeText(profile);
  const folded = fold(raw);
  const asked = descriptionKeywords(job.jd, job.company ?? "");
  const terms: ScoredTerm[] = asked.map(entry => {
    const matcher = MATCHERS.find(item => item.term === entry.term);
    const found = matcher
      ? count(matcher, folded, raw) > 0
      : new RegExp(`(?<![a-z0-9])${spelling(entry.term)}(?![a-z0-9])`).test(folded);
    return { ...entry, found };
  });

  // The title: its words in the headline (or a recent role's title).
  const wanted = titleWords(job.title ?? "");
  const said = new Set([profile.info.title, profile.experience[0]?.title ?? "", profile.experience[1]?.title ?? ""]
    .flatMap(title => titleWords(title)).map(stem));
  const titleMissing = wanted.filter(word => !said.has(stem(word)));
  const titleHit = wanted.length ? (wanted.length - titleMissing.length) / wanted.length : 1;

  const total = terms.reduce((sum, term) => sum + term.weight, 0);
  const got = terms.reduce((sum, term) => sum + (term.found ? term.weight : 0), 0);
  const keywordShare = total ? got / total : 1;
  const titleShare = wanted.length ? TITLE_SHARE : 0;
  const score = Math.floor(100 * ((1 - titleShare) * keywordShare + titleShare * titleHit) + 1e-9);

  const of = (level: ScoreLevel) => terms.filter(term => term.level === level);
  return {
    score,
    needed: PASS_SCORE,
    pass: score >= PASS_SCORE,
    required: { found: of("required").filter(term => term.found).length, total: of("required").length },
    preferred: { found: of("preferred").filter(term => term.found).length, total: of("preferred").length },
    title: { wanted: (job.title ?? "").trim(), missing: titleMissing },
    missing: { required: of("required").filter(term => !term.found).map(term => term.term), preferred: of("preferred").filter(term => !term.found).map(term => term.term) },
    thin: terms.length < 3,
    terms,
  };
}

/** The score without each keyword's detail: what is kept with a résumé's report. */
export function scoreSummary(detail: ScoreDetail): ResumeScore {
  const { terms: _terms, ...summary } = detail;
  void _terms;
  return summary;
}

/** The score in one line: "Match score 91 of 100 (needs 96). Missing: Terraform, gRPC." */
export function scoreLine(score: ResumeScore): string {
  const missing = [...score.missing.required, ...score.missing.preferred];
  return `Match score ${score.score} of 100 (needs ${score.needed}).${missing.length ? ` Missing: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? `, and ${missing.length - 8} more` : ""}.` : ""}`;
}
