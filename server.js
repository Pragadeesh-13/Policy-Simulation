const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const NEWS_PROVIDER = "newsapi";
const NEWS_API_KEY = process.env.NEWS_API_KEY || "b883c299ae464705b215df75a65147c1";
const NEWS_QUERY = process.env.NEWS_QUERY || "";
const LMSTUDIO_URL = process.env.LMSTUDIO_URL || "http://localhost:1234";
const LMSTUDIO_API_KEY = process.env.LMSTUDIO_API_KEY || "";
const LM_MODEL = process.env.LM_MODEL || "qwen/qwen3-14b";
const LMSTUDIO_STREAM = process.env.LMSTUDIO_STREAM !== "false";
const COUNCIL_ROUNDS = Math.max(1, Number(process.env.COUNCIL_ROUNDS || 2));
const COUNCIL_STATES = (process.env.COUNCIL_STATES || "Tamil Nadu,Delhi,Kerala,Assam,Punjab")
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
    return null;
  }
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
  const lines = text.split("\n");
  while (lines.length && /^\s*(okay|sure|first|let me|i need to)/i.test(lines[0])) {
    lines.shift();
  }
  return lines.join("\n").trim();
};

const buildAgentPrompts = (agent, story, transcript, round) => {
  const profile = `Ruling party: ${agent.party}. Ideology: ${agent.ideology}. Economic focus: ${agent.focus}.`;

  const allies = Object.keys(STATE_PROFILES)
    .filter((state) => STATE_PROFILES[state].party === agent.party && state !== agent.state);

  const allianceContext = allies.length
    ? `Allied States in Council: ${allies.join(", ")}. Coordinate your arguments with them.`
    : "You have no direct party allies in this session. Stand your ground independently.";

  let systemPrompt;
  let userPrompt;

  if (round === 0) {
    systemPrompt =
      `You are the ${agent.state} Council representative. ${profile} ${allianceContext} Your stance: ${agent.stance}. ` +
      "Respond with ONLY your final position. No preamble. 2-3 sentences max.";

    userPrompt =
      `Story: ${story.title}\n${story.description || "No summary."}\n\n` +
      `Analyze impact on ${agent.state}. Be specific about industries.`;
  } else {
    const priorRound = transcript.filter((t) => t.round === 0);
    const context = priorRound.length
      ? `Round 1 positions:\n${priorRound.map((t) => `- ${t.state}: ${t.message}`).join("\n")}\n\n`
      : "";

    systemPrompt =
      `You are the ${agent.state} Council representative. ${profile} Stance: ${agent.stance}. ` +
      `STRATEGY: ${allianceContext} Support allies if their interests match yours. ` +
      "Challenge states that threaten your state's economy. Use data-driven rebuttals. No preamble. 2-3 sentences.";

    userPrompt =
      `${context}Story: ${story.title}\n\n` +
      `Review Round 1. Identify one specific state whose position harms ${agent.state}. ` +
      `Call out that state by name and dismantle their logic. If ${allies.join("/")} were attacked, defend them.`;
  }

  return {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    maxTokens: round === 0 ? 200 : 250,
  };
};

const getAgentMessage = async (agent, story, transcript, round) => {
  const { messages, maxTokens } = buildAgentPrompts(agent, story, transcript, round);

  try {
    const response = await callLmStudio(messages, maxTokens);
    return sanitizeModelOutput(response) || "Awaiting response from the council node.";
  } catch (error) {
    console.error("Agent generation failed:", error.message);
    return "Signal lost. Unable to reach local model.";
  }
};

const streamAgentMessage = async (agent, story, transcript, round) => {
  const { messages, maxTokens } = buildAgentPrompts(agent, story, transcript, round);
  const payloadBase = { agent: agent.name, state: agent.state, round };
  sendEvent("agent_start", payloadBase);

  let fullText = "";
  try {
    await callLmStudioStream(messages, maxTokens, (delta) => {
      fullText += delta;
      sendEvent("agent_delta", { ...payloadBase, message: fullText });
    });
  } catch (error) {
    console.error("Agent streaming failed:", error.message);
    const fallback = "Signal lost. Unable to reach local model.";
    sendEvent("agent_end", { ...payloadBase, message: fallback });
    return fallback;
  }

  const cleaned = sanitizeModelOutput(fullText) || "Awaiting response from the council node.";
  sendEvent("agent_end", { ...payloadBase, message: cleaned });
  return cleaned;
};

