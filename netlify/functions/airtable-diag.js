// Temporary diagnostic endpoint: GET /.netlify/functions/airtable-diag
// Attempts a real Airtable API call with the currently-configured
// AIRTABLE_API_KEY / AIRTABLE_BASE_ID and returns the raw result, so the
// actual error (bad token, missing scope, wrong base, etc.) is visible
// directly in the response instead of needing to dig through Netlify's
// function log UI. Delete this file once the Airtable wiring is confirmed
// working.
exports.handler = async () => {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID || "appsKlkufxVhzpE7C";

  if (!apiKey) {
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: false, reason: "AIRTABLE_API_KEY is not set in this deploy's environment" }),
    };
  }

  try {
    const res = await fetch(
      `https://api.airtable.com/v0/${baseId}/Polls`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: { Vote: "diag-endpoint-test", "Poll Type": "sor-poll" },
          typecast: true,
        }),
      }
    );
    const text = await res.text();
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: res.ok,
        status: res.status,
        keyPrefix: apiKey.slice(0, 6),
        keyLength: apiKey.length,
        baseId,
        airtableResponse: text,
      }, null, 2),
    };
  } catch (err) {
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: false, reason: "fetch threw", error: String(err) }),
    };
  }
};
