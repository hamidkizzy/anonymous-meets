/* ============================================================
   Session — every visitor silently gets a real, secure,
   invisible session. No password, no visible login step.
   ============================================================ */
let session = null;

async function ensureSession() {
  const { data: existing } = await sb.auth.getSession();
  if (existing.session) {
    session = existing.session;
    return session;
  }
  const { data, error } = await sb.auth.signInAnonymously();
  if (error) {
    console.error("Anonymous sign-in failed:", error);
    return null;
  }
  session = data.session;
  return session;
}

/* ============================================================
   Anonymous tag — a stable, fun label derived from a user id.
   Never reveals identity, purely for telling people apart.
   ============================================================ */
const ADJECTIVES = ["Blue", "Coral", "Amber", "Violet", "Silver", "Golden", "Mint", "Crimson", "Indigo", "Rose", "Teal", "Copper", "Jade", "Slate", "Peach"];
const ANIMALS = ["Fox", "Owl", "Wolf", "Hawk", "Panda", "Otter", "Falcon", "Lynx", "Heron", "Raven", "Tiger", "Dolphin", "Sparrow", "Badger", "Wren"];
const TAG_COLORS = ["#8B7CF6", "#22D3B6", "#FF7CA3", "#FFB454", "#4EA8FF", "#B18CFF", "#5FE0C7", "#FF8A65"];

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function tagFor(id) {
  const h = hashString(id);
  const adjective = ADJECTIVES[h % ADJECTIVES.length];
  const animal = ANIMALS[Math.floor(h / ADJECTIVES.length) % ANIMALS.length];
  const color = TAG_COLORS[h % TAG_COLORS.length];
  return { label: `${adjective} ${animal}`, color };
}

/* ============================================================
   Time helpers
   ============================================================ */
function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function timeRemaining(expiresAtIso) {
  const ms = new Date(expiresAtIso).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  if (hours >= 1) return `${hours}h ${mins}m left`;
  return `${mins}m left`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

/* ============================================================
   Notifications — sound (always) + system notification banner
   (when the tab is in the background, if permission granted)
   ============================================================ */
let audioCtx = null;
let notifyPermissionRequested = false;

function unlockAudio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  } else if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }

  if (!notifyPermissionRequested && "Notification" in window) {
    notifyPermissionRequested = true;
    if (Notification.permission === "default") {
      Notification.requestPermission();
    }
  }
}

["click", "keydown", "touchstart"].forEach((evt) =>
  window.addEventListener(evt, unlockAudio, { once: true })
);

function playPing() {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.15, audioCtx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.32);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.32);
}

function showBanner(title, body) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  const n = new Notification(title, {
    body,
    icon: "https://api.iconify.design/mdi/chat.svg?color=%236C5CE7",
    tag: "echo-chat-message",
  });
  n.onclick = () => {
    window.focus();
    n.close();
  };
}

function notifyNewMessage(senderId, title, body) {
  if (senderId === session.user.id) return;
  playPing();
  if (document.hidden) showBanner(title, body);
}

function setupNotifButton(btnEl) {
  const alreadyEnabled =
    audioCtx && (!("Notification" in window) || Notification.permission !== "default");

  if (alreadyEnabled) {
    btnEl.classList.add("hidden");
    return;
  }

  btnEl.classList.remove("hidden");
  btnEl.addEventListener("click", () => {
    unlockAudio();
    playPing();
    btnEl.textContent = "🔔 Sound on";
    setTimeout(() => btnEl.classList.add("hidden"), 1200);
  });
}
