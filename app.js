const END_OF_FLOW = "__end__";
const API_BASE = "/.netlify/functions";

const QUESTION_TYPE_OPTIONS = [
  { value: "shortText", label: "簡答" },
  { value: "longText", label: "長答" },
  { value: "email", label: "Email" },
  { value: "phone", label: "電話" },
  { value: "idNumber", label: "身分證字號" },
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
    modalMode: null,
    eventSpec: null,
    cart: {
      items: [],
      contact: {
        name: "",
        phone: "",
        email: "",
        note: "",
      },
      participants: [],
      errors: {},
      submitting: false,
      success: null,
    },
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

function normalizeMoneyValue(value) {
  if (value === "" || value == null) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(0, Math.round(parsed * 100) / 100);
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function formatMoney(value) {
  if (value == null || !Number.isFinite(Number(value))) {
    return "";
  }

  return new Intl.NumberFormat("zh-Hant-TW", {
    style: "currency",
    currency: "TWD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function normalizeDateTimeValue(value) {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return "";
  }

  return parsed.toISOString();
}

function formatDateTimeLocal(value) {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return "";
  }

  const offsetMs = parsed.getTimezoneOffset() * 60 * 1000;
  return new Date(parsed.getTime() - offsetMs).toISOString().slice(0, 16);
}

function createPricingConfig() {
  return {
    enabled: false,
    originalPrice: null,
    discountPrice: null,
    groupEnabled: false,
    groupThreshold: null,
    groupPrice: null,
    earlyBirdEnabled: false,
    earlyBirdDeadline: "",
    earlyBirdPrice: null,
    confirmationFieldEnabled: false,
    confirmationFieldLabel: "",
    confirmationFieldPlaceholder: "",
    confirmationFieldRequired: false,
  };
}

function createCarpoolConfig() {
  return {
    enabled: false,
    price: null,
    capacity: null,
    description: "",
  };
}

function normalizePricingConfig(pricing) {
  const fallback = createPricingConfig();

  return {
    enabled: Boolean(pricing?.enabled),
    originalPrice: normalizeMoneyValue(pricing?.originalPrice),
    discountPrice: normalizeMoneyValue(pricing?.discountPrice),
    groupEnabled: Boolean(pricing?.groupEnabled),
    groupThreshold:
      pricing?.groupThreshold === "" || pricing?.groupThreshold == null
        ? null
        : Math.max(1, Number.parseInt(pricing.groupThreshold, 10) || 0) || null,
    groupPrice: normalizeMoneyValue(pricing?.groupPrice),
    earlyBirdEnabled: Boolean(pricing?.earlyBirdEnabled),
    earlyBirdDeadline: normalizeDateTimeValue(pricing?.earlyBirdDeadline),
    earlyBirdPrice: normalizeMoneyValue(pricing?.earlyBirdPrice),
    confirmationFieldEnabled: Boolean(pricing?.confirmationFieldEnabled),
    confirmationFieldLabel: String(
      pricing?.confirmationFieldLabel || fallback.confirmationFieldLabel,
    ).trim(),
    confirmationFieldPlaceholder: String(
      pricing?.confirmationFieldPlaceholder || fallback.confirmationFieldPlaceholder,
    ).trim(),
    confirmationFieldRequired: Boolean(pricing?.confirmationFieldRequired),
  };
}

function normalizeCarpoolConfig(carpool) {
  return {
    enabled: Boolean(carpool?.enabled),
    price: normalizeMoneyValue(carpool?.price),
    capacity:
      carpool?.capacity === "" || carpool?.capacity == null
        ? null
        : Math.max(1, Number.parseInt(carpool.capacity, 10) || 0) || null,
    description: String(carpool?.description || "").trim(),
  };
}

function normalizeSubmissionPricing(pricing) {
  if (!pricing || typeof pricing !== "object") {
    return null;
  }

  return {
    tierKey: String(pricing?.tierKey || "").trim(),
    tierLabel: String(pricing?.tierLabel || "").trim(),
    unitPrice: normalizeMoneyValue(pricing?.unitPrice),
    originalUnitPrice: normalizeMoneyValue(pricing?.originalUnitPrice),
    totalPrice: normalizeMoneyValue(pricing?.totalPrice),
    participants:
      pricing?.participants == null
        ? null
        : Math.max(1, Number.parseInt(pricing.participants, 10) || 0) || null,
    confirmationValue: String(pricing?.confirmationValue || "").trim(),
    confirmationFieldLabel: String(pricing?.confirmationFieldLabel || "").trim(),
  };
}

function normalizeSubmissionCarpool(carpool) {
  if (!carpool || typeof carpool !== "object") {
    return null;
  }

  const quantity = Math.max(0, Number.parseInt(carpool?.quantity, 10) || 0);
  if (quantity <= 0) {
    return null;
  }

  return {
    quantity,
    unitPrice: normalizeMoneyValue(carpool?.unitPrice),
    totalPrice: normalizeMoneyValue(carpool?.totalPrice),
    description: String(carpool?.description || "").trim(),
  };
}

function normalizeSubmissionCart(cart) {
  if (!cart || typeof cart !== "object") {
    return null;
  }

  const participants = Array.isArray(cart?.participants)
    ? cart.participants.map((participant, index) => ({
        id: String(participant?.id || `participant_${index + 1}`),
        name: String(participant?.name || "").trim(),
        phone: String(participant?.phone || "").trim(),
        email: String(participant?.email || "").trim(),
        idNumber: String(participant?.idNumber || "").trim(),
      }))
    : [];

  return {
    orderId: String(cart?.orderId || "").trim(),
    itemId: String(cart?.itemId || "").trim(),
    contact: {
      name: String(cart?.contact?.name || "").trim(),
      phone: String(cart?.contact?.phone || "").trim(),
      email: String(cart?.contact?.email || "").trim(),
      note: String(cart?.contact?.note || "").trim(),
    },
    participants,
    subtotal: normalizeMoneyValue(cart?.subtotal),
  };
}

function hasPricingFeatureEnabled(event) {
  return Boolean(event?.pricing?.enabled);
}

function hasCarpoolFeatureEnabled(event) {
  return Boolean(event?.carpool?.enabled);
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

function computeUsedCarpoolCapacity(event) {
  return (event.submissions || []).reduce(
    (sum, submission) => sum + (Number.parseInt(submission.carpool?.quantity, 10) || 0),
    0,
  );
}

function computeRemainingCarpoolCapacity(event) {
  const carpool = normalizeCarpoolConfig(event?.carpool);
  if (!carpool.enabled || carpool.capacity == null) {
    return null;
  }

  return Math.max(0, carpool.capacity - computeUsedCarpoolCapacity(event));
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
    pricing: createPricingConfig(),
    carpool: createCarpoolConfig(),
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
    pricing: normalizeSubmissionPricing(submission?.pricing),
    carpool: normalizeSubmissionCarpool(submission?.carpool),
    cart: normalizeSubmissionCart(submission?.cart),
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
    pricing: normalizePricingConfig(event?.pricing),
    carpool: normalizeCarpoolConfig(event?.carpool),
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
    pricing: deepClone(normalized.pricing),
    carpool: {
      ...deepClone(normalized.carpool),
      remainingCapacity: computeRemainingCarpoolCapacity(normalized),
    },
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

  if (question.type === "idNumber") {
    return value == null ? "" : String(value).trim().toUpperCase().replace(/[\s-]/g, "");
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

function syncRunnerRepeatedAnswers(event, runner, totalParticipants) {
  const repeatQuestions = getRepeatQuestions(event);

  if (totalParticipants <= 1 || repeatQuestions.length === 0) {
    runner.repeatedAnswers = [];
    return;
  }

  const normalized = normalizeRepeatedAnswersForEvent(
    event,
    runner.repeatedAnswers,
  ).filter((entry) => entry.participantNumber <= totalParticipants);
  const existingParticipantNumbers = new Set(
    normalized.map((entry) => entry.participantNumber),
  );

  for (let participantNumber = 2; participantNumber <= totalParticipants; participantNumber += 1) {
    if (!existingParticipantNumbers.has(participantNumber)) {
      normalized.push({
        participantNumber,
        answers: {},
      });
    }
  }

  runner.repeatedAnswers = normalizeRepeatedAnswersForEvent(event, normalized);
}

function findFirstInvalidRepeatParticipant(event, runner, totalParticipants) {
  for (let participantNumber = 2; participantNumber <= totalParticipants; participantNumber += 1) {
    const entry = ensureRepeatAnswerEntry(event, runner, participantNumber);
    const errors = validateRepeatAnswers(event, entry?.answers || {});
    if (Object.keys(errors).length) {
      return {
        participantNumber,
        errors,
      };
    }
  }

  return null;
}

function moveRunnerToReviewStage(event, runner) {
  const flowState = validateWholeFlow(event, runner.answers);
  if (!flowState.ok) {
    const firstError = flowState.errors[0];
    if (firstError?.pageId) {
      jumpToFlowQuestionFromReview(event, runner, firstError.pageId);
      runner.errors = {
        [firstError.questionId]: firstError.message,
      };
    }
    return false;
  }

  const totalParticipants = computeParticipantsFromAnswers(event, runner.answers);
  const repeatQuestions = getRepeatQuestions(event);

  runner.finalParticipantCount = totalParticipants;
  syncRunnerRepeatedAnswers(event, runner, totalParticipants);

  if (totalParticipants > 1 && repeatQuestions.length > 0) {
    const invalidRepeat = findFirstInvalidRepeatParticipant(event, runner, totalParticipants);
    if (invalidRepeat) {
      runner.stage = "repeat";
      runner.repeatParticipantNumber = invalidRepeat.participantNumber;
      runner.repeatErrors = invalidRepeat.errors;
      return false;
    }
  }

  runner.stage = "review";
  runner.returnToReview = false;
  runner.errors = {};
  runner.repeatErrors = {};
  runner.reviewErrors = {};
  return true;
}

function validateReviewStage(event, runner) {
  const pricing = normalizePricingConfig(event?.pricing);
  const errors = {};

  if (
    pricing.enabled &&
    pricing.confirmationFieldEnabled &&
    pricing.confirmationFieldRequired &&
    !String(runner?.pricingConfirmationValue || "").trim()
  ) {
    errors.pricingConfirmation = `${pricing.confirmationFieldLabel || "確認欄位"} 為必填。`;
  }

  const carpoolError = validateCarpoolSelection(event, runner);
  if (carpoolError) {
    errors.carpool = carpoolError;
  }

  return errors;
}

function getReviewSections(event, runner) {
  const flowState = validateWholeFlow(event, runner.answers);
  const pageMap = new Map(event.pages.map((page) => [page.id, page]));
  const sections = flowState.visitedPageIds
    .map((pageId, index) => {
      const page = pageMap.get(pageId);
      if (!page) {
        return null;
      }

      return {
        kind: "flow",
        title: page.title || `第 ${index + 1} 頁`,
        description: page.description || "",
        items: page.questions.map((question) => ({
          id: question.id,
          question,
          answer: runner.answers?.[question.id],
          action: "edit-flow-question",
          actionLabel: "編輯",
          dataAttributes: `data-page-id="${page.id}" data-question-id="${question.id}"`,
        })),
      };
    })
    .filter(Boolean);

  const repeatQuestions = getRepeatQuestions(event);
  const totalParticipants = Math.max(1, runner.finalParticipantCount || 1);

  if (totalParticipants > 1 && repeatQuestions.length > 0) {
    const repeatedAnswers = normalizeRepeatedAnswersForEvent(event, runner.repeatedAnswers);
    for (let participantNumber = 2; participantNumber <= totalParticipants; participantNumber += 1) {
      const entry = repeatedAnswers.find(
        (item) => item.participantNumber === participantNumber,
      );
      sections.push({
        kind: "repeat",
        title: `第 ${participantNumber} 位同行`,
        description: "",
        items: repeatQuestions.map((question) => ({
          id: `${participantNumber}_${question.id}`,
          question,
          answer: entry?.answers?.[question.id],
          action: "edit-repeat-question",
          actionLabel: "編輯",
          dataAttributes: `data-participant-number="${participantNumber}" data-question-id="${question.id}"`,
        })),
      });
    }
  }

  return sections;
}

function jumpToFlowQuestionFromReview(event, runner, pageId) {
  const flowState = validateWholeFlow(event, runner.answers);
  const pageIndex = flowState.visitedPageIds.indexOf(pageId);
  runner.stage = "flow";
  runner.currentPageId = pageId;
  runner.history =
    pageIndex >= 0 ? flowState.visitedPageIds.slice(0, pageIndex + 1) : [pageId];
  runner.errors = {};
  runner.returnToReview = true;
  runner.reviewErrors = {};
}

function jumpToRepeatQuestionFromReview(event, runner, participantNumber) {
  runner.stage = "repeat";
  runner.repeatParticipantNumber = participantNumber;
  runner.repeatErrors = {};
  runner.returnToReview = true;
  runner.reviewErrors = {};
  ensureRepeatAnswerEntry(event, runner, participantNumber);
}

function jumpToCarpoolFromReview(event, runner) {
  const flowState = validateWholeFlow(event, runner.answers);
  const lastVisitedPageId =
    flowState.visitedPageIds[flowState.visitedPageIds.length - 1] || event.pages[0]?.id || null;
  if (!lastVisitedPageId) {
    return;
  }

  jumpToFlowQuestionFromReview(event, runner, lastVisitedPageId);
}

function goBackFromReview() {
  const event = getSelectedPublicEvent();
  const runner = state.public.runner;
  if (!event || !runner) {
    return;
  }

  const totalParticipants = Math.max(1, runner.finalParticipantCount || 1);
  const repeatQuestions = getRepeatQuestions(event);

  if (totalParticipants > 1 && repeatQuestions.length > 0) {
    jumpToRepeatQuestionFromReview(event, runner, totalParticipants);
    runner.returnToReview = false;
    renderPublicDetail();
    return;
  }

  const flowState = validateWholeFlow(event, runner.answers);
  const lastVisitedPageId =
    flowState.visitedPageIds[flowState.visitedPageIds.length - 1] || event.pages[0]?.id || null;
  if (!lastVisitedPageId) {
    return;
  }

  jumpToFlowQuestionFromReview(event, runner, lastVisitedPageId);
  runner.returnToReview = false;
  renderPublicDetail();
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

  if (question.type === "idNumber" && answer) {
    const idPattern = /^[A-Z][A-Z0-9]\d{8}$/;
    if (!idPattern.test(String(answer).toUpperCase())) {
      return `${question.label} 需要填寫 10 碼有效身分證字號。`;
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

function hasParticipantCountInput(event, answers) {
  const normalizedAnswers = normalizeAnswersForEvent(event, answers);
  const trackedQuestions = event.pages
    .flatMap((page) => page.questions)
    .filter((question) => question.countsTowardCapacity);

  if (trackedQuestions.length === 0) {
    return true;
  }

  return trackedQuestions.some((question) => normalizedAnswers[question.id] !== "");
}

function buildParticipantCountAnswers(event, participants, contact = {}, assignedParticipants = []) {
  const normalizedParticipants = Math.max(1, Number.parseInt(participants, 10) || 1);
  const participantNames = assignedParticipants
    .map((participant) => participant.name)
    .filter(Boolean)
    .join("、");
  const answers = {};
  let appliedParticipantCount = false;

  for (const page of event.pages) {
    for (const question of page.questions) {
      if (question.countsTowardCapacity && !appliedParticipantCount) {
        answers[question.id] = String(normalizedParticipants);
        appliedParticipantCount = true;
        continue;
      }

      if (question.countsTowardCapacity) {
        answers[question.id] = "0";
        continue;
      }

      if (question.type === "email") {
        answers[question.id] = contact.email || "";
        continue;
      }

      if (question.type === "phone") {
        answers[question.id] = contact.phone || "";
        continue;
      }

      if (question.type === "idNumber") {
        answers[question.id] = assignedParticipants[0]?.idNumber || "";
        continue;
      }

      const label = question.label || "";
      if (/姓名|名字|name/i.test(label)) {
        answers[question.id] = participantNames || contact.name || "";
        continue;
      }

      answers[question.id] = question.type === "multiChoice" ? [] : "";
    }
  }

  return answers;
}

function getPricingQuote(event, answers, referenceTime = new Date().toISOString()) {
  const pricing = normalizePricingConfig(event?.pricing);
  if (!pricing.enabled) {
    return null;
  }

  const participants = computeParticipantsFromAnswers(event, answers);
  const candidates = [];
  const basePrice = pricing.discountPrice ?? pricing.originalPrice;

  if (basePrice != null) {
    candidates.push({
      tierKey: pricing.discountPrice != null ? "discount" : "original",
      tierLabel: pricing.discountPrice != null ? "優惠價" : "原價",
      unitPrice: basePrice,
      priority: 1,
    });
  }

  if (
    pricing.groupEnabled &&
    pricing.groupThreshold != null &&
    pricing.groupPrice != null &&
    participants >= pricing.groupThreshold
  ) {
    candidates.push({
      tierKey: "group",
      tierLabel: `團體價（${pricing.groupThreshold} 人以上）`,
      unitPrice: pricing.groupPrice,
      priority: 2,
    });
  }

  if (
    pricing.earlyBirdEnabled &&
    pricing.earlyBirdDeadline &&
    pricing.earlyBirdPrice != null &&
    new Date(referenceTime).valueOf() <= new Date(pricing.earlyBirdDeadline).valueOf()
  ) {
    candidates.push({
      tierKey: "earlyBird",
      tierLabel: "早鳥價",
      unitPrice: pricing.earlyBirdPrice,
      priority: 3,
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    if (left.unitPrice !== right.unitPrice) {
      return left.unitPrice - right.unitPrice;
    }
    return right.priority - left.priority;
  });

  const applied = candidates[0];
  const originalUnitPrice =
    pricing.originalPrice != null && pricing.originalPrice > applied.unitPrice
      ? pricing.originalPrice
      : null;

  return {
    tierKey: applied.tierKey,
    tierLabel: applied.tierLabel,
    unitPrice: applied.unitPrice,
    originalUnitPrice,
    totalPrice: roundMoney(applied.unitPrice * participants),
    participants,
    confirmationFieldEnabled: pricing.confirmationFieldEnabled,
    confirmationFieldLabel: pricing.confirmationFieldLabel,
    confirmationFieldPlaceholder: pricing.confirmationFieldPlaceholder,
    confirmationFieldRequired: pricing.confirmationFieldRequired,
    earlyBirdDeadline: pricing.earlyBirdDeadline,
  };
}

function getPricingQuoteForParticipants(event, participants, referenceTime = new Date().toISOString()) {
  const pricing = normalizePricingConfig(event?.pricing);
  if (!pricing.enabled) {
    return null;
  }

  const normalizedParticipants = Math.max(1, Number.parseInt(participants, 10) || 1);
  const candidates = [];
  const basePrice = pricing.discountPrice ?? pricing.originalPrice;

  if (basePrice != null) {
    candidates.push({
      tierKey: pricing.discountPrice != null ? "discount" : "original",
      tierLabel: pricing.discountPrice != null ? "優惠價" : "原價",
      unitPrice: basePrice,
      priority: 1,
    });
  }

  if (
    pricing.groupEnabled &&
    pricing.groupThreshold != null &&
    pricing.groupPrice != null &&
    normalizedParticipants >= pricing.groupThreshold
  ) {
    candidates.push({
      tierKey: "group",
      tierLabel: `團體價（${pricing.groupThreshold} 人以上）`,
      unitPrice: pricing.groupPrice,
      priority: 2,
    });
  }

  if (
    pricing.earlyBirdEnabled &&
    pricing.earlyBirdDeadline &&
    pricing.earlyBirdPrice != null &&
    new Date(referenceTime).valueOf() <= new Date(pricing.earlyBirdDeadline).valueOf()
  ) {
    candidates.push({
      tierKey: "earlyBird",
      tierLabel: "早鳥價",
      unitPrice: pricing.earlyBirdPrice,
      priority: 3,
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    if (left.unitPrice !== right.unitPrice) {
      return left.unitPrice - right.unitPrice;
    }
    return right.priority - left.priority;
  });

  const applied = candidates[0];
  const originalUnitPrice =
    pricing.originalPrice != null && pricing.originalPrice > applied.unitPrice
      ? pricing.originalPrice
      : null;

  return {
    tierKey: applied.tierKey,
    tierLabel: applied.tierLabel,
    unitPrice: applied.unitPrice,
    originalUnitPrice,
    totalPrice: roundMoney(applied.unitPrice * normalizedParticipants),
    participants: normalizedParticipants,
    confirmationFieldEnabled: pricing.confirmationFieldEnabled,
    confirmationFieldLabel: pricing.confirmationFieldLabel,
    confirmationFieldPlaceholder: pricing.confirmationFieldPlaceholder,
    confirmationFieldRequired: pricing.confirmationFieldRequired,
    earlyBirdDeadline: pricing.earlyBirdDeadline,
  };
}

function normalizeRunnerCarpoolSelection(selection) {
  const requested = Boolean(selection?.requested);
  const quantity = requested ? Math.max(1, Number.parseInt(selection?.quantity, 10) || 1) : 0;

  return {
    requested,
    quantity,
  };
}

function getCarpoolQuote(event, selection) {
  const carpool = normalizeCarpoolConfig(event?.carpool);
  const normalizedSelection = normalizeRunnerCarpoolSelection(selection);
  if (!carpool.enabled || !normalizedSelection.requested || normalizedSelection.quantity <= 0) {
    return null;
  }

  const unitPrice = carpool.price ?? 0;
  return {
    quantity: normalizedSelection.quantity,
    unitPrice,
    totalPrice: roundMoney(unitPrice * normalizedSelection.quantity),
    remainingCapacity:
      event?.carpool?.remainingCapacity == null
        ? computeRemainingCarpoolCapacity(event)
        : event.carpool.remainingCapacity,
    description: carpool.description,
  };
}

function getCheckoutTotal(event, answers, carpoolSelection) {
  const pricingQuote = getPricingQuote(event, answers);
  const carpoolQuote = getCarpoolQuote(event, carpoolSelection);
  const totalPrice = roundMoney((pricingQuote?.totalPrice || 0) + (carpoolQuote?.totalPrice || 0));

  if (!pricingQuote && !carpoolQuote) {
    return null;
  }

  return {
    pricingQuote,
    carpoolQuote,
    totalPrice,
  };
}

function createEventSpec(event) {
  return {
    eventId: event.id,
    quantity: 1,
    carpoolSelection: {
      requested: false,
      quantity: 0,
    },
    errors: {},
  };
}

function normalizeCartQuantity(value) {
  return Math.max(1, Number.parseInt(value, 10) || 1);
}

function createCartParticipant(index = 0) {
  return {
    id: createId("participant"),
    name: "",
    phone: "",
    email: "",
    idNumber: "",
    assignedItemIds: [],
    label: `參加者 ${index + 1}`,
  };
}

function getCartItems() {
  return state.public.cart.items || [];
}

function getCartItemEvent(item) {
  return state.public.events.find((event) => event.id === item.eventId) || null;
}

function getCartItemQuote(item) {
  const event = getCartItemEvent(item);
  if (!event) {
    return null;
  }

  const pricingQuote = getPricingQuoteForParticipants(event, item.quantity);
  const carpoolQuote = getCarpoolQuote(event, item.carpoolSelection);
  const totalPrice = roundMoney((pricingQuote?.totalPrice || 0) + (carpoolQuote?.totalPrice || 0));

  return {
    event,
    pricingQuote,
    carpoolQuote,
    totalPrice,
  };
}

function getCartTotal() {
  return roundMoney(
    getCartItems().reduce((sum, item) => sum + (getCartItemQuote(item)?.totalPrice || 0), 0),
  );
}

function cartRequiresPaymentNote() {
  return getCartItems().some((item) => {
    const event = getCartItemEvent(item);
    const pricing = normalizePricingConfig(event?.pricing);
    return pricing.enabled && pricing.confirmationFieldEnabled && pricing.confirmationFieldRequired;
  });
}

function getCartItemAssignedParticipants(itemId) {
  return (state.public.cart.participants || []).filter((participant) =>
    (participant.assignedItemIds || []).includes(itemId),
  );
}

function getRequiredCartParticipantCount() {
  const quantities = getCartItems().map((item) => normalizeCartQuantity(item.quantity));
  return quantities.length ? Math.max(...quantities) : 1;
}

function normalizeCartParticipant(participant, index = 0) {
  return {
    id: String(participant?.id || createId("participant")),
    name: String(participant?.name || "").trim(),
    phone: String(participant?.phone || "").trim(),
    email: String(participant?.email || "").trim(),
    idNumber: String(participant?.idNumber || "").trim().toUpperCase().replace(/[\s-]/g, ""),
    assignedItemIds: Array.isArray(participant?.assignedItemIds)
      ? participant.assignedItemIds.map((value) => String(value))
      : [],
    label: String(participant?.label || `參加者 ${index + 1}`),
  };
}

function ensureCartParticipantRows({ autoAssign = false } = {}) {
  const validItemIds = new Set(getCartItems().map((item) => item.id));
  const requiredCount = getRequiredCartParticipantCount();
  const participants = (state.public.cart.participants || []).map((participant, index) => {
    const normalized = normalizeCartParticipant(participant, index);
    normalized.assignedItemIds = normalized.assignedItemIds.filter((itemId) => validItemIds.has(itemId));
    return normalized;
  });

  while (participants.length < requiredCount) {
    participants.push(createCartParticipant(participants.length));
  }

  if (autoAssign) {
    for (const item of getCartItems()) {
      let assigned = participants.filter((participant) =>
        participant.assignedItemIds.includes(item.id),
      );

      if (assigned.length > item.quantity) {
        for (const participant of assigned.slice(item.quantity)) {
          participant.assignedItemIds = participant.assignedItemIds.filter((id) => id !== item.id);
        }
      }

      assigned = participants.filter((participant) => participant.assignedItemIds.includes(item.id));
      for (const participant of participants) {
        if (assigned.length >= item.quantity) {
          break;
        }
        if (!participant.assignedItemIds.includes(item.id)) {
          participant.assignedItemIds.push(item.id);
          assigned.push(participant);
        }
      }
    }
  }

  state.public.cart.participants = participants;
}

function validateEventSpec(event, spec) {
  const quantity = normalizeCartQuantity(spec?.quantity);
  const errors = {};

  if (event.remainingCapacity != null && quantity > event.remainingCapacity) {
    errors.quantity = `活動名額不足，目前只剩 ${event.remainingCapacity} 人。`;
  }

  const carpool = normalizeCarpoolConfig(event?.carpool);
  const carpoolSelection = normalizeRunnerCarpoolSelection(spec?.carpoolSelection);
  if (carpool.enabled && carpoolSelection.requested) {
    if (carpoolSelection.quantity > quantity) {
      errors.carpool = `共乘人數不能超過活動人數 ${quantity} 人。`;
    }

    const remaining = event?.carpool?.remainingCapacity == null
      ? computeRemainingCarpoolCapacity(event)
      : event.carpool.remainingCapacity;
    if (remaining != null && carpoolSelection.quantity > remaining) {
      errors.carpool = `共乘名額不足，目前只剩 ${remaining} 位。`;
    }
  }

  return errors;
}

function validateCartCheckout() {
  const errors = {};
  const contact = state.public.cart.contact || {};
  const items = getCartItems();

  if (items.length === 0) {
    errors.cart = "購物車目前是空的。";
  }

  if (!String(contact.name || "").trim()) {
    errors.contactName = "請填寫聯絡人姓名。";
  }

  if (!String(contact.phone || "").trim()) {
    errors.contactPhone = "請填寫聯絡電話。";
  } else if (!/^[0-9+\-()#\s]{6,}$/.test(String(contact.phone))) {
    errors.contactPhone = "請填寫有效的聯絡電話。";
  }

  if (!String(contact.email || "").trim()) {
    errors.contactEmail = "請填寫聯絡 Email。";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(contact.email))) {
    errors.contactEmail = "請填寫有效的 Email。";
  }

  if (cartRequiresPaymentNote() && !String(contact.note || "").trim()) {
    errors.contactNote = "請填寫備註 / 付款確認資訊。";
  }

  ensureCartParticipantRows();
  const assignedParticipantIds = new Set();

  for (const item of items) {
    const assigned = getCartItemAssignedParticipants(item.id);
    if (assigned.length !== item.quantity) {
      errors[`assignment_${item.id}`] = `${getCartItemEvent(item)?.title || "活動"} 需要勾選 ${item.quantity} 位參加者，目前是 ${assigned.length} 位。`;
    }

    for (const participant of assigned) {
      assignedParticipantIds.add(participant.id);
    }
  }

  for (const participant of state.public.cart.participants) {
    if (!assignedParticipantIds.has(participant.id)) {
      continue;
    }

    if (!participant.name) {
      errors[`participant_${participant.id}_name`] = "請填寫參加者姓名。";
    }

    if (participant.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(participant.email)) {
      errors[`participant_${participant.id}_email`] = "Email 格式不正確。";
    }

    if (participant.phone && !/^[0-9+\-()#\s]{6,}$/.test(participant.phone)) {
      errors[`participant_${participant.id}_phone`] = "電話格式不正確。";
    }

    if (participant.idNumber && !/^[A-Z][A-Z0-9]\d{8}$/.test(participant.idNumber)) {
      errors[`participant_${participant.id}_idNumber`] = "身分證字號需要是 10 碼。";
    }
  }

  return errors;
}

function validateCarpoolSelection(event, runner) {
  const carpool = normalizeCarpoolConfig(event?.carpool);
  const selection = normalizeRunnerCarpoolSelection(runner?.carpoolSelection);
  if (!carpool.enabled || !selection.requested) {
    return "";
  }

  if (selection.quantity < 1) {
    return "請填寫共乘人數。";
  }

  const participants = Math.max(1, runner?.finalParticipantCount || computeParticipantsFromAnswers(event, runner?.answers || {}));
  if (selection.quantity > participants) {
    return `共乘人數不能超過報名總人數 ${participants} 人。`;
  }

  const remaining = event?.carpool?.remainingCapacity == null
    ? computeRemainingCarpoolCapacity(event)
    : event.carpool.remainingCapacity;
  if (remaining != null && selection.quantity > remaining) {
    return `共乘名額不足，目前只剩 ${remaining} 位。`;
  }

  return "";
}

function renderCarpoolSelector(event, runner, options = {}) {
  const carpool = normalizeCarpoolConfig(event?.carpool);
  if (!carpool.enabled) {
    return "";
  }

  const selection = normalizeRunnerCarpoolSelection(runner?.carpoolSelection);
  const participants = Math.max(1, runner?.finalParticipantCount || computeParticipantsFromAnswers(event, runner?.answers || {}));
  const remaining = event?.carpool?.remainingCapacity == null
    ? computeRemainingCarpoolCapacity(event)
    : event.carpool.remainingCapacity;
  const maxQuantity = Math.max(1, Math.min(participants, remaining ?? participants));
  const quote = getCarpoolQuote(event, selection);
  const error = options.error || "";

  return `
    <section class="price-card ${options.compact ? "price-card-compact" : ""}">
      <div class="split-row review-section-header">
        <div>
          <h4>共乘</h4>
          ${carpool.description ? `<p class="field-help">${nl2br(carpool.description)}</p>` : ""}
        </div>
        ${carpool.price != null ? `<div class="price-total-copy">${escapeHtml(formatMoney(carpool.price))} / 位</div>` : ""}
      </div>
      <div class="meta-row" style="margin-top: 12px;">
        ${
          remaining == null
            ? `<span class="meta-pill">不限名額</span>`
            : `<span class="meta-pill">剩餘 ${remaining} 位</span>`
        }
        ${quote ? `<span class="meta-pill">共乘小計 ${escapeHtml(formatMoney(quote.totalPrice))}</span>` : ""}
      </div>
      <label class="inline-checkbox" style="margin-top: 14px;">
        <input type="checkbox" data-public-carpool-field="requested" ${selection.requested ? "checked" : ""} />
        <span>我需要共乘</span>
      </label>
      ${
        selection.requested
          ? `
            <div class="field" style="margin-top: 12px;">
              <label>共乘人數</label>
              <input class="input" type="number" min="1" max="${maxQuantity}" value="${escapeHtml(selection.quantity || 1)}" data-public-carpool-field="quantity" />
            </div>
          `
          : ""
      }
      ${error ? `<div class="question-error">${escapeHtml(error)}</div>` : ""}
    </section>
  `;
}

function renderCarpoolReview(event, runner) {
  const carpool = normalizeCarpoolConfig(event?.carpool);
  if (!carpool.enabled) {
    return "";
  }

  const quote = getCarpoolQuote(event, runner?.carpoolSelection);

  return `
    <section class="review-section-card">
      <div class="review-row" style="border-top: 0; margin-top: 0; padding-top: 0;">
        <div class="review-row-copy">
          <div class="question-label">
            <span>共乘</span>
          </div>
          <div class="review-answer">
            ${
              quote
                ? `需要，共 ${quote.quantity} 位，${escapeHtml(formatMoney(quote.unitPrice))} / 位，共 ${escapeHtml(formatMoney(quote.totalPrice))}`
                : "不需要"
            }
          </div>
        </div>
        <button class="text-button" type="button" data-public-action="edit-carpool">編輯</button>
      </div>
    </section>
  `;
}

function renderCheckoutTotal(event, runner) {
  const checkout = getCheckoutTotal(event, runner?.answers || {}, runner?.carpoolSelection);
  if (!checkout) {
    return "";
  }

  return `
    <section class="price-card">
      <div class="split-row review-section-header">
        <div>
          <h4>費用總計</h4>
          <p class="field-help">包含活動費用與已選擇的共乘費用。</p>
        </div>
        <div class="price-total-copy">${escapeHtml(formatMoney(checkout.totalPrice))}</div>
      </div>
      <div class="meta-row" style="margin-top: 12px;">
        ${
          checkout.pricingQuote
            ? `<span class="meta-pill">活動 ${escapeHtml(formatMoney(checkout.pricingQuote.totalPrice))}</span>`
            : ""
        }
        ${
          checkout.carpoolQuote
            ? `<span class="meta-pill">共乘 ${escapeHtml(formatMoney(checkout.carpoolQuote.totalPrice))}</span>`
            : ""
        }
      </div>
    </section>
  `;
}

function renderCartItemTotal(item) {
  const quote = getCartItemQuote(item);
  if (!quote) {
    return "";
  }

  return `
    <div class="meta-row" style="margin-top: 10px;">
      <span class="meta-pill">${item.quantity} 人</span>
      ${
        quote.pricingQuote
          ? `<span class="meta-pill">活動 ${escapeHtml(formatMoney(quote.pricingQuote.totalPrice))}</span>`
          : ""
      }
      ${
        quote.carpoolQuote
          ? `<span class="meta-pill">共乘 ${escapeHtml(formatMoney(quote.carpoolQuote.totalPrice))}</span>`
          : ""
      }
      ${quote.totalPrice ? `<span class="meta-pill">小計 ${escapeHtml(formatMoney(quote.totalPrice))}</span>` : ""}
    </div>
  `;
}

function renderEventSpecCarpoolSelector(event, spec) {
  const carpool = normalizeCarpoolConfig(event?.carpool);
  if (!carpool.enabled) {
    return "";
  }

  const selection = normalizeRunnerCarpoolSelection(spec?.carpoolSelection);
  const quantity = normalizeCartQuantity(spec?.quantity);
  const remaining = event?.carpool?.remainingCapacity == null
    ? computeRemainingCarpoolCapacity(event)
    : event.carpool.remainingCapacity;
  const maxQuantity = Math.max(1, Math.min(quantity, remaining ?? quantity));
  const quote = getCarpoolQuote(event, selection);
  const error = spec?.errors?.carpool || "";

  return `
    <section class="price-card price-card-compact">
      <div class="split-row review-section-header">
        <div>
          <h4>共乘</h4>
          ${carpool.description ? `<p class="field-help">${nl2br(carpool.description)}</p>` : ""}
        </div>
        ${carpool.price != null ? `<div class="price-total-copy">${escapeHtml(formatMoney(carpool.price))} / 位</div>` : ""}
      </div>
      <div class="meta-row" style="margin-top: 12px;">
        ${
          remaining == null
            ? `<span class="meta-pill">不限名額</span>`
            : `<span class="meta-pill">剩餘 ${remaining} 位</span>`
        }
        ${quote ? `<span class="meta-pill">共乘小計 ${escapeHtml(formatMoney(quote.totalPrice))}</span>` : ""}
      </div>
      <label class="inline-checkbox" style="margin-top: 14px;">
        <input type="checkbox" data-public-spec-carpool-field="requested" ${selection.requested ? "checked" : ""} />
        <span>我需要共乘</span>
      </label>
      ${
        selection.requested
          ? `
            <div class="field" style="margin-top: 12px;">
              <label>共乘人數</label>
              <input class="input" type="number" min="1" max="${maxQuantity}" value="${escapeHtml(selection.quantity || 1)}" data-public-spec-carpool-field="quantity" />
            </div>
          `
          : ""
      }
      ${error ? `<div class="question-error">${escapeHtml(error)}</div>` : ""}
    </section>
  `;
}

function renderEventCartDetail(event) {
  const spec = state.public.eventSpec?.eventId === event.id
    ? state.public.eventSpec
    : createEventSpec(event);
  state.public.eventSpec = spec;

  const isFull = event.remainingCapacity === 0;
  const pricingQuote = getPricingQuoteForParticipants(event, spec.quantity);
  const carpoolQuote = getCarpoolQuote(event, spec.carpoolSelection);
  const totalPrice = roundMoney((pricingQuote?.totalPrice || 0) + (carpoolQuote?.totalPrice || 0));

  dom.publicDetail.innerHTML = `
    <div class="registration-shell">
      <div class="registration-cover">
        ${event.coverImage ? `<img data-image-role="public-detail" data-event-id="${event.id}" alt="${escapeHtml(event.title)} 封面" />` : ""}
      </div>
      <div class="chip-row">
        <span class="status-pill ${isFull ? "full" : "live"}">${isFull ? "名額已滿" : "選擇規格"}</span>
        ${
          event.remainingCapacity == null
            ? `<span class="meta-pill">不限名額</span>`
            : `<span class="meta-pill">剩餘 ${event.remainingCapacity} 人</span>`
        }
      </div>
      <h3 style="margin-top: 14px;">${escapeHtml(event.title)}</h3>
      ${event.description ? `<p class="event-description-inline">${nl2br(event.description)}</p>` : ""}
      ${
        isFull
          ? `<div class="empty-state" style="margin-top: 20px;"><h3>這個活動目前已額滿</h3></div>`
          : `
            <section class="event-spec-card">
              <div class="field">
                <label>參加人數</label>
                <input class="input" type="number" min="1" value="${escapeHtml(spec.quantity)}" data-public-spec-field="quantity" />
                ${spec.errors?.quantity ? `<div class="question-error">${escapeHtml(spec.errors.quantity)}</div>` : ""}
              </div>
              ${
                pricingQuote
                  ? `
                    <div class="price-line" style="margin-top: 12px;">
                      ${
                        pricingQuote.originalUnitPrice != null
                          ? `<span class="price-original">${escapeHtml(formatMoney(pricingQuote.originalUnitPrice))} / 人</span>`
                          : ""
                      }
                      <span class="price-current">${escapeHtml(pricingQuote.tierLabel)} ${escapeHtml(formatMoney(pricingQuote.unitPrice))} / 人</span>
                    </div>
                  `
                  : ""
              }
            </section>
            ${renderEventSpecCarpoolSelector(event, spec)}
            ${
              pricingQuote || carpoolQuote
                ? `
                  <section class="price-card">
                    <div class="split-row review-section-header">
                      <div>
                        <h4>加入購物車小計</h4>
                        <p class="field-help">結帳時會再填寫聯絡人與參加者資料。</p>
                      </div>
                      <div class="price-total-copy">${escapeHtml(formatMoney(totalPrice))}</div>
                    </div>
                    <div class="meta-row" style="margin-top: 12px;">
                      ${pricingQuote ? `<span class="meta-pill">活動 ${escapeHtml(formatMoney(pricingQuote.totalPrice))}</span>` : ""}
                      ${carpoolQuote ? `<span class="meta-pill">共乘 ${escapeHtml(formatMoney(carpoolQuote.totalPrice))}</span>` : ""}
                    </div>
                  </section>
                `
                : ""
            }
          `
      }
      <div class="action-row" style="margin-top: 24px;">
        <button class="primary-button" type="button" data-public-action="add-to-cart" ${isFull ? "disabled" : ""}>加入購物車</button>
        <button class="secondary-button" type="button" data-public-action="open-cart">查看購物車（${getCartItems().length}）</button>
        <button class="text-button" type="button" data-public-action="close">關閉</button>
      </div>
    </div>
  `;
}

function renderCartSummaryBar() {
  const itemCount = getCartItems().length;
  if (itemCount === 0) {
    return "";
  }

  const totalParticipants = getCartItems().reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = getCartTotal();

  return `
    <div class="cart-summary-bar">
      <div>
        <strong>購物車</strong>
        <span>${itemCount} 個活動，規格人數共 ${totalParticipants} 人</span>
      </div>
      <div class="action-row">
        ${totalPrice ? `<span class="price-total-copy">${escapeHtml(formatMoney(totalPrice))}</span>` : ""}
        <button class="primary-button" type="button" data-public-action="open-cart">前往結帳</button>
      </div>
    </div>
  `;
}

function renderCartItemList() {
  if (getCartItems().length === 0) {
    return `<div class="empty-state"><h3>購物車目前是空的</h3><p class="muted-text">先從活動卡選擇規格並加入購物車。</p></div>`;
  }

  return `
    <div class="cart-item-list">
      ${getCartItems()
        .map((item) => {
          const event = getCartItemEvent(item);
          const assignedCount = getCartItemAssignedParticipants(item.id).length;
          return `
            <article class="cart-item-card">
              <div>
                <h4>${escapeHtml(event?.title || "活動已不存在")}</h4>
                ${renderCartItemTotal(item)}
                <div class="meta-row" style="margin-top: 10px;">
                  <span class="meta-pill">已勾選 ${assignedCount} / ${item.quantity} 位</span>
                </div>
                ${
                  state.public.cart.errors?.[`assignment_${item.id}`]
                    ? `<div class="question-error">${escapeHtml(state.public.cart.errors[`assignment_${item.id}`])}</div>`
                    : ""
                }
              </div>
              <button class="text-button" type="button" data-public-action="remove-cart-item" data-cart-item-id="${item.id}">移除</button>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderCartParticipantEditor(participant, index) {
  const errors = state.public.cart.errors || {};
  return `
    <section class="participant-card">
      <div class="split-row review-section-header">
        <h4>參加者 ${index + 1}</h4>
        ${
          state.public.cart.participants.length > getRequiredCartParticipantCount()
            ? `<button class="text-button" type="button" data-public-action="remove-checkout-participant" data-participant-id="${participant.id}">移除</button>`
            : ""
        }
      </div>
      <div class="field-grid two">
        <div class="field">
          <label>姓名</label>
          <input class="input" type="text" value="${escapeHtml(participant.name)}" data-cart-participant-id="${participant.id}" data-cart-participant-field="name" />
          ${errors[`participant_${participant.id}_name`] ? `<div class="question-error">${escapeHtml(errors[`participant_${participant.id}_name`])}</div>` : ""}
        </div>
        <div class="field">
          <label>身分證字號</label>
          <input class="input" type="text" maxlength="10" autocapitalize="characters" spellcheck="false" value="${escapeHtml(participant.idNumber)}" data-cart-participant-id="${participant.id}" data-cart-participant-field="idNumber" />
          ${errors[`participant_${participant.id}_idNumber`] ? `<div class="question-error">${escapeHtml(errors[`participant_${participant.id}_idNumber`])}</div>` : ""}
        </div>
      </div>
      <div class="field-grid two">
        <div class="field">
          <label>電話</label>
          <input class="input" type="tel" value="${escapeHtml(participant.phone)}" data-cart-participant-id="${participant.id}" data-cart-participant-field="phone" placeholder="可留空，留空時以聯絡人電話為主" />
          ${errors[`participant_${participant.id}_phone`] ? `<div class="question-error">${escapeHtml(errors[`participant_${participant.id}_phone`])}</div>` : ""}
        </div>
        <div class="field">
          <label>Email</label>
          <input class="input" type="email" value="${escapeHtml(participant.email)}" data-cart-participant-id="${participant.id}" data-cart-participant-field="email" placeholder="可留空，留空時以聯絡人 Email 為主" />
          ${errors[`participant_${participant.id}_email`] ? `<div class="question-error">${escapeHtml(errors[`participant_${participant.id}_email`])}</div>` : ""}
        </div>
      </div>
      <div class="assignment-grid">
        ${getCartItems()
          .map((item) => {
            const event = getCartItemEvent(item);
            const checked = participant.assignedItemIds.includes(item.id);
            return `
              <label class="option-chip ${checked ? "active" : ""}">
                <input type="checkbox" data-cart-assignment-item-id="${item.id}" data-cart-participant-id="${participant.id}" ${checked ? "checked" : ""} />
                <span>${escapeHtml(event?.title || "活動已不存在")}</span>
              </label>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function renderCartCheckout() {
  ensureCartParticipantRows();
  const cart = state.public.cart;
  const errors = cart.errors || {};

  if (cart.success) {
    dom.publicDetail.innerHTML = `
      <div class="registration-shell">
        <div class="empty-state">
          <h3>結帳完成</h3>
          <p class="muted-text">訂單編號：${escapeHtml(cart.success.orderId)}</p>
          ${cart.success.totalPrice ? `<p class="price-total-copy" style="margin-top: 10px;">${escapeHtml(formatMoney(cart.success.totalPrice))}</p>` : ""}
        </div>
        <div class="action-row" style="margin-top: 24px;">
          <button class="primary-button" type="button" data-public-action="checkout-reset">繼續選活動</button>
          <button class="text-button" type="button" data-public-action="close">關閉</button>
        </div>
      </div>
    `;
    return;
  }

  dom.publicDetail.innerHTML = `
    <div class="registration-shell cart-checkout-shell">
      <div class="chip-row">
        <span class="status-pill live">購物車結帳</span>
        <span class="meta-pill">${getCartItems().length} 個活動</span>
      </div>
      <h3 style="margin-top: 14px;">確認購物車</h3>
      ${errors.cart ? `<div class="question-error">${escapeHtml(errors.cart)}</div>` : ""}
      ${renderCartItemList()}

      ${
        getCartItems().length
          ? `
            <section class="review-section-card">
              <div class="split-row review-section-header">
                <div>
                  <h4>聯絡人資料</h4>
                  <p class="field-help">這是整筆訂單的主要聯絡資訊。</p>
                </div>
              </div>
              <div class="field-grid two">
                <div class="field">
                  <label>聯絡人姓名</label>
                  <input class="input" type="text" value="${escapeHtml(cart.contact.name)}" data-cart-contact-field="name" />
                  ${errors.contactName ? `<div class="question-error">${escapeHtml(errors.contactName)}</div>` : ""}
                </div>
                <div class="field">
                  <label>聯絡電話</label>
                  <input class="input" type="tel" value="${escapeHtml(cart.contact.phone)}" data-cart-contact-field="phone" />
                  ${errors.contactPhone ? `<div class="question-error">${escapeHtml(errors.contactPhone)}</div>` : ""}
                </div>
              </div>
              <div class="field-grid two">
                <div class="field">
                  <label>聯絡 Email</label>
                  <input class="input" type="email" value="${escapeHtml(cart.contact.email)}" data-cart-contact-field="email" />
                  ${errors.contactEmail ? `<div class="question-error">${escapeHtml(errors.contactEmail)}</div>` : ""}
                </div>
                <div class="field">
                  <label>備註 / 付款確認資訊${cartRequiresPaymentNote() ? " *" : ""}</label>
                  <input class="input" type="text" value="${escapeHtml(cart.contact.note)}" data-cart-contact-field="note" placeholder="例如匯款後五碼、飲食備註等" />
                  ${errors.contactNote ? `<div class="question-error">${escapeHtml(errors.contactNote)}</div>` : ""}
                </div>
              </div>
            </section>

            <section class="review-section-card">
              <div class="split-row review-section-header">
                <div>
                  <h4>參加者與活動分配</h4>
                  <p class="field-help">每位參加者可以勾選多個活動；每個活動勾選人數需等於購物車規格人數。</p>
                </div>
                <button class="secondary-button" type="button" data-public-action="add-checkout-participant">新增參加者</button>
              </div>
              ${cart.participants.map((participant, index) => renderCartParticipantEditor(participant, index)).join("")}
            </section>

            <section class="price-card">
              <div class="split-row review-section-header">
                <div>
                  <h4>訂單總計</h4>
                  <p class="field-help">包含購物車內活動費用與共乘費用。</p>
                </div>
                <div class="price-total-copy">${escapeHtml(formatMoney(getCartTotal()))}</div>
              </div>
            </section>
          `
          : ""
      }

      <div class="action-row" style="margin-top: 24px;">
        <button class="primary-button" type="button" data-public-action="checkout-submit" ${cart.submitting || getCartItems().length === 0 ? "disabled" : ""}>
          ${cart.submitting ? "送出中..." : "送出整筆訂單"}
        </button>
        <button class="secondary-button" type="button" data-public-action="close">繼續選活動</button>
      </div>
    </div>
  `;
}

function renderPricingSummary(event, answers, options = {}) {
  const quote = getPricingQuote(event, answers, options.referenceTime);
  const pricing = normalizePricingConfig(event?.pricing);
  const showConfirmationField = Boolean(options.showConfirmationField && pricing.confirmationFieldEnabled);
  if (!quote && !showConfirmationField) {
    return "";
  }

  const confirmationValue = options.confirmationValue || "";
  const confirmationError = options.confirmationError || "";

  return `
    <section class="price-card ${options.compact ? "price-card-compact" : ""}">
      <div class="split-row review-section-header">
        <div>
          <h4>${escapeHtml(options.title || "價格確認")}</h4>
          <p class="field-help">${
            quote
              ? "系統會依人數、早鳥時間與團體條件自動套用最合適的價格。"
              : "目前尚未設定可套用的價格，但你仍可使用下方確認欄位。"
          }</p>
        </div>
        ${
          quote
            ? `<div class="price-total-copy">${escapeHtml(formatMoney(quote.totalPrice))}</div>`
            : ""
        }
      </div>
      ${
        quote
          ? `
            <div class="price-line">
              ${
                quote.originalUnitPrice != null
                  ? `<span class="price-original">${escapeHtml(formatMoney(quote.originalUnitPrice))} / 人</span>`
                  : ""
              }
              <span class="price-current">${escapeHtml(quote.tierLabel)} ${escapeHtml(formatMoney(quote.unitPrice))} / 人</span>
            </div>
            <div class="meta-row" style="margin-top: 12px;">
              <span class="meta-pill">${quote.participants} 人</span>
              <span class="meta-pill">${escapeHtml(quote.tierLabel)}</span>
              <span class="meta-pill">總計 ${escapeHtml(formatMoney(quote.totalPrice))}</span>
            </div>
          `
          : ""
      }
      ${
        showConfirmationField
          ? `
            <div class="field" style="margin-top: 16px;">
              <label>${escapeHtml(pricing.confirmationFieldLabel || "確認欄位")}</label>
              <input
                class="input"
                type="text"
                value="${escapeHtml(confirmationValue)}"
                placeholder="${escapeHtml(pricing.confirmationFieldPlaceholder || "")}"
                data-public-pricing-confirmation="true"
              />
              ${
                confirmationError
                  ? `<div class="question-error">${escapeHtml(confirmationError)}</div>`
                  : ""
              }
            </div>
          `
          : ""
      }
    </section>
  `;
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

  async submitRegistration(
    eventId,
    answers,
    repeatedAnswers = [],
    pricingConfirmationValue = "",
    carpoolSelection = {},
  ) {
    return requestRemote("register", {
      method: "POST",
      body: JSON.stringify({
        eventId,
        answers,
        repeatedAnswers,
        pricingConfirmationValue,
        carpoolSelection,
      }),
    });
  },

  async checkoutCart(items, contact, participants) {
    return requestRemote("checkout", {
      method: "POST",
      body: JSON.stringify({
        items,
        contact,
        participants,
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
    returnToReview: false,
    pricingConfirmationValue: "",
    carpoolSelection: {
      requested: false,
      quantity: 0,
    },
    reviewErrors: {},
    submitting: false,
    submitted: false,
    success: null,
  };
}

function selectPublicEvent(eventId) {
  const event = state.public.events.find((entry) => entry.id === eventId);
  if (!event) {
    return;
  }

  state.public.selectedEventId = eventId;
  state.public.modalMode = "event";
  state.public.eventSpec = createEventSpec(event);
  state.public.runner = null;
  dom.publicOverlay.classList.remove("hidden");
  dom.publicOverlay.setAttribute("aria-hidden", "false");
  renderPublic();
}

function closePublicEvent() {
  state.public.selectedEventId = null;
  state.public.modalMode = null;
  state.public.eventSpec = null;
  state.public.runner = null;
  dom.publicOverlay.classList.add("hidden");
  dom.publicOverlay.setAttribute("aria-hidden", "true");
  renderPublic();
}

function openCartCheckout() {
  state.public.selectedEventId = null;
  state.public.modalMode = "cart";
  state.public.eventSpec = null;
  state.public.cart.errors = {};
  ensureCartParticipantRows({ autoAssign: true });
  dom.publicOverlay.classList.remove("hidden");
  dom.publicOverlay.setAttribute("aria-hidden", "false");
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

  dom.eventList.innerHTML = `
    ${renderCartSummaryBar()}
    ${state.public.events
    .map((event) => {
      const isSelected = event.id === state.public.selectedEventId;
      const remaining = event.remainingCapacity;
      const isFull = remaining === 0;
      const actionLabel = isFull ? "查看活動" : "選擇規格";

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
                ${isSelected ? "開啟活動" : actionLabel}
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join("")}
  `;
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
    idNumber: "text",
    number: "number",
    date: "date",
  };

  const inputValue =
    question.type === "idNumber"
      ? normalizeAnswerForQuestion(question, value)
      : value || "";

  return `
    <input
      class="input"
      type="${typeMap[question.type] || "text"}"
      data-public-question="${question.id}"
      value="${escapeHtml(inputValue)}"
      placeholder="${escapeHtml(question.placeholder || "")}"
      ${question.type === "idNumber" ? `maxlength="10" autocapitalize="characters" spellcheck="false"` : ""}
    />
    ${error ? `<div class="question-error">${escapeHtml(error)}</div>` : ""}
  `;
}

function renderPublicDetail() {
  if (state.public.modalMode === "cart") {
    renderCartCheckout();
    return;
  }

  const event = getSelectedPublicEvent();

  if (!event) {
    dom.publicDetail.innerHTML = "";
    return;
  }

  if (state.public.modalMode === "event") {
    renderEventCartDetail(event);
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

  if (runner?.stage === "review") {
    const reviewSections = getReviewSections(event, runner);
    const totalParticipants = Math.max(1, runner.finalParticipantCount || 1);
    const reviewErrors = runner.reviewErrors || {};

    dom.publicDetail.innerHTML = `
      <div class="registration-shell">
        <div class="registration-cover">
          ${event.coverImage ? `<img data-image-role="public-detail" data-event-id="${event.id}" alt="${escapeHtml(event.title)} 封面" />` : ""}
        </div>
        <div class="chip-row">
          <span class="status-pill ${isFull ? "full" : "live"}">${isFull ? "名額已滿" : "確認資料"}</span>
          <span class="meta-pill">${totalParticipants} 人</span>
          ${
            event.remainingCapacity == null
              ? ""
              : `<span class="meta-pill">剩餘 ${event.remainingCapacity} 人</span>`
          }
        </div>
        <h3 style="margin-top: 14px;">${escapeHtml(event.title)}</h3>
        <p class="page-description" style="margin-top: 12px;">送出前再確認一次資料，如果有誤可以直接點該題的編輯。</p>
        <div class="progress-track">
          <div class="progress-bar" style="width: 100%"></div>
        </div>
        <div class="review-list">
          ${reviewSections
            .map(
              (section) => `
                <section class="review-section-card">
                  <div class="split-row review-section-header">
                    <div>
                      <h4>${escapeHtml(section.title)}</h4>
                      ${section.description ? `<p class="field-help">${nl2br(section.description)}</p>` : ""}
                    </div>
                  </div>
                  <div class="review-item-list">
                    ${section.items
                      .map(
                        (item) => `
                          <div class="review-row">
                            <div class="review-row-copy">
                              <div class="question-label">
                                <span>${escapeHtml(item.question.label)}</span>
                                ${item.question.required ? `<span class="required-badge">*</span>` : ""}
                              </div>
                              <div class="review-answer">${nl2br(formatSubmissionAnswer(item.question, item.answer) || "未填寫")}</div>
                            </div>
                            <button class="text-button" type="button" data-public-action="${item.action}" ${item.dataAttributes}>
                              ${item.actionLabel}
                            </button>
                          </div>
                        `,
                      )
                      .join("")}
                  </div>
                </section>
              `,
            )
            .join("")}
        </div>
        ${
          hasPricingFeatureEnabled(event)
            ? renderPricingSummary(event, runner.answers, {
                title: "價格確認",
                showConfirmationField: true,
                confirmationValue: runner.pricingConfirmationValue,
                confirmationError: reviewErrors.pricingConfirmation,
              })
            : ""
        }
        ${hasCarpoolFeatureEnabled(event) ? renderCarpoolReview(event, runner) : ""}
        ${renderCheckoutTotal(event, runner)}
        ${reviewErrors.carpool ? `<div class="question-error">${escapeHtml(reviewErrors.carpool)}</div>` : ""}
        <div class="action-row" style="margin-top: 24px;">
          <button class="secondary-button" type="button" data-public-action="review-back">返回上一段</button>
          <button class="primary-button" type="button" data-public-action="submit" ${runner.submitting ? "disabled" : ""}>
            ${runner.submitting ? "送出中..." : "確認送出"}
          </button>
          <button class="text-button" type="button" data-public-action="restart">重新開始</button>
          <button class="text-button" type="button" data-public-action="close">關閉</button>
        </div>
      </div>
    `;
    return;
  }

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
          hasPricingFeatureEnabled(event)
            ? renderPricingSummary(event, runner.answers, {
                title: "目前價格試算",
                compact: true,
              })
            : ""
        }
        ${
          hasCarpoolFeatureEnabled(event)
            ? renderCarpoolSelector(event, runner, {
                compact: true,
                error: runner.errors?.__carpool__,
              })
            : ""
        }
        ${getCarpoolQuote(event, runner.carpoolSelection) ? renderCheckoutTotal(event, runner) : ""}
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
                      : runner.returnToReview
                        ? "回確認頁"
                        : isFinalRepeatParticipant
                        ? "確認資料"
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
  const pricingAnchorQuestionId = currentPage.questions.find(
    (question) => question.countsTowardCapacity,
  )?.id;
  const showPricingPreview =
    hasPricingFeatureEnabled(event) && hasParticipantCountInput(event, runner.answers);

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
                    ${
                      showPricingPreview && question.id === pricingAnchorQuestionId
                        ? renderPricingSummary(event, runner.answers, {
                            title: "目前價格試算",
                            compact: true,
                          })
                        : ""
                    }
                  </div>
                `;
              })
              .join("")}
            ${
              isFinalPage && hasCarpoolFeatureEnabled(event)
                ? renderCarpoolSelector(event, runner, {
                    error: runner.errors?.__carpool__,
                  })
                : ""
            }
            ${isFinalPage && getCarpoolQuote(event, runner.carpoolSelection) ? renderCheckoutTotal(event, runner) : ""}
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
                    : runner.returnToReview
                      ? "回確認頁"
                    : isFinalPage
                      ? needsRepeatedQuestions
                        ? "下一位同行"
                        : "確認資料"
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

  const pricingColumns = [];
  const hasPricingData = (event.submissions || []).some((submission) => submission.pricing);
  if (hasPricingData) {
    pricingColumns.push(
      { kind: "pricing", field: "tierLabel", header: "價格方案" },
      { kind: "pricing", field: "unitPrice", header: "單價" },
      { kind: "pricing", field: "originalUnitPrice", header: "原價" },
      { kind: "pricing", field: "totalPrice", header: "價格總計" },
    );

    const confirmationLabel =
      normalizePricingConfig(event.pricing).confirmationFieldLabel ||
      (event.submissions || []).find((submission) => submission.pricing?.confirmationFieldLabel)
        ?.pricing?.confirmationFieldLabel ||
      "確認欄位";

    if ((event.submissions || []).some((submission) => submission.pricing?.confirmationValue)) {
      pricingColumns.push({
        kind: "pricing",
        field: "confirmationValue",
        header: confirmationLabel,
      });
    }
  }

  const carpoolColumns = [];
  const hasCarpoolData = (event.submissions || []).some((submission) => submission.carpool);
  if (hasCarpoolData) {
    carpoolColumns.push(
      { kind: "carpool", field: "quantity", header: "共乘人數" },
      { kind: "carpool", field: "unitPrice", header: "共乘單價" },
      { kind: "carpool", field: "totalPrice", header: "共乘小計" },
    );
  }

  const cartColumns = [];
  const hasCartData = (event.submissions || []).some((submission) => submission.cart);
  if (hasCartData) {
    cartColumns.push(
      { kind: "cart", field: "orderId", header: "訂單編號" },
      { kind: "cart", field: "contactName", header: "聯絡人" },
      { kind: "cart", field: "contactPhone", header: "聯絡電話" },
      { kind: "cart", field: "contactEmail", header: "聯絡 Email" },
      { kind: "cart", field: "participants", header: "參加者" },
    );
  }

  return [...cartColumns, ...baseColumns, ...repeatedColumns, ...pricingColumns, ...carpoolColumns];
}

function formatCartParticipants(participants) {
  return (participants || [])
    .map((participant) => {
      const details = [
        participant.name,
        participant.idNumber ? `身分證 ${participant.idNumber}` : "",
        participant.phone ? `電話 ${participant.phone}` : "",
        participant.email ? `Email ${participant.email}` : "",
      ].filter(Boolean);
      return details.join(" / ");
    })
    .filter(Boolean)
    .join("\n");
}

function getCartSubmissionValue(submission, field) {
  const cart = submission.cart;
  if (!cart) {
    return "";
  }

  if (field === "orderId") {
    return cart.orderId || "";
  }

  if (field === "contactName") {
    return cart.contact?.name || "";
  }

  if (field === "contactPhone") {
    return cart.contact?.phone || "";
  }

  if (field === "contactEmail") {
    return cart.contact?.email || "";
  }

  if (field === "participants") {
    return formatCartParticipants(cart.participants || []);
  }

  return "";
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
          if (column.kind === "cart") {
            return getCartSubmissionValue(submission, column.field);
          }

          if (column.kind === "pricing") {
            const pricingValue = submission.pricing?.[column.field];
            if (column.field === "unitPrice" || column.field === "originalUnitPrice" || column.field === "totalPrice") {
              return pricingValue == null ? "" : formatMoney(pricingValue);
            }
            return pricingValue == null ? "" : String(pricingValue);
          }

          if (column.kind === "carpool") {
            const carpoolValue = submission.carpool?.[column.field];
            if (column.field === "unitPrice" || column.field === "totalPrice") {
              return carpoolValue == null ? "" : formatMoney(carpoolValue);
            }
            return carpoolValue == null ? "" : String(carpoolValue);
          }

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

function hasAnySubmissions(events = state.admin.events) {
  return (events || []).some((event) => normalizeEvent(event).submissions.length > 0);
}

function getSubmissionAnswerSummary(event, submission) {
  const { columns } = getSubmissionRows(event);
  return columns
    .filter((column) => !["pricing", "carpool", "cart"].includes(column.kind))
    .map((column) => {
      let value = "";
      if (column.participantNumber) {
        const repeatedEntry = (submission.repeatedAnswers || []).find(
          (entry) => entry.participantNumber === column.participantNumber,
        );
        value = formatSubmissionAnswer(column.question, repeatedEntry?.answers?.[column.question.id]);
      } else {
        value = formatSubmissionAnswer(column.question, submission.answers?.[column.question.id]);
      }
      return value ? `${column.header}：${value}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function exportAllSubmissionsToExcel() {
  const events = (state.admin.events || []).map((event) => normalizeEvent(event));
  const rows = events.flatMap((event) =>
    [...(event.submissions || [])]
      .sort((left, right) => String(right.submittedAt).localeCompare(String(left.submittedAt)))
      .map((submission) => {
        const activityTotal = submission.pricing?.totalPrice || 0;
        const carpoolTotal = submission.carpool?.totalPrice || 0;
        const total = activityTotal + carpoolTotal;
        return {
          eventTitle: event.title,
          orderId: submission.cart?.orderId || "",
          submittedAt: formatDate(submission.submittedAt),
          totalParticipants: submission.totalParticipants,
          contactName: submission.cart?.contact?.name || "",
          contactPhone: submission.cart?.contact?.phone || "",
          contactEmail: submission.cart?.contact?.email || "",
          participants: formatCartParticipants(submission.cart?.participants || []),
          pricingTier: submission.pricing?.tierLabel || "",
          activityTotal: activityTotal ? formatMoney(activityTotal) : "",
          carpoolQuantity: submission.carpool?.quantity || "",
          carpoolTotal: carpoolTotal ? formatMoney(carpoolTotal) : "",
          total: total ? formatMoney(total) : "",
          answers: getSubmissionAnswerSummary(event, submission),
        };
      }),
  );

  if (rows.length === 0) {
    showToast("目前沒有可匯出的報名資料。");
    return;
  }

  const headers = [
    "活動名稱",
    "訂單編號",
    "送出時間",
    "報名人數",
    "聯絡人",
    "聯絡電話",
    "聯絡 Email",
    "參加者",
    "價格方案",
    "活動費用",
    "共乘人數",
    "共乘費用",
    "總計",
    "表單答案",
  ];
  const html = `
    <!DOCTYPE html>
    <html lang="zh-Hant">
      <head>
        <meta charset="UTF-8" />
      </head>
      <body>
        <table border="1">
          <thead>
            <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (row) => `
                  <tr>
                    <td>${escapeHtml(row.eventTitle)}</td>
                    <td>${escapeHtml(row.orderId || "-")}</td>
                    <td>${escapeHtml(row.submittedAt)}</td>
                    <td>${row.totalParticipants}</td>
                    <td>${escapeHtml(row.contactName || "-")}</td>
                    <td>${escapeHtml(row.contactPhone || "-")}</td>
                    <td>${escapeHtml(row.contactEmail || "-")}</td>
                    <td>${nl2br(row.participants || "-")}</td>
                    <td>${escapeHtml(row.pricingTier || "-")}</td>
                    <td>${escapeHtml(row.activityTotal || "-")}</td>
                    <td>${escapeHtml(row.carpoolQuantity || "-")}</td>
                    <td>${escapeHtml(row.carpoolTotal || "-")}</td>
                    <td>${escapeHtml(row.total || "-")}</td>
                    <td>${nl2br(row.answers || "-")}</td>
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
  link.download = "全部活動-報名資料.xls";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("全部活動報名資料已匯出。");
}

function renderPricingEditor(event) {
  const pricing = normalizePricingConfig(event?.pricing);

  return `
    <div class="editor-card">
      <div class="section-header">
        <div>
          <h3>價格設定</h3>
          <p class="field-help">整包功能可選擇開啟；關閉時前台不會顯示任何價格內容。</p>
        </div>
        <label class="inline-checkbox">
          <input type="checkbox" data-pricing-field="enabled" ${pricing.enabled ? "checked" : ""} />
          <span>啟用價格功能</span>
        </label>
      </div>
      ${
        pricing.enabled
          ? `
            <div class="field-grid two">
              <div class="field">
                <label>原價</label>
                <input class="input" type="number" min="0" step="0.01" value="${escapeHtml(pricing.originalPrice ?? "")}" data-pricing-field="originalPrice" placeholder="例如 1200" />
              </div>
              <div class="field">
                <label>目前售價 / 優惠價</label>
                <input class="input" type="number" min="0" step="0.01" value="${escapeHtml(pricing.discountPrice ?? "")}" data-pricing-field="discountPrice" placeholder="例如 999" />
                <p class="field-help">若只填原價不填優惠價，系統會以原價計算。</p>
              </div>
            </div>

            <div class="subtle-divider"></div>

            <div class="field-grid two">
              <div class="field">
                <label class="inline-checkbox">
                  <input type="checkbox" data-pricing-field="groupEnabled" ${pricing.groupEnabled ? "checked" : ""} />
                  <span>啟用團體價</span>
                </label>
                <input class="input" type="number" min="1" value="${escapeHtml(pricing.groupThreshold ?? "")}" data-pricing-field="groupThreshold" placeholder="滿幾人啟用" />
              </div>
              <div class="field">
                <label>團體價</label>
                <input class="input" type="number" min="0" step="0.01" value="${escapeHtml(pricing.groupPrice ?? "")}" data-pricing-field="groupPrice" placeholder="例如 850" />
                <p class="field-help">當報名總人數達到門檻時，系統會自動比較並套用較低單價。</p>
              </div>
            </div>

            <div class="field-grid two">
              <div class="field">
                <label class="inline-checkbox">
                  <input type="checkbox" data-pricing-field="earlyBirdEnabled" ${pricing.earlyBirdEnabled ? "checked" : ""} />
                  <span>啟用早鳥價</span>
                </label>
                <input class="input" type="datetime-local" value="${escapeHtml(formatDateTimeLocal(pricing.earlyBirdDeadline))}" data-pricing-field="earlyBirdDeadline" />
              </div>
              <div class="field">
                <label>早鳥價</label>
                <input class="input" type="number" min="0" step="0.01" value="${escapeHtml(pricing.earlyBirdPrice ?? "")}" data-pricing-field="earlyBirdPrice" placeholder="例如 900" />
                <p class="field-help">若早鳥與團體條件同時成立，系統會自動套用較低價格。</p>
              </div>
            </div>

            <div class="subtle-divider"></div>

            <div class="field-grid two">
              <div class="field">
                <label class="inline-checkbox">
                  <input type="checkbox" data-pricing-field="confirmationFieldEnabled" ${pricing.confirmationFieldEnabled ? "checked" : ""} />
                  <span>確認頁顯示自訂輸入欄</span>
                </label>
                <input class="input" type="text" value="${escapeHtml(pricing.confirmationFieldLabel)}" data-pricing-field="confirmationFieldLabel" placeholder="例如：匯款後五碼 / 備註" />
              </div>
              <div class="field">
                <label>輸入框提示文字</label>
                <input class="input" type="text" value="${escapeHtml(pricing.confirmationFieldPlaceholder)}" data-pricing-field="confirmationFieldPlaceholder" placeholder="例如：請輸入匯款後五碼" />
                <label class="inline-checkbox" style="margin-top: 10px;">
                  <input type="checkbox" data-pricing-field="confirmationFieldRequired" ${pricing.confirmationFieldRequired ? "checked" : ""} />
                  <span>這個確認欄位必填</span>
                </label>
              </div>
            </div>
          `
          : `<div class="empty-state"><h4>目前未啟用價格功能</h4><p class="muted-text">前台將維持現在的純報名表單樣式，不顯示價格與試算。</p></div>`
      }
    </div>
  `;
}

function renderCarpoolEditor(event) {
  const carpool = normalizeCarpoolConfig(event?.carpool);
  const remainingCapacity =
    event?.carpool?.remainingCapacity == null
      ? computeRemainingCarpoolCapacity(event)
      : event.carpool.remainingCapacity;

  return `
    <div class="editor-card">
      <div class="section-header">
        <div>
          <h3>共乘設定</h3>
          <p class="field-help">選擇性開啟；關閉時前台不會顯示共乘選項。</p>
        </div>
        <label class="inline-checkbox">
          <input type="checkbox" data-carpool-field="enabled" ${carpool.enabled ? "checked" : ""} />
          <span>啟用共乘</span>
        </label>
      </div>
      ${
        carpool.enabled
          ? `
            <div class="field-grid two">
              <div class="field">
                <label>共乘單價</label>
                <input class="input" type="number" min="0" step="0.01" value="${escapeHtml(carpool.price ?? "")}" data-carpool-field="price" placeholder="例如 200" />
              </div>
              <div class="field">
                <label>共乘數量上限</label>
                <input class="input" type="number" min="1" value="${escapeHtml(carpool.capacity ?? "")}" data-carpool-field="capacity" placeholder="留空代表不限名額" />
                <p class="field-help">${
                  remainingCapacity == null
                    ? "目前不限共乘名額。"
                    : `目前剩餘 ${remainingCapacity} 位共乘名額。`
                }</p>
              </div>
            </div>
            <div class="field">
              <label>共乘說明</label>
              <textarea class="textarea" data-carpool-field="description" placeholder="例如：集合地點、時間、車資包含項目">${escapeHtml(carpool.description)}</textarea>
            </div>
          `
          : `<div class="empty-state"><h4>目前未啟用共乘</h4><p class="muted-text">前台將不會出現共乘選項，也不會計算共乘費用。</p></div>`
      }
    </div>
  `;
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
              ${
                hasAnySubmissions()
                  ? `<button class="secondary-button" type="button" data-admin-action="export-all-submissions">匯出全部 Excel</button>`
                  : ""
              }
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

        ${renderPricingEditor(draft)}
        ${renderCarpoolEditor(draft)}

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

function updateDraftPricingField(field, value, checked, shouldRender = false) {
  if (!state.admin.draft) {
    return;
  }

  const pricing = state.admin.draft.pricing || createPricingConfig();
  const checkboxFields = new Set([
    "enabled",
    "groupEnabled",
    "earlyBirdEnabled",
    "confirmationFieldEnabled",
    "confirmationFieldRequired",
  ]);
  const moneyFields = new Set(["originalPrice", "discountPrice", "groupPrice", "earlyBirdPrice"]);

  if (checkboxFields.has(field)) {
    pricing[field] = checked;
  } else if (field === "groupThreshold") {
    pricing.groupThreshold =
      value === "" ? null : Math.max(1, Number.parseInt(value, 10) || 0) || null;
  } else if (moneyFields.has(field)) {
    pricing[field] = normalizeMoneyValue(value);
  } else if (field === "earlyBirdDeadline") {
    pricing.earlyBirdDeadline = normalizeDateTimeValue(value);
  } else {
    pricing[field] = String(value || "");
  }

  state.admin.draft.pricing = normalizePricingConfig(pricing);
  markDraftDirty(shouldRender);
}

function updateDraftCarpoolField(field, value, checked, shouldRender = false) {
  if (!state.admin.draft) {
    return;
  }

  const carpool = state.admin.draft.carpool || createCarpoolConfig();

  if (field === "enabled") {
    carpool.enabled = checked;
  } else if (field === "price") {
    carpool.price = normalizeMoneyValue(value);
  } else if (field === "capacity") {
    carpool.capacity =
      value === "" ? null : Math.max(1, Number.parseInt(value, 10) || 0) || null;
  } else {
    carpool[field] = String(value || "");
  }

  state.admin.draft.carpool = normalizeCarpoolConfig(carpool);
  markDraftDirty(shouldRender);
}

function updateEventSpecField(field, value, shouldRender = false) {
  const event = getSelectedPublicEvent();
  if (!event || !state.public.eventSpec) {
    return;
  }

  if (field === "quantity") {
    const quantity = normalizeCartQuantity(value);
    state.public.eventSpec.quantity = quantity;
    const currentCarpool = normalizeRunnerCarpoolSelection(state.public.eventSpec.carpoolSelection);
    if (currentCarpool.requested && currentCarpool.quantity > quantity) {
      currentCarpool.quantity = quantity;
    }
    state.public.eventSpec.carpoolSelection = currentCarpool;
  }

  state.public.eventSpec.errors = {
    ...state.public.eventSpec.errors,
    [field]: "",
  };

  if (shouldRender) {
    renderPublicDetail();
  }
}

function updateEventSpecCarpoolSelection(field, value, checked, shouldRender = false) {
  const event = getSelectedPublicEvent();
  if (!event || !state.public.eventSpec) {
    return;
  }

  const current = normalizeRunnerCarpoolSelection(state.public.eventSpec.carpoolSelection);

  if (field === "requested") {
    current.requested = checked;
    current.quantity = checked ? Math.max(1, Math.min(current.quantity || 1, state.public.eventSpec.quantity)) : 0;
  } else if (field === "quantity") {
    current.requested = true;
    current.quantity = Math.max(1, Number.parseInt(value, 10) || 1);
  }

  state.public.eventSpec.carpoolSelection = current;
  state.public.eventSpec.errors = {
    ...state.public.eventSpec.errors,
    carpool: "",
  };

  if (shouldRender) {
    renderPublicDetail();
  }
}

function addSelectedEventToCart() {
  const event = getSelectedPublicEvent();
  const spec = state.public.eventSpec;
  if (!event || !spec) {
    return;
  }

  spec.quantity = normalizeCartQuantity(spec.quantity);
  spec.carpoolSelection = normalizeRunnerCarpoolSelection(spec.carpoolSelection);
  spec.errors = validateEventSpec(event, spec);

  if (Object.keys(spec.errors).length) {
    renderPublicDetail();
    return;
  }

  const existing = state.public.cart.items.find((item) => item.eventId === event.id);
  if (existing) {
    existing.quantity = spec.quantity;
    existing.carpoolSelection = spec.carpoolSelection;
  } else {
    state.public.cart.items.push({
      id: createId("cart_item"),
      eventId: event.id,
      quantity: spec.quantity,
      carpoolSelection: spec.carpoolSelection,
    });
  }

  state.public.cart.success = null;
  ensureCartParticipantRows({ autoAssign: true });
  showToast(existing ? "已更新購物車規格。" : "已加入購物車。");
  openCartCheckout();
}

function removeCartItem(itemId) {
  state.public.cart.items = getCartItems().filter((item) => item.id !== itemId);
  for (const participant of state.public.cart.participants) {
    participant.assignedItemIds = (participant.assignedItemIds || []).filter((id) => id !== itemId);
  }
  state.public.cart.errors = {};
  ensureCartParticipantRows({ autoAssign: true });
  renderPublic();
}

function updateCartContactField(field, value, shouldRender = false) {
  state.public.cart.contact = {
    ...state.public.cart.contact,
    [field]: String(value || ""),
  };
  state.public.cart.errors = {
    ...state.public.cart.errors,
    [`contact${field.charAt(0).toUpperCase()}${field.slice(1)}`]: "",
  };

  if (shouldRender) {
    renderPublicDetail();
  }
}

function updateCartParticipantField(participantId, field, value, shouldRender = false) {
  ensureCartParticipantRows();
  const participant = state.public.cart.participants.find((entry) => entry.id === participantId);
  if (!participant) {
    return;
  }

  participant[field] =
    field === "idNumber"
      ? String(value || "").trim().toUpperCase().replace(/[\s-]/g, "")
      : String(value || "");
  state.public.cart.errors = {
    ...state.public.cart.errors,
    [`participant_${participantId}_${field}`]: "",
  };

  if (shouldRender) {
    renderPublicDetail();
  }
}

function toggleCartAssignment(participantId, itemId, checked, shouldRender = false) {
  ensureCartParticipantRows();
  const participant = state.public.cart.participants.find((entry) => entry.id === participantId);
  if (!participant) {
    return;
  }

  const assigned = new Set(participant.assignedItemIds || []);
  if (checked) {
    assigned.add(itemId);
  } else {
    assigned.delete(itemId);
  }
  participant.assignedItemIds = [...assigned];
  state.public.cart.errors = {
    ...state.public.cart.errors,
    [`assignment_${itemId}`]: "",
  };

  if (shouldRender) {
    renderPublicDetail();
  }
}

function addCartParticipant() {
  state.public.cart.participants.push(createCartParticipant(state.public.cart.participants.length));
  renderPublicDetail();
}

function removeCartParticipant(participantId) {
  if (state.public.cart.participants.length <= getRequiredCartParticipantCount()) {
    return;
  }

  state.public.cart.participants = state.public.cart.participants.filter(
    (participant) => participant.id !== participantId,
  );
  state.public.cart.errors = {};
  renderPublicDetail();
}

async function submitCartCheckout() {
  if (state.public.cart.submitting) {
    return;
  }

  const errors = validateCartCheckout();
  if (Object.keys(errors).length) {
    state.public.cart.errors = errors;
    renderPublicDetail();
    return;
  }

  state.public.cart.submitting = true;
  state.public.cart.errors = {};
  renderPublicDetail();

  try {
    const payload = await api.checkoutCart(
      getCartItems().map((item) => ({
        clientItemId: item.id,
        eventId: item.eventId,
        quantity: item.quantity,
        carpoolSelection: normalizeRunnerCarpoolSelection(item.carpoolSelection),
      })),
      state.public.cart.contact,
      state.public.cart.participants.map((participant, index) => {
        const normalized = normalizeCartParticipant(participant, index);
        return {
          id: normalized.id,
          name: normalized.name,
          phone: normalized.phone,
          email: normalized.email,
          idNumber: normalized.idNumber,
          assignedItemIds: normalized.assignedItemIds,
        };
      }),
    );

    state.public.cart = {
      items: [],
      contact: {
        name: "",
        phone: "",
        email: "",
        note: "",
      },
      participants: [],
      errors: {},
      submitting: false,
      success: {
        orderId: payload.orderId,
        totalPrice: payload.totalPrice,
      },
    };
    await loadPublicEvents();
    state.public.modalMode = "cart";
    renderPublic();
    showToast("訂單已送出。");
  } catch (error) {
    state.public.cart.submitting = false;
    showToast(error.message || "訂單送出失敗。");
    renderPublicDetail();
  }
}

function resetCartSuccess() {
  state.public.cart.success = null;
  closePublicEvent();
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
    targetAnswers[questionId] =
      question.type === "idNumber"
        ? normalizeAnswerForQuestion(question, value)
        : value;
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

function updateRunnerPricingConfirmation(value, shouldRender = false) {
  const runner = state.public.runner;
  if (!runner) {
    return;
  }

  runner.pricingConfirmationValue = String(value || "");
  runner.reviewErrors = {
    ...runner.reviewErrors,
    pricingConfirmation: "",
  };

  if (shouldRender) {
    renderPublicDetail();
  }
}

function updateRunnerCarpoolSelection(field, value, checked, shouldRender = false) {
  const event = getSelectedPublicEvent();
  const runner = state.public.runner;
  if (!event || !runner) {
    return;
  }

  const current = normalizeRunnerCarpoolSelection(runner.carpoolSelection);

  if (field === "requested") {
    current.requested = checked;
    current.quantity = checked ? Math.max(1, current.quantity || 1) : 0;
  } else if (field === "quantity") {
    current.requested = true;
    current.quantity = Math.max(1, Number.parseInt(value, 10) || 1);
  }

  runner.carpoolSelection = current;
  runner.errors = {
    ...runner.errors,
    __carpool__: "",
  };
  runner.reviewErrors = {
    ...runner.reviewErrors,
    carpool: "",
  };

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

  if (runner.stage === "review") {
    goBackFromReview();
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

  if (runner.returnToReview) {
    moveRunnerToReviewStage(event, runner);
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

  if (runner.stage === "review") {
    const reviewErrors = validateReviewStage(event, runner);
    if (Object.keys(reviewErrors).length) {
      runner.reviewErrors = reviewErrors;
      renderPublicDetail();
      return;
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
        runner.pricingConfirmationValue,
        normalizeRunnerCarpoolSelection(runner.carpoolSelection),
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

    if (runner.returnToReview) {
      const carpoolError = validateCarpoolSelection(event, runner);
      if (carpoolError) {
        runner.errors = {
          ...runner.errors,
          __carpool__: carpoolError,
        };
        renderPublicDetail();
        return;
      }
      moveRunnerToReviewStage(event, runner);
      renderPublicDetail();
      return;
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

    if (runner.returnToReview) {
      const carpoolError = validateCarpoolSelection(event, runner);
      if (carpoolError) {
        runner.errors = {
          ...runner.errors,
          __carpool__: carpoolError,
        };
        renderPublicDetail();
        return;
      }
      moveRunnerToReviewStage(event, runner);
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

  const carpoolError = validateCarpoolSelection(event, runner);
  if (carpoolError) {
    runner.errors = {
      ...runner.errors,
      __carpool__: carpoolError,
    };
    renderPublicDetail();
    return;
  }

  moveRunnerToReviewStage(event, runner);
  renderPublicDetail();
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
    returnToReview: false,
    pricingConfirmationValue: "",
    carpoolSelection: {
      requested: false,
      quantity: 0,
    },
    reviewErrors: {},
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

  if (target.dataset.pricingField) {
    updateDraftPricingField(
      target.dataset.pricingField,
      target.value,
      target instanceof HTMLInputElement ? target.checked : false,
      shouldRender,
    );
    return;
  }

  if (target.dataset.carpoolField) {
    updateDraftCarpoolField(
      target.dataset.carpoolField,
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

  if (target.dataset.publicPricingConfirmation) {
    updateRunnerPricingConfirmation(target.value, shouldRender);
    return;
  }

  if (target.dataset.publicCarpoolField) {
    updateRunnerCarpoolSelection(
      target.dataset.publicCarpoolField,
      target.value,
      target instanceof HTMLInputElement ? target.checked : false,
      shouldRender,
    );
    return;
  }

  if (target.dataset.publicSpecField) {
    updateEventSpecField(target.dataset.publicSpecField, target.value, shouldRender);
    return;
  }

  if (target.dataset.publicSpecCarpoolField) {
    updateEventSpecCarpoolSelection(
      target.dataset.publicSpecCarpoolField,
      target.value,
      target instanceof HTMLInputElement ? target.checked : false,
      shouldRender,
    );
    return;
  }

  if (target.dataset.cartContactField) {
    updateCartContactField(target.dataset.cartContactField, target.value, shouldRender);
    return;
  }

  if (target.dataset.cartParticipantField && target.dataset.cartParticipantId) {
    updateCartParticipantField(
      target.dataset.cartParticipantId,
      target.dataset.cartParticipantField,
      target.value,
      shouldRender,
    );
    return;
  }

  if (target.dataset.cartAssignmentItemId && target.dataset.cartParticipantId) {
    toggleCartAssignment(
      target.dataset.cartParticipantId,
      target.dataset.cartAssignmentItemId,
      target instanceof HTMLInputElement ? target.checked : false,
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

    if (action === "export-all-submissions") {
      exportAllSubmissionsToExcel();
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
    const event = getSelectedPublicEvent();
    const runner = state.public.runner;

    if (action === "open-cart") {
      openCartCheckout();
      return;
    }

    if (action === "add-to-cart") {
      addSelectedEventToCart();
      return;
    }

    if (action === "remove-cart-item" && publicAction.dataset.cartItemId) {
      removeCartItem(publicAction.dataset.cartItemId);
      return;
    }

    if (action === "add-checkout-participant") {
      addCartParticipant();
      return;
    }

    if (action === "remove-checkout-participant" && publicAction.dataset.participantId) {
      removeCartParticipant(publicAction.dataset.participantId);
      return;
    }

    if (action === "checkout-submit") {
      await submitCartCheckout();
      return;
    }

    if (action === "checkout-reset") {
      resetCartSuccess();
      return;
    }

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

    if (action === "review-back") {
      goBackFromReview();
      return;
    }

    if (action === "edit-flow-question" && event && runner && publicAction.dataset.pageId) {
      jumpToFlowQuestionFromReview(event, runner, publicAction.dataset.pageId);
      renderPublicDetail();
      return;
    }

    if (action === "edit-repeat-question" && event && runner) {
      const participantNumber = Number.parseInt(
        publicAction.dataset.participantNumber || "",
        10,
      );
      if (participantNumber >= 2) {
        jumpToRepeatQuestionFromReview(event, runner, participantNumber);
        renderPublicDetail();
      }
      return;
    }

    if (action === "edit-carpool" && event && runner) {
      jumpToCarpoolFromReview(event, runner);
      renderPublicDetail();
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
