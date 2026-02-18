const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const NEWS_PROVIDER = "newsapi";
const NEWS_API_KEY = process.env.NEWS_API_KEY || "b883c299ae464705b215df75a65147c1";
const NEWS_QUERY = process.env.NEWS_QUERY || "";
const LMSTUDIO_URL = process.env.LMSTUDIO_URL || "http://127.0.0.1:1234";
const LMSTUDIO_API_KEY = process.env.LMSTUDIO_API_KEY || "";
const LM_MODEL = process.env.LM_MODEL || "qwen/qwen3-8b";
const LMSTUDIO_STREAM = process.env.LMSTUDIO_STREAM !== "false";
const PANEL_SIZE = Math.max(2, Number(process.env.PANEL_SIZE || 5));
const REBUTTAL_SIZE = Math.max(2, Number(process.env.REBUTTAL_SIZE || 3));
const COUNCIL_STATES = (
  process.env.COUNCIL_STATES ||
  "Tamil Nadu,Delhi,Kerala,Assam,Punjab,Karnataka,Maharashtra,Uttar Pradesh,West Bengal,Gujarat"
)
  .split(",")
  .map((state) => state.trim())
  .filter(Boolean);

const STATE_PROFILES = {
  "Tamil Nadu": {
    party: "DMK",
    ideology: "Dravidian, social justice, pro-industry",
    focus: "Manufacturing, IT exports, electronics",
    stance: "Manufacturing Hawk. If the news promotes industrial growth, support it, even if the Centre proposes it, but demand 'State Autonomy' in implementation."
  },
  "Delhi": {
    party: "AAP",
    ideology: "Populist, anti-corruption, welfare-focused",
    focus: "Urban governance, services sector, education, healthcare",
    stance: "Federal Power Player. Align with Punjab (same party) on federal rights. Defend urban services but prioritize stability."
  },
  "Punjab": {
    party: "AAP",
    ideology: "Agrarian populist, anti-establishment",
    focus: "Agriculture, MSP, farmer welfare",
    stance: "Agricultural Traditionalist. MUST oppose any policy that favors 'Urban-Industrial' hubs over 'Rural-Agrarian' interests. Align with Delhi (same party)."
  },
  "Kerala": {
    party: "CPI(M)-led LDF",
    ideology: "Left-progressive, workers' rights, social welfare",
    focus: "Healthcare, education, labor protection, remittances",
    stance: "Social Welfare Advocate. Skeptical of tech-driven growth that ignores labor rights. Ally with other 'Opposition' states to counter the Centre's narrative."
  },
  "Assam": {
    party: "BJP",
    ideology: "Hindu nationalist, pro-development, border security",
    focus: "Infrastructure, tea/oil industry, immigration control",
    stance: "Border Sentinel. Strongly support Central Government initiatives. Frame growth through the lens of National Security and Integration."
  },
  "Karnataka": {
    party: "Congress",
    ideology: "Centrist, welfare + tech balance",
    focus: "IT/tech industry, startups, agriculture",
    stance: "Tech Pragmatist. Support tech growth but demand rural balance. Counter BJP states on federalism issues."
  },
  "Maharashtra": {
    party: "BJP-Shiv Sena alliance",
    ideology: "Pro-business, Marathi pride, infrastructure-focused",
    focus: "Finance, Bollywood, manufacturing, ports",
    stance: "Economic Powerhouse. Frame every debate around Maharashtra's GDP contribution. Demand proportional central funding."
  },
  "Uttar Pradesh": {
    party: "BJP",
    ideology: "Hindu nationalist, populist development",
    focus: "Agriculture, MSME, infrastructure, defense corridors",
    stance: "Population Giant. Demand resources proportional to population. Support Centre aggressively. Rival Tamil Nadu and Maharashtra on industrial investment."
  },
  "West Bengal": {
    party: "TMC",
    ideology: "Regional populist, anti-BJP, welfare-focused",
    focus: "Agriculture, jute, tea, SMEs, cultural economy",
    stance: "Opposition Firebrand. Oppose every Central Government policy on principle. Demand special status and higher federal allocation."
  },
  "Gujarat": {
    party: "BJP",
    ideology: "Pro-business, free market, infrastructure-driven",
    focus: "Petrochemicals, textiles, ports, renewable energy",
    stance: "Centre's Model State. Defend all central policies. Showcase Gujarat as proof that the ruling party's model works."
  }
};

const STATIC_ROOT = __dirname;
const clients = new Set();
const recentStoryIds = [];
const RECENT_LIMIT = 50;
let latestStory = null;
let councilRunning = false;
let lastStatusMessage = "";
let lastStatusAt = 0;
const pendingStories = [];
const pendingRoundBegins = new Set();
const roundBeginWaiters = new Map();

if (typeof fetch !== "function") {
  console.error("Node 18+ is required for fetch support.");
  process.exit(1);
}

const sendEvent = (event, data) => {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach((res) => res.write(payload));
};

const safeJson = (res, status, data) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
};

const notifyStatus = (message) => {
  const now = Date.now();
  if (message === lastStatusMessage && now - lastStatusAt < 60000) {
    return;
  }
  lastStatusMessage = message;
  lastStatusAt = now;
  sendEvent("status", { message });
};

const normalizeRoundNumber = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.trunc(parsed);
};

