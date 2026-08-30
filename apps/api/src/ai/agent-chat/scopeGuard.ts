import type { AgentProfileKey } from "./contracts.js";

export type AgentChatScopeDecision =
  | "in_scope"
  | "out_of_scope"
  | "prompt_attack"
  | "courtesy";

type ScopeGuardInput = {
  message: string;
  profileKey: AgentProfileKey;
  history?: Array<{ role: string; content: string }>;
};

const DOMAIN_PATTERNS = [
  /\b(?:btc|bitcoin|eth|ethereum|sol|solana|xrp|bnb|usdt|usdc|crypto|krypto)\b/,
  /\b(?:market|markt|markte|borse|exchange|spot|perp|perpetual|futures?)\b/,
  /\b(?:price|preis|chart|candle|kerze|timeframe|trend|bullish|bearish|volatility|volatilitat)\b/,
  /\b(?:rsi|sma|ema|atr|indicator|indikator|support|resistance|widerstand|orderbook|orderbuch|volume|volumen)\b/,
  /\b(?:funding|open interest|liquidation|margin|leverage|hebel|pnl|drawdown|exposure)\b/,
  /\b(?:market|markt|portfolio|position|trading|trade|crypto|krypto)\b.{0,60}\b(?:risk|risiko)\b/,
  /\b(?:risk|risiko)\b.{0,60}\b(?:market|markt|portfolio|position|trading|trade|crypto|krypto)\b/,
  /\b(?:position|positionen|balance|guthaben|open orders?|offene orders?|portfolio)\b/,
  /\b(?:prediction|predictions|prognose|prognosen|accuracy|genauigkeit|confidence|konfidenz)\b/,
  /\b(?:economic|economy|macro|makro|inflation|cpi|ppi|fomc|fed|ecb|ezb|interest rate|zins|arbeitsmarkt|nonfarm|nfp)\b/,
  /\b(?:news|nachrichten)\b.*\b(?:market|markt|crypto|krypto|bitcoin|ethereum)\b/,
  /\b(?:uliquid|desk|agent chat|market analyst|position copilot|ai credits?|ki credits?|subscription|abonnement|profil|skills?)\b/,
  /\b(?:what can you do|how does this work|was kannst du|wie funktioniert das hier)\b/
] as const;

const OFF_TOPIC_TASK_PATTERNS = [
  /\b(?:build|create|design|develop|make|write|help me (?:build|create|design)|bau(?:e|en)?|erstell\w*|entwickel\w*|mach\w*|hilf mir (?:beim|eine?))\b.{0,80}\b(?:website|webseite|homepage|landingpage|landing page|web app|webapp)\b/,
  /\b(?:website|webseite|homepage|landingpage|landing page|web app|webapp)\b.{0,80}\b(?:build|create|design|develop|make|write|bau(?:e|en)?|erstell\w*|entwickel\w*|programm\w*|mach\w*)\b/,
  /\b(?:react|nextjs|next js|javascript|typescript|html|css|python|java|swift|kotlin)\b.*\b(?:code|app|component|komponente|programm|script|skript)\b/,
  /\b(?:programmiere|programmieren|code schreiben|write code|build an app|build a site|create an app|erstelle eine app)\b/,
  /\b(?:email|e mail|newsletter|essay|aufsatz|gedicht|poem|song|lied|story|geschichte|homework|hausaufgabe)\b/,
  /\b(?:resume|cv|lebenslauf|cover letter|anschreiben|bewerbung)\b/,
  /\b(?:recipe|rezept|meal plan|ernahrungsplan|travel itinerary|reiseplan)\b/,
  /\b(?:logo|image|bild|social media post|marketing copy|werbetext)\b/,
  /\b(?:joke|witz|roleplay|rollenspiel)\b/,
  /\b(?:translate|ubersetze?|ubersetzung)\b.{0,80}\b(?:contract|vertrag|lease|mietvertrag|document|dokument)\b/,
  /\b(?:legal|rechtlich\w*)\b.{0,80}\b(?:contract|vertrag|lease|mietvertrag|advice|beratung|risk|risiko)\b/
] as const;

const PROMPT_ATTACK_PATTERNS = [
  /\bignore\b.{0,80}\b(?:previous|prior|above|system|developer)\b.{0,80}\b(?:instruction|instructions|prompt|prompts|message|messages|rules)\b/,
  /\bignoriere\b.{0,80}\b(?:vorherige|bisherige|obige|system|entwickler)\b.{0,80}\b(?:anweisung|anweisungen|instruktion|instruktionen|regeln|prompt)\b/,
  /\b(?:reveal|show|print|repeat|display|zeige|verrate|wiederhole)\b.{0,80}\b(?:system prompt|developer message|hidden instructions|systemprompt|entwicklernachricht|interne anweisungen)\b/,
  /\b(?:jailbreak|developer mode|entwicklermodus|dan mode)\b/,
  /\b(?:bypass|umgehe)\b.{0,80}\b(?:guardrail|guardrails|rule|rules|policy|policies|regeln|richtlinie|richtlinien)\b/,
  /\b(?:disregard|forget|override|missachte|vergiss|uberschreibe)\b.{0,80}\b(?:prior|previous|above|all|system|developer|vorherige|bisherige|obige|alle|system|entwickler)\b.{0,80}\b(?:instruction|instructions|prompt|prompts|rule|rules|anweisung|anweisungen|regeln|prompt)\b/,
  /\b(?:call|invoke|execute|rufe|starte)\b.{0,60}\b(?:place order|place_order|close position|close_position|transfer funds|system tool|internes tool)\b/
] as const;

