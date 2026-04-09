const END_OF_FLOW = "__end__";
const API_BASE = "/.netlify/functions";

const QUESTION_TYPE_OPTIONS = [
  { value: "shortText", label: "簡答" },
  { value: "longText", label: "長答" },
  { value: "email", label: "Email" },
  { value: "phone", label: "電話" },
  { value: "number", label: "數字" },
  { value: "singleChoice", label: "單選" },
  { value: "multiChoice", label: "複選" },
  { value: "dropdown", label: "下拉選單" },
  { value: "date", label: "日期" },
];

const OPTION_TYPES = new Set(["singleChoice", "multiChoice", "dropdown"]);
const BRANCHING_TYPES = new Set(["singleChoice", "multiChoice", "dropdown"]);

function readSessionPassword() {
  return "";
}

const state = {
  apiMode: "loading",
  public: {
    events: [],
    selectedEventId: null,
    runner: null,
    loading: true,
    error: "",
  },
  admin: {
    open: false,
    authenticated: false,
    password: readSessionPassword(),
    events: [],
    draft: null,
    selectedEventId: null,
    dirty: false,
    loading: false,
    saving: false,
    deleting: false,
    usingDefaultPassword: false,
    loginError: "",
    collapsedPages: {},
    collapsedQuestions: {},
  },
  storageSummary: {
    modeLabel: "檢查中",
    detail: "正在偵測目前使用的資料儲存方式。",
  },
};

const dom = {
  openAdmin: document.querySelector("#open-admin"),
  closeAdmin: document.querySelector("#close-admin"),
  eventList: document.querySelector("#event-list"),
  publicDetail: document.querySelector("#public-detail"),
  publicOverlay: document.querySelector("#public-overlay"),
  closePublic: document.querySelector("#close-public"),
  adminOverlay: document.querySelector("#admin-overlay"),
  adminRoot: document.querySelector("#admin-root"),
  toast: document.querySelector("#toast"),
};

let toastTimer = 0;

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function nl2br(value) {
  return escapeHtml(value).replaceAll("\n", "<br />");
}

function supportsOptions(type) {
  return OPTION_TYPES.has(type);
}

function supportsBranching(type) {
  return BRANCHING_TYPES.has(type);
}

function getQuestionTypeLabel(type) {
  return QUESTION_TYPE_OPTIONS.find((option) => option.value === type)?.label || type;
}

