import {
  getStorageMode,
  loadDatabase,
  removeEvent,
  replaceEvent,
  sanitizeEventForAdmin,
  saveDatabase,
  updateEventWithPreservedSubmissions,
  usesDefaultAdminPassword,
  verifyAdminPassword,
  getEvent,
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
    const action = body?.action;
    const password = body?.password;

    if (!verifyAdminPassword(password)) {
      return json({ ok: false, error: "密碼錯誤，請重新輸入。" }, 401);
    }

    const database = await loadDatabase();

    if (action === "login" || action === "list") {
      return json({
        ok: true,
        storageMode: getStorageMode(),
        usingDefaultPassword: usesDefaultAdminPassword(),
        events: database.events.map((event) => sanitizeEventForAdmin(event)),
      });
    }

    if (action === "save") {
      if (!body?.event || typeof body.event !== "object") {
        return json({ ok: false, error: "缺少活動資料。" }, 400);
      }

      const currentEvent = getEvent(database, body.event.id);
      const nextEvent = updateEventWithPreservedSubmissions(body.event, currentEvent);
      replaceEvent(database, nextEvent);
      await saveDatabase(database);

      return json({
        ok: true,
        storageMode: getStorageMode(),
        usingDefaultPassword: usesDefaultAdminPassword(),
        event: sanitizeEventForAdmin(nextEvent),
        events: database.events.map((event) => sanitizeEventForAdmin(event)),
      });
    }

    if (action === "delete") {
      const eventId = String(body?.eventId || "").trim();
      if (!eventId) {
        return json({ ok: false, error: "缺少活動 ID。" }, 400);
      }

      removeEvent(database, eventId);
      await saveDatabase(database);

      return json({
        ok: true,
        storageMode: getStorageMode(),
        usingDefaultPassword: usesDefaultAdminPassword(),
        events: database.events.map((event) => sanitizeEventForAdmin(event)),
      });
    }

    return json({ ok: false, error: "不支援的後台操作。" }, 400);
  } catch (error) {
    return json({ ok: false, error: error?.message || "後台儲存失敗。" }, 500);
  }
};
