// netlify/functions/submission-created.js
//
// Netlify automatically invokes this function whenever a form submission
// is created on this site, using this exact filename convention.
// No manual webhook setup needed.
//
// Requires environment variables, set in Netlify:
//   RESEND_API_KEY               -- your API key from https://resend.com
//   AirTable_API_Key                -- a Personal Access Token from
//                                     https://airtable.com/create/tokens, scoped to
//                                     data.records:write on the "Chalk & Roots
//                                     Website Leads" base. Leads/Standards/Polls
//                                     logging is skipped (but submissions still land
//                                     in Netlify Forms) if unset.
//   AIRTABLE_BASE_ID                -- defaults to appsKlkufxVhzpE7C (the "Chalk &
//                                     Roots Website Leads" base) if unset.
//   ANTHROPIC_API_KEY             -- your API key from https://console.anthropic.com,
//                                     used by the C&R Standards Generator to draft
//                                     each lesson/unit plan (required for that
//                                     feature; requests are skipped without it)

const { buildPlanPptx, buildPlanPdf } = require("./lib/plan-documents");

// Creates one record in the given table of the "Chalk & Roots Website Leads"
// Airtable base. Silently no-ops (logging only) if AIRTABLE_API_KEY isn't set,
// so local/dev deploys and unconfigured sites don't error out.
async function airtableCreate(tableName, fields) {
  const apiKey = process.env.AirTable_API_Key || process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID || "appsKlkufxVhzpE7C";
  if (!apiKey) {
    console.log("AirTable_API_Key not set — skipping Airtable log for", tableName);
    return;
  }
  try {
    const res = await fetch(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fields, typecast: true }),
      }
    );
    if (!res.ok) {
      console.error("Airtable API error:", tableName, res.status, await res.text());
      return null;
    }
    const created = await res.json();
    return created.id || null;
  } catch (err) {
    console.error("Airtable API fetch failed:", tableName, err);
    return null;
  }
}

// Updates fields on one existing record. Returns true on success.
async function airtableUpdate(tableName, recordId, fields) {
  const apiKey = process.env.AirTable_API_Key || process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID || "appsKlkufxVhzpE7C";
  if (!apiKey || !recordId) return false;
  try {
    const res = await fetch(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}/${recordId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fields, typecast: true }),
      }
    );
    if (!res.ok) {
      console.error("Airtable update error:", tableName, res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("Airtable update failed:", tableName, err);
    return false;
  }
}

