// netlify/functions/submission-created.js
//
// Netlify automatically invokes this function whenever a form submission
// is created on this site, using this exact filename convention.
// No manual webhook setup needed.
//
// Requires environment variables, set in Netlify:
//   RESEND_API_KEY               -- your API key from https://resend.com
//   SHEETS_WEBHOOK_LESSON_STANDARD -- Google Apps Script Web App URL for the
//                                     "Standards Request" Google Sheet (optional;
//                                     lesson-standard rows are skipped if unset)
//   SHEETS_WEBHOOK_POLLS          -- Google Apps Script Web App URL for a sheet
//                                     that tallies the AI-use and SOR-interest
//                                     yes/no polls (optional; votes are skipped
//                                     if unset, but still land in Netlify Forms)
//   SHEETS_WEBHOOK_LEADS           -- Google Apps Script Web App URL for a sheet
//                                     that logs free-resource-gate and quiz-result
//                                     leads (email + answers). Replaces the old
//                                     per-submission email notification for these
//                                     two forms (optional; skipped if unset, but
//                                     still land in Netlify Forms)
//   ANTHROPIC_API_KEY             -- your API key from https://console.anthropic.com,
//                                     used by the C&R Standards Generator to draft
//                                     each lesson/unit plan (required for that
//                                     feature; requests are skipped without it)
//   APPROVAL_SECRET                -- any long random string you choose yourself.
//                                     Used to sign the "Approve & Send" links emailed
//                                     to Angella for the Standards Generator, so a
//                                     stranger can't guess a link and email a teacher
//                                     on her behalf. Set it once and never change it
//                                     (changing it invalidates any pending approval
//                                     emails already sent). Required for that feature.
//   SITE_URL                       -- your live site origin, e.g. https://chalkandroots.com
//                                     Used to build the "Approve & Send" link. Defaults
//                                     to https://chalkandroots.com if unset.

const crypto = require("crypto");

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const data = (body.payload && body.payload.data) || {};
    const formName = (body.payload && body.payload.form_name) || "";
    console.log("TRACE: submission-created invoked. formName =", JSON.stringify(formName));

    // "smart-contact" is the consolidated form (replaces the old separate
    // free-resource-gate / lesson-standard / contact forms) — route by the
    // topic field the visitor picked, to the same handling each used to get.
    if (formName === "smart-contact") {
      var topic = data.topic || "";
      if (topic === "resource") {
        return await handleFreeResourceGate(data);
      }
      if (topic === "standard") {
        return await handleLessonStandard(data);
      }
      return await handleSmartContactGeneral(data);
    }

    // Kept for backward compatibility in case any old-form submissions are
    // still in flight; the site no longer renders these form names.
    if (formName === "lesson-standard") {
      return await handleLessonStandard(data);
    }

    if (formName === "free-resource-gate") {
      return await handleFreeResourceGate(data);
    }

    if (formName === "quiz-result") {
      return await handleQuizResult(data);
    }

    if (formName === "sor-poll" || formName === "ai-poll") {
      return await handlePollVote(formName, data);
    }

    if (formName === "standards-generator") {
      return await handleStandardsGenerator(data);
    }

    // Only auto-reply to the legacy "contact" form (in case more forms are added later)
    if (formName && formName !== "contact") {
      return { statusCode: 200, body: "Skipped: not the contact form" };
    }

    const toEmail = data.email;
    const firstName = data["first-name"] || "there";

    if (!toEmail) {
      return { statusCode: 200, body: "Skipped: no email provided" };
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error("RESEND_API_KEY is not set");
      return { statusCode: 200, body: "Skipped: email service not configured" };
    }

    const subject = "Thanks for reaching out to Chalk & Roots!";
    const bodyText =
      `Hi ${firstName},\n\n` +
      `Thanks so much for reaching out through Chalk & Roots! This is a quick automatic ` +
      `note to let you know your message came through.\n\n` +
      `Angella reads every message personally and will get back to you soon.\n\n` +
      `In the meantime, feel free to explore free and premium resources on Ko-fi: ` +
      `https://ko-fi.com/chalkandroots/shop\n\n` +
      `Warmly,\nChalk & Roots\nchalkandroots.com`;

    const bodyHtml = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#35302B;line-height:1.6;max-width:520px;margin:auto">
        <h2 style="color:#7A9B7A;font-family:Georgia,serif">Chalk &amp; Roots</h2>
        <p>Hi ${firstName},</p>
        <p>Thanks so much for reaching out through Chalk &amp; Roots! This is a quick automatic note to let you know your message came through.</p>
        <p>Angella reads every message personally and will get back to you soon.</p>
        <p>In the meantime, feel free to explore free and premium resources on
          <a href="https://ko-fi.com/chalkandroots/shop" style="color:#C4714A">Ko-fi</a>.
        </p>
        <p>Warmly,<br>Chalk &amp; Roots<br>
          <a href="https://chalkandroots.com" style="color:#6B4C3B">chalkandroots.com</a>
        </p>
      </div>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Chalk & Roots <noreply@chalkandroots.com>",
        reply_to: "chalkandroots@gmail.com",
        to: [toEmail],
        subject: subject,
        text: bodyText,
        html: bodyHtml,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Resend API error:", res.status, errText);
    }

    // Notify Angella about the new message
    const lastName = data["last-name"] || "";
    const contactTopic = data.topic || "General inquiry";
    const message = data.message || "";

    const notifyRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Chalk & Roots Website <noreply@chalkandroots.com>",
        to: ["chalkandroots@gmail.com"],
        reply_to: toEmail,
        subject: `New contact form message: ${contactTopic}`,
        text:
          `New message from your website contact form:\n\n` +
          `Name: ${firstName} ${lastName}\n` +
          `Email: ${toEmail}\n` +
          `Topic: ${contactTopic}\n\n` +
          `Message:\n${message}`,
      }),
    });

    if (!notifyRes.ok) {
      const notifyErrText = await notifyRes.text();
      console.error("Failed to send notification email:", notifyErrText);
    }

    return { statusCode: 200, body: "Emails sent" };
  } catch (err) {
    console.error("submission-created function error:", err);
    // Always return 200 so this never blocks the actual form submission
    return { statusCode: 200, body: "Error handled, submission still recorded" };
  }
};