const waitForRoundBegin = (round) => {
  const roundId = normalizeRoundNumber(round);
  if (roundId === null) {
    return Promise.resolve();
  }
  if (pendingRoundBegins.has(roundId)) {
    pendingRoundBegins.delete(roundId);
    return Promise.resolve();
  }
  notifyStatus(`Waiting for user to begin round ${roundId}.`);
  return new Promise((resolve) => {
    roundBeginWaiters.set(roundId, resolve);
  });
};

const markRoundBegun = (round) => {
  const roundId = normalizeRoundNumber(round);
  if (roundId === null) {
    return { ok: false, round: null };
  }
  const waiter = roundBeginWaiters.get(roundId);
  if (waiter) {
    roundBeginWaiters.delete(roundId);
    waiter();
  } else {
    pendingRoundBegins.add(roundId);
  }
  notifyStatus(`Round ${roundId} started.`);
  return { ok: true, round: roundId };
};

const pickStoryId = (story) => story.url || `${story.title}-${story.publishedAt || ""}`;

const normalizeStory = (raw) => ({
  title: raw.title || "Untitled",
  source: raw.source?.name || raw.source || "Unknown",
  url: raw.url || "",
  publishedAt: raw.publishedAt || raw.published_at || new Date().toISOString(),
  description: raw.description || raw.content || "",
});

const fetchNews = async (queryOverride) => {
  if (!NEWS_API_KEY) {
    return [];
  }

  if (NEWS_PROVIDER !== "newsapi") {
    throw new Error("Only NewsAPI is supported.");
  }

  const headers = { "X-Api-Key": NEWS_API_KEY };
  const query = queryOverride?.trim() || "";

  if (query) {
    const url = new URL("https://newsapi.org/v2/everything");
    url.searchParams.set("q", query);
    url.searchParams.set("searchIn", "title,description");
    url.searchParams.set("language", "en");
    url.searchParams.set("pageSize", "5");
    url.searchParams.set("sortBy", "publishedAt");
    const response = await fetch(url, { headers });
    if (response.ok) {
      const payload = await response.json();
      if (payload.status === "error") {
        throw new Error(payload.message || "NewsAPI error");
      }
      const articles = (payload.articles || []).map(normalizeStory);
      if (articles.length) {
        notifyStatus(`NewsAPI: ${articles.length} matches for query.`);
        return articles;
      }
    }

    const fallbackUrl = new URL("https://newsapi.org/v2/top-headlines");
    fallbackUrl.searchParams.set("q", query);
    fallbackUrl.searchParams.set("country", "in");
    fallbackUrl.searchParams.set("pageSize", "5");
    const fallbackResponse = await fetch(fallbackUrl, { headers });
    if (fallbackResponse.ok) {
      const fallbackPayload = await fallbackResponse.json();
      if (fallbackPayload.status === "error") {
        throw new Error(fallbackPayload.message || "NewsAPI error");
      }
      const fallbackArticles = (fallbackPayload.articles || []).map(normalizeStory);
      if (fallbackArticles.length) {
        notifyStatus("NewsAPI: using top-headlines fallback.");
        return fallbackArticles;
      }
    }

    notifyStatus(`No results for query: ${query}`);
    return [];
  }

  const broadUrl = new URL("https://newsapi.org/v2/top-headlines");
  broadUrl.searchParams.set("country", "in");
  broadUrl.searchParams.set("pageSize", "5");
  const broadResponse = await fetch(broadUrl, { headers });
  if (!broadResponse.ok) {
    throw new Error(`NewsAPI error: ${broadResponse.status}`);
  }
  const broadPayload = await broadResponse.json();
  if (broadPayload.status === "error") {
    throw new Error(broadPayload.message || "NewsAPI error");
  }
  const broadArticles = (broadPayload.articles || []).map(normalizeStory);
  if (broadArticles.length) {
    notifyStatus("NewsAPI: using top headlines for India.");
  }
  return broadArticles;
};

const rememberStory = (story) => {
  const id = pickStoryId(story);
  if (recentStoryIds.includes(id)) {
    return false;
  }
  recentStoryIds.unshift(id);
  if (recentStoryIds.length > RECENT_LIMIT) {
    recentStoryIds.pop();
  }
  return true;
};

const enqueueStory = (story) => {
  if (rememberStory(story)) {
    pendingStories.push(story);
  }
};

const buildAgentRoster = () =>
  COUNCIL_STATES.map((state) => {
    const profile = STATE_PROFILES[state] || {
      party: "Independent",
      ideology: "Balanced",
      focus: "General development",
      stance: "Neutral observer"
    };
    return {
      name: `${state} Council`,
      state,
      ...profile
    };
  });

const buildTranscriptText = (transcript) =>
  transcript
    .map((entry) => `- ${entry.agent} (${entry.state}): ${entry.message}`)
    .join("\n");

const parseJson = (text) => {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    // Try to extract JSON from surrounding text
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
};

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const normalizeLmBase = (value) => value.replace(/\/v1\/?$/i, "");

const callLmStudio = async (messages, maxTokens = 250) => {
  const headers = { "Content-Type": "application/json" };
  if (LMSTUDIO_API_KEY) {
    headers.Authorization = `Bearer ${LMSTUDIO_API_KEY}`;
  }

  const baseUrl = normalizeLmBase(LMSTUDIO_URL);
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: LM_MODEL,
      messages,
      temperature: 0.7,
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    throw new Error(`LM Studio error: ${response.status}`);
  }

  const payload = await response.json();
  return payload.choices?.[0]?.message?.content?.trim() || "";
};