const getCouncilSummary = async (story, transcript) => {
  const systemPrompt =
    "You are a Strategic Systems Analyst. Your role is to objectively synthesize the council's intelligence. " +
  "Respond with ONLY the final summary. No preamble. No parliamentary jargon or honorifics. " +
  "Before writing, internally execute these steps: \n" +
  "1. CLASSIFY: Group states into STRATEGIC ALIGNMENT (Pro) or STRATEGIC FRICTION (Anti). \n" +
  "2. IDENTIFY: Pinpoint the exact economic variable causing the friction (e.g., MSP, Tech Tax, Federal Dues). \n" +
  "3. OUTPUT: Exactly 2 sentences. \n" +
  "Sentence 1: State the primary objective or data point that all agents addressed. \n" +
  "Sentence 2: Contrast the two most opposing state viewpoints using a direct 'While [State A] argues X, [State B] counters with Y' structure.";
  const userPrompt =
    `Story: ${story.title}\n` +
    `Debate transcript:\n${buildTranscriptText(transcript)}\n\n` +
    "Summarize the council's debate.";
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  try {
    const response = await callLmStudio(messages, 200);
    return sanitizeModelOutput(response);
  } catch (error) {
    console.error("Summary generation failed:", error.message);
    return "Council reached no clear consensus. Monitor all states for emerging impacts.";
  }
};

const analyzeKeywords = (transcript, states) => {
  const stateScores = {};
  states.forEach(state => { stateScores[state] = 0; });

  const positiveWords = /\b(benefit|gain|opportunity|growth|advantage|positive|win|improve|boost|strengthen)\b/gi;
  const negativeWords = /\b(risk|threat|harm|loss|negative|damage|suffer|decline|challenge|vulnerable|hurt)\b/gi;

  transcript.forEach(entry => {
    const state = entry.state;
    const message = entry.message.toLowerCase();
    const positiveCount = (message.match(positiveWords) || []).length;
    const negativeCount = (message.match(negativeWords) || []).length;
    stateScores[state] += (positiveCount - negativeCount);
  });

  const sorted = Object.entries(stateScores).sort((a, b) => b[1] - a[1]);
  console.log("[KEYWORD ANALYSIS] State scores:", stateScores);
  return { winner: sorted[0][0], loser: sorted[sorted.length - 1][0] };
};

const getCouncilVerdict = async (story, transcript, states) => {
  const systemPrompt =
    "You are the Council Moderator. Return ONLY valid JSON, no markdown, no explanation: " +
    '{"winner":"StateName","loser":"StateName"}. ' +
    "Winner = state that benefits MOST economically. Loser = state that suffers MOST economically. " +
    "Use exact state names from the list.";
  const userPrompt =
    `Story: ${story.title}\n` +
    `Debate:\n${buildTranscriptText(transcript)}\n\n` +
    `States: ${states.join(", ")}\n` +
    "Return JSON only:";
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  try {
    const response = await callLmStudio(messages, 150);
    const cleaned = response.replace(/```json?\n?/gi, '').replace(/```/g, '').trim();
    const verdict = parseJson(cleaned);
    if (verdict && verdict.winner && verdict.loser) {
      console.log("[VERDICT] LLM verdict:", verdict);
      return verdict;
    }
    throw new Error("Invalid JSON structure");
  } catch (error) {
    console.error("[VERDICT] LLM verdict failed, using keyword analysis:", error.message);
    const fallback = analyzeKeywords(transcript, states);
    console.log("[VERDICT] Keyword fallback result:", fallback);
    return fallback;
  }
};

const runCouncil = async (story) => {
  if (councilRunning) {
    return;
  }
  councilRunning = true;

  const agents = buildAgentRoster();
  sendEvent("council_start", {
    story: { title: story.title, url: story.url },
    agents: agents.map((agent) => ({ name: agent.name, state: agent.state })),
  });

  const transcript = [];
  for (let round = 0; round < COUNCIL_ROUNDS; round += 1) {
    const roundNumber = round + 1;
    const roundRules = round === 0
      ? "Round 1 rules: 2-3 sentences, state benefits or harms, name a sector impacted."
      : "Round 2 rules: 2-3 sentences, rebut another state and defend your position.";
    sendEvent("system", {
      message: `Conducting Round ${roundNumber}.\n${roundRules}`,
    });
    for (const agent of agents) {
      const message = LMSTUDIO_STREAM
        ? await streamAgentMessage(agent, story, transcript, round)
        : await getAgentMessage(agent, story, transcript, round);
      const payload = { agent: agent.name, state: agent.state, message, round };
      transcript.push(payload);
      if (!LMSTUDIO_STREAM) {
        sendEvent("agent", payload);
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  const summary = await getCouncilSummary(story, transcript);
  const verdict = await getCouncilVerdict(
    story,
    transcript,
    agents.map((agent) => agent.state)
  );
  sendEvent("council_end", {
    summary,
    winner: verdict?.winner || "",
    loser: verdict?.loser || "",
    impacts: [],
  });
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
        connection: "online",
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
