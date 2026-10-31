// Демо-режим: тот же интерфейс, что у api.js, но данные живут в памяти браузера.
// Используется только сборкой frontend/build-demo.mjs (статический показ без backend). В production не попадает.

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const listeners = new Set();
let loggedIn = true;
let currentUserId = 1;
let eventSink = null;

const now = Date.now();
const ago = (min) => new Date(now - min * 60000).toISOString();
const inDays = (d, h = 10, m = 30) => {
  const x = new Date(now + d * 86400000);
  x.setHours(h, m, 0, 0);
  return x.toISOString();
};

// ---------- образцы файлов (генерируются в браузере) ----------

function passportImage(last, first, number) {
  const c = document.createElement("canvas");
  c.width = 640;
  c.height = 420;
  const g = c.getContext("2d");
  g.fillStyle = "#e9eef5";
  g.fillRect(0, 0, 640, 420);
  g.fillStyle = "#123c69";
  g.fillRect(0, 0, 640, 56);
  g.fillStyle = "#fff";
  g.font = "bold 22px sans-serif";
  g.fillText("ҚАЗАҚСТАН РЕСПУБЛИКАСЫ · REPUBLIC OF KAZAKHSTAN", 20, 36);
  g.fillStyle = "#c5d0de";
  g.fillRect(24, 80, 170, 220);
  g.fillStyle = "#7d8da3";
  g.beginPath();
  g.arc(109, 160, 42, 0, Math.PI * 2);
  g.fill();
  g.fillRect(52, 210, 114, 90);
  g.fillStyle = "#1d2b3a";
  g.font = "13px sans-serif";
  const rows = [["Тегі / Surname", last], ["Аты / Given names", first], ["Паспорт № / Passport No", number], ["Азаматтығы / Nationality", "KAZAKHSTAN"]];
  rows.forEach(([label, value], i) => {
    g.fillStyle = "#5b6b80";
    g.font = "12px sans-serif";
    g.fillText(label, 220, 100 + i * 52);
    g.fillStyle = "#1d2b3a";
    g.font = "bold 20px monospace";
    g.fillText(value, 220, 124 + i * 52);
  });
  g.fillStyle = "#1d2b3a";
  g.font = "16px monospace";
  g.fillText(`P<KAZ${last}<<${first}`.padEnd(44, "<").slice(0, 44), 20, 350);
  g.fillText(`${number}<0KAZ9005204F3103151`.padEnd(44, "<").slice(0, 44), 20, 378);
  g.fillStyle = "rgba(201,55,44,.75)";
  g.font = "bold 40px sans-serif";
  g.save();
  g.translate(360, 250);
  g.rotate(-0.25);
  g.fillText("ОБРАЗЕЦ", -90, 0);
  g.restore();
  return new Promise((resolve) => c.toBlob((b) => resolve(b), "image/png"));
}

function pdfBlob(title, lines) {
  const esc = (t) => t.replace(/[()\\]/g, (ch) => `\\${ch}`);
  const content = [`BT /F1 18 Tf 40 760 Td (${esc(title)}) Tj ET`, ...lines.map((l, i) => `BT /F1 12 Tf 40 ${720 - i * 22} Td (${esc(l)}) Tj ET`)].join("\n");
  const objs = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([out], { type: "application/pdf" });
}

// ---------- данные ----------