// Handles the "general question / workshop / other" branch of the
// consolidated smart-contact form — same auto-reply + Angella-notification
// behavior the old standalone "contact" form used to provide.
async function handleSmartContactGeneral(data) {
  const toEmail = data.email;
  const name = data.name || "there";

  if (!toEmail) {
    return { statusCode: 200, body: "Skipped: no email provided" };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("RESEND_API_KEY is not set");
    return { statusCode: 200, body: "Skipped: email service not configured" };
  }

  const subject = "Thanks for reaching out to Chalk & Roots!";
  const bodyText =
    `Hi ${name},\n\n` +
    `Thanks so much for reaching out through Chalk & Roots! This is a quick automatic ` +
    `note to let you know your message came through.\n\n` +
    `Angella reads every message personally and will get back to you soon.\n\n` +
    `In the meantime, feel free to explore free and premium resources on Ko-fi: ` +
    `https://ko-fi.com/chalkandroots/shop\n\n` +
    `Warmly,\nChalk & Roots\nchalkandroots.com`;

  const bodyHtml = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#35302B;line-height:1.6;max-width:520px;margin:auto">
      <h2 style="color:#7A9B7A;font-family:Georgia,serif">Chalk &amp; Roots</h2>
      <p>Hi ${name},</p>
      <p>Thanks so much for reaching out through Chalk &amp; Roots! This is a quick automatic note to let you know your message came through.</p>
      <p>Angella reads every message personally and will get back to you soon.</p>
      <p>In the meantime, feel free to explore free and premium resources on
        <a href="https://ko-fi.com/chalkandroots/shop" style="color:#C4714A">Ko-fi</a>.
      </p>
      <p>Warmly,<br>Chalk &amp; Roots<br>
        <a href="https://chalkandroots.com" style="color:#6B4C3B">chalkandroots.com</a>
      </p>
    </div>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Chalk & Roots <noreply@chalkandroots.com>",
        reply_to: "chalkandroots@gmail.com",
        to: [toEmail],
        subject: subject,
        text: bodyText,
        html: bodyHtml,
      }),
    });
    if (!res.ok) {
      console.error("Resend API error:", res.status, await res.text());
    }
  } catch (err) {
    console.error("Resend API fetch failed:", err);
  }

  const topic = data.subtopic || "General inquiry";
  const message = data.message || "";

  try {
    const notifyRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Chalk & Roots Website <noreply@chalkandroots.com>",
        to: ["chalkandroots@gmail.com"],
        reply_to: toEmail,
        subject: `New contact form message: ${topic}`,
        text:
          `New message from your website contact form:\n\n` +
          `Name: ${name}\n` +
          `Email: ${toEmail}\n` +
          `Topic: ${topic}\n\n` +
          `Message:\n${message}`,
      }),
    });
    if (!notifyRes.ok) {
      console.error("Failed to send notification email:", await notifyRes.text());
    }
  } catch (err) {
    console.error("Notification email fetch failed:", err);
  }

  return { statusCode: 200, body: "smart-contact (general) handled" };
}

