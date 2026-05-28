const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "hr-reserve.sqlite");

const HH_API = "https://api.hh.ru";
const HH_CLIENT_ID = process.env.HH_CLIENT_ID || "";
const HH_CLIENT_SECRET = process.env.HH_CLIENT_SECRET || "";
const HH_REDIRECT_URI = process.env.HH_REDIRECT_URI || `http://localhost:${PORT}/api/hh/callback`;
const AVITO_CLIENT_ID = process.env.AVITO_CLIENT_ID || "";
const AVITO_CLIENT_SECRET = process.env.AVITO_CLIENT_SECRET || "";

const SUPABASE_URL = trimTrailingSlash(process.env.SUPABASE_URL || "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const HR_RESERVE_PASSWORD = process.env.HR_RESERVE_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const SESSION_COOKIE = "hr_reserve_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

const store = createStore();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/login" && req.method === "GET") return serveLogin(res);
    if (url.pathname === "/login" && req.method === "POST") return handleLogin(req, res);
    if (url.pathname === "/logout") return logout(res);

    if (!isAuthorized(req)) {
      if (url.pathname.startsWith("/api/")) return json(res, 401, { error: "unauthorized" });
      return redirect(res, "/login");
    }

    if (url.pathname === "/api/candidates" && req.method === "GET") {
      return json(res, 200, await store.listCandidates());
    }

    if (url.pathname === "/api/candidates" && req.method === "POST") {
      const candidate = normalizeCandidate(await readJson(req));
      await store.upsertCandidate(candidate);
      return json(res, 201, candidate);
    }

    const candidateMatch = url.pathname.match(/^\/api\/candidates\/([^/]+)$/);
    if (candidateMatch && req.method === "PUT") {
      const candidate = normalizeCandidate({ ...(await readJson(req)), id: decodeURIComponent(candidateMatch[1]) });
      await store.upsertCandidate(candidate);
      return json(res, 200, candidate);
    }

    if (candidateMatch && req.method === "DELETE") {
      await store.deleteCandidate(decodeURIComponent(candidateMatch[1]));
      return json(res, 204, null);
    }

    if (url.pathname === "/api/hh/status" && req.method === "GET") {
      return json(res, 200, await getHhStatus());
    }

    if (url.pathname === "/api/hh/auth-url" && req.method === "GET") {
      return json(res, 200, await createHhAuthUrl());
    }

    if (url.pathname === "/api/hh/callback" && req.method === "GET") {
      await handleHhCallback(url, res);
      return;
    }

    if (url.pathname === "/api/hh/import" && req.method === "POST") {
      return json(res, 200, await importHhNegotiations());
    }

    if (url.pathname === "/api/avito/status" && req.method === "GET") {
      return json(res, 200, await getAvitoStatus());
    }

    if (url.pathname === "/api/avito/import" && req.method === "POST") {
      return json(res, 501, {
        error: "not_implemented",
        message: "Импорт Авито заложен, но для подключения нужны ключи и подтвержденный доступ к API Авито Работа.",
      });
    }

    return serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: "server_error", message: error.message });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`HR Reserve is running: http://localhost:${PORT}`);
    console.log(`Storage: ${store.name}`);
    console.log(HR_RESERVE_PASSWORD ? "Password protection: on" : "Password protection: off");
  });
}

module.exports = { server, DB_PATH };

function createStore() {
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) return createSupabaseStore();
  return createSqliteStore();
}

function createSqliteStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      contact TEXT NOT NULL,
      age TEXT NOT NULL,
      vacancy TEXT NOT NULL,
      hhUrl TEXT NOT NULL,
      status TEXT NOT NULL,
      followup TEXT,
      owner TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      comment TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  ensureSqliteColumn(db, "candidates", "hhId", "TEXT NOT NULL DEFAULT ''");
  ensureSqliteColumn(db, "candidates", "source", "TEXT NOT NULL DEFAULT 'manual'");

  return {
    name: "sqlite",
    async init() {
      const count = db.prepare("SELECT COUNT(*) AS count FROM candidates").get().count;
      if (count > 0) return;
      demoCandidates().forEach((candidate) => this.upsertCandidate(candidate));
    },
    async listCandidates() {
      return db
        .prepare("SELECT * FROM candidates ORDER BY updatedAt DESC")
        .all()
        .map((candidate) => ({
          ...candidate,
          tags: safeJson(candidate.tags, []),
        }));
    },
    async upsertCandidate(candidate) {
      db.prepare(`
        INSERT INTO candidates (id, name, contact, age, vacancy, hhUrl, status, followup, owner, tags, comment, updatedAt, hhId, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          contact = excluded.contact,
          age = excluded.age,
          vacancy = excluded.vacancy,
          hhUrl = excluded.hhUrl,
          status = excluded.status,
          followup = excluded.followup,
          owner = excluded.owner,
          tags = excluded.tags,
          comment = excluded.comment,
          updatedAt = excluded.updatedAt,
          hhId = excluded.hhId,
          source = excluded.source
      `).run(
        candidate.id,
        candidate.name,
        candidate.contact,
        candidate.age,
        candidate.vacancy,
        candidate.hhUrl,
        candidate.status,
        candidate.followup,
        candidate.owner,
        JSON.stringify(candidate.tags),
        candidate.comment,
        candidate.updatedAt,
        candidate.hhId,
        candidate.source,
      );
    },
    async deleteCandidate(id) {
      db.prepare("DELETE FROM candidates WHERE id = ?").run(id);
    },
    async getSetting(key) {
      return db.prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value || "";
    },
    async setSetting(key, value) {
      db.prepare(`
        INSERT INTO settings (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(key, value);
    },
  };
}

function createSupabaseStore() {
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  return {
    name: "supabase",
    async init() {},
    async listCandidates() {
      return supabaseFetch("/rest/v1/candidates?select=*&order=updatedAt.desc", { headers });
    },
    async upsertCandidate(candidate) {
      const [saved] = await supabaseFetch("/rest/v1/candidates?on_conflict=id", {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(candidate),
      });
      return saved;
    },
    async deleteCandidate(id) {
      await supabaseFetch(`/rest/v1/candidates?id=eq.${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers,
      });
    },
    async getSetting(key) {
      const rows = await supabaseFetch(`/rest/v1/settings?key=eq.${encodeURIComponent(key)}&select=value`, { headers });
      return rows[0]?.value || "";
    },
    async setSetting(key, value) {
      await supabaseFetch("/rest/v1/settings?on_conflict=key", {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ key, value }),
      });
    },
  };
}

store.init().catch((error) => {
  console.error("Storage init failed:", error);
});