const COMPACT_PROMPT_ATTACKS = [
  "ignorepreviousinstructions",
  "ignoresysteminstructions",
  "ignorierevorherigeanweisungen",
  "ignorierealleanweisungen",
  "revealsystemprompt",
  "zeigesystemprompt",
  "developer mode",
  "entwicklermodus"
] as const;

const COURTESY_PATTERN = /^(?:thanks?|thank you|danke|vielen dank|super|perfekt|okay?|alles klar|verstanden)[.! ]*$/;
const FOLLOW_UP_PATTERN = /^(?:why|why not|how so|explain(?: that)?|more details?|what next|what about that|warum|wieso|weshalb|erklare? das|mehr details?|und jetzt|was bedeutet das|wie kommst du darauf)[?!. ]*$/;
const EXTENDED_FOLLOW_UP_PATTERN = /^(?:could you |can you |please |bitte )?(?:explain|clarify|elaborate|summarize|compare|erklare?|erlautere?|fasse zusammen|vergleiche)\b.{0,100}\b(?:that|this|it|das|dies|es)\b|^(?:what|which|wie|welche)\b.{0,100}\b(?:assumption|assumptions|annahme|annahmen)\b/;

const COMMON_CONFUSABLES: Record<string, string> = {
  "а": "a", "е": "e", "і": "i", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x"
};

function normalize(value: string): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .toLowerCase()
    .replace(/[аеіорсух]/g, (character) => COMMON_CONFUSABLES[character] ?? character)
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value: string): string {
  return value.replace(/[^a-z0-9]/g, "");
}

function matchesAny(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function hasMarketPair(value: string): boolean {
  return /\b[a-z0-9]{2,12}(?:usdt|usdc|usd|eur|btc|eth)\b/.test(value.replace(/[\/_-]/g, ""));
}

function hasDomainSignal(value: string): boolean {
  return hasMarketPair(value) || matchesAny(value, DOMAIN_PATTERNS);
}

function hasPromptAttack(value: string): boolean {
  if (matchesAny(value, PROMPT_ATTACK_PATTERNS)) return true;
  const compactValue = compact(value);
  return COMPACT_PROMPT_ATTACKS.some((phrase) => compactValue.includes(compact(phrase)));
}

export function classifyAgentChatScope(input: ScopeGuardInput): AgentChatScopeDecision {
  const message = normalize(input.message);
  if (hasPromptAttack(message)) return "prompt_attack";
  if (matchesAny(message, OFF_TOPIC_TASK_PATTERNS)) return "out_of_scope";
  if (hasDomainSignal(message)) return "in_scope";
  if (COURTESY_PATTERN.test(message)) return "courtesy";

  const recentHistory = (input.history ?? [])
    .slice(-6)
    .filter((row) => row.role === "user" || row.role === "assistant")
    .map((row) => normalize(row.content));
  if (
    message.length <= 160
    && (FOLLOW_UP_PATTERN.test(message) || EXTENDED_FOLLOW_UP_PATTERN.test(message))
    && recentHistory.some(hasDomainSignal)
  ) {
    return "in_scope";
  }

  return "out_of_scope";
}

export function filterAgentChatModelHistory(
  history: Array<{ role: string; content: string }>,
  profileKey: AgentProfileKey
): Array<{ role: string; content: string }> {
  const accepted: Array<{ role: string; content: string }> = [];
  let skipGuardResponse = false;
  for (const row of history) {
    if (row.role === "user") {
      const decision = classifyAgentChatScope({ message: row.content, profileKey, history: accepted });
      if (decision !== "in_scope") {
        skipGuardResponse = true;
        continue;
      }
      skipGuardResponse = false;
      accepted.push(row);
      continue;
    }
    if (row.role === "assistant" && skipGuardResponse) {
      skipGuardResponse = false;
      continue;
    }
    accepted.push(row);
  }
  return accepted;
}

export function buildAgentChatScopeResponse(params: {
  decision: Exclude<AgentChatScopeDecision, "in_scope">;
  locale: "de" | "en";
  profileKey: AgentProfileKey;
}): string {
  if (params.decision === "courtesy") {
    return params.locale === "de"
      ? "Gern. Frag mich jederzeit zu Märkten, Predictions, Wirtschaftsterminen oder – im Position Copilot – zu deinen Positionen."
      : "You are welcome. Ask me anytime about markets, predictions, economic events or, in Position Copilot, your positions.";
  }
  if (params.locale === "de") {
    return params.profileKey === "position_copilot"
      ? "Ich bin der uLiquid Position Copilot und helfe ausschließlich bei deinen Positionen, Portfoliorisiken und zugehörigen Marktdaten."
      : "Ich bin der uLiquid Market Analyst und helfe ausschließlich bei Märkten, Predictions, Wirtschaftsterminen und Funktionen von uLiquid Desk.";
  }
  return params.profileKey === "position_copilot"
    ? "I am the uLiquid Position Copilot and can only help with your positions, portfolio risk and related market data."
    : "I am the uLiquid Market Analyst and can only help with markets, predictions, economic events and uLiquid Desk features.";
}