// Handles the free-resource "unlock" gate next to the Shop lead text:
// notifies Angella by email so submissions don't just sit unseen in the
// Netlify Forms dashboard. (Netlify stores every submission there
// automatically regardless of this function.)
async function handleFreeResourceGate(data) {
  const email = data.email || "";
  const gradeBand = data["grade-band"] || "(not provided)";
  const source = data.source || "direct";

  const sheetsUrl = process.env.SHEETS_WEBHOOK_LEADS;
  if (!sheetsUrl) {
    console.log("SHEETS_WEBHOOK_LEADS not set — skipping lead sheet log");
    return { statusCode: 200, body: "Skipped: leads sheet not configured" };
  }
  if (!email) {
    return { statusCode: 200, body: "Skipped: no email provided" };
  }

  try {
    const sheetRes = await fetch(sheetsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        form: "free-resource-gate",
        email: email,
        gradeBand: gradeBand,
        source: source,
        timestamp: new Date().toISOString(),
      }),
    });
    if (!sheetRes.ok) {
      console.error("Leads sheet webhook error:", sheetRes.status, await sheetRes.text());
    }
  } catch (sheetErr) {
    console.error("Leads sheet webhook fetch failed:", sheetErr);
  }

  return { statusCode: 200, body: "free-resource-gate handled" };
}

// Handles the "What's Your Teaching Superpower?" quiz: notifies Angella
// by email with all three answers so completed quizzes don't just sit
// unseen in the Netlify Forms dashboard.
async function handleQuizResult(data) {
  const email = data.email || "";
  const timeDrain = data["biggest-time-drain"] || "(not provided)";
  const gradeBand = data["grade-band"] || "(not provided)";
  const goal = data["goal"] || "(not provided)";
  const source = data.source || "direct";

  const sheetsUrl = process.env.SHEETS_WEBHOOK_LEADS;
  if (!sheetsUrl) {
    console.log("SHEETS_WEBHOOK_LEADS not set — skipping lead sheet log");
    return { statusCode: 200, body: "Skipped: leads sheet not configured" };
  }
  if (!email) {
    return { statusCode: 200, body: "Skipped: no email provided" };
  }

  try {
    const sheetRes = await fetch(sheetsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        form: "quiz-result",
        email: email,
        timeDrain: timeDrain,
        gradeBand: gradeBand,
        goal: goal,
        source: source,
        timestamp: new Date().toISOString(),
      }),
    });
    if (!sheetRes.ok) {
      console.error("Leads sheet webhook error:", sheetRes.status, await sheetRes.text());
    }
  } catch (sheetErr) {
    console.error("Leads sheet webhook fetch failed:", sheetErr);
  }

  return { statusCode: 200, body: "quiz-result handled" };
}

// Handles the two one-click yes/no polls (AI use, SOR interest). These are
// anonymous — no email is captured — so we deliberately do NOT send an email
// per vote (that would flood the inbox). Instead each vote is appended to a
// Google Sheet tally if SHEETS_WEBHOOK_POLLS is configured. Every vote is
// always captured in the Netlify Forms dashboard regardless.
async function handlePollVote(formName, data) {
  const vote = data.vote || "";
  const sheetsUrl = process.env.SHEETS_WEBHOOK_POLLS;

  if (!sheetsUrl) {
    console.log("SHEETS_WEBHOOK_POLLS not set — skipping sheet tally");
    return { statusCode: 200, body: "Skipped: poll sheet not configured" };
  }

  try {
    const sheetRes = await fetch(sheetsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        poll: formName,
        vote: vote,
        timestamp: new Date().toISOString(),
      }),
    });
    if (!sheetRes.ok) {
      console.error("Poll sheet webhook error:", sheetRes.status, await sheetRes.text());
    }
  } catch (sheetErr) {
    console.error("Poll sheet webhook fetch failed:", sheetErr);
  }

  return { statusCode: 200, body: "poll vote handled" };
}

