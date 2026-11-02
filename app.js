import { api, ApiError, hasSession, login, logout, onAuthChange, subscribeEvents } from "./api.js";

// ---------- справочники ----------

const STATUSES = [
  ["new", "Новая"],
  ["docs_collecting", "Сбор документов"],
  ["docs_ready", "Документы готовы"],
  ["account_ready", "Учётка готова"],
  ["booking", "Запись"],
  ["booked", "Записан"],
  ["submitted", "Подано"],
  ["done", "Готово"],
  ["cancelled", "Отменено"],
];
const STATUS_LABEL = Object.fromEntries(STATUSES);

const COUNTRIES = [
  ["IT", "Италия"], ["FR", "Франция"], ["ES", "Испания"], ["LT", "Литва"], ["FI", "Финляндия"],
  ["AT", "Австрия"], ["DE", "Германия"], ["CZ", "Чехия"], ["GR", "Греция"], ["PL", "Польша"],
  ["HU", "Венгрия"], ["NL", "Нидерланды"], ["BE", "Бельгия"], ["PT", "Португалия"], ["CH", "Швейцария"],
  ["LV", "Латвия"], ["EE", "Эстония"], ["SK", "Словакия"], ["SI", "Словения"], ["HR", "Хорватия"],
  ["MT", "Мальта"], ["DK", "Дания"], ["SE", "Швеция"], ["NO", "Норвегия"], ["GB", "Великобритания"],
  ["US", "США"],
];
const COUNTRY_LABEL = Object.fromEntries(COUNTRIES);

const DOC_TYPES = [
  ["passport", "Паспорт"],
  ["photo", "Фото"],
  ["form", "Анкета"],
  ["bank_statement", "Выписка из банка"],
  ["booking_confirmation", "Подтверждение записи"],
  ["visa", "Виза"],
  ["refusal", "Письмо об отказе"],
  ["other", "Другое"],
];
const DOC_LABEL = Object.fromEntries(DOC_TYPES);

const DECISIONS = [
  ["approved", "Виза одобрена"],
  ["refused", "Отказ"],
  ["withdrawn", "Клиент отказался"],
];
const DECISION_LABEL = Object.fromEntries(DECISIONS);
const DECISION_SHORT = { approved: "Одобрена", refused: "Отказ", withdrawn: "Отказался" };

function fmtDay(iso) {
  return iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("ru-RU") : "";
}

function outcomeText(app) {
  if (app.decision === "approved") {
    const dates = app.visa_valid_from && app.visa_valid_to ? `, виза ${fmtDay(app.visa_valid_from)} – ${fmtDay(app.visa_valid_to)}` : "";
    return `Виза одобрена${dates}`;
  }
  if (app.decision === "refused") return `Отказ${app.refusal_reason ? `: ${app.refusal_reason}` : ""}`;
  if (app.decision === "withdrawn") return "Клиент отказался от поездки";
  return "";
}

// «Чем закончилось?» — спрашиваем при переводе сделки в «Готово» и при исправлении итога.
function askOutcome(app = {}) {
  return new Promise((resolve) => {
    let decision = app.decision ?? "approved";
    const decidedOn = h("input", { type: "date", id: "outcome-date", value: app.decision_on ?? new Date().toISOString().slice(0, 10) });
    const from = h("input", { type: "date", id: "outcome-from", value: app.visa_valid_from ?? "" });
    const to = h("input", { type: "date", id: "outcome-to", value: app.visa_valid_to ?? "" });
    const reason = h("textarea", { rows: 3, id: "outcome-reason", placeholder: "Как в письме посольства, например: «цель поездки не подтверждена»" }, app.refusal_reason ?? "");
    const approvedBox = h("div", { class: "grid2" }, h("label", { class: "field" }, "Виза действует с", from), h("label", { class: "field" }, "по", to));
    const refusedBox = h("label", { class: "field" }, "Причина отказа", reason);
    const choice = h(
      "div",
      { class: "segmented outcome-choice", role: "radiogroup" },
      DECISIONS.map(([d, label]) =>
        h(
          "button",
          {
            role: "radio",
            "aria-checked": String(decision === d),
            class: `${decision === d ? "active" : ""} outcome-${d}`,
            onclick: (e) => {
              decision = d;
              e.currentTarget.parentElement.querySelectorAll("button").forEach((b) => {
                b.classList.toggle("active", b === e.currentTarget);
                b.setAttribute("aria-checked", String(b === e.currentTarget));
              });
              sync();
            },
          },
          label,
        ),
      ),
    );
    const sync = () => {
      approvedBox.hidden = decision !== "approved";
      refusedBox.hidden = decision !== "refused";
    };
    sync();
    openModal(
      "Чем закончилось?",
      h("div", { class: "form" }, choice, h("label", { class: "field" }, "Дата решения", decidedOn), approvedBox, refusedBox, h("p", { class: "muted small" }, "Скан визы или письмо об отказе прикрепите в папку — тип «Виза» или «Письмо об отказе».")),
      [
        (c) => h("button", { onclick: () => { c(); resolve(null); } }, "Отмена"),
        (c) =>
          h(
            "button",
            {
              class: "primary",
              onclick: () => {
                if (decision === "approved" && from.value && to.value && to.value < from.value) {
                  toast("Дата окончания визы раньше даты начала", "error");
                  return;
                }
                c();
                resolve({
                  decision,
                  decision_on: decidedOn.value || null,
                  visa_valid_from: decision === "approved" ? from.value || null : null,
                  visa_valid_to: decision === "approved" ? to.value || null : null,
                  refusal_reason: decision === "refused" ? reason.value.trim() || null : null,
                });
              },
            },
            "Сохранить итог",
          ),
      ],
    );
  });
}

const PORTALS = [["vfs", "VFS Global"], ["tlscontact", "TLScontact"], ["bls", "BLS"], ["embassy", "Посольство"], ["other", "Другой"]];
const PORTAL_LABEL = Object.fromEntries(PORTALS);

// ---------- DOM-хелперы (только textContent, никакого innerHTML с данными) ----------

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
    else if (key === "value") el.value = value;
    else if (key === "checked" || key === "disabled" || key === "selected" || key === "hidden") el[key] = Boolean(value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

function select(options, value, props = {}) {
  return h(
    "select",
    props,
    options.map(([v, label]) => h("option", { value: v, selected: String(v) === String(value ?? "") }, label)),
  );
}

function fmtDate(iso, withTime = true) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", withTime ? { dateStyle: "short", timeStyle: "short" } : { dateStyle: "short" });
}

function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function toast(message, kind = "info") {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.className = `toast toast-${kind}`;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    el.hidden = true;
  }, 4000);
}

function errorMessage(err) {
  if (err instanceof ApiError) return err.message;
  return "Сетевая ошибка";
}

async function guard(fn) {
  try {
    return await fn();
  } catch (err) {
    toast(errorMessage(err), "error");
    return undefined;
  }
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

const ICONS = {
  chat: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z",
  board: "M4 4h4.5v16H4zM10 4h4.5v11H10zM16 4h4v7.5h-4z",
  key: "M14.5 4a5.5 5.5 0 1 1-5 7.8L3 18.3V21h3v-2h2v-2h2l1.2-1.2A5.5 5.5 0 0 1 14.5 4zM15.5 8.5h.01",
  back: "M15 18l-6-6 6-6",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
  auto: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 3v18M12 7.5h4.5M12 12h6M12 16.5h4.5",
  alert: "M12 3.5l9 16H3zM12 10v4M12 17v.5",
  logout: "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10",
  filter: "M4 5h16l-6 8v5l-4 2v-7z",
  plus: "M12 5v14M5 12h14",
  send: "M4.5 12L20 4l-5 16-3-6.5zM12 13.5L20 4",
  clip: "M20 11.5l-8 8a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7.5-7.5",
  file: "M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5",
  lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4",
  close: "M6 6l12 12M18 6L6 18",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  check: "M5 12.5l4.5 4.5L19 7.5",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  arrow: "M5 12h14M13 6l6 6-6 6",
  deals: "M3 7h18M3 12h18M3 17h12",
  qr: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2zM16 16h2v2h-2z",
  users: "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 19v-1a4 4 0 0 0-3-3.9M15.5 3.6a3.5 3.5 0 0 1 0 6.8",
  user: "M20 20v-1a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v1M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  edit: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
  history: "M3 12a9 9 0 1 0 2.6-6.4L3 8M3 3v5h5M12 7.5V12l3 2",
  home: "M4 11l8-7 8 7M6 9.5V20h4.5v-5.5h3V20H18V9.5",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5V12l3 2",
  inbox: "M4 13l2.5-8h11L20 13v6H4zM4 13h4.5l1 2.5h5l1-2.5H20",
  passport: "M6 3h11a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6zM12 8a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM9 17.5h6",
  spark: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z",
};

function icon(name, size = 18) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("ic");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", ICONS[name]);
  svg.append(path);
  return svg;
}

function iconButton(name, label, onclick, cls = "") {
  return h("button", { class: `icon-btn ${cls}`, onclick, title: label, "aria-label": label }, icon(name));
}

function initials(name) {
  const parts = String(name || "?").replace(/[^\p{L}\p{N}\s]/gu, "").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function avatar(name, seed = 0, cls = "") {
  return h("span", { class: `avatar hue-${Math.abs(Number(seed) || 0) % 6} ${cls}`, "aria-hidden": "true" }, initials(name));
}

function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Сегодня";
  if (same(d, yesterday)) return "Вчера";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function fmtShort(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString()) return fmtTime(iso);
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

// Тема: «Авто» следует системе (и выбору хоста, если страница встроена), «Светлая»/«Тёмная» — явный выбор.
const THEME_KEY = "crm.theme";
const HOST_THEME = document.documentElement.getAttribute("data-theme");
const THEMES = { system: ["auto", "Тема: авто"], light: ["sun", "Тема: светлая"], dark: ["moon", "Тема: тёмная"] };

function readTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t in THEMES ? t : "system";
  } catch {
    return "system";
  }
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "system") {
    if (HOST_THEME) root.setAttribute("data-theme", HOST_THEME);
    else root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
}


function openModal(title, body, actions = []) {
  const overlay = h("div", { class: "modal-overlay" });
  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  const box = h(
    "div",
    { class: "modal", role: "dialog", "aria-modal": "true" },
    h("div", { class: "modal-head" }, h("h3", {}, title), iconButton("close", "Закрыть", close)),
    h("div", { class: "modal-body" }, body),
    actions.length ? h("div", { class: "modal-actions" }, actions.map((a) => a(close))) : null,
  );
  overlay.append(box);
  document.body.append(overlay);
  return close;
}

function confirmDialog(title, text, okLabel = "Подтвердить") {
  return new Promise((resolve) => {
    openModal(title, h("p", {}, text), [
      (c) => h("button", { onclick: () => { c(); resolve(false); } }, "Отмена"),
      (c) => h("button", { class: "primary", onclick: () => { c(); resolve(true); } }, okLabel),
    ]);
  });
}

function askDateTime(title) {
  return new Promise((resolve) => {
    const input = h("input", { type: "datetime-local", id: "appointment-input" });
    openModal(title, h("div", { class: "form" }, h("label", {}, "Дата и время записи", input)), [
      (c) => h("button", { onclick: () => { c(); resolve(null); } }, "Отмена"),
      (c) =>
        h("button", {
          class: "primary",
          onclick: () => {
            if (!input.value) {
              toast("Укажите дату и время", "error");
              return;
            }
            c();
            resolve(new Date(input.value).toISOString());
          },
        }, "Сохранить"),
    ]);
    input.focus();
  });
}

// ---------- состояние ----------

const state = {
  me: null,
  users: [],
  view: "today",
  today: null,
  todayMine: false,
  filters: { q: "", country: "", status: "", assigned_user_id: "", unread: false },
  contacts: [],
  contactId: null,
  messages: [],
  selectedFiles: new Set(),
  folder: null,
  board: [],
  boardCountry: "",
  deadCount: 0,
  revealed: new Map(),
  stopEvents: null,
  clientId: null,
  client: null, // { folder, history }
  clientFocus: null, // id заявки, на которой открыта карточка (клик по сделке в Kanban)
  clientBack: "clients",
  clients: [],
  clientsQuery: "",
  clientsCountry: "",
  revealedPassports: new Map(),
  settingsTab: "profile",
  deadDismissed: 0,
  boardStage: null, // мобильный вид сделок: выбранный этап
  boardMine: false,
  clientTab: "deals", // мобильная карточка клиента: deals | info | passwords | history
  channel: null, // { provider, state, phone, updated_at }
  channelQr: null,
  channelTimer: null,
  pane: "list", // мобильный/планшетный режим: какой экран показан (list | chat | folder)
  filtersOpen: false,
  accounts: [],
  accountsFilter: "all",
  accountsQuery: "",
  theme: readTheme(),
};

applyTheme(state.theme);

const userName = (id) => state.users.find((u) => u.id === id)?.full_name ?? "—";

// ---------- логин ----------

function renderLogin() {
  const root = document.getElementById("root");
  const email = h("input", { type: "email", id: "login-email", placeholder: "name@agency.kz", autocomplete: "username", required: true });
  const password = h("input", { type: "password", id: "login-password", placeholder: "Пароль", autocomplete: "current-password", required: true });
  const form = h(
    "form",
    {
      class: "login",
      onsubmit: async (e) => {
        e.preventDefault();
        await guard(() => login(email.value.trim(), password.value));
      },
    },
    h("div", { class: "brand brand-lg" }, h("span", { class: "logo" }, "V"), "Visa CRM"),
    h("p", { class: "muted" }, "Заявки, переписка и учётки порталов в одном окне"),
    h("label", { class: "field" }, "Email", email),
    h("label", { class: "field" }, "Пароль", password),
    h("button", { type: "submit", class: "primary block" }, "Войти"),
  );
  root.replaceChildren(h("div", { class: "login-wrap" }, form));
  email.focus();
}

// ---------- каркас ----------

async function boot() {
  state.me = await api.get("/api/auth/me");
  state.users = await api.get("/api/users");
  renderShell();
  await Promise.all([loadContacts(), loadDeadCount(), loadChannel(), state.view === "today" ? loadToday() : null]);
  state.stopEvents?.();
  state.stopEvents = subscribeEvents(handleEvent);
}

const isNarrow = () => window.matchMedia("(max-width: 760px)").matches;

function navItems() {
  return [
    ["today", "Сегодня", "home"],
    ["chats", "Диалоги", "chat"],
    ["board", "Сделки", "board"],
    ["clients", "Клиенты", "users"],
  ];
}

