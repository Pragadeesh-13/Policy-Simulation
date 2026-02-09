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
const topicText = document.getElementById("topic-text");
const agentCards = new Map();
const statusConnection = document.getElementById("status-connection");
const statusProvider = document.getElementById("status-provider");
const statusModel = document.getElementById("status-model");
const fetchNextBtn = document.getElementById("fetch-next");
const topicInput = document.getElementById("topic-input");
const stateImpact = new Map();
const agentStreamEntries = new Map();
let debateLoadingNote = null;
let activeFeedCard = null;
let fetchLocked = false;
let pendingCouncilCardTimers = [];
let systemNotesContainer = null;
let agentsContainer = null;

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

const ensureSystemNotesContainer = () => {
  if (systemNotesContainer && systemNotesContainer.parentElement === deliberationList) {
    return systemNotesContainer;
  }
  const container = document.createElement("div");
  container.className = "system-notes";
  deliberationList.prepend(container);
  systemNotesContainer = container;
  return container;
};

const ensureAgentsContainer = () => {
  if (agentsContainer && agentsContainer.parentElement === deliberationList) {
    return agentsContainer;
  }
  const container = document.createElement("div");
  container.className = "agent-list";
  const systemContainer = ensureSystemNotesContainer();
  if (systemContainer.nextSibling) {
    deliberationList.insertBefore(container, systemContainer.nextSibling);
  } else {
    deliberationList.appendChild(container);
  }
  agentsContainer = container;
  return container;
};

const insertAgentCard = (card) => {
  const container = ensureAgentsContainer();
  container.appendChild(card);
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
    <h3>Waiting for live news...</h3>
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
        <div class="agent-speech">Waiting for live debate signal.</div>
      </div>
    </div>
  `;
  return card;
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
  agentCards.clear();
  agentStreamEntries.clear();
  systemNotesContainer = null;
  agentsContainer = null;
  ensureSystemNotesContainer();
  ensureAgentsContainer();
  agents.forEach((agent) => {
    const card = createAgentCard({
      name: agent.name,
      state: agent.state,
      message: "Standing by...",
      muted: true,
    });
    agentCards.set(agent.name, card);
    insertAgentCard(card);
  });
};

const resetCouncilDelayed = (agents = [], delayMs = 2000) => {
  deliberationList.innerHTML = "";
  agentCards.clear();
  agentStreamEntries.clear();
  pendingCouncilCardTimers.forEach((timer) => clearTimeout(timer));
  pendingCouncilCardTimers = [];
  systemNotesContainer = null;
  agentsContainer = null;
  ensureSystemNotesContainer();
  ensureAgentsContainer();
  insertAgentCard(createBootingCard());
  agents.forEach((agent, index) => {
    const timer = setTimeout(() => {
      if (agentCards.has(agent.name)) {
        return;
      }
      const card = createAgentCard({
        name: agent.name,
        state: agent.state,
        message: "Standing by...",
        muted: true,
      });
      agentCards.set(agent.name, card);
      insertAgentCard(card);
    }, delayMs * (index + 1));
    pendingCouncilCardTimers.push(timer);
  });
};

const upsertAgentStreamMessage = (payload) => {
  const name = payload.agent || "Council";
  agentCards.forEach((existing) => existing.classList.remove("speaking"));
  let card = agentCards.get(name);
  if (!card) {
    card = createAgentCard({ name, state: payload.state, message: "" });
    agentCards.set(name, card);
    insertAgentCard(card);
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

  if (speechList && hasMessage) {
    removeStandingBy(card);
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
    entry.textContent = `${roundLabel}${payload.message || ""}`;
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
  agentCards.forEach((existing) => existing.classList.remove("speaking"));
  let card = agentCards.get(name);
  if (!card) {
    card = createAgentCard({ name, state: payload.state, message: payload.message });
    agentCards.set(name, card);
    insertAgentCard(card);
  } else {
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
  const container = ensureSystemNotesContainer();
  container.prepend(note);
  if (isNearTop(deliberationList)) {
    scrollToTop(deliberationList);
  }
  return note;
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

const connectLiveStream = () => {
  if (!window.EventSource) {
    addSystemNote("Live updates unsupported in this browser.");
    return;
  }

  const stream = new EventSource("/api/stream");
  stream.addEventListener("open", () => {
    setTopic("Connected. Awaiting live update");
    setStatusText(statusConnection, "online");
  });

  stream.addEventListener("topic", (event) => {
    const data = JSON.parse(event.data);
    setTopic(data.title || "Live update");
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
    debateLoadingNote = addSystemNote("Beginning the debate...", { loading: true });
  });

  stream.addEventListener("system", (event) => {
    const data = JSON.parse(event.data);
    if (data.message) {
      addSystemNote(data.message);
    }
  });

  stream.addEventListener("round_start", (event) => {
    const data = JSON.parse(event.data);
    const label = data.label || `Round ${data.round}`;
    const count = data.count || "?";
    const order = data.order ? data.order.join(" → ") : "";
    const message = order
      ? `── ${label} (${count} speakers) ──\nOrder: ${order}`
      : `── ${label} (${count} speakers) ──`;
    addSystemNote(message);
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
    const data = JSON.parse(event.data);
    if (data.rebuttal_panel) {
      addSystemNote(`Rebuttal panel: ${data.rebuttal_panel.join(", ")}`);
    }
  });

  stream.addEventListener("reply_selected", (event) => {
    const data = JSON.parse(event.data);
    if (data.reply_state) {
      addSystemNote(`Right of Reply granted to: ${data.reply_state}`);
    }
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
    if (data.summary) {
      addSystemNote(data.summary);
    }
    if (data.winner || data.loser) {
      const winner = data.winner ? `Winner: ${data.winner}` : "Winner: n/a";
      const loser = data.loser ? `Loser: ${data.loser}` : "Loser: n/a";
      addSystemNote(`${winner}. ${loser}.`);
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

    fetchLocked = false;
    if (fetchNextBtn) {
      fetchNextBtn.disabled = false;
      fetchNextBtn.classList.remove("is-loading");
      fetchNextBtn.textContent = "Fetch next";
    }
  });

  stream.addEventListener("status", (event) => {
    const data = JSON.parse(event.data);
    if (data.message) {
      addSystemNote(data.message);
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
    addSystemNote("Live stream disconnected. Retrying...");
    setStatusText(statusConnection, "reconnecting");
  });
};

if (fetchNextBtn) {
  fetchNextBtn.addEventListener("click", async () => {
    if (fetchLocked) {
      return;
    }
    fetchLocked = true;
    fetchNextBtn.disabled = true;
    fetchNextBtn.classList.add("is-loading");
    fetchNextBtn.textContent = "Fetching...";
    stateLayer.eachLayer((layer) => {
      layer.getElement()?.classList.remove("active");
      layer.setStyle(baseStateStyle);
    });
    stateImpact.clear();
    try {
      const query = topicInput?.value?.trim() || "";
      await fetch("/api/next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
    } catch (error) {
      fetchLocked = false;
      fetchNextBtn.disabled = false;
      fetchNextBtn.classList.remove("is-loading");
      fetchNextBtn.textContent = "Fetch next";
      addSystemNote("Failed to fetch next news item.");
    }
  });
}

connectLiveStream();
