const map = L.map("india-map", {
  zoomControl: false,
  attributionControl: false,
  zoomSnap: 0.25,
  zoomDelta: 0.25,
  inertia: false,
  preferCanvas: false,
});

const mapContainer = document.getElementById("india-map");

const addGlowFilter = () => {
  const svg = map.getPanes().overlayPane.querySelector("svg");
  if (!svg || svg.querySelector("#state-glow")) {
    return;
  }

  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
  filter.setAttribute("id", "state-glow");
  filter.setAttribute("x", "-40%");
  filter.setAttribute("y", "-40%");
  filter.setAttribute("width", "180%");
  filter.setAttribute("height", "180%");

  const blur = document.createElementNS("http://www.w3.org/2000/svg", "feGaussianBlur");
  blur.setAttribute("stdDeviation", "6");
  blur.setAttribute("result", "coloredBlur");

  const merge = document.createElementNS("http://www.w3.org/2000/svg", "feMerge");
  const mergeNode1 = document.createElementNS("http://www.w3.org/2000/svg", "feMergeNode");
  mergeNode1.setAttribute("in", "coloredBlur");
  const mergeNode2 = document.createElementNS("http://www.w3.org/2000/svg", "feMergeNode");
  mergeNode2.setAttribute("in", "SourceGraphic");

  merge.appendChild(mergeNode1);
  merge.appendChild(mergeNode2);

  filter.appendChild(blur);
  filter.appendChild(merge);
  defs.appendChild(filter);
  svg.appendChild(defs);
};

const shpUrl = "https://raw.githubusercontent.com/datameet/maps/master/States/Admin2.shp";
const dbfUrl = "https://raw.githubusercontent.com/datameet/maps/master/States/Admin2.dbf";

const stateNameToLayers = new Map();
const normalizeStateName = (value) => {
  const normalized = (value || "").toLowerCase().replace(/\s+/g, " ").trim();
  const aliases = {
    "nct of delhi": "delhi",
    "national capital territory of delhi": "delhi",
  };
  return aliases[normalized] || normalized;
};

const getStateLayers = (stateName) => stateNameToLayers.get(stateName) || [];

const baseStateStyle = {
  className: "state-path",
  fillColor: "#090909",
  fillOpacity: 0.28,
  color: "rgba(255, 255, 255, 0.15)",
  weight: 1.2,
};

const positiveStateStyle = {
  className: "state-path",
  fillColor: "rgba(56, 204, 118, 0.55)",
  fillOpacity: 0.6,
  color: "rgba(56, 204, 118, 0.9)",
  weight: 1.4,
};

const negativeStateStyle = {
  className: "state-path",
  fillColor: "rgba(230, 74, 74, 0.55)",
  fillOpacity: 0.6,
  color: "rgba(230, 74, 74, 0.9)",
  weight: 1.4,
};

const activeStateStyle = {
  className: "state-path",
  fillColor: "rgba(255, 255, 255, 0.45)",
  fillOpacity: 0.65,
  color: "rgba(255, 255, 255, 0.85)",
  weight: 1.8,
};

const stateLayer = L.geoJSON(null, {
  style: baseStateStyle,
  onEachFeature: (feature, layer) => {
    console.log(`[MAP LOAD] Properties:`, feature.properties);
    const name = feature.properties?.ST_NM || feature.properties?.NAME_1 || feature.properties?.state || feature.properties?.name || "Unknown";
    const normalized = normalizeStateName(name);
    console.log(`[MAP LOAD] State: "${name}" -> normalized: "${normalized}"`);
    const list = stateNameToLayers.get(normalized) || [];
    list.push(layer);
    stateNameToLayers.set(normalized, list);

    layer.on("click", () => {
      console.log(`State clicked: ${name}`);
      layer.getElement()?.classList.toggle("active");
    });

    layer.on("mouseover", () => {
      layer.getElement()?.classList.add("hovered");
    });

    layer.on("mouseout", () => {
      layer.getElement()?.classList.remove("hovered");
    });
  },
});

Promise.all([fetch(shpUrl).then((res) => res.arrayBuffer()), fetch(dbfUrl).then((res) => res.arrayBuffer())])
  .then(([shpBuffer, dbfBuffer]) => {
    const shapes = shp.parseShp(shpBuffer);
    const records = shp.parseDbf(dbfBuffer);
    const geojson = shp.combine([shapes, records]);
    stateLayer.addData(geojson).addTo(map);
    map.fitBounds(stateLayer.getBounds(), {
      padding: [16, 16],
      maxZoom: 6.5,
    });
    addGlowFilter();
    stateImpact.forEach((impact, stateName) => {
      const layers = getStateLayers(stateName);
      layers.forEach((layer) => {
        if (impact === "positive") {
          layer.setStyle(positiveStateStyle);
        } else if (impact === "negative") {
          layer.setStyle(negativeStateStyle);
        } else {
          layer.setStyle(baseStateStyle);
        }
      });
    });
  })
  .catch((error) => {
    console.error("Failed to load shapefile:", error);
    mapContainer.innerHTML =
      "<div style='color:#777;padding:20px;font-size:12px;'>Map data failed to load.</div>";
  });

const resizeObserver = new ResizeObserver(() => {
  map.invalidateSize();
  if (stateLayer.getLayers().length) {
    map.fitBounds(stateLayer.getBounds(), {
      padding: [16, 16],
      maxZoom: map.getZoom(),
    });
  }
});

resizeObserver.observe(mapContainer);

const feedList = document.getElementById("feed-list");
const deliberationList = document.getElementById("deliberation-list");
const layoutElement = document.querySelector(".layout");
const topicText = document.getElementById("topic-text");
const agentCards = new Map();
const statusConnection = document.getElementById("status-connection");
const statusProvider = document.getElementById("status-provider");
const statusModel = document.getElementById("status-model");
const statusStrip = statusModel?.parentElement || null;
const topbarRight = document.querySelector(".topbar__right");
const fetchNextBtn = document.getElementById("fetch-next");
const topicInput = document.getElementById("topic-input");
const stateImpact = new Map();
const agentStreamEntries = new Map();
let debateLoadingNote = null;
let activeFeedCard = null;
let fetchLocked = false;
let pendingCouncilCardTimers = [];
let debateRunningTimer = null;
let councilsBooted = false;
const systemNoteQueue = [];
let systemNoteStreaming = false;
let systemNotesContainer = null;
let agentsContainer = null;
let llmMessagesContainer = null;
let otherAgentsContainer = null;
let councilHeaderEl = null;
let councilOrchestratorCardEl = null;
let councilRoundViewsContainer = null;
let systemPanelContainer = null;
let councilPanelContainer = null;
let systemRoundTabsContainer = null;
let systemRoundControlsContainer = null;
let systemRoundViewsContainer = null;
let systemGeneralMessagesContainer = null;
let systemMessagesScrollContainer = null;
let activeSystemRound = null;
let currentSystemRound = null;
let compactModeBtn = null;
const roundContainers = new Map();
const councilRoundContainers = new Map();
const roundTabLabels = new Map();

