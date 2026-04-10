import { getStore } from "@netlify/blobs";

export const END_OF_FLOW = "__end__";
export const DEFAULT_ADMIN_PASSWORD = "admin1234";

const DB_KEY = "event-registration-db";
const QUESTION_TYPES = new Set([
  "shortText",
  "longText",
  "email",
  "phone",
  "idNumber",
  "number",
  "singleChoice",
  "multiChoice",
  "dropdown",
  "date",
]);

const OPTION_TYPES = new Set(["singleChoice", "multiChoice", "dropdown"]);
const BRANCHING_TYPES = new Set(["singleChoice", "dropdown", "multiChoice"]);
const DEFAULT_DB = { version: 2, events: [], orders: [] };
let resolvedStorageMode = "netlify-blobs";

export function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
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

export function createPricingConfig() {
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

export function createCarpoolConfig() {
  return {
    enabled: false,
    price: null,
    capacity: null,
    description: "",
  };
}

export function normalizePricingConfig(pricing) {
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

export function normalizeCarpoolConfig(carpool) {
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

function normalizeOrder(order) {
  if (!order || typeof order !== "object") {
    return null;
  }

  return {
    id: String(order?.id || createId("order")),
    submittedAt: order?.submittedAt || new Date().toISOString(),
    contact: {
      name: String(order?.contact?.name || "").trim(),
      phone: String(order?.contact?.phone || "").trim(),
      email: String(order?.contact?.email || "").trim(),
      note: String(order?.contact?.note || "").trim(),
    },
    participants: Array.isArray(order?.participants) ? order.participants : [],
    items: Array.isArray(order?.items) ? order.items : [],
    totalPrice: normalizeMoneyValue(order?.totalPrice),
  };
}

export function supportsOptions(type) {
  return OPTION_TYPES.has(type);
}

export function supportsBranching(type) {
  return BRANCHING_TYPES.has(type);
}

export function getAdminPassword() {
  return process.env.EVENT_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
}

export function usesDefaultAdminPassword() {
  return getAdminPassword() === DEFAULT_ADMIN_PASSWORD;
}

export function verifyAdminPassword(password) {
  return Boolean(password) && password === getAdminPassword();
}

export function getStorageMode() {
  return resolvedStorageMode;
}

function getBlobStore() {
  return getStore("event-registration");
}

export async function loadDatabase() {
  try {
    const data = await getBlobStore().get(DB_KEY, {
      type: "json",
      consistency: "strong",
    });
    resolvedStorageMode = "netlify-blobs";
    return normalizeDatabase(data || DEFAULT_DB);
  } catch (error) {
    throw new Error("目前沒有可用的伺服端儲存。請確認站點已部署在 Netlify，且 Netlify Blobs 可正常使用。");
  }
}

export async function saveDatabase(database) {
  const normalized = normalizeDatabase(database);

  try {
    await getBlobStore().setJSON(DB_KEY, normalized);
    resolvedStorageMode = "netlify-blobs";
    return normalized;
  } catch (error) {
    throw new Error("目前沒有可寫入的伺服端儲存。請確認 Netlify Blobs 可用後再儲存。");
  }
}

export function normalizeDatabase(database) {
  const rawEvents = Array.isArray(database?.events) ? database.events : [];
  const rawOrders = Array.isArray(database?.orders) ? database.orders : [];

  return {
    version: 2,
    events: rawEvents.map((event) => normalizeEvent(event)).sort(sortEvents),
    orders: rawOrders
      .map((order) => normalizeOrder(order))
      .filter(Boolean)
      .sort((left, right) => String(right.submittedAt).localeCompare(String(left.submittedAt))),
  };
}

export function normalizeEvent(event) {
  const now = new Date().toISOString();
  const pages = Array.isArray(event?.pages) && event.pages.length ? event.pages : [createPage()];
  const submissions = Array.isArray(event?.submissions) ? event.submissions : [];

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
    createdAt: event?.createdAt || now,
    updatedAt: event?.updatedAt || now,
    pages: pages.map((page, index) => normalizePage(page, index)),
    submissions: submissions.map((submission) => normalizeSubmission(submission)),
  };
}

export function createPage() {
  return normalizePage({
    id: createId("page"),
    title: "新的一頁",
    description: "",
    defaultNextPageId: null,
    questions: [createQuestion()],
  });
}

export function createQuestion() {
  return normalizeQuestion({
    id: createId("question"),
    label: "新欄位",
    helpText: "",
    type: "shortText",
    required: true,
    placeholder: "",
    countsTowardCapacity: false,
    repeatForAdditionalParticipants: false,
    options: [],
  });
}

function createOption(label = "新選項") {
  return normalizeOption({
    id: createId("option"),
    label,
    nextPageId: null,
  });
}

export function normalizePage(page, index = 0) {
  const questions =
    Array.isArray(page?.questions) && page.questions.length ? page.questions : [createQuestion()];

  return {
    id: String(page?.id || createId("page")),
    title: String(page?.title || `第 ${index + 1} 頁`).trim(),
    description: String(page?.description || "").trim(),
    defaultNextPageId:
      page?.defaultNextPageId && typeof page.defaultNextPageId === "string"
        ? page.defaultNextPageId
        : null,
    questions: questions.map((question) => normalizeQuestion(question)),
  };
}

export function normalizeQuestion(question) {
  const type = QUESTION_TYPES.has(question?.type) ? question.type : "shortText";
  const options =
    supportsOptions(type) && Array.isArray(question?.options) && question.options.length
      ? question.options.map((option) => normalizeOption(option))
      : supportsOptions(type)
        ? [createOption("選項 1"), createOption("選項 2")]
        : [];

  return {
    id: String(question?.id || createId("question")),
    label: String(question?.label || "未命名欄位").trim(),
    helpText: String(question?.helpText || "").trim(),
    type,
    required: Boolean(question?.required),
    placeholder: String(question?.placeholder || "").trim(),
    countsTowardCapacity: type === "number" ? Boolean(question?.countsTowardCapacity) : false,
    repeatForAdditionalParticipants: Boolean(question?.repeatForAdditionalParticipants),
    options,
  };
}

export function normalizeOption(option) {
  return {
    id: String(option?.id || createId("option")),
    label: String(option?.label || "未命名選項").trim(),
    nextPageId:
      option?.nextPageId && typeof option.nextPageId === "string" ? option.nextPageId : null,
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
    answers: typeof submission?.answers === "object" && submission.answers ? submission.answers : {},
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
            answers: typeof entry?.answers === "object" && entry.answers ? entry.answers : {},
          }))
          .sort((left, right) => left.participantNumber - right.participantNumber)
      : [],
  };
}