function activeNav() {
  if (state.view === "client") return state.clientBack === "client" ? "clients" : state.clientBack;
  return state.view;
}

function unreadCount() {
  return state.contacts.filter((c) => c.unread_count > 0).length;
}

function updateUnreadBadges() {
  const n = unreadCount();
  document.querySelectorAll("[data-unread]").forEach((el) => {
    el.textContent = String(n);
    el.hidden = !n;
  });
}

const ROLE_LABEL = { admin: "Администратор", manager: "Менеджер" };

function renderBanners() {
  const box = document.getElementById("banners");
  if (!box) return;
  const items = [];
  if (channelDown()) {
    items.push(
      h(
        "div",
        { class: "banner danger" },
        icon("alert", 18),
        h("span", {}, h("strong", {}, "WhatsApp не подключён. "), "Новые сообщения не приходят и не отправляются."),
        state.me.role === "admin"
          ? h("button", { class: "small", onclick: () => openSettings("whatsapp") }, "Подключить")
          : h("span", { class: "muted small" }, "Сообщите администратору"),
      ),
    );
  }
  if (state.deadCount > 0 && state.me.role === "admin" && state.deadDismissed < state.deadCount) {
    items.push(
      h(
        "div",
        { class: "banner warn" },
        icon("alert", 18),
        h("span", {}, `Есть сбои: ${state.deadCount}`, h("span", { class: "hide-xs" }, " — например, не скачался файл из WhatsApp")),
        h("button", { class: "small", onclick: showDeadJobs }, "Открыть"),
        iconButton(
          "close",
          "Скрыть до новых сбоев",
          () => {
            state.deadDismissed = state.deadCount;
            renderBanners();
          },
          "sm",
        ),
      ),
    );
  }
  box.replaceChildren(...items);
  box.hidden = !items.length;
}

function renderShell() {
  const root = document.getElementById("root");
  const navLink = (cls) => ([view, label, ic]) =>
    h(
      "button",
      { class: `${cls} ${activeNav() === view ? "active" : ""}`, onclick: () => switchView(view), "aria-current": activeNav() === view ? "page" : null },
      icon(ic, 20),
      h("span", { class: "nav-label" }, label),
      view === "chats" ? h("span", { class: "badge", "data-unread": "", hidden: !unreadCount() }, unreadCount()) : null,
    );
  const sidebar = h(
    "aside",
    { class: "sidebar" },
    h("div", { class: "brand" }, h("span", { class: "logo" }, "V"), h("span", { class: "brand-name" }, "Visa CRM")),
    h("nav", { class: "side-nav", "aria-label": "Разделы" }, navItems().map(navLink("side-item"))),
    h("div", { class: "spacer" }),
    h(
      "button",
      { class: `side-item ${state.view === "settings" ? "active" : ""}`, onclick: () => openSettings(state.me.role === "admin" ? state.settingsTab : "profile") },
      icon("settings", 20),
      h("span", { class: "nav-label" }, "Настройки"),
    ),
    h(
      "button",
      { class: "side-user", onclick: () => openSettings("profile"), title: "Мой профиль" },
      avatar(state.me.full_name, state.me.id, "sm"),
      h("span", { class: "side-user-text" }, h("span", { class: "side-user-name" }, state.me.full_name), h("span", { class: "side-user-role" }, ROLE_LABEL[state.me.role])),
    ),
  );
  const tabbar = h(
    "nav",
    { class: "tabbar", "aria-label": "Разделы" },
    navItems().map(navLink("tab-item")),
    h(
      "button",
      { class: `tab-item ${state.view === "settings" ? "active" : ""}`, onclick: () => openSettings("profile") },
      avatar(state.me.full_name, state.me.id, "xs"),
      h("span", { class: "nav-label" }, "Профиль"),
    ),
  );
  const mainCol = h("div", { class: "app-main" }, h("div", { id: "banners", class: "banners", hidden: true }), h("main", { id: "main" }));
  root.replaceChildren(h("div", { class: "app" }, sidebar, mainCol, tabbar));
  renderBanners();
  renderMain();
}

function switchView(view) {
  if (view === "accounts") return openSettings("accounts");
  if (view === "channel") return openSettings("whatsapp");
  state.view = view;
  if (view === "chats" && !state.contactId) state.pane = "list";
  renderShell();
  if (view === "board") loadBoard();
  if (view === "clients") loadClients();
  if (view === "today") loadToday();
  stopChannelPolling();
}

function openSettings(tab) {
  const allowed = settingsTabs().map(([t]) => t);
  state.settingsTab = allowed.includes(tab) ? tab : "profile";
  state.view = "settings";
  renderShell();
}

function setPane(pane) {
  state.pane = pane;
  const main = document.getElementById("main");
  if (main) main.dataset.pane = pane;
}

function renderMain() {
  const main = document.getElementById("main");
  if (!main) return;
  delete main.dataset.pane;
  if (state.view === "chats") {
    main.className = "three-col";
    main.dataset.pane = state.pane;
    main.replaceChildren(
      h("section", { id: "col-contacts", class: "col col-list", "aria-label": "Диалоги" }),
      h("section", { id: "col-chat", class: "col col-chat", "aria-label": "Чат" }),
      h("section", { id: "col-folder", class: "col col-folder", "aria-label": "Папка" }),
    );
    renderContacts();
    renderChat();
    renderFolder();
  } else if (state.view === "today") {
    main.className = "page-wrap";
    renderToday();
  } else if (state.view === "board") {
    main.className = "page-wrap board-page";
    renderBoard();
  } else if (state.view === "settings") {
    main.className = "page-wrap";
    renderSettings();
  } else {
    main.className = "page-wrap";
    main.replaceChildren(h("div", { class: "placeholder" }, "Загрузка…"));
    if (state.view === "client" && state.client) renderClient();
    if (state.view === "clients" && state.clients.length) renderClients();
  }
}

// ---------- настройки: профиль, команда, WhatsApp, учётки ----------

function settingsTabs() {
  const tabs = [["profile", "Мой профиль", "user"]];
  if (state.me?.role === "admin") tabs.push(["team", "Сотрудники", "users"], ["whatsapp", "WhatsApp", "qr"], ["accounts", "Учётки порталов", "key"]);
  return tabs;
}

function renderSettings() {
  const main = document.getElementById("main");
  if (!main || state.view !== "settings") return;
  const tabs = settingsTabs();
  main.replaceChildren(
    h(
      "div",
      { class: "page settings" },
      h("div", { class: "page-head" }, h("h1", {}, "Настройки")),
      tabs.length > 1
        ? h(
            "nav",
            { class: "segmented", "aria-label": "Разделы настроек" },
            tabs.map(([t, label, ic]) =>
              h(
                "button",
                {
                  class: state.settingsTab === t ? "active" : "",
                  onclick: () => {
                    state.settingsTab = t;
                    stopChannelPolling();
                    renderSettings();
                  },
                },
                icon(ic, 16),
                label,
              ),
            ),
          )
        : null,
      h("div", { id: "settings-body", class: "settings-body" }),
    ),
  );
  if (state.settingsTab === "profile") renderProfile();
  if (state.settingsTab === "team") loadTeam();
  if (state.settingsTab === "whatsapp") {
    renderChannel();
    guard(() => api.post("/api/channel/refresh")).then((r) => {
      if (r && state.settingsTab === "whatsapp") {
        state.channel = r;
        renderChannel();
        renderBanners();
      }
    });
  }
  if (state.settingsTab === "accounts") loadAccounts();
}

function setTheme(theme) {
  state.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* хранилище недоступно — тема действует до перезагрузки */
  }
  applyTheme(theme);
}

function renderProfile() {
  const body = document.getElementById("settings-body");
  if (!body || state.settingsTab !== "profile") return;
  const me = state.me;
  const name = h("input", { id: "profile-name", value: me.full_name, autocomplete: "name" });
  const cur = h("input", { id: "pw-current", type: "password", autocomplete: "current-password" });
  const next = h("input", { id: "pw-new", type: "password", autocomplete: "new-password", placeholder: "Не короче 12 символов" });
  const again = h("input", { id: "pw-again", type: "password", autocomplete: "new-password" });
  const themeBtn = (t, label) =>
    h(
      "button",
      {
        class: state.theme === t ? "active" : "",
        onclick: () => {
          setTheme(t);
          renderProfile();
        },
      },
      label,
    );
  body.replaceChildren(
    h(
      "section",
      { class: "card" },
      h(
        "div",
        { class: "profile-head" },
        avatar(me.full_name, me.id, "lg"),
        h("div", {}, h("div", { class: "profile-name" }, me.full_name), h("div", { class: "muted" }, `${me.email} · ${ROLE_LABEL[me.role]}`)),
      ),
      h("label", { class: "field" }, "Имя и фамилия — так вас видят коллеги в чатах и сделках", name),
      h(
        "div",
        { class: "form-actions" },
        h(
          "button",
          {
            class: "primary",
            onclick: async () => {
              const r = await guard(() => api.patch("/api/auth/me", { full_name: name.value }));
              if (r) {
                state.me = r;
                const u = state.users.find((x) => x.id === r.id);
                if (u) u.full_name = r.full_name;
                toast("Профиль сохранён");
                renderShell();
              }
            },
          },
          "Сохранить",
        ),
      ),
    ),
    h(
      "section",
      { class: "card" },
      h("h2", {}, "Пароль"),
      h("label", { class: "field" }, "Текущий пароль", cur),
      h("div", { class: "grid2" }, h("label", { class: "field" }, "Новый пароль", next), h("label", { class: "field" }, "Повторите новый", again)),
      h("p", { class: "muted small" }, "После смены пароля вы останетесь в системе здесь, а на других устройствах нужно будет войти заново."),
      h(
        "div",
        { class: "form-actions" },
        h(
          "button",
          {
            onclick: async () => {
              if (next.value !== again.value) return toast("Новые пароли не совпадают", "error");
              const ok = await guard(() => api.post("/api/auth/me/password", { current_password: cur.value, new_password: next.value }));
              if (ok !== undefined) {
                cur.value = next.value = again.value = "";
                toast("Пароль изменён");
              }
            },
          },
          "Сменить пароль",
        ),
      ),
    ),
    h(
      "section",
      { class: "card" },
      h("h2", {}, "Оформление"),
      h("div", { class: "segmented small" }, themeBtn("system", "Как в системе"), themeBtn("light", "Светлая"), themeBtn("dark", "Тёмная")),
    ),
    h("section", { class: "card" }, h("button", { class: "danger-outline", onclick: () => logout() }, icon("logout", 16), "Выйти из CRM")),
  );
}

function tempPassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint32Array(14));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function showTempPassword(title, email, password) {
  openModal(
    title,
    h(
      "div",
      { class: "form" },
      h("p", {}, "Передайте сотруднику логин и временный пароль. Пароль показан один раз — после входа он сможет сменить его в профиле."),
      h("div", { class: "cred" }, h("div", { class: "cred-line" }, h("span", { class: "cred-label" }, "Логин"), h("code", { class: "cred-value" }, email)), h("div", { class: "cred-line" }, h("span", { class: "cred-label" }, "Пароль"), h("code", { class: "cred-value" }, password))),
    ),
    [(c) => h("button", { class: "primary", onclick: () => copyText(`Visa CRM\nЛогин: ${email}\nПароль: ${password}`, "Скопировано").then(c) }, icon("copy", 16), "Скопировать и закрыть")],
  );
}

async function loadTeam() {
  const users = await guard(() => api.get("/api/users"));
  if (!users) return;
  state.users = users;
  renderTeam();
}

function renderTeam() {
  const body = document.getElementById("settings-body");
  if (!body || state.settingsTab !== "team") return;
  const add = () => {
    const name = h("input", { id: "new-user-name", placeholder: "Анна Ким" });
    const email = h("input", { id: "new-user-email", type: "email", placeholder: "anna@agency.kz" });
    const role = select([["manager", "Менеджер — видит свои и новые сделки"], ["admin", "Администратор — видит всё, настраивает CRM"]], "manager");
    openModal("Новый сотрудник", h("div", { class: "form" }, h("label", { class: "field" }, "Имя и фамилия", name), h("label", { class: "field" }, "Email для входа", email), h("label", { class: "field" }, "Роль", role)), [
      (c) => h("button", { onclick: c }, "Отмена"),
      (c) =>
        h(
          "button",
          {
            class: "primary",
            onclick: async () => {
              const password = tempPassword();
              const r = await guard(() => api.post("/api/users", { full_name: name.value, email: email.value, role: role.value, password }));
              if (r) {
                c();
                await loadTeam();
                showTempPassword("Сотрудник добавлен", r.email, password);
              }
            },
          },
          "Добавить",
        ),
    ]);
  };
  body.replaceChildren(
    h(
      "section",
      { class: "card" },
      h("div", { class: "card-head" }, h("h2", {}, `Сотрудники (${state.users.filter((u) => u.is_active).length})`), h("button", { class: "primary small", onclick: add }, icon("plus", 16), "Добавить")),
      h(
        "ul",
        { class: "people" },
        state.users.map((u) =>
          h(
            "li",
            { class: u.is_active ? "" : "inactive" },
            avatar(u.full_name, u.id),
            h("div", { class: "person-text" }, h("strong", {}, u.full_name, u.id === state.me.id ? h("span", { class: "muted" }, " (вы)") : null), h("span", { class: "muted small" }, u.email)),
            u.id === state.me.id
              ? h("span", { class: "role-tag" }, ROLE_LABEL[u.role])
              : h(
                  "div",
                  { class: "person-actions" },
                  select([["manager", "Менеджер"], ["admin", "Администратор"]], u.role, {
                    "aria-label": "Роль",
                    onchange: async (e) => {
                      if (await guard(() => api.patch(`/api/users/${u.id}`, { role: e.target.value }))) toast("Роль изменена");
                      loadTeam();
                    },
                  }),
                  h(
                    "button",
                    {
                      class: "small",
                      onclick: async () => {
                        const password = tempPassword();
                        if (!(await confirmDialog("Сбросить пароль", `${u.full_name} не сможет войти со старым паролем, все его сессии завершатся.`, "Сбросить"))) return;
                        if (await guard(() => api.patch(`/api/users/${u.id}`, { password }))) showTempPassword("Новый пароль", u.email, password);
                      },
                    },
                    "Сбросить пароль",
                  ),
                  h(
                    "button",
                    {
                      class: `small ${u.is_active ? "danger-outline" : ""}`,
                      onclick: async () => {
                        if (u.is_active && !(await confirmDialog("Отключить сотрудника", `${u.full_name} больше не сможет войти. Его сделки останутся за ним — переназначьте их при необходимости.`, "Отключить"))) return;
                        await guard(() => api.patch(`/api/users/${u.id}`, { is_active: !u.is_active }));
                        loadTeam();
                      },
                    },
                    u.is_active ? "Отключить" : "Включить",
                  ),
                ),
          ),
        ),
      ),
    ),
  );
}

