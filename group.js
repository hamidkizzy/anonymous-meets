const screens = {
  loading: document.getElementById("screenLoading"),
  expired: document.getElementById("screenExpired"),
  error: document.getElementById("screenError"),
  chat: document.getElementById("chatApp"),
};

function showScreen(name) {
  Object.values(screens).forEach((el) => el.classList.add("hidden"));
  screens[name].classList.remove("hidden");
}

let group = null;
const MAX_LEN = 500;
let isNearBottom = true;
let unseenCount = 0;
const rowsById = new Map();

const messagesEl = document.getElementById("messages");
const emptyStateEl = document.getElementById("emptyState");
const inputEl = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const charCountEl = document.getElementById("charCount");
const jumpBtn = document.getElementById("jumpToLatest");
const statusDot = document.getElementById("statusDot");
const onlineCountEl = document.getElementById("onlineCount");
const expiryPill = document.getElementById("expiryPill");
const groupTitleEl = document.getElementById("groupTitle");

/* ============================================================
   Init
   ============================================================ */
(async function init() {
  const s = await ensureSession();
  if (!s) {
    screens.loading.querySelector("p").textContent = "Couldn't start a session. Please refresh.";
    return;
  }

  const params = new URLSearchParams(location.search);
  const groupId = params.get("g");

  if (!groupId) {
    showScreen("error");
    return;
  }

  const { data, error } = await sb.from("groups").select("*").eq("id", groupId).maybeSingle();
  if (error) console.error("Group lookup failed:", error);

  if (!data) {
    showScreen("error");
    return;
  }

  if (new Date(data.expires_at).getTime() <= Date.now()) {
    showScreen("expired");
    return;
  }

  group = data;
  groupTitleEl.textContent = group.name;
  enterChat();
})();

function updateExpiryPill() {
  const label = timeRemaining(group.expires_at);
  expiryPill.textContent = label;
  const msLeft = new Date(group.expires_at).getTime() - Date.now();
  expiryPill.classList.toggle("urgent", msLeft < 3600000);
  if (msLeft <= 0) showScreen("expired");
}

/* ============================================================
   Chat
   ============================================================ */
function enterChat() {
  showScreen("chat");
  setupNotifButton(document.getElementById("enableNotifsBtn"));
  updateExpiryPill();
  setInterval(updateExpiryPill, 30000);

  loadHistory().then(() => {
    subscribeRealtime();
    subscribePresence();
    startPolling();
  });
}

function renderMessage(msg, { animate = true } = {}) {
  emptyStateEl.classList.add("hidden");

  const mine = msg.sender_id === session.user.id;
  const tag = tagFor(msg.sender_id);

  const row = document.createElement("div");
  row.className = `msg-row ${mine ? "mine" : "theirs"}`;
  if (!animate) row.style.animation = "none";

  if (!mine) {
    const tagEl = document.createElement("div");
    tagEl.className = "msg-tag";
    tagEl.style.color = tag.color;
    tagEl.textContent = tag.label;
    row.appendChild(tagEl);
  }

  const wrap = document.createElement("div");
  wrap.className = "bubble-wrap";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = msg.content;
  wrap.appendChild(bubble);

  if (mine) {
    const delBtn = document.createElement("button");
    delBtn.className = "delete-btn";
    delBtn.setAttribute("aria-label", "Delete message");
    delBtn.textContent = "×";
    delBtn.addEventListener("click", () => deleteMessage(msg.id));
    wrap.appendChild(delBtn);
  }

  row.appendChild(wrap);

  const time = document.createElement("div");
  time.className = "msg-time";
  time.textContent = formatTime(msg.created_at);
  row.appendChild(time);

  messagesEl.appendChild(row);
  if (msg.id != null) rowsById.set(msg.id, row);
  return row;
}

function removeMessageRow(id) {
  const row = rowsById.get(id);
  if (!row) return;
  row.classList.add("removing");
  setTimeout(() => row.remove(), 200);
  rowsById.delete(id);
}

async function deleteMessage(id) {
  const { error } = await sb.from("group_messages").delete().eq("id", id);
  if (error) {
    console.error("Delete failed:", error);
    return;
  }
  removeMessageRow(id);
}

function scrollToBottom(smooth = true) {
  messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  unseenCount = 0;
  jumpBtn.classList.add("hidden");
}

function checkNearBottom() {
  const threshold = 80;
  isNearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < threshold;
  if (isNearBottom) {
    unseenCount = 0;
    jumpBtn.classList.add("hidden");
  }
}

messagesEl.addEventListener("scroll", checkNearBottom);
jumpBtn.addEventListener("click", () => scrollToBottom(true));

async function loadHistory() {
  const { data, error } = await sb
    .from("group_messages")
    .select("*")
    .eq("group_id", group.id)
    .order("created_at", { ascending: true })
    .limit(300);

  if (error) {
    console.error("Failed to load messages:", error);
    return;
  }
  data.forEach((msg) => renderMessage(msg, { animate: false }));
  scrollToBottom(false);
}

function setStatus(state) {
  statusDot.className = `status-dot ${state}`;
}

let realtimeChannel = null;
const typingUsers = new Map();