const callLmStudioStream = async (messages, maxTokens, onDelta) => {
  const headers = { "Content-Type": "application/json" };
  if (LMSTUDIO_API_KEY) {
    headers.Authorization = `Bearer ${LMSTUDIO_API_KEY}`;
  }

  const baseUrl = normalizeLmBase(LMSTUDIO_URL);
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: LM_MODEL,
      messages,
      temperature: 0.7,
      max_tokens: maxTokens,
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`LM Studio error: ${response.status}`);
  }

  if (!response.body) {
    throw new Error("LM Studio stream unavailable");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        continue;
      }
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") {
        return;
      }
      try {
        const payload = JSON.parse(data);
        const delta = payload.choices?.[0]?.delta?.content;
        if (delta) {
          onDelta(delta);
        }
      } catch (error) {
        console.warn("Stream parse warning:", error.message);
      }
    }
  }
};

const sanitizeModelOutput = (text) => {
  if (!text) {
    return "";
  }
  // Strip hidden <thought> blocks
  let clean = text.replace(/<thought>[\s\S]*?<\/thought>/gi, "").trim();
  clean = clean.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  clean = clean.replace(/<\/?(think|thought)>/gi, "").trim();
  // Strip markdown code fences
  clean = clean.replace(/```json?\n?/gi, "").replace(/```/g, "").trim();
  const lines = clean.split("\n");
  while (
    lines.length &&
    /^\s*(okay|sure|first|let me|i need to|here is|i should|i will|to answer|analysis|i'm going to)/i.test(lines[0])
  ) {
    lines.shift();
  }
  return lines.join("\n").trim();
};

const formatDebateSummary = (text) => {
  const cleaned = sanitizeModelOutput(text);
  if (!cleaned) {
    return "";
  }

  const filteredLines = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^[-•]\s*.+Council\s*\([^)]*\):/i.test(line))
    .filter((line) => !/^[-•]\s*.+:\s*/.test(line))
    .filter((line) => !/<\/?(think|thought)>/i.test(line));

  const merged = filteredLines.join(" ").replace(/\s+/g, " ").trim();
  if (!merged) {
    return "Council reached no clear consensus.";
  }

  const sentences = merged.split(/(?<=[.!?])\s+/).filter(Boolean);
  const reasoningPattern =
    /\b(i need to|let me|i should|i will|to answer|analysis|parse through|first,?\s*i|first,?\s*we)\b/i;
  const contentSentences = sentences.filter((sentence) => !reasoningPattern.test(sentence));

  if (contentSentences.length >= 2) {
    return `${contentSentences[0]} ${contentSentences[1]}`.trim();
  }
  if (contentSentences.length === 1) {
    return contentSentences[0].trim();
  }
  if (sentences.length >= 2) {
    return `${sentences[0]} ${sentences[1]}`.trim();
  }
  return merged;
};

/* ─── Streaming with Thought Buffering ──────────────────── */

const streamAgentMessage = async (agent, messages, maxTokens, round, label) => {
  const payloadBase = { agent: agent.name, state: agent.state, round, label };
  sendEvent("agent_start", payloadBase);

  let fullText = "";
  let thoughtClosed = false;
  let noThoughtDetected = false;
  let publicBuffer = "";

  try {
    await callLmStudioStream(messages, maxTokens, (delta) => {
      fullText += delta;

      // If we're past 60 chars and no <thought> tag seen, stream everything
      if (!thoughtClosed && !noThoughtDetected && fullText.length > 60 && !fullText.includes("<thought>")) {
        noThoughtDetected = true;
      }

      if (noThoughtDetected) {
        sendEvent("agent_delta", { ...payloadBase, message: fullText.trim() });
        return;
      }

      // Buffer tokens until <thought> block is fully closed
      if (!thoughtClosed) {
        if (fullText.includes("</thought>")) {
          thoughtClosed = true;
          const afterThought = fullText.replace(/<thought>[\s\S]*?<\/thought>/gi, "").trim();
          publicBuffer = afterThought;
          if (publicBuffer) {
            sendEvent("agent_delta", { ...payloadBase, message: publicBuffer });
          }
        }
        // Don't emit anything while inside <thought>
        return;
      }

      // After thought is closed, stream normally
      publicBuffer = fullText.replace(/<thought>[\s\S]*?<\/thought>/gi, "").trim();
      sendEvent("agent_delta", { ...payloadBase, message: publicBuffer });
    });
  } catch (error) {
    console.error(`[STREAM] Agent failed (${agent.state}):`, error.message);
    const fallback = "Signal lost. Unable to reach local model.";
    sendEvent("agent_end", { ...payloadBase, message: fallback });
    return fallback;
  }

  const cleaned = sanitizeModelOutput(fullText) || "Awaiting response from the council node.";
  sendEvent("agent_end", { ...payloadBase, message: cleaned });
  return cleaned;
};

