import {
  buildSubmissionSummary,
  computeSubmissionParticipants,
  createId,
  getEvent,
  loadDatabase,
  replaceEvent,
  saveDatabase,
  sanitizeEventForPublic,
  validateSubmission,
} from "./lib/db.mjs";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export default async (request) => {
  try {
    if (request.method !== "POST") {
      return json({ ok: false, error: "Method not allowed" }, 405);
    }

    const body = await readBody(request);
    const eventId = String(body?.eventId || "").trim();
    const answers = body?.answers;

    if (!eventId) {
      return json({ ok: false, error: "缺少活動 ID。" }, 400);
    }

    const database = await loadDatabase();
    const event = getEvent(database, eventId);

    if (!event || event.status !== "published") {
      return json({ ok: false, error: "找不到可報名的活動。" }, 404);
    }

    const validation = validateSubmission(event, answers);

    if (!validation.ok) {
      return json(
        {
          ok: false,
          error: validation.errors[0]?.message || "表單資料不完整。",
          errors: validation.errors,
        },
        422,
      );
    }

    const totalParticipants = computeSubmissionParticipants(event, validation.sanitizedAnswers);
    const summary = buildSubmissionSummary(event);

    if (event.capacity != null && totalParticipants > (summary.remainingCapacity ?? 0)) {
      return json(
        {
          ok: false,
          error: `剩餘名額不足，目前只剩 ${summary.remainingCapacity} 人。`,
          remainingCapacity: summary.remainingCapacity,
        },
        409,
      );
    }

    event.submissions.push({
      id: createId("submission"),
      submittedAt: new Date().toISOString(),
      totalParticipants,
      visitedPageIds: validation.visitedPageIds,
      answers: validation.sanitizedAnswers,
    });
    event.updatedAt = new Date().toISOString();

    replaceEvent(database, event);
    await saveDatabase(database);

    return json({
      ok: true,
      totalParticipants,
      summary: buildSubmissionSummary(event),
      event: sanitizeEventForPublic(event),
    });
  } catch (error) {
    return json({ ok: false, error: error?.message || "報名送出失敗。" }, 500);
  }
};