const db = {
  users: [
    { id: 1, email: "admin@agency.kz", full_name: "Гульнара Сейтова", role: "admin", is_active: true },
    { id: 2, email: "anna@agency.kz", full_name: "Анна Ким", role: "manager", is_active: true },
    { id: 3, email: "erzhan@agency.kz", full_name: "Ержан Сапаров", role: "manager", is_active: true },
    { id: 4, email: "aliya@agency.kz", full_name: "Алия Нурланова", role: "manager", is_active: true },
  ],
  contacts: [
    { id: 1, phone: "+77011234567", name: "Айгуль", channel: "whatsapp", unread_count: 2, last_message_at: ago(4), created_at: ago(2000) },
    { id: 2, phone: "+77779876543", name: "Нурлан Ахметов", channel: "whatsapp", unread_count: 0, last_message_at: ago(55), created_at: ago(9000) },
    { id: 3, phone: "+77051112233", name: "Динара", channel: "whatsapp", unread_count: 1, last_message_at: ago(12), created_at: ago(30) },
    { id: 4, phone: "+77474445566", name: "Тимур Ли", channel: "whatsapp", unread_count: 0, last_message_at: ago(180), created_at: ago(12000) },
    { id: 5, phone: "+77015550011", name: "Сауле Каримова", channel: "whatsapp", unread_count: 0, last_message_at: ago(1440), created_at: ago(20000) },
  ],
  applicants: [
    { id: 1, contact_id: 1, last_name: "IVANOVA", first_name: "AIGUL", citizenship: "KZ", passport: { passport_number: "N12345678", passport_expires_on: "2031-03-15", birth_date: "1990-05-20" } },
    { id: 2, contact_id: 1, last_name: "IVANOV", first_name: "MARAT", citizenship: "KZ", passport: null },
    { id: 3, contact_id: 2, last_name: "AKHMETOV", first_name: "NURLAN", citizenship: "KZ", passport: { passport_number: "N09876543", passport_expires_on: "2029-11-02", birth_date: "1985-01-12" } },
    { id: 4, contact_id: 4, last_name: "LI", first_name: "TIMUR", citizenship: "KZ", passport: { passport_number: "N55500011", passport_expires_on: "2030-06-30", birth_date: "1993-08-08" } },
    { id: 5, contact_id: 5, last_name: "KARIMOVA", first_name: "SAULE", citizenship: "KZ", passport: { passport_number: "N44400022", passport_expires_on: "2032-02-14", birth_date: "1979-04-03" } },
    { id: 6, contact_id: null, last_name: "SERIKOV", first_name: "ERLAN", citizenship: "KZ", passport: null },
  ],
  accounts: [
    { id: 1, portal: "vfs", login: "aigul.ivanova@mail.kz", password: "R6!2xZm6QWm#3n79", needs_rotation: false, rotation_reason: null, created_at: ago(1900), last_used_at: ago(300) },
    { id: 2, portal: "tlscontact", login: "n.akhmetov@gmail.com", password: "Tq8$Lp2#Vx9mKa4e", needs_rotation: false, rotation_reason: null, created_at: ago(8000), last_used_at: ago(60) },
    { id: 3, portal: "vfs", login: "timur.li@mail.kz", password: "Visa!Agency2025", needs_rotation: true, rotation_reason: "общий пароль с другими учётками", created_at: ago(12000), last_used_at: null },
    { id: 4, portal: "vfs", login: "erlan.serikov@mail.kz", password: "qwerty123", needs_rotation: true, rotation_reason: "короткий пароль (<10)", created_at: ago(12000), last_used_at: null },
    { id: 5, portal: "vfs", login: "saule.k@mail.kz", password: "Visa!Agency2025", needs_rotation: true, rotation_reason: "общий пароль с другими учётками", created_at: ago(20000), last_used_at: ago(4000) },
  ],
  applications: [
    { id: 1, contact_id: 1, applicant_id: 1, country: "IT", portal: "vfs", city: "Алматы", portal_url: null, status: "docs_collecting", assigned_user_id: 2, locked_by_user_id: null, locked_until: null, appointment_at: null, portal_account_id: 1, notes: "Туризм, Рим, 12–20 декабря. Нужна выписка за 6 месяцев.", status_changed_at: ago(1500), created_at: ago(1900), updated_at: ago(30) },
    { id: 2, contact_id: 1, applicant_id: 2, country: "IT", portal: "vfs", city: "Алматы", portal_url: null, status: "docs_collecting", assigned_user_id: 2, locked_by_user_id: null, locked_until: null, appointment_at: null, portal_account_id: 1, notes: "Муж, едут вместе.", status_changed_at: ago(1500), created_at: ago(1900), updated_at: ago(30) },
    { id: 3, contact_id: 2, applicant_id: 3, country: "FR", portal: "tlscontact", city: "Алматы", portal_url: null, status: "booked", assigned_user_id: 3, locked_by_user_id: null, locked_until: null, appointment_at: inDays(9, 11, 15), portal_account_id: 2, notes: null, status_changed_at: ago(61), created_at: ago(8900), updated_at: ago(60) },
    { id: 4, contact_id: 3, applicant_id: null, country: "ES", portal: "bls", city: null, portal_url: null, status: "new", assigned_user_id: null, locked_by_user_id: null, locked_until: null, appointment_at: null, portal_account_id: null, notes: null, created_at: ago(30), updated_at: ago(12) },
    { id: 5, contact_id: 4, applicant_id: 4, country: "LT", portal: "vfs", city: "Алматы", portal_url: null, status: "account_ready", assigned_user_id: 3, locked_by_user_id: null, locked_until: null, appointment_at: null, portal_account_id: 3, notes: null, status_changed_at: ago(9000), created_at: ago(12000), updated_at: ago(180) },
    { id: 6, contact_id: 5, applicant_id: 5, country: "DE", portal: "vfs", city: "Алматы", portal_url: null, status: "submitted", assigned_user_id: 2, locked_by_user_id: null, locked_until: null, appointment_at: inDays(-3, 9, 0), portal_account_id: 5, notes: "Ждём паспорт из визового центра.", status_changed_at: ago(4400), created_at: ago(20000), updated_at: ago(1440) },
    { id: 8, contact_id: 5, applicant_id: 5, country: "ES", portal: "bls", city: "Алматы", portal_url: null, status: "done", decision: "approved", decision_on: "2025-11-28", visa_valid_from: "2025-12-10", visa_valid_to: "2026-12-09", refusal_reason: null, assigned_user_id: 2, locked_by_user_id: null, locked_until: null, appointment_at: "2025-11-12T10:00:00.000Z", portal_account_id: null, notes: "Мультивиза на год.", created_at: "2025-10-30T09:00:00.000Z", updated_at: "2025-11-28T12:00:00.000Z" },
    { id: 9, contact_id: 2, applicant_id: 3, country: "FR", portal: "tlscontact", city: "Алматы", portal_url: null, status: "done", decision: "refused", decision_on: "2024-08-02", visa_valid_from: null, visa_valid_to: null, refusal_reason: "Не подтверждена цель поездки (п. 2)", assigned_user_id: 3, locked_by_user_id: null, locked_until: null, appointment_at: "2024-07-10T09:30:00.000Z", portal_account_id: 2, notes: "Подавали без приглашения от партнёра.", created_at: "2024-06-20T09:00:00.000Z", updated_at: "2024-08-02T12:00:00.000Z" },
    { id: 7, contact_id: null, applicant_id: 6, country: "CZ", portal: "vfs", city: null, portal_url: null, status: "account_ready", assigned_user_id: null, locked_by_user_id: null, locked_until: null, appointment_at: null, portal_account_id: 4, notes: "Импорт из Google-таблицы", created_at: ago(12000), updated_at: ago(12000) },
  ],
  files: [],
  blobs: new Map(),
  documents: [],
  messages: [
    { id: 1, contact_id: 1, direction: "inbound", text: "Здравствуйте! Нужна шенгенская виза в Италию для меня и мужа, вылет 12 декабря", created_at: ago(1900) },
    { id: 2, contact_id: 1, direction: "outbound", text: "Добрый день, Айгуль! Пришлите, пожалуйста, фото первой страницы паспортов и справки с работы.", author_user_id: 2, status: "read", created_at: ago(1890) },
    { id: 3, contact_id: 1, direction: "inbound", text: null, fileKey: "p1", created_at: ago(40) },
    { id: 4, contact_id: 1, direction: "inbound", text: null, fileKey: "p2", created_at: ago(39) },
    { id: 5, contact_id: 1, direction: "inbound", text: null, fileKey: "bank", created_at: ago(6) },
    { id: 6, contact_id: 1, direction: "inbound", text: "Вот паспорта и выписка. Справки будут в пятницу", created_at: ago(4) },
    { id: 7, contact_id: 2, direction: "inbound", text: "Добрый день, нужна Франция, бизнес", created_at: ago(9000) },
    { id: 8, contact_id: 2, direction: "outbound", text: "Записали вас в TLScontact, подтверждение во вложении.", author_user_id: 3, status: "delivered", created_at: ago(60) },
    { id: 9, contact_id: 2, direction: "outbound", text: null, fileKey: "tls", author_user_id: 3, status: "delivered", created_at: ago(59) },
    { id: 10, contact_id: 2, direction: "inbound", text: "Спасибо большое! 🙏", created_at: ago(55) },
    { id: 11, contact_id: 3, direction: "inbound", text: "Здравствуйте, сколько стоит виза в Испанию? Сроки?", created_at: ago(12) },
    { id: 12, contact_id: 4, direction: "inbound", text: "Учётку на VFS создали? Когда можно записаться в Литву?", created_at: ago(200) },
    { id: 13, contact_id: 4, direction: "outbound", text: "Да, учётка готова. Ищем слот, напишем сразу как будет запись.", author_user_id: 3, status: "read", created_at: ago(180) },
    { id: 14, contact_id: 5, direction: "inbound", text: "Сдала документы, спасибо!", created_at: ago(1440) },
    { id: 15, contact_id: 3, direction: "inbound", text: null, mediaFailed: true, created_at: ago(11) },
  ],
  deadJobs: [
    { id: 41, kind: "media.download", attempts: 1, last_error: "permanent: media link expired: HTTP 410", created_at: ago(11), updated_at: ago(11) },
  ],
  history: [],
  seq: 100,
};