// Handles the "Building a lesson from a language standard?" box:
// forwards Name/Email/Standard to a Google Sheet (via Apps Script Web App)
// and emails Angella a notification.
async function handleLessonStandard(data) {
  const name = data.name || "there";
  const email = data.email || "";
  const standard = data.standard || "";

  const sheetsUrl = process.env.SHEETS_WEBHOOK_LESSON_STANDARD;
  if (sheetsUrl) {
    try {
      const sheetRes = await fetch(sheetsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, standard }),
      });
      if (!sheetRes.ok) {
        console.error("Google Sheets webhook error:", sheetRes.status, await sheetRes.text());
      }
    } catch (sheetErr) {
      console.error("Google Sheets webhook fetch failed:", sheetErr);
    }
  } else {
    console.log("SHEETS_WEBHOOK_LESSON_STANDARD not set — skipping sheet log");
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey && email) {
    try {
      const notifyRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Chalk & Roots Website <noreply@chalkandroots.com>",
          to: ["chalkandroots@gmail.com"],
          reply_to: email,
          subject: `New standards request: ${standard || "(no standard given)"}`,
          text:
            `New "Building a lesson from a language standard?" request:\n\n` +
            `Name: ${name}\n` +
            `Email: ${email}\n` +
            `Standard: ${standard}`,
        }),
      });
      if (!notifyRes.ok) {
        console.error("Failed to send standards-request notification email:", await notifyRes.text());
      }
    } catch (emailErr) {
      console.error("Standards-request notification email failed:", emailErr);
    }
  }

  return { statusCode: 200, body: "lesson-standard handled" };
}

// ---------------------------------------------------------------------------
// C & R Standards Generator (replaces the old Base44 embed)
// ---------------------------------------------------------------------------
// Flow: teacher submits the form on the site -> this function calls Claude
// to draft a full plan -> the draft is signed into a link and emailed to
// Angella for review -> she clicks "Approve & Send" -> approve-standard-plan.js
// verifies the signature and emails the finished plan to the teacher.
//
// No database is used: the entire draft plan travels inside the signed
// approval link itself, so nothing needs to be stored between the two steps.