async function supabaseFetch(pathname, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${pathname}`, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.message || data?.hint || `Supabase request failed: ${response.status}`);
  }
  return data;
}

function normalizeCandidate(candidate) {
  return {
    id: String(candidate.id || crypto.randomUUID()),
    name: String(candidate.name || "").trim(),
    contact: String(candidate.contact || "").trim(),
    age: String(candidate.age || "").trim(),
    vacancy: String(candidate.vacancy || "").trim(),
    hhUrl: String(candidate.hhUrl || "").trim(),
    status: String(candidate.status || "Новый").trim(),
    followup: String(candidate.followup || "").trim(),
    owner: String(candidate.owner || "").trim(),
    tags: Array.isArray(candidate.tags) ? candidate.tags.map(String).map((tag) => tag.trim()).filter(Boolean) : [],
    comment: String(candidate.comment || "").trim(),
    updatedAt: String(candidate.updatedAt || new Date().toISOString()),
    hhId: String(candidate.hhId || "").trim(),
    source: String(candidate.source || "manual").trim(),
  };
}

function demoCandidates() {
  return [
    normalizeCandidate({
      id: crypto.randomUUID(),
      name: "Анна Кузнецова",
      contact: "+7 900 000-00-11",
      age: "20",
      vacancy: "Администратор",
      hhUrl: "https://hh.ru/",
      status: "Резерв лето",
      followup: "2026-05-20",
      owner: "Мария",
      tags: ["лето", "вечерние смены"],
      comment: "Готова выйти после сессии. Хорошая коммуникация, стоит вернуться ближе к июню.",
      source: "demo",
    }),
    normalizeCandidate({
      id: crypto.randomUUID(),
      name: "Илья Соколов",
      contact: "@ilya_s",
      age: "27",
      vacancy: "Менеджер по продажам",
      hhUrl: "https://hh.ru/",
      status: "Собеседование",
      followup: "2026-05-06",
      owner: "Ольга",
      tags: ["опыт продаж", "срочно"],
      comment: "Назначено первичное интервью, уточнить детали по графику.",
      source: "demo",
    }),
  ];
}

async function getHhStatus() {
  const expiresAt = Number((await store.getSetting("hh_expires_at")) || 0);
  return {
    configured: Boolean(HH_CLIENT_ID && HH_CLIENT_SECRET),
    connected: Boolean(await store.getSetting("hh_access_token")),
    redirectUri: HH_REDIRECT_URI,
    expiresAt,
    expired: expiresAt ? Date.now() > expiresAt : false,
  };
}

async function getAvitoStatus() {
  return {
    configured: Boolean(AVITO_CLIENT_ID && AVITO_CLIENT_SECRET),
    connected: Boolean(await store.getSetting("avito_access_token")),
    needsAccess: !AVITO_CLIENT_ID || !AVITO_CLIENT_SECRET,
  };
}

async function createHhAuthUrl() {
  if (!HH_CLIENT_ID || !HH_CLIENT_SECRET) {
    return {
      error: "missing_credentials",
      message: "Добавьте HH_CLIENT_ID и HH_CLIENT_SECRET в окружение сервера.",
      redirectUri: HH_REDIRECT_URI,
    };
  }

  const state = crypto.randomBytes(24).toString("hex");
  await store.setSetting("hh_oauth_state", state);

  const authUrl = new URL("https://hh.ru/oauth/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", HH_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", HH_REDIRECT_URI);
  authUrl.searchParams.set("state", state);

  return { url: authUrl.toString(), redirectUri: HH_REDIRECT_URI };
}

async function handleHhCallback(url, res) {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) return redirect(res, `/?hh=error&message=${encodeURIComponent(error)}`);
  if (!code || !state || state !== (await store.getSetting("hh_oauth_state"))) return redirect(res, "/?hh=error&message=bad_oauth_state");

  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("client_id", HH_CLIENT_ID);
  body.set("client_secret", HH_CLIENT_SECRET);
  body.set("code", code);
  body.set("redirect_uri", HH_REDIRECT_URI);

  const token = await hhTokenRequest(body);
  await storeHhToken(token);
  redirect(res, "/?hh=connected");
}

async function importHhNegotiations() {
  if (!HH_CLIENT_ID || !HH_CLIENT_SECRET) throw new Error("HH_CLIENT_ID and HH_CLIENT_SECRET are not configured");

  const token = await refreshHhTokenIfNeeded();
  if (!token) throw new Error("HH is not connected");

  const me = await hhGet("/me", token);
  const employerId = me.employer?.id || me.employers?.[0]?.id;
  if (!employerId) throw new Error("HH employer id was not found for the authorized user");

  const vacancies = await getHhActiveVacancies(employerId, token);
  let imported = 0;
  let skipped = 0;

  for (const vacancy of vacancies) {
    const collections = await getHhNegotiationCollections(vacancy.id, token);
    for (const collection of collections) {
      const items = await getHhCollectionItems(collection.url, token);
      for (const item of items) {
        const candidate = mapHhNegotiation(item, vacancy, me);
        if (!candidate) {
          skipped += 1;
          continue;
        }
        await store.upsertCandidate(candidate);
        imported += 1;
      }
    }
  }

  return { imported, skipped, vacancies: vacancies.length };
}

async function getHhActiveVacancies(employerId, token) {
  const result = [];
  let page = 0;
  let pages = 1;

  while (page < pages) {
    const data = await hhGet(`/employers/${employerId}/vacancies/active?per_page=50&page=${page}`, token);
    result.push(...(data.items || data.vacancies || []));
    pages = Number(data.pages || 1);
    page += 1;
  }

  return result;
}

async function getHhNegotiationCollections(vacancyId, token) {
  const data = await hhGet(`/negotiations?vacancy_id=${encodeURIComponent(vacancyId)}&with_generated_collections=true`, token);
  const seen = new Set();
  const result = [];

  const visit = (collection) => {
    if (!collection || !collection.url || seen.has(collection.url)) return;
    seen.add(collection.url);
    result.push(collection);
    (collection.sub_collections || []).forEach(visit);
  };

  (data.collections || []).forEach(visit);
  (data.generated_collections || []).forEach(visit);
  return result;
}
}

async function getHhCollectionItems(collectionUrl, token) {
  const result = [];
  let page = 0;
  let pages = 1;

  while (page < pages) {
    const url = new URL(collectionUrl);
    url.searchParams.set("per_page", "50");
    url.searchParams.set("page", String(page));
    const data = await hhGet(url.toString(), token);
    result.push(...(data.items || []));
    pages = Number(data.pages || 1);
    page += 1;
  }

  return result;
}

function mapHhNegotiation(item, vacancy, me) {
  const resume = item.resume || item.resumes?.[0] || {};
  const applicant = item.applicant || {};
  const hhId = String(item.id || item.topic_id || `${vacancy.id}:${resume.id || applicant.id || ""}`);
  if (!hhId || hhId.endsWith(":")) return null;

  const nameParts = [resume.last_name, resume.first_name, resume.middle_name].filter(Boolean);
  const name = nameParts.join(" ") || resume.title || applicant.name || "Кандидат HH";
  const hhUrl = resume.alternate_url || item.alternate_url || item.url || `https://hh.ru/resume/${resume.id || ""}`;
  const owner = me.first_name || me.name || "HH";

  return normalizeCandidate({
    id: `hh:${hhId}`,
    hhId,
    name,
    contact: "HH",
    age: resume.age || "",
    vacancy: vacancy.name || item.vacancy?.name || "Вакансия HH",
    hhUrl,
    status: "Новый",
    owner,
    tags: ["HH", item.state?.name || item.employer_state?.name || ""].filter(Boolean),
    comment: "Импортировано из HeadHunter. Проверьте карточку и назначьте статус.",
    source: "hh",
  });
}