const getRoundTabLabel = (roundId) => roundTabLabels.get(roundId) || `View round ${roundId}`;

const getAgentCardKey = (payload = {}) => {
  const name = payload.agent || "Council";
  const roundId = normalizeRoundId(payload.round);
  return `${roundId === null ? "x" : roundId}:${name}`;
};

const setFeedCollapsed = (collapsed) => {
  if (!layoutElement || !feedList) {
    return;
  }
  layoutElement.classList.toggle("feed-collapsed", Boolean(collapsed));
  const toggleBtn = feedList.querySelector(".feed-collapse-btn");
  if (toggleBtn) {
    toggleBtn.classList.toggle("is-collapsed", Boolean(collapsed));
    toggleBtn.classList.toggle("is-expanded", !collapsed);
    toggleBtn.setAttribute("aria-label", collapsed ? "Expand feed panel" : "Collapse feed panel");
    toggleBtn.setAttribute("title", collapsed ? "Expand feed panel" : "Collapse feed panel");
  }
  setTimeout(() => {
    try {
      map.invalidateSize();
    } catch (e) {
      // ignore
    }
  }, 120);
};

const setCompactMode = (enabled) => {
  if (!layoutElement) {
    return;
  }
  layoutElement.classList.toggle("compact-mode", Boolean(enabled));
  if (enabled) {
    layoutElement.classList.remove("feed-collapsed");
  }
  if (compactModeBtn) {
    compactModeBtn.textContent = enabled ? "Switch to full mode" : "Swtich to compact mode";
  }
  setTimeout(() => {
    try {
      map.invalidateSize();
    } catch (e) {
      // ignore
    }
  }, 120);
};