function sortEvents(left, right) {
  return String(right.updatedAt).localeCompare(String(left.updatedAt));
}

export function computeUsedCapacity(event) {
  return (event?.submissions || []).reduce(
    (sum, submission) => sum + (Number.parseInt(submission.totalParticipants, 10) || 0),
    0,
  );
}

export function computeRemainingCapacity(event) {
  if (!event || event.capacity == null) {
    return null;
  }

  return Math.max(0, event.capacity - computeUsedCapacity(event));
}

export function computeUsedCarpoolCapacity(event) {
  return (event?.submissions || []).reduce(
    (sum, submission) => sum + (Number.parseInt(submission.carpool?.quantity, 10) || 0),
    0,
  );
}

export function computeRemainingCarpoolCapacity(event) {
  const carpool = normalizeCarpoolConfig(event?.carpool);
  if (!carpool.enabled || carpool.capacity == null) {
    return null;
  }

  return Math.max(0, carpool.capacity - computeUsedCarpoolCapacity(event));
}

function findQuestionById(event, questionId) {
  for (const page of event.pages) {
    const question = page.questions.find((entry) => entry.id === questionId);
    if (question) {
      return question;
    }
  }

  return null;
}

function getRepeatQuestions(event) {
  return event.pages
    .flatMap((page) => page.questions)
    .filter((question) => question.repeatForAdditionalParticipants);
}

