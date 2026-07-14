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

let thread = null;
let otherUserId = null;
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
const expiryPill = document.getElementById("expiryPill");
const chatTitleEl = document.getElementById("chatTitle");
const backBtn = document.getElementById("backBtn");

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
  const toId = params.get("to");
  const threadId = params.get("thread");

  if (toId) {
    if (toId === session.user.id) {
      // creator opened their own share link — send them to the inbox instead
      window.location.href = "inbox.html";
      return;
    }
    thread = await findOrCreateThread(toId);
    backBtn.href = "inbox.html";
  } else if (threadId) {
    thread = await getThreadById(threadId);
    backBtn.href = "inbox.html";
  } else {
    showScreen("error");
    return;
  }

  if (!thread) {
    showScreen("error");
    return;
  }

  if (new Date(thread.expires_at).getTime() <= Date.now()) {
    showScreen("expired");
    return;
  }

  otherUserId = thread.creator_id === session.user.id ? thread.guest_id : thread.creator_id;
  const tag = tagFor(otherUserId);
  chatTitleEl.textContent = tag.label;
  chatTitleEl.style.color = tag.color;

  enterChat();
})();

async function findOrCreateThread(creatorId) {
  const { data: existing, error: findErr } = await sb
    .from("chat_threads")
    .select("*")
    .eq("creator_id", creatorId)
    .eq("guest_id", session.user.id)
    .maybeSingle();

  if (findErr) console.error("Thread lookup failed:", findErr);
  if (existing) return existing;

  const { data: created, error: createErr } = await sb
    .from("chat_threads")
    .insert({ creator_id: creatorId, guest_id: session.user.id })
    .select()
    .single();

  if (createErr) {
    console.error("Thread creation failed:", createErr);
    return null;
  }
  return created;
}

async function getThreadById(id) {
  const { data, error } = await sb.from("chat_threads").select("*").eq("id", id).maybeSingle();
  if (error) console.error("Thread fetch failed:", error);
  return data;
}

/* ============================================================
   Expiry pill
   ============================================================ */
function updateExpiryPill() {
  const label = timeRemaining(thread.expires_at);
  expiryPill.textContent = label;
  const msLeft = new Date(thread.expires_at).getTime() - Date.now();
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
    markThreadRead();
    subscribeRealtime();
    startPolling();
  });
}

async function markThreadRead() {
  const field = thread.creator_id === session.user.id ? "creator_last_read_at" : "guest_last_read_at";
  const { error } = await sb
    .from("chat_threads")
    .update({ [field]: new Date().toISOString() })
    .eq("id", thread.id);
  if (error) console.error("Failed to mark thread read:", error);
}

function renderMessage(msg, { animate = true } = {}) {
  emptyStateEl.classList.add("hidden");

  const mine = msg.sender_id === session.user.id;

  const row = document.createElement("div");
  row.className = `msg-row ${mine ? "mine" : "theirs"}`;
  if (!animate) row.style.animation = "none";

  const wrap = document.createElement("div");
  wrap.className = "bubble-wrap";

  if (msg.reply_to_id) {
    const quote = document.createElement("div");
    quote.className = "reply-quote";
    const authorLabel = msg.reply_sender_id === session.user.id ? "You" : tagFor(otherUserId).label;
    quote.innerHTML = `
      <div class="reply-quote-author">${escapeHtml(authorLabel)}</div>
      <div class="reply-quote-text">${escapeHtml(msg.reply_preview || "")}</div>
    `;
    quote.addEventListener("click", () => jumpToMessage(msg.reply_to_id));
    wrap.appendChild(quote);
  }

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

  attachLongPress(bubble, {
    onLongPress: () => {
      const actions = [
        { label: "Reply", onClick: () => startReply(msg) },
        { label: "Copy text", onClick: () => { navigator.clipboard.writeText(msg.content); showToast("Copied to clipboard"); } },
      ];
      if (mine) {
        actions.push({ label: "Delete message", danger: true, onClick: () => deleteMessage(msg.id) });
      }
      showActionSheet(actions);
    },
  });

  attachSwipeToReply(row, wrap, () => startReply(msg));

  const time = document.createElement("div");
  time.className = "msg-time";
  time.textContent = formatTime(msg.created_at);
  row.appendChild(time);

  messagesEl.appendChild(row);
  if (msg.id != null) rowsById.set(msg.id, row);
  return row;
}

function jumpToMessage(id) {
  const row = rowsById.get(id);
  if (!row) {
    showToast("Original message no longer available");
    return;
  }
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  row.classList.add("flash-highlight");
  setTimeout(() => row.classList.remove("flash-highlight"), 1000);
}