const getAgentMessage = async (agent, messages, maxTokens, round, label) => {
  const payloadBase = { agent: agent.name, state: agent.state, round, label };
  try {
    const response = await callLmStudio(messages, maxTokens);
    const cleaned = sanitizeModelOutput(response) || "Awaiting response from the council node.";
    sendEvent("agent", { ...payloadBase, message: cleaned });
    return cleaned;
  } catch (error) {
    console.error(`[AGENT] Generation failed (${agent.state}):`, error.message);
    const fallback = "Signal lost. Unable to reach local model.";
    sendEvent("agent", { ...payloadBase, message: fallback });
    return fallback;
  }
};

const agentSpeak = async (agent, messages, maxTokens, round, label) => {
  if (LMSTUDIO_STREAM) {
    return streamAgentMessage(agent, messages, maxTokens, round, label);
  }
  return getAgentMessage(agent, messages, maxTokens, round, label);
};

/* ─── Prompt Builders ───────────────────────────────────── */

const buildImpactPrompt = (agent, story) => {
  return {
    messages: [
      {
        role: "system",
        content:
          `You are the ${agent.state} representative. ` +
          `Ruling party: ${agent.party}. Focus: ${agent.focus}. ` +
          "Give a 1-2 sentence IMPACT DECLARATION only. State the specific sector affected " +
          "and whether the impact is POSITIVE, NEGATIVE, or NEUTRAL for your state. " +
          "No preamble. No greetings. Just the declaration.",
      },
      {
        role: "user",
        content:
          `News: ${story.title}\n${story.description || "No summary."}\n\n` +
          `How does this news specifically impact ${agent.state}'s economy?`,
      },
    ],
    maxTokens: 120,
  };
};

const buildSelectionPrompt = (declarations, allStates) => {
  const declarationText = declarations.map((d) => `- ${d.state}: ${d.message}`).join("\n");
  return {
    messages: [
      {
        role: "system",
        content:
          `You are the Council Moderator. Based on the impact declarations below, ` +
          `select the top ${PANEL_SIZE} states that are MOST STRONGLY affected ` +
          `(positive OR negative — intensity matters, not direction). ` +
          `Return ONLY valid JSON: {"selected":["State1","State2",...], "benched":["State3",...]}. ` +
          `Use exact state names from the list. No explanation. No markdown.`,
      },
      {
        role: "user",
        content:
          `All declarations:\n${declarationText}\n\n` +
          `All states: ${allStates.join(", ")}\n` +
          `Select the top ${PANEL_SIZE} most intensely affected. Return JSON only:`,
      },
    ],
    maxTokens: 200,
  };
};

const buildOpeningPrompt = (agent, story, declarations, priorSpeeches) => {
  const profile = `Ruling party: ${agent.party}. Ideology: ${agent.ideology}. Economic focus: ${agent.focus}.`;
  const allies = Object.keys(STATE_PROFILES).filter(
    (s) => STATE_PROFILES[s]?.party === agent.party && s !== agent.state
  );
  const allianceContext = allies.length
    ? `Allied States: ${allies.join(", ")}. Coordinate with them.`
    : "No direct party allies. Stand independently.";

  const declarationText = declarations.map((d) => `- ${d.state}: ${d.message}`).join("\n");
  const priorText = priorSpeeches.length
    ? `\nSpeeches already given this round:\n${priorSpeeches.map((s) => `- ${s.state}: ${s.message}`).join("\n")}\n`
    : "";

  const chainOfThought =
    "INSTRUCTIONS:\n" +
    "1. First, write a <thought> block. Analyze: Who is your biggest threat? Who is your ally? What's your angle of attack?\n" +
    "2. Then write your public speech (outside the tags). 2-3 sentences. Be sharp and political.";

  return {
    messages: [
      {
        role: "system",
        content:
          `You are the ${agent.state} Council representative. ${profile} ${allianceContext} ` +
          `Your stance: ${agent.stance}.\n${chainOfThought}`,
      },
      {
        role: "user",
        content:
          `News: ${story.title}\n${story.description || "No summary."}\n\n` +
          `Impact declarations from all states:\n${declarationText}\n` +
          `${priorText}\n` +
          `Deliver your opening statement. Reference at least one other state's declaration.`,
      },
    ],
    maxTokens: 350,
  };
};

const buildRebuttalPrompt = (agent, story, fullTranscript, currentRoundSpeeches) => {
  const profile = `Ruling party: ${agent.party}. Ideology: ${agent.ideology}. Economic focus: ${agent.focus}.`;
  const allies = Object.keys(STATE_PROFILES).filter(
    (s) => STATE_PROFILES[s]?.party === agent.party && s !== agent.state
  );
  const allianceContext = allies.length
    ? `Allied States: ${allies.join(", ")}. Defend them if attacked.`
    : "No allies. You're on your own.";

  const transcriptText = fullTranscript.map((t) => `- [${t.label}] ${t.state}: ${t.message}`).join("\n");
  const currentText = currentRoundSpeeches.length
    ? `\nRebuttals already given this round:\n${currentRoundSpeeches.map((s) => `- ${s.state}: ${s.message}`).join("\n")}\n`
    : "";

  const chainOfThought =
    "INSTRUCTIONS:\n" +
    "1. Write a <thought> block first. Identify the specific statement you'll attack. Plan your counter-argument.\n" +
    "2. Then write your rebuttal (outside tags). 2-3 sentences. QUOTE the opponent's words and dismantle them.";

  return {
    messages: [
      {
        role: "system",
        content:
          `You are the ${agent.state} Council representative. ${profile} ${allianceContext} ` +
          `Stance: ${agent.stance}.\n${chainOfThought}`,
      },
      {
        role: "user",
        content:
          `Full transcript so far:\n${transcriptText}\n${currentText}\n` +
          `Story: ${story.title}\n\n` +
          `Pick ONE opponent from the transcript. Quote their exact words. Explain why they're wrong.`,
      },
    ],
    maxTokens: 400,
  };
};