// ---------- колонка 1: диалоги ----------

async function loadContacts() {
  const f = state.filters;
  const contacts = await guard(() =>
    api.get("/api/contacts", {
      q: f.q,
      country: f.country,
      status: f.status,
      assigned_user_id: f.assigned_user_id,
      unread: f.unread,
      limit: 100,
    }),
  );
  if (contacts) {
    state.contacts = contacts;
    renderContactList();
  }
}

const reloadContacts = debounce(loadContacts, 300);

function activeFilterCount() {
  const f = state.filters;
  return [f.country, f.status, f.assigned_user_id, f.unread].filter(Boolean).length;
}

function renderContacts() {
  const col = document.getElementById("col-contacts");
  if (!col) return;
  const f = state.filters;
  const search = h("input", {
    type: "search",
    id: "contact-search",
    placeholder: "Имя, телефон, ФИО, № паспорта",
    value: f.q,
    "aria-label": "Поиск",
    oninput: (e) => {
      f.q = e.target.value;
      reloadContacts();
    },
  });
  const onFilter = (key) => (e) => {
    f[key] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    renderContacts();
    loadContacts();
  };
  const n = activeFilterCount();
  const filters = h(
    "div",
    { class: "filters", hidden: !state.filtersOpen },
    select([["", "Все страны"], ...COUNTRIES], f.country, { onchange: onFilter("country"), "aria-label": "Страна" }),
    select([["", "Все статусы"], ...STATUSES], f.status, { onchange: onFilter("status"), "aria-label": "Статус" }),
    select([["", "Все менеджеры"], ...state.users.map((u) => [u.id, u.full_name])], f.assigned_user_id, {
      onchange: onFilter("assigned_user_id"),
      "aria-label": "Менеджер",
    }),
    h("label", { class: "check" }, h("input", { type: "checkbox", checked: f.unread, onchange: onFilter("unread") }), "Только непрочитанные"),
    n
      ? h(
          "button",
          {
            class: "link small",
            onclick: () => {
              Object.assign(f, { country: "", status: "", assigned_user_id: "", unread: false });
              renderContacts();
              loadContacts();
            },
          },
          "Сбросить фильтры",
        )
      : null,
  );
  col.replaceChildren(
    h(
      "div",
      { class: "col-head list-head" },
      h(
        "div",
        { class: "search-row" },
        h("div", { class: "search" }, icon("search", 16), search),
        h(
          "button",
          {
            class: `icon-btn ${state.filtersOpen || n ? "on" : ""}`,
            title: "Фильтры",
            "aria-label": "Фильтры",
            "aria-expanded": String(state.filtersOpen),
            onclick: () => {
              state.filtersOpen = !state.filtersOpen;
              renderContacts();
            },
          },
          icon("filter"),
          n ? h("span", { class: "dot-count" }, n) : null,
        ),
        iconButton("plus", "Новый контакт", newContactDialog),
      ),
      filters,
    ),
    h("ul", { id: "contact-list", class: "list" }),
  );
  renderContactList();
}

function renderContactList() {
  updateUnreadBadges();
  const list = document.getElementById("contact-list");
  if (!list) return;
  if (!state.contacts.length) {
    list.replaceChildren(h("li", { class: "empty" }, state.filters.q || activeFilterCount() ? "Ничего не найдено" : "Диалогов пока нет"));
    return;
  }
  list.replaceChildren(
    ...state.contacts.map((c) =>
      h(
        "li",
        {},
        h(
          "button",
          { class: `contact ${c.id === state.contactId ? "active" : ""} ${c.unread_count ? "unread" : ""}`, onclick: () => openContact(c.id) },
          avatar(c.name || c.phone, c.id),
          h(
            "span",
            { class: "contact-body" },
            h("span", { class: "contact-row" }, h("span", { class: "contact-name" }, c.name || c.phone), h("span", { class: "contact-time" }, fmtShort(c.last_message_at))),
            h("span", { class: "contact-row" }, h("span", { class: "contact-sub" }, c.phone), c.unread_count ? h("span", { class: "badge" }, c.unread_count) : null),
          ),
        ),
      ),
    ),
  );
}

function newContactDialog() {
  const phone = h("input", { id: "new-contact-phone", type: "tel", placeholder: "+7 701 123 45 67" });
  const name = h("input", { id: "new-contact-name", placeholder: "Как к нему обращаться" });
  openModal("Новый контакт", h("div", { class: "form" }, h("label", { class: "field" }, "Телефон", phone), h("label", { class: "field" }, "Имя", name)), [
    (close) =>
      h(
        "button",
        {
          class: "primary",
          onclick: async () => {
            const c = await guard(() => api.post("/api/contacts", { phone: phone.value, name: name.value || null }));
            if (c) {
              close();
              await loadContacts();
              openContact(c.id);
            }
          },
        },
        "Создать",
      ),
  ]);
}

async function openContact(id) {
  state.contactId = id;
  setPane("chat");
  state.messages = [];
  state.selectedFiles.clear();
  state.folder = null;
  renderContactList();
  renderChat();
  renderFolder();
  await Promise.all([loadMessages(), loadFolder()]);
  const c = state.contacts.find((x) => x.id === id);
  if (c?.unread_count) {
    await guard(() => api.post(`/api/contacts/${id}/read`));
    c.unread_count = 0;
    renderContactList();
  }
}

// ---------- колонка 2: чат ----------

async function loadMessages({ older = false } = {}) {
  const id = state.contactId;
  if (!id) return;
  const query = { limit: 50 };
  if (older && state.messages.length) query.before_id = state.messages[0].id;
  const items = await guard(() => api.get(`/api/contacts/${id}/messages`, query));
  if (!items || id !== state.contactId) return;
  state.messages = older ? [...items, ...state.messages] : items;
  renderChat({ keepScroll: older });
}

async function refreshMessages() {
  // Полная перезагрузка последнего окна: подтягивает и новые сообщения, и обновлённые статусы/медиа.
  const id = state.contactId;
  if (!id) return;
  const items = await guard(() => api.get(`/api/contacts/${id}/messages`, { limit: Math.max(50, state.messages.length) }));
  if (!items || id !== state.contactId) return;
  state.messages = items;
  renderChat();
}

const STATUS_ICON = { queued: "◷", sent: "✓", delivered: "✓✓", read: "✓✓", failed: "!", received: "" };
const STATUS_TITLE = { queued: "В очереди", sent: "Отправлено", delivered: "Доставлено", read: "Прочитано", failed: "Ошибка", received: "" };

function renderMessage(m) {
  const fileBlock = m.file
    ? h(
        "div",
        { class: `attachment ${state.selectedFiles.has(m.file.id) ? "selected" : ""}` },
        h("input", {
          type: "checkbox",
          class: "attach-check",
          title: "Выбрать для массовой привязки",
          "aria-label": `Выбрать ${m.file.original_name}`,
          checked: state.selectedFiles.has(m.file.id),
          onchange: (e) => {
            if (e.target.checked) state.selectedFiles.add(m.file.id);
            else state.selectedFiles.delete(m.file.id);
            e.target.closest(".attachment")?.classList.toggle("selected", e.target.checked);
            renderChatToolbar();
          },
        }),
        h(
          "button",
          { class: "attach-open", onclick: () => previewFile(m.file.id, m.file.mime, m.file.original_name) },
          fileBadge(m.file.mime, m.file.original_name, "lg"),
          h("span", { class: "attach-text" }, h("span", { class: "attach-name" }, m.file.original_name), h("span", { class: "attach-size" }, fmtSize(m.file.size))),
        ),
        h("button", { class: "chip-btn", onclick: () => attachDialog([m.file.id]) }, icon("folder", 14), "В папку"),
      )
    : m.media_pending
      ? h("div", { class: "msg-note" }, "Файл загружается…")
      : m.media_error
        ? h("div", { class: "msg-note error" }, "Файл не удалось скачать: ссылка WhatsApp истекла. Попросите клиента прислать ещё раз.")
        : null;
  return h(
    "div",
    { class: `msg ${m.direction} ${m.status === "failed" ? "failed" : ""}` },
    m.text ? h("div", { class: "msg-text" }, m.text) : null,
    fileBlock,
    h(
      "div",
      { class: "msg-meta" },
      m.author_user_id ? h("span", {}, userName(m.author_user_id)) : null,
      h("span", {}, fmtTime(m.created_at)),
      m.direction === "outbound" ? h("span", { class: `tick tick-${m.status}`, title: STATUS_TITLE[m.status] }, STATUS_ICON[m.status] ?? "") : null,
    ),
    m.error ? h("div", { class: "msg-note error" }, m.error) : null,
  );
}

function renderMessages() {
  const out = [];
  let lastDay = "";
  for (const m of state.messages) {
    const day = new Date(m.created_at).toDateString();
    if (day !== lastDay) {
      out.push(h("div", { class: "day-sep" }, h("span", {}, dayLabel(m.created_at))));
      lastDay = day;
    }
    out.push(renderMessage(m));
  }
  return out;
}

function renderChatToolbar() {
  const bar = document.getElementById("chat-toolbar");
  if (!bar) return;
  const n = state.selectedFiles.size;
  if (!n) {
    bar.replaceChildren();
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  bar.replaceChildren(
    h("span", {}, `Выбрано файлов: ${n}`),
    h("div", { class: "spacer" }),
    h(
      "button",
      {
        class: "ghost small",
        onclick: () => {
          state.selectedFiles.clear();
          renderChat({ keepScroll: true });
        },
      },
      "Отмена",
    ),
    h("button", { class: "primary small", onclick: () => attachDialog([...state.selectedFiles]) }, icon("folder", 14), "В папку"),
  );
}

function renderChat({ keepScroll = false } = {}) {
  const col = document.getElementById("col-chat");
  if (!col) return;
  if (!state.contactId) {
    const unread = unreadCount();
    col.replaceChildren(
      h(
        "div",
        { class: "placeholder" },
        h("span", { class: "placeholder-icon" }, icon("chat", 28)),
        h("strong", {}, unread ? `Ждут ответа: ${unread}` : "Все диалоги прочитаны"),
        h("p", {}, unread ? "Откройте диалог слева — непрочитанные отмечены синим." : "Новые сообщения из WhatsApp появятся слева и на экране «Сегодня»."),
      ),
    );
    return;
  }
  const contact = state.contacts.find((c) => c.id === state.contactId) ?? state.folder?.contact;
  const prevBox = document.getElementById("messages");
  const prevHeight = prevBox?.scrollHeight ?? 0;
  const prevTop = prevBox?.scrollTop ?? 0;

  const box = h(
    "div",
    { id: "messages", class: "messages" },
    state.messages.length >= 50 ? h("button", { class: "ghost small center", onclick: () => loadMessages({ older: true }) }, "Показать раньше") : null,
    state.messages.length ? renderMessages() : h("div", { class: "placeholder" }, "Сообщений пока нет"),
  );
  const text = h("textarea", { rows: 1, id: "composer-text", placeholder: "Сообщение", "aria-label": "Сообщение" });
  const grow = () => {
    text.style.height = "auto";
    text.style.height = `${Math.min(text.scrollHeight, 160)}px`;
  };
  text.addEventListener("input", grow);
  const fileInput = h("input", { type: "file", hidden: true });
  const send = async () => {
    const value = text.value.trim();
    if (!value) return;
    const ok = await guard(() =>
      api.post(`/api/contacts/${state.contactId}/messages`, { client_message_id: crypto.randomUUID(), text: value }),
    );
    if (ok) {
      text.value = "";
      grow();
      refreshMessages();
    }
  };
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  text.addEventListener("keydown", (e) => {
    // Десктоп: Enter — отправить, Shift+Enter — перенос. На телефоне Enter — перенос строки.
    if (e.key === "Enter" && !e.shiftKey && (!coarse || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      send();
    }
  });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const stored = await guard(() => api.upload("/api/files", file));
    if (stored) {
      await guard(() =>
        api.post(`/api/contacts/${state.contactId}/messages`, { client_message_id: crypto.randomUUID(), file_id: stored.id }),
      );
      refreshMessages();
    }
    fileInput.value = "";
  });
  col.replaceChildren(
    h(
      "div",
      { class: "col-head chat-head" },
      iconButton("back", "К списку диалогов", () => setPane("list"), "only-narrow"),
      avatar(contact?.name || contact?.phone, contact?.id),
      h("div", { class: "chat-title" }, h("strong", {}, contact?.name || contact?.phone || ""), h("span", { class: "muted small" }, contact?.phone ?? "")),
      h("div", { class: "spacer" }),
      h("button", { class: "ghost small", onclick: () => openClient(state.contactId, null, "chats"), title: "Все заявки, пароли и история клиента" }, icon("user", 16), h("span", { class: "hide-xs" }, "Карточка")),
      h("button", { class: "ghost small only-compact", onclick: () => setPane("folder") }, icon("folder", 16), "Папка"),
    ),
    h("div", { id: "chat-toolbar", class: "selection-bar", hidden: true }),
    box,
    h(
      "div",
      { class: "composer" },
      iconButton("clip", "Прикрепить файл", () => fileInput.click()),
      fileInput,
      text,
      h("button", { class: "send-btn", onclick: send, title: "Отправить", "aria-label": "Отправить" }, icon("send", 20)),
    ),
  );
  renderChatToolbar();
  box.scrollTop = keepScroll ? box.scrollHeight - prevHeight + prevTop : box.scrollHeight;
}

// ---------- «В папку» ----------

