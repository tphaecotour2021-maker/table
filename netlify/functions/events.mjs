import { loadDatabase, sanitizeEventForPublic } from "./lib/db.mjs";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export default async (request) => {
  if (request.method !== "GET") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const database = await loadDatabase();
  const events = database.events
    .filter((event) => event.status === "published")
    .map((event) => sanitizeEventForPublic(event));

  return json({
    ok: true,
    events,
  });
};
