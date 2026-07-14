const screenLoading = document.getElementById("screenLoading");
const inboxShell = document.getElementById("inboxShell");
const threadListEl = document.getElementById("threadList");

let myLink = "";

(async function init() {
  const s = await ensureSession();
  if (!s) {
    screenLoading.querySelector("p").textContent = "Couldn't start a session. Please refresh.";
    return;
  }

  myLink = `${location.origin}${location.pathname.replace(/inbox\.html$/, "")}chat.html?to=${session.user.id}`;
  document.getElementById("myLinkBox").textContent = myLink;
  document.getElementById("myQrImg").src =
    `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(myLink)}`;

  screenLoading.classList.add("hidden");
  inboxShell.classList.remove("hidden");

  loadThreads();
  setInterval(loadThreads, 5000);
})();

document.getElementById("copyMyLinkBtn").addEventListener("click", () => {
  navigator.clipboard.writeText(myLink);
  const btn = document.getElementById("copyMyLinkBtn");
  const original = btn.textContent;
  btn.textContent = "Copied!";
  setTimeout(() => (btn.textContent = original), 1500);
});

document.getElementById("toggleMyQrBtn").addEventListener("click", () => {
  const box = document.getElementById("myQrBox");
  const btn = document.getElementById("toggleMyQrBtn");
  box.classList.toggle("hidden");
  btn.textContent = box.classList.contains("hidden") ? "Show QR code" : "Hide QR code";
});

async function loadThreads() {
  const { data: threads, error } = await sb
    .from("chat_threads")
    .select("*")
    .or(`creator_id.eq.${session.user.id},guest_id.eq.${session.user.id}`)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to load threads:", error);
    return;
  }

  if (!threads.length) {
    threadListEl.innerHTML = `
      <div class="empty-inbox glass" style="border-radius: var(--radius-lg);">
        <div class="icon">📭</div>
        <p>Nothing here yet.</p>
        <p style="font-size:12.5px; color:var(--text-faint); margin-top:6px;">Share your link above, or open someone else's, to get started.</p>
      </div>`;
    return;
  }

  const threadIds = threads.map((t) => t.id);
  const { data: messages } = await sb
    .from("chat_messages")
    .select("thread_id, sender_id, content, created_at")
    .in("thread_id", threadIds)
    .order("created_at", { ascending: false });

  const previewByThread = new Map();
  (messages || []).forEach((m) => {
    if (!previewByThread.has(m.thread_id)) previewByThread.set(m.thread_id, m);
  });

  const received = threads.filter((t) => t.creator_id === session.user.id);
  const started = threads.filter((t) => t.guest_id === session.user.id);

  threadListEl.innerHTML = "";

  if (received.length) {
    threadListEl.appendChild(sectionTitle("People who messaged you"));
    received.forEach((t) => threadListEl.appendChild(threadCard(t, previewByThread)));
  }

  if (started.length) {
    threadListEl.appendChild(sectionTitle("Chats you started"));
    started.forEach((t) => threadListEl.appendChild(threadCard(t, previewByThread)));
  }
}

function sectionTitle(text) {
  const el = document.createElement("div");
  el.className = "inbox-section-title";
  el.textContent = text;
  return el;
}

function threadCard(t, previewByThread) {
  const isCreator = t.creator_id === session.user.id;
  const otherUserId = isCreator ? t.guest_id : t.creator_id;
  const myLastRead = isCreator ? t.creator_last_read_at : t.guest_last_read_at;
  const tag = tagFor(otherUserId);
  const preview = previewByThread.get(t.id);

  const isUnread =
    preview &&
    preview.sender_id !== session.user.id &&
    (!myLastRead || new Date(preview.created_at) > new Date(myLastRead));

  const card = document.createElement("div");
  card.className = "thread-card glass";
  card.innerHTML = `
    <div class="thread-info">
      ${isUnread ? '<span class="unread-dot"></span>' : ""}
      <div class="thread-text">
        <div class="thread-tag" style="color:${tag.color}">${escapeHtml(tag.label)}</div>
        <div class="thread-preview">${preview ? escapeHtml(preview.content) : "No messages yet"}</div>
      </div>
    </div>
    <div class="thread-meta">
      <div class="thread-time">${timeRemaining(t.expires_at)}</div>
    </div>
  `;
  card.addEventListener("click", () => {
    window.location.href = `chat.html?thread=${t.id}`;
  });
  return card;
}