const initCompactModeToggle = () => {
  const compactContainer = topbarRight || statusStrip;
  if (!compactContainer || !layoutElement || compactContainer.querySelector(".compact-mode-btn")) {
    return;
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = "status-item compact-mode-btn";
  button.textContent = "Swtich to compact mode";
  button.setAttribute("aria-label", "Switch to compact mode");
  button.addEventListener("click", () => {
    const enabled = layoutElement.classList.contains("compact-mode");
    setCompactMode(!enabled);
  });
  compactContainer.appendChild(button);
  compactModeBtn = button;
};

const initFeedCollapseToggle = () => {
  if (!feedList || !layoutElement || feedList.querySelector(".feed-collapse-btn")) {
    return;
  }
  const controls = feedList.querySelector(".feed-controls");
  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "feed-collapse-btn";
  toggleBtn.setAttribute("aria-label", "Collapse feed panel");
  toggleBtn.setAttribute("title", "Collapse feed panel");
  toggleBtn.addEventListener("click", () => {
    const collapsed = layoutElement.classList.contains("feed-collapsed");
    setFeedCollapsed(!collapsed);
  });
  if (controls) {
    controls.appendChild(toggleBtn);
  } else {
    feedList.appendChild(toggleBtn);
  }
  setFeedCollapsed(layoutElement.classList.contains("feed-collapsed"));
};

const stopDebateRunningIndicator = () => {
  if (debateRunningTimer) {
    clearInterval(debateRunningTimer);
    debateRunningTimer = null;
  }
};

const startDebateRunningIndicator = () => {
  if (!fetchNextBtn) {
    return;
  }
  stopDebateRunningIndicator();
  let frame = 1;
  const render = () => {
    const dots = ".".repeat(frame);
    fetchNextBtn.textContent = `Debate running${dots}`;
    frame = frame >= 3 ? 1 : frame + 1;
  };
  render();
  debateRunningTimer = setInterval(render, 420);
};

const updateCouncilEmptyState = () => {
  if (!councilOrchestratorCardEl) {
    return;
  }
  let messageCount = 0;
  councilRoundContainers.forEach((entry) => {
    messageCount += (entry.llm?.children?.length || 0) + (entry.others?.children?.length || 0);
  });
  const hasMessages = messageCount > 0;
  councilOrchestratorCardEl.style.display = !hasMessages && !fetchLocked ? "grid" : "none";
};

// Toggle UI lock state for debate: adds/removes `debate-locked` on <body>
const setDebateLocked = (locked) => {
  try {
    document.body.classList.toggle("debate-locked", Boolean(locked));
  } catch (e) {
    // ignore when body not present (safe-guard)
  }
  fetchLocked = Boolean(locked);
  try {
    if (topicInput) {
      topicInput.disabled = Boolean(locked);
      if (locked) {
        topicInput.blur();
        topicInput.setAttribute("aria-disabled", "true");
      } else {
        topicInput.removeAttribute("aria-disabled");
      }
    }
  } catch (e) {
    // ignore if DOM not ready
  }
  updateCouncilEmptyState();
};

// Prevent clicks on topic text and start button while debate is locked
document.addEventListener(
  "click",
  (e) => {
    if (!fetchLocked) return;
    const el = e.target;
    if (el.closest && (el.closest("#fetch-next") || el.closest("#topic-text") || el.closest(".topic-pill"))) {
      e.preventDefault();
      e.stopPropagation();
    }
  },
  true
);

const isNearTop = (element, threshold = 80) => {
  if (!element) {
    return true;
  }
  return element.scrollTop <= threshold;
};

const scrollToTop = (element) => {
  if (!element) {
    return;
  }
  element.scrollTop = 0;
};

initFeedCollapseToggle();
initCompactModeToggle();

const ensureDeliberationPanels = () => {
  if (
    systemPanelContainer &&
    councilPanelContainer &&
    systemPanelContainer.parentElement === deliberationList &&
    councilPanelContainer.parentElement === deliberationList
  ) {
    return;
  }
  deliberationList.innerHTML = "";

  const top = document.createElement("div");
  top.className = "chat-pane chat-pane-system";

  const bottom = document.createElement("div");
  bottom.className = "chat-pane chat-pane-council";

  deliberationList.appendChild(top);
  deliberationList.appendChild(bottom);

  systemPanelContainer = top;
  councilPanelContainer = bottom;
};

const setActiveSystemRound = (roundId) => {
  roundContainers.forEach((entry, id) => {
    if (entry.view) {
      entry.view.classList.toggle("active", id === roundId);
    }
    if (entry.tab) {
      entry.tab.classList.toggle("active", id === roundId);
    }
  });
  if (systemGeneralMessagesContainer) {
    systemGeneralMessagesContainer.style.display = roundId === null ? "flex" : "none";
  }
  activeSystemRound = roundId;
  updateRoundTabMarkers();
};

const updateRoundTabMarkers = () => {
  roundContainers.forEach((entry, id) => {
    if (!entry.tab) {
      return;
    }
    const isCurrent = currentSystemRound === id;
    const baseLabel = getRoundTabLabel(id);
    entry.tab.classList.toggle("current", isCurrent);
    entry.tab.textContent = isCurrent ? `${baseLabel} • Current` : baseLabel;
  });
};

const setActiveCouncilRound = (roundId) => {
  councilRoundContainers.forEach((entry, id) => {
    if (entry.view) {
      entry.view.classList.toggle("active", id === roundId);
    }
  });
};

const setActiveRound = (roundId) => {
  setActiveSystemRound(roundId);
  setActiveCouncilRound(roundId);
};

const addCompletedRoundTab = (roundId) => {
  const round = roundContainers.get(roundId);
  if (!round || round.tab || !systemRoundTabsContainer) {
    return;
  }
  const tab = document.createElement("button");
  tab.className = "system-round-tab";
  tab.textContent = getRoundTabLabel(roundId);
  tab.addEventListener("click", () => {
    setActiveRound(roundId);
  });
  systemRoundTabsContainer.appendChild(tab);
  round.tab = tab;
  updateRoundTabMarkers();
};

const ensureRoundContainer = (round) => {
  const roundId = normalizeRoundId(round);
  if (roundId === null) {
    return null;
  }
  ensureSystemNotesContainer();
  if (roundContainers.has(roundId)) {
    return roundContainers.get(roundId);
  }

  const view = document.createElement("div");
  view.className = "system-round-view";
  view.dataset.round = String(roundId);
  systemRoundViewsContainer.appendChild(view);

  const payload = { roundId, view, tab: null };
  if (systemRoundTabsContainer) {
    const tab = document.createElement("button");
    tab.className = "system-round-tab";
    tab.textContent = getRoundTabLabel(roundId);
    tab.addEventListener("click", () => {
      setActiveRound(roundId);
    });
    systemRoundTabsContainer.appendChild(tab);
    payload.tab = tab;
  }
  roundContainers.set(roundId, payload);
  updateRoundTabMarkers();
  return payload;
};

const ensureCouncilRoundContainer = (round) => {
  const roundId = normalizeRoundId(round);
  if (roundId === null) {
    return null;
  }
  ensureAgentsContainer();
  if (councilRoundContainers.has(roundId)) {
    return councilRoundContainers.get(roundId);
  }

  const view = document.createElement("div");
  view.className = "council-round-view";
  view.dataset.round = String(roundId);

  const llm = document.createElement("div");
  llm.className = "llm-messages";
  const others = document.createElement("div");
  others.className = "other-agents";

  view.appendChild(llm);
  view.appendChild(others);
  councilRoundViewsContainer?.appendChild(view);

  const payload = { roundId, view, llm, others };
  councilRoundContainers.set(roundId, payload);
  return payload;
};

const setRoundBeginControl = (roundId, options = {}) => {
  ensureSystemNotesContainer();
  if (!systemRoundControlsContainer) {
    return;
  }
  systemRoundControlsContainer.innerHTML = "";
  if (roundId === null || roundId === undefined) {
    return;
  }

  const btn = document.createElement("button");
  btn.className = "begin-round-btn";
  const isBooting = Boolean(options.booting);
  if (isBooting) {
    btn.disabled = true;
    btn.classList.add("disabled");
    btn.textContent = "Councils are booting...";
    systemRoundControlsContainer.appendChild(btn);
    if (currentSystemRound !== null) {
      const goCurrentBtn = document.createElement("button");
      goCurrentBtn.className = "begin-round-btn go-current-round-btn";
      goCurrentBtn.textContent = "Go to current round";
      goCurrentBtn.disabled = activeSystemRound === currentSystemRound;
      if (goCurrentBtn.disabled) {
        goCurrentBtn.classList.add("disabled");
      }
      goCurrentBtn.addEventListener("click", () => {
        if (currentSystemRound === null) {
          return;
        }
        setActiveRound(currentSystemRound);
      });
      systemRoundControlsContainer.appendChild(goCurrentBtn);
    }
    return;
  }
  btn.textContent = `Begin round ${roundId}`;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.classList.add("disabled");
    btn.textContent = `Round ${roundId} started`;
    if (roundId === 0 && fetchNextBtn) {
      startDebateRunningIndicator();
      fetchNextBtn.classList.remove("is-loading");
      fetchNextBtn.disabled = true;
    }
    try {
      await fetch(`/api/round/begin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ round: roundId }),
      });
    } catch (e) {
      // keep UI state; server will remain waiting until successful call
    }
  });

  systemRoundControlsContainer.appendChild(btn);

  if (currentSystemRound !== null) {
    const goCurrentBtn = document.createElement("button");
    goCurrentBtn.className = "begin-round-btn go-current-round-btn";
    goCurrentBtn.textContent = "Go to current round";
    goCurrentBtn.disabled = activeSystemRound === currentSystemRound;
    if (goCurrentBtn.disabled) {
      goCurrentBtn.classList.add("disabled");
    }
    goCurrentBtn.addEventListener("click", () => {
      if (currentSystemRound === null) {
        return;
      }
      setActiveRound(currentSystemRound);
    });
    systemRoundControlsContainer.appendChild(goCurrentBtn);
  }
};

const ensureSystemNotesContainer = () => {
  ensureDeliberationPanels();
  if (systemNotesContainer && systemNotesContainer.parentElement === systemPanelContainer) {
    return systemNotesContainer;
  }

  const container = document.createElement("div");
  container.className = "system-notes";

  const header = document.createElement("div");
  header.className = "section-header";
  header.textContent = "System Messages";

  const headerRow = document.createElement("div");
  headerRow.className = "system-header-row";

  const tabs = document.createElement("div");
  tabs.className = "system-round-tabs";

  const controls = document.createElement("div");
  controls.className = "system-round-controls";

  const general = document.createElement("div");
  general.className = "system-general-messages";

  const views = document.createElement("div");
  views.className = "system-round-views";

  const messagesScroll = document.createElement("div");
  messagesScroll.className = "system-messages-scroll";

  headerRow.appendChild(header);
  headerRow.appendChild(controls);
  messagesScroll.appendChild(general);
  messagesScroll.appendChild(views);

  container.appendChild(headerRow);
  container.appendChild(tabs);
  container.appendChild(messagesScroll);

  systemPanelContainer.appendChild(container);

  systemNotesContainer = container;
  systemRoundTabsContainer = tabs;
  systemRoundControlsContainer = controls;
  systemGeneralMessagesContainer = general;
  systemRoundViewsContainer = views;
  systemMessagesScrollContainer = messagesScroll;

  return container;
};

const ensureAgentsContainer = () => {
  ensureDeliberationPanels();
  if (agentsContainer && agentsContainer.parentElement === councilPanelContainer) {
    return agentsContainer;
  }
  const container = document.createElement("div");
  container.className = "agent-list council-box";
  const header = document.createElement("div");
  header.className = "section-header";
  header.textContent = "Council's messages";
  container.appendChild(header);

  const orchestrator = createAgentCard({
    name: "Council Orchestrator",
    message: "",
  });
  orchestrator.classList.add("council-orchestrator");
  orchestrator.classList.add("system");
  container.appendChild(orchestrator);
  streamCardMessage(orchestrator, "Begin a debate to see the council's responses.", {
    speed: 50,
  });

  const views = document.createElement("div");
  views.className = "council-round-views";
  container.appendChild(views);

  councilPanelContainer.appendChild(container);

  agentsContainer = container;
  llmMessagesContainer = null;
  otherAgentsContainer = null;
  councilHeaderEl = header;
  councilOrchestratorCardEl = orchestrator;
  councilRoundViewsContainer = views;
  updateCouncilEmptyState();
  return container;
};

const resetCouncilRoundWindow = () => {
  pendingCouncilCardTimers.forEach((timer) => clearTimeout(timer));
  pendingCouncilCardTimers = [];
  agentCards.clear();
  agentStreamEntries.clear();
  councilRoundContainers.forEach((entry) => {
    entry.llm.innerHTML = "";
    entry.others.innerHTML = "";
  });
  councilRoundContainers.clear();
  updateCouncilEmptyState();
};

const normalizeRoundId = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.trunc(parsed);
};

const insertAgentCard = (card, round) => {
  ensureAgentsContainer();
  const roundId = normalizeRoundId(round);
  const target = roundId !== null ? ensureCouncilRoundContainer(roundId) : null;
  // tag cards with their agent name when available
  const agentName = card.dataset.agentName || "";
  if (agentName && agentName.toLowerCase() === "llm") {
    if (target?.llm) target.llm.appendChild(card);
    else if (llmMessagesContainer) llmMessagesContainer.appendChild(card);
    else agentsContainer.appendChild(card);
  } else {
    if (target?.others) target.others.appendChild(card);
    else if (otherAgentsContainer) otherAgentsContainer.appendChild(card);
    else agentsContainer.appendChild(card);
  }
  updateCouncilEmptyState();
};

const STATE_AVATAR_STYLES = {
  "Tamil Nadu": { initials: "TN", background: "#7dd3fc" },
  Delhi: { initials: "DL", background: "#fcd34d" },
  Kerala: { initials: "KL", background: "#6ee7b7" },
  Assam: { initials: "AS", background: "#fca5a5" },
  Punjab: { initials: "PB", background: "#c4b5fd" },
  Karnataka: { initials: "KA", background: "#93c5fd" },
  Maharashtra: { initials: "MH", background: "#fda4af" },
  "Uttar Pradesh": { initials: "UP", background: "#fdba74" },
  "West Bengal": { initials: "WB", background: "#a5b4fc" },
  Gujarat: { initials: "GJ", background: "#fca5a5" },
};

const STATE_TEAMS = {
  "Tamil Nadu": "dmk",
  Delhi: "aap",
  Punjab: "aap",
  Kerala: "cpim",
  Assam: "bjp",
  Karnataka: "congress",
  Maharashtra: "bjp",
  "Uttar Pradesh": "bjp",
  "West Bengal": "tmc",
  Gujarat: "bjp",
};

const getStateTeam = (stateName) => STATE_TEAMS[stateName] || "independent";

const getStateInitials = (stateName) => {
  const trimmed = (stateName || "").trim();
  if (!trimmed) {
    return "";
  }
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
};

const getStateAvatar = (stateName) => {
  const style = STATE_AVATAR_STYLES[stateName];
  if (style) {
    return style;
  }
  return {
    initials: getStateInitials(stateName),
    background: "#d4d4d4",
  };
};

const setStatusText = (el, value) => {
  if (!el || !value) {
    return;
  }
  el.textContent = value;
};

const setTopic = (title) => {
  if (!topicText) {
    return;
  }
  topicText.textContent = `Current Topic: ${title}`;
};

const formatMeta = (source, publishedAt) => {
  const label = source || "Unknown";
  const time = publishedAt ? new Date(publishedAt).toLocaleTimeString() : "now";
  return `${label} • ${time}`;
};

const clearActiveFeed = () => {
  feedList.querySelectorAll(".feed-card.active").forEach((card) => {
    card.classList.remove("active");
    const badge = card.querySelector(".badge");
    if (badge) {
      badge.textContent = "Pending";
      badge.classList.add("muted");
    }
  });
};

const addFeedCard = (story, isActive) => {
  const card = document.createElement("div");
  card.className = `feed-card${isActive ? " active" : ""}`;
  const badgeLabel = isActive ? "Active" : "Pending";
  const badgeClass = isActive ? "badge" : "badge muted";

  card.innerHTML = `
    <div class="feed-card__header">
      <span class="${badgeClass}">${badgeLabel}</span>
    </div>
    <h3>${story.title}</h3>
    <p>${formatMeta(story.source, story.publishedAt)}</p>
  `;

  if (story.url) {
    card.style.cursor = "pointer";
    card.addEventListener("click", () => {
      window.open(story.url, "_blank", "noopener,noreferrer");
    });
  }

  feedList.prepend(card);
  return card;
};

const createWaitingCard = () => {
  const card = document.createElement("div");
  card.className = "feed-card active";
  card.id = "active-feed-card";
  card.innerHTML = `
    <div class="feed-card__header">
      <span class="badge">Active</span>
    </div>
    <h3>Waiting for news...</h3>
    <p>System • now</p>
  `;
  return card;
};

const createActiveFeedCard = (story) => {
  const card = document.createElement("div");
  card.className = "feed-card active processing";
  card.id = "active-feed-card";
  card.innerHTML = `
    <div class="feed-card__header">
      <span class="badge processing">Processing</span>
    </div>
    <h3>${story.title}</h3>
    <p>${formatMeta(story.source, story.publishedAt)}</p>
  `;
  return card;
};

const insertWaitingCard = () => {
  const card = createWaitingCard();
  const controls = feedList.querySelector(".feed-controls");
  if (controls && controls.nextSibling) {
    feedList.insertBefore(card, controls.nextSibling);
  } else {
    feedList.appendChild(card);
  }
  return card;
};

const ensureWaitingCard = () => {
  let current = document.getElementById("active-feed-card");
  if (!current) {
    current = insertWaitingCard();
  }
  return current;
};

const setActiveFeed = (story) => {
  let card = document.getElementById("active-feed-card");
  if (!card) {
    const activeCard = createActiveFeedCard(story);
    const controls = feedList.querySelector(".feed-controls");
    if (controls && controls.nextSibling) {
      feedList.insertBefore(activeCard, controls.nextSibling);
    } else {
      feedList.appendChild(activeCard);
    }
    card = activeCard;
  }
  const header = card.querySelector("h3");
  const meta = card.querySelector("p");
  if (header) {
    header.textContent = story.title;
  }
  if (meta) {
    meta.textContent = formatMeta(story.source, story.publishedAt);
  }

  const badge = card.querySelector(".badge");
  if (badge) {
    badge.textContent = "Processing";
    badge.classList.remove("muted");
    badge.classList.add("processing");
  }

  card.classList.add("active", "processing");
  card.id = "active-feed-card";
  activeFeedCard = card;

  if (story.url) {
    card.style.cursor = "pointer";
    card.onclick = () => {
      window.open(story.url, "_blank", "noopener,noreferrer");
    };
  }
};

const setActiveState = (stateName) => {
  const normalized = normalizeStateName(stateName);
  stateLayer.eachLayer((layer) => {
    const element = layer.getElement();
    if (element?.classList.contains("active")) {
      const currentName = normalizeStateName(element.__stateName || "");
      const currentImpact = stateImpact.get(currentName);
      const targets = getStateLayers(currentName);
      targets.forEach((l) => {
        if (currentImpact === "positive") {
          l.setStyle(positiveStateStyle);
        } else if (currentImpact === "negative") {
          l.setStyle(negativeStateStyle);
        } else {
          l.setStyle(baseStateStyle);
        }
      });
      element.classList.remove("active");
    }
  });

  const targets = getStateLayers(normalized);
  targets.forEach((layer) => {
    const element = layer.getElement();
    if (element) {
      element.__stateName = stateName;
      element.classList.add("active");
    }
    layer.setStyle(activeStateStyle);
  });
};

const setStateImpact = (stateName, impact) => {
  const normalized = normalizeStateName(stateName);
  console.log(`[MAP] Setting ${impact} impact for "${stateName}" -> normalized: "${normalized}"`);
  stateImpact.set(normalized, impact);
  const targets = getStateLayers(normalized);
  console.log(`[MAP] Found ${targets.length} layer(s) for "${normalized}"`);
  targets.forEach((layer) => {
    if (impact === "positive") {
      layer.setStyle(positiveStateStyle);
    } else if (impact === "negative") {
      layer.setStyle(negativeStateStyle);
    } else {
      layer.setStyle(baseStateStyle);
    }
  });
};

const createAgentCard = (agent) => {
  const card = document.createElement("div");
  card.className = "agent-card";
  // tag card with agent name for routing (e.g., LLM)
  card.dataset.agentName = agent?.name || "Council";
  if (agent?.name === "System") {
    card.classList.add("system");
  }
  if (agent?.state) {
    card.classList.add(`team-${getStateTeam(agent.state)}`);
  }
  const avatarClass = agent?.muted ? "agent-avatar ghost" : "agent-avatar";
  const role = agent?.state ? `<span>${agent.state}</span>` : "";
  const avatarData = agent?.state ? getStateAvatar(agent.state) : null;
  const avatarLabel = avatarData?.initials || "";
  const avatarStyle = avatarData?.background ? `style="background:${avatarData.background};"` : "";
  const messageText = agent?.message ?? "Awaiting signal.";
  const hasMessage = Boolean(String(messageText).trim());
  card.innerHTML = `
    <div class="${avatarClass}" ${avatarStyle}>${avatarLabel}</div>
    <div>
      <div class="agent-name">${agent.name || "Council"} ${role}</div>
      <div class="agent-speech-list">
        ${hasMessage ? `<div class="agent-speech">${messageText}</div>` : ""}
      </div>
    </div>
  `;
  return card;
};

const createBootingCard = () => {
  const card = document.createElement("div");
  card.className = "agent-card muted";
  card.id = "booting-card";
  card.innerHTML = `
    <div class="agent-avatar"></div>
    <div>
      <div class="agent-name">Council booting...</div>
      <div class="agent-speech-list">
        <div class="agent-speech">Waiting for debate signal.</div>
      </div>
    </div>
  `;
  return card;
};

const markCouncilBooted = () => {
  const booting = document.getElementById("booting-card");
  councilsBooted = true;
  if (!booting) {
    if (currentSystemRound === 0) {
      setRoundBeginControl(0);
    }
    return;
  }
  const nameEl = booting.querySelector(".agent-name");
  const speechEl = booting.querySelector(".agent-speech");
  if (nameEl) {
    nameEl.textContent = "Council booted..";
  }
  if (speechEl) {
    speechEl.textContent = "All councils loaded and ready.";
  }
  if (currentSystemRound === 0) {
    setRoundBeginControl(0);
  }
};

const removeBootingCard = () => {
  const booting = document.getElementById("booting-card");
  if (booting) {
    booting.remove();
  }
};

const removeStandingBy = (card) => {
  if (!card) {
    return;
  }
  const speechList = card.querySelector(".agent-speech-list");
  if (!speechList) {
    return;
  }
  const entries = Array.from(speechList.querySelectorAll(".agent-speech"));
  entries.forEach((entry) => {
    const text = (entry.textContent || "").trim().toLowerCase();
    if (text === "standing by..." || text === "awaiting signal.") {
      entry.remove();
    }
  });
};


const resetCouncil = (agents = []) => {
  deliberationList.innerHTML = "";
  councilsBooted = true;
  agentCards.clear();
  agentStreamEntries.clear();
  systemNotesContainer = null;
  agentsContainer = null;
  llmMessagesContainer = null;
  otherAgentsContainer = null;
  councilHeaderEl = null;
  councilOrchestratorCardEl = null;
  councilRoundViewsContainer = null;
  systemPanelContainer = null;
  councilPanelContainer = null;
  systemRoundTabsContainer = null;
  systemRoundControlsContainer = null;
  systemRoundViewsContainer = null;
  systemGeneralMessagesContainer = null;
  systemMessagesScrollContainer = null;
  activeSystemRound = null;
  currentSystemRound = null;
  roundContainers.clear();
  councilRoundContainers.clear();
  roundTabLabels.clear();
  ensureSystemNotesContainer();
  ensureAgentsContainer();
  updateCouncilEmptyState();
  agents.forEach((agent) => {
    const card = createAgentCard({
      name: agent.name,
      state: agent.state,
      message: "Standing by...",
      muted: true,
    });
    const key = `0:${agent.name}`;
    agentCards.set(key, card);
    insertAgentCard(card, 0);
  });
};

const resetCouncilDelayed = (agents = [], delayMs = 2000) => {
  deliberationList.innerHTML = "";
  councilsBooted = false;
  agentCards.clear();
  agentStreamEntries.clear();
  pendingCouncilCardTimers.forEach((timer) => clearTimeout(timer));
  pendingCouncilCardTimers = [];
  systemNotesContainer = null;
  agentsContainer = null;
  llmMessagesContainer = null;
  otherAgentsContainer = null;
  councilHeaderEl = null;
  councilOrchestratorCardEl = null;
  councilRoundViewsContainer = null;
  systemPanelContainer = null;
  councilPanelContainer = null;
  systemRoundTabsContainer = null;
  systemRoundControlsContainer = null;
  systemRoundViewsContainer = null;
  systemGeneralMessagesContainer = null;
  systemMessagesScrollContainer = null;
  activeSystemRound = null;
  currentSystemRound = null;
  roundContainers.clear();
  councilRoundContainers.clear();
  roundTabLabels.clear();
  ensureSystemNotesContainer();
  ensureAgentsContainer();
  updateCouncilEmptyState();
  insertAgentCard(createBootingCard(), 0);
  let loadedCount = 0;
  if (!agents.length) {
    markCouncilBooted();
  }
  agents.forEach((agent, index) => {
    const timer = setTimeout(() => {
      if (agentCards.has(`0:${agent.name}`)) {
        return;
      }
      const card = createAgentCard({
        name: agent.name,
        state: agent.state,
        message: "Standing by...",
        muted: true,
      });
      const key = `0:${agent.name}`;
      agentCards.set(key, card);
      insertAgentCard(card, 0);
      loadedCount += 1;
      if (loadedCount >= agents.length) {
        markCouncilBooted();
      }
    }, delayMs * (index + 1));
    pendingCouncilCardTimers.push(timer);
  });
};

const upsertAgentStreamMessage = (payload) => {
  const name = payload.agent || "Council";
  const roundId = normalizeRoundId(payload.round);
  const cardKey = getAgentCardKey(payload);
  agentCards.forEach((existing) => existing.classList.remove("speaking"));
  let card = agentCards.get(cardKey);
  if (!card) {
    card = createAgentCard({ name, state: payload.state, message: "" });
    agentCards.set(cardKey, card);
    insertAgentCard(card, roundId);
  }
  removeBootingCard();
  removeStandingBy(card);

  const speechList = card.querySelector(".agent-speech-list");
  const nameEl = card.querySelector(".agent-name");
  const avatarEl = card.querySelector(".agent-avatar");
  const label = payload.label || "";
  const roundLabel = label ? `${label}: ` : "";
  const streamKey = `${name}:${payload.round ?? ""}:${label}`;
  const hasMessage = Boolean(payload.message && payload.message.trim());

  if (speechList) {
    let entry = agentStreamEntries.get(streamKey);
    if (!entry) {
      entry = document.createElement("div");
      entry.className = "agent-speech";
      if (label) {
        entry.classList.add(`speech-${label.toLowerCase().replace(/\s+/g, "-")}`);
      }
      speechList.appendChild(entry);
      agentStreamEntries.set(streamKey, entry);
    }

    if (hasMessage) {
      removeStandingBy(card);
      entry.classList.remove("loading");
      entry.textContent = `${roundLabel}${payload.message || ""}`;
    } else if (!entry.textContent || entry.classList.contains("loading")) {
      entry.classList.add("loading");
      entry.textContent = "Council member is thinking...";
    }
  }

  if (nameEl && payload.state) {
    nameEl.innerHTML = `${name} <span>${payload.state}</span>`;
  }
  if (avatarEl && payload.state) {
    const avatarData = getStateAvatar(payload.state);
    avatarEl.textContent = avatarData.initials;
    avatarEl.style.background = avatarData.background;
  }
  if (payload.state) {
    card.classList.add(`team-${getStateTeam(payload.state)}`);
  }
  card.classList.remove("muted");
  card.classList.add("speaking");
  if (payload.state) {
    setActiveState(payload.state);
  }
  if (isNearTop(deliberationList)) {
    scrollToTop(deliberationList);
  }
};

const upsertAgentMessage = (payload) => {
  const name = payload.agent || "Council";
  const roundId = normalizeRoundId(payload.round);
  const cardKey = getAgentCardKey(payload);
  agentCards.forEach((existing) => existing.classList.remove("speaking"));
  let card = agentCards.get(cardKey);
  if (!card) {
    card = createAgentCard({ name, state: payload.state, message: payload.message });
    agentCards.set(cardKey, card);
    insertAgentCard(card, roundId);
  } else {
    {
    const speechList = card.querySelector(".agent-speech-list");
    const nameEl = card.querySelector(".agent-name");
    const avatarEl = card.querySelector(".agent-avatar");
    if (speechList) {
      const label = payload.label || "";
      const roundLabel = label ? `${label}: ` : "";
      const entry = document.createElement("div");
      entry.className = "agent-speech";
      if (label) {
        entry.classList.add(`speech-${label.toLowerCase().replace(/\s+/g, "-")}`);
      }
      entry.textContent = `${roundLabel}${payload.message || ""}`;
      speechList.appendChild(entry);
    }
    if (nameEl && payload.state) {
      nameEl.innerHTML = `${name} <span>${payload.state}</span>`;
    }
    if (avatarEl && payload.state) {
      const avatarData = getStateAvatar(payload.state);
      avatarEl.textContent = avatarData.initials;
      avatarEl.style.background = avatarData.background;
    }
    if (payload.state) {
      card.classList.add(`team-${getStateTeam(payload.state)}`);
    }
    card.classList.remove("muted");
    }
  }
  removeBootingCard();
  removeStandingBy(card);

  card.classList.add("speaking");
  if (payload.state) {
    setActiveState(payload.state);
  }
  if (isNearTop(deliberationList)) {
    scrollToTop(deliberationList);
  }
};

const addSystemNote = (message, options = {}) => {
  const note = createAgentCard({ name: "System", message, muted: true });
  const speechList = note.querySelector(".agent-speech-list");
  const isLoading = Boolean(options.loading);
  if (speechList && message?.includes("\n")) {
    speechList.innerHTML = "";
    message.split("\n").forEach((line, index) => {
      const entry = document.createElement("div");
      entry.className = "agent-speech";
      if (isLoading && index === 0) {
        entry.classList.add("loading");
      }
      entry.textContent = line;
      speechList.appendChild(entry);
    });
  } else if (speechList) {
    const entry = speechList.querySelector(".agent-speech");
    if (entry && isLoading) {
      entry.classList.add("loading");
    }
  }
  const roundId = normalizeRoundId(options.round);
  if (roundId !== null) {
    const round = ensureRoundContainer(roundId);
    round?.view.append(note);
    if (activeSystemRound === null) {
      setActiveRound(roundId);
    }
  } else {
    ensureSystemNotesContainer();
    systemGeneralMessagesContainer?.append(note);
  }
  scrollToTop(systemMessagesScrollContainer);
  return note;
};

const streamCardMessage = (card, message, options = {}) =>
  new Promise((resolve) => {
    const speechList = card?.querySelector(".agent-speech-list");
    const text = String(message || "");
    const lines = text.split("\n");
    const speed = Number.isFinite(options.speed) ? options.speed : 50;

    if (!speechList) {
      resolve(card);
      return;
    }

    speechList.innerHTML = "";

    if (!text.trim()) {
      resolve(card);
      return;
    }

    let lineIndex = 0;
    let charIndex = 0;
    let currentEntry = document.createElement("div");
    currentEntry.className = "agent-speech system-streaming";
    if (options.loading) {
      currentEntry.classList.add("loading");
    }
    speechList.appendChild(currentEntry);

    const scrollContainer = options.scrollContainer || null;
    let finished = false;
    let timer = null;

    const finishStream = () => {
      if (finished) {
        return;
      }
      finished = true;
      if (timer) {
        clearInterval(timer);
      }
      resolve(card);
    };

    const step = () => {
      const line = lines[lineIndex] || "";
      if (charIndex <= line.length) {
        currentEntry.textContent = line.slice(0, charIndex);
        charIndex += 1;
        if (scrollContainer) {
          scrollToTop(scrollContainer);
        }
        return;
      }

      currentEntry.classList.remove("system-streaming");
      lineIndex += 1;
      if (lineIndex >= lines.length) {
        finishStream();
        return;
      }

      charIndex = 0;
      currentEntry = document.createElement("div");
      currentEntry.className = "agent-speech system-streaming";
      if (options.loading) {
        currentEntry.classList.add("loading");
      }
      speechList.appendChild(currentEntry);
    };

    timer = setInterval(step, speed);
  });

const streamSystemNote = (message, options = {}) =>
  new Promise((resolve) => {
    const note = createAgentCard({ name: "System", message: "", muted: true });

    const roundId = normalizeRoundId(options.round);
    if (roundId !== null) {
      const round = ensureRoundContainer(roundId);
      round?.view.append(note);
      if (activeSystemRound === null) {
        setActiveRound(roundId);
      }
    } else {
      ensureSystemNotesContainer();
      systemGeneralMessagesContainer?.append(note);
    }
    streamCardMessage(note, message, {
      speed: 50,
      loading: Boolean(options.loading),
      scrollContainer: systemMessagesScrollContainer,
    }).then(() => resolve(note));
  });

const processSystemNoteQueue = async () => {
  if (systemNoteStreaming) {
    return;
  }
  systemNoteStreaming = true;
  try {
    while (systemNoteQueue.length) {
      const item = systemNoteQueue.shift();
      if (!item || !item.message) {
        continue;
      }
      await streamSystemNote(item.message, item.options || {});
    }
  } finally {
    systemNoteStreaming = false;
  }
};
// expose for handlers that may run later or from other scopes
try {
  if (typeof window !== "undefined") {
    window.addSystemNote = addSystemNote;
  }
} catch (e) {
  // ignore
}

// safe wrapper that uses the window property to avoid ReferenceErrors
const safeAddNote = (message, options = {}) => {
  try {
    if (typeof window !== "undefined" && typeof window["addSystemNote"] === "function") {
      if (options?.loading && !options?.stream) {
        return window["addSystemNote"](message, options);
      }
      systemNoteQueue.push({ message, options });
      processSystemNoteQueue();
      return null;
    }
  } catch (e) {
    // ignore
  }
  try {
    console.warn("[SYS NOTE]", message);
  } catch (e) {}
};

const setSystemNoteLoading = (note, isLoading, message) => {
  if (!note) {
    return;
  }
  const speechList = note.querySelector(".agent-speech-list");
  if (!speechList) {
    return;
  }
  const entry = speechList.querySelector(".agent-speech");
  if (!entry) {
    return;
  }
  entry.classList.toggle("loading", Boolean(isLoading));
  if (message) {
    entry.textContent = message;
  }
};

const clearDebateLoading = (payload) => {
  if (!debateLoadingNote) {
    return;
  }
  const message = payload?.message?.trim();
  if (!message) {
    return;
  }
  setSystemNoteLoading(debateLoadingNote, false, "Debate started.");
  debateLoadingNote = null;
};

const clearSystemLoadingIndicators = () => {
  if (!systemNotesContainer) {
    return;
  }
  const loadingEntries = systemNotesContainer.querySelectorAll(".agent-speech.loading");
  loadingEntries.forEach((entry) => entry.classList.remove("loading"));
};

const connectLiveStream = () => {
  if (!window.EventSource) {
    safeAddNote("Updates unsupported in this browser.");
    return;
  }

  const stream = new EventSource("/api/stream");
  stream.addEventListener("open", () => {
    setTopic("Connected. Awaiting update");
    setStatusText(statusConnection, "connected");
  });

  stream.addEventListener("topic", (event) => {
    const data = JSON.parse(event.data);
    setTopic(data.title || "Update");
  });

  stream.addEventListener("feed", (event) => {
    const data = JSON.parse(event.data);
    setActiveFeed(data);
  });

  stream.addEventListener("council_start", (event) => {
    const data = JSON.parse(event.data);
    stateLayer.eachLayer((layer) => {
      layer.getElement()?.classList.remove("active");
      layer.setStyle(baseStateStyle);
    });
    stateImpact.clear();
    resetCouncilDelayed(data.agents || [], 2000);
    if (councilHeaderEl) {
      councilHeaderEl.textContent = "Council's messages";
    }
    setRoundBeginControl(null);
    debateLoadingNote = safeAddNote("Beginning the debate...", { loading: true });
    // lock UI interactions while debate runs
    setDebateLocked(true);
  });

  stream.addEventListener("system", (event) => {
    const data = JSON.parse(event.data);
    if (data.message) {
      safeAddNote(data.message, {
        round: data.round,
        loading: Boolean(data.loading),
        stream: Boolean(data.stream),
      });
    }
  });

  stream.addEventListener("round_start", (event) => {
    const data = JSON.parse(event.data);
    const roundId = normalizeRoundId(data.round);
    if (roundId === null) {
      return;
    }
    if (String(data.label || "").trim().toLowerCase() === "verdict") {
      roundTabLabels.set(roundId, "Verdict");
    }
    clearSystemLoadingIndicators();
    if (councilHeaderEl) {
      councilHeaderEl.textContent = "Council's messages";
    }
    currentSystemRound = roundId;
    ensureRoundContainer(roundId);
    ensureCouncilRoundContainer(roundId);
    setActiveRound(roundId);
    if (roundId === 0 && !councilsBooted) {
      setRoundBeginControl(0, { booting: true });
    } else if (String(data.label || "").trim().toLowerCase() === "verdict") {
      setRoundBeginControl(null);
    } else {
      setRoundBeginControl(roundId);
    }
  });

  stream.addEventListener("panel_selected", (event) => {
    const data = JSON.parse(event.data);

    // Grey out benched states on the map
    if (data.benched) {
      data.benched.forEach((stateName) => {
        const normalized = normalizeStateName(stateName);
        const targets = getStateLayers(normalized);
        targets.forEach((layer) => {
          layer.setStyle({
            className: "state-path",
            fillColor: "#090909",
            fillOpacity: 0.12,
            color: "rgba(255, 255, 255, 0.06)",
            weight: 0.8,
          });
        });
      });
    }
    // Highlight selected states
    if (data.selected) {
      data.selected.forEach((stateName) => {
        const normalized = normalizeStateName(stateName);
        const targets = getStateLayers(normalized);
        targets.forEach((layer) => {
          layer.setStyle(activeStateStyle);
        });
      });
    }
    // Dim benched agent cards
    if (data.benched) {
      data.benched.forEach((stateName) => {
        agentCards.forEach((card, name) => {
          if (name.includes(stateName)) {
            card.classList.add("benched");
          }
        });
      });
    }
  });

  stream.addEventListener("rebuttal_selected", (event) => {
    JSON.parse(event.data);
  });

  stream.addEventListener("reply_selected", (event) => {
    JSON.parse(event.data);
  });

  stream.addEventListener("round_summary", (event) => {
    const data = JSON.parse(event.data);
    const isCompact = Boolean(layoutElement?.classList.contains("compact-mode"));
    if (!isCompact || !data?.message) {
      return;
    }
    const roundId = normalizeRoundId(data.round);
    if (roundId === null) {
      return;
    }
    const label = data.label || `Round ${roundId}`;
    safeAddNote(`${label} Summary\n${data.message}`, { round: roundId });
  });

  stream.addEventListener("agent", (event) => {
    const data = JSON.parse(event.data);
    upsertAgentMessage(data);
    clearDebateLoading(data);
  });

  stream.addEventListener("agent_start", (event) => {
    const data = JSON.parse(event.data);
    upsertAgentStreamMessage({ ...data, message: "" });
  });

  stream.addEventListener("agent_delta", (event) => {
    const data = JSON.parse(event.data);
    upsertAgentStreamMessage(data);
    clearDebateLoading(data);
  });

  stream.addEventListener("agent_end", (event) => {
    const data = JSON.parse(event.data);
    upsertAgentStreamMessage(data);
    clearDebateLoading(data);
  });

  stream.addEventListener("council_end", (event) => {
    const data = JSON.parse(event.data);
    const resultRoundId = normalizeRoundId(data.round);
    if (currentSystemRound !== null) {
      addCompletedRoundTab(currentSystemRound);
      setActiveSystemRound(currentSystemRound);
    }
    setRoundBeginControl(null);
    if (data.summary) {
      if (resultRoundId !== null) {
        safeAddNote(data.summary, { round: resultRoundId });
      } else {
        safeAddNote(data.summary);
      }
    }
    if (data.winner || data.loser) {
      const winner = data.winner ? `Winner: ${data.winner}` : "Winner: n/a";
      const loser = data.loser ? `Loser: ${data.loser}` : "Loser: n/a";
      if (resultRoundId !== null) {
        safeAddNote(`${winner}. ${loser}.`, { round: resultRoundId });
      } else {
        safeAddNote(`${winner}. ${loser}.`);
      }
    }

    if (activeFeedCard) {
      const badge = activeFeedCard.querySelector(".badge");
      if (badge) {
        badge.textContent = "Completed";
        badge.classList.remove("processing");
        badge.classList.add("completed");
      }
      activeFeedCard.classList.remove("active", "processing");
      activeFeedCard = null;
      insertWaitingCard();
    }
    
    stateLayer.eachLayer((layer) => {
      layer.getElement()?.classList.remove("active");
      layer.setStyle(baseStateStyle);
    });
    stateImpact.clear();
    
    if (data.winner) {
      setStateImpact(data.winner, "positive");
    }
    if (data.loser) {
      setStateImpact(data.loser, "negative");
    }

    // unlock UI
    stopDebateRunningIndicator();
    setDebateLocked(false);
    if (fetchNextBtn) {
      fetchNextBtn.disabled = false;
      fetchNextBtn.classList.remove("is-loading");
      fetchNextBtn.textContent = "Start Debate";
    }
  });

  stream.addEventListener("status", (event) => {
    const data = JSON.parse(event.data);
    if (data.message) {
      safeAddNote(data.message);
    }
    if (data.provider) {
      setStatusText(statusProvider, `news: ${data.provider}`);
    }
    if (data.model) {
      setStatusText(statusModel, `model: ${data.model}`);
    }
    if (data.connection) {
      setStatusText(statusConnection, data.connection);
    }
  });

  stream.addEventListener("error", () => {
    safeAddNote("Stream disconnected. Retrying...");
    setStatusText(statusConnection, "reconnecting");
  });
};

if (fetchNextBtn) {
  console.log("[BOOT] Start Debate button found, binding click handler");
  fetchNextBtn.addEventListener("click", async () => {
    console.log("[UI] Start Debate clicked, fetchLocked=", fetchLocked);
    if (fetchLocked) {
      return;
    }
    fetchLocked = true;
    setDebateLocked(true);
    fetchNextBtn.disabled = true;
    fetchNextBtn.classList.add("is-loading");
    fetchNextBtn.textContent = "Starting Debate";
    stateLayer.eachLayer((layer) => {
      layer.getElement()?.classList.remove("active");
      layer.setStyle(baseStateStyle);
    });
    stateImpact.clear();
    try {
      let query = topicInput?.value?.trim() || "";
      if (!query) {
        query = "Top headlines India";
        safeAddNote("No topic provided — fetching top headlines for India...", { loading: true });
      }
      setTopic(query);
      await fetch("/api/next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
    } catch (error) {
      stopDebateRunningIndicator();
      setDebateLocked(false);
      fetchNextBtn.disabled = false;
      fetchNextBtn.classList.remove("is-loading");
      fetchNextBtn.textContent = "Start Debate";
      safeAddNote("Failed to fetch next news item.");
    }
  });
}

ensureSystemNotesContainer();
ensureAgentsContainer();

connectLiveStream();