const buildReplyPrompt = (agent, story, fullTranscript) => {
  const profile = `Ruling party: ${agent.party}. Ideology: ${agent.ideology}. Economic focus: ${agent.focus}.`;
  const transcriptText = fullTranscript.map((t) => `- [${t.label}] ${t.state}: ${t.message}`).join("\n");

  return {
    messages: [
      {
        role: "system",
        content:
          `You are the ${agent.state} Council representative. ${profile} ` +
          `You were the most attacked state in this debate. You have the RIGHT OF REPLY. ` +
          `This is your FINAL WORD. Be dignified but devastating. 2-3 sentences. No preamble.`,
      },
      {
        role: "user",
        content:
          `Full debate transcript:\n${transcriptText}\n\n` +
          `Story: ${story.title}\n\n` +
          `Deliver your closing defense. Address the strongest attack made against you.`,
      },
    ],
    maxTokens: 350,
  };
};

/* ─── Selection Logic (Rebuttal & Reply) ────────────────── */

const selectRebuttalPanel = async (story, transcript, panelStates) => {
  const transcriptText = transcript.map((t) => `- [${t.label}] ${t.state}: ${t.message}`).join("\n");
  const messages = [
    {
      role: "system",
      content:
        `You are the Council Moderator. From the debate transcript, select exactly ${REBUTTAL_SIZE} states ` +
        `that should participate in the rebuttal round. Pick states with the MOST OPPOSING viewpoints ` +
        `and the state that was MOST REFERENCED or ATTACKED by others. ` +
        `Return ONLY valid JSON: {"rebuttal_panel":["State1","State2","State3"]}. ` +
        `Use exact state names from the panel list. No explanation. No markdown.`,
    },
    {
      role: "user",
      content:
        `Debate transcript:\n${transcriptText}\n\n` +
        `Active panel: ${panelStates.join(", ")}\n` +
        `Select exactly ${REBUTTAL_SIZE} for rebuttal. JSON only:`,
    },
  ];

  try {
    const response = await callLmStudio(messages, 150);
    const cleaned = response.replace(/```json?\n?/gi, "").replace(/```/g, "").trim();
    const parsed = parseJson(cleaned);
    if (parsed?.rebuttal_panel?.length) {
      const valid = parsed.rebuttal_panel.filter((s) => panelStates.includes(s));
      if (valid.length >= 2) {
        console.log("[REBUTTAL SELECTION]", valid);
        return valid.slice(0, REBUTTAL_SIZE);
      }
    }
    throw new Error("Invalid rebuttal selection");
  } catch (error) {
    console.error("[REBUTTAL SELECTION] LLM failed, using first entries:", error.message);
    return shuffle(panelStates).slice(0, REBUTTAL_SIZE);
  }
};

const selectReplyState = async (story, transcript, rebuttalStates) => {
  const transcriptText = transcript.map((t) => `- [${t.label}] ${t.state}: ${t.message}`).join("\n");
  const messages = [
    {
      role: "system",
      content:
        `You are the Council Moderator. From the full debate transcript, identify the ONE state ` +
        `that was MOST ATTACKED or CRITICIZED during the rebuttal round. ` +
        `This state gets the Right of Reply. ` +
        `Return ONLY valid JSON: {"reply_state":"StateName"}. Use exact state name. No markdown.`,
    },
    {
      role: "user",
      content:
        `Debate transcript:\n${transcriptText}\n\n` +
        `Rebuttal participants: ${rebuttalStates.join(", ")}\n` +
        `Who was most attacked? JSON only:`,
    },
  ];

  try {
    const response = await callLmStudio(messages, 100);
    const cleaned = response.replace(/```json?\n?/gi, "").replace(/```/g, "").trim();
    const parsed = parseJson(cleaned);
    if (parsed?.reply_state && COUNCIL_STATES.includes(parsed.reply_state)) {
      console.log("[REPLY SELECTION]", parsed.reply_state);
      return parsed.reply_state;
    }
    throw new Error("Invalid reply selection");
  } catch (error) {
    console.error("[REPLY SELECTION] LLM failed, using first rebuttal state:", error.message);
    return rebuttalStates[0];
  }
};

/* ─── Summary & Verdict ─────────────────────────────────── */

const getCouncilSummary = async (story, transcript) => {
  const systemPrompt =
    "You are a Strategic Systems Analyst. Synthesize the council debate objectively. " +
    "No preamble. No parliamentary jargon. Exactly 2 sentences. " +
    "Sentence 1: The primary economic issue all agents addressed. " +
    "Sentence 2: Contrast the two most opposing states using 'While [State A] argues X, [State B] counters with Y'.";
  const userPrompt =
    `Story: ${story.title}\n` +
    `Debate transcript:\n${buildTranscriptText(transcript)}\n\n` +
    "Summarize:";
  try {
    const response = await callLmStudio(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      200
    );
    return formatDebateSummary(response);
  } catch (error) {
    console.error("Summary failed:", error.message);
    return "Council reached no clear consensus.";
  }
};