function normalizeAnswerForQuestion(question, rawAnswer) {
  if (question == null) {
    return null;
  }

  if (question.type === "multiChoice") {
    if (!Array.isArray(rawAnswer)) {
      return [];
    }

    const validOptionIds = new Set(question.options.map((option) => option.id));
    return rawAnswer.filter((value) => validOptionIds.has(value));
  }

  if (supportsOptions(question.type)) {
    const optionIds = new Set(question.options.map((option) => option.id));
    return optionIds.has(rawAnswer) ? rawAnswer : "";
  }

  if (question.type === "number") {
    if (rawAnswer === "" || rawAnswer == null) {
      return "";
    }

    const parsed = Number.parseInt(rawAnswer, 10);
    return Number.isFinite(parsed) ? String(parsed) : "";
  }

  if (question.type === "idNumber") {
    return rawAnswer == null
      ? ""
      : String(rawAnswer).trim().toUpperCase().replace(/[\s-]/g, "");
  }

  return rawAnswer == null ? "" : String(rawAnswer);
}

export function sanitizeAnswersForStorage(event, answers) {
  const sanitized = {};
  const source = typeof answers === "object" && answers ? answers : {};

  for (const page of event.pages) {
    for (const question of page.questions) {
      sanitized[question.id] = normalizeAnswerForQuestion(question, source[question.id]);
    }
  }

  return sanitized;
}

export function buildParticipantCountAnswers(
  event,
  participants,
  contact = {},
  assignedParticipants = [],
) {
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

  return sanitizeAnswersForStorage(event, answers);
}

function sanitizeRepeatedAnswersForStorage(event, repeatedAnswers) {
  const repeatQuestions = getRepeatQuestions(event);
  const source = Array.isArray(repeatedAnswers) ? repeatedAnswers : [];
  const sanitized = new Map();

  for (const [index, entry] of source.entries()) {
    const participantNumber = Math.max(
      2,
      Number.parseInt(entry?.participantNumber, 10) || index + 2,
    );
    const answers = typeof entry?.answers === "object" && entry.answers ? entry.answers : {};
    const sanitizedAnswers = {};

    for (const question of repeatQuestions) {
      sanitizedAnswers[question.id] = normalizeAnswerForQuestion(question, answers[question.id]);
    }

    sanitized.set(participantNumber, {
      participantNumber,
      answers: sanitizedAnswers,
    });
  }

  return [...sanitized.values()].sort(
    (left, right) => left.participantNumber - right.participantNumber,
  );
}

export function sanitizeCarpoolSelection(event, carpoolSelection) {
  const carpool = normalizeCarpoolConfig(event?.carpool);
  const source = typeof carpoolSelection === "object" && carpoolSelection ? carpoolSelection : {};
  const requested = Boolean(source.requested);
  const quantity = requested ? Math.max(1, Number.parseInt(source.quantity, 10) || 1) : 0;

  if (!carpool.enabled || !requested || quantity <= 0) {
    return null;
  }

  return {
    quantity,
    unitPrice: carpool.price ?? 0,
    totalPrice: roundMoney((carpool.price ?? 0) * quantity),
    description: carpool.description,
  };
}

function isAnswerEmpty(question, answer) {
  if (question.type === "multiChoice") {
    return !Array.isArray(answer) || answer.length === 0;
  }

  return answer == null || answer === "";
}

function validateQuestionAnswer(question, answer) {
  if ((question.required || question.countsTowardCapacity) && isAnswerEmpty(question, answer)) {
    return `${question.label} 為必填欄位。`;
  }

  if (question.type === "email" && answer) {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(answer)) {
      return `${question.label} 需要是有效的 Email 格式。`;
    }
  }

  if (question.type === "phone" && answer) {
    const phonePattern = /^[0-9+\-()#\s]{6,}$/;
    if (!phonePattern.test(answer)) {
      return `${question.label} 需要是有效的電話格式。`;
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
      return `${question.label} 需要填入數字。`;
    }

    if (question.countsTowardCapacity && parsed < 1) {
      return `${question.label} 至少要填 1。`;
    }
  }

  return null;
}