const STATUS_RU = { new: "Новая", docs_collecting: "Сбор документов", docs_ready: "Документы готовы", account_ready: "Учётка готова", booking: "Запись", booked: "Записан", submitted: "Подано", done: "Готово", cancelled: "Отменено" };
const DOC_RU = { visa: "виза", refusal: "письмо об отказе", passport: "паспорт", photo: "фото", form: "анкета", bank_statement: "выписка из банка", booking_confirmation: "подтверждение записи", other: "документ" };

function logEvent(contactId, kind, title, applicationId = null, userId = currentUserId, at = new Date().toISOString()) {
  if (!contactId) return;
  db.history.push({ contact_id: contactId, at, kind, title, application_id: applicationId, user_id: userId });
}

// Прошлая история клиентов — чтобы карточка выглядела живой.
[
  [1, "application", "Создана сделка", 1, 2, 1890],
  [1, "application", "Создана сделка", 2, 2, 1889],
  [1, "status", "Статус: Новая → Сбор документов", 1, 2, 1880],
  [1, "status", "Статус: Новая → Сбор документов", 2, 2, 1880],
  [1, "account", "Создана учётка портала", null, 2, 1500],
  [1, "applicant", "Добавлен заявитель", null, 2, 35],
  [1, "document", "В папку добавлен паспорт", null, 2, 30],
  [2, "application", "Создана сделка", 3, 3, 8900],
  [2, "status", "Статус: Учётка готова → Запись", 3, 3, 70],
  [2, "portal", "Открыт портал для записи", 3, 3, 70],
  [2, "secret", "Просмотрен пароль учётки портала", null, 3, 69],
  [2, "status", "Статус: Запись → Записан", 3, 3, 61],
  [2, "document", "В папку добавлен подтверждение записи", 3, 3, 61],
  [4, "application", "Создана сделка", 5, 3, 12000],
  [4, "status", "Статус: Документы готовы → Учётка готова", 5, 3, 190],
  [5, "application", "Создана сделка", 6, 2, 20000],
  [5, "status", "Статус: Записан → Подано", 6, 2, 4400],
  [5, "application", "Создана сделка", 8, 2, 830000],
  [5, "outcome", "Итог: виза одобрена", 8, 2, 770000],
  [5, "document", "В папку добавлен виза", 8, 2, 770000],
  [2, "application", "Создана сделка", 9, 3, 1220000],
  [2, "outcome", "Итог: отказ в визе", 9, 3, 1180000],
  [2, "document", "В папку добавлен письмо об отказе", 9, 3, 1180000],
].forEach(([c, kind, title, appId, user, min]) => logEvent(c, kind, title, appId, user, ago(min)));

const nextId = () => ++db.seq;

async function addFile(key, name, blob, source = "whatsapp") {
  const id = nextId();
  db.files.push({ id, key, original_name: name, mime: blob.type, size: blob.size, source, uploaded_by: null });
  db.blobs.set(id, blob);
  return id;
}

const ready = (async () => {
  const p1 = await addFile("p1", "IMG-20261030-WA0003.png", await passportImage("IVANOVA", "AIGUL", "N12345678"));
  const p2 = await addFile("p2", "IMG-20261030-WA0004.png", await passportImage("IVANOV", "MARAT", "N23456789"));
  const bank = await addFile("bank", "Выписка_Kaspi_6мес.pdf", pdfBlob("Kaspi Bank - account statement", ["Client: IVANOVA AIGUL", "Period: 01.05.2026 - 30.10.2026", "Average balance: 4 850 000 KZT", "SAMPLE DOCUMENT"]));
  const tls = await addFile("tls", "TLScontact_appointment.pdf", pdfBlob("TLScontact - Appointment confirmation", ["Applicant: AKHMETOV NURLAN", "Centre: Almaty", `Date: ${new Date(db.applications[2].appointment_at).toLocaleString("ru-RU")}`, "SAMPLE DOCUMENT"]), "extension");
  const visa = await addFile("visa", "Виза_Испания_2025.pdf", pdfBlob("Schengen visa - Spain", ["KARIMOVA SAULE", "Type C, MULT", "Valid: 01.06.2025 - 31.05.2026", "SAMPLE DOCUMENT"]), "manual");
  const refusal = await addFile("refusal", "Отказ_Франция_2024.pdf", pdfBlob("Refusal of visa - France", ["AKHMETOV NURLAN", "Reason 2: purpose of stay not justified", "SAMPLE DOCUMENT"]), "manual");
  const keyToId = { p1, p2, bank, tls };
  for (const m of db.messages) {
    if (m.fileKey) m.file_id = keyToId[m.fileKey];
  }
  db.documents.push(
    { id: nextId(), file_id: p1, applicant_id: 1, application_id: null, doc_type: "passport", created_at: ago(30) },
    { id: nextId(), file_id: tls, applicant_id: null, application_id: 3, doc_type: "booking_confirmation", created_at: ago(59) },
    { id: nextId(), file_id: visa, applicant_id: 5, application_id: 8, doc_type: "visa", created_at: "2025-11-28T12:00:00.000Z" },
    { id: nextId(), file_id: refusal, applicant_id: 3, application_id: 9, doc_type: "refusal", created_at: "2024-08-02T12:00:00.000Z" },
  );
})();

// ---------- вспомогательные ----------

const PORTAL_URLS = {
  "vfs:IT": "https://visa.vfsglobal.com/kaz/ru/ita/login",
  "vfs:LT": "https://visa.vfsglobal.com/kaz/ru/ltu/login",
  "vfs:DE": "https://visa.vfsglobal.com/kaz/ru/deu/login",
  "vfs:CZ": "https://visa.vfsglobal.com/kaz/ru/cze/login",
  "tlscontact:FR": "https://visas-fr.tlscontact.com/",
  "bls:ES": "https://kazakhstan.blsspainglobal.com/",
};
const portalUrl = (a) => a.portal_url || PORTAL_URLS[`${a.portal}:${a.country}`] || (a.portal === "vfs" ? "https://visa.vfsglobal.com/" : null);