const getRoundSummary = async (story, roundLabel, roundTranscript) => {
  if (!Array.isArray(roundTranscript) || !roundTranscript.length) {
    return "";
  }
  const systemPrompt =
    "You are Round Summary Agent. Summarize the round in 1-2 sentences. " +
    "No <think> or <thought> tags. No markdown. No bullet points. No speaker list.";
  const userPrompt =
    `Story: ${story.title}\n` +
    `Round: ${roundLabel}\n` +
    `Round transcript:\n${buildTranscriptText(roundTranscript)}\n\n` +
    "Return only the summary text.";
  try {
    const response = await callLmStudio(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      120
    );
    return formatDebateSummary(response);
  } catch (error) {
    console.error(`[ROUND SUMMARY] ${roundLabel} failed:`, error.message);
    return "";
  }
};

const emitRoundSummary = async (story, round, roundLabel, roundTranscript) => {
  const summary = await getRoundSummary(story, roundLabel, roundTranscript);
  if (!summary) {
    return;
  }
  sendEvent("round_summary", {
    round,
    label: roundLabel,
    agent: "Round Summary Agent",
    message: summary,
  });
};

const analyzeKeywords = (transcript, states) => {
  const scores = {};
  states.forEach((s) => (scores[s] = 0));
  const pos = /\b(benefit|gain|opportunity|growth|advantage|positive|win|improve|boost|strengthen)\b/gi;
  const neg = /\b(risk|threat|harm|loss|negative|damage|suffer|decline|challenge|vulnerable|hurt)\b/gi;
  transcript.forEach((entry) => {
    if (!scores.hasOwnProperty(entry.state)) return;
    const msg = entry.message.toLowerCase();
    scores[entry.state] += (msg.match(pos) || []).length - (msg.match(neg) || []).length;
  });
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  console.log("[KEYWORD ANALYSIS]", scores);
  return { winner: sorted[0][0], loser: sorted[sorted.length - 1][0] };
};

const getCouncilVerdict = async (story, transcript, states) => {
  const messages = [
    {
      role: "system",
      content:
        "You are the Council Moderator. Return ONLY valid JSON, no markdown, no explanation: " +
        '{"winner":"StateName","loser":"StateName"}. ' +
        "Winner = state that benefits MOST economically. Loser = state that suffers MOST. Use exact state names.",
    },
    {
      role: "user",
      content:
        `Story: ${story.title}\n` +
        `Debate:\n${buildTranscriptText(transcript)}\n\n` +
        `States: ${states.join(", ")}\nReturn JSON only:`,
    },
  ];
  try {
    const response = await callLmStudio(messages, 150);
    const cleaned = response.replace(/```json?\n?/gi, "").replace(/```/g, "").trim();
    const verdict = parseJson(cleaned);
    if (verdict?.winner && verdict?.loser) {
      console.log("[VERDICT]", verdict);
      return verdict;
    }
    throw new Error("Invalid verdict JSON");
  } catch (error) {
    console.error("[VERDICT] fallback to keywords:", error.message);
    return analyzeKeywords(transcript, states);
  }
};

/* ─── Main Council Pipeline ─────────────────────────────── */