// True if this email already has a Leads row from this form marked Welcomed,
// so a repeat entry never triggers a second welcome email.
async function airtableAlreadyWelcomed(email, source) {
  const apiKey = process.env.AirTable_API_Key || process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID || "appsKlkufxVhzpE7C";
  if (!apiKey) return false;
  const esc = (v) => String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const formula = `AND(LOWER({Email})='${esc(email.toLowerCase())}',{Source}='${esc(source)}',{Welcomed}=1)`;
  try {
    const res = await fetch(
      `https://api.airtable.com/v0/${baseId}/Leads?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    if (!res.ok) {
      console.error("Airtable lookup error:", res.status, await res.text());
      return false;
    }
    const found = await res.json();
    return Array.isArray(found.records) && found.records.length > 0;
  } catch (err) {
    console.error("Airtable lookup failed:", err);
    return false;
  }
}

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

    if (formName === "vault-signup") {
      return await handleVaultSignup(data);
    }

    if (formName === "gold-giveaway") {
      return await handleGoldGiveaway(data);
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
  const name = data.name || "";
  const email = data.email || "";
  const gradeBand = data["grade-band"] || "";
  const resource = data.resource || "";
  const source = data.source || "direct";

  if (!email) {
    return { statusCode: 200, body: "Skipped: no email provided" };
  }

  await airtableCreate("Leads", {
    Name: name,
    Email: email,
    "Grade Band": gradeBand || undefined,
    Resource: resource || "none / general",
    Source: "free-resource-gate",
    "Submitted At": new Date().toISOString(),
    Notes: source && source !== "direct" ? `source: ${source}` : undefined,
  });

  return { statusCode: 200, body: "free-resource-gate handled" };
}

// Handles the homepage "Get the free AI Prompt Vault" email-gate signup.
// The visitor already gets their download link client-side on submit, so
// this just logs the lead to the same sheet as the other lead-capture
// forms (no per-submission email, to match how free-resource-gate and
// quiz-result are handled — every submission is still captured in the
// Netlify Forms dashboard regardless of this function).
async function handleVaultSignup(data) {
  const email = data.email || "";
  const source = data.source || "direct";

  if (!email) {
    return { statusCode: 200, body: "Skipped: no email provided" };
  }

  await airtableCreate("Leads", {
    Email: email,
    Resource: "ai-prompt-vault",
    Source: "vault-signup",
    "Submitted At": new Date().toISOString(),
    Notes: source && source !== "direct" ? `source: ${source}` : undefined,
  });

  return { statusCode: 200, body: "vault-signup handled" };
}

// Handles the /giveaway page signup: logs the lead to Airtable Leads, then
// sends the welcome email immediately (Resend) and marks the row Welcomed.
// Sent at most once per email address: a repeat entry is logged but not
// re-emailed. The hourly sync routine skips gold-giveaway entirely.
async function handleGoldGiveaway(data) {
  const email = data.email || "";
  const source = data.source || "direct";

  if (!email) {
    return { statusCode: 200, body: "Skipped: no email provided" };
  }

  const alreadyWelcomed = await airtableAlreadyWelcomed(email, "gold-giveaway");
  const sourceNote = source && source !== "direct" ? `source: ${source}` : "";

  const recordId = await airtableCreate("Leads", {
    Email: email,
    Resource: "none / general",
    Source: "gold-giveaway",
    "Submitted At": new Date().toISOString(),
    Notes: alreadyWelcomed
      ? [sourceNote, "repeat entry - welcome already sent"].filter(Boolean).join("; ")
      : sourceNote || undefined,
    Welcomed: alreadyWelcomed ? true : undefined,
  });

  if (alreadyWelcomed) {
    return { statusCode: 200, body: "gold-giveaway handled (repeat entry, no email)" };
  }
  if (!recordId) {
    return { statusCode: 200, body: "gold-giveaway: Airtable write failed, no email sent" };
  }

  const sent = await sendGoldGiveawayWelcome(email);
  if (sent) {
    await airtableUpdate("Leads", recordId, {
      Welcomed: true,
      Notes: [sourceNote, `welcome sent ${new Date().toISOString()}`].filter(Boolean).join("; "),
    });
  }

  return { statusCode: 200, body: "gold-giveaway handled" };
}

async function sendGoldGiveawayWelcome(toEmail) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("RESEND_API_KEY is not set - gold-giveaway welcome not sent");
    return false;
  }
  const text = "Hello, fellow educator! 🌱\n\nWelcome to the Chalk & Roots Syllable Celebration!\n\nYour giveaway entry has been received. We're celebrating the six syllable types and practical ways to help students recognize patterns, make connections, and explain their thinking.\n\nWhat to look forward to:\n- Syllable Live PD: practical literacy strategies for your classroom.\n- Flexible learning: instructional content will be available to explore on your own schedule.\n- Celebration giveaway: one eligible entrant will receive the premium SEE THE PATTERN Syllable Pattern Flipbook.\n\nWhen Chalk & Roots reaches 1,500 Instagram followers, we'll celebrate with a live random drawing during our Substack event. You do not need to attend live to be eligible to win. Event details will be announced when confirmed.\n\nExplore Chalk & Roots: https://chalkandroots.com\n\nThank you for being part of this journey and trusting me with your planning time.\n\nTeach the pattern. Build the connection. Grow the reader.\n\nWarmly,\nAngella\nFounder, Chalk & Roots";
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;color:#35302B;line-height:1.7;max-width:560px;margin:auto">' + text.split("\\n").map(line => line ? '<p>' + line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>' : '').join('') + '</div>';
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Angella at Chalk & Roots <noreply@chalkandroots.com>",
        reply_to: "chalkandroots@gmail.com",
        to: [toEmail],
        subject: "Welcome to Chalk & Roots \ud83c\udf31",
        text,
        html,
      }),
    });
    if (!res.ok) {
      console.error("Resend welcome error:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("Resend welcome fetch failed:", err);
    return false;
  }
}

// Handles the "What's Your Teaching Superpower?" quiz: notifies Angella
// by email with all three answers so completed quizzes don't just sit
// unseen in the Netlify Forms dashboard.
async function handleQuizResult(data) {
  const email = data.email || "";
  const timeDrain = data["biggest-time-drain"] || "(not provided)";
  const gradeBand = data["grade-band"] || "";
  const goal = data["goal"] || "(not provided)";
  const source = data.source || "direct";

  if (!email) {
    return { statusCode: 200, body: "Skipped: no email provided" };
  }

  await airtableCreate("Leads", {
    Email: email,
    "Grade Band": gradeBand || undefined,
    Resource: "none / general",
    Source: "quiz-result",
    "Submitted At": new Date().toISOString(),
    Notes: `biggest time drain: ${timeDrain}; goal: ${goal}${source && source !== "direct" ? `; source: ${source}` : ""}`,
  });

  return { statusCode: 200, body: "quiz-result handled" };
}

// Handles the two one-click yes/no polls (AI use, SOR interest). These are
// anonymous — no email is captured — so we deliberately do NOT send an email
// per vote (that would flood the inbox). Instead each vote is appended to a
// Airtable tally if AIRTABLE_API_KEY is configured. Every vote is
// always captured in the Netlify Forms dashboard regardless.
async function handlePollVote(formName, data) {
  const vote = data.vote || "";

  await airtableCreate("Polls", {
    Vote: vote || "(no vote)",
    "Poll Type": formName,
    "Submitted At": new Date().toISOString(),
  });

  return { statusCode: 200, body: "poll vote handled" };
}

// Handles the "Building a lesson from a language standard?" box:
// forwards Name/Email/Standard to a Google Sheet (via Apps Script Web App)
// and emails Angella a notification.
async function handleLessonStandard(data) {
  const name = data.name || "there";
  const email = data.email || "";
  const standard = data.standard || "";

  await airtableCreate("Lesson Standard Requests", {
    Name: name,
    Email: email,
    Standard: standard,
    Source: "lesson-standard",
    "Submitted At": new Date().toISOString(),
  });

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
// to draft a full plan -> the draft is rendered into a branded .pptx (one
// slide per schedule day/week) and .pdf -> both are emailed straight to the
// teacher as attachments. No manual review step and no database: everything
// happens in this one function call.

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

  if (!email || !standard) {
    console.log("TRACE: exiting early — missing email or standard. email =", email, "standard =", standard);
    return { statusCode: 200, body: "Skipped: missing email or standard" };
  }
  if (!anthropicKey) {
    console.error("ANTHROPIC_API_KEY is not set — cannot draft plan");
    return { statusCode: 200, body: "Skipped: AI generation not configured" };
  }
  if (!resendKey) {
    console.error("RESEND_API_KEY is not set — drafted plan but could not email it to the teacher");
    return { statusCode: 200, body: "Skipped: email service not configured" };
  }

  await airtableCreate("Lesson Standard Requests", {
    Name: name,
    Email: email,
    Standard: standard,
    Duration: durationRaw,
    Source: "standards-generator",
    "Submitted At": new Date().toISOString(),
  });

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

  // 2) Render the draft into branded .pptx (one slide per schedule day/week)
  // and .pdf files, styled with the site's own palette and Angella's avatar
  // art instead of plain white slides.
  const meta = { name, email, standard, gradeBand, durationLabel };
  let pptxBuffer, pdfBuffer;
  try {
    console.log("TRACE: building pptx/pdf...");
    [pptxBuffer, pdfBuffer] = await Promise.all([
      buildPlanPptx(plan, meta),
      buildPlanPdf(plan, meta),
    ]);
  } catch (err) {
    console.error("Failed to build plan documents:", err);
    return { statusCode: 200, body: "Document generation failed" };
  }

  // 3) Email the finished plan straight to the teacher, with both files
  // attached. Nothing waits on manual review.
  const scheduleHtml = (plan.schedule || [])
    .map(
      (day) =>
        `<div style="margin:16px 0;padding:16px;background:#FBF5EA;border-radius:12px">` +
        `<p style="margin:0 0 8px;font-weight:800;color:#4A3428">${day.label || ""} — ${day.focus || ""}</p>` +
        `<ul style="margin:0;padding-left:20px;color:#35302B">` +
        (day.activities || []).map((a) => `<li>${a}</li>`).join("") +
        `</ul></div>`
    )
    .join("");

  const teacherHtml = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#35302B;line-height:1.65;max-width:640px;margin:auto">
      <div style="text-align:center;margin-bottom:20px">
        <h2 style="color:#7A9B7A;font-family:Georgia,serif;margin-bottom:4px">Chalk &amp; Roots</h2>
        <p style="color:#C9A227;font-weight:900;letter-spacing:.08em;text-transform:uppercase;font-size:.8rem">Your Standards Generator Plan</p>
      </div>
      <p>Hi ${name},</p>
      <p>Here's your plan for <b>${standard}</b> (${gradeBand}), built for ${durationLabel} — attached as both PowerPoint and PDF.</p>
      <h3 style="font-family:Georgia,serif;color:#4A3428;border-bottom:2px solid #C9A227;padding-bottom:6px">${plan.title || "Your Plan"}</h3>
      <p style="color:#6f6760;font-style:italic">${plan.standardExplanation || ""}</p>
      <p style="font-weight:800;color:#4A3428">📌 Learning Objectives</p>
      <ul>${(plan.objectives || []).map((o) => `<li>${o}</li>`).join("")}</ul>
      <p style="font-weight:800;color:#4A3428">🧰 Materials &amp; Resources</p>
      <ul>${(plan.materials || []).map((m) => `<li>${m}</li>`).join("")}</ul>
      <p style="font-weight:800;color:#4A3428">🗓️ Schedule</p>
      ${scheduleHtml}
      <p style="font-weight:800;color:#4A3428">👩‍🏫 Instructional Routine</p>
      <ol>${(plan.instructionalRoutine || []).map((r) => `<li>${r}</li>`).join("")}</ol>
      <p style="margin-top:28px">Happy teaching!<br>Angella<br>
        <a href="https://chalkandroots.com" style="color:#6B4C3B">chalkandroots.com</a>
      </p>
      <div style="text-align:center;margin-top:20px">
        <a href="https://ko-fi.com/chalkandroots/shop" style="display:inline-block;background:#4A3428;color:#fff;font-weight:800;padding:12px 22px;border-radius:999px;text-decoration:none">☕ Browse more resources on Ko-fi &#8594;</a>
      </div>
    </div>`;

  const fileSlug = (standard || "plan").replace(/[^a-z0-9]+/gi, "-").toLowerCase();

  try {
    const sendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Chalk & Roots <noreply@chalkandroots.com>",
        reply_to: "chalkandroots@gmail.com",
        to: [email],
        subject: `Your ${standard} plan from Chalk & Roots`,
        html: teacherHtml,
        attachments: [
          { filename: `${fileSlug}.pptx`, content: pptxBuffer.toString("base64") },
          { filename: `${fileSlug}.pdf`, content: pdfBuffer.toString("base64") },
        ],
      }),
    });

    if (!sendRes.ok) {
      console.error("Failed to email plan to teacher:", sendRes.status, await sendRes.text());
      return { statusCode: 200, body: "Plan generated but email failed" };
    }
    console.log("TRACE: plan emailed successfully to", email);
  } catch (err) {
    console.error("Send-to-teacher fetch failed:", err);
    return { statusCode: 200, body: "Plan generated but email failed" };
  }

  return { statusCode: 200, body: "standards-generator handled" };
}