const me = () => db.users.find((u) => u.id === currentUserId);
const isAdmin = () => me().role === "admin";
const appVisible = (a) => isAdmin() || a.assigned_user_id === currentUserId || a.assigned_user_id === null;
const contactVisible = (c) => {
  if (isAdmin()) return true;
  const apps = db.applications.filter((a) => a.contact_id === c.id);
  return apps.length === 0 || apps.some(appVisible);
};
const notFound = (what) => new ApiError(404, "not_found", `${what} не найден(а)`);
const bad = (code, message) => new ApiError(400, code, message);

function mask(n) {
  return "•".repeat(Math.max(n.length - 3, 0)) + n.slice(-3);
}

function applicantOut(a) {
  return {
    id: a.id,
    contact_id: a.contact_id,
    last_name: a.last_name,
    first_name: a.first_name,
    citizenship: a.citizenship,
    has_passport: Boolean(a.passport),
    passport_number_masked: a.passport ? mask(a.passport.passport_number) : null,
    created_at: ago(100),
  };
}

function accountOut(acc) {
  const { password: _p, ...rest } = acc;
  return rest;
}

const NO_DECISION = { decision: null, decision_on: null, visa_valid_from: null, visa_valid_to: null, refusal_reason: null };
const DECISION_RU = { approved: "Итог: виза одобрена", refused: "Итог: отказ в визе", withdrawn: "Итог: клиент отказался" };

function applyOutcome(a, o) {
  if (!["approved", "refused", "withdrawn"].includes(o?.decision)) throw bad("decision_required", "Укажите итог: виза одобрена, отказ или клиент отказался");
  if (o.visa_valid_from && o.visa_valid_to && o.visa_valid_to < o.visa_valid_from) throw bad("invalid_visa_dates", "Дата окончания визы раньше даты начала");
  const approved = o.decision === "approved";
  Object.assign(a, {
    decision: o.decision,
    decision_on: o.decision_on || new Date().toISOString().slice(0, 10),
    visa_valid_from: approved ? o.visa_valid_from ?? null : null,
    visa_valid_to: approved ? o.visa_valid_to ?? null : null,
    refusal_reason: o.decision === "refused" ? o.refusal_reason ?? null : null,
  });
  logEvent(a.contact_id, "outcome", DECISION_RU[o.decision], a.id);
}

function appOut(a) {
  return { ...NO_DECISION, ...a, portal_url: portalUrl(a) };
}

function docOut(d) {
  const f = db.files.find((x) => x.id === d.file_id);
  return { id: d.id, doc_type: d.doc_type, file_id: f.id, original_name: f.original_name, mime: f.mime, size: f.size, created_at: d.created_at };
}

function messageOut(m) {
  const f = m.file_id ? db.files.find((x) => x.id === m.file_id) : null;
  return {
    id: m.id,
    contact_id: m.contact_id,
    direction: m.direction,
    msg_type: f ? "document" : "text",
    text: m.text ?? null,
    status: m.status ?? (m.direction === "inbound" ? "received" : "sent"),
    file: f ? { id: f.id, original_name: f.original_name, mime: f.mime, size: f.size } : null,
    media_pending: false,
    media_error: m.mediaFailed ? "media link expired" : null,
    author_user_id: m.author_user_id ?? null,
    error: null,
    created_at: m.created_at,
  };
}

function emit(event) {
  setTimeout(() => eventSink?.(event), 50);
}

function touchApp(a) {
  a.updated_at = new Date().toISOString();
  emit({ type: "application.updated", application_id: a.id, contact_id: a.contact_id });
}

function lockFree(a) {
  return !a.locked_by_user_id || a.locked_by_user_id === currentUserId || new Date(a.locked_until) < new Date();
}

// ---------- маршрутизация ----------