const runCouncil = async (story) => {
  if (councilRunning) return;
  councilRunning = true;
  pendingRoundBegins.clear();
  roundBeginWaiters.clear();

  const allAgents = buildAgentRoster();
  const allStates = allAgents.map((a) => a.state);
  const transcript = [];

  sendEvent("council_start", {
    story: { title: story.title, url: story.url },
    agents: allAgents.map((a) => ({ name: a.name, state: a.state })),
  });

  /* ─── ROUND 0: Impact Declarations (all states) ──────── */
  console.log("\n═══ ROUND 0: IMPACT DECLARATIONS ═══");
  sendEvent("round_start", { round: 0, label: "Impact Declarations", count: allAgents.length });
  sendEvent("system", {
    round: 0,
    message: `Round 0: IMPACT DECLARATIONS\nAll ${allAgents.length} states declare how this news affects them.`,
  });
  await waitForRoundBegin(0);

  const declarations = [];
  for (const agent of allAgents) {
    const { messages, maxTokens } = buildImpactPrompt(agent, story);
    const message = await agentSpeak(agent, messages, maxTokens, 0, "Declaration");
    const entry = { agent: agent.name, state: agent.state, message, round: 0, label: "Declaration" };
    transcript.push(entry);
    declarations.push(entry);
    await new Promise((r) => setTimeout(r, 300));
  }
  await emitRoundSummary(story, 0, "Impact Declarations", declarations);

  /* ─── SELECTION: Pick top panel ───────────────────────── */
  console.log("\n═══ SELECTION: Moderator analyzing declarations ═══");
  sendEvent("system", {
    round: 0,
    loading: true,
    stream: true,
    message: "Moderator is now analysing all arguments and choosing which states move to round 1...",
  });

  let selectedStates = [];
  let benchedStates = [];

  const { messages: selMessages, maxTokens: selTokens } = buildSelectionPrompt(declarations, allStates);
  try {
    const selResponse = await callLmStudio(selMessages, selTokens);
    const selCleaned = selResponse.replace(/```json?\n?/gi, "").replace(/```/g, "").trim();
    const selParsed = parseJson(selCleaned);
    if (selParsed?.selected?.length) {
      const validSelected = selParsed.selected.filter((s) => allStates.includes(s));
      if (validSelected.length >= 2) {
        selectedStates = validSelected.slice(0, PANEL_SIZE);
        benchedStates = allStates.filter((s) => !selectedStates.includes(s));
      }
    }
    if (!selectedStates.length) throw new Error("Invalid selection JSON");
  } catch (error) {
    console.error("[SELECTION] LLM failed, using first entries:", error.message);
    selectedStates = shuffle(allStates).slice(0, PANEL_SIZE);
    benchedStates = allStates.filter((s) => !selectedStates.includes(s));
  }

  console.log("[SELECTION] Active panel:", selectedStates);
  console.log("[SELECTION] Benched:", benchedStates);

  sendEvent("panel_selected", { round: 1, selected: selectedStates, benched: benchedStates });

  const panelAgents = selectedStates.map((s) => allAgents.find((a) => a.state === s)).filter(Boolean);

  /* ─── ROUND 1: Opening Statements (panel only) ───────── */
  const shuffledPanel = shuffle(panelAgents);
  console.log("\nRound 1: OPENING STATEMENTS");
  console.log("[ORDER]", shuffledPanel.map((a) => a.state).join(" → "));
  sendEvent("round_start", {
    round: 1,
    label: "Opening Statements",
    count: shuffledPanel.length,
    order: shuffledPanel.map((a) => a.state),
  });
  sendEvent("system", {
    round: 1,
    message:
      `Round 1: OPENING STATEMENTS\n` +
      `PANEL SELECTED: ${selectedStates.join(", ")}\n` +
      `Benched: ${benchedStates.join(", ")}\n` +
      `Speaking order: ${shuffledPanel.map((a) => a.state).join(" → ")}`,
  });
  await waitForRoundBegin(1);

  const round1Speeches = [];
  for (const agent of shuffledPanel) {
    const { messages, maxTokens } = buildOpeningPrompt(agent, story, declarations, round1Speeches);
    const message = await agentSpeak(agent, messages, maxTokens, 1, "Opening");
    const entry = { agent: agent.name, state: agent.state, message, round: 1, label: "Opening" };
    transcript.push(entry);
    round1Speeches.push(entry);
    await new Promise((r) => setTimeout(r, 400));
  }
  await emitRoundSummary(story, 1, "Opening Statements", round1Speeches);

  /* ─── ROUND 2: Rebuttals (narrowed panel) ─────────────── */
  console.log("\n═══ ROUND 2: REBUTTALS ═══");
  sendEvent("system", {
    round: 1,
    loading: true,
    stream: true,
    message: `Moderator is now analysing all arguments and choosing which states move to round 2...`,
  });

  const rebuttalStates = await selectRebuttalPanel(story, transcript, selectedStates);
  const rebuttalAgents = shuffle(
    rebuttalStates.map((s) => allAgents.find((a) => a.state === s)).filter(Boolean)
  );

  console.log("[REBUTTAL ORDER]", rebuttalAgents.map((a) => a.state).join(" → "));
  sendEvent("rebuttal_selected", { round: 2, rebuttal_panel: rebuttalStates });
  sendEvent("round_start", {
    round: 2,
    label: "Rebuttals",
    count: rebuttalAgents.length,
    order: rebuttalAgents.map((a) => a.state),
  });
  sendEvent("system", {
    round: 2,
    message: `Round 2: REBUTTALS\n${rebuttalAgents.map((a) => a.state).join(" → ")} will debate.`,
  });
  await waitForRoundBegin(2);

  const round2Speeches = [];
  for (const agent of rebuttalAgents) {
    const { messages, maxTokens } = buildRebuttalPrompt(agent, story, transcript, round2Speeches);
    const message = await agentSpeak(agent, messages, maxTokens, 2, "Rebuttal");
    const entry = { agent: agent.name, state: agent.state, message, round: 2, label: "Rebuttal" };
    transcript.push(entry);
    round2Speeches.push(entry);
    await new Promise((r) => setTimeout(r, 400));
  }
  await emitRoundSummary(story, 2, "Rebuttals", round2Speeches);

  /* ─── ROUND 3: Right of Reply (1 state) ───────────────── */
  console.log("\n═══ ROUND 3: RIGHT OF REPLY ═══");
  sendEvent("system", {
    round: 2,
    loading: true,
    stream: true,
    message: "Moderator is identifying the most attacked state for Right of Reply...",
  });

  const replyStateName = await selectReplyState(story, transcript, rebuttalStates);
  const replyAgent = allAgents.find((a) => a.state === replyStateName);

  if (replyAgent) {
    console.log("[RIGHT OF REPLY]", replyAgent.state);
    sendEvent("reply_selected", { round: 3, reply_state: replyStateName });
    sendEvent("round_start", {
      round: 3,
      label: "Right of Reply",
      count: 1,
      order: [replyStateName],
    });
    sendEvent("system", {
      round: 3,
      message:
        `Round 3: RIGHT OF REPLY\n` +
        `Right of Reply granted to: ${replyStateName}\n` +
        `${replyStateName} has the final word.`,
    });
    await waitForRoundBegin(3);

    const { messages, maxTokens } = buildReplyPrompt(replyAgent, story, transcript);
    const message = await agentSpeak(replyAgent, messages, maxTokens, 3, "Right of Reply");
    const round3Entry = { agent: replyAgent.name, state: replyAgent.state, message, round: 3, label: "Right of Reply" };
    transcript.push(round3Entry);
    await new Promise((r) => setTimeout(r, 400));
    await emitRoundSummary(story, 3, "Right of Reply", [round3Entry]);
  }

  /* ─── Summary & Verdict ───────────────────────────────── */
  console.log("\n═══ SUMMARY & VERDICT ═══");
  sendEvent("round_start", {
    round: 4,
    label: "Verdict",
    count: 0,
    order: [],
  });
  sendEvent("system", {
    round: 4,
    message: "Verdict",
  });
  sendEvent("system", {
    round: 4,
    loading: true,
    stream: true,
    message: "Moderator is now analysing final arguments and preparing the verdict...",
  });
  const summary = await getCouncilSummary(story, transcript);
  const verdict = await getCouncilVerdict(story, transcript, allStates);

  sendEvent("council_end", {
    round: 4,
    summary,
    winner: verdict?.winner || "",
    loser: verdict?.loser || "",
    impacts: [],
  });

  console.log("[DONE] Winner:", verdict?.winner, "| Loser:", verdict?.loser);
  councilRunning = false;
};