function attachDialog(fileIds) {
  const folder = state.folder;
  if (!folder) return;
  const applicantOptions = [
    ["", "— без заявителя —"],
    ...folder.applicants.map((a) => [a.id, `${a.last_name} ${a.first_name}`]),
    ["new", "+ Новый заявитель"],
  ];
  const allApps = [...folder.applicants.flatMap((a) => a.applications), ...folder.unassigned_applications];
  const appOptions = [["", "— без сделки —"], ...allApps.map((a) => [a.id, `#${a.id} ${COUNTRY_LABEL[a.country] ?? "страна не указана"} · ${STATUS_LABEL[a.status]}`])];

  const docType = select(DOC_TYPES, "passport");
  const applicant = select(applicantOptions, folder.applicants[0]?.id ?? "new");
  const application = select(appOptions, allApps.length === 1 ? allApps[0].id : "");
  const lastName = h("input", { placeholder: "Фамилия (латиницей)" });
  const firstName = h("input", { placeholder: "Имя (латиницей)" });
  const newBlock = h("div", { class: "grid2" }, h("label", { class: "field" }, "Фамилия латиницей", lastName), h("label", { class: "field" }, "Имя латиницей", firstName));
  const toggleNew = () => {
    newBlock.hidden = applicant.value !== "new";
  };
  applicant.addEventListener("change", toggleNew);
  toggleNew();

  openModal(
    `В папку: файлов ${fileIds.length}`,
    h(
      "div",
      { class: "form" },
      h("label", { class: "field" }, "Тип документа", docType),
      h("label", { class: "field" }, "Заявитель", applicant),
      newBlock,
      h("label", { class: "field" }, "Сделка", application),
      h("p", { class: "muted small" }, "Паспорт и фото — к заявителю, подтверждение записи — к сделке."),
    ),
    [
      (close) =>
        h(
          "button",
          {
            class: "primary",
            onclick: async () => {
              const body = { file_ids: fileIds, doc_type: docType.value };
              if (application.value) body.application_id = Number(application.value);
              if (applicant.value === "new") {
                body.new_applicant = { contact_id: folder.contact.id, last_name: lastName.value, first_name: firstName.value };
              } else if (applicant.value) {
                body.applicant_id = Number(applicant.value);
              }
              const ok = await guard(() => api.post("/api/documents", body));
              if (ok) {
                close();
                state.selectedFiles.clear();
                renderChat();
                refreshFolders();
                toast("Документы добавлены в папку");
              }
            },
          },
          "Привязать",
        ),
    ],
  );
}

async function previewFile(fileId, mime, name) {
  const link = await guard(() => api.post(`/api/files/${fileId}/link`));
  if (!link) return;
  let body;
  if (mime.startsWith("image/")) body = h("img", { class: "preview-img", src: link.url, alt: name });
  else if (mime === "application/pdf") body = h("iframe", { class: "preview-pdf", src: link.url, title: name });
  else body = h("p", {}, "Предпросмотр недоступен для этого типа файла.");
  openModal(name, body, [
    () =>
      h(
        "button",
        {
          onclick: async () => {
            const dl = await guard(() => api.post(`/api/files/${fileId}/link`, undefined, { download: true }));
            if (dl) window.open(dl.url, "_blank", "noopener");
          },
          class: "ghost",
        },
        "Открыть отдельно",
      ),
  ]);
}

// ---------- колонка 3: папка ----------

// После любой правки заявки/заявителя обновляем и папку в чате, и открытую карточку клиента.
function refreshFolders() {
  if (state.contactId) loadFolder();
  if (state.view === "client" && state.clientId) loadClient();
}

async function loadFolder() {
  const id = state.contactId;
  if (!id) return;
  const folder = await guard(() => api.get(`/api/contacts/${id}/folder`));
  if (folder && id === state.contactId) {
    state.folder = folder;
    renderFolder();
  }
}

const reloadFolder = debounce(loadFolder, 200);

// Значок файла с подписью типа — как в файловых хранилищах CRM.
function fileBadge(mime, name, size = "sm") {
  const ext = (String(name).split(".").pop() || "").toLowerCase();
  const kind = mime === "application/pdf" || ext === "pdf" ? "pdf" : String(mime).startsWith("image/") ? "img" : ["doc", "docx", "odt", "rtf"].includes(ext) ? "doc" : ["xls", "xlsx", "csv"].includes(ext) ? "xls" : "other";
  const label = { pdf: "PDF", img: ext && ext.length <= 4 ? ext.toUpperCase() : "IMG", doc: "DOC", xls: "XLS", other: ext && ext.length <= 4 ? ext.toUpperCase() : "FILE" }[kind];
  return h("span", { class: `file-badge fb-${kind} fb-${size}`, "aria-hidden": "true" }, label);
}

function renderDocs(docs, emptyText = "Документов нет") {
  if (!docs.length) return h("p", { class: "muted small empty-docs" }, emptyText);
  return h(
    "ul",
    { class: "docs" },
    docs.map((d) =>
      h(
        "li",
        {},
        h(
          "button",
          { class: "doc-open", onclick: () => previewFile(d.file_id, d.mime, d.original_name) },
          fileBadge(d.mime, d.original_name),
          h("span", { class: "doc-name" }, d.original_name),
          h("span", { class: `tag tag-${d.doc_type}` }, DOC_LABEL[d.doc_type]),
        ),
        iconButton(
          "close",
          "Отвязать документ",
          async () => {
            if (!(await confirmDialog("Отвязать документ", "Документ уйдёт из папки, файл останется в чате.", "Отвязать"))) return;
            if ((await guard(() => api.del(`/api/documents/${d.id}`))) !== undefined) refreshFolders();
          },
          "sm",
        ),
      ),
    ),
  );
}

async function revealPassword(accountId, mode, target) {
  const res = await guard(() => api.post(`/api/portal-accounts/${accountId}/reveal`));
  if (!res) return;
  if (mode === "copy") {
    await navigator.clipboard.writeText(res.password);
    toast("Пароль скопирован (запись в журнале аудита)");
  } else {
    // Храним в состоянии (не в DOM), чтобы перерисовка по SSE не прятала пароль раньше времени.
    state.revealed.set(accountId, res.password);
    target.textContent = res.password;
    setTimeout(() => {
      state.revealed.delete(accountId);
      renderFolder();
      if (state.view === "client") renderClient();
    }, 15000);
  }
}

async function openPortal(app) {
  // window.open до await — иначе браузер блокирует popup.
  const tab = window.open("about:blank", "_blank");
  const lock = await guard(() => api.post(`/api/applications/${app.id}/lock`));
  if (!lock) {
    tab?.close();
    return;
  }
  if (!lock.portal_url) {
    tab?.close();
    toast("Не задан адрес портала для заявки", "error");
  } else if (tab) {
    tab.opener = null;
    tab.location.href = lock.portal_url;
  } else {
    toast(`Заявка открыта для записи. Браузер не дал открыть вкладку — откройте ${lock.portal_url}`);
  }
  refreshFolders();
}

// Полоса стадий как в карточке сделки CRM: пройденные этапы закрашены, клик — перевод на этап.
function stageBar(app, statusSel) {
  if (app.status === "cancelled") return null;
  const order = PIPELINE.map(([st]) => st).concat("done");
  const cur = order.indexOf(app.status);
  const go = (st) => {
    if (st === app.status) return;
    statusSel.value = st;
    statusSel.dispatchEvent(new Event("change"));
  };
  return h(
    "div",
    { class: "stage-bar", role: "group", "aria-label": "Стадия сделки" },
    order.map((st, i) =>
      h(
        "button",
        {
          class: `stage-step status-${st} ${i < cur ? "passed" : ""} ${i === cur ? "current" : ""} ${st === "done" && app.decision ? `outcome-${app.decision}` : ""}`,
          title: STATUS_LABEL[st],
          "aria-current": i === cur ? "step" : null,
          onclick: () => go(st),
        },
        h("span", { class: "stage-step-label" }, st === "done" && app.decision ? DECISION_SHORT[app.decision] : STATUS_LABEL[st]),
      ),
    ),
  );
}

function renderApplication(app, applicants) {
  const statusSel = select(STATUSES, app.status, {
    class: `status-select status-${app.status}`,
    "aria-label": "Статус заявки",
    onchange: async (e) => {
      const target = e.target.value;
      const body = { status: target };
      if (target === "booked" && !app.appointment_at) {
        const when = await askDateTime("Записан: дата визита");
        if (!when) {
          e.target.value = app.status;
          return;
        }
        body.appointment_at = when;
      }
      if (target === "done" && !app.decision) {
        const outcome = await askOutcome(app);
        if (!outcome) {
          e.target.value = app.status;
          return;
        }
        body.outcome = outcome;
      }
      const ok = await guard(() => api.post(`/api/applications/${app.id}/status`, body));
      if (!ok) e.target.value = app.status;
      refreshFolders();
    },
  });
  const patch = (field, value) =>
    guard(() => api.patch(`/api/applications/${app.id}`, { [field]: value })).then(() => refreshFolders());
  const fid = (name) => `app-${app.id}-${name}`;

  const managerSel = select([["", "Не назначен"], ...state.users.filter((u) => u.is_active).map((u) => [u.id, u.full_name])], app.assigned_user_id, {
    id: fid("manager"),
    onchange: (e) => patch("assigned_user_id", e.target.value ? Number(e.target.value) : null),
  });
  const countrySel = select([["", "Не выбрана"], ...COUNTRIES], app.country, { id: fid("country"), onchange: (e) => patch("country", e.target.value || null) });
  const portalSel = select([["", "Не выбран"], ...PORTALS], app.portal, { id: fid("portal"), onchange: (e) => patch("portal", e.target.value || null) });
  const applicantSel = select([["", "Не выбран"], ...applicants.map((a) => [a.id, `${a.last_name} ${a.first_name}`])], app.applicant_id, {
    id: fid("applicant"),
    onchange: (e) => patch("applicant_id", e.target.value ? Number(e.target.value) : null),
  });
  const appointment = h("input", {
    type: "datetime-local",
    id: fid("appointment"),
    value: toLocalInput(app.appointment_at),
    onchange: (e) => patch("appointment_at", e.target.value ? new Date(e.target.value).toISOString() : null),
  });

  const acc = app.portal_account;
  const revealed = acc ? state.revealed.get(acc.id) : null;
  const pwd = h("code", { class: `secret ${revealed ? "shown" : ""}` }, revealed ?? "••••••••••");
  const accountBlock = acc
    ? h(
        "div",
        { class: "account" },
        h("div", { class: "account-head" }, icon("key", 16), h("span", { class: "muted small" }, PORTAL_LABEL[acc.portal])),
        h("div", { class: "account-line" }, h("code", { class: "account-login" }, acc.login)),
        h(
          "div",
          { class: "account-line" },
          pwd,
          iconButton("eye", "Показать пароль (запишется в журнал)", () => revealPassword(acc.id, "show", pwd), "sm"),
          iconButton("copy", "Скопировать пароль (запишется в журнал)", () => revealPassword(acc.id, "copy"), "sm"),
        ),
        acc.needs_rotation ? h("div", { class: "warn-line" }, icon("alert", 14), `Сменить пароль: ${acc.rotation_reason}`) : null,
      )
    : h("button", { class: "dashed", onclick: () => accountDialog(app) }, icon("plus", 16), "Привязать учётку портала");

  const locked =
    app.locked_by_user_id && app.locked_until && new Date(app.locked_until) > new Date()
      ? h(
          "div",
          { class: "lock-line" },
          icon("lock", 14),
          app.locked_by_user_id === state.me.id ? `Открыта вами до ${fmtTime(app.locked_until)}` : `Открыта: ${userName(app.locked_by_user_id)} до ${fmtTime(app.locked_until)}`,
          app.locked_by_user_id === state.me.id
            ? h("button", { class: "link small", onclick: () => guard(() => api.del(`/api/applications/${app.id}/lock`)).then(refreshFolders) }, "Снять")
            : null,
        )
      : null;

  return h(
    "article",
    { class: `app-card status-${app.status}` },
    h(
      "div",
      { class: "app-head" },
      h("div", { class: "app-title" }, h("strong", {}, COUNTRY_LABEL[app.country] ?? "Страна не выбрана"), h("span", { class: "muted small" }, [`Сделка #${app.id}`, applicants.find((x) => x.id === app.applicant_id)?.last_name, app.portal ? PORTAL_LABEL[app.portal] : null].filter(Boolean).join(" · "))),
      statusSel,
    ),
    stageBar(app, statusSel),
    locked,
    app.decision
      ? h(
          "div",
          { class: `outcome-line outcome-${app.decision}` },
          icon(app.decision === "approved" ? "check" : "alert", 16),
          h("span", {}, outcomeText(app), app.decision_on ? h("span", { class: "muted" }, ` · решение ${fmtDay(app.decision_on)}`) : null),
          h(
            "button",
            {
              class: "link small",
              onclick: async () => {
                const outcome = await askOutcome(app);
                if (outcome && (await guard(() => api.patch(`/api/applications/${app.id}`, { outcome })))) refreshFolders();
              },
            },
            "Изменить",
          ),
        )
      : null,
    app.appointment_at && !app.decision ? h("div", { class: "appt" }, icon("calendar", 16), `Запись: ${fmtDate(app.appointment_at)}`) : null,
    h(
      "details",
      { class: "app-details", open: !app.country || !app.portal || !app.applicant_id ? "" : null },
      h(
        "summary",
        {},
        "Параметры",
        h("span", { class: "summary-text" }, [app.assigned_user_id ? userName(app.assigned_user_id) : "менеджер не назначен", app.city].filter(Boolean).join(" · ")),
      ),
      h(
      "div",
      { class: "grid2" },
      h("label", { class: "field" }, "Страна", countrySel),
      h("label", { class: "field" }, "Портал", portalSel),
      h("label", { class: "field" }, "Заявитель", applicantSel),
      h("label", { class: "field" }, "Менеджер", managerSel),
      h("label", { class: "field" }, "Дата записи", appointment),
      h("label", { class: "field" }, "Город", h("input", { id: fid("city"), value: app.city ?? "", onchange: (e) => patch("city", e.target.value || null) })),
      ),
    ),
    accountBlock,
    h("button", { class: "primary block", onclick: () => openPortal(app), disabled: !app.portal_url }, icon("external", 16), "Открыть портал"),
    h("label", { class: "field" }, "Заметки", h("textarea", { rows: 2, id: fid("notes"), placeholder: "Например: туризм, Рим, 12–20 декабря", onchange: (e) => patch("notes", e.target.value || null) }, app.notes ?? "")),
    h("div", { class: "subhead" }, "Документы сделки"),
    renderDocs(app.documents, "Сюда попадут подтверждение записи и анкеты"),
  );
}

