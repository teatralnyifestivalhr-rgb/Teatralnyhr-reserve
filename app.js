const STATUSES = [
  "Новый",
  "Перезвонить",
  "n/д",
  "Собеседование",
  "Стажировка",
  "Резерв лето",
  "Отказ",
  "Архив",
];

const STORAGE_KEY = "hr-reserve-candidates-v1";
const USE_API = location.protocol !== "file:";

const demoCandidates = [
  {
    id: crypto.randomUUID(),
    name: "Анна Кузнецова",
    contact: "+7 900 000-00-11",
    age: 20,
    vacancy: "Администратор",
    hhUrl: "https://hh.ru/",
    status: "Резерв лето",
    followup: "2026-05-20",
    source: "HH",
    owner: "Мария",
    tags: ["лето", "вечерние смены"],
    comment: "Готова выйти после сессии. Хорошая коммуникация, стоит вернуться ближе к июню.",
    updatedAt: new Date().toISOString(),
  },
  {
    id: crypto.randomUUID(),
    name: "Илья Соколов",
    contact: "@ilya_s",
    age: 27,
    vacancy: "Менеджер по продажам",
    hhUrl: "https://hh.ru/",
    status: "Собеседование",
    followup: "2026-05-06",
    source: "HH",
    owner: "Ольга",
    tags: ["опыт продаж", "срочно"],
    comment: "Назначено первичное интервью, уточнить график и ожидания по доходу.",
    updatedAt: new Date().toISOString(),
  },
  {
    id: crypto.randomUUID(),
    name: "Елена Морозова",
    contact: "elena@example.com",
    age: 34,
    vacancy: "Кассир",
    hhUrl: "https://hh.ru/",
    status: "Отказ",
    followup: "2026-06-01",
    source: "HH",
    owner: "Мария",
    tags: ["резерв", "частичная занятость"],
    comment: "Сейчас не подходит по графику, но открыта к варианту на выходные.",
    updatedAt: new Date().toISOString(),
  },
];

let candidates = [];
let currentView = "board";

const els = {
  boardView: document.querySelector("#boardView"),
  followupView: document.querySelector("#followupView"),
  listView: document.querySelector("#listView"),
  viewTitle: document.querySelector("#viewTitle"),
  totalCount: document.querySelector("#totalCount"),
  followupCount: document.querySelector("#followupCount"),
  searchInput: document.querySelector("#searchInput"),
  vacancyFilter: document.querySelector("#vacancyFilter"),
  statusFilter: document.querySelector("#statusFilter"),
  ownerFilter: document.querySelector("#ownerFilter"),
  dialog: document.querySelector("#candidateDialog"),
  form: document.querySelector("#candidateForm"),
  dialogTitle: document.querySelector("#dialogTitle"),
  deleteButton: document.querySelector("#deleteCandidateButton"),
  exportButton: document.querySelector("#exportButton"),
  notifyButton: document.querySelector("#notifyButton"),
  hhConnectButton: document.querySelector("#hhConnectButton"),
  hhImportButton: document.querySelector("#hhImportButton"),
  hhStatusText: document.querySelector("#hhStatusText"),
  hhRedirectUri: document.querySelector("#hhRedirectUri"),
  avitoConnectButton: document.querySelector("#avitoConnectButton"),
  avitoImportButton: document.querySelector("#avitoImportButton"),
  avitoStatusText: document.querySelector("#avitoStatusText"),
};

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

document.querySelector("#newCandidateButton").addEventListener("click", () => openCandidateDialog());
els.searchInput.addEventListener("input", render);
els.vacancyFilter.addEventListener("change", render);
els.statusFilter.addEventListener("change", render);
els.ownerFilter.addEventListener("change", render);
els.form.addEventListener("submit", saveCandidate);
els.deleteButton.addEventListener("click", deleteCandidate);
els.exportButton.addEventListener("click", exportCsv);
els.notifyButton.addEventListener("click", requestNotifications);
els.hhConnectButton.addEventListener("click", connectHeadHunter);
els.hhImportButton.addEventListener("click", importHeadHunter);
els.avitoConnectButton.addEventListener("click", showAvitoInstructions);
els.avitoImportButton.addEventListener("click", importAvito);

seedSelects();
init();