function signPayload(payloadObj) {
  const secret = process.env.APPROVAL_SECRET;
  const json = JSON.stringify(payloadObj);
  const payloadB64 = Buffer.from(json, "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
  return { payloadB64, sig };
}

function gradeBandFromStandard(standard) {
  return standard && standard.toUpperCase().startsWith("ELD") ? "ELD" : "ELA";
}

async function handleStandardsGenerator(data) {
  console.log("TRACE: handleStandardsGenerator started. data =", JSON.stringify(data));
  const name = data.name || "there";
  const email = data.email || "";
  const standard = (data.standard || "").trim();
  const gradeBand = data["grade-band"] || "(not provided)";
  const durationRaw = data.duration || "single-lesson";
  const durationLabel =
    durationRaw === "full-unit" ? "a full unit (2-4 weeks)" :
    durationRaw === "one-week" ? "one week" : "a single lesson (1 day)";

  const resendKey = process.env.RESEND_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const approvalSecret = process.env.APPROVAL_SECRET;
  const siteUrl = process.env.SITE_URL || "https://chalkandroots.com";

  if (!email || !standard) {
    console.log("TRACE: exiting early — missing email or standard. email =", email, "standard =", standard);
    return { statusCode: 200, body: "Skipped: missing email or standard" };
  }
  if (!anthropicKey) {
    console.error("ANTHROPIC_API_KEY is not set — cannot draft plan");
    return { statusCode: 200, body: "Skipped: AI generation not configured" };
  }
  if (!approvalSecret) {
    console.error("APPROVAL_SECRET is not set — cannot build a safe approval link");
    return { statusCode: 200, body: "Skipped: approval signing not configured" };
  }

  // 1) Ask Claude to draft the plan as strict JSON, so the emails on both
  // ends can be rendered cleanly without depending on freeform formatting.
  const systemPrompt =
    "You are an instructional designer writing a Common Core ELA/ELD lesson " +
    "or unit plan for a K-12 teacher. Respond with ONLY valid JSON (no markdown " +
    "fences, no commentary) matching this exact shape: " +
    '{"title":"string","standardExplanation":"1-2 sentence plain-English ' +
    'explanation of what this standard requires","objectives":["string", ...],' +
    '"materials":["string", ...],"schedule":[{"label":"e.g. Day 1 or Week 1",' +
    '"focus":"short phrase","activities":["string", ...]}],' +
    '"instructionalRoutine":' +
    '["step-by-step teaching routine, one string per step", ...]}. ' +
    "Keep language warm, practical, and classroom-ready.";

  const userPrompt =
    `Standard code: ${standard}\n` +
    `Grade band: ${gradeBand}\n` +
    `Duration: ${durationLabel}\n\n` +
    "Build the full plan now, matching the JSON shape exactly.";

  let plan;
  try {
    console.log("TRACE: calling Anthropic API now...");
    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!aiRes.ok) {
      console.error("Anthropic API error:", aiRes.status, await aiRes.text());
      return { statusCode: 200, body: "AI generation failed" };
    }

    const aiData = await aiRes.json();
    const rawText = (aiData.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    const cleaned = rawText.replace(/^```json\s*|^```\s*|```\s*$/g, "");
    plan = JSON.parse(cleaned);
    console.log("TRACE: plan generated successfully. title =", plan.title);
  } catch (err) {
    console.error("Failed to generate or parse plan:", err);
    return { statusCode: 200, body: "AI generation failed" };
  }

  // 2) Sign the whole draft into an approval link. Angella clicking it is
  // what actually sends the plan to the teacher — nothing goes out before that.
  const { payloadB64, sig } = signPayload({
    name,
    email,
    standard,
    gradeBand,
    durationLabel,
    plan,
    createdAt: new Date().toISOString(),
  });
  const approveUrl =
    `${siteUrl}/.netlify/functions/approve-standard-plan?payload=${payloadB64}&sig=${sig}`;

  // 3) Email Angella the full draft plus the approval link. Nothing is sent
  // to the teacher until she clicks "Approve & Send".
  if (resendKey) {
    console.log("TRACE: about to send review email to Angella via Resend...");
    const scheduleHtml = (plan.schedule || [])
      .map(
        (day) =>
          `<div style="margin:14px 0;padding:14px;background:#FBF5EA;border-radius:10px">` +
          `<p style="margin:0 0 6px;font-weight:800;color:#4A3428">${day.label || ""} — ${day.focus || ""}</p>` +
          `<ul style="margin:0;padding-left:20px;color:#35302B">` +
          (day.activities || []).map((a) => `<li>${a}</li>`).join("") +
          `</ul></div>`
      )
      .join("");

    const bodyHtml = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#35302B;line-height:1.6;max-width:640px;margin:auto">
        <h2 style="color:#7A9B7A;font-family:Georgia,serif">New Standards Generator request</h2>
        <p><b>Teacher:</b> ${name} &lt;${email}&gt;<br>
           <b>Standard:</b> ${standard} (${gradeBand})<br>
           <b>Duration:</b> ${durationLabel}</p>
        <hr style="border:none;border-top:1px solid #C8D9C8;margin:20px 0">
        <h3 style="font-family:Georgia,serif;color:#4A3428">${plan.title || "Draft Plan"}</h3>
        <p style="color:#6f6760;font-style:italic">${plan.standardExplanation || ""}</p>
        <p style="font-weight:800;color:#4A3428">Learning Objectives</p>
        <ul>${(plan.objectives || []).map((o) => `<li>${o}</li>`).join("")}</ul>
        <p style="font-weight:800;color:#4A3428">Materials &amp; Resources</p>
        <ul>${(plan.materials || []).map((m) => `<li>${m}</li>`).join("")}</ul>
        <p style="font-weight:800;color:#4A3428">Schedule</p>
        ${scheduleHtml}
        <p style="font-weight:800;color:#4A3428">Instructional Routine</p>
        <ol>${(plan.instructionalRoutine || []).map((r) => `<li>${r}</li>`).join("")}</ol>
        <div style="text-align:center;margin:28px 0">
          <a href="${approveUrl}" style="display:inline-block;background:#C9A227;color:#4A3428;font-weight:900;padding:14px 26px;border-radius:999px;text-decoration:none">
            🌟 Approve &amp; Send to ${name} &#8594;
          </a>
        </div>
        <p style="font-size:.85rem;color:#6f6760">Nothing is sent to the teacher until you click that button. If this draft needs edits, just reply to this email with what to change instead of clicking approve.</p>
      </div>`;

    try {
      const notifyRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Chalk & Roots Standards Generator <noreply@chalkandroots.com>",
          to: ["chalkandroots@gmail.com"],
          reply_to: email,
          subject: `Review: ${standard} plan for ${name}`,
          html: bodyHtml,
        }),
      });
      if (!notifyRes.ok) {
        console.error("Failed to send approval-review email:", await notifyRes.text());
      } else {
        console.log("TRACE: review email sent successfully to chalkandroots@gmail.com");
      }
    } catch (err) {
      console.error("Approval-review email failed:", err);
    }
  } else {
    console.error("RESEND_API_KEY is not set — drafted plan but could not email it for review");
  }

  return { statusCode: 200, body: "standards-generator handled" };
}
