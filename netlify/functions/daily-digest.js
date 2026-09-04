// netlify/functions/daily-digest.js
//
// Scheduled function (see netlify.toml) that runs once a day and emails
// Angella a table-formatted summary of everything new in the last 24 hours
// across the 3 Airtable tables (Leads, Lesson Standard Requests, Polls).
// Skips sending if there was no new activity, so the inbox isn't spammed
// with empty digests.
//
// Requires the same env vars as submission-created.js:
//   AirTable_API_Key, AIRTABLE_BASE_ID, RESEND_API_KEY

const BASE_ID_FALLBACK = "appsKlkufxVhzpE7C";

async function fetchRecentRecords(apiKey, baseId, tableName) {
  const formula = encodeURIComponent(
    "IS_AFTER({Submitted At}, DATEADD(NOW(), -1, 'days'))"
  );
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
    tableName
  )}?filterByFormula=${formula}&sort[0][field]=Submitted%20At&sort[0][direction]=desc`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    console.error("Airtable fetch error:", tableName, res.status, await res.text());
    return [];
  }
  const data = await res.json();
  return data.records || [];
}

function esc(val) {
  if (val === undefined || val === null) return "";
  return String(val).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function renderTable(title, records, columns) {
  if (!records.length) return "";
  const headerRow = columns.map((c) => `<th style="text-align:left;padding:8px 10px;border-bottom:2px solid #C8D9C8;color:#4A3428">${c.label}</th>`).join("");
  const rows = records
    .map((r) => {
      const cells = columns
        .map((c) => `<td style="padding:8px 10px;border-bottom:1px solid #EFF5EF;color:#35302B">${esc(r.fields[c.field])}</td>`)
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  return `
    <h3 style="font-family:Georgia,serif;color:#7A9B7A;margin:24px 0 8px">${title} (${records.length})</h3>
    <table style="border-collapse:collapse;width:100%;font-family:Arial,Helvetica,sans-serif;font-size:14px">
      <thead><tr>${headerRow}</tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

exports.handler = async () => {
  const apiKey = process.env.AirTable_API_Key || process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID || BASE_ID_FALLBACK;
  const resendKey = process.env.RESEND_API_KEY;

  if (!apiKey || !resendKey) {
    console.log("daily-digest: missing AirTable_API_Key or RESEND_API_KEY, skipping");
    return { statusCode: 200, body: "Skipped: not configured" };
  }

  const [leads, standards, polls] = await Promise.all([
    fetchRecentRecords(apiKey, baseId, "Leads"),
    fetchRecentRecords(apiKey, baseId, "Lesson Standard Requests"),
    fetchRecentRecords(apiKey, baseId, "Polls"),
  ]);

  const totalCount = leads.length + standards.length + polls.length;
  if (totalCount === 0) {
    console.log("daily-digest: no new activity in the last 24 hours, skipping email");
    return { statusCode: 200, body: "No new activity, no email sent" };
  }

  const leadsHtml = renderTable("New Leads", leads, [
    { field: "Name", label: "Name" },
    { field: "Email", label: "Email" },
    { field: "Source", label: "Source" },
    { field: "Resource", label: "Resource" },
    { field: "Grade Band", label: "Grade Band" },
  ]);
  const standardsHtml = renderTable("New Lesson Standard Requests", standards, [
    { field: "Name", label: "Name" },
    { field: "Email", label: "Email" },
    { field: "Standard", label: "Standard" },
    { field: "Duration", label: "Duration" },
    { field: "Source", label: "Source" },
  ]);
  const pollsHtml = renderTable("New Poll Votes", polls, [
    { field: "Vote", label: "Vote" },
    { field: "Poll Type", label: "Poll" },
  ]);

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  });

  const bodyHtml = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#35302B;max-width:680px;margin:auto">
      <h2 style="color:#7A9B7A;font-family:Georgia,serif">Chalk &amp; Roots — Daily Digest</h2>
      <p style="color:#6f6760">${today} &mdash; ${totalCount} new item${totalCount === 1 ? "" : "s"} in the last 24 hours.</p>
      ${leadsHtml}${standardsHtml}${pollsHtml}
      <p style="margin-top:28px"><a href="https://airtable.com/${baseId}" style="color:#C4714A">Open the full Airtable base &#8594;</a></p>
    </div>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Chalk & Roots Digest <onboarding@resend.dev>",
        to: ["chalkandroots@gmail.com"],
        subject: `Daily Digest: ${totalCount} new item${totalCount === 1 ? "" : "s"} — ${today}`,
        html: bodyHtml,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error("daily-digest: Resend API error:", res.status, errText);
      return { statusCode: 200, body: `Digest generated (${totalCount} items) but email send failed: ${res.status} ${errText}` };
    }
  } catch (err) {
    console.error("daily-digest: Resend fetch failed:", err);
    return { statusCode: 200, body: `Digest generated (${totalCount} items) but email send threw: ${err}` };
  }

  return { statusCode: 200, body: `Digest sent: ${totalCount} items` };
};
