const API_BASE = "http://127.0.0.1:8000/api/";
let refreshInFlight = null;

function clearTokens() {
  sessionStorage.removeItem("access");
  sessionStorage.removeItem("refresh");
}

async function readResponse(response) {
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const error = new Error(data.detail || "Не вдалося виконати запит.");
    error.status = response.status;
    error.fields = data.errors;
    throw error;
  }
  return data;
}

async function apiRequest(path, options = {}) {
  function send() {
    const headers = new Headers(options.headers);
    const access = sessionStorage.getItem("access");
    if (access) headers.set("Authorization", `Bearer ${access}`);
    return fetch(API_BASE + path, { ...options, headers });
  }
  let response = await send();
  if (response.status === 401 && sessionStorage.getItem("refresh")) {
    if (!refreshInFlight) {
      const refresh = sessionStorage.getItem("refresh");
      refreshInFlight = (async () => {
        const result = await fetch(API_BASE + "auth/refresh/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh }),
        });
        const data = await readResponse(result);
        if (sessionStorage.getItem("refresh") !== refresh) {
          throw new Error("Сесію завершено.");
        }
        sessionStorage.setItem("access", data.access);
      })().finally(() => {
        refreshInFlight = null;
      });
    }
    try {
      await refreshInFlight;
    } catch (error) {
      if (error.status === 401) clearTokens();
      throw error;
    }
    response = await send();
  }
  if (response.status === 401) clearTokens();
  return readResponse(response);
}

function returnPage() {
  const next = new URLSearchParams(location.search).get("next");
  return ["/account.html", "/index.html"].includes(next)
    ? next
    : "/account.html";
}

function loginRedirect() {
  location.replace("/login.html?next=" + encodeURIComponent(location.pathname));
}

function showNavigation(user) {
  const nav = document.querySelector("#account-nav");
  const catalog = document.createElement("a");
  catalog.href = "/index.html";
  catalog.textContent = "Каталог";
  nav.replaceChildren(catalog);
  if (user) {
    const account = document.createElement("a");
    account.href = "/account.html";
    account.textContent = user.first_name || user.username;
    const logout = document.createElement("button");
    logout.type = "button";
    logout.textContent = "Вийти";
    logout.addEventListener("click", () => {
      clearTokens();
      location.replace("/index.html");
    });
    nav.append(account, logout);
  } else {
    for (const [url, label] of [
      ["/login.html", "Увійти"],
      ["/register.html", "Реєстрація"],
    ]) {
      const link = document.createElement("a");
      link.href = url;
      link.textContent = label;
      nav.append(link);
    }
  }
}

function showFormErrors(error) {
  const summary = document.querySelector("#form-message");
  summary.textContent = error.status
    ? error.message
    : "Сервер недоступний. Перевірте з’єднання й повторіть спробу.";
  for (const [field, messages] of Object.entries(error.fields || {})) {
    const output = document.getElementById(`${field}-error`);
    if (output) {
      output.textContent = messages.join(" ");
      document
        .querySelector(`[name="${field}"]`)
        ?.setAttribute("aria-invalid", "true");
    }
  }
}

async function startAuth() {
  let user = null;
  try {
    if (sessionStorage.getItem("access") || sessionStorage.getItem("refresh")) {
      user = await apiRequest("me/");
    }
  } catch (error) {
    if (error.status !== 401) {
      document.querySelector("#auth-message").textContent =
        "Не вдалося перевірити вхід. Перезавантажте сторінку після відновлення з’єднання.";
      return;
    }
  }
  showNavigation(user);
  const form = document.querySelector("#auth-form");
  if (user && form) {
    location.replace(returnPage());
    return;
  }
  if (!user && document.body.dataset.private === "true") {
    loginRedirect();
    return;
  }
  if (user && document.querySelector("#profile")) {
    document.querySelector("#profile").hidden = false;
    for (const field of ["username", "first_name", "last_name", "email"]) {
      document.getElementById(`profile-${field}`).textContent =
        user[field] || "—";
    }
    document.querySelector("#profile-role").textContent = user.is_staff
      ? "Адміністратор: може змінювати каталог через API."
      : "Користувач: може переглядати каталог і власний акаунт.";
  }
  if (!form) return;
  form.hidden = false;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    document.querySelector("#form-message").textContent = "";
    for (const output of form.querySelectorAll(".field-error"))
      output.textContent = "";
    for (const input of form.querySelectorAll("input"))
      input.removeAttribute("aria-invalid");
    const data = Object.fromEntries(new FormData(form));
    const registering = document.body.dataset.page === "register";
    try {
      const response = await fetch(
        API_BASE + (registering ? "auth/register/" : "auth/login/"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      );
      const result = await readResponse(response);
      if (registering) {
        location.replace("/login.html?registered=1");
      } else {
        sessionStorage.setItem("access", result.access);
        sessionStorage.setItem("refresh", result.refresh);
        location.replace(returnPage());
      }
    } catch (error) {
      showFormErrors(error);
    } finally {
      submit.disabled = false;
    }
  });
  if (new URLSearchParams(location.search).has("registered")) {
    document.querySelector("#form-message").textContent =
      "Акаунт створено. Тепер увійдіть.";
  }
}

window.addEventListener("pageshow", (event) => {
  if (event.persisted) location.reload();
});

startAuth();