async function refreshHhTokenIfNeeded() {
  const expiresAt = Number((await store.getSetting("hh_expires_at")) || 0);
  if (Date.now() < expiresAt - 60_000) return store.getSetting("hh_access_token");

  const refreshToken = await store.getSetting("hh_refresh_token");
  if (!refreshToken) return store.getSetting("hh_access_token");

  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", refreshToken);

  const token = await hhTokenRequest(body);
  await storeHhToken(token);
  return token.access_token;
}

async function hhTokenRequest(body) {
  const response = await fetch(`${HH_API}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error_description || data.error || "HH token request failed");
  return data;
}

async function storeHhToken(token) {
  await store.setSetting("hh_access_token", token.access_token || "");
  if (token.refresh_token) await store.setSetting("hh_refresh_token", token.refresh_token);
  await store.setSetting("hh_expires_at", String(Date.now() + Number(token.expires_in || 3600) * 1000));
}

async function hhGet(pathnameOrUrl, token) {
  const url = pathnameOrUrl.startsWith("http") ? pathnameOrUrl : `${HH_API}${pathnameOrUrl}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "HR Reserve local app (hr@example.local)",
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.description || data.errors?.[0]?.value || `HH request failed: ${response.status}`);
  return data;
}

function serveStatic(rawPathname, res) {
  const pathname = rawPathname === "/" ? "/index.html" : decodeURIComponent(rawPathname);
  const filePath = path.resolve(ROOT, `.${pathname}`);

  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    return res.end("Not found");
  }

  const ext = path.extname(filePath);
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
  };

  res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

function serveLogin(res) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Вход - HR Reserve</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f6f6f7; color: #171b22; font-family: "Segoe UI", Arial, sans-serif; }
      form { width: min(380px, calc(100vw - 32px)); display: grid; gap: 14px; padding: 24px; background: #fff; border: 1px solid #dfe2e8; border-radius: 8px; box-shadow: 0 18px 50px rgba(23, 27, 34, 0.08); }
      h1, p { margin: 0; }
      p { color: #687082; }
      input, button { min-height: 44px; border-radius: 8px; font: inherit; }
      input { border: 1px solid #dfe2e8; padding: 0 12px; }
      button { border: 0; background: #d6001c; color: white; font-weight: 700; cursor: pointer; }
    </style>
  </head>
  <body>
    <form method="post" action="/login">
      <h1>HR Reserve</h1>
      <p>Введите общий пароль HR-команды.</p>
      <input name="password" type="password" placeholder="Пароль" autofocus required />
      <button>Войти</button>
    </form>
  </body>
</html>`);
}

async function handleLogin(req, res) {
  const body = await readForm(req);
  if (!HR_RESERVE_PASSWORD || body.password === HR_RESERVE_PASSWORD) {
    res.writeHead(302, {
      Location: "/",
      "Set-Cookie": `${SESSION_COOKIE}=${createSessionToken()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`,
    });
    return res.end();
  }

  res.writeHead(302, { Location: "/login?error=1" });
  res.end();
}

function logout(res) {
  res.writeHead(302, {
    Location: "/login",
    "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
  });
  res.end();
}

function isAuthorized(req) {
  if (!HR_RESERVE_PASSWORD) return true;
  const token = parseCookies(req.headers.cookie || "")[SESSION_COOKIE];
  return verifySessionToken(token);
}

function createSessionToken() {
  const issuedAt = String(Date.now());
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(issuedAt).digest("hex");
  return `${issuedAt}.${signature}`;
}

function verifySessionToken(token) {
  if (!token || !token.includes(".")) return false;
  const [issuedAt, signature] = token.split(".");
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(issuedAt).digest("hex");
  if (!signature || signature.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  return Date.now() - Number(issuedAt) < SESSION_TTL_MS;
}

function parseCookies(cookieHeader) {
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((cookie) => cookie.trim().split("="))
      .filter(([key]) => key)
      .map(([key, value]) => [key, decodeURIComponent(value || "")]),
  );
}

function readJson(req) {
  return readBody(req).then((body) => (body ? JSON.parse(body) : {}));
}

function readForm(req) {
  return readBody(req).then((body) => Object.fromEntries(new URLSearchParams(body)));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body is too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function json(res, status, data) {
  if (status === 204) {
    res.writeHead(204);
    return res.end();
  }

  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function ensureSqliteColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name);
  if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}