function renderFolder() {
  const col = document.getElementById("col-folder");
  if (!col) return;
  const folder = state.folder;
  if (!state.contactId || !folder) {
    col.replaceChildren(
      h(
        "div",
        { class: "placeholder" },
        state.contactId
          ? "Загрузка…"
          : [h("span", { class: "placeholder-icon" }, icon("folder", 28)), h("strong", {}, "Папка клиента"), h("p", {}, "Здесь появятся заявители, документы, сделки и пароли порталов выбранного клиента.")],
      ),
    );
    return;
  }
  const applicants = folder.applicants;
  col.replaceChildren(
    h(
      "div",
      { class: "col-head folder-head" },
      iconButton("back", "Назад к чату", () => setPane("chat"), "only-compact"),
      h("div", { class: "chat-title" }, h("strong", {}, "Папка"), h("span", { class: "muted small" }, folder.contact.name || folder.contact.phone)),
      h("div", { class: "spacer" }),
      h("button", { class: "ghost small", onclick: () => applicantDialog() }, icon("plus", 14), "Заявитель"),
      h("button", { class: "ghost small", onclick: () => newApplication() }, icon("plus", 14), "Сделка"),
    ),
    h(
      "div",
      { class: "folder" },
      applicants.length || folder.unassigned_applications.length ? null : h("div", { class: "placeholder" }, "В папке пока пусто. Добавьте заявителя или прикрепите файл из чата кнопкой «В папку»."),
      applicants.map((a) =>
        h(
          "section",
          { class: "applicant" },
          h(
            "div",
            { class: "applicant-head" },
            avatar(`${a.first_name} ${a.last_name}`, a.id, "sm"),
            h(
              "div",
              { class: "applicant-title" },
              h("strong", {}, `${a.last_name} ${a.first_name}`),
              a.passport_number_masked ? h("span", { class: "muted small mono" }, `Паспорт ${a.passport_number_masked}`) : h("span", { class: "warn-text small" }, "Нет паспортных данных"),
            ),
            h("button", { class: "ghost small", onclick: () => applicantDialog(a) }, "Изменить"),
          ),
          a.documents.length ? renderDocs(a.documents) : null,
          a.applications.map((app) => renderApplication(app, applicants)),
        ),
      ),
      folder.unassigned_applications.length
        ? h(
            "section",
            { class: "applicant" },
            h("div", { class: "applicant-head" }, h("div", { class: "applicant-title" }, h("strong", {}, "Сделка без заявителя"), h("span", { class: "muted small" }, "Выберите заявителя в карточке"))),
            folder.unassigned_applications.map((app) => renderApplication(app, applicants)),
          )
        : null,
    ),
  );
}

function applicantDialog(existing, contactId = state.contactId) {
  const last = h("input", { id: "ap-last", placeholder: "IVANOVA", value: existing?.last_name ?? "", autocapitalize: "characters" });
  const first = h("input", { id: "ap-first", placeholder: "AIGUL", value: existing?.first_name ?? "", autocapitalize: "characters" });
  const citizenship = select([["", "— гражданство —"], ["KZ", "Казахстан"], ["RU", "Россия"], ["KG", "Кыргызстан"], ["UZ", "Узбекистан"]], existing?.citizenship);
  const number = h("input", { placeholder: existing?.has_passport ? "Новый № паспорта (оставьте пустым, чтобы не менять)" : "№ паспорта" });
  const expires = h("input", { type: "date" });
  const birth = h("input", { type: "date" });
  openModal(existing ? "Заявитель" : "Новый заявитель", h(
    "div",
    { class: "form" },
    h("div", { class: "grid2" }, h("label", { class: "field" }, "Фамилия латиницей", last), h("label", { class: "field" }, "Имя латиницей", first)),
    h("label", { class: "field" }, "Гражданство", citizenship),
    h("label", { class: "field" }, "Номер паспорта", number),
    h("div", { class: "grid2" }, h("label", { class: "field" }, "Действителен до", expires), h("label", { class: "field" }, "Дата рождения", birth)),
    h("p", { class: "muted small" }, "Паспортные данные шифруются; просмотр фиксируется в журнале аудита."),
  ), [
    (close) =>
      h(
        "button",
        {
          class: "primary",
          onclick: async () => {
            const body = { last_name: last.value, first_name: first.value, citizenship: citizenship.value || null };
            if (number.value.trim()) {
              body.passport = { passport_number: number.value, passport_expires_on: expires.value || null, birth_date: birth.value || null };
            }
            const ok = existing
              ? await guard(() => api.patch(`/api/applicants/${existing.id}`, body))
              : await guard(() => api.post("/api/applicants", { ...body, contact_id: contactId }));
            if (ok) {
              close();
              refreshFolders();
            }
          },
        },
        "Сохранить",
      ),
  ]);
}

async function newApplication(contactId = state.contactId, applicantId = state.folder?.applicants[0]?.id ?? null) {
  const ok = await guard(() => api.post("/api/applications", { contact_id: contactId, applicant_id: applicantId }));
  if (ok) {
    refreshFolders();
    toast("Сделка создана — выберите страну и портал");
  }
}

function accountDialog(app) {
  const portal = select(PORTALS, app.portal ?? "vfs");
  const login = h("input", { type: "email", placeholder: "Email для портала" });
  const password = h("input", { placeholder: "Пусто — сгенерировать надёжный" });
  const existingSel = h("select", {}, h("option", { value: "" }, "— создать новую —"));
  guard(() => api.get("/api/portal-accounts", { limit: 200 })).then((items) => {
    (items ?? []).forEach((acc) => existingSel.append(h("option", { value: acc.id }, `${PORTAL_LABEL[acc.portal]} · ${acc.login}`)));
  });
  openModal("Учётка портала", h("div", { class: "form" }, h("label", { class: "field" }, "Уже есть учётка", existingSel), h("p", { class: "muted small" }, "или создайте новую:"), h("label", { class: "field" }, "Портал", portal), h("label", { class: "field" }, "Email для портала", login), h("label", { class: "field" }, "Пароль", password)), [
    (close) =>
      h(
        "button",
        {
          class: "primary",
          onclick: async () => {
            let accountId = existingSel.value ? Number(existingSel.value) : null;
            if (!accountId) {
              const created = await guard(() => api.post("/api/portal-accounts", { portal: portal.value, login: login.value, password: password.value || null }));
              if (!created) return;
              accountId = created.id;
              if (created.password) toast("Сгенерирован новый пароль — он доступен по кнопке «Показать»");
            }
            const ok = await guard(() => api.patch(`/api/applications/${app.id}`, { portal_account_id: accountId }));
            if (ok) {
              close();
              refreshFolders();
            }
          },
        },
        "Привязать",
      ),
  ]);
}

// ---------- главная: «Сегодня» ----------

async function loadToday() {
  const data = await guard(() => api.get("/api/today", { mine: state.todayMine }));
  if (data) {
    state.today = data;
    renderToday();
  }
}

const reloadToday = debounce(loadToday, 400);

function greeting() {
  const hr = new Date().getHours();
  if (hr < 5) return "Доброй ночи";
  if (hr < 12) return "Доброе утро";
  if (hr < 18) return "Добрый день";
  return "Добрый вечер";
}

async function takeDeal(card) {
  const ok = await guard(() => api.patch(`/api/applications/${card.id}`, { assigned_user_id: state.me.id }));
  if (ok) {
    toast("Сделка закреплена за вами");
    loadToday();
  }
}

function dayBlock(iso) {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86400000);
  const same = (a, b) => a.toDateString() === b.toDateString();
  const rel = same(d, today) ? "Сегодня" : same(d, tomorrow) ? "Завтра" : d.toLocaleDateString("ru-RU", { weekday: "short" });
  return h(
    "span",
    { class: `day-block ${same(d, today) ? "is-today" : ""}` },
    h("span", { class: "day-num" }, d.getDate()),
    h("span", { class: "day-mon" }, d.toLocaleDateString("ru-RU", { month: "short" }).replace(".", "")),
    h("span", { class: "day-rel" }, rel),
  );
}

function todayRow({ lead, title, sub, trail, onclick, action }) {
  return h(
    "li",
    { class: "t-row" },
    h("button", { class: "t-open", onclick }, lead, h("span", { class: "t-text" }, h("span", { class: "t-title" }, title), sub ? h("span", { class: "t-sub" }, sub) : null), trail ?? null),
    action ?? null,
  );
}

function todaySection({ id, title, hint, icon: ic, tone, items, empty, render, more }) {
  return h(
    "section",
    { class: `panel t-section tone-${tone}`, id: `t-${id}` },
    h(
      "header",
      { class: "t-head" },
      h("span", { class: "t-icon" }, icon(ic, 18)),
      h("span", { class: "t-head-text" }, h("h2", {}, title, items.length ? h("span", { class: "t-count" }, items.length) : null), hint ? h("span", { class: "t-hint" }, hint) : null),
      more ?? null,
    ),
    items.length ? h("ul", { class: "t-list" }, items.map(render)) : h("p", { class: "t-empty" }, icon("check", 16), empty),
  );
}

const dealTitle = (c) => c.applicant_name ?? c.contact_name ?? c.contact_phone ?? "Без имени";