function formatDate(value) {
  if (!value) {
    return "未記錄";
  }

  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return "未記錄";
  }

  return new Intl.DateTimeFormat("zh-Hant-TW", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatCapacity(value) {
  return value == null ? "不限名額" : `${value} 人`;
}

function summarizeRemainingCapacity(events) {
  const tracked = events.filter((event) => event.remainingCapacity != null);
  if (tracked.length === 0) {
    return "有名額上限的活動可在此顯示總剩餘人數。";
  }

  const total = tracked.reduce((sum, event) => sum + event.remainingCapacity, 0);
  return `目前總剩餘可報名人數 ${total} 人`;
}

function computeUsedCapacity(event) {
  return (event.submissions || []).reduce(
    (sum, submission) => sum + (Number.parseInt(submission.totalParticipants, 10) || 0),
    0,
  );
}

function computeRemainingCapacity(event) {
  if (event.capacity == null) {
    return null;
  }

  return Math.max(0, event.capacity - computeUsedCapacity(event));
}

function createOption(label = "新選項") {
  return {
    id: createId("option"),
    label,
    nextPageId: null,
  };
}

function createQuestion(label = "新欄位", type = "shortText") {
  return {
    id: createId("question"),
    label,
    helpText: "",
    type,
    required: true,
    placeholder: "",
    countsTowardCapacity: false,
    repeatForAdditionalParticipants: false,
    options: supportsOptions(type) ? [createOption("選項 1"), createOption("選項 2")] : [],
  };
}

function createPage(title = "新的一頁") {
  return {
    id: createId("page"),
    title,
    description: "",
    defaultNextPageId: null,
    questions: [],
  };
}

function createEmptyEvent() {
  const page = createPage("基本資料");
  page.questions = [
    {
      ...createQuestion("報名人姓名", "shortText"),
      countsTowardCapacity: false,
      placeholder: "請填寫姓名",
    },
    {
      ...createQuestion("聯絡 Email", "email"),
      countsTowardCapacity: false,
      placeholder: "you@example.com",
    },
    {
      ...createQuestion("報名總人數", "number"),
      countsTowardCapacity: true,
      placeholder: "例如 2",
    },
  ];

  return normalizeEvent({
    id: createId("event"),
    title: "新活動",
    description: "請描述活動資訊、時間與報名須知。",
    coverImage: "",
    capacity: 50,
    status: "published",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pages: [page],
    submissions: [],
  });
}

function normalizeOption(option) {
  return {
    id: String(option?.id || createId("option")),
    label: String(option?.label || "未命名選項").trim(),
    nextPageId:
      option?.nextPageId && typeof option.nextPageId === "string" ? option.nextPageId : null,
  };
}

function normalizeQuestion(question) {
  const type = QUESTION_TYPE_OPTIONS.some((option) => option.value === question?.type)
    ? question.type
    : "shortText";

  return {
    id: String(question?.id || createId("question")),
    label: String(question?.label || "未命名欄位").trim(),
    helpText: String(question?.helpText || "").trim(),
    type,
    required: Boolean(question?.required),
    placeholder: String(question?.placeholder || "").trim(),
    countsTowardCapacity: type === "number" ? Boolean(question?.countsTowardCapacity) : false,
    repeatForAdditionalParticipants: Boolean(question?.repeatForAdditionalParticipants),
    options: supportsOptions(type)
      ? (Array.isArray(question?.options) && question.options.length
          ? question.options
          : [createOption("選項 1"), createOption("選項 2")]
        ).map((option) => normalizeOption(option))
      : [],
  };
}

function normalizePage(page, index = 0) {
  return {
    id: String(page?.id || createId("page")),
    title: String(page?.title || `第 ${index + 1} 頁`).trim(),
    description: String(page?.description || "").trim(),
    defaultNextPageId:
      page?.defaultNextPageId && typeof page.defaultNextPageId === "string"
        ? page.defaultNextPageId
        : null,
    questions: Array.isArray(page?.questions)
      ? page.questions.map((question) => normalizeQuestion(question))
      : [],
  };
}

function normalizeSubmission(submission) {
  return {
    id: String(submission?.id || createId("submission")),
    submittedAt: submission?.submittedAt || new Date().toISOString(),
    totalParticipants: Math.max(1, Number.parseInt(submission?.totalParticipants, 10) || 1),
    visitedPageIds: Array.isArray(submission?.visitedPageIds)
      ? submission.visitedPageIds.map((value) => String(value))
      : [],
    answers: submission?.answers && typeof submission.answers === "object" ? submission.answers : {},
    repeatedAnswers: Array.isArray(submission?.repeatedAnswers)
      ? submission.repeatedAnswers
          .map((entry, index) => ({
            participantNumber: Math.max(
              2,
              Number.parseInt(entry?.participantNumber, 10) || index + 2,
            ),
            answers: entry?.answers && typeof entry.answers === "object" ? entry.answers : {},
          }))
          .sort((left, right) => left.participantNumber - right.participantNumber)
      : [],
  };
}

function normalizeEvent(event) {
  return {
    id: String(event?.id || createId("event")),
    title: String(event?.title || "未命名活動").trim(),
    description: String(event?.description || "").trim(),
    coverImage: typeof event?.coverImage === "string" ? event.coverImage : "",
    capacity:
      event?.capacity === "" || event?.capacity == null
        ? null
        : Math.max(1, Number.parseInt(event.capacity, 10) || 0) || null,
    status: event?.status === "draft" ? "draft" : "published",
    createdAt: event?.createdAt || new Date().toISOString(),
    updatedAt: event?.updatedAt || new Date().toISOString(),
    pages: (Array.isArray(event?.pages) && event.pages.length ? event.pages : [createPage()]).map(
      (page, index) => normalizePage(page, index),
    ),
    submissions: Array.isArray(event?.submissions)
      ? event.submissions.map((submission) => normalizeSubmission(submission))
      : [],
  };
}

function sanitizeEventForPublic(event) {
  const normalized = normalizeEvent(event);
  return {
    id: normalized.id,
    title: normalized.title,
    description: normalized.description,
    coverImage: normalized.coverImage,
    capacity: normalized.capacity,
    remainingCapacity: computeRemainingCapacity(normalized),
    status: normalized.status,
    pages: deepClone(normalized.pages),
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
  };
}

function sanitizeEventForAdmin(event) {
  const normalized = normalizeEvent(event);
  return {
    ...deepClone(normalized),
    totalForms: normalized.submissions.length,
    totalParticipants: computeUsedCapacity(normalized),
    remainingCapacity: computeRemainingCapacity(normalized),
  };
}

function normalizeAnswersForEvent(event, answers) {
  const normalizedAnswers = {};
  const source = answers && typeof answers === "object" ? answers : {};

  for (const page of event.pages) {
    for (const question of page.questions) {
      normalizedAnswers[question.id] = normalizeAnswerForQuestion(question, source[question.id]);
    }
  }

  return normalizedAnswers;
}

function normalizeAnswerForQuestion(question, value) {
  if (question.type === "multiChoice") {
    const validIds = new Set(question.options.map((option) => option.id));
    return Array.isArray(value) ? value.filter((entry) => validIds.has(entry)) : [];
  }

  if (supportsOptions(question.type)) {
    const validIds = new Set(question.options.map((option) => option.id));
    return validIds.has(value) ? value : "";
  }

  if (question.type === "number") {
    if (value === "" || value == null) {
      return "";
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? String(parsed) : "";
  }

  return value == null ? "" : String(value);
}

function getRepeatQuestions(event) {
  return event.pages
    .flatMap((page) => page.questions)
    .filter((question) => question.repeatForAdditionalParticipants);
}

function normalizeRepeatedAnswersForEvent(event, repeatedAnswers) {
  const repeatQuestions = getRepeatQuestions(event);
  const source = Array.isArray(repeatedAnswers) ? repeatedAnswers : [];
  const normalized = new Map();

  for (const [index, entry] of source.entries()) {
    const participantNumber = Math.max(
      2,
      Number.parseInt(entry?.participantNumber, 10) || index + 2,
    );
    const answers = entry?.answers && typeof entry.answers === "object" ? entry.answers : {};
    const normalizedAnswers = {};

    for (const question of repeatQuestions) {
      normalizedAnswers[question.id] = normalizeAnswerForQuestion(question, answers[question.id]);
    }

    normalized.set(participantNumber, {
      participantNumber,
      answers: normalizedAnswers,
    });
  }

  return [...normalized.values()].sort(
    (left, right) => left.participantNumber - right.participantNumber,
  );
}

function getRepeatAnswerEntry(runner, participantNumber) {
  return (
    runner?.repeatedAnswers?.find((entry) => entry.participantNumber === participantNumber) || null
  );
}

function ensureRepeatAnswerEntry(event, runner, participantNumber) {
  if (!runner) {
    return null;
  }

  const existing = getRepeatAnswerEntry(runner, participantNumber);
  if (existing) {
    return existing;
  }

  runner.repeatedAnswers = normalizeRepeatedAnswersForEvent(event, [
    ...(runner.repeatedAnswers || []),
    {
      participantNumber,
      answers: {},
    },
  ]);

  return getRepeatAnswerEntry(runner, participantNumber);
}

function validateRepeatAnswers(event, answers) {
  const errors = {};
  const source = answers && typeof answers === "object" ? answers : {};

  for (const question of getRepeatQuestions(event)) {
    const message = validateQuestion(question, normalizeAnswerForQuestion(question, source[question.id]));
    if (message) {
      errors[question.id] = message;
    }
  }

  return errors;
}

function resolveNextPageId(event, currentPageId, answers) {
  const pageIndex = event.pages.findIndex((page) => page.id === currentPageId);
  const page = event.pages[pageIndex];
  if (!page) {
    return null;
  }

  for (const question of page.questions) {
    if (!supportsBranching(question.type)) {
      continue;
    }

    const value = answers[question.id];

    if (question.type === "multiChoice") {
      for (const option of question.options) {
        if (option.nextPageId && Array.isArray(value) && value.includes(option.id)) {
          return option.nextPageId === END_OF_FLOW ? null : option.nextPageId;
        }
      }
      continue;
    }

    const matched = question.options.find(
      (option) => option.id === value && option.nextPageId,
    );
    if (matched) {
      return matched.nextPageId === END_OF_FLOW ? null : matched.nextPageId;
    }
  }

  if (page.defaultNextPageId) {
    return page.defaultNextPageId === END_OF_FLOW ? null : page.defaultNextPageId;
  }

  return event.pages[pageIndex + 1]?.id || null;
}

function validateQuestion(question, answer) {
  const isEmpty =
    question.type === "multiChoice"
      ? !Array.isArray(answer) || answer.length === 0
      : answer == null || answer === "";

  if ((question.required || question.countsTowardCapacity) && isEmpty) {
    return `${question.label} 為必填欄位。`;
  }

  if (question.type === "email" && answer) {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(answer)) {
      return `${question.label} 需要填寫有效的 Email。`;
    }
  }

  if (question.type === "phone" && answer) {
    const phonePattern = /^[0-9+\-()#\s]{6,}$/;
    if (!phonePattern.test(answer)) {
      return `${question.label} 需要填寫有效的電話。`;
    }
  }

  if (question.type === "number" && answer !== "") {
    const parsed = Number.parseInt(answer, 10);
    if (!Number.isFinite(parsed)) {
      return `${question.label} 需要是數字。`;
    }
    if (question.countsTowardCapacity && parsed < 1) {
      return `${question.label} 至少要填 1。`;
    }
  }

  return "";
}

function validateCurrentPage(event, pageId, answers) {
  const page = event.pages.find((entry) => entry.id === pageId);
  const normalizedAnswers = normalizeAnswersForEvent(event, answers);
  const errors = {};

  if (!page) {
    return errors;
  }

  for (const question of page.questions) {
    const message = validateQuestion(question, normalizedAnswers[question.id]);
    if (message) {
      errors[question.id] = message;
    }
  }

  return errors;
}

function validateWholeFlow(event, answers) {
  const normalizedAnswers = normalizeAnswersForEvent(event, answers);
  const errors = [];
  const visitedPageIds = [];
  let currentPage = event.pages[0];
  let guard = 0;

  while (currentPage && guard < event.pages.length + 2 && !visitedPageIds.includes(currentPage.id)) {
    visitedPageIds.push(currentPage.id);
    for (const question of currentPage.questions) {
      const message = validateQuestion(question, normalizedAnswers[question.id]);
      if (message) {
        errors.push({
          pageId: currentPage.id,
          questionId: question.id,
          message,
        });
      }
    }

    const nextPageId = resolveNextPageId(event, currentPage.id, normalizedAnswers);
    currentPage = nextPageId ? event.pages.find((page) => page.id === nextPageId) || null : null;
    guard += 1;
  }

  return {
    ok: errors.length === 0,
    errors,
    visitedPageIds,
    answers: normalizedAnswers,
  };
}

function computeParticipantsFromAnswers(event, answers) {
  const normalizedAnswers = normalizeAnswersForEvent(event, answers);
  const trackedQuestions = event.pages
    .flatMap((page) => page.questions)
    .filter((question) => question.countsTowardCapacity);

  if (trackedQuestions.length === 0) {
    return 1;
  }

  const total = trackedQuestions.reduce((sum, question) => {
    return sum + (Number.parseInt(normalizedAnswers[question.id], 10) || 0);
  }, 0);

  return Math.max(1, total);
}

function cleanFlowReferences(event) {
  const pageIds = new Set(event.pages.map((page) => page.id));

  for (const page of event.pages) {
    if (page.defaultNextPageId && page.defaultNextPageId !== END_OF_FLOW && !pageIds.has(page.defaultNextPageId)) {
      page.defaultNextPageId = null;
    }

    for (const question of page.questions) {
      if (!supportsOptions(question.type)) {
        question.options = [];
        if (question.type !== "number") {
          question.countsTowardCapacity = false;
        }
        continue;
      }

      for (const option of question.options) {
        if (option.nextPageId && option.nextPageId !== END_OF_FLOW && !pageIds.has(option.nextPageId)) {
          option.nextPageId = null;
        }
      }
    }
  }
}

async function detectApiMode() {
  try {
    const response = await fetch(`${API_BASE}/events`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("remote events unavailable");
    }

    state.apiMode = "remote";
    state.storageSummary = {
      modeLabel: "Netlify Functions",
      detail: "目前使用伺服端 API 儲存資料，適合正式部署與多人共用。",
    };
    return;
  } catch {
    state.apiMode = "unavailable";
    state.storageSummary = {
      modeLabel: "伺服端未連線",
      detail: "目前無法連到 Netlify Functions 與伺服端儲存，網站不會退回本機模式。",
    };
  }
}

async function requestRemote(path, options) {
  const response = await fetch(`${API_BASE}/${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options?.headers || {}),
    },
  });

  const raw = await response.text();
  let payload = {};

  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = { error: raw };
    }
  }

  if (!response.ok || payload.ok === false) {
    if (response.status === 413) {
      throw new Error("儲存失敗：上傳內容太大，通常是封面圖片太大。請換小一點的圖片再試一次。");
    }

    throw new Error(payload.error || `遠端 API 發生錯誤（${response.status}）。`);
  }

  return payload;
}

const api = {
  async getPublicEvents() {
    return requestRemote("events", { method: "GET", headers: {} });
  },

  async adminLogin(password) {
    return requestRemote("admin", {
      method: "POST",
      body: JSON.stringify({
        action: "login",
        password,
      }),
    });
  },

  async adminSave(password, event) {
    return requestRemote("admin", {
      method: "POST",
      body: JSON.stringify({
        action: "save",
        password,
        event,
      }),
    });
  },

  async adminDelete(password, eventId) {
    return requestRemote("admin", {
      method: "POST",
      body: JSON.stringify({
        action: "delete",
        password,
        eventId,
      }),
    });
  },

  async submitRegistration(eventId, answers, repeatedAnswers = []) {
    return requestRemote("register", {
      method: "POST",
      body: JSON.stringify({
        eventId,
        answers,
        repeatedAnswers,
      }),
    });
  },
};

function setStorageSummaryFromAdmin(payload) {
  if (payload.storageMode === "netlify-blobs") {
    state.storageSummary = {
      modeLabel: "Netlify Blobs",
      detail: "活動資料與報名資料儲存在 Netlify 的伺服端儲存空間。",
    };
  } else {
    state.storageSummary = {
      modeLabel: "伺服端未就緒",
      detail: "目前沒有讀到可用的伺服端儲存。",
    };
  }
}

function getSelectedPublicEvent() {
  return state.public.events.find((event) => event.id === state.public.selectedEventId) || null;
}

function ensureRunnerForEvent(eventId) {
  const event = state.public.events.find((entry) => entry.id === eventId);
  if (!event) {
    state.public.runner = null;
    return;
  }

  if (state.public.runner?.eventId === eventId) {
    const pageExists = event.pages.some((page) => page.id === state.public.runner.currentPageId);
    if (pageExists) {
      return;
    }
  }

  state.public.runner = {
    eventId,
    currentPageId: event.pages[0]?.id || null,
    history: event.pages[0] ? [event.pages[0].id] : [],
    answers: {},
    errors: {},
    stage: "flow",
    repeatedAnswers: [],
    repeatErrors: {},
    repeatParticipantNumber: 2,
    finalParticipantCount: 1,
    submitting: false,
    submitted: false,
    success: null,
  };
}

function selectPublicEvent(eventId) {
  state.public.selectedEventId = eventId;
  ensureRunnerForEvent(eventId);
  dom.publicOverlay.classList.remove("hidden");
  dom.publicOverlay.setAttribute("aria-hidden", "false");
  renderPublic();
}

function closePublicEvent() {
  state.public.selectedEventId = null;
  state.public.runner = null;
  dom.publicOverlay.classList.add("hidden");
  dom.publicOverlay.setAttribute("aria-hidden", "true");
  renderPublic();
}

async function loadPublicEvents({ preserveSelection = true } = {}) {
  state.public.loading = true;
  state.public.error = "";
  renderPublic();

  try {
    const payload = await api.getPublicEvents();
    state.public.events = payload.events || [];

    if (!preserveSelection) {
      state.public.selectedEventId = null;
      state.public.runner = null;
    } else if (state.public.selectedEventId) {
      const stillExists = state.public.events.some((event) => event.id === state.public.selectedEventId);
      if (!stillExists) {
        state.public.selectedEventId = null;
        state.public.runner = null;
        dom.publicOverlay.classList.add("hidden");
        dom.publicOverlay.setAttribute("aria-hidden", "true");
      }
    }

    if (state.public.selectedEventId) {
      ensureRunnerForEvent(state.public.selectedEventId);
    }
  } catch (error) {
    state.public.events = [];
    state.public.selectedEventId = null;
    state.public.runner = null;
    state.public.error = error.message || "活動載入失敗。";
    showToast(state.public.error);
  } finally {
    state.public.loading = false;
    renderPublic();
  }
}

function renderEventList() {
  if (state.public.loading) {
    dom.eventList.innerHTML = `
      <div class="empty-state">
        <h3>載入中</h3>
      </div>
    `;
    return;
  }

  if (state.public.error) {
    dom.eventList.innerHTML = `
      <div class="empty-state">
        <h3>目前無法載入活動</h3>
        <p class="muted-text" style="margin-top: 8px;">${escapeHtml(state.public.error)}</p>
      </div>
    `;
    return;
  }

  if (state.public.events.length === 0) {
    dom.eventList.innerHTML = `
      <div class="empty-state">
        <h3>目前沒有可報名活動</h3>
      </div>
    `;
    return;
  }

  dom.eventList.innerHTML = state.public.events
    .map((event) => {
      const isSelected = event.id === state.public.selectedEventId;
      const remaining = event.remainingCapacity;
      const isFull = remaining === 0;
      const actionLabel = isFull ? "查看活動" : "立即報名";

      return `
        <article class="event-card ${isSelected ? "selected" : ""}" data-event-action="open" data-event-id="${event.id}">
          <div class="event-cover">
            ${
              event.coverImage
                ? `<img data-image-role="event-card" data-event-id="${event.id}" alt="${escapeHtml(event.title)} 封面" />`
                : ""
            }
            <div class="event-cover-content">
              <div class="chip-row event-card-chips">
                <span class="status-pill ${isFull ? "full" : "live"}">${isFull ? "名額已滿" : "可報名"}</span>
                <span class="meta-pill">${remaining == null ? "不限名額" : `剩餘 ${remaining} 人`}</span>
              </div>
              <h4 class="event-card-title">${escapeHtml(event.title)}</h4>
            </div>
          </div>
            <div class="event-card-body">
            ${event.description ? `<p class="event-description">${escapeHtml(event.description)}</p>` : ""}
            <div class="action-row event-card-footer">
              <button class="primary-button event-card-button" type="button" data-event-action="open" data-event-id="${event.id}">
                ${isSelected ? "開啟報名" : actionLabel}
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderInputField(question, value, error) {
  if (question.type === "longText") {
    return `
      <textarea class="textarea" data-public-question="${question.id}" placeholder="${escapeHtml(question.placeholder || "")}">${escapeHtml(value || "")}</textarea>
      ${error ? `<div class="question-error">${escapeHtml(error)}</div>` : ""}
    `;
  }

  if (question.type === "singleChoice") {
    return `
      <div class="radio-grid">
        ${question.options
          .map((option) => {
            const checked = value === option.id;
            return `
              <label class="option-chip ${checked ? "active" : ""}">
                <input type="radio" name="question_${question.id}" value="${option.id}" data-public-question="${question.id}" ${checked ? "checked" : ""} />
                <span>${escapeHtml(option.label)}</span>
              </label>
            `;
          })
          .join("")}
      </div>
      ${error ? `<div class="question-error">${escapeHtml(error)}</div>` : ""}
    `;
  }

  if (question.type === "multiChoice") {
    return `
      <div class="checkbox-grid">
        ${question.options
          .map((option) => {
            const checked = Array.isArray(value) && value.includes(option.id);
            return `
              <label class="option-chip ${checked ? "active" : ""}">
                <input type="checkbox" value="${option.id}" data-public-question="${question.id}" ${checked ? "checked" : ""} />
                <span>${escapeHtml(option.label)}</span>
              </label>
            `;
          })
          .join("")}
      </div>
      ${error ? `<div class="question-error">${escapeHtml(error)}</div>` : ""}
    `;
  }

  if (question.type === "dropdown") {
    return `
      <select class="select" data-public-question="${question.id}">
        <option value="">請選擇</option>
        ${question.options
          .map(
            (option) =>
              `<option value="${option.id}" ${value === option.id ? "selected" : ""}>${escapeHtml(option.label)}</option>`,
          )
          .join("")}
      </select>
      ${error ? `<div class="question-error">${escapeHtml(error)}</div>` : ""}
    `;
  }

  const typeMap = {
    shortText: "text",
    email: "email",
    phone: "tel",
    number: "number",
    date: "date",
  };

  return `
    <input
      class="input"
      type="${typeMap[question.type] || "text"}"
      data-public-question="${question.id}"
      value="${escapeHtml(value || "")}"
      placeholder="${escapeHtml(question.placeholder || "")}"
    />
    ${error ? `<div class="question-error">${escapeHtml(error)}</div>` : ""}
  `;
}

function renderPublicDetail() {
  const event = getSelectedPublicEvent();

  if (!event) {
    dom.publicDetail.innerHTML = "";
    return;
  }

  ensureRunnerForEvent(event.id);
  const runner = state.public.runner;
  const repeatQuestions = getRepeatQuestions(event);

  if (runner?.submitted) {
    dom.publicDetail.innerHTML = `
      <div class="registration-shell">
        <div class="registration-cover">
          ${event.coverImage ? `<img data-image-role="public-detail" data-event-id="${event.id}" alt="${escapeHtml(event.title)} 封面" />` : ""}
        </div>
        <h3>${escapeHtml(event.title)}</h3>
        <div class="meta-row" style="margin-top: 16px;">
          <span class="status-pill live">報名完成</span>
          <span class="meta-pill">${runner.success?.totalParticipants || 1} 人</span>
          ${
            runner.success?.summary?.remainingCapacity == null
              ? ""
              : `<span class="meta-pill">剩餘 ${runner.success.summary.remainingCapacity} 人</span>`
          }
        </div>
        <div class="action-row" style="margin-top: 24px;">
          <button class="secondary-button" type="button" data-public-action="restart">
            再填一張報名單
          </button>
          <button class="text-button" type="button" data-public-action="close">
            關閉
          </button>
        </div>
      </div>
    `;
    return;
  }

  const isFull = event.remainingCapacity === 0;

  if (runner?.stage === "repeat") {
    const totalParticipants = Math.max(2, runner.finalParticipantCount || 2);
    const currentEntry = ensureRepeatAnswerEntry(event, runner, runner.repeatParticipantNumber);
    const repeatProgress =
      totalParticipants <= 1
        ? 100
        : ((runner.repeatParticipantNumber - 1) / (totalParticipants - 1)) * 100;
    const isFinalRepeatParticipant = runner.repeatParticipantNumber >= totalParticipants;

    dom.publicDetail.innerHTML = `
      <div class="registration-shell">
        <div class="registration-cover">
          ${event.coverImage ? `<img data-image-role="public-detail" data-event-id="${event.id}" alt="${escapeHtml(event.title)} 封面" />` : ""}
        </div>
        <div class="chip-row">
          <span class="status-pill ${isFull ? "full" : "live"}">${isFull ? "名額已滿" : "開放報名"}</span>
          ${
            event.remainingCapacity == null
              ? ""
              : `<span class="meta-pill">剩餘 ${event.remainingCapacity} 人</span>`
          }
        </div>
        <h3 style="margin-top: 14px;">${escapeHtml(event.title)}</h3>
        <div class="progress-track">
          <div class="progress-bar" style="width: ${repeatProgress}%"></div>
        </div>
        <div class="meta-row">
          <span class="meta-pill">同行資料</span>
          <span class="meta-pill">第 ${runner.repeatParticipantNumber} 位 / 共 ${totalParticipants} 位</span>
        </div>
        ${
          isFull
            ? `<div class="empty-state" style="margin-top: 20px;"><h3>這個活動目前已額滿</h3></div>`
            : `
              ${repeatQuestions
                .map((question) => {
                  const value = currentEntry?.answers?.[question.id];
                  const error = runner.repeatErrors?.[question.id];
                  return `
                    <div class="question-block">
                      <div class="question-label">
                        <span>${escapeHtml(question.label)}</span>
                        ${question.required ? `<span class="required-badge">*</span>` : ""}
                      </div>
                      ${question.helpText ? `<p class="field-help">${nl2br(question.helpText)}</p>` : ""}
                      <div style="margin-top: 12px;">
                        ${renderInputField(question, value, error)}
                      </div>
                    </div>
                  `;
                })
                .join("")}
              <div class="action-row" style="margin-top: 24px;">
                <button class="secondary-button" type="button" data-public-action="prev">上一位</button>
                <button class="primary-button" type="button" data-public-action="submit" ${runner.submitting ? "disabled" : ""}>
                  ${
                    runner.submitting
                      ? "送出中..."
                      : isFinalRepeatParticipant
                        ? "送出報名"
                        : "下一位同行"
                  }
                </button>
                <button class="text-button" type="button" data-public-action="restart">重新開始</button>
                <button class="text-button" type="button" data-public-action="close">關閉</button>
              </div>
            `
        }
      </div>
    `;
    return;
  }

  const currentPageIndex = Math.max(
    0,
    event.pages.findIndex((page) => page.id === runner.currentPageId),
  );
  const currentPage = event.pages[currentPageIndex];
  const progress = event.pages.length
    ? ((currentPageIndex + 1) / event.pages.length) * 100
    : 0;
  const isFinalPage = !resolveNextPageId(event, currentPage.id, normalizeAnswersForEvent(event, runner.answers));
  const needsRepeatedQuestions =
    isFinalPage &&
    computeParticipantsFromAnswers(event, runner.answers) > 1 &&
    repeatQuestions.length > 0;

  dom.publicDetail.innerHTML = `
    <div class="registration-shell">
      <div class="registration-cover">
        ${event.coverImage ? `<img data-image-role="public-detail" data-event-id="${event.id}" alt="${escapeHtml(event.title)} 封面" />` : ""}
      </div>
      <div class="chip-row">
        <span class="status-pill ${isFull ? "full" : "live"}">${isFull ? "名額已滿" : "開放報名"}</span>
        ${
          event.remainingCapacity == null
            ? ""
            : `<span class="meta-pill">剩餘 ${event.remainingCapacity} 人</span>`
        }
      </div>
      <h3 style="margin-top: 14px;">${escapeHtml(event.title)}</h3>
      ${event.description ? `<p class="event-description-inline">${nl2br(event.description)}</p>` : ""}
      <div class="progress-track">
        <div class="progress-bar" style="width: ${progress}%"></div>
      </div>
      <div class="meta-row">
        <span class="meta-pill">${currentPageIndex + 1} / ${event.pages.length}</span>
        <span class="meta-pill">${escapeHtml(currentPage.title)}</span>
      </div>
      ${
        currentPage.description
          ? `<p class="page-description" style="margin-top: 12px;">${nl2br(currentPage.description)}</p>`
          : ""
      }
      ${
        isFull
          ? `<div class="empty-state" style="margin-top: 20px;"><h3>這個活動目前已額滿</h3></div>`
          : `
            ${(currentPage.questions || [])
              .map((question) => {
                const value = runner.answers[question.id];
                const error = runner.errors?.[question.id];
                return `
                  <div class="question-block">
                    <div class="question-label">
                      <span>${escapeHtml(question.label)}</span>
                      ${question.required ? `<span class="required-badge">*</span>` : ""}
                    </div>
                    ${question.helpText ? `<p class="field-help">${nl2br(question.helpText)}</p>` : ""}
                    <div style="margin-top: 12px;">
                      ${renderInputField(question, value, error)}
                    </div>
                  </div>
                `;
              })
              .join("")}
            <div class="action-row" style="margin-top: 24px;">
              ${
                runner.history.length > 1
                  ? `<button class="secondary-button" type="button" data-public-action="prev">上一頁</button>`
                  : ""
              }
              <button class="primary-button" type="button" data-public-action="${isFinalPage ? "submit" : "next"}" ${runner.submitting ? "disabled" : ""}>
                ${
                  runner.submitting
                    ? "送出中..."
                    : isFinalPage
                      ? needsRepeatedQuestions
                        ? "下一位同行"
                        : "送出報名"
                      : "下一頁"
                }
              </button>
              <button class="text-button" type="button" data-public-action="restart">重新開始</button>
              <button class="text-button" type="button" data-public-action="close">關閉</button>
            </div>
          `
      }
    </div>
  `;
}

function renderPublic() {
  renderEventList();
  renderPublicDetail();
  hydratePublicImages();
}

function hydratePublicImages() {
  const imageNodes = document.querySelectorAll("[data-image-role][data-event-id]");

  for (const node of imageNodes) {
    if (!(node instanceof HTMLImageElement)) {
      continue;
    }

    const eventId = node.dataset.eventId;
    const event = state.public.events.find((entry) => entry.id === eventId);
    if (!event?.coverImage) {
      continue;
    }

    if (node.src !== event.coverImage) {
      node.src = event.coverImage;
    }
  }
}

function renderAdminLogin() {
  dom.adminRoot.innerHTML = `
    <div class="login-card">
      <p class="section-eyebrow">密碼登入</p>
      <h3>輸入後台密碼</h3>
      <p class="muted-text" style="margin-top: 8px;">
        輸入密碼後即可管理活動與報名表單。
      </p>
      <form id="admin-login-form" style="margin-top: 18px;" class="field-grid">
        <div class="field">
          <label for="admin-password-input">後台密碼</label>
          <input id="admin-password-input" class="input" type="password" autocomplete="current-password" value="${escapeHtml(state.admin.password)}" />
        </div>
        ${
          state.admin.loginError
            ? `<div class="question-error">${escapeHtml(state.admin.loginError)}</div>`
            : ""
        }
        <div class="action-row">
          <button class="primary-button" type="submit">登入後台</button>
        </div>
      </form>
    </div>
  `;
}

function getBranchTargetOptions(event, currentPageId, includeDefaultOption) {
  const options = includeDefaultOption
    ? [{ id: "", label: "依照頁面預設流程" }]
    : [{ id: "", label: "下一頁 / 沒有就送出" }];

  options.push({ id: END_OF_FLOW, label: "直接結束報名" });

  for (const page of event.pages) {
    if (page.id === currentPageId) {
      continue;
    }
    options.push({
      id: page.id,
      label: page.title || "未命名頁面",
    });
  }

  return options;
}

function renderSelectOptions(options, selectedValue) {
  return options
    .map(
      (option) =>
        `<option value="${option.id}" ${selectedValue === option.id ? "selected" : ""}>${escapeHtml(option.label)}</option>`,
    )
    .join("");
}

function renderOptionRow(event, pageId, questionId, option) {
  const options = getBranchTargetOptions(event, pageId, true);
  return `
    <div class="option-row">
      <input
        class="input"
        type="text"
        value="${escapeHtml(option.label)}"
        data-option-id="${option.id}"
        data-question-id="${questionId}"
        data-option-field="label"
      />
      <select
        class="select"
        data-option-id="${option.id}"
        data-question-id="${questionId}"
        data-option-field="nextPageId"
      >
        ${renderSelectOptions(options, option.nextPageId || "")}
      </select>
      <button class="text-button" type="button" data-admin-action="delete-option" data-question-id="${questionId}" data-option-id="${option.id}">
        刪除
      </button>
    </div>
  `;
}

function isPageCollapsed(pageId) {
  return Boolean(state.admin.collapsedPages?.[pageId]);
}

function isQuestionCollapsed(questionId) {
  return Boolean(state.admin.collapsedQuestions?.[questionId]);
}

function renderQuestionEditor(event, page, question, questionIndex) {
  const canUseOptions = supportsOptions(question.type);
  const branchNote =
    question.type === "multiChoice"
      ? "複選跳頁時，系統會依照選項順序找第一個有設定目標頁的選項。"
      : "你可以直接把某個選項導向指定頁面。";
  const collapsed = isQuestionCollapsed(question.id);

  return `
    <div class="question-card">
      <div class="question-card-header">
        <div>
          <div class="question-count">欄位 ${questionIndex + 1}</div>
          <h4>${escapeHtml(question.label || "未命名欄位")}</h4>
          <div class="chip-row compact-row">
            <span class="meta-pill">${escapeHtml(getQuestionTypeLabel(question.type))}</span>
            ${question.required ? `<span class="meta-pill">必填</span>` : ""}
            ${question.countsTowardCapacity ? `<span class="meta-pill">計入人數</span>` : ""}
            ${question.repeatForAdditionalParticipants ? `<span class="meta-pill">多人重問</span>` : ""}
          </div>
        </div>
        <div class="action-row">
          <button class="pill-button" type="button" data-admin-action="toggle-question" data-question-id="${question.id}">
            ${collapsed ? "展開" : "收起"}
          </button>
          <button class="pill-button" type="button" data-admin-action="move-question-up" data-page-id="${page.id}" data-question-id="${question.id}">上移</button>
          <button class="pill-button" type="button" data-admin-action="move-question-down" data-page-id="${page.id}" data-question-id="${question.id}">下移</button>
          <button class="danger-button" type="button" data-admin-action="delete-question" data-page-id="${page.id}" data-question-id="${question.id}">刪除欄位</button>
        </div>
      </div>

      ${
        collapsed
          ? ""
          : `
      <div class="field-grid two">
        <div class="field">
          <label>欄位名稱</label>
          <input class="input" type="text" value="${escapeHtml(question.label)}" data-question-id="${question.id}" data-question-field="label" />
        </div>
        <div class="field">
          <label>題型</label>
          <select class="select" data-question-id="${question.id}" data-question-field="type">
            ${QUESTION_TYPE_OPTIONS.map(
              (option) =>
                `<option value="${option.value}" ${question.type === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`,
            ).join("")}
          </select>
        </div>
      </div>

      <div class="field-grid two">
        <div class="field">
          <label>欄位說明</label>
          <textarea class="textarea" data-question-id="${question.id}" data-question-field="helpText">${escapeHtml(question.helpText)}</textarea>
        </div>
        <div class="field">
          <label>Placeholder / 提示文字</label>
          <textarea class="textarea" data-question-id="${question.id}" data-question-field="placeholder">${escapeHtml(question.placeholder)}</textarea>
        </div>
      </div>

      <div class="settings-row" style="margin-top: 12px;">
        <label class="inline-checkbox">
          <input type="checkbox" data-question-id="${question.id}" data-question-field="required" ${question.required ? "checked" : ""} />
          <span>必填</span>
        </label>
        <label class="inline-checkbox">
          <input type="checkbox" data-question-id="${question.id}" data-question-field="repeatForAdditionalParticipants" ${question.repeatForAdditionalParticipants ? "checked" : ""} />
          <span>多人報名時，對每位同行都再問這題</span>
        </label>
        ${
          question.type === "number"
            ? `
              <label class="inline-checkbox">
                <input type="checkbox" data-question-id="${question.id}" data-question-field="countsTowardCapacity" ${question.countsTowardCapacity ? "checked" : ""} />
                <span>把這題計入總報名人數</span>
              </label>
            `
            : ""
        }
      </div>

      ${
        canUseOptions
          ? `
            <div class="subtle-divider"></div>
            <div class="split-row">
              <div>
                <h4>選項與跳頁邏輯</h4>
                <p class="field-inline-help">${escapeHtml(branchNote)}</p>
              </div>
              <button class="secondary-button" type="button" data-admin-action="add-option" data-page-id="${page.id}" data-question-id="${question.id}">
                新增選項
              </button>
            </div>
            <div class="option-list" style="margin-top: 14px;">
              ${question.options.map((option) => renderOptionRow(event, page.id, question.id, option)).join("")}
            </div>
          `
          : ""
      }
      `
      }
    </div>
  `;
}

function renderPageEditor(event, page, pageIndex) {
  const nextTargets = getBranchTargetOptions(event, page.id, false);
  const collapsed = isPageCollapsed(page.id);

  return `
    <section class="page-card">
      <div class="page-card-header">
        <div>
          <div class="page-count">頁面 ${pageIndex + 1}</div>
          <h3>${escapeHtml(page.title || "未命名頁面")}</h3>
          <div class="chip-row compact-row">
            <span class="meta-pill">${page.questions.length} 個欄位</span>
            ${page.defaultNextPageId ? `<span class="meta-pill">已設定預設跳轉</span>` : ""}
          </div>
        </div>
        <div class="action-row">
          <button class="pill-button" type="button" data-admin-action="toggle-page" data-page-id="${page.id}">
            ${collapsed ? "展開" : "收起"}
          </button>
          <button class="pill-button" type="button" data-admin-action="move-page-up" data-page-id="${page.id}">上移</button>
          <button class="pill-button" type="button" data-admin-action="move-page-down" data-page-id="${page.id}">下移</button>
          <button class="danger-button" type="button" data-admin-action="delete-page" data-page-id="${page.id}">刪除頁面</button>
        </div>
      </div>

      ${
        collapsed
          ? ""
          : `
      <div class="field-grid two">
        <div class="field">
          <label>頁面標題</label>
          <input class="input" type="text" value="${escapeHtml(page.title)}" data-page-id="${page.id}" data-page-field="title" />
        </div>
        <div class="field">
          <label>預設下一步</label>
          <select class="select" data-page-id="${page.id}" data-page-field="defaultNextPageId">
            ${renderSelectOptions(nextTargets, page.defaultNextPageId || "")}
          </select>
        </div>
      </div>

      <div class="field">
        <label>頁面說明</label>
        <textarea class="textarea" data-page-id="${page.id}" data-page-field="description">${escapeHtml(page.description)}</textarea>
      </div>

      <div class="subtle-divider"></div>
      <div class="question-list" style="margin-top: 16px;">
        ${
          page.questions.length
            ? page.questions.map((question, index) => renderQuestionEditor(event, page, question, index)).join("")
            : `<div class="empty-state"><h4>這頁還沒有欄位</h4><p class="muted-text">你可以把它當成純說明頁，或新增欄位讓使用者填寫。</p></div>`
        }
      </div>
      <div class="action-row page-footer-actions">
        <button class="secondary-button" type="button" data-admin-action="add-question" data-page-id="${page.id}">
          新增欄位
        </button>
      </div>
      `
      }
    </section>
  `;
}

function getSubmissionColumns(event) {
  const questions = [];
  const labelCount = new Map();
  const highestParticipantCount = Math.max(
    1,
    ...(event.submissions || []).map((submission) => submission.totalParticipants || 1),
  );

  for (const page of event.pages) {
    for (const question of page.questions) {
      const label = question.label || "未命名欄位";
      labelCount.set(label, (labelCount.get(label) || 0) + 1);
      questions.push({
        pageTitle: page.title || "未命名頁面",
        question,
      });
    }
  }

  const baseColumns = questions.map((entry) => {
    const label = entry.question.label || "未命名欄位";
    return {
      ...entry,
      header:
        (labelCount.get(label) || 0) > 1
          ? `${entry.pageTitle} / ${label}`
          : label,
    };
  });

  const repeatedQuestionIds = new Set(
    (event.submissions || []).flatMap((submission) =>
      (submission.repeatedAnswers || []).flatMap((entry) => Object.keys(entry.answers || {})),
    ),
  );
  const repeatedBaseColumns = baseColumns.filter(
    (entry) =>
      entry.question.repeatForAdditionalParticipants || repeatedQuestionIds.has(entry.question.id),
  );
  const repeatedColumns = [];

  for (let participantNumber = 2; participantNumber <= highestParticipantCount; participantNumber += 1) {
    for (const entry of repeatedBaseColumns) {
      repeatedColumns.push({
        ...entry,
        participantNumber,
        header: `第 ${participantNumber} 位 / ${entry.header}`,
      });
    }
  }

  return [...baseColumns, ...repeatedColumns];
}

function formatSubmissionAnswer(question, answer) {
  if (question.type === "multiChoice") {
    if (!Array.isArray(answer) || answer.length === 0) {
      return "";
    }

    const labels = answer
      .map((value) => question.options.find((option) => option.id === value)?.label || value)
      .filter(Boolean);
    return labels.join("、");
  }

  if (supportsOptions(question.type)) {
    if (!answer) {
      return "";
    }

    return question.options.find((option) => option.id === answer)?.label || String(answer);
  }

  if (answer == null) {
    return "";
  }

  return String(answer);
}

function getSubmissionRows(event) {
  const columns = getSubmissionColumns(event);
  const rows = [...(event.submissions || [])]
    .sort((left, right) => String(right.submittedAt).localeCompare(String(left.submittedAt)))
    .map((submission, index) => {
      const visitedPages = (submission.visitedPageIds || [])
        .map((pageId) => event.pages.find((page) => page.id === pageId)?.title || "未命名頁面")
        .join(" -> ");

      return {
        index: index + 1,
        submittedAt: formatDate(submission.submittedAt),
        totalParticipants: submission.totalParticipants,
        visitedPages,
        answers: columns.map((column) => {
          if (column.participantNumber) {
            const repeatedEntry = (submission.repeatedAnswers || []).find(
              (entry) => entry.participantNumber === column.participantNumber,
            );
            return formatSubmissionAnswer(
              column.question,
              repeatedEntry?.answers?.[column.question.id],
            );
          }

          return formatSubmissionAnswer(column.question, submission.answers?.[column.question.id]);
        }),
      };
    });

  return { columns, rows };
}

function renderSubmissionTable(event) {
  const { columns, rows } = getSubmissionRows(event);

  return `
    <div class="submission-table-wrap">
      <table class="submission-table">
        <thead>
          <tr>
            <th>#</th>
            <th>送出時間</th>
            <th>報名人數</th>
            <th>經過頁面</th>
            ${columns.map((column) => `<th>${escapeHtml(column.header)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>
                  <td>${row.index}</td>
                  <td>${escapeHtml(row.submittedAt)}</td>
                  <td>${row.totalParticipants}</td>
                  <td>${escapeHtml(row.visitedPages || "-")}</td>
                  ${row.answers
                    .map((answer) => `<td>${nl2br(answer || "-")}</td>`)
                    .join("")}
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function sanitizeFilename(value) {
  return String(value || "活動")
    .replace(/[\\/:*?"<>|]/g, "-")
    .trim() || "活動";
}

function exportSubmissionsToExcel() {
  const event = state.admin.draft;
  if (!event || !event.submissions?.length) {
    showToast("目前沒有可匯出的報名資料。");
    return;
  }

  const { columns, rows } = getSubmissionRows(event);
  const html = `
    <!DOCTYPE html>
    <html lang="zh-Hant">
      <head>
        <meta charset="UTF-8" />
      </head>
      <body>
        <table border="1">
          <thead>
            <tr>
              <th>#</th>
              <th>送出時間</th>
              <th>報名人數</th>
              <th>經過頁面</th>
              ${columns.map((column) => `<th>${escapeHtml(column.header)}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (row) => `
                  <tr>
                    <td>${row.index}</td>
                    <td>${escapeHtml(row.submittedAt)}</td>
                    <td>${row.totalParticipants}</td>
                    <td>${escapeHtml(row.visitedPages || "-")}</td>
                    ${row.answers
                      .map((answer) => `<td>${nl2br(answer || "-")}</td>`)
                      .join("")}
                  </tr>
                `,
              )
              .join("")}
          </tbody>
        </table>
      </body>
    </html>
  `;

  const blob = new Blob([`\ufeff${html}`], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeFilename(event.title)}-報名資料.xls`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("報名資料已匯出。");
}

function renderAdminEditor() {
  const draft = state.admin.draft;
  if (!draft) {
    return `
      <div class="editor-card">
        <div class="section-header">
          <h3>目前還沒有活動</h3>
          <div class="action-row">
            <button class="secondary-button" type="button" data-admin-action="new-event">新增活動</button>
            <button class="text-button" type="button" data-admin-action="logout">登出</button>
          </div>
        </div>
        <div class="empty-state">
          <h4>先建立第一個活動</h4>
          <p class="muted-text">建立後就能設定封面、欄位、頁面跳轉邏輯與總人數上限。</p>
        </div>
      </div>
    `;
  }

  const sidebarEvents = state.admin.events.some((event) => event.id === draft.id)
    ? state.admin.events
    : [sanitizeEventForAdmin(draft), ...state.admin.events];

  return `
    <div class="admin-layout admin-layout-simple">
      <div class="admin-editor admin-editor-single">
        <div class="editor-card admin-toolbar-card">
          <div class="section-header">
            <h3>${escapeHtml(draft.title)}</h3>
            <div class="action-row">
              ${state.admin.dirty ? `<span class="logic-pill">尚未儲存</span>` : `<span class="meta-pill">已同步</span>`}
              <button class="secondary-button" type="button" data-admin-action="save-event" ${state.admin.saving ? "disabled" : ""}>
                ${state.admin.saving ? "儲存中..." : "儲存"}
              </button>
              <button class="secondary-button" type="button" data-admin-action="duplicate-event">複製副本</button>
              <button class="secondary-button" type="button" data-admin-action="new-event">新增活動</button>
              <button class="danger-button" type="button" data-admin-action="delete-event" ${state.admin.deleting ? "disabled" : ""}>
                ${state.admin.deleting ? "刪除中..." : "刪除"}
              </button>
              <button class="text-button" type="button" data-admin-action="logout">登出</button>
            </div>
          </div>
          <div class="admin-event-strip">
            ${sidebarEvents
              .map((event) => {
                const isActive = event.id === state.admin.selectedEventId;
                return `
                  <button class="admin-event-pill ${isActive ? "active" : ""}" type="button" data-admin-action="select-event" data-event-id="${event.id}">
                    <span>${escapeHtml(event.title)}</span>
                    <span class="admin-event-pill-meta">${event.status === "published" ? "已發布" : "草稿"}</span>
                  </button>
                `;
              })
              .join("")}
          </div>
        </div>

        <div class="editor-card">
          <div class="field-grid two">
            <div class="field">
              <label>活動名稱</label>
              <input class="input" type="text" value="${escapeHtml(draft.title)}" data-event-field="title" />
            </div>
            <div class="field">
              <label>活動狀態</label>
              <select class="select" data-event-field="status">
                <option value="published" ${draft.status === "published" ? "selected" : ""}>已發布</option>
                <option value="draft" ${draft.status === "draft" ? "selected" : ""}>草稿</option>
              </select>
            </div>
          </div>

          <div class="field-grid two">
            <div class="field">
              <label>名額上限</label>
              <input class="input" type="number" min="1" value="${escapeHtml(draft.capacity ?? "")}" data-event-field="capacity" placeholder="留空代表不限名額" />
            </div>
            <div class="field">
              <label>目前統計</label>
              <div class="meta-row" style="padding-top: 10px;">
                <span class="meta-pill">${draft.submissions.length} 份</span>
                <span class="meta-pill">${computeUsedCapacity(draft)} 人</span>
                <span class="meta-pill">${draft.capacity == null ? "不限名額" : `剩餘 ${computeRemainingCapacity(draft)} 人`}</span>
              </div>
            </div>
          </div>

          <div class="field">
            <label>活動說明</label>
            <textarea class="textarea" data-event-field="description">${escapeHtml(draft.description)}</textarea>
          </div>

          <div class="subtle-divider"></div>

          <div class="field-grid two admin-media-grid">
            <div class="field">
              <label>封面圖片</label>
              <div class="action-row">
                <input id="cover-upload-input" type="file" accept="image/*" />
                ${
                  draft.coverImage
                    ? `<button class="text-button" type="button" data-admin-action="remove-cover">移除</button>`
                    : ""
                }
              </div>
            </div>
            <div class="cover-preview compact-cover">
              ${draft.coverImage ? `<img src="${draft.coverImage}" alt="${escapeHtml(draft.title)} 封面預覽" />` : ""}
            </div>
          </div>
        </div>

        <div class="editor-card">
          <div class="section-header">
            <h3>頁面與欄位</h3>
            <button class="secondary-button" type="button" data-admin-action="add-page">新增頁面</button>
          </div>
          <div class="page-list">
            ${draft.pages.map((page, index) => renderPageEditor(draft, page, index)).join("")}
          </div>
        </div>

        <div class="editor-card">
          <div class="section-header">
            <h3>報名資料</h3>
            ${
              draft.submissions.length
                ? `<button class="secondary-button" type="button" data-admin-action="export-submissions">匯出 Excel</button>`
                : ""
            }
          </div>
          ${
            draft.submissions.length
              ? renderSubmissionTable(draft)
              : `<div class="empty-state"><h4>尚未有人報名</h4></div>`
          }
        </div>
      </div>
    </div>
  `;
}

function renderAdmin() {
  if (!state.admin.open) {
    return;
  }

  if (!state.admin.authenticated) {
    renderAdminLogin();
    return;
  }

  dom.adminRoot.innerHTML = renderAdminEditor();
}

function openAdmin() {
  state.admin.open = true;
  dom.adminOverlay.classList.remove("hidden");
  dom.adminOverlay.setAttribute("aria-hidden", "false");
  renderAdmin();
}

function closeAdmin() {
  state.admin.open = false;
  dom.adminOverlay.classList.add("hidden");
  dom.adminOverlay.setAttribute("aria-hidden", "true");
}

function showToast(message) {
  clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.add("visible");
  toastTimer = window.setTimeout(() => {
    dom.toast.classList.remove("visible");
  }, 2600);
}

async function loginAdmin(password) {
  state.admin.loginError = "";
  renderAdmin();

  try {
    const payload = await api.adminLogin(password);
    state.admin.authenticated = true;
    state.admin.password = password;
    state.admin.events = payload.events || [];
    state.admin.selectedEventId = state.admin.events[0]?.id || null;
    state.admin.draft = state.admin.events[0] ? normalizeEvent(state.admin.events[0]) : null;
    state.admin.dirty = false;
    state.admin.usingDefaultPassword = Boolean(payload.usingDefaultPassword);
    state.admin.collapsedPages = {};
    state.admin.collapsedQuestions = {};
    setStorageSummaryFromAdmin(payload);
    renderPublic();
    renderAdmin();
  } catch (error) {
    state.admin.loginError = error.message || "登入失敗。";
    renderAdmin();
  }
}

function logoutAdmin() {
  state.admin = {
    ...state.admin,
    authenticated: false,
    password: "",
    events: [],
    draft: null,
    selectedEventId: null,
    dirty: false,
    usingDefaultPassword: false,
    loginError: "",
    collapsedPages: {},
    collapsedQuestions: {},
  };
  renderAdmin();
}

function markDraftDirty(shouldRender = true) {
  if (!state.admin.draft) {
    return;
  }

  state.admin.draft.updatedAt = new Date().toISOString();
  state.admin.dirty = true;
  cleanFlowReferences(state.admin.draft);
  if (shouldRender) {
    renderAdmin();
  }
}

function toggleAdminCollapsed(collectionName, id) {
  const current = Boolean(state.admin[collectionName]?.[id]);
  state.admin[collectionName] = {
    ...state.admin[collectionName],
    [id]: !current,
  };
  renderAdmin();
}

function findPage(pageId) {
  return state.admin.draft?.pages.find((page) => page.id === pageId) || null;
}

function findQuestion(questionId) {
  if (!state.admin.draft) {
    return { page: null, question: null };
  }

  for (const page of state.admin.draft.pages) {
    const question = page.questions.find((entry) => entry.id === questionId);
    if (question) {
      return { page, question };
    }
  }

  return { page: null, question: null };
}

function findOption(questionId, optionId) {
  const { question } = findQuestion(questionId);
  if (!question) {
    return null;
  }

  return question.options.find((option) => option.id === optionId) || null;
}

async function saveDraft() {
  if (!state.admin.draft) {
    return;
  }

  state.admin.saving = true;
  renderAdmin();

  try {
    const payload = await api.adminSave(state.admin.password, normalizeEvent(state.admin.draft));
    state.admin.events = payload.events || [];
    const savedEvent = payload.event || state.admin.events.find((event) => event.id === state.admin.draft.id);
    state.admin.selectedEventId = savedEvent?.id || state.admin.events[0]?.id || null;
    state.admin.draft = savedEvent ? normalizeEvent(savedEvent) : null;
    state.admin.dirty = false;
    state.admin.usingDefaultPassword = Boolean(payload.usingDefaultPassword);
    setStorageSummaryFromAdmin(payload);
    await loadPublicEvents();
    showToast("活動已儲存。");
  } catch (error) {
    showToast(error.message || "儲存失敗。");
  } finally {
    state.admin.saving = false;
    renderAdmin();
  }
}

async function deleteSelectedEvent() {
  const eventId = state.admin.selectedEventId;
  if (!eventId || !window.confirm("確定要刪除這個活動嗎？")) {
    return;
  }

  state.admin.deleting = true;
  renderAdmin();

  try {
    const payload = await api.adminDelete(state.admin.password, eventId);
    state.admin.events = payload.events || [];
    state.admin.selectedEventId = state.admin.events[0]?.id || null;
    state.admin.draft = state.admin.events[0] ? normalizeEvent(state.admin.events[0]) : null;
    state.admin.dirty = false;
    state.admin.usingDefaultPassword = Boolean(payload.usingDefaultPassword);
    setStorageSummaryFromAdmin(payload);
    await loadPublicEvents({ preserveSelection: false });
    showToast("活動已刪除。");
  } catch (error) {
    showToast(error.message || "刪除失敗。");
  } finally {
    state.admin.deleting = false;
    renderAdmin();
  }
}

function selectAdminEvent(eventId) {
  if (state.admin.dirty) {
    const confirmed = window.confirm("目前有未儲存的變更，切換活動會放棄這些修改。要繼續嗎？");
    if (!confirmed) {
      return;
    }
  }

  const selected =
    state.admin.events.find((event) => event.id === eventId) ||
    (state.admin.draft?.id === eventId ? state.admin.draft : null);
  state.admin.selectedEventId = selected?.id || null;
  state.admin.draft = selected ? normalizeEvent(selected) : null;
  state.admin.dirty = false;
  state.admin.collapsedPages = {};
  state.admin.collapsedQuestions = {};
  renderAdmin();
}

function createNewAdminEvent() {
  if (state.admin.dirty) {
    const confirmed = window.confirm("目前有未儲存的變更，建立新活動會放棄目前修改。要繼續嗎？");
    if (!confirmed) {
      return;
    }
  }

  const event = createEmptyEvent();
  state.admin.selectedEventId = event.id;
  state.admin.draft = event;
  state.admin.dirty = true;
  state.admin.collapsedPages = {};
  state.admin.collapsedQuestions = {};
  renderAdmin();
  showToast("已建立新活動草稿。");
}

function duplicateEventStructure(sourceEvent) {
  const source = normalizeEvent(sourceEvent);
  const pageIdMap = new Map();

  for (const page of source.pages) {
    pageIdMap.set(page.id, createId("page"));
  }

  const duplicatedPages = source.pages.map((page) => {
    return {
      ...page,
      id: pageIdMap.get(page.id),
      defaultNextPageId:
        page.defaultNextPageId && pageIdMap.has(page.defaultNextPageId)
          ? pageIdMap.get(page.defaultNextPageId)
          : page.defaultNextPageId === END_OF_FLOW
            ? END_OF_FLOW
            : null,
      questions: page.questions.map((question) => {
        return {
          ...question,
          id: createId("question"),
          options: question.options.map((option) => ({
            ...option,
            id: createId("option"),
            nextPageId:
              option.nextPageId && pageIdMap.has(option.nextPageId)
                ? pageIdMap.get(option.nextPageId)
                : option.nextPageId === END_OF_FLOW
                  ? END_OF_FLOW
                  : null,
          })),
        };
      }),
    };
  });

  const duplicateTitle = source.title.includes("副本") ? source.title : `${source.title} 副本`;

  return normalizeEvent({
    ...source,
    id: createId("event"),
    title: duplicateTitle,
    status: "draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pages: duplicatedPages,
    submissions: [],
  });
}

function duplicateCurrentAdminEvent() {
  if (!state.admin.draft) {
    return;
  }

  const duplicatedEvent = duplicateEventStructure(state.admin.draft);
  state.admin.selectedEventId = duplicatedEvent.id;
  state.admin.draft = duplicatedEvent;
  state.admin.dirty = true;
  state.admin.collapsedPages = {};
  state.admin.collapsedQuestions = {};
  renderAdmin();
  showToast("已複製活動副本，可直接改成下一個活動。");
}

function moveItem(list, fromIndex, direction) {
  const toIndex = fromIndex + direction;
  if (toIndex < 0 || toIndex >= list.length) {
    return;
  }

  [list[fromIndex], list[toIndex]] = [list[toIndex], list[fromIndex]];
}

function updateDraftEventField(field, value, shouldRender = false) {
  if (!state.admin.draft) {
    return;
  }

  if (field === "capacity") {
    state.admin.draft.capacity = value === "" ? null : Math.max(1, Number.parseInt(value, 10) || 0);
  } else {
    state.admin.draft[field] = value;
  }

  markDraftDirty(shouldRender);
}

function updateDraftPageField(pageId, field, value, shouldRender = false) {
  const page = findPage(pageId);
  if (!page) {
    return;
  }

  page[field] = value || null;
  if (field !== "defaultNextPageId") {
    page[field] = value;
  }
  markDraftDirty(shouldRender);
}

function updateDraftQuestionField(questionId, field, value, checked, shouldRender = false) {
  const { question } = findQuestion(questionId);
  if (!question) {
    return;
  }

  if (
    field === "required" ||
    field === "countsTowardCapacity" ||
    field === "repeatForAdditionalParticipants"
  ) {
    question[field] = checked;
  } else if (field === "type") {
    question.type = value;
    if (supportsOptions(value)) {
      question.options = question.options.length
        ? question.options.map((option) => normalizeOption(option))
        : [createOption("選項 1"), createOption("選項 2")];
    } else {
      question.options = [];
    }
    if (value !== "number") {
      question.countsTowardCapacity = false;
    }
  } else {
    question[field] = value;
  }

  markDraftDirty(shouldRender);
}

function updateDraftOptionField(questionId, optionId, field, value, shouldRender = false) {
  const option = findOption(questionId, optionId);
  if (!option) {
    return;
  }

  option[field] = value || null;
  if (field !== "nextPageId") {
    option[field] = value;
  }
  markDraftDirty(shouldRender);
}

function updateRunnerAnswer(questionId, value, checked, shouldRender = false) {
  const event = getSelectedPublicEvent();
  const runner = state.public.runner;
  if (!event || !runner) {
    return;
  }

  const question = event.pages.flatMap((page) => page.questions).find((entry) => entry.id === questionId);
  if (!question) {
    return;
  }

  const targetAnswers =
    runner.stage === "repeat"
      ? ensureRepeatAnswerEntry(event, runner, runner.repeatParticipantNumber)?.answers
      : runner.answers;

  if (!targetAnswers) {
    return;
  }

  if (question.type === "multiChoice") {
    const current = Array.isArray(targetAnswers[questionId]) ? [...targetAnswers[questionId]] : [];
    if (checked && !current.includes(value)) {
      current.push(value);
    }
    if (!checked) {
      targetAnswers[questionId] = current.filter((entry) => entry !== value);
    } else {
      targetAnswers[questionId] = current;
    }
  } else {
    targetAnswers[questionId] = value;
  }

  if (runner.stage === "repeat") {
    runner.repeatErrors = {
      ...runner.repeatErrors,
      [questionId]: "",
    };
  } else {
    runner.errors = {
      ...runner.errors,
      [questionId]: "",
    };
  }
  if (shouldRender) {
    renderPublicDetail();
  }
}

function goToPreviousPage() {
  const event = getSelectedPublicEvent();
  const runner = state.public.runner;
  if (!runner) {
    return;
  }

  if (runner.stage === "repeat") {
    if (runner.repeatParticipantNumber > 2) {
      runner.repeatParticipantNumber -= 1;
    } else {
      runner.stage = "flow";
    }
    runner.repeatErrors = {};
    renderPublicDetail();
    return;
  }

  if (!event || runner.history.length < 2) {
    return;
  }

  runner.history.pop();
  runner.currentPageId = runner.history[runner.history.length - 1] || null;
  runner.errors = {};
  renderPublicDetail();
}

function goToNextPage() {
  const event = getSelectedPublicEvent();
  const runner = state.public.runner;
  if (!event || !runner) {
    return;
  }

  const errors = validateCurrentPage(event, runner.currentPageId, runner.answers);
  if (Object.keys(errors).length) {
    runner.errors = errors;
    renderPublicDetail();
    return;
  }

  const nextPageId = resolveNextPageId(event, runner.currentPageId, normalizeAnswersForEvent(event, runner.answers));
  if (!nextPageId) {
    submitRegistration();
    return;
  }

  runner.history.push(nextPageId);
  runner.currentPageId = nextPageId;
  runner.errors = {};
  renderPublicDetail();
}

async function submitRegistration() {
  const event = getSelectedPublicEvent();
  const runner = state.public.runner;
  if (!event || !runner) {
    return;
  }

  if (runner.submitting) {
    return;
  }

  if (runner.stage === "repeat") {
    const currentEntry = ensureRepeatAnswerEntry(event, runner, runner.repeatParticipantNumber);
    const currentAnswers = normalizeRepeatedAnswersForEvent(event, [currentEntry || {}])[0]?.answers || {};
    const repeatErrors = validateRepeatAnswers(event, currentAnswers);

    if (Object.keys(repeatErrors).length) {
      runner.repeatErrors = repeatErrors;
      renderPublicDetail();
      return;
    }

    if (currentEntry) {
      currentEntry.answers = currentAnswers;
    }

    if (runner.repeatParticipantNumber < runner.finalParticipantCount) {
      runner.repeatParticipantNumber += 1;
      runner.repeatErrors = {};
      ensureRepeatAnswerEntry(event, runner, runner.repeatParticipantNumber);
      renderPublicDetail();
      return;
    }
  } else {
    const errors = validateCurrentPage(event, runner.currentPageId, runner.answers);
    if (Object.keys(errors).length) {
      runner.errors = errors;
      renderPublicDetail();
      return;
    }

    const totalParticipants = computeParticipantsFromAnswers(event, runner.answers);
    const repeatQuestions = getRepeatQuestions(event);

    if (totalParticipants > 1 && repeatQuestions.length > 0) {
      runner.stage = "repeat";
      runner.finalParticipantCount = totalParticipants;
      runner.repeatParticipantNumber = 2;
      runner.repeatErrors = {};
      ensureRepeatAnswerEntry(event, runner, runner.repeatParticipantNumber);
      renderPublicDetail();
      return;
    }
  }

  runner.submitting = true;
  renderPublicDetail();

  try {
    const payload = await api.submitRegistration(
      event.id,
      runner.answers,
      normalizeRepeatedAnswersForEvent(event, runner.repeatedAnswers).filter(
        (entry) => entry.participantNumber <= Math.max(1, runner.finalParticipantCount || 1),
      ),
    );
    runner.submitted = true;
    runner.success = {
      totalParticipants: payload.totalParticipants,
      summary: payload.summary,
    };
    await loadPublicEvents();
    ensureRunnerForEvent(event.id);
    state.public.runner = {
      ...state.public.runner,
      submitting: false,
      submitted: true,
      success: runner.success,
    };
    renderPublic();
    showToast("報名已送出。");
  } catch (error) {
    runner.submitting = false;
    renderPublicDetail();
    showToast(error.message || "送出失敗。");
  }
}

function restartRegistration() {
  const event = getSelectedPublicEvent();
  if (!event) {
    return;
  }

  state.public.runner = {
    eventId: event.id,
    currentPageId: event.pages[0]?.id || null,
    history: event.pages[0] ? [event.pages[0].id] : [],
    answers: {},
    errors: {},
    stage: "flow",
    repeatedAnswers: [],
    repeatErrors: {},
    repeatParticipantNumber: 2,
    finalParticipantCount: 1,
    submitting: false,
    submitted: false,
    success: null,
  };
  renderPublicDetail();
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("圖片讀取失敗"));
    reader.readAsDataURL(file);
  });
}

async function optimizeCoverImage(file) {
  const sourceUrl = await fileToDataUrl(file);
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("圖片載入失敗"));
    img.src = sourceUrl;
  });

  const maxWidth = 1280;
  const maxHeight = 1280;
  const widthRatio = maxWidth / image.width;
  const heightRatio = maxHeight / image.height;
  const ratio = Math.min(1, widthRatio, heightRatio);
  const targetWidth = Math.max(1, Math.round(image.width * ratio));
  const targetHeight = Math.max(1, Math.round(image.height * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const context = canvas.getContext("2d");
  if (!context) {
    return sourceUrl;
  }

  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  return canvas.toDataURL("image/jpeg", 0.82);
}

async function handleCoverUpload(file) {
  if (!file || !state.admin.draft) {
    return;
  }

  try {
    const optimizedImage = await optimizeCoverImage(file);
    if (optimizedImage.length > 3_500_000) {
      showToast("圖片還是太大，請換更小的封面圖再試一次。");
      return;
    }
    state.admin.draft.coverImage = optimizedImage;
    markDraftDirty();
  } catch {
    showToast("圖片讀取失敗，請再試一次。");
  }
}

function shouldRenderAfterControlChange(target) {
  return (
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLInputElement && ["checkbox", "radio"].includes(target.type))
  );
}

function applyControlMutation(target, forceRender = false) {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
    return;
  }

  const shouldRender = forceRender || shouldRenderAfterControlChange(target);

  if (target.dataset.eventField) {
    updateDraftEventField(target.dataset.eventField, target.value, shouldRender);
    return;
  }

  if (target.dataset.pageField && target.dataset.pageId) {
    updateDraftPageField(
      target.dataset.pageId,
      target.dataset.pageField,
      target.value,
      shouldRender,
    );
    return;
  }

  if (target.dataset.questionField && target.dataset.questionId) {
    updateDraftQuestionField(
      target.dataset.questionId,
      target.dataset.questionField,
      target.value,
      target instanceof HTMLInputElement ? target.checked : false,
      shouldRender,
    );
    return;
  }

  if (target.dataset.optionField && target.dataset.questionId && target.dataset.optionId) {
    updateDraftOptionField(
      target.dataset.questionId,
      target.dataset.optionId,
      target.dataset.optionField,
      target.value,
      shouldRender,
    );
    return;
  }

  if (target.dataset.publicQuestion) {
    if (target instanceof HTMLInputElement && target.type === "checkbox") {
      updateRunnerAnswer(
        target.dataset.publicQuestion,
        target.value,
        target.checked,
        shouldRender,
      );
    } else {
      updateRunnerAnswer(
        target.dataset.publicQuestion,
        target.value,
        true,
        shouldRender,
      );
    }
  }
}