export function resolveNextPageId(event, currentPageId, answers) {
  const pageIndex = event.pages.findIndex((page) => page.id === currentPageId);
  const page = pageIndex >= 0 ? event.pages[pageIndex] : null;

  if (!page) {
    return null;
  }

  for (const question of page.questions) {
    if (!supportsBranching(question.type)) {
      continue;
    }

    const answer = answers[question.id];

    if (question.type === "multiChoice" && Array.isArray(answer)) {
      for (const option of question.options) {
        if (option.nextPageId && answer.includes(option.id)) {
          return option.nextPageId === END_OF_FLOW ? null : option.nextPageId;
        }
      }
    } else if (answer) {
      const matchedOption = question.options.find(
        (option) => option.id === answer && option.nextPageId,
      );

      if (matchedOption) {
        return matchedOption.nextPageId === END_OF_FLOW ? null : matchedOption.nextPageId;
      }
    }
  }

  if (page.defaultNextPageId) {
    return page.defaultNextPageId === END_OF_FLOW ? null : page.defaultNextPageId;
  }

  return event.pages[pageIndex + 1]?.id || null;
}

export function validateSubmission(
  event,
  answers,
  repeatedAnswers,
  pricingConfirmationValue = "",
  referenceTime = new Date().toISOString(),
  carpoolSelection = {},
) {
  const sanitizedAnswers = sanitizeAnswersForStorage(event, answers);
  const totalParticipants = computeSubmissionParticipants(event, sanitizedAnswers);
  const sanitizedRepeatedAnswers = sanitizeRepeatedAnswersForStorage(
    event,
    repeatedAnswers,
  ).filter((entry) => entry.participantNumber <= totalParticipants);
  const repeatQuestions = getRepeatQuestions(event);
  const pricing = normalizePricingConfig(event?.pricing);
  const sanitizedCarpool = sanitizeCarpoolSelection(event, carpoolSelection);
  const normalizedPricingConfirmationValue = String(pricingConfirmationValue || "").trim();
  const errors = [];
  const visitedPageIds = [];
  const pageMap = new Map(event.pages.map((page) => [page.id, page]));
  let currentPage = event.pages[0];
  let guard = 0;

  while (currentPage && guard < event.pages.length + 2 && !visitedPageIds.includes(currentPage.id)) {
    visitedPageIds.push(currentPage.id);

    for (const question of currentPage.questions) {
      const error = validateQuestionAnswer(question, sanitizedAnswers[question.id]);
      if (error) {
        errors.push({
          pageId: currentPage.id,
          questionId: question.id,
          message: error,
        });
      }
    }

    const nextPageId = resolveNextPageId(event, currentPage.id, sanitizedAnswers);
    currentPage = nextPageId ? pageMap.get(nextPageId) || null : null;
    guard += 1;
  }

  if (totalParticipants > 1 && repeatQuestions.length) {
    const repeatedMap = new Map(
      sanitizedRepeatedAnswers.map((entry) => [entry.participantNumber, entry]),
    );

    for (let participantNumber = 2; participantNumber <= totalParticipants; participantNumber += 1) {
      const entry = repeatedMap.get(participantNumber);

      for (const question of repeatQuestions) {
        const error = validateQuestionAnswer(question, entry?.answers?.[question.id]);
        if (error) {
          errors.push({
            pageId: null,
            questionId: question.id,
            participantNumber,
            message: `第 ${participantNumber} 位同行：${error}`,
          });
        }
      }
    }
  }

  if (
    pricing.enabled &&
    pricing.confirmationFieldEnabled &&
    pricing.confirmationFieldRequired &&
    !normalizedPricingConfirmationValue
  ) {
    errors.push({
      pageId: null,
      questionId: "__pricing_confirmation__",
      message: `${pricing.confirmationFieldLabel || "確認欄位"} 為必填。`,
    });
  }

  const pricingQuote = computePricingQuote(event, sanitizedAnswers, referenceTime);
  if (sanitizedCarpool && sanitizedCarpool.quantity > totalParticipants) {
    errors.push({
      pageId: null,
      questionId: "__carpool__",
      message: `共乘人數不能超過報名總人數 ${totalParticipants} 人。`,
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    visitedPageIds,
    sanitizedAnswers,
    sanitizedRepeatedAnswers,
    totalParticipants,
    pricingQuote,
    sanitizedCarpool,
    pricingConfirmationValue: normalizedPricingConfirmationValue,
  };
}

export function computeSubmissionParticipants(event, answers) {
  const sanitizedAnswers = sanitizeAnswersForStorage(event, answers);
  const participantQuestions = event.pages
    .flatMap((page) => page.questions)
    .filter((question) => question.countsTowardCapacity);

  if (participantQuestions.length === 0) {
    return 1;
  }

  const total = participantQuestions.reduce((sum, question) => {
    const parsed = Number.parseInt(sanitizedAnswers[question.id], 10) || 0;
    return sum + Math.max(0, parsed);
  }, 0);

  return Math.max(1, total);
}

export function computePricingQuote(event, answers, referenceTime = new Date().toISOString()) {
  const pricing = normalizePricingConfig(event?.pricing);
  if (!pricing.enabled) {
    return null;
  }

  const participants = computeSubmissionParticipants(event, answers);
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
    confirmationFieldLabel: pricing.confirmationFieldLabel,
  };
}

export function computePricingQuoteForParticipants(
  event,
  participants,
  referenceTime = new Date().toISOString(),
) {
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
    confirmationFieldLabel: pricing.confirmationFieldLabel,
  };
}