async function init() {
  candidates = await loadCandidates();
  render();
  await refreshHeadHunterStatus();
  await refreshAvitoStatus();
}

async function loadCandidates() {
  if (USE_API) {
    const response = await fetch("/api/candidates");
    if (!response.ok) throw new Error("Не удалось загрузить кандидатов");
    return response.json();
  }

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(demoCandidates));
    return demoCandidates;
  }

  try {
    const parsed = JSON.parse(raw);
    const migrated = parsed.map(migrateCandidate);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return demoCandidates;
  }
}

async function refreshHeadHunterStatus() {
  if (!USE_API) {
    els.hhStatusText.textContent = "HH доступен только при запуске через сервер.";
    els.hhRedirectUri.textContent = "";
    return;
  }

  try {
    const response = await fetch("/api/hh/status");
    const status = await response.json();
    els.hhRedirectUri.textContent = `Callback: ${status.redirectUri}`;

    if (!status.configured) {
      els.hhStatusText.textContent = "Нужно добавить ключи приложения HH на сервер.";
      els.hhImportButton.disabled = true;
      return;
    }

    els.hhStatusText.textContent = status.connected ? "HH подключен. Можно импортировать отклики." : "HH настроен, осталось авторизоваться.";
    els.hhImportButton.disabled = !status.connected;
  } catch {
    els.hhStatusText.textContent = "Не удалось проверить HH.";
    els.hhImportButton.disabled = true;
  }
}

async function connectHeadHunter() {
  const response = await fetch("/api/hh/auth-url");
  const data = await response.json();

  if (data.error) {
    els.hhStatusText.textContent = data.message;
    els.hhRedirectUri.textContent = `Callback для dev.hh.ru: ${data.redirectUri}`;
    return;
  }

  location.href = data.url;
}

async function importHeadHunter() {
  els.hhImportButton.disabled = true;
  els.hhStatusText.textContent = "Импортируем отклики из HH...";

  try {
    const response = await fetch("/api/hh/import", { method: "POST" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Импорт HH не удался");

    candidates = await loadCandidates();
    render();
    els.hhStatusText.textContent = `Импорт HH готов: ${result.imported} откликов, вакансий: ${result.vacancies}.`;
  } catch (error) {
    els.hhStatusText.textContent = error.message;
  } finally {
    await refreshHeadHunterStatus();
  }
}

async function refreshAvitoStatus() {
  if (!USE_API) {
    els.avitoStatusText.textContent = "Авито доступен только при запуске через сервер.";
    els.avitoImportButton.disabled = true;
    return;
  }

  try {
    const response = await fetch("/api/avito/status");
    const status = await response.json();

    if (!status.configured) {
      els.avitoStatusText.textContent = "Можно подключить вторым источником. Нужны ключи API Авито.";
      els.avitoImportButton.disabled = true;
      return;
    }

    els.avitoStatusText.textContent = status.connected ? "Авито подключен. Можно импортировать отклики." : "Ключи Авито добавлены, осталось проверить доступ к API.";
    els.avitoImportButton.disabled = !status.connected;
  } catch {
    els.avitoStatusText.textContent = "Не удалось проверить Авито.";
    els.avitoImportButton.disabled = true;
  }
}

function showAvitoInstructions() {
  els.avitoStatusText.innerHTML = `
    <strong>Следующий шаг по Авито:</strong>
    нужен доступ к API Авито и ключи <code>AVITO_CLIENT_ID</code> / <code>AVITO_CLIENT_SECRET</code>.
    Если пришлёшь скриншот кабинета Авито API, я подскажу, где их взять и что указать.
  `;
}

async function importAvito() {
  els.avitoStatusText.textContent = "Проверяем импорт Авито...";

  try {
    const response = await fetch("/api/avito/import", { method: "POST" });
    const result = await response.json();
    els.avitoStatusText.textContent = result.message || "Импорт Авито пока не настроен.";
  } catch {
    els.avitoStatusText.textContent = "Импорт Авито пока не настроен.";
  }
}

async function persist(candidate, method = "POST") {
  if (USE_API) {
    const url = method === "POST" ? "/api/candidates" : `/api/candidates/${encodeURIComponent(candidate.id)}`;
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(candidate),
    });
    if (!response.ok) throw new Error("Не удалось сохранить кандидата");
    return response.json();
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(candidates));
}

