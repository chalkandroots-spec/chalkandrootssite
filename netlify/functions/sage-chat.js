// netlify/functions/sage-chat.js
//
// Backend for Chalky Sage (sage.html), the members-only AI tutor. The page
// posts the member access code plus the conversation so far; this function
// checks the code, trims the conversation to keep each request cheap, and
// returns Claude's next reply.
//
// Requires environment variables, set in Netlify:
//   ANTHROPIC_API_KEY  -- same key the Standards Generator uses
//                        (see submission-created.js)
//   SAGE_ACCESS_CODE   -- the members' access code shared in the paid
//                        Substack post. Every request is refused until it
//                        is set.
//   SAGE_CAMPAIGN_CODE -- optional. A second code for a giveaway or campaign,
//                        accepted alongside the members' code. Remove the
//                        variable to switch the campaign code off without
//                        touching the members' code.

const crypto = require("crypto");
const Anthropic = require("@anthropic-ai/sdk");

const MODEL = "claude-opus-5";

// Cost guards: only the most recent turns are sent, and each message is
// capped, so a long session can't turn into one very expensive request.
const MAX_TURNS = 16;
const MAX_MESSAGE_CHARS = 2000;

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
  "Never ask for or repeat personal details such as full names, schools, addresses, or phone numbers.",
].join("\n");

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body),
  };
}

// Compares hashes so the check takes the same time whether or not the
// first characters of a guess happen to match.
function codeMatches(given, expected) {
  const a = crypto.createHash("sha256").update(String(given || "")).digest();
  const b = crypto.createHash("sha256").update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

// Keeps only well-formed user/assistant turns, capped in length and count,
// and makes sure the conversation starts with a user turn as the API needs.
function cleanTurns(raw) {
  if (!Array.isArray(raw)) return [];
  let turns = raw
    .filter(
      (t) =>
        t &&
        (t.role === "user" || t.role === "assistant") &&
        typeof t.content === "string" &&
        t.content.trim() !== ""
    )
    .map((t) => ({ role: t.role, content: t.content.slice(0, MAX_MESSAGE_CHARS) }))
    .slice(-MAX_TURNS);
  while (turns.length && turns[0].role !== "user") turns = turns.slice(1);
  return turns;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "method_not_allowed" });

  const expectedCode = process.env.SAGE_ACCESS_CODE;
  if (!process.env.ANTHROPIC_API_KEY || !expectedCode) {
    console.error("sage-chat: ANTHROPIC_API_KEY or SAGE_ACCESS_CODE is not set");
    return json(503, { error: "not_configured" });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return json(400, { error: "bad_request" });
  }

  const campaignCode = process.env.SAGE_CAMPAIGN_CODE;
  const codeOk =
    codeMatches(payload.code, expectedCode) ||
    (campaignCode ? codeMatches(payload.code, campaignCode) : false);
  if (!codeOk) return json(401, { error: "wrong_code" });

  // A code check with no conversation lets the page unlock the chat.
  if (payload.check) return json(200, { ok: true });

  const turns = cleanTurns(payload.messages);
  if (!turns.length || turns[turns.length - 1].role !== "user") {
    return json(400, { error: "bad_request" });
  }

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      // Tutoring chat is short and conversational, so low effort keeps
      // replies quick and inexpensive without hurting quality.
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SAGE_INSTRUCTIONS,
      messages: turns,
    });

    if (response.stop_reason === "refusal") return json(200, { error: "refused" });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!text) return json(200, { error: "empty" });

    return json(200, { text, truncated: response.stop_reason === "max_tokens" });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return json(429, { error: "rate_limited" });
    if (error instanceof Anthropic.APIError) {
      console.error(`sage-chat: Anthropic API error ${error.status}:`, error.message);
      return json(502, { error: "upstream" });
    }
    console.error("sage-chat: unexpected error", error);
    return json(500, { error: "server" });
  }
};
