const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

function loadAuth(fetch) {
  const values = new Map();
  const element = () => ({
    append() {},
    replaceChildren() {},
    addEventListener() {},
  });
  const context = vm.createContext({
    fetch,
    window: { addEventListener() {} },
    Headers,
    URLSearchParams,
    sessionStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
    location: { search: "", pathname: "/index.html", replace() {} },
    document: {
      body: { dataset: {} },
      createElement: element,
      querySelector: (selector) =>
        selector === "#account-nav" ? element() : null,
    },
  });
  vm.runInContext(fs.readFileSync("auth.js", "utf8"), context);
  return { values, call: (code) => vm.runInContext(code, context), context };
}

function response(status, data) {
  return { status, ok: status < 400, json: async () => data };
}

test("expired access is refreshed once and the original request is retried", async () => {
  const calls = [];
  const auth = loadAuth(async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("auth/refresh/"))
      return response(200, { access: "new-access" });
    return options.headers.get("Authorization") === "Bearer new-access"
      ? response(200, { username: "marta" })
      : response(401, { detail: "Expired" });
  });
  auth.values.set("access", "expired");
  auth.values.set("refresh", "refresh-token");
  const result = await auth.call('apiRequest("me/")');
  assert.equal(result.username, "marta");
  assert.equal(calls.length, 3);
  assert.equal(JSON.parse(calls[1].options.body).refresh, "refresh-token");
  assert.equal(auth.values.get("access"), "new-access");
});

test("concurrent unauthorized requests share a single refresh", async () => {
  let refreshes = 0;
  const auth = loadAuth(async (url, options) => {
    if (url.endsWith("auth/refresh/")) {
      refreshes += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return response(200, { access: "new" });
    }
    return options.headers.get("Authorization") === "Bearer new"
      ? response(200, { ok: true })
      : response(401, { detail: "Expired" });
  });
  auth.values.set("access", "expired");
  auth.values.set("refresh", "refresh");
  await auth.call('Promise.all([apiRequest("me/"), apiRequest("me/")])');
  assert.equal(refreshes, 1);
});

test("invalid refresh clears both tokens and does not loop", async () => {
  let calls = 0;
  const auth = loadAuth(async () => {
    calls += 1;
    return response(401, { detail: "Invalid" });
  });
  auth.values.set("access", "expired");
  auth.values.set("refresh", "invalid");
  await assert.rejects(
    auth.call('apiRequest("me/")'),
    (error) => error.status === 401,
  );
  assert.equal(calls, 2);
  assert.equal(auth.values.size, 0);
});

test("network failure preserves refresh for a later retry", async () => {
  const auth = loadAuth(async (url) => {
    if (url.endsWith("auth/refresh/")) throw new TypeError("Offline");
    return response(401, { detail: "Expired" });
  });
  auth.values.set("access", "expired");
  auth.values.set("refresh", "valid-refresh");
  await assert.rejects(auth.call('apiRequest("me/")'));
  assert.equal(auth.values.get("refresh"), "valid-refresh");
});

test("logout during refresh cannot restore the old session", async () => {
  let finish;
  const auth = loadAuth(async (url) => {
    if (url.endsWith("auth/refresh/"))
      return new Promise((resolve) => {
        finish = resolve;
      });
    return response(401, { detail: "Expired" });
  });
  auth.values.set("access", "expired");
  auth.values.set("refresh", "valid-refresh");
  const request = auth.call('apiRequest("me/")');
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  auth.call("clearTokens()");
  finish(response(200, { access: "new" }));
  await assert.rejects(request);
  assert.equal(auth.values.size, 0);
});

test("return destination rejects external URLs", () => {
  const auth = loadAuth(async () => {
    throw new Error("Unexpected fetch");
  });
  auth.context.location.search = "?next=https://untrusted.example/";
  assert.equal(auth.call("returnPage()"), "/account.html");
  auth.context.location.search = "?next=/index.html";
  assert.equal(auth.call("returnPage()"), "/index.html");
});