const serveNextStory = async (queryOverride) => {
  const trimmedQuery = queryOverride?.trim() || "";
  const hasQuery = Boolean(trimmedQuery);
  if (hasQuery) {
    pendingStories.length = 0;
  }

  if (!hasQuery && pendingStories.length) {
    const story = pendingStories.shift();
    latestStory = story;
    sendEvent("topic", { title: story.title });
    sendEvent("feed", story);
    await runCouncil(story);
    return true;
  }
  try {
    const stories = await fetchNews(hasQuery ? trimmedQuery : NEWS_QUERY);
    if (!stories.length) {
      return false;
    }
    stories.forEach(enqueueStory);
    if (pendingStories.length) {
      const story = pendingStories.shift();
      latestStory = story;
      sendEvent("topic", { title: story.title });
      sendEvent("feed", story);
      await runCouncil(story);
      return true;
    }
  } catch (error) {
    console.error("News fetch failed:", error.message);
    notifyStatus(`NewsAPI error: ${error.message}`);
  }
  return false;
};

const readJsonBody = (req) =>
  new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        resolve({});
      }
    });
  });

const serveStatic = (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  filePath = path.normalize(filePath).replace(/^([.]{2}[\/\\])+/, "");
  const resolvedPath = path.join(STATIC_ROOT, filePath);

  if (!resolvedPath.startsWith(STATIC_ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(resolvedPath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const contentTypes = {
      ".html": "text/html",
      ".css": "text/css",
      ".js": "application/javascript",
      ".json": "application/json",
    };
    res.writeHead(200, { "Content-Type": contentTypes[ext] || "text/plain" });
    res.end(data);
  });
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/stream") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(
      `event: status\ndata: ${JSON.stringify({
        message: "Connected to council stream.",
        provider: "newsapi",
        model: LM_MODEL,
        connection: "connected",
      })}\n\n`
    );
    clients.add(res);

    if (latestStory) {
      res.write(`event: topic\ndata: ${JSON.stringify({ title: latestStory.title })}\n\n`);
      res.write(`event: feed\ndata: ${JSON.stringify(latestStory)}\n\n`);
    }

    const keepAlive = setInterval(() => {
      res.write(": ping\n\n");
    }, 15000);

    req.on("close", () => {
      clearInterval(keepAlive);
      clients.delete(res);
    });
    return;
  }

  if (url.pathname === "/api/news") {
    safeJson(res, 200, { story: latestStory });
    return;
  }

  if (url.pathname === "/api/round/begin" && req.method === "POST") {
    readJsonBody(req)
      .then((body) => {
        const result = markRoundBegun(body?.round);
        if (!result.ok) {
          safeJson(res, 400, { ok: false, error: "Invalid round number" });
          return;
        }
        safeJson(res, 200, { ok: true, round: result.round });
      })
      .catch(() => {
        safeJson(res, 500, { ok: false, error: "Failed to begin round" });
      });
    return;
  }

  if (url.pathname === "/api/trigger") {
    const title = url.searchParams.get("title") || "Manual council trigger";
    const story = {
      title,
      source: "Manual",
      url: "",
      publishedAt: new Date().toISOString(),
      description: "Manual trigger from query parameter.",
    };
    latestStory = story;
    sendEvent("topic", { title: story.title });
    sendEvent("feed", story);
    runCouncil(story).catch((error) => console.error(error));
    safeJson(res, 200, { ok: true, story });
    return;
  }

  if (url.pathname === "/api/next" && req.method === "POST") {
    readJsonBody(req)
      .then((body) => {
        const query = body?.query?.trim();
        return serveNextStory(query);
      })
      .then((served) => {
        if (!served) {
          notifyStatus("No results for the requested query.");
        }
      })
      .catch((error) => console.error(error));
    safeJson(res, 200, { ok: true });
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Council server running at http://localhost:${PORT}`);
});