function subscribeRealtime() {
  setStatus("connecting");

  realtimeChannel = sb.channel(`group-messages:${group.id}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "group_messages" },
      (payload) => {
        const msg = payload.new;
        if (msg.group_id !== group.id) return;
        if (rowsById.has(msg.id)) return;

        clearTypingUser(msg.sender_id);
        const wasNearBottom = isNearBottom;
        renderMessage(msg);
        if (msg.sender_id !== session.user.id) {
          notifyNewMessage(msg.sender_id, `${tagFor(msg.sender_id).label} — ${group.name}`, msg.content);
        }

        if (wasNearBottom) {
          scrollToBottom(true);
        } else {
          unseenCount += 1;
          jumpBtn.textContent = `↓ ${unseenCount} new message${unseenCount > 1 ? "s" : ""}`;
          jumpBtn.classList.remove("hidden");
        }
      }
    )
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "group_messages" },
      (payload) => {
        if (payload.old.group_id && payload.old.group_id !== group.id) return;
        removeMessageRow(payload.old.id);
      }
    )
    .on("broadcast", { event: "typing" }, (msg) => {
      if (msg.payload.userId === session.user.id) return;
      showTypingUser(msg.payload.userId);
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") setStatus("connected");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setStatus("error");
      else if (status === "CLOSED") setStatus("connecting");
    });
}

/* ============================================================
   Typing indicator — tracks multiple simultaneous typers
   ============================================================ */
let lastTypingSentAt = 0;

function broadcastTyping() {
  if (!realtimeChannel) return;
  const now = Date.now();
  if (now - lastTypingSentAt < 2000) return;
  lastTypingSentAt = now;
  realtimeChannel.send({
    type: "broadcast",
    event: "typing",
    payload: { userId: session.user.id },
  });
}

function showTypingUser(userId) {
  if (typingUsers.has(userId)) clearTimeout(typingUsers.get(userId));
  const timeout = setTimeout(() => clearTypingUser(userId), 3000);
  typingUsers.set(userId, timeout);
  renderTypingIndicator();
}

function clearTypingUser(userId) {
  if (typingUsers.has(userId)) {
    clearTimeout(typingUsers.get(userId));
    typingUsers.delete(userId);
    renderTypingIndicator();
  }
}

function renderTypingIndicator() {
  let el = document.getElementById("typingIndicatorRow");

  if (typingUsers.size === 0) {
    if (el) el.remove();
    return;
  }

  const names = Array.from(typingUsers.keys()).map((id) => tagFor(id).label);
  const text = names.length === 1 ? `${names[0]} is typing` : `${names.length} people are typing`;

  if (!el) {
    el = document.createElement("div");
    el.id = "typingIndicatorRow";
    el.className = "msg-row theirs";
    messagesEl.appendChild(el);
    if (isNearBottom) scrollToBottom(true);
  }

  el.innerHTML = `
    <div class="msg-tag" style="color:var(--text-muted)">${escapeHtml(text)}</div>
    <div class="typing-indicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
  `;
}

function subscribePresence() {
  const presenceChannel = sb.channel(`presence:${group.id}`, {
    config: { presence: { key: session.user.id } },
  });

  presenceChannel
    .on("presence", { event: "sync" }, () => {
      const state = presenceChannel.presenceState();
      const count = Object.keys(state).length;
      onlineCountEl.textContent = `${count} online`;
      onlineCountEl.classList.remove("hidden");
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await presenceChannel.track({ online_at: new Date().toISOString() });
      }
    });
}

const POLL_INTERVAL_MS = 4000;

function startPolling() {
  setInterval(async () => {
    const { data, error } = await sb
      .from("group_messages")
      .select("*")
      .eq("group_id", group.id)
      .order("created_at", { ascending: true })
      .limit(300);

    if (error || !data) return;

    const currentIds = new Set(data.map((m) => m.id));
    Array.from(rowsById.keys()).forEach((id) => {
      if (!currentIds.has(id)) removeMessageRow(id);
    });

    const wasNearBottom = isNearBottom;
    let addedAny = false;

    data.forEach((msg) => {
      if (!rowsById.has(msg.id)) {
        clearTypingUser(msg.sender_id);
        renderMessage(msg);
        addedAny = true;
        if (msg.sender_id !== session.user.id) {
          notifyNewMessage(msg.sender_id, `${tagFor(msg.sender_id).label} — ${group.name}`, msg.content);
        }
      }
    });

    if (addedAny) {
      if (wasNearBottom) scrollToBottom(true);
      else {
        unseenCount += 1;
        jumpBtn.textContent = `↓ ${unseenCount} new message${unseenCount > 1 ? "s" : ""}`;
        jumpBtn.classList.remove("hidden");
      }
    }
  }, POLL_INTERVAL_MS);
}

async function sendMessage() {
  const content = inputEl.value.trim();
  if (!content) return;

  sendBtn.disabled = true;

  const { data, error } = await sb
    .from("group_messages")
    .insert({ group_id: group.id, sender_id: session.user.id, content })
    .select()
    .single();

  if (error) {
    console.error("Send failed:", error);
    sendBtn.disabled = false;
    return;
  }

  inputEl.value = "";
  autoResize();
  updateCharCount();
  sendBtn.disabled = false;
  inputEl.focus();

  if (data && !rowsById.has(data.id)) {
    const wasNearBottom = isNearBottom;
    renderMessage(data);
    if (wasNearBottom) scrollToBottom(true);
  }
}

function autoResize() {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px";
}

function updateCharCount() {
  const len = inputEl.value.length;
  charCountEl.textContent = `${len}/${MAX_LEN}`;
  charCountEl.classList.toggle("limit", len >= MAX_LEN - 20);
}

inputEl.addEventListener("input", () => {
  autoResize();
  updateCharCount();
  broadcastTyping();
});

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendBtn.addEventListener("click", sendMessage);
updateCharCount();
