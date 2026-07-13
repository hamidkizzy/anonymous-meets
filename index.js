const screenLoading = document.getElementById("screenLoading");
const homeShell = document.getElementById("homeShell");
const createPanel = document.getElementById("createPanel");
const resultPanel = document.getElementById("resultPanel");

let selectedType = null;

(async function init() {
  const s = await ensureSession();
  if (!s) {
    screenLoading.querySelector("p").textContent = "Couldn't start a session. Please refresh.";
    return;
  }
  screenLoading.classList.add("hidden");
  homeShell.classList.remove("hidden");
})();

/* ============================================================
   Type selection
   ============================================================ */
document.querySelectorAll(".type-option").forEach((el) => {
  el.addEventListener("click", () => {
    document.querySelectorAll(".type-option").forEach((o) => o.classList.remove("selected"));
    el.classList.add("selected");
    selectedType = el.dataset.type;

    const groupField = document.getElementById("groupNameField");
    const createBtn = document.getElementById("createBtn");

    if (selectedType === "group") {
      groupField.classList.remove("hidden");
      createBtn.textContent = "Create group";
    } else {
      groupField.classList.add("hidden");
      createBtn.textContent = "Get my chat link";
    }
    createBtn.disabled = false;
  });
});

/* ============================================================
   Create
   ============================================================ */
document.getElementById("createBtn").addEventListener("click", async () => {
  const btn = document.getElementById("createBtn");
  const errorEl = document.getElementById("createError");
  errorEl.textContent = "";
  btn.disabled = true;

  try {
    if (selectedType === "chat") {
      const link = buildLink("chat.html", { to: session.user.id });
      showResult({
        title: "Your chat link is ready",
        sub: "Anyone who opens this talks privately with you. It always works — no expiry on the link itself, just on each conversation.",
        link,
      });
    } else if (selectedType === "group") {
      const name = document.getElementById("groupNameInput").value.trim() || randomGroupName();
      const { data, error } = await sb
        .from("groups")
        .insert({ name, creator_id: session.user.id })
        .select()
        .single();

      if (error) throw error;

      const link = buildLink("group.html", { g: data.id });
      showResult({
        title: `"${name}" is live`,
        sub: "Everyone who opens this link joins the same room. It disappears in 24 hours.",
        link,
      });
    }
  } catch (err) {
    console.error("Create failed:", err);
    errorEl.textContent = "Something went wrong. Please try again.";
  } finally {
    btn.disabled = false;
  }
});

function buildLink(page, params) {
  const base = `${location.origin}${location.pathname.replace(/index\.html$/, "")}${page}`;
  const query = new URLSearchParams(params).toString();
  return `${base}?${query}`;
}

function randomGroupName() {
  const tag = tagFor(crypto.randomUUID());
  return `${tag.label}'s Room`;
}

/* ============================================================
   Result panel
   ============================================================ */
let currentLink = "";

function showResult({ title, sub, link }) {
  currentLink = link;
  createPanel.classList.add("hidden");
  resultPanel.classList.remove("hidden");
  document.getElementById("resultTitle").textContent = title;
  document.getElementById("resultSub").textContent = sub;
  document.getElementById("resultLink").textContent = link;
  document.getElementById("qrImg").src =
    `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(link)}`;
  document.getElementById("qrBox").classList.add("hidden");
  document.getElementById("toggleQrBtn").textContent = "Show QR code";
}

document.getElementById("copyLinkBtn").addEventListener("click", () => {
  navigator.clipboard.writeText(currentLink);
  const btn = document.getElementById("copyLinkBtn");
  const original = btn.textContent;
  btn.textContent = "Copied!";
  setTimeout(() => (btn.textContent = original), 1500);
});

document.getElementById("toggleQrBtn").addEventListener("click", () => {
  const box = document.getElementById("qrBox");
  const btn = document.getElementById("toggleQrBtn");
  box.classList.toggle("hidden");
  btn.textContent = box.classList.contains("hidden") ? "Show QR code" : "Hide QR code";
});

document.getElementById("openNowBtn").addEventListener("click", () => {
  window.location.href = currentLink;
});

document.getElementById("createAnotherBtn").addEventListener("click", () => {
  resultPanel.classList.add("hidden");
  createPanel.classList.remove("hidden");
  document.querySelectorAll(".type-option").forEach((o) => o.classList.remove("selected"));
  document.getElementById("groupNameField").classList.add("hidden");
  document.getElementById("groupNameInput").value = "";
  document.getElementById("createBtn").disabled = true;
  document.getElementById("createBtn").textContent = "Choose a type above";
  selectedType = null;
});
