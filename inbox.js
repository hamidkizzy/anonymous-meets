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

let activeTab = "received";
let latestReceived = [];
let latestStarted = [];

document.getElementById("tabReceived").addEventListener("click", () => switchTab("received"));
document.getElementById("tabSent").addEventListener("click", () => switchTab("sent"));

function switchTab(tab) {
  activeTab = tab;
  document.getElementById("tabReceived").classList.toggle("active", tab === "received");
  document.getElementById("tabSent").classList.toggle("active", tab === "sent");
  renderActiveTab();
}

async function loadThreads() {
  const { data: threads, error } = await sb
    .from("chat_threads")
    .select("*")
    .or(`creator_id.eq.${session.user.id},guest_id.eq.${session.user.id}`);

  if (error) {
    console.error("Failed to load threads:", error);
    return;
  }

  if (!threads.length) {
    latestReceived = [];
    latestStarted = [];
    renderActiveTab();
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

  // sort by most recent activity — latest message if any, else thread creation
  const withActivity = threads.map((t) => {
    const preview = previewByThread.get(t.id);
    const activityAt = preview ? preview.created_at : t.created_at;
    return { thread: t, preview, activityAt };
  });
  withActivity.sort((a, b) => new Date(b.activityAt) - new Date(a.activityAt));

  latestReceived = withActivity.filter((x) => x.thread.creator_id === session.user.id);
  latestStarted = withActivity.filter((x) => x.thread.guest_id === session.user.id);

  updateTabDots();
  renderActiveTab();
}

function updateTabDots() {
  const receivedUnread = latestReceived.some((x) => isUnread(x));
  const startedUnread = latestStarted.some((x) => isUnread(x));

  const receivedBtn = document.getElementById("tabReceived");
  const sentBtn = document.getElementById("tabSent");
  receivedBtn.innerHTML = `Received${receivedUnread ? '<span class="tab-dot"></span>' : ""}`;
  sentBtn.innerHTML = `Sent${startedUnread ? '<span class="tab-dot"></span>' : ""}`;
}

function isUnread({ thread, preview }) {
  if (!preview || preview.sender_id === session.user.id) return false;
  const isCreator = thread.creator_id === session.user.id;
  const myLastRead = isCreator ? thread.creator_last_read_at : thread.guest_last_read_at;
  return !myLastRead || new Date(preview.created_at) > new Date(myLastRead);
}

function renderActiveTab() {
  const list = activeTab === "received" ? latestReceived : latestStarted;
  threadListEl.innerHTML = "";

  if (!list.length) {
    const emptyMsg =
      activeTab === "received"
        ? "No one's messaged you yet. Share your link above."
        : "You haven't started any chats yet. Open someone's link to begin.";
    threadListEl.innerHTML = `
      <div class="empty-inbox glass" style="border-radius: var(--radius-lg);">
        <div class="icon">📭</div>
        <p>${emptyMsg}</p>
      </div>`;
    return;
  }

  list.forEach((entry) => threadListEl.appendChild(threadCard(entry)));
}

function threadCard({ thread: t, preview }) {
  const isCreator = t.creator_id === session.user.id;
  const otherUserId = isCreator ? t.guest_id : t.creator_id;
  const tag = tagFor(otherUserId);
  const unread = isUnread({ thread: t, preview });

  const card = document.createElement("div");
  card.className = "thread-card glass";
  card.innerHTML = `
    <div class="thread-info">
      ${unread ? '<span class="unread-dot"></span>' : ""}
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
