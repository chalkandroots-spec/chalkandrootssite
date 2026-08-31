// netlify/functions/approve-standard-plan.js
//
// This is the link Angella clicks from her "New Standards Generator request"
// review email. It verifies the link hasn't been tampered with, then sends
// the finished plan to the teacher who requested it via Resend.
//
// Requires the same env vars as submission-created.js:
//   RESEND_API_KEY, APPROVAL_SECRET

const crypto = require("crypto");

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const payloadB64 = params.payload || "";
  const sig = params.sig || "";
  const secret = process.env.APPROVAL_SECRET;
  const resendKey = process.env.RESEND_API_KEY;

  const page = (title, message, ok) => ({
    statusCode: ok ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body: `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
      <style>body{font-family:Georgia,serif;background:#FAF7F2;color:#35302B;
      display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
      .box{max-width:480px;text-align:center;padding:36px;background:#fff;
      border-radius:20px;box-shadow:0 10px 28px rgba(107,76,59,.12)}
      h1{color:#7A9B7A;font-size:1.6rem}</style></head>
      <body><div class="box"><h1>${title}</h1><p>${message}</p></div></body></html>`,
  });

  if (!secret || !resendKey) {
    console.error("APPROVAL_SECRET or RESEND_API_KEY not set");
    return page("Not configured", "This site isn't fully set up yet — RESEND_API_KEY and APPROVAL_SECRET both need to be set in Netlify.", false);
  }

  if (!payloadB64 || !sig) {
    return page("Missing link data", "This approval link is incomplete. Please use the link from the review email exactly as sent.", false);
  }

  const expectedSig = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
  const sigBuffer = Buffer.from(sig);
  const expectedBuffer = Buffer.from(expectedSig);
  const validSig =
    sigBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(sigBuffer, expectedBuffer);

  if (!validSig) {
    return page("Link invalid", "This approval link doesn't match — it may have been altered, or APPROVAL_SECRET was changed after this email was sent.", false);
  }

  let data;
  try {
    const json = Buffer.from(payloadB64, "base64url").toString("utf8");
    data = JSON.parse(json);
  } catch (err) {
    console.error("Failed to decode payload:", err);
    return page("Link invalid", "This approval link's data couldn't be read.", false);
  }

  const { name, email, standard, gradeBand, durationLabel, plan } = data;

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
      <p>Hi ${name || "there"},</p>
      <p>Here's your plan for <b>${standard}</b> (${gradeBand || ""}), built for ${durationLabel || "your requested timeframe"}.</p>
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
      }),
    });

    if (!sendRes.ok) {
      const errText = await sendRes.text();
      console.error("Resend send-to-teacher error:", sendRes.status, errText);
      return page("Send failed", "The email to the teacher didn't go through. Check the Netlify function logs for details, or try again in a few minutes.", false);
    }
  } catch (err) {
    console.error("Send-to-teacher fetch failed:", err);
    return page("Send failed", "Something went wrong sending this email. Check the Netlify function logs for details.", false);
  }

  return page(
    "✅ Sent!",
    `The ${standard} plan has been emailed to ${name || "the teacher"} at ${email}. You can close this tab.`,
    true
  );
};