async function removeCandidate(id) {
  if (USE_API) {
    const response = await fetch(`/api/candidates/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) throw new Error("Не удалось удалить кандидата");
    return;
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(candidates));
}

function seedSelects() {
  const statusOptions = STATUSES.map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`).join("");
  document.querySelector("#candidateStatus").innerHTML = statusOptions;
  els.statusFilter.innerHTML = `<option value="">Все статусы</option>${statusOptions}`;
}

function render() {
  const visible = getVisibleCandidates();
  const followups = candidates.filter(isFollowupDue);

  els.totalCount.textContent = candidates.length;
  els.followupCount.textContent = followups.length;
  renderVacancyFilter();
  renderOwnerFilter();
  renderBoard(visible);
  renderFollowups(visible.filter((candidate) => candidate.followup).sort(sortByFollowup));
  renderTable(visible);
  updateNotificationButton();
  notifyDueCandidates(followups);
}

function renderVacancyFilter() {
  const current = els.vacancyFilter.value;
  const vacancies = [...new Set(candidates.map((candidate) => candidate.vacancy).filter(Boolean))].sort();
  els.vacancyFilter.innerHTML = `<option value="">Все вакансии</option>${vacancies
    .map((vacancy) => `<option value="${escapeHtml(vacancy)}">${escapeHtml(vacancy)}</option>`)
    .join("")}`;
  els.vacancyFilter.value = vacancies.includes(current) ? current : "";
}

function renderOwnerFilter() {
  const current = els.ownerFilter.value;
  const owners = [...new Set(candidates.map((candidate) => candidate.owner).filter(Boolean))].sort();
  els.ownerFilter.innerHTML = `<option value="">Все HR</option>${owners
    .map((owner) => `<option value="${escapeHtml(owner)}">${escapeHtml(owner)}</option>`)
    .join("")}`;
  els.ownerFilter.value = owners.includes(current) ? current : "";
}

function renderBoard(items) {
  els.boardView.innerHTML = STATUSES.map((status) => {
    const columnItems = items.filter((candidate) => candidate.status === status);
    return `
      <section class="column">
        <div class="column-head">
          <h3>${escapeHtml(status)}</h3>
          <span class="count-pill">${columnItems.length}</span>
        </div>
        <div class="cards">
          ${columnItems.map(renderCandidateCard).join("") || `<div class="empty-state">Пусто</div>`}
        </div>
      </section>
    `;
  }).join("");

  els.boardView.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => openCandidateDialog(button.dataset.edit));
  });
}

function renderCandidateCard(candidate) {
  const tags = normalizeTags(candidate.tags);
  return `
    <article class="candidate-card">
      <div class="card-title">
        <h4>${escapeHtml(candidate.name)}</h4>
        <button data-edit="${candidate.id}">Открыть</button>
      </div>
      <p class="card-meta">${escapeHtml(candidate.vacancy)} · ${candidate.age ? `${escapeHtml(candidate.age)} лет · ` : ""}${escapeHtml(candidate.owner || "HR не указан")}</p>
      ${candidate.followup ? `<p class="card-meta ${getFollowupClass(candidate)}">Вернуться: ${formatDate(candidate.followup)}</p>` : ""}
      <p class="card-comment">${escapeHtml(candidate.comment || "Комментария пока нет")}</p>
      <div class="tag-row">
        ${isFollowupDue(candidate) ? `<span class="tag followup-badge">пора вернуться</span>` : ""}
        ${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
      </div>
    </article>
  `;
}

function renderFollowups(items) {
  if (!items.length) {
    els.followupView.innerHTML = `<div class="empty-state">Нет кандидатов с датой возврата по текущим фильтрам</div>`;
    return;
  }

  els.followupView.innerHTML = items.map((candidate) => `
    <div class="followup-row">
      <div>
        <div class="row-title">${escapeHtml(candidate.name)}</div>
        <div class="row-sub">${escapeHtml(candidate.vacancy)} · ${candidate.age ? `${escapeHtml(candidate.age)} лет` : "возраст не указан"}</div>
      </div>
      <span class="${getFollowupClass(candidate)}">${formatDate(candidate.followup)}</span>
      <span class="status-chip">${escapeHtml(candidate.status)}</span>
      <span>${escapeHtml(candidate.owner || "HR не указан")}</span>
      <button class="ghost-button" data-edit="${candidate.id}">Открыть</button>
    </div>
  `).join("");

  els.followupView.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => openCandidateDialog(button.dataset.edit));
  });
}

