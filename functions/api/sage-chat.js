// Cloudflare Pages Function for Chalky Sage.
// Preserves the existing access-code gate, campaign-code option, turn limits,
// message-size limits, and no-store JSON responses from the Netlify function.

const MODEL = "claude-opus-5";
const MAX_TURNS = 16;
const MAX_MESSAGE_CHARS = 2000;
const MAX_BODY_BYTES = 100_000;

const SAGE_INSTRUCTIONS = [
  "You are Chalky Sage, a patient and encouraging tutor who makes learning feel like a friendly conversation.",
  "You celebrate small wins, ask thought-provoking questions, and never make a student feel dumb for not knowing something.",
  "Learning with you feels safe and exciting.",
  "",
  "You work as a virtual tutor for students ranging from middle school to college level, helping with math, science, English, and history.",
  "Adapt your teaching style and pace to the student's level.",
  "",
  "Tone:",
  "- Patient and encouraging: celebrate effort, not just correctness",
  "- Curious and Socratic: ask guiding questions rather than lecturing",
  "- Clear and simple: break complex ideas into digestible pieces",
  "- Warm and relatable: use analogies from everyday life",
  "- Adaptive: match the student's energy and vocabulary level",
  "",
  "Goal: help the student understand concepts deeply, not just get an answer. Guide them step by step and build their confidence.",
  "",
  "This is a short back-and-forth text chat, not an essay: keep each reply to a few short paragraphs, or a short list, and end with a question or next step when it fits.",
  "If the student says goodbye or seems finished, wrap up warmly in one short reply.",
  "Never ask for or repeat personal details such as full names, schools, addresses, or phone numbers."
].join("\n");

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

async function digest(value) {
  const bytes = new TextEncoder().encode(String(value ?? ""));
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

async function codeMatches(given, expected) {
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function cleanTurns(raw) {
  if (!Array.isArray(raw)) return [];
  let turns = raw
    .filter(t => t && (t.role === "user" || t.role === "assistant") &&
      typeof t.content === "string" && t.content.trim() !== "")
    .map(t => ({ role: t.role, content: t.content.slice(0, MAX_MESSAGE_CHARS) }))
    .slice(-MAX_TURNS);
  while (turns.length && turns[0].role !== "user") turns = turns.slice(1);
  return turns;
}

export async function onRequestPost({ request, env }) {
  const apiKey = env.ANTHROPIC_API_KEY;
  const expectedCode = env.SAGE_ACCESS_CODE;
  if (!apiKey || !expectedCode) {
    console.error("sage-chat: ANTHROPIC_API_KEY or SAGE_ACCESS_CODE is not configured");
    return json({ error: "not_configured" }, 503);
  }

  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES) return json({ error: "bad_request" }, 413);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const campaignCode = env.SAGE_CAMPAIGN_CODE;
  const primaryOk = await codeMatches(payload.code, expectedCode);
  const campaignOk = campaignCode ? await codeMatches(payload.code, campaignCode) : false;
  if (!primaryOk && !campaignOk) return json({ error: "wrong_code" }, 401);

  if (payload.check) return json({ ok: true });

  const turns = cleanTurns(payload.messages);
  if (!turns.length || turns[turns.length - 1].role !== "user") {
    return json({ error: "bad_request" }, 400);
  }

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "server-side-fallback-2026-07-01"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8000,
        output_config: { effort: "low" },
        system: SAGE_INSTRUCTIONS,
        messages: turns
      })
    });

    if (upstream.status === 429) return json({ error: "rate_limited" }, 429);
    if (!upstream.ok) {
      const detail = await upstream.text();
      console.error("sage-chat: Anthropic API error", upstream.status, detail.slice(0, 1000));
      return json({ error: "upstream" }, 502);
    }

    const response = await upstream.json();
    if (response.stop_reason === "refusal") return json({ error: "refused" });
    const reply = (response.content || [])
      .filter(block => block.type === "text")
      .map(block => block.text)
      .join("")
      .trim();
    if (!reply) return json({ error: "empty" });
    return json({ text: reply, truncated: response.stop_reason === "max_tokens" });
  } catch (error) {
    console.error("sage-chat: unexpected error", error);
    return json({ error: "server" }, 500);
  }
}

export async function onRequest({ request }) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { "Allow": "POST", "Cache-Control": "no-store" }
    });
  }
  return json({ error: "method_not_allowed" }, 405);
}