const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern}$`), fn });

route("GET", "/api/auth/me", () => me());
route("GET", "/api/users", () => db.users);
route("PATCH", "/api/auth/me", ({ body }) => {
  const u = me();
  u.full_name = (body.full_name || "").trim() || u.full_name;
  return u;
});
route("POST", "/api/auth/me/password", ({ body }) => {
  if ((body.new_password || "").length < 12) throw new ApiError(422, "validation_error", "Новый пароль — не короче 12 символов");
  return null;
});
route("POST", "/api/users", ({ body }) => {
  if (!isAdmin()) throw new ApiError(403, "forbidden", "Требуются права администратора");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email || "") || !(body.full_name || "").trim()) throw new ApiError(422, "validation_error", "Укажите имя и email");
  if (db.users.some((u) => u.email === body.email.toLowerCase())) throw new ApiError(409, "conflict", "Пользователь с таким email уже есть");
  const u = { id: nextId(), email: body.email.toLowerCase(), full_name: body.full_name.trim(), role: body.role || "manager", is_active: true };
  db.users.push(u);
  return u;
});
route("PATCH", "/api/users/(\\d+)", ({ m, body }) => {
  if (!isAdmin()) throw new ApiError(403, "forbidden", "Требуются права администратора");
  const u = db.users.find((x) => x.id === Number(m[1]));
  if (!u) throw notFound("Пользователь");
  if (u.id === currentUserId && (body.is_active === false || (body.role && body.role !== u.role))) throw bad("self_lockout", "Нельзя отключить себя или снять с себя роль администратора");
  for (const k of ["full_name", "role", "is_active"]) if (k in body) u[k] = body[k];
  return u;
});

route("GET", "/api/contacts", ({ query }) => {
  let list = db.contacts.filter(contactVisible);
  const q = (query.get("q") || "").trim().toLowerCase();
  if (q) {
    const digits = q.replace(/\D/g, "");
    list = list.filter((c) => {
      const applicants = db.applicants.filter((a) => a.contact_id === c.id);
      return (
        (c.name || "").toLowerCase().includes(q) ||
        (digits.length >= 3 && c.phone.includes(digits)) ||
        applicants.some((a) => `${a.last_name} ${a.first_name}`.toLowerCase().includes(q)) ||
        applicants.some((a) => a.passport && a.passport.passport_number.toLowerCase() === q.replace(/\s/g, ""))
      );
    });
  }
  const country = query.get("country");
  const status = query.get("status");
  const assigned = query.get("assigned_user_id");
  if (country || status || assigned) {
    list = list.filter((c) =>
      db.applications.some(
        (a) => a.contact_id === c.id && appVisible(a) && (!country || a.country === country) && (!status || a.status === status) && (!assigned || a.assigned_user_id === Number(assigned)),
      ),
    );
  }
  if (query.get("unread")) list = list.filter((c) => c.unread_count > 0);
  return [...list].sort((a, b) => (b.last_message_at || "").localeCompare(a.last_message_at || ""));
});

route("POST", "/api/contacts", ({ body }) => {
  const digits = (body.phone || "").replace(/\D/g, "").replace(/^8(?=7\d{9}$)/, "7");
  if (digits.length < 11) throw bad("invalid_phone", "Некорректный номер телефона");
  const phone = `+${digits}`;
  if (db.contacts.some((c) => c.phone === phone)) throw new ApiError(409, "conflict", "Контакт с таким номером уже есть");
  const contact = { id: nextId(), phone, name: body.name, channel: "whatsapp", unread_count: 0, last_message_at: null, created_at: new Date().toISOString() };
  db.contacts.push(contact);
  db.applications.push({ id: nextId(), contact_id: contact.id, applicant_id: null, country: null, portal: null, city: null, portal_url: null, status: "new", assigned_user_id: null, locked_by_user_id: null, locked_until: null, appointment_at: null, portal_account_id: null, notes: null, created_at: contact.created_at, updated_at: contact.created_at });
  return contact;
});

route("POST", "/api/contacts/(\\d+)/read", ({ m }) => {
  const c = db.contacts.find((x) => x.id === Number(m[1]));
  if (c) c.unread_count = 0;
  return null;
});

route("GET", "/api/contacts/(\\d+)/messages", ({ m }) => {
  const id = Number(m[1]);
  return db.messages.filter((x) => x.contact_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at)).map(messageOut);
});

route("POST", "/api/contacts/(\\d+)/messages", ({ m, body }) => {
  const contact = db.contacts.find((x) => x.id === Number(m[1]));
  if (!contact) throw notFound("Контакт");
  const existing = db.messages.find((x) => x.client_message_id === body.client_message_id);
  if (existing) return messageOut(existing);
  const msg = { id: nextId(), contact_id: contact.id, direction: "outbound", text: body.text ?? null, file_id: body.file_id ?? null, author_user_id: currentUserId, status: "queued", client_message_id: body.client_message_id, created_at: new Date().toISOString() };
  db.messages.push(msg);
  contact.last_message_at = msg.created_at;
  setTimeout(() => {
    msg.status = "sent";
    emit({ type: "message.updated", contact_id: contact.id, message_id: msg.id });
  }, 800);
  setTimeout(() => {
    msg.status = "delivered";
    emit({ type: "message.updated", contact_id: contact.id, message_id: msg.id });
  }, 2500);
  return messageOut(msg);
});

route("GET", "/api/contacts/(\\d+)/folder", ({ m }) => {
  const id = Number(m[1]);
  const contact = db.contacts.find((x) => x.id === id);
  if (!contact || !contactVisible(contact)) throw notFound("Контакт");
  const apps = db.applications.filter((a) => a.contact_id === id && appVisible(a));
  const fapp = (a) => ({
    ...appOut(a),
    documents: db.documents.filter((d) => d.application_id === a.id).map(docOut),
    portal_account: a.portal_account_id ? accountOut(db.accounts.find((x) => x.id === a.portal_account_id)) : null,
  });
  return {
    contact,
    applicants: db.applicants
      .filter((a) => a.contact_id === id)
      .map((a) => ({
        ...applicantOut(a),
        documents: db.documents.filter((d) => d.applicant_id === a.id && d.application_id === null).map(docOut),
        applications: apps.filter((x) => x.applicant_id === a.id).map(fapp),
      })),
    unassigned_applications: apps.filter((x) => x.applicant_id === null).map(fapp),
  };
});

route("POST", "/api/files", ({ form }) => {
  const file = form.get("file");
  return (async () => {
    const id = await addFile(null, file.name, file, "manual");
    const f = db.files.find((x) => x.id === id);
    return { ...f, sha256: "demo", deduplicated: false };
  })();
});

route("POST", "/api/files/(\\d+)/link", ({ m }) => {
  const blob = db.blobs.get(Number(m[1]));
  if (!blob) throw notFound("Файл");
  return { url: URL.createObjectURL(blob), expires_in: 300 };
});

route("POST", "/api/documents", ({ body }) => {
  let applicant = body.applicant_id ? db.applicants.find((a) => a.id === body.applicant_id) : null;
  const application = body.application_id ? db.applications.find((a) => a.id === body.application_id) : null;
  if (body.new_applicant) {
    const n = body.new_applicant;
    const clean = (v) => (v || "").trim().toUpperCase().replace(/\s+/g, " ");
    if (!/^[A-Z][A-Z '-]*$/.test(clean(n.last_name)) || !/^[A-Z][A-Z '-]*$/.test(clean(n.first_name))) {
      throw new ApiError(422, "validation_error", "ФИО — только латиницей, как в паспорте");
    }
    applicant = { id: nextId(), contact_id: n.contact_id, last_name: clean(n.last_name), first_name: clean(n.first_name), citizenship: "KZ", passport: null };
    db.applicants.push(applicant);
  }
  if (!applicant && !application) throw bad("target_required", "Укажите заявителя или заявку");
  if (["passport", "photo"].includes(body.doc_type) && !applicant) throw bad("applicant_required", "Паспорт и фото привязываются к заявителю");
  if (body.doc_type === "booking_confirmation" && !application) throw bad("application_required", "Подтверждение записи привязывается к заявке");
  if (application && applicant && !application.applicant_id) application.applicant_id = applicant.id;
  const out = [];
  for (const fileId of new Set(body.file_ids)) {
    const doc = { id: nextId(), file_id: fileId, applicant_id: applicant?.id ?? null, application_id: application?.id ?? null, doc_type: body.doc_type, created_at: new Date().toISOString() };
    db.documents.push(doc);
    out.push(doc);
    logEvent(application?.contact_id ?? applicant?.contact_id, "document", `В папку добавлен ${DOC_RU[body.doc_type]}`, application?.id ?? null);
  }
  return out;
});

route("DELETE", "/api/documents/(\\d+)", ({ m }) => {
  const doc = db.documents.find((d) => d.id === Number(m[1]));
  if (doc) {
    const app = db.applications.find((x) => x.id === doc.application_id);
    const ap = db.applicants.find((x) => x.id === doc.applicant_id);
    logEvent(app?.contact_id ?? ap?.contact_id, "document", `Из папки убран ${DOC_RU[doc.doc_type]}`, app?.id ?? null);
  }
  db.documents = db.documents.filter((d) => d.id !== Number(m[1]));
  return null;
});

route("GET", "/api/portal-accounts", () => db.accounts.map(accountOut));

route("POST", "/api/portal-accounts", ({ body }) => {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.login || "")) throw new ApiError(422, "validation_error", "Укажите email для портала");
  if (db.accounts.some((a) => a.portal === body.portal && a.login === body.login.toLowerCase())) throw new ApiError(409, "conflict", "Учётка с таким логином уже есть");
  const generated = !body.password;
  const password = body.password || generatePassword();
  const acc = { id: nextId(), portal: body.portal, login: body.login.toLowerCase(), password, needs_rotation: password.length < 10, rotation_reason: password.length < 10 ? "короткий пароль (<10)" : null, created_at: new Date().toISOString(), last_used_at: null };
  db.accounts.push(acc);
  return { ...accountOut(acc), password: generated ? password : null };
});

route("PATCH", "/api/portal-accounts/(\\d+)", ({ m, body }) => {
  const acc = db.accounts.find((a) => a.id === Number(m[1]));
  if (!acc) throw notFound("Учётка");
  let generated = null;
  if (body.regenerate_password) {
    generated = generatePassword();
    acc.password = generated;
    acc.needs_rotation = false;
    acc.rotation_reason = null;
  }
  return { ...accountOut(acc), password: generated };
});

route("POST", "/api/portal-accounts/(\\d+)/reveal", ({ m }) => {
  const acc = db.accounts.find((a) => a.id === Number(m[1]));
  if (!acc) throw notFound("Учётка");
  acc.last_used_at = new Date().toISOString();
  const app = db.applications.find((x) => x.portal_account_id === acc.id && x.contact_id);
  if (app) logEvent(app.contact_id, "secret", "Просмотрен пароль учётки портала");
  return { portal_account_id: acc.id, login: acc.login, password: acc.password };
});

route("POST", "/api/applicants", ({ body }) => {
  const a = { id: nextId(), contact_id: body.contact_id, last_name: body.last_name.trim().toUpperCase(), first_name: body.first_name.trim().toUpperCase(), citizenship: body.citizenship, passport: body.passport ?? null };
  if (!/^[A-Z][A-Z '-]*$/.test(a.last_name) || !/^[A-Z][A-Z '-]*$/.test(a.first_name)) throw new ApiError(422, "validation_error", "ФИО — только латиницей, как в паспорте");
  db.applicants.push(a);
  logEvent(a.contact_id, "applicant", "Добавлен заявитель");
  emit({ type: "folder.updated", contact_id: a.contact_id });
  return applicantOut(a);
});

route("PATCH", "/api/applicants/(\\d+)", ({ m, body }) => {
  const a = db.applicants.find((x) => x.id === Number(m[1]));
  if (!a) throw notFound("Заявитель");
  if (body.last_name) a.last_name = body.last_name.toUpperCase();
  if (body.first_name) a.first_name = body.first_name.toUpperCase();
  if ("citizenship" in body) a.citizenship = body.citizenship;
  if (body.passport) a.passport = { ...body.passport, passport_number: body.passport.passport_number.toUpperCase().replace(/\W/g, "") };
  return applicantOut(a);
});

route("POST", "/api/applicants/(\\d+)/link-contact", ({ m, body }) => {
  const a = db.applicants.find((x) => x.id === Number(m[1]));
  const digits = (body.phone || "").replace(/\D/g, "").replace(/^8(?=7\d{9}$)/, "7");
  if (digits.length < 11) throw bad("invalid_phone", "Некорректный номер телефона");
  let contact = db.contacts.find((c) => c.phone === `+${digits}`);
  if (!contact) {
    contact = { id: nextId(), phone: `+${digits}`, name: `${a.first_name} ${a.last_name}`, channel: "whatsapp", unread_count: 0, last_message_at: new Date().toISOString(), created_at: new Date().toISOString() };
    db.contacts.push(contact);
  }
  a.contact_id = contact.id;
  db.applications.filter((x) => x.applicant_id === a.id && !x.contact_id).forEach((x) => (x.contact_id = contact.id));
  return applicantOut(a);
});

route("POST", "/api/applications", ({ body }) => {
  const a = { id: nextId(), contact_id: body.contact_id, applicant_id: body.applicant_id ?? null, country: null, portal: null, city: null, portal_url: null, status: "new", assigned_user_id: isAdmin() ? null : currentUserId, locked_by_user_id: null, locked_until: null, appointment_at: null, portal_account_id: null, notes: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  db.applications.push(a);
  logEvent(a.contact_id, "application", "Создана сделка", a.id);
  return appOut(a);
});

route("PATCH", "/api/applications/(\\d+)", ({ m, body }) => {
  const a = db.applications.find((x) => x.id === Number(m[1]));
  if (!a || !appVisible(a)) throw notFound("Заявка");
  const { outcome, ...rest } = body;
  if ("outcome" in body) {
    if (!outcome && a.status === "done") throw bad("decision_required", "У закрытой сделки должен быть итог");
    if (outcome) applyOutcome(a, outcome);
    else Object.assign(a, NO_DECISION);
  }
  Object.assign(a, rest);
  touchApp(a);
  return appOut(a);
});

const ORDER = ["new", "docs_collecting", "docs_ready", "account_ready", "booking", "booked", "submitted", "done"];

route("POST", "/api/applications/(\\d+)/status", ({ m, body }) => {
  const a = db.applications.find((x) => x.id === Number(m[1]));
  if (!a || !appVisible(a)) throw notFound("Заявка");
  const from = ORDER.indexOf(a.status);
  const to = ORDER.indexOf(body.status);
  const allowed = body.status === "cancelled" || isAdmin() || Math.abs(to - from) <= 1;
  if (!allowed) throw bad("invalid_transition", "Менеджер двигает заявку на один шаг по воронке (админ — на любой)");
  if (body.appointment_at) a.appointment_at = body.appointment_at;
  if (body.status === "booked" && !a.appointment_at) throw bad("appointment_required", "Для статуса «Записан» нужна дата записи");
  if (body.status === "done" && !body.outcome && !a.decision) throw bad("decision_required", "Укажите итог: виза одобрена, отказ или клиент отказался");
  if (body.outcome) applyOutcome(a, body.outcome);
  if (a.status !== body.status) logEvent(a.contact_id, "status", `Статус: ${STATUS_RU[a.status]} → ${STATUS_RU[body.status]}`, a.id);
  if (a.status !== body.status) a.status_changed_at = new Date().toISOString();
  a.status = body.status;
  if (["booked", "done", "cancelled"].includes(a.status)) {
    a.locked_by_user_id = null;
    a.locked_until = null;
  }
  touchApp(a);
  return appOut(a);
});

route("POST", "/api/applications/(\\d+)/lock", ({ m }) => {
  const a = db.applications.find((x) => x.id === Number(m[1]));
  if (!a || !appVisible(a)) throw notFound("Заявка");
  if (!lockFree(a)) throw new ApiError(409, "locked", "Заявка уже открыта другим менеджером");
  const shared = db.applications.find((x) => x.id !== a.id && x.portal_account_id && x.portal_account_id === a.portal_account_id && x.locked_by_user_id && x.locked_by_user_id !== currentUserId && new Date(x.locked_until) > new Date());
  if (shared) throw new ApiError(409, "portal_account_locked", "Учётка портала сейчас используется другим менеджером");
  db.applications.forEach((x) => {
    if (x.locked_by_user_id === currentUserId) {
      x.locked_by_user_id = null;
      x.locked_until = null;
    }
  });
  a.locked_by_user_id = currentUserId;
  a.locked_until = new Date(Date.now() + 600000).toISOString();
  logEvent(a.contact_id, "portal", "Открыт портал для записи", a.id);
  if (a.status === "account_ready") {
    a.status = "booking";
    logEvent(a.contact_id, "status", "Статус: Учётка готова → Запись", a.id);
    a.status_changed_at = new Date().toISOString();
  }
  touchApp(a);
  return { application_id: a.id, locked_by_user_id: currentUserId, locked_until: a.locked_until, portal_url: portalUrl(a) };
});

route("DELETE", "/api/applications/(\\d+)/lock", ({ m }) => {
  const a = db.applications.find((x) => x.id === Number(m[1]));
  if (a) {
    a.locked_by_user_id = null;
    a.locked_until = null;
    touchApp(a);
  }
  return null;
});

route("PATCH", "/api/contacts/(\\d+)", ({ m, body }) => {
  const c = db.contacts.find((x) => x.id === Number(m[1]));
  if (!c) throw notFound("Контакт");
  if ("name" in body) c.name = body.name;
  return c;
});

route("POST", "/api/applicants/(\\d+)/passport/reveal", ({ m }) => {
  const a = db.applicants.find((x) => x.id === Number(m[1]));
  if (!a?.passport) throw notFound("Паспорт");
  logEvent(a.contact_id, "secret", "Просмотрены паспортные данные");
  return { applicant_id: a.id, ...a.passport };
});

route("GET", "/api/clients", ({ query }) => {
  const q = (query.get("q") || "").trim().toLowerCase();
  const country = query.get("country");
  return db.contacts
    .filter(contactVisible)
    .filter((c) => {
      if (!q) return true;
      const applicants = db.applicants.filter((a) => a.contact_id === c.id);
      const digits = q.replace(/\D/g, "");
      return (
        (c.name || "").toLowerCase().includes(q) ||
        (digits.length >= 3 && c.phone.includes(digits)) ||
        applicants.some((a) => `${a.last_name} ${a.first_name}`.toLowerCase().includes(q) || (a.passport && a.passport.passport_number.toLowerCase() === q.replace(/\s/g, "")))
      );
    })
    .filter((c) => !country || db.applications.some((a) => a.contact_id === c.id && a.country === country && appVisible(a)))
    .sort((a, b) => (b.last_message_at || b.created_at).localeCompare(a.last_message_at || a.created_at))
    .map((c) => ({
      ...c,
      applicants: db.applicants.filter((a) => a.contact_id === c.id).map((a) => `${a.last_name} ${a.first_name}`),
      applications: db.applications
        .filter((a) => a.contact_id === c.id && appVisible(a))
        .map((a) => ({ id: a.id, country: a.country, portal: a.portal, status: a.status, decision: a.decision ?? null, appointment_at: a.appointment_at, assigned_user_id: a.assigned_user_id, created_at: a.created_at })),
    }));
});

route("GET", "/api/clients/(\\d+)/history", ({ m }) => {
  const id = Number(m[1]);
  const contact = db.contacts.find((c) => c.id === id);
  if (!contact || !contactVisible(contact)) throw notFound("Контакт");
  const first = db.messages.filter((x) => x.contact_id === id).map((x) => x.created_at).sort()[0];
  return [...db.history.filter((e) => e.contact_id === id), { at: first ?? contact.created_at, kind: "contact", title: "Первое обращение в WhatsApp", application_id: null, user_id: null }]
    .sort((a, b) => b.at.localeCompare(a.at));
});

// --- канал WhatsApp (демо: QR «сканируется» сам через 8 секунд) ---
const channel = { provider: "evolution", state: "open", phone: "77010000000", updated_at: ago(600) };

function fakeQr() {
  const c = document.createElement("canvas");
  const n = 29;
  const cell = 8;
  c.width = c.height = n * cell;
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#111";
  const finder = (x, y) => {
    g.fillRect(x * cell, y * cell, 7 * cell, 7 * cell);
    g.fillStyle = "#fff";
    g.fillRect((x + 1) * cell, (y + 1) * cell, 5 * cell, 5 * cell);
    g.fillStyle = "#111";
    g.fillRect((x + 2) * cell, (y + 2) * cell, 3 * cell, 3 * cell);
  };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (crypto.getRandomValues(new Uint8Array(1))[0] > 140) g.fillRect(x * cell, y * cell, cell, cell);
  [[0, 0], [n - 7, 0], [0, n - 7]].forEach(([x, y]) => {
    g.fillStyle = "#fff";
    g.fillRect((x - (x ? 1 : 0)) * cell, (y - (y ? 1 : 0)) * cell, 8 * cell, 8 * cell);
    g.fillStyle = "#111";
    finder(x, y);
  });
  return c.toDataURL("image/png");
}

route("GET", "/api/channel", () => { const { timer: _t, ...out } = channel; return out; });
route("POST", "/api/channel/refresh", () => channel);
route("POST", "/api/channel/logout", () => {
  Object.assign(channel, { state: "close", updated_at: new Date().toISOString() });
  return channel;
});
route("POST", "/api/channel/connect", () => {
  if (channel.state === "open") return channel;
  Object.assign(channel, { state: "connecting", updated_at: new Date().toISOString() });
  clearTimeout(channel.timer);
  channel.timer = setTimeout(() => {
    Object.assign(channel, { state: "open", updated_at: new Date().toISOString() });
    emit({ type: "channel.updated", state: "open" });
  }, 8000);
  const { timer: _t, ...out } = channel;
  return { ...out, qr_base64: fakeQr() };
});

function docsCount(a) {
  return db.documents.filter((d) => d.application_id === a.id || (a.applicant_id && d.applicant_id === a.applicant_id && d.application_id === null)).length;
}

function boardCard(a) {
  const c = db.contacts.find((x) => x.id === a.contact_id);
  const ap = db.applicants.find((x) => x.id === a.applicant_id);
  return {
    id: a.id,
    contact_id: c?.id ?? null,
    contact_name: c?.name ?? null,
    contact_phone: c?.phone ?? null,
    applicant_id: ap?.id ?? null,
    applicant_name: ap ? `${ap.last_name} ${ap.first_name}` : null,
    country: a.country,
    status: a.status,
    assigned_user_id: a.assigned_user_id,
    appointment_at: a.appointment_at,
    locked_by_user_id: a.locked_until && new Date(a.locked_until) > new Date() ? a.locked_by_user_id : null,
    status_changed_at: a.status_changed_at ?? a.created_at,
    updated_at: a.updated_at,
    docs_count: docsCount(a),
    unread_count: c?.unread_count ?? 0,
    visa_valid_to: a.visa_valid_to ?? null,
  };
}

route("GET", "/api/board", ({ query }) => {
  const country = query.get("country");
  return db.applications
    .filter((a) => appVisible(a) && !["done", "cancelled"].includes(a.status) && (!country || a.country === country))
    .map(boardCard);
});

route("GET", "/api/today", ({ query }) => {
  const mine = query.get("mine") === "true";
  const now = Date.now();
  const DAY = 86400000;
  const apps = db.applications.filter((a) => appVisible(a) && (!mine || a.assigned_user_id === currentUserId));
  const since = (a) => new Date(a.status_changed_at ?? a.created_at).getTime();
  const by = (f) => (x, y) => f(x) - f(y);
  const today = new Date().toISOString().slice(0, 10);
  const in60 = new Date(now + 60 * DAY).toISOString().slice(0, 10);
  return {
    generated_at: new Date().toISOString(),
    appointments: apps
      .filter((a) => ["booked", "booking", "account_ready"].includes(a.status) && a.appointment_at && new Date(a.appointment_at).getTime() >= now - 12 * 3600000 && new Date(a.appointment_at).getTime() < now + 14 * DAY)
      .sort(by((a) => new Date(a.appointment_at).getTime()))
      .map(boardCard),
    unanswered: db.contacts
      .filter((c) => contactVisible(c) && c.unread_count > 0)
      .filter((c) => !mine || !db.applications.some((a) => a.contact_id === c.id && a.assigned_user_id !== currentUserId))
      .sort((x, y) => (x.last_message_at || "").localeCompare(y.last_message_at || ""))
      .map((c) => ({ contact_id: c.id, name: c.name, phone: c.phone, unread_count: c.unread_count, last_message_at: c.last_message_at })),
    new_leads: apps.filter((a) => a.status === "new").sort(by((a) => new Date(a.created_at).getTime())).map(boardCard),
    stale: apps
      .filter((a) => ["docs_collecting", "docs_ready", "account_ready", "booking"].includes(a.status) && since(a) < now - 5 * DAY)
      .sort(by(since))
      .map(boardCard),
    awaiting_decision: apps.filter((a) => a.status === "submitted").sort(by(since)).map(boardCard),
    visas_expiring: apps
      .filter((a) => a.status === "done" && a.decision === "approved" && a.visa_valid_to && a.visa_valid_to >= today && a.visa_valid_to <= in60)
      .sort((x, y) => x.visa_valid_to.localeCompare(y.visa_valid_to))
      .map(boardCard),
    stale_days: 5,
  };
});

route("GET", "/api/jobs/dead/count", () => ({ dead: db.deadJobs.length }));
route("GET", "/api/jobs/dead", () => db.deadJobs);
route("POST", "/api/jobs/(\\d+)/(retry|ack)", ({ m }) => {
  db.deadJobs = db.deadJobs.filter((j) => j.id !== Number(m[1]));
  return null;
});

function generatePassword() {
  const pools = ["abcdefghjkmnpqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789", "!@#$%*-_"];
  const all = pools.join("");
  const rnd = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  const chars = pools.map((p) => p[rnd(p.length)]);
  while (chars.length < 16) chars.push(all[rnd(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

// ---------- публичный интерфейс (как у api.js) ----------

export async function request(method, path, { json, form, query } = {}) {
  await ready;
  if (!loggedIn) throw new ApiError(401, "unauthorized", "Требуется авторизация");
  const url = new URL(path, location.origin);
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    params.set(k, String(v));
  }
  await new Promise((r) => setTimeout(r, 60));
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = url.pathname.match(r.re);
    if (m) return structuredClone(await r.fn({ m, body: json ?? {}, form, query: params }));
  }
  throw new ApiError(404, "not_found", `Демо: ${method} ${url.pathname} не поддерживается`);
}

export const api = {
  get: (path, query) => request("GET", path, { query }),
  post: (path, json, query) => request("POST", path, { json, query }),
  patch: (path, json) => request("PATCH", path, { json }),
  del: (path) => request("DELETE", path),
  upload: (path, file) => {
    const form = new FormData();
    form.append("file", file);
    return request("POST", path, { form });
  },
};

export function onAuthChange(fn) {
  listeners.add(fn);
}

export async function login(email) {
  const user = db.users.find((u) => u.email === (email || "").trim().toLowerCase());
  if (!user) throw new ApiError(401, "unauthorized", "Демо: войдите как admin@agency.kz, anna@agency.kz или erzhan@agency.kz (пароль любой)");
  currentUserId = user.id;
  loggedIn = true;
  listeners.forEach((fn) => fn("logged_in"));
}

export async function logout() {
  loggedIn = false;
  listeners.forEach((fn) => fn("logged_out"));
}

export function hasSession() {
  return loggedIn;
}

// «Входящее» через 25 секунд, чтобы было видно realtime-обновление списка и чата.
export function subscribeEvents(onEvent) {
  eventSink = onEvent;
  const timer = setTimeout(() => {
    const contact = db.contacts.find((c) => c.id === 3);
    const msg = { id: nextId(), contact_id: 3, direction: "inbound", text: "Едем вдвоём с сестрой в Барселону в феврале. Что нужно из документов?", created_at: new Date().toISOString() };
    db.messages.push(msg);
    contact.unread_count += 1;
    contact.last_message_at = msg.created_at;
    onEvent({ type: "message.created", contact_id: 3, message_id: msg.id });
  }, 25000);
  return () => {
    clearTimeout(timer);
    eventSink = null;
  };
}
