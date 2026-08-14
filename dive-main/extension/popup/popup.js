const $ = (id) => document.getElementById(id);

function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

async function refreshStatus() {
  const res = await send({ type: "GET_STATUS" });
  $("api-base").value = res.apiBase || "";
  if (res.loggedIn) {
    $("status").textContent = "Connected";
    $("login-form").classList.add("hidden");
    $("logged-in").classList.remove("hidden");
    $("logged-in-email").textContent = res.email || "your Divve account";
  } else {
    $("status").textContent = "Not logged in";
    $("login-form").classList.remove("hidden");
    $("logged-in").classList.add("hidden");
  }
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("login-error").textContent = "";
  $("login-btn").disabled = true;
  $("login-btn").textContent = "Logging in…";
  try {
    const res = await send({
      type: "LOGIN",
      identifier: $("identifier").value.trim(),
      password: $("password").value,
    });
    if (!res.ok) throw new Error(res.message || "Login failed.");
    $("password").value = "";
    await refreshStatus();
  } catch (err) {
    $("login-error").textContent = err.message || "Login failed.";
  } finally {
    $("login-btn").disabled = false;
    $("login-btn").textContent = "Log in";
  }
});

$("logout-btn").addEventListener("click", async () => {
  await send({ type: "LOGOUT" });
  await refreshStatus();
});

$("save-api-base-btn").addEventListener("click", async () => {
  const raw = $("api-base").value.trim().replace(/\/+$/, "");
  $("api-base-note").textContent = "";
  if (!raw) return;
  let origin;
  try {
    origin = new URL(raw).origin + "/*";
  } catch {
    $("api-base-note").textContent = "Enter a full URL, e.g. https://api.example.com/api";
    return;
  }
  // Backend hosts outside the manifest's static host_permissions (anything
  // that isn't the Angel One origin or localhost) need an explicit runtime
  // permission grant — this is the standard MV3 pattern for a
  // user-configurable API host, not a workaround.
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) {
    $("api-base-note").textContent = "Permission denied — the extension can't reach that host without it.";
    return;
  }
  await send({ type: "SET_API_BASE", apiBase: raw });
  $("api-base-note").textContent = "Saved.";
});

refreshStatus();
