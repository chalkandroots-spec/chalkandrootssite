const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function clean(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

export async function onRequest({ request, env }) {
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed." }, 405);
  }

  // Same-origin browser submissions only. Requests without Origin are rejected
  // rather than accepting cross-site form posts.
  const origin = request.headers.get("Origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return json({ ok: false, error: "Request origin could not be verified." }, 403);
  }

  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().includes("application/x-www-form-urlencoded") &&
      !contentType.toLowerCase().includes("multipart/form-data")) {
    return json({ ok: false, error: "Unsupported form encoding." }, 415);
  }

  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > 12_000) {
    return json({ ok: false, error: "Submission is too large." }, 413);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "The form could not be read. Please try again." }, 400);
  }

  // Quietly accept honeypot hits without storing them or revealing the filter.
  if (clean(form.get("bot-field"), 200)) {
    return json({ ok: true, stored: true });
  }

  const formName = clean(form.get("form-name"), 80);
  const email = clean(form.get("email"), 254).toLowerCase();
  const source = clean(form.get("source"), 200) || "direct";

  if (!["vault-signup", "quiz-result"].includes(formName)) {
    return json({ ok: false, error: "This form is not supported." }, 400);
  }
  if (!validEmail(email)) {
    return json({ ok: false, error: "Enter a valid email address." }, 422);
  }

  const fields = { email, source };

  if (formName === "quiz-result") {
    const allowed = {
      "biggest-time-drain": ["planning-from-scratch", "differentiation-eld", "finding-activities", "engagement"],
      "grade-band": ["k-2", "3-5", "6-8", "mixed"],
      goal: ["save-time", "support-el", "build-unit", "exploring"],
    };
    for (const [key, values] of Object.entries(allowed)) {
      const value = clean(form.get(key), 80);
      if (!values.includes(value)) {
        return json({ ok: false, error: "Please complete all quiz questions and try again." }, 422);
      }
      fields[key] = value;
    }
    fields["activation-event"] = "quiz-completed";
  }

  if (!env.SUBMISSIONS_DB) {
    return json({ ok: false, error: "The submission service is not configured yet. Please try again later." }, 503);
  }

  try {
    const result = await env.SUBMISSIONS_DB.prepare(
      `INSERT INTO website_submissions
        (form_name, email, source, payload_json, notification_status, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`
    ).bind(
      formName,
      email,
      source,
      JSON.stringify(fields),
      new Date().toISOString()
    ).run();

    if (!result.success) throw new Error("D1 did not confirm the insert.");

    // The record is durably saved. Email notification is a separate pending
    // operation and is deliberately not reported as delivered here.
    return json({ ok: true, stored: true, notification: "pending" }, 201);
  } catch (error) {
    console.error("Website submission persistence failed:", error);
    return json({ ok: false, error: "We couldn't save your submission. Please try again." }, 503);
  }
}