document.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (target.closest("[data-close-admin='true']")) {
    closeAdmin();
    return;
  }

  if (target.closest("[data-close-public='true']")) {
    closePublicEvent();
    return;
  }

  const adminAction = target.closest("[data-admin-action]");
  if (adminAction instanceof HTMLElement) {
    const { adminAction: action, eventId, pageId, questionId, optionId } = adminAction.dataset;

    if (action === "new-event") {
      createNewAdminEvent();
      return;
    }

    if (action === "duplicate-event") {
      duplicateCurrentAdminEvent();
      return;
    }

    if (action === "select-event" && eventId) {
      selectAdminEvent(eventId);
      return;
    }

    if (action === "save-event") {
      await saveDraft();
      return;
    }

    if (action === "export-submissions") {
      exportSubmissionsToExcel();
      return;
    }

    if (action === "toggle-page" && pageId) {
      toggleAdminCollapsed("collapsedPages", pageId);
      return;
    }

    if (action === "toggle-question" && questionId) {
      toggleAdminCollapsed("collapsedQuestions", questionId);
      return;
    }

    if (action === "delete-event") {
      await deleteSelectedEvent();
      return;
    }

    if (action === "logout") {
      logoutAdmin();
      return;
    }

    if (action === "remove-cover" && state.admin.draft) {
      state.admin.draft.coverImage = "";
      markDraftDirty();
      return;
    }

    if (action === "add-page" && state.admin.draft) {
      const newPage = createPage(`新頁面 ${state.admin.draft.pages.length + 1}`);
      state.admin.draft.pages.push(newPage);
      state.admin.collapsedPages[newPage.id] = false;
      markDraftDirty();
      return;
    }

    if (action === "delete-page" && pageId && state.admin.draft) {
      const pageToDelete = findPage(pageId);
      if (pageToDelete) {
        for (const question of pageToDelete.questions) {
          delete state.admin.collapsedQuestions[question.id];
        }
      }
      state.admin.draft.pages = state.admin.draft.pages.filter((page) => page.id !== pageId);
      delete state.admin.collapsedPages[pageId];
      if (state.admin.draft.pages.length === 0) {
        state.admin.draft.pages.push(createPage("基本資料"));
      }
      markDraftDirty();
      return;
    }

    if (action === "move-page-up" && pageId && state.admin.draft) {
      const index = state.admin.draft.pages.findIndex((page) => page.id === pageId);
      moveItem(state.admin.draft.pages, index, -1);
      markDraftDirty();
      return;
    }

    if (action === "move-page-down" && pageId && state.admin.draft) {
      const index = state.admin.draft.pages.findIndex((page) => page.id === pageId);
      moveItem(state.admin.draft.pages, index, 1);
      markDraftDirty();
      return;
    }

    if (action === "add-question" && pageId) {
      const page = findPage(pageId);
      if (!page) {
        return;
      }

      const newQuestion = createQuestion(`新欄位 ${page.questions.length + 1}`, "shortText");
      page.questions.push(newQuestion);
      state.admin.collapsedQuestions[newQuestion.id] = false;
      markDraftDirty();
      return;
    }

    if (action === "delete-question" && pageId && questionId) {
      const page = findPage(pageId);
      if (!page) {
        return;
      }

      page.questions = page.questions.filter((question) => question.id !== questionId);
      delete state.admin.collapsedQuestions[questionId];
      markDraftDirty();
      return;
    }

    if (action === "move-question-up" && pageId && questionId) {
      const page = findPage(pageId);
      if (!page) {
        return;
      }

      const index = page.questions.findIndex((question) => question.id === questionId);
      moveItem(page.questions, index, -1);
      markDraftDirty();
      return;
    }

    if (action === "move-question-down" && pageId && questionId) {
      const page = findPage(pageId);
      if (!page) {
        return;
      }

      const index = page.questions.findIndex((question) => question.id === questionId);
      moveItem(page.questions, index, 1);
      markDraftDirty();
      return;
    }

    if (action === "add-option" && questionId) {
      const { question } = findQuestion(questionId);
      if (!question) {
        return;
      }

      question.options.push(createOption(`選項 ${question.options.length + 1}`));
      markDraftDirty();
      return;
    }

    if (action === "delete-option" && questionId && optionId) {
      const { question } = findQuestion(questionId);
      if (!question) {
        return;
      }

      question.options = question.options.filter((option) => option.id !== optionId);
      if (question.options.length === 0) {
        question.options.push(createOption("選項 1"));
      }
      markDraftDirty();
      return;
    }
  }

  const publicAction = target.closest("[data-public-action]");
  if (publicAction instanceof HTMLElement) {
    const action = publicAction.dataset.publicAction;

    if (action === "prev") {
      goToPreviousPage();
      return;
    }

    if (action === "next") {
      goToNextPage();
      return;
    }

    if (action === "submit") {
      await submitRegistration();
      return;
    }

    if (action === "restart") {
      restartRegistration();
      return;
    }

    if (action === "close") {
      closePublicEvent();
      return;
    }
  }

  const eventAction = target.closest("[data-event-action='open']");
  if (eventAction instanceof HTMLElement && eventAction.dataset.eventId) {
    selectPublicEvent(eventAction.dataset.eventId);
  }
});

document.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (target.matches("#admin-password-input")) {
    state.admin.password = target.value;
    return;
  }

  applyControlMutation(target);
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (target instanceof HTMLInputElement && target.type === "file" && target.id === "cover-upload-input") {
    handleCoverUpload(target.files?.[0] || null);
    return;
  }

  applyControlMutation(target, true);
});

document.addEventListener("submit", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLFormElement)) {
    return;
  }

  if (target.id === "admin-login-form") {
    event.preventDefault();
    await loginAdmin(state.admin.password);
  }
});

dom.openAdmin.addEventListener("click", () => {
  openAdmin();
});

dom.closeAdmin.addEventListener("click", () => {
  closeAdmin();
});

dom.closePublic.addEventListener("click", () => {
  closePublicEvent();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !dom.publicOverlay.classList.contains("hidden")) {
    closePublicEvent();
  }
});

async function init() {
  await detectApiMode();
  await loadPublicEvents({ preserveSelection: false });
  renderAdmin();
}

init();