function renderToday() {
  const main = document.getElementById("main");
  if (!main || state.view !== "today") return;
  const t = state.today;
  const first = state.me.full_name.split(/\s+/)[0];
  const dateStr = new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
  const head = h(
    "div",
    { class: "today-head" },
    h("div", { class: "today-hello" }, h("h1", {}, `${greeting()}, ${first}`), h("p", { class: "muted" }, `${dateStr[0].toUpperCase()}${dateStr.slice(1)} · вот что требует внимания`)),
    h(
      "div",
      { class: "segmented small", role: "tablist", "aria-label": "Чьи сделки" },
      h("button", { class: state.todayMine ? "" : "active", "aria-selected": String(!state.todayMine), onclick: () => ((state.todayMine = false), loadToday()) }, "Все"),
      h("button", { class: state.todayMine ? "active" : "", "aria-selected": String(state.todayMine), onclick: () => ((state.todayMine = true), loadToday()) }, "Мои"),
    ),
  );
  if (!t) {
    main.replaceChildren(h("div", { class: "page today" }, head, h("div", { class: "placeholder" }, "Загрузка…")));
    return;
  }
  const scrollTo = (id) => document.getElementById(`t-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const kpi = (id, n, label, ic, tone) =>
    h("button", { class: `kpi tone-${tone} ${n ? "" : "is-zero"}`, onclick: () => scrollTo(id) }, h("span", { class: "kpi-icon" }, icon(ic, 18)), h("span", { class: "kpi-num" }, n), h("span", { class: "kpi-label" }, label));
  const openChat = (contactId) => {
    switchView("chats");
    openContact(contactId);
  };

  const unanswered = todaySection({
    id: "chats",
    title: "Ответить клиентам",
    hint: "Сверху — кто ждёт дольше всех",
    icon: "chat",
    tone: "info",
    items: t.unanswered,
    empty: "Все сообщения прочитаны",
    render: (c) =>
      todayRow({
        lead: avatar(c.name ?? c.phone, c.contact_id),
        title: c.name ?? c.phone,
        sub: c.last_message_at ? `пишет ${fmtShort(c.last_message_at)} · ждёт ${daysSince(c.last_message_at) ? daysText(daysSince(c.last_message_at)) : "меньше суток"}` : c.phone,
        trail: h("span", { class: "badge" }, c.unread_count),
        onclick: () => openChat(c.contact_id),
      }),
  });

  const leads = todaySection({
    id: "leads",
    title: "Новые обращения",
    hint: "Возьмите в работу и запросите документы",
    icon: "inbox",
    tone: "primary",
    items: t.new_leads,
    empty: "Новых обращений нет",
    render: (c) =>
      todayRow({
        lead: avatar(dealTitle(c), c.contact_id ?? c.id),
        title: dealTitle(c),
        sub: [COUNTRY_LABEL[c.country] ?? "страна не выбрана", c.assigned_user_id ? userName(c.assigned_user_id) : "никто не взял", daysText(daysSince(c.status_changed_at))].join(" · "),
        onclick: () => openDeal(c),
        action: c.assigned_user_id ? null : h("button", { class: "small t-action", onclick: () => takeDeal(c) }, "Взять себе"),
      }),
  });

  const stale = todaySection({
    id: "stale",
    title: "Застряли",
    hint: `Больше ${t.stale_days} ${plural(t.stale_days, "дня", "дней", "дней")} на одном этапе — напомните клиенту или двиньте дальше`,
    icon: "clock",
    tone: "warn",
    items: t.stale,
    empty: "Застрявших сделок нет",
    render: (c) =>
      todayRow({
        lead: countryTag(c.country),
        title: dealTitle(c),
        sub: `${STATUS_LABEL[c.status]} · ${c.docs_count} ${plural(c.docs_count, "документ", "документа", "документов")}`,
        trail: h("span", { class: "pill warn" }, daysText(daysSince(c.status_changed_at))),
        onclick: () => openDeal(c),
      }),
  });

  const appts = todaySection({
    id: "appts",
    title: "Записи в визовый центр",
    hint: "Ближайшие 14 дней — напомните клиенту за день",
    icon: "calendar",
    tone: "ok",
    items: t.appointments,
    empty: "Записей на ближайшие две недели нет",
    render: (c) =>
      todayRow({
        lead: dayBlock(c.appointment_at),
        title: dealTitle(c),
        sub: `${COUNTRY_LABEL[c.country] ?? ""} · ${fmtTime(c.appointment_at)}${c.assigned_user_id ? ` · ${userName(c.assigned_user_id)}` : ""}`,
        trail: c.contact_id ? h("span", { class: "t-go" }, icon("chat", 16)) : null,
        onclick: () => openDeal(c),
      }),
  });

  const awaiting = todaySection({
    id: "decision",
    title: "Ждут решения посольства",
    hint: "Когда придёт ответ — переведите в «Готово» и отметьте итог",
    icon: "passport",
    tone: "teal",
    items: t.awaiting_decision,
    empty: "Поданных документов нет",
    render: (c) =>
      todayRow({
        lead: countryTag(c.country),
        title: dealTitle(c),
        sub: `подано ${daysText(daysSince(c.status_changed_at))} назад`.replace("сегодня назад", "сегодня"),
        onclick: () => openDeal(c),
      }),
  });

  const expiring = todaySection({
    id: "expiring",
    title: "Визы скоро истекут",
    hint: "Повод предложить новую поездку",
    icon: "spark",
    tone: "violet",
    items: t.visas_expiring,
    empty: "В ближайшие 60 дней виз не истекает",
    render: (c) =>
      todayRow({
        lead: countryTag(c.country),
        title: dealTitle(c),
        sub: `виза до ${fmtDay(c.visa_valid_to)}`,
        trail: c.contact_id ? h("span", { class: "t-go" }, icon("chat", 16)) : null,
        onclick: () => (c.contact_id ? openChat(c.contact_id) : openDeal(c)),
      }),
  });

  main.replaceChildren(
    h(
      "div",
      { class: "page today" },
      head,
      h(
        "div",
        { class: "kpis" },
        kpi("chats", t.unanswered.length, `${plural(t.unanswered.length, "клиент ждёт", "клиента ждут", "клиентов ждут")} ответа`, "chat", "info"),
        kpi("leads", t.new_leads.length, plural(t.new_leads.length, "новое обращение", "новых обращения", "новых обращений"), "inbox", "primary"),
        kpi("appts", t.appointments.length, `${plural(t.appointments.length, "запись", "записи", "записей")} на 2 недели`, "calendar", "ok"),
        kpi("stale", t.stale.length, `${plural(t.stale.length, "сделка застряла", "сделки застряли", "сделок застряли")}`, "clock", "warn"),
      ),
      h("div", { class: "today-grid" }, h("div", { class: "today-col" }, unanswered, leads, stale), h("div", { class: "today-col" }, appts, awaiting, expiring)),
    ),
  );
}

// ---------- Kanban ----------

async function loadBoard() {
  const cards = await guard(() => api.get("/api/board", { country: state.boardCountry, include_closed: false }));
  if (cards) {
    state.board = cards;
    renderBoard();
  }
}

const reloadBoard = debounce(loadBoard, 300);

function openDeal(c) {
  if (!c.contact_id) {
    if (c.applicant_id) linkContactDialog(c.applicant_id, c.applicant_name);
    return;
  }
  openClient(c.contact_id, c.id, state.view === "today" ? "today" : "board");
}

const PIPELINE = STATUSES.filter(([st]) => st !== "done" && st !== "cancelled");

function nextStage(status) {
  const order = STATUSES.map(([st]) => st).filter((st) => st !== "cancelled");
  const i = order.indexOf(status);
  return i >= 0 && i < order.length - 1 ? order[i + 1] : null;
}

async function moveDeal(card, status) {
  const body = { status };
  if (status === "booked" && !card.appointment_at) {
    const when = await askDateTime("Записан: дата визита");
    if (!when) return;
    body.appointment_at = when;
  }
  if (status === "done") {
    const outcome = await askOutcome();
    if (!outcome) return;
    body.outcome = outcome;
  }
  const ok = await guard(() => api.post(`/api/applications/${card.id}/status`, body));
  if (ok) {
    toast(`${card.applicant_name ?? card.contact_name ?? "Сделка"} → ${STATUS_LABEL[status]}`);
    loadBoard();
  }
}

function boardCards() {
  return state.board.filter((c) => !state.boardMine || c.assigned_user_id === state.me.id);
}

const STALE_DAYS = 5;
const daysSince = (iso) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)) : 0);

function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
const daysText = (n) => (n === 0 ? "сегодня" : `${n} ${plural(n, "день", "дня", "дней")}`);

function countryTag(code) {
  return code ? h("span", { class: "cc", title: COUNTRY_LABEL[code] ?? code }, code) : h("span", { class: "cc cc-none" }, "—");
}

function dealCard(c, { mobile = false } = {}) {
  const next = nextStage(c.status);
  const age = daysSince(c.status_changed_at ?? c.updated_at);
  const stale = ["docs_collecting", "docs_ready", "account_ready", "booking"].includes(c.status) && age >= STALE_DAYS;
  const title = c.applicant_name ?? c.contact_name ?? c.contact_phone;
  const sub = c.applicant_name ? (c.contact_name ?? c.contact_phone) : c.contact_name ? c.contact_phone : null;
  return h(
    "article",
    {
      class: `deal-card status-${c.status} ${stale ? "is-stale" : ""}`,
      draggable: mobile ? null : "true",
      ondragstart: mobile ? null : (e) => e.dataTransfer.setData("text/plain", String(c.id)),
    },
    h(
      "button",
      { class: "deal-open", onclick: () => openDeal(c), "aria-label": `${title}, ${COUNTRY_LABEL[c.country] ?? "страна не выбрана"}` },
      h(
        "span",
        { class: "deal-top" },
        countryTag(c.country),
        h("span", { class: "deal-country" }, COUNTRY_LABEL[c.country] ?? "Страна не выбрана"),
        h("span", { class: `deal-age ${stale ? "warn" : ""}`, title: "Сколько сделка на этом этапе" }, icon("clock", 13), daysText(age)),
      ),
      h("span", { class: "deal-name" }, title),
      sub ? h("span", { class: "deal-sub" }, sub) : null,
      c.contact_id ? null : h("span", { class: "deal-sub warn-text" }, "Нет телефона — привязать к клиенту"),
      h(
        "span",
        { class: "deal-meta" },
        c.appointment_at ? h("span", { class: "meta-chip ok", title: "Запись в визовый центр" }, icon("calendar", 13), fmtDate(c.appointment_at)) : null,
        h("span", { class: `meta-chip ${c.docs_count ? "" : "dim"}`, title: "Документов в папке" }, icon("file", 13), c.docs_count ?? 0),
        c.unread_count ? h("span", { class: "meta-chip info", title: "Непрочитанные сообщения" }, icon("chat", 13), c.unread_count) : null,
        c.locked_by_user_id ? h("span", { class: "meta-chip warn", title: `Сейчас на портале: ${userName(c.locked_by_user_id)}` }, icon("lock", 13)) : null,
        h("span", { class: "spacer" }),
        c.assigned_user_id
          ? h("span", { class: "deal-owner", title: `Менеджер: ${userName(c.assigned_user_id)}` }, avatar(userName(c.assigned_user_id), c.assigned_user_id, "xs"))
          : h("span", { class: "deal-free" }, "свободна"),
      ),
    ),
    mobile && next
      ? h("button", { class: "deal-next", onclick: () => moveDeal(c, next) }, `Дальше: ${STATUS_LABEL[next]}`, icon("arrow", 16))
      : null,
  );
}

function boardFilters() {
  return h(
    "div",
    { class: "board-filters" },
    h(
      "div",
      { class: "segmented small" },
      h("button", { class: state.boardMine ? "" : "active", onclick: () => ((state.boardMine = false), renderBoard()) }, "Все сделки"),
      h("button", { class: state.boardMine ? "active" : "", onclick: () => ((state.boardMine = true), renderBoard()) }, "Мои"),
    ),
    select([["", "Все страны"], ...COUNTRIES], state.boardCountry, {
      class: "compact-select",
      "aria-label": "Страна",
      onchange: (e) => {
        state.boardCountry = e.target.value;
        loadBoard();
      },
    }),
  );
}

function renderBoard() {
  const main = document.getElementById("main");
  if (!main || state.view !== "board") return;
  const cards = boardCards();
  const head = h("div", { class: "page-head row-head" }, h("h1", {}, "Сделки"), h("span", { class: "muted" }, `${cards.length} в работе`), h("div", { class: "spacer" }), boardFilters());

  if (isNarrow()) {
    // Телефон: вкладки этапов + список; без горизонтальной прокрутки колонок и перетаскивания.
    const counts = Object.fromEntries(PIPELINE.map(([st]) => [st, cards.filter((c) => c.status === st).length]));
    if (!state.boardStage || !counts[state.boardStage]) state.boardStage = PIPELINE.find(([st]) => counts[st])?.[0] ?? PIPELINE[0][0];
    const list = cards.filter((c) => c.status === state.boardStage);
    main.replaceChildren(
      h(
        "div",
        { class: "page board-mobile" },
        head,
        h(
          "div",
          { class: "stage-tabs", role: "tablist" },
          PIPELINE.map(([st, label]) =>
            h(
              "button",
              {
                class: `stage-tab status-${st} ${state.boardStage === st ? "active" : ""}`,
                role: "tab",
                "aria-selected": String(state.boardStage === st),
                onclick: () => {
                  state.boardStage = st;
                  renderBoard();
                },
              },
              label,
              h("span", { class: "stage-count" }, counts[st]),
            ),
          ),
        ),
        list.length ? h("div", { class: "deal-list" }, list.map((c) => dealCard(c, { mobile: true }))) : h("div", { class: "empty-state" }, "На этом этапе сделок нет"),
      ),
    );
    requestAnimationFrame(() => document.querySelector(".stage-tab.active")?.scrollIntoView({ block: "nearest", inline: "center" }));
    return;
  }

  const board = h(
    "div",
    { class: "board" },
    PIPELINE.map(([status, label]) => {
      const colCards = cards.filter((c) => c.status === status);
      const col = h(
        "section",
        {
          class: `board-col status-${status}`,
          ondragover: (e) => {
            e.preventDefault();
            col.classList.add("drop");
          },
          ondragleave: () => col.classList.remove("drop"),
          ondrop: (e) => {
            e.preventDefault();
            col.classList.remove("drop");
            const card = state.board.find((c) => c.id === Number(e.dataTransfer.getData("text/plain")));
            if (card && card.status !== status) moveDeal(card, status);
          },
        },
        h("header", { class: "board-col-head" }, h("span", { class: "status-dot" }), h("span", { class: "col-title" }, label), h("span", { class: "count" }, colCards.length)),
        h("div", { class: "board-cards" }, colCards.length ? colCards.map((c) => dealCard(c)) : h("p", { class: "board-empty" }, "Перетащите сюда сделку")),
      );
      return col;
    }),
  );
  main.replaceChildren(h("div", { class: "page page-wide" }, head), board);
}

// Перерисовка при переходе через брейкпоинт телефона (поворот экрана, изменение окна).
window.matchMedia("(max-width: 760px)").addEventListener("change", () => {
  if (state.view === "board") renderBoard();
});

function linkContactDialog(applicantId, name) {
  const phone = h("input", { id: "link-phone", type: "tel", placeholder: "+7 701 123 45 67" });
  openModal(`Привязать телефон: ${name ?? ""}`, h("div", { class: "form" }, h("label", { class: "field" }, "Телефон клиента", phone), h("p", { class: "muted small" }, "Если контакта с таким номером нет, он будет создан.")), [
    (close) =>
      h(
        "button",
        {
          class: "primary",
          onclick: async () => {
            const res = await guard(() => api.post(`/api/applicants/${applicantId}/link-contact`, { phone: phone.value }));
            if (res) {
              close();
              openClient(res.contact_id, null, "board");
            }
          },
        },
        "Привязать",
      ),
  ]);
}

// ---------- клиенты ----------

async function loadClients() {
  const items = await guard(() => api.get("/api/clients", { q: state.clientsQuery, country: state.clientsCountry, limit: 200 }));
  if (!items || state.view !== "clients") return;
  state.clients = items;
  renderClients();
}

const reloadClientsList = debounce(loadClients, 300);

function statusChip(app) {
  return h(
    "span",
    { class: `deal-chip status-${app.status} ${app.decision ? `outcome-${app.decision}` : ""}`, title: app.decision ? DECISION_LABEL[app.decision] : STATUS_LABEL[app.status] },
    h("span", { class: "status-dot" }),
    `${app.country ? COUNTRY_LABEL[app.country] ?? app.country : "Без страны"} · ${app.decision ? DECISION_SHORT[app.decision] : STATUS_LABEL[app.status]}`,
  );
}

function renderClients() {
  const main = document.getElementById("main");
  if (!main || state.view !== "clients") return;
  const search = h("input", {
    type: "search",
    id: "clients-search",
    placeholder: "Имя, телефон, ФИО латиницей, № паспорта",
    value: state.clientsQuery,
    oninput: (e) => {
      state.clientsQuery = e.target.value;
      reloadClientsList();
    },
  });
  const countries = [["", "Все страны"], ...COUNTRIES.slice(0, 8)];
  main.replaceChildren(
    h(
      "div",
      { class: "page" },
      h("div", { class: "page-head row-head" }, h("h1", {}, "Клиенты"), h("span", { class: "muted" }, `${state.clients.length}`), h("div", { class: "spacer" }), h("button", { class: "primary", onclick: newContactDialog }, icon("plus", 16), "Клиент")),
      h("div", { class: "search page-search" }, icon("search", 16), search),
      h(
        "div",
        { class: "chips" },
        countries.map(([code, label]) =>
          h(
            "button",
            {
              class: `chip ${state.clientsCountry === code ? "active" : ""}`,
              onclick: () => {
                state.clientsCountry = code;
                renderClients();
                loadClients();
              },
            },
            label,
          ),
        ),
      ),
      state.clients.length
        ? h(
            "div",
            { class: "table-card" },
            h("div", { class: "table-head client-cols" }, h("span", {}, "Клиент"), h("span", {}, "Сделки"), h("span", {}, "Менеджер"), h("span", {}, "Последнее сообщение")),
            h(
              "ul",
              { class: "client-list" },
              state.clients.map((c) => {
                const owners = [...new Set(c.applications.map((a) => a.assigned_user_id).filter(Boolean))].map(userName);
                return h(
                  "li",
                  {},
                  h(
                    "button",
                    { class: "client-row client-cols", onclick: () => openClient(c.id, null, "clients") },
                    h(
                      "span",
                      { class: "client-main" },
                      avatar(c.name || c.phone, c.id),
                      h("span", { class: "client-text" }, h("span", { class: "client-name" }, c.name || c.phone, c.unread_count ? h("span", { class: "badge" }, c.unread_count) : null), h("span", { class: "client-sub" }, [c.phone, c.applicants.join(", ")].filter(Boolean).join(" · "))),
                    ),
                    h(
                      "span",
                      { class: "client-deals" },
                      c.applications.length ? c.applications.slice(0, 3).map(statusChip) : h("span", { class: "muted small" }, "Нет сделок"),
                      c.applications.length > 3 ? h("span", { class: "muted small" }, `ещё ${c.applications.length - 3}`) : null,
                    ),
                    h("span", { class: "client-owner muted" }, owners.join(", ") || "—"),
                    h("span", { class: "client-last muted" }, c.last_message_at ? fmtShort(c.last_message_at) : "—"),
                  ),
                );
              }),
            ),
          )
        : h("div", { class: "placeholder" }, state.clientsQuery || state.clientsCountry ? "Никого не нашли" : "Клиентов пока нет"),
    ),
  );
  const el = document.getElementById("clients-search");
  if (state.clientsQuery && el) {
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }
}

async function openClient(contactId, focusAppId = null, back = state.view) {
  state.clientId = contactId;
  state.clientFocus = focusAppId;
  state.clientTab = "deals";
  state.clientBack = back === "client" ? state.clientBack : back;
  state.client = null;
  state.view = "client";
  renderShell();
  await loadClient();
}

async function loadClient() {
  const id = state.clientId;
  const [folder, history] = await Promise.all([
    guard(() => api.get(`/api/contacts/${id}/folder`)),
    guard(() => api.get(`/api/clients/${id}/history`)),
  ]);
  if (!folder || id !== state.clientId || state.view !== "client") return;
  state.client = { folder, history: history ?? [] };
  renderClient();
}

const reloadClient = debounce(loadClient, 250);

function allApplications(folder) {
  return [...folder.applicants.flatMap((a) => a.applications), ...folder.unassigned_applications];
}

async function revealPassport(applicantId) {
  const res = await guard(() => api.post(`/api/applicants/${applicantId}/passport/reveal`));
  if (!res) return;
  state.revealedPassports.set(applicantId, res);
  renderClient();
  setTimeout(() => {
    state.revealedPassports.delete(applicantId);
    if (state.view === "client") renderClient();
  }, 30000);
}

function editClientName(contact) {
  const name = h("input", { id: "client-name", value: contact.name ?? "", placeholder: "Имя клиента" });
  openModal("Имя клиента", h("div", { class: "form" }, h("label", { class: "field" }, "Как обращаться", name), h("p", { class: "muted small" }, "Телефон меняется только вместе с WhatsApp-контактом, поэтому здесь не редактируется.")), [
    (close) =>
      h(
        "button",
        {
          class: "primary",
          onclick: async () => {
            const ok = await guard(() => api.patch(`/api/contacts/${contact.id}`, { name: name.value.trim() || null }));
            if (ok) {
              close();
              loadClient();
              reloadContacts();
            }
          },
        },
        "Сохранить",
      ),
  ]);
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    toast("Не удалось скопировать — выделите текст вручную", "error");
  }
}

function renderAccountsBlock(apps) {
  // Одна учётка может обслуживать несколько заявок (стран) — группируем.
  const byAccount = new Map();
  const without = [];
  for (const app of apps) {
    if (app.portal_account) {
      const entry = byAccount.get(app.portal_account.id) ?? { acc: app.portal_account, apps: [] };
      entry.apps.push(app);
      byAccount.set(app.portal_account.id, entry);
    } else if (app.status !== "cancelled") {
      without.push(app);
    }
  }
  const rows = [...byAccount.values()].map(({ acc, apps: linked }) => {
    const revealed = state.revealed.get(acc.id);
    const pwd = h("code", { class: `secret ${revealed ? "shown" : ""}` }, revealed ?? "••••••••••");
    return h(
      "div",
      { class: `cred ${acc.needs_rotation ? "needs" : ""}` },
      h(
        "div",
        { class: "cred-head" },
        h("span", { class: `portal-badge portal-${acc.portal}` }, PORTAL_LABEL[acc.portal]),
        h("span", { class: "cred-countries" }, [...new Set(linked.map((a) => COUNTRY_LABEL[a.country] ?? "без страны"))].join(", ")),
      ),
      h(
        "div",
        { class: "cred-line" },
        h("span", { class: "cred-label" }, "Логин"),
        h("code", { class: "cred-value" }, acc.login),
        iconButton("copy", "Скопировать логин", () => copyText(acc.login, "Логин скопирован"), "sm"),
      ),
      h(
        "div",
        { class: "cred-line" },
        h("span", { class: "cred-label" }, "Пароль"),
        pwd,
        iconButton("eye", "Показать пароль (запишется в журнал)", () => revealPassword(acc.id, "show", pwd), "sm"),
        iconButton("copy", "Скопировать пароль (запишется в журнал)", () => revealPassword(acc.id, "copy"), "sm"),
      ),
      acc.needs_rotation ? h("div", { class: "warn-line" }, icon("alert", 14), `Сменить пароль: ${acc.rotation_reason}`) : null,
    );
  });
  const missing = without.map((app) =>
    h(
      "div",
      { class: "cred cred-missing" },
      h("span", {}, `${COUNTRY_LABEL[app.country] ?? "Без страны"}${app.portal ? ` · ${PORTAL_LABEL[app.portal]}` : ""}`),
      h("button", { class: "ghost small", onclick: () => accountDialog(app) }, icon("plus", 14), "Учётка"),
    ),
  );
  return rows.length || missing.length ? [...rows, ...missing] : [h("p", { class: "muted small" }, "Учёток порталов пока нет")];
}

const HISTORY_ICON = { outcome: "check", status: "board", application: "plus", portal: "external", document: "file", applicant: "user", secret: "eye", account: "key", contact: "chat" };

function renderHistory(events, apps) {
  if (!events.length) return h("p", { class: "muted small" }, "Событий пока нет");
  const countryOf = new Map(apps.map((a) => [a.id, COUNTRY_LABEL[a.country] ?? null]));
  return h(
    "ol",
    { class: "timeline" },
    events.map((e) =>
      h(
        "li",
        { class: `tl-item tl-${e.kind}` },
        h("span", { class: "tl-icon" }, icon(HISTORY_ICON[e.kind] ?? "history", 14)),
        h(
          "div",
          { class: "tl-body" },
          h("div", { class: "tl-title" }, e.title, e.application_id && countryOf.get(e.application_id) ? h("span", { class: "tl-tag" }, countryOf.get(e.application_id)) : null),
          h("div", { class: "tl-meta" }, [fmtDate(e.at), e.user_id ? userName(e.user_id) : null].filter(Boolean).join(" · ")),
        ),
      ),
    ),
  );
}

function renderClient() {
  const main = document.getElementById("main");
  if (!main || state.view !== "client") return;
  if (!state.client) {
    main.replaceChildren(h("div", { class: "placeholder" }, "Загрузка карточки…"));
    return;
  }
  const { folder, history } = state.client;
  const contact = folder.contact;
  // Сделка, открытая из Kanban, — первой в списке, чтобы не листать к ней мимо шапки клиента.
  const apps = allApplications(folder).sort((a, b) => (b.id === state.clientFocus) - (a.id === state.clientFocus));
  const active = apps.filter((a) => !["done", "cancelled"].includes(a.status));
  const nextAppt = apps.filter((a) => a.appointment_at && new Date(a.appointment_at) > new Date()).sort((a, b) => a.appointment_at.localeCompare(b.appointment_at))[0];
  const backLabel = { today: "Сегодня", board: "Сделки", chats: "Диалоги", clients: "Клиенты" }[state.clientBack] ?? "Назад";
  const goChat = () => {
    state.view = "chats";
    renderShell();
    loadContacts().then(() => openContact(contact.id));
  };

  const header = h(
    "div",
    { class: "client-hero" },
    h("button", { class: "ghost small back-link", onclick: () => switchView(state.clientBack) }, icon("back", 16), backLabel),
    h(
      "div",
      { class: "client-id" },
      avatar(contact.name || contact.phone, contact.id, "lg"),
      h(
        "div",
        { class: "client-id-text" },
        h("h1", {}, contact.name || contact.phone, h("button", { class: "icon-btn sm inline-edit", title: "Изменить имя", "aria-label": "Изменить имя", onclick: () => editClientName(contact) }, icon("edit", 16))),
        h(
          "div",
          { class: "client-phone" },
          icon("phone", 14),
          h("span", { class: "mono" }, contact.phone),
          iconButton("copy", "Скопировать телефон", () => copyText(contact.phone, "Телефон скопирован"), "sm"),
        ),
      ),
    ),
    h(
      "div",
      { class: "client-actions" },
      h("button", { class: "primary", onclick: goChat }, icon("chat", 16), "Открыть чат"),
      h("button", { onclick: () => newApplication(contact.id, folder.applicants[0]?.id ?? null) }, icon("plus", 16), "Сделка"),
      h("button", { onclick: () => applicantDialog(undefined, contact.id) }, icon("plus", 16), "Заявитель"),
    ),
  );

  const managers = [...new Set(apps.map((a) => a.assigned_user_id).filter(Boolean))].map(userName);
  const infoSection = h(
    "section",
    { class: "panel", "data-tab": "info" },
    h("h2", { class: "panel-title" }, "О клиенте"),
    h(
      "dl",
      { class: "info-list" },
      h("div", {}, h("dt", {}, "Телефон"), h("dd", {}, contact.phone)),
      h("div", {}, h("dt", {}, "Менеджер"), h("dd", {}, managers.join(", ") || "Не назначен")),
      h("div", {}, h("dt", {}, "Сделки"), h("dd", {}, `${apps.length}${active.length !== apps.length ? `, в работе ${active.length}` : ""}`)),
      h("div", {}, h("dt", {}, "Страны"), h("dd", {}, [...new Set(apps.map((a) => COUNTRY_LABEL[a.country]).filter(Boolean))].join(", ") || "—")),
      h("div", {}, h("dt", {}, "Ближайшая запись"), h("dd", {}, nextAppt ? `${fmtDate(nextAppt.appointment_at)}, ${COUNTRY_LABEL[nextAppt.country] ?? ""}` : "—")),
      h("div", {}, h("dt", {}, "Клиент с"), h("dd", {}, fmtDate(contact.created_at, false))),
    ),
  );

  const applicantsSection = h(
    "section",
    { class: "panel", "data-tab": "info" },
    h("h2", { class: "panel-title" }, "Заявители"),
    folder.applicants.length
      ? folder.applicants.map((a) => {
          const pass = state.revealedPassports.get(a.id);
          return h(
            "div",
            { class: "person" },
            h(
              "div",
              { class: "person-head" },
              avatar(`${a.first_name} ${a.last_name}`, a.id, "sm"),
              h("div", { class: "applicant-title" }, h("strong", {}, `${a.last_name} ${a.first_name}`), h("span", { class: "muted small" }, a.citizenship ? `Гражданство: ${a.citizenship}` : "Гражданство не указано")),
              h("button", { class: "ghost small", onclick: () => applicantDialog(a, contact.id) }, "Изменить"),
            ),
            h(
              "dl",
              { class: "facts" },
              h("div", {}, h("dt", {}, "Паспорт"), h("dd", { class: "mono" }, pass ? pass.passport_number : a.passport_number_masked ?? "не заполнен")),
              pass ? h("div", {}, h("dt", {}, "Действителен до"), h("dd", {}, pass.passport_expires_on ? fmtDate(pass.passport_expires_on, false) : "—")) : null,
              pass ? h("div", {}, h("dt", {}, "Дата рождения"), h("dd", {}, pass.birth_date ? fmtDate(pass.birth_date, false) : "—")) : null,
            ),
            a.has_passport && !pass ? h("button", { class: "ghost small", onclick: () => revealPassport(a.id) }, icon("eye", 14), "Показать паспортные данные") : null,
            a.documents.length ? renderDocs(a.documents) : null,
          );
        })
      : h("p", { class: "muted small" }, "Заявителей пока нет. Добавьте их здесь или из чата кнопкой «В папку»."),
  );

  const isClosed = (a) => a.status === "done" || a.status === "cancelled";
  const activeApps = apps.filter((a) => !isClosed(a));
  const pastApps = apps.filter(isClosed).sort((a, b) => (b.decision_on ?? b.updated_at).localeCompare(a.decision_on ?? a.updated_at));
  const applicantName = (a) => folder.applicants.find((x) => x.id === a.applicant_id);
  const dealTitle = (a) =>
    [COUNTRY_LABEL[a.country] ?? "Без страны", folder.applicants.length > 1 ? applicantName(a)?.last_name : null].filter(Boolean).join(" · ");
  const year = (a) => new Date(a.decision_on ? `${a.decision_on}T00:00:00` : a.created_at).getFullYear();

  const dealsSection = h(
    "section",
    { class: "panel deals", "data-tab": "deals" },
    h("h2", { class: "panel-title" }, `В работе (${activeApps.length})`),
    activeApps.length > 1
      ? h(
          "div",
          { class: "deal-tabs chips" },
          activeApps.map((a) =>
            h(
              "button",
              {
                class: `deal-chip status-${a.status} ${state.clientFocus === a.id ? "focused" : ""}`,
                onclick: () => {
                  state.clientFocus = a.id;
                  document.getElementById(`deal-${a.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                },
              },
              h("span", { class: "status-dot" }),
              `${dealTitle(a)} · ${STATUS_LABEL[a.status]}`,
            ),
          ),
        )
      : null,
    activeApps.length
      ? activeApps.map((a) => h("div", { id: `deal-${a.id}`, class: `deal-wrap ${state.clientFocus === a.id ? "focus" : ""}` }, renderApplication(a, folder.applicants)))
      : h("p", { class: "muted small" }, "Сейчас сделок в работе нет. Новая поездка — кнопка «Сделка»."),
    h("h2", { class: "panel-title past-title" }, `Прошлые поездки (${pastApps.length})`),
    pastApps.length
      ? h(
          "div",
          { class: "past-list" },
          pastApps.map((a) =>
            h(
              "details",
              { class: `past-deal outcome-${a.decision ?? "none"}`, id: `deal-${a.id}`, open: state.clientFocus === a.id ? "" : null },
              h(
                "summary",
                {},
                h("span", { class: "past-main" }, h("strong", {}, `${dealTitle(a)}, ${year(a)}`), h("span", { class: "muted small" }, [PORTAL_LABEL[a.portal], `${a.documents.length} док.`].filter(Boolean).join(" · "))),
                h("span", { class: `outcome-badge outcome-${a.decision ?? "none"}` }, a.decision ? DECISION_SHORT[a.decision] : STATUS_LABEL[a.status]),
              ),
              h("div", { class: "past-body" }, renderApplication(a, folder.applicants)),
            ),
          ),
        )
      : h("p", { class: "muted small" }, "Завершённых поездок пока нет. Когда сделка дойдёт до «Готово», здесь останутся её итог и документы."),
  );

  // Папка клиента: все документы, сгруппированные по заявителю; у каждого видно, к какой поездке он относится.
  const appLabel = (id) => {
    const a = apps.find((x) => x.id === id);
    return a ? `${COUNTRY_LABEL[a.country] ?? "Без страны"} ${year(a)}` : null;
  };
  const folderGroups = folder.applicants.map((ap) => ({
    title: `${ap.last_name} ${ap.first_name}`,
    docs: [...ap.documents.map((d) => ({ ...d, where: "Личные документы" })), ...ap.applications.flatMap((a) => a.documents.map((d) => ({ ...d, where: appLabel(a.id) })))],
  }));
  const loose = folder.unassigned_applications.flatMap((a) => a.documents.map((d) => ({ ...d, where: appLabel(a.id) })));
  if (loose.length) folderGroups.push({ title: "Без заявителя", docs: loose });
  const folderSection = h(
    "section",
    { class: "panel", "data-tab": "folder" },
    h("h2", { class: "panel-title" }, "Папка клиента"),
    folderGroups.some((g) => g.docs.length)
      ? folderGroups.map((g) =>
          h(
            "div",
            { class: "folder-group" },
            h("div", { class: "folder-group-title" }, g.title, h("span", { class: "muted small" }, ` · ${g.docs.length} док.`)),
            g.docs.length
              ? h(
                  "ul",
                  { class: "docs folder-docs" },
                  g.docs
                    .sort((a, b) => b.created_at.localeCompare(a.created_at))
                    .map((d) =>
                      h(
                        "li",
                        {},
                        h(
                          "button",
                          { class: "doc-open", onclick: () => previewFile(d.file_id, d.mime, d.original_name) },
                          fileBadge(d.mime, d.original_name, "md"),
                          h("span", { class: "doc-text" }, h("span", { class: "doc-name" }, d.original_name), h("span", { class: "doc-where" }, [d.where, fmtDate(d.created_at, false)].filter(Boolean).join(" · "))),
                          h("span", { class: `tag tag-${d.doc_type}` }, DOC_LABEL[d.doc_type]),
                        ),
                      ),
                    ),
                )
              : h("p", { class: "muted small" }, "Документов нет"),
          ),
        )
      : h("p", { class: "muted small" }, "Документов пока нет. Прикрепите их из чата кнопкой «В папку»."),
  );

  const credsSection = h("section", { class: "panel", "data-tab": "passwords" }, h("h2", { class: "panel-title" }, "Логины и пароли порталов"), h("p", { class: "muted small" }, "Каждый просмотр пароля записывается в журнал."), renderAccountsBlock(apps));
  const historySection = h("section", { class: "panel", "data-tab": "history" }, h("h2", { class: "panel-title" }, "История"), renderHistory(history, apps));

  const tabs = [
    ["deals", `Сделки ${apps.length}`],
    ["folder", "Папка"],
    ["info", "Данные"],
    ["passwords", "Пароли"],
    ["history", "История"],
  ];
  main.replaceChildren(
    h(
      "div",
      { class: "page client-page", "data-active-tab": state.clientTab },
      header,
      h(
        "nav",
        { class: "client-tabs segmented" },
        tabs.map(([t, label]) =>
          h(
            "button",
            {
              class: state.clientTab === t ? "active" : "",
              onclick: () => {
                state.clientTab = t;
                renderClient();
              },
            },
            label,
          ),
        ),
      ),
      h(
        "div",
        { class: "client-grid" },
        h("div", { class: "client-col" }, dealsSection, historySection),
        h("div", { class: "client-col" }, folderSection, infoSection, credsSection, applicantsSection),
      ),
      h("div", { class: "mobile-actions" }, h("button", { class: "primary block", onclick: goChat }, icon("chat", 18), "Написать в WhatsApp")),
    ),
  );

}

