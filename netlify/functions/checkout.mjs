import {
  buildParticipantCountAnswers,
  buildSubmissionSummary,
  clone,
  computePricingQuoteForParticipants,
  computeRemainingCarpoolCapacity,
  createId,
  getEvent,
  loadDatabase,
  normalizePricingConfig,
  replaceEvent,
  sanitizeCarpoolSelection,
  sanitizeEventForPublic,
  saveDatabase,
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

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function sanitizeContact(contact) {
  return {
    name: String(contact?.name || "").trim(),
    phone: String(contact?.phone || "").trim(),
    email: String(contact?.email || "").trim(),
    note: String(contact?.note || "").trim(),
  };
}

function sanitizeParticipant(participant, index) {
  return {
    id: String(participant?.id || `participant_${index + 1}`),
    name: String(participant?.name || "").trim(),
    phone: String(participant?.phone || "").trim(),
    email: String(participant?.email || "").trim(),
    idNumber: String(participant?.idNumber || "").trim().toUpperCase().replace(/[\s-]/g, ""),
    assignedItemIds: Array.isArray(participant?.assignedItemIds)
      ? participant.assignedItemIds.map((value) => String(value))
      : [],
  };
}

function validateContact(contact) {
  if (!contact.name) {
    return "請填寫聯絡人姓名。";
  }

  if (!contact.phone || !/^[0-9+\-()#\s]{6,}$/.test(contact.phone)) {
    return "請填寫有效的聯絡電話。";
  }

  if (!contact.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) {
    return "請填寫有效的聯絡 Email。";
  }

  return "";
}

function validateParticipant(participant) {
  if (!participant.name) {
    return "請填寫參加者姓名。";
  }

  if (participant.phone && !/^[0-9+\-()#\s]{6,}$/.test(participant.phone)) {
    return `${participant.name} 的電話格式不正確。`;
  }

  if (participant.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(participant.email)) {
    return `${participant.name} 的 Email 格式不正確。`;
  }

  if (participant.idNumber && !/^[A-Z][A-Z0-9]\d{8}$/.test(participant.idNumber)) {
    return `${participant.name} 的身分證字號需要是 10 碼。`;
  }

  return "";
}

function sanitizeCartItem(item) {
  return {
    clientItemId: String(item?.clientItemId || item?.id || createId("cart_item")),
    eventId: String(item?.eventId || "").trim(),
    quantity: Math.max(1, Number.parseInt(item?.quantity, 10) || 1),
    carpoolSelection: item?.carpoolSelection || {},
  };
}

function getAssignedParticipants(participants, clientItemId) {
  return participants.filter((participant) => participant.assignedItemIds.includes(clientItemId));
}

export default async (request) => {
  try {
    if (request.method !== "POST") {
      return json({ ok: false, error: "Method not allowed" }, 405);
    }

    const body = await readBody(request);
    const contact = sanitizeContact(body?.contact);
    const contactError = validateContact(contact);
    if (contactError) {
      return json({ ok: false, error: contactError }, 422);
    }

    const items = Array.isArray(body?.items) ? body.items.map((item) => sanitizeCartItem(item)) : [];
    if (items.length === 0) {
      return json({ ok: false, error: "購物車目前是空的。" }, 422);
    }

    const participants = Array.isArray(body?.participants)
      ? body.participants.map((participant, index) => sanitizeParticipant(participant, index))
      : [];

    const database = await loadDatabase();
    const submittedAt = new Date().toISOString();
    const itemsByEvent = new Map();

    for (const item of items) {
      const event = getEvent(database, item.eventId);
      if (!event || event.status !== "published") {
        return json({ ok: false, error: "購物車內有活動已不存在或未開放。" }, 404);
      }

      const pricing = normalizePricingConfig(event.pricing);
      if (
        pricing.enabled &&
        pricing.confirmationFieldEnabled &&
        pricing.confirmationFieldRequired &&
        !contact.note
      ) {
        return json(
          {
            ok: false,
            error: `${event.title} 需要填寫備註 / 付款確認資訊。`,
          },
          422,
        );
      }

      const assigned = getAssignedParticipants(participants, item.clientItemId);
      if (assigned.length !== item.quantity) {
        return json(
          {
            ok: false,
            error: `${event.title} 需要勾選 ${item.quantity} 位參加者，目前是 ${assigned.length} 位。`,
          },
          422,
        );
      }

      for (const participant of assigned) {
        const participantError = validateParticipant(participant);
        if (participantError) {
          return json({ ok: false, error: participantError }, 422);
        }
      }

      const sanitizedCarpool = sanitizeCarpoolSelection(event, item.carpoolSelection);
      if (sanitizedCarpool && sanitizedCarpool.quantity > item.quantity) {
        return json(
          {
            ok: false,
            error: `${event.title} 的共乘人數不能超過活動人數 ${item.quantity} 人。`,
          },
          422,
        );
      }

      const current = itemsByEvent.get(event.id) || {
        event,
        quantity: 0,
        carpoolQuantity: 0,
      };
      current.quantity += item.quantity;
      current.carpoolQuantity += sanitizedCarpool?.quantity || 0;
      itemsByEvent.set(event.id, current);
    }

    for (const { event, quantity, carpoolQuantity } of itemsByEvent.values()) {
      const summary = buildSubmissionSummary(event);
      if (event.capacity != null && quantity > (summary.remainingCapacity ?? 0)) {
        return json(
          {
            ok: false,
            error: `${event.title} 剩餘名額不足，目前只剩 ${summary.remainingCapacity} 人。`,
            remainingCapacity: summary.remainingCapacity,
          },
          409,
        );
      }

      const remainingCarpoolCapacity = computeRemainingCarpoolCapacity(event);
      if (remainingCarpoolCapacity != null && carpoolQuantity > remainingCarpoolCapacity) {
        return json(
          {
            ok: false,
            error: `${event.title} 共乘名額不足，目前只剩 ${remainingCarpoolCapacity} 位。`,
            remainingCarpoolCapacity,
          },
          409,
        );
      }
    }

    const orderId = createId("order");
    const orderItems = [];
    let orderTotal = 0;
    const updatedEvents = new Map();

    for (const item of items) {
      const event = getEvent(database, item.eventId);
      const assigned = getAssignedParticipants(participants, item.clientItemId).map((participant) => ({
        ...participant,
        phone: participant.phone || contact.phone,
        email: participant.email || contact.email,
      }));
      const answers = buildParticipantCountAnswers(event, item.quantity, contact, assigned);
      const pricingQuote = computePricingQuoteForParticipants(event, item.quantity, submittedAt);
      const carpool = sanitizeCarpoolSelection(event, item.carpoolSelection);
      const subtotal = roundMoney((pricingQuote?.totalPrice || 0) + (carpool?.totalPrice || 0));
      const orderItemId = createId("order_item");

      event.submissions.push({
        id: createId("submission"),
        submittedAt,
        totalParticipants: item.quantity,
        visitedPageIds: [],
        answers,
        pricing: pricingQuote
          ? {
              ...pricingQuote,
              confirmationValue: contact.note,
              confirmationFieldLabel: event.pricing?.confirmationFieldLabel || "備註 / 付款確認資訊",
            }
          : contact.note
            ? {
                confirmationValue: contact.note,
                confirmationFieldLabel: "備註 / 付款確認資訊",
              }
            : null,
        carpool,
        cart: {
          orderId,
          itemId: orderItemId,
          contact,
          participants: assigned,
          subtotal,
        },
        repeatedAnswers: [],
      });
      event.updatedAt = new Date().toISOString();
      updatedEvents.set(event.id, event);
      orderTotal += subtotal;

      orderItems.push({
        id: orderItemId,
        clientItemId: item.clientItemId,
        eventId: event.id,
        eventTitle: event.title,
        quantity: item.quantity,
        participantIds: assigned.map((participant) => participant.id),
        pricing: pricingQuote ? clone(pricingQuote) : null,
        carpool: carpool ? clone(carpool) : null,
        subtotal,
      });
    }

    for (const event of updatedEvents.values()) {
      replaceEvent(database, event);
    }

    database.orders = Array.isArray(database.orders) ? database.orders : [];
    database.orders.push({
      id: orderId,
      submittedAt,
      contact,
      participants,
      items: orderItems,
      totalPrice: roundMoney(orderTotal),
    });

    await saveDatabase(database);

    return json({
      ok: true,
      orderId,
      totalPrice: roundMoney(orderTotal),
      items: orderItems,
      events: [...updatedEvents.values()].map((event) => sanitizeEventForPublic(event)),
    });
  } catch (error) {
    return json({ ok: false, error: error?.message || "購物車結帳失敗。" }, 500);
  }
};