function renderTable(items) {
  if (!items.length) {
    els.listView.innerHTML = `<div class="empty-state">По текущим фильтрам ничего не найдено</div>`;
    return;
  }

  els.listView.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Кандидат</th>
          <th>Вакансия</th>
          <th>Статус</th>
          <th>Вернуться</th>
          <th>HH</th>
          <th>Комментарий</th>
        </tr>
      </thead>
      <tbody>
        ${items.map((candidate) => `
          <tr>
            <td><button class="link-button ghost-button" data-edit="${candidate.id}">${escapeHtml(candidate.name)}</button><div class="row-sub">${escapeHtml(candidate.contact || "")}${candidate.age ? ` · ${escapeHtml(candidate.age)} лет` : ""}</div></td>
            <td>${escapeHtml(candidate.vacancy)}<div class="row-sub">${escapeHtml(candidate.owner || "")}</div></td>
            <td><span class="status-chip">${escapeHtml(candidate.status)}</span></td>
            <td>${candidate.followup ? formatDate(candidate.followup) : ""}</td>
            <td>${candidate.hhUrl ? `<a href="${escapeHtml(candidate.hhUrl)}" target="_blank" rel="noreferrer">Открыть</a>` : ""}</td>
            <td>${escapeHtml(candidate.comment || "")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  els.listView.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => openCandidateDialog(button.dataset.edit));
  });
}

function getVisibleCandidates() {
  const query = els.searchInput.value.trim().toLowerCase();
  const vacancy = els.vacancyFilter.value;
  const status = els.statusFilter.value;
  const owner = els.ownerFilter.value;

  return candidates.filter((candidate) => {
    const haystack = [
      candidate.name,
      candidate.contact,
      candidate.age,
      candidate.vacancy,
      candidate.status,
      candidate.hhUrl,
      candidate.owner,
      candidate.comment,
      ...normalizeTags(candidate.tags),
    ]
      .join(" ")
      .toLowerCase();

    return (
      (!query || haystack.includes(query)) &&
      (!vacancy || candidate.vacancy === vacancy) &&
      (!status || candidate.status === status) &&
      (!owner || candidate.owner === owner)
    );
  });
}

function setView(view) {
  currentView = view;
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  els.boardView.classList.toggle("hidden", view !== "board");
  els.followupView.classList.toggle("hidden", view !== "followup");
  els.listView.classList.toggle("hidden", view !== "list");
  els.viewTitle.textContent = {
    board: "Доска откликов",
    followup: "Кандидаты для возврата",
    list: "Общий список",
  }[currentView];
}

function openCandidateDialog(id) {
  const candidate = candidates.find((item) => item.id === id);
  els.dialogTitle.textContent = candidate ? "Редактировать кандидата" : "Новый кандидат";
  els.deleteButton.classList.toggle("hidden", !candidate);

  document.querySelector("#candidateId").value = candidate?.id || "";
  document.querySelector("#candidateName").value = candidate?.name || "";
  document.querySelector("#candidateContact").value = candidate?.contact || "";
  document.querySelector("#candidateAge").value = candidate?.age || "";
  document.querySelector("#candidateVacancy").value = candidate?.vacancy || "";
  document.querySelector("#candidateHhUrl").value = candidate?.hhUrl || "";
  document.querySelector("#candidateStatus").value = candidate?.status || STATUSES[0];
  document.querySelector("#candidateFollowup").value = candidate?.followup || "";
  document.querySelector("#candidateOwner").value = candidate?.owner || "";
  document.querySelector("#candidateTags").value = normalizeTags(candidate?.tags).join(", ");
  document.querySelector("#candidateComment").value = candidate?.comment || "";

  els.dialog.showModal();
}

async function saveCandidate(event) {
  event.preventDefault();
  const id = document.querySelector("#candidateId").value || crypto.randomUUID();
  const exists = candidates.some((item) => item.id === id);
  const candidate = {
    id,
    name: document.querySelector("#candidateName").value.trim(),
    contact: document.querySelector("#candidateContact").value.trim(),
    age: document.querySelector("#candidateAge").value.trim(),
    vacancy: document.querySelector("#candidateVacancy").value.trim(),
    hhUrl: document.querySelector("#candidateHhUrl").value.trim(),
    status: document.querySelector("#candidateStatus").value,
    followup: document.querySelector("#candidateFollowup").value,
    owner: document.querySelector("#candidateOwner").value.trim(),
    tags: normalizeTags(document.querySelector("#candidateTags").value),
    comment: document.querySelector("#candidateComment").value.trim(),
    updatedAt: new Date().toISOString(),
  };

  candidates = candidates.some((item) => item.id === id)
    ? candidates.map((item) => (item.id === id ? candidate : item))
    : [candidate, ...candidates];

  await persist(candidate, exists ? "PUT" : "POST");
  if (USE_API) candidates = await loadCandidates();
  els.dialog.close();
  render();
}

async function deleteCandidate() {
  const id = document.querySelector("#candidateId").value;
  if (!id) return;
  candidates = candidates.filter((candidate) => candidate.id !== id);
  await removeCandidate(id);
  els.dialog.close();
  render();
}

function exportCsv() {
  const rows = [
    ["Имя", "Контакт", "Возраст", "Вакансия", "Статус", "Дата возврата", "Ссылка HH", "HR", "Теги", "Комментарий"],
    ...getVisibleCandidates().map((candidate) => [
      candidate.name,
      candidate.contact,
      candidate.age,
      candidate.vacancy,
      candidate.status,
      candidate.followup,
      candidate.hhUrl,
      candidate.owner,
      normalizeTags(candidate.tags).join("; "),
      candidate.comment,
    ]),
  ];

  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `hr-reserve-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function migrateCandidate(candidate) {
  const statusMap = {
    "Новый отклик": "Новый",
    "Ждем ответа": "Новый",
    "Резерв на лето": "Резерв лето",
    "Резерв позже": "Резерв лето",
    "Не подошел сейчас": "Отказ",
    "Принят": "Архив",
    "ND": "n/д",
  };

  return {
    ...candidate,
    status: statusMap[candidate.status] || (STATUSES.includes(candidate.status) ? candidate.status : "Новый"),
    age: candidate.age || "",
    hhUrl: candidate.hhUrl || "",
  };
}

function requestNotifications() {
  if (!("Notification" in window)) {
    alert("Браузер не поддерживает уведомления. Список 'Вернуться' все равно будет работать.");
    return;
  }

  Notification.requestPermission().then(() => {
    updateNotificationButton();
    notifyDueCandidates(candidates.filter(isFollowupDue), true);
  });
}

function updateNotificationButton() {
  if (!("Notification" in window)) {
    els.notifyButton.textContent = "Уведомления недоступны";
    els.notifyButton.disabled = true;
    return;
  }

  els.notifyButton.textContent = Notification.permission === "granted" ? "Уведомления включены" : "Включить уведомления";
}

function notifyDueCandidates(items, force = false) {
  if (!("Notification" in window) || Notification.permission !== "granted" || !items.length) return;
  const todayKey = new Date().toISOString().slice(0, 10);
  const notifyKey = `hr-reserve-notified-${todayKey}`;
  if (!force && localStorage.getItem(notifyKey)) return;

  new Notification("HR Reserve: пора вернуться", {
    body: `Кандидатов к контакту сегодня: ${items.length}`,
  });
  localStorage.setItem(notifyKey, "1");
}

function normalizeTags(value) {
  if (Array.isArray(value)) return value.map((tag) => String(tag).trim()).filter(Boolean);
  return String(value || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${value}T00:00:00`));
}

function sortByFollowup(a, b) {
  return new Date(a.followup) - new Date(b.followup);
}

function isFollowupDue(candidate) {
  if (!candidate.followup) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const followup = new Date(`${candidate.followup}T00:00:00`);
  return followup <= today;
}

function getFollowupClass(candidate) {
  if (!candidate.followup) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const followup = new Date(`${candidate.followup}T00:00:00`);
  const diffDays = Math.ceil((followup - today) / 86400000);
  if (diffDays <= 0) return "followup-due";
  if (diffDays <= 7) return "followup-soon";
  return "";
}

function csvCell(value) {
  return `"${String(value || "").replaceAll('"', '""')}"`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