// ---------- канал WhatsApp (QR) ----------

const CHANNEL_STATE = {
  open: ["ok", "Подключён"],
  connecting: ["warn", "Ожидает сканирования QR"],
  close: ["bad", "Отключён"],
  refused: ["bad", "Отключён WhatsApp"],
  unknown: ["bad", "Ещё не подключали"],
};

function channelDown() {
  return state.channel && state.channel.provider === "evolution" && state.channel.state !== "open";
}

async function loadChannel() {
  const ch = await guard(() => api.get("/api/channel"));
  if (!ch) return;
  const changed = !state.channel || state.channel.state !== ch.state;
  state.channel = ch;
  if (ch.state === "open") state.channelQr = null;
  if (changed && state.me) renderBanners();
  renderChannel();
}

function stopChannelPolling() {
  clearInterval(state.channelTimer);
  state.channelTimer = null;
}

async function connectChannel() {
  const res = await guard(() => api.post("/api/channel/connect"));
  if (!res) return;
  state.channel = { ...state.channel, ...res };
  state.channelQr = res.qr_base64 ?? null;
  renderChannel();
  stopChannelPolling();
  if (res.state !== "open") {
    // QR живёт ~20–40 секунд: проверяем статус и обновляем код, пока номер не подключён.
    let ticks = 0;
    state.channelTimer = setInterval(async () => {
      ticks += 1;
      if (state.view !== "settings" || state.settingsTab !== "whatsapp") return stopChannelPolling();
      await loadChannel();
      if (state.channel?.state === "open") {
        stopChannelPolling();
        toast("WhatsApp подключён");
        renderBanners();
        renderChannel();
        return;
      }
      if (ticks % 6 === 0) {
        const again = await guard(() => api.post("/api/channel/connect"));
        if (again?.qr_base64) {
          state.channelQr = again.qr_base64;
          renderChannel();
        }
      }
      if (ticks > 60) stopChannelPolling();
    }, 5000);
  }
}