function removeMessageRow(id) {
  const row = rowsById.get(id);
  if (!row) return;
  row.classList.add("removing");
  setTimeout(() => row.remove(), 200);
  rowsById.delete(id);
}

async function deleteMessage(id) {
  const { error } = await sb.from("chat_messages").delete().eq("id", id);
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
    .from("chat_messages")
    .select("*")
    .eq("thread_id", thread.id)
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

function subscribeRealtime() {
  setStatus("connecting");

  realtimeChannel = sb.channel(`chat-thread:${thread.id}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "chat_messages" },
      (payload) => {
        const msg = payload.new;
        if (msg.thread_id !== thread.id) return;
        if (rowsById.has(msg.id)) return;

        hideTypingIndicator();
        const wasNearBottom = isNearBottom;
        renderMessage(msg);
        markThreadRead();
        if (msg.sender_id !== session.user.id) {
          notifyNewMessage(msg.sender_id, tagFor(otherUserId).label, msg.content);
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
      { event: "DELETE", schema: "public", table: "chat_messages" },
      (payload) => {
        if (payload.old.thread_id && payload.old.thread_id !== thread.id) return;
        removeMessageRow(payload.old.id);
      }
    )
    .on("broadcast", { event: "typing" }, (msg) => {
      if (msg.payload.userId === session.user.id) return;
      showTypingIndicator();
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") setStatus("connected");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setStatus("error");
      else if (status === "CLOSED") setStatus("connecting");
    });
}

/* ============================================================
   Typing indicator
   ============================================================ */
let lastTypingSentAt = 0;
let typingHideTimer = null;

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

function showTypingIndicator() {
  let el = document.getElementById("typingIndicatorRow");
  if (!el) {
    el = document.createElement("div");
    el.id = "typingIndicatorRow";
    el.className = "msg-row theirs";
    el.innerHTML = `<div class="typing-indicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>`;
    messagesEl.appendChild(el);
    if (isNearBottom) scrollToBottom(true);
  }
  clearTimeout(typingHideTimer);
  typingHideTimer = setTimeout(hideTypingIndicator, 3000);
}

function hideTypingIndicator() {
  const el = document.getElementById("typingIndicatorRow");
  if (el) el.remove();
  clearTimeout(typingHideTimer);
}

const POLL_INTERVAL_MS = 4000;

function startPolling() {
  setInterval(async () => {
    const { data, error } = await sb
      .from("chat_messages")
      .select("*")
      .eq("thread_id", thread.id)
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
        hideTypingIndicator();
        renderMessage(msg);
        addedAny = true;
        if (msg.sender_id !== session.user.id) {
          notifyNewMessage(msg.sender_id, tagFor(otherUserId).label, msg.content);
        }
      }
    });

    if (addedAny) {
      markThreadRead();
      if (wasNearBottom) scrollToBottom(true);
      else {
        unseenCount += 1;
        jumpBtn.textContent = `↓ ${unseenCount} new message${unseenCount > 1 ? "s" : ""}`;
        jumpBtn.classList.remove("hidden");
      }
    }
  }, POLL_INTERVAL_MS);
}

let replyingTo = null;
const replyStripEl = document.getElementById("replyStrip");
const replyStripCancelBtn = document.getElementById("replyStripCancel");

function startReply(msg) {
  replyingTo = {
    id: msg.id,
    preview: msg.content.slice(0, 140),
    senderId: msg.sender_id,
  };
  const authorLabel = msg.sender_id === session.user.id ? "You" : tagFor(otherUserId).label;
  document.getElementById("replyStripAuthor").textContent = `Replying to ${authorLabel}`;
  document.getElementById("replyStripPreview").textContent = replyingTo.preview;
  replyStripEl.classList.remove("hidden");
  inputEl.focus();
}

function cancelReply() {
  replyingTo = null;
  replyStripEl.classList.add("hidden");
}

replyStripCancelBtn.addEventListener("click", cancelReply);

async function sendMessage() {
  const content = inputEl.value.trim();
  if (!content) return;

  sendBtn.disabled = true;

  const payload = { thread_id: thread.id, sender_id: session.user.id, content };
  if (replyingTo) {
    payload.reply_to_id = replyingTo.id;
    payload.reply_preview = replyingTo.preview;
    payload.reply_sender_id = replyingTo.senderId;
  }

  const { data, error } = await sb
    .from("chat_messages")
    .insert(payload)
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
  cancelReply();

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