export function sanitizeEventForPublic(event) {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    coverImage: event.coverImage,
    capacity: event.capacity,
    remainingCapacity: computeRemainingCapacity(event),
    status: event.status,
    pricing: clone(event.pricing),
    carpool: {
      ...clone(event.carpool),
      remainingCapacity: computeRemainingCarpoolCapacity(event),
    },
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    pages: clone(event.pages),
  };
}

export function sanitizeEventForAdmin(event) {
  return {
    ...clone(event),
    totalForms: event.submissions.length,
    totalParticipants: computeUsedCapacity(event),
    remainingCapacity: computeRemainingCapacity(event),
  };
}

export function buildSubmissionSummary(event) {
  return {
    totalForms: event.submissions.length,
    totalParticipants: computeUsedCapacity(event),
    remainingCapacity: computeRemainingCapacity(event),
  };
}

export function getQuestionTypeLabel(type) {
  const labels = {
    shortText: "簡答",
    longText: "長答",
    email: "Email",
    phone: "電話",
    idNumber: "身分證字號",
    number: "數字",
    singleChoice: "單選",
    multiChoice: "複選",
    dropdown: "下拉選單",
    date: "日期",
  };

  return labels[type] || type;
}

export function listBranchTargets(event, currentPageId) {
  const options = [{ id: "", label: "依照頁面預設流程" }, { id: END_OF_FLOW, label: "直接結束報名" }];

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

export function listDefaultNextTargets(event, currentPageId) {
  const options = [{ id: "", label: "下一個頁面 / 沒有就送出" }, { id: END_OF_FLOW, label: "這頁結束後直接送出" }];

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

export function updateEventWithPreservedSubmissions(incomingEvent, existingEvent) {
  const normalizedIncoming = normalizeEvent({
    ...incomingEvent,
    submissions: incomingEvent?.submissions || existingEvent?.submissions || [],
    createdAt: incomingEvent?.createdAt || existingEvent?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const validPageIds = new Set(normalizedIncoming.pages.map((page) => page.id));

  for (const page of normalizedIncoming.pages) {
    if (page.defaultNextPageId && page.defaultNextPageId !== END_OF_FLOW && !validPageIds.has(page.defaultNextPageId)) {
      page.defaultNextPageId = null;
    }

    for (const question of page.questions) {
      if (!supportsOptions(question.type)) {
        question.options = [];
        continue;
      }

      for (const option of question.options) {
        if (option.nextPageId && option.nextPageId !== END_OF_FLOW && !validPageIds.has(option.nextPageId)) {
          option.nextPageId = null;
        }
      }
    }
  }

  return normalizedIncoming;
}

export function eventExists(database, eventId) {
  return database.events.some((event) => event.id === eventId);
}

export function getEvent(database, eventId) {
  return database.events.find((event) => event.id === eventId) || null;
}

export function replaceEvent(database, nextEvent) {
  const nextEvents = database.events.filter((event) => event.id !== nextEvent.id);
  nextEvents.push(nextEvent);
  database.events = nextEvents.sort(sortEvents);
  return database;
}

export function removeEvent(database, eventId) {
  database.events = database.events.filter((event) => event.id !== eventId);
  return database;
}

export function findQuestion(event, questionId) {
  return findQuestionById(event, questionId);
}