function renderChannel() {
  const main = document.getElementById("settings-body");
  if (!main || state.view !== "settings" || state.settingsTab !== "whatsapp") return;
  const ch = state.channel ?? { provider: "evolution", state: "unknown" };
  if (ch.provider !== "evolution") {
    main.replaceChildren(h("div", { class: "page" }, h("h1", {}, "WhatsApp"), h("p", { class: "muted" }, "Канал подключён через Wazzup — QR не нужен.")));
    return;
  }
  const [tone, label] = CHANNEL_STATE[ch.state] ?? CHANNEL_STATE.unknown;
  const qrBlock = state.channelQr
    ? h(
        "div",
        { class: "qr-box" },
        h("img", { src: state.channelQr, alt: "QR-код для подключения WhatsApp", class: "qr-img" }),
        h(
          "ol",
          { class: "qr-steps" },
          h("li", {}, "Откройте WhatsApp на телефоне с рабочим номером"),
          h("li", {}, "Настройки → Связанные устройства → Привязка устройства"),
          h("li", {}, "Наведите камеру на код. Код обновляется сам, страница сама поймёт, что номер подключён"),
        ),
      )
    : null;
  main.replaceChildren(
    h(
      "div",
      { class: "page channel-page" },
      h("div", { class: "page-head" }, h("h1", {}, "WhatsApp"), h("p", { class: "muted" }, "Рабочий номер подключается к CRM как «Связанное устройство», телефон продолжает работать как обычно.")),
      h(
        "section",
        { class: "panel" },
        h(
          "div",
          { class: "channel-status" },
          h("span", { class: `state-dot ${tone}` }),
          h("div", { class: "applicant-title" }, h("strong", {}, label), h("span", { class: "muted small" }, [ch.phone ? `+${ch.phone}` : null, ch.updated_at ? `обновлено ${fmtDate(ch.updated_at)}` : null].filter(Boolean).join(" · ") || "—")),
          h("div", { class: "spacer" }),
          iconButton("refresh", "Проверить состояние", async () => {
            const r = await guard(() => api.post("/api/channel/refresh"));
            if (r) {
              state.channel = r;
              renderBanners();
              renderChannel();
            }
          }),
        ),
        ch.state === "open"
          ? h(
              "div",
              { class: "row" },
              h(
                "button",
                {
                  class: "ghost",
                  onclick: async () => {
                    if (!(await confirmDialog("Отключить WhatsApp", "CRM перестанет получать и отправлять сообщения, пока номер не подключат заново по QR. На телефоне WhatsApp продолжит работать.", "Отключить"))) return;
                    const r = await guard(() => api.post("/api/channel/logout"));
                    if (r) {
                      state.channel = r;
                      renderBanners();
                      renderChannel();
                    }
                  },
                },
                "Отключить",
              ),
            )
          : h("button", { class: "primary", onclick: connectChannel }, icon("qr", 16), state.channelQr ? "Обновить QR-код" : "Подключить по QR-коду"),
        qrBlock,
      ),
      h(
        "section",
        { class: "panel" },
        h("h2", { class: "panel-title" }, icon("alert", 16), "Как CRM бережёт номер от блокировки"),
        h(
          "ul",
          { class: "plain-list" },
          h("li", {}, "Не больше 12 исходящих сообщений в минуту на весь номер, без пачек."),
          h("li", {}, "Перед каждым сообщением 2–8 секунд «печатает…», как живой человек."),
          h("li", {}, "Никаких рассылок: CRM отвечает только тем, кто написал сам."),
          h("li", {}, "Телефон с номером держите в сети и на зарядке: если он долго офлайн, WhatsApp отвяжет CRM."),
        ),
        h("p", { class: "muted small" }, "Подключение по QR — неофициальный способ, WhatsApp его не разрешает. Риск блокировки снижается, но не исчезает."),
      ),
    ),
  );
}

// ---------- учётки (админ) ----------

async function loadAccounts() {
  const items = await guard(() => api.get("/api/portal-accounts", { limit: 500 }));
  if (!items || state.settingsTab !== "accounts") return;
  state.accounts = items;
  renderAccounts();
}

function renderAccounts() {
  const main = document.getElementById("settings-body");
  if (!main || state.view !== "settings" || state.settingsTab !== "accounts") return;
  const items = state.accounts ?? [];
  const rotate = items.filter((a) => a.needs_rotation);
  const q = state.accountsQuery.trim().toLowerCase();
  const shown = items.filter((a) => (state.accountsFilter === "all" || a.needs_rotation) && (!q || a.login.includes(q)));
  const filterChip = (key, label, count) =>
    h(
      "button",
      {
        class: `chip ${state.accountsFilter === key ? "active" : ""}`,
        onclick: () => {
          state.accountsFilter = key;
          renderAccounts();
        },
      },
      label,
      h("span", { class: "chip-count" }, count),
    );
  const search = h("input", {
    type: "search",
    id: "accounts-search",
    placeholder: "Поиск по email",
    value: state.accountsQuery,
    oninput: (e) => {
      state.accountsQuery = e.target.value;
      const pos = e.target.selectionStart;
      renderAccounts();
      const el = document.getElementById("accounts-search");
      el?.focus();
      el?.setSelectionRange(pos, pos);
    },
  });
  main.replaceChildren(
    h(
      "div",
      { class: "page" },
      h("div", { class: "page-head" }, h("h1", {}, "Учётки порталов"), h("p", { class: "muted" }, "Пароли хранятся зашифрованными; каждый просмотр пишется в журнал аудита.")),
      rotate.length
        ? h("div", { class: "notice warn" }, icon("alert", 18), h("span", {}, `Нужно сменить пароль у ${rotate.length} ${rotate.length === 1 ? "учётки" : "учёток"}: слабые или общие пароли.`))
        : null,
      h("div", { class: "toolbar" }, h("div", { class: "chips" }, filterChip("all", "Все", items.length), filterChip("rotate", "На смену", rotate.length)), h("div", { class: "search" }, icon("search", 16), search)),
      shown.length
        ? h(
            "div",
            { class: "acc-grid" },
            shown.map((a) =>
              h(
                "article",
                { class: `acc-card ${a.needs_rotation ? "needs" : ""}` },
                h("div", { class: "acc-top" }, h("span", { class: `portal-badge portal-${a.portal}` }, PORTAL_LABEL[a.portal]), a.needs_rotation ? h("span", { class: "pill warn" }, "Сменить") : h("span", { class: "pill ok" }, icon("check", 12), "ОК")),
                h("code", { class: "acc-login" }, a.login),
                a.needs_rotation ? h("p", { class: "warn-text small" }, a.rotation_reason) : null,
                h("p", { class: "muted small" }, a.last_used_at ? `Использована ${fmtDate(a.last_used_at)}` : "Ещё не использовалась"),
                h(
                  "button",
                  {
                    class: a.needs_rotation ? "primary small" : "ghost small",
                    onclick: async () => {
                      if (!(await confirmDialog("Новый пароль", "Сгенерировать новый пароль? Его нужно будет сменить и на самом портале.", "Сгенерировать"))) return;
                      const res = await guard(() => api.patch(`/api/portal-accounts/${a.id}`, { regenerate_password: true }));
                      if (res?.password) {
                        await navigator.clipboard.writeText(res.password).catch(() => {});
                        toast("Новый пароль скопирован в буфер обмена");
                        loadAccounts();
                      }
                    },
                  },
                  icon("refresh", 14),
                  "Новый пароль",
                ),
              ),
            ),
          )
        : h("div", { class: "placeholder" }, "Ничего не найдено"),
    ),
  );
}

// ---------- dead-letter ----------

async function loadDeadCount() {
  const res = await guard(() => api.get("/api/jobs/dead/count"));
  if (res && res.dead !== state.deadCount) {
    state.deadCount = res.dead;
    renderBanners();
  }
}

async function showDeadJobs() {
  if (state.me.role !== "admin") {
    toast("Сообщите администратору: есть необработанные фоновые задачи", "error");
    return;
  }
  const items = await guard(() => api.get("/api/jobs/dead"));
  if (!items) return;
  const close = openModal(
    "Ошибки фоновых задач",
    h(
      "ul",
      { class: "dead-list" },
      items.map((j) =>
        h(
          "li",
          {},
          h("div", {}, h("strong", {}, `#${j.id} ${j.kind}`), h("span", { class: "muted small" }, ` · попыток: ${j.attempts} · ${fmtDate(j.updated_at)}`)),
          h("code", { class: "small err-code" }, j.last_error ?? ""),
          h(
            "div",
            { class: "row" },
            h("button", { class: "small", onclick: async () => { await guard(() => api.post(`/api/jobs/${j.id}/retry`)); close(); loadDeadCount(); } }, "Повторить"),
            h("button", { class: "small", onclick: async () => { await guard(() => api.post(`/api/jobs/${j.id}/ack`)); close(); loadDeadCount(); } }, "Скрыть"),
          ),
        ),
      ),
    ),
  );
}

// ---------- realtime ----------

function handleEvent(evt) {
  switch (evt.type) {
    case "message.created":
    case "message.updated":
      if (evt.contact_id === state.contactId) refreshMessages();
      reloadContacts();
      if (state.view === "today") reloadToday();
      break;
    case "contact.created":
      reloadContacts();
      break;
    case "folder.updated":
    case "application.updated":
      if (evt.contact_id === state.contactId) reloadFolder();
      if (state.view === "client" && evt.contact_id === state.clientId) reloadClient();
      if (state.view === "board") reloadBoard();
      if (state.view === "clients") reloadClientsList();
      if (state.view === "today") reloadToday();
      break;
    case "channel.updated":
      loadChannel();
      break;
    case "job.dead":
      loadDeadCount();
      break;
    case "resync":
      reloadContacts();
      if (state.contactId) {
        refreshMessages();
        reloadFolder();
      }
      if (state.view === "board") reloadBoard();
      loadDeadCount();
      break;
    default:
      break;
  }
}

// ---------- старт ----------

onAuthChange((st) => {
  if (st === "logged_in") boot().catch((e) => toast(errorMessage(e), "error"));
  else {
    state.stopEvents?.();
    state.stopEvents = null;
    state.revealed.clear();
    state.revealedPassports.clear();
    Object.assign(state, { view: "today", today: null, contactId: null, messages: [], folder: null, client: null, clientId: null, board: [], clients: [], pane: "list" });
    state.selectedFiles.clear();
    renderLogin();
  }
});

if (hasSession()) {
  boot().catch(() => renderLogin());
} else {
  renderLogin();
}
