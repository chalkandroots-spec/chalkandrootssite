// netlify/functions/lib/plan-documents.js
//
// Turns a Standards Generator plan (the JSON Claude drafts — see
// submission-created.js) into branded .pptx and .pdf files, styled with the
// Chalk & Roots site palette instead of default white slides/pages.
//
// buildPlanPptx() -> one slide per schedule entry (day/week), per Angella's
// request, plus a title slide and a closing "instructional routine" slide.
// buildPlanPdf()  -> a single branded document covering the same content,
// for teachers who'd rather print/read than present.

const path = require("path");
const PptxGenJS = require("pptxgenjs");
const PDFDocument = require("pdfkit");

// Chalk & Roots brand palette (matches the --sage/--terra/--cream/etc.
// custom properties in index.html's <style> block).
const BRAND = {
  sage: "7A9B7A",
  sage2: "C8D9C8",
  pale: "EFF5EF",
  terra: "C4714A",
  terra2: "E8B89A",
  cream: "FAF7F2",
  brown: "4A3428",
  charcoal: "35302B",
  muted: "6F6760",
  gold: "C9A227",
  goldPale: "F5E9C4",
  white: "FFFFFF",
};

const ASSETS_DIR = path.join(__dirname, "..", "..", "..", "assets");
const EMBLEM_PATH = path.join(ASSETS_DIR, "chalk-roots-emblem.png");
const AVATAR_PATH = path.join(ASSETS_DIR, "angella-avatar-illustration.jpg");

// Serif for headings (stands in for the site's Playfair Display, which
// can't be embedded portably in .pptx/.pdf), sans-serif for body text
// (stands in for Nunito) — chosen so both render consistently without the
// viewer needing the actual web fonts installed.
const HEADING_FONT = "Georgia";
const BODY_FONT = "Arial";

// ---------------------------------------------------------------------------
// PowerPoint
// ---------------------------------------------------------------------------

function addBrandFooter(slide, pptx) {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 5.33, w: "100%", h: 0.3,
    fill: { color: BRAND.gold },
    line: { type: "none" },
  });
  slide.addText("Chalk & Roots  ·  chalkandroots.com", {
    x: 0, y: 5.33, w: "100%", h: 0.3,
    align: "center", valign: "middle",
    fontFace: BODY_FONT, fontSize: 10, bold: true, color: BRAND.brown,
  });
}

function addTitleSlide(pptx, plan, meta) {
  const slide = pptx.addSlide();
  slide.background = { color: BRAND.cream };

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: "100%", h: 0.18,
    fill: { color: BRAND.sage },
    line: { type: "none" },
  });

  // The avatar art is a full illustrated scene (portrait, 1200x1800 native),
  // not a plain headshot — give it a full-height panel on the right instead
  // of squeezing it into a small circular crop.
  const AVATAR_PANEL_W = 3.55;
  try {
    slide.addImage({
      path: AVATAR_PATH,
      x: 10 - AVATAR_PANEL_W, y: 0, w: AVATAR_PANEL_W, h: 5.33,
      sizing: { type: "cover", w: AVATAR_PANEL_W, h: 5.33 },
    });
  } catch (err) {
    console.error("plan-documents: failed to embed avatar image:", err);
  }
  try {
    slide.addImage({ path: EMBLEM_PATH, x: 0.4, y: 0.35, w: 0.85, h: 0.85 });
  } catch (err) {
    console.error("plan-documents: failed to embed emblem image:", err);
  }

  const textW = 10 - AVATAR_PANEL_W - 0.8;
  slide.addText(plan.title || "Your Lesson Plan", {
    x: 0.4, y: 1.7, w: textW, h: 1.3,
    fontFace: HEADING_FONT, fontSize: 28, bold: true, color: BRAND.sage,
    align: "left", valign: "bottom",
  });

  const subtitle = [meta.standard, meta.gradeBand, meta.durationLabel]
    .filter(Boolean)
    .join("   ·   ");
  slide.addText(subtitle, {
    x: 0.4, y: 3.05, w: textW, h: 0.5,
    fontFace: BODY_FONT, fontSize: 14, bold: true, color: BRAND.terra,
    align: "left",
  });

  if (plan.standardExplanation) {
    slide.addText(plan.standardExplanation, {
      x: 0.4, y: 3.55, w: textW, h: 1.5,
      fontFace: BODY_FONT, fontSize: 12, italic: true, color: BRAND.muted,
      align: "left", valign: "top",
    });
  }

  addBrandFooter(slide, pptx);
}

function addObjectivesMaterialsSlide(pptx, plan) {
  const slide = pptx.addSlide();
  slide.background = { color: BRAND.cream };

  slide.addText("Learning Objectives & Materials", {
    x: 0.5, y: 0.35, w: 9, h: 0.6,
    fontFace: HEADING_FONT, fontSize: 24, bold: true, color: BRAND.sage,
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.5, y: 0.95, w: 2.4, h: 0.05,
    fill: { color: BRAND.gold }, line: { type: "none" },
  });

  slide.addText("Learning Objectives", {
    x: 0.5, y: 1.2, w: 4.3, h: 0.4,
    fontFace: BODY_FONT, fontSize: 15, bold: true, color: BRAND.brown,
  });
  slide.addText(
    (plan.objectives || []).map((o) => ({ text: o, options: { bullet: true, breakLine: true } })),
    {
      x: 0.5, y: 1.65, w: 4.3, h: 3.4,
      fontFace: BODY_FONT, fontSize: 13, color: BRAND.charcoal, valign: "top",
    }
  );

  slide.addShape(pptx.ShapeType.rect, {
    x: 5.15, y: 1.2, w: 0.02, h: 3.9,
    fill: { color: BRAND.sage2 }, line: { type: "none" },
  });

  slide.addText("Materials & Resources", {
    x: 5.4, y: 1.2, w: 4.1, h: 0.4,
    fontFace: BODY_FONT, fontSize: 15, bold: true, color: BRAND.brown,
  });
  slide.addText(
    (plan.materials || []).map((m) => ({ text: m, options: { bullet: true, breakLine: true } })),
    {
      x: 5.4, y: 1.65, w: 4.1, h: 3.4,
      fontFace: BODY_FONT, fontSize: 13, color: BRAND.charcoal, valign: "top",
    }
  );

  addBrandFooter(slide, pptx);
}

function addScheduleSlide(pptx, day) {
  const slide = pptx.addSlide();
  slide.background = { color: BRAND.cream };

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: "100%", h: 1.1,
    fill: { color: BRAND.terra }, line: { type: "none" },
  });
  slide.addText(day.label || "Session", {
    x: 0.5, y: 0.12, w: 9, h: 0.5,
    fontFace: HEADING_FONT, fontSize: 22, bold: true, color: BRAND.white,
  });
  if (day.focus) {
    slide.addText(day.focus, {
      x: 0.5, y: 0.62, w: 9, h: 0.4,
      fontFace: BODY_FONT, fontSize: 14, italic: true, color: BRAND.goldPale,
    });
  }

  slide.addText(
    (day.activities || []).map((a) => ({ text: a, options: { bullet: true, breakLine: true } })),
    {
      x: 0.7, y: 1.5, w: 8.6, h: 3.6,
      fontFace: BODY_FONT, fontSize: 15, color: BRAND.charcoal, valign: "top",
      lineSpacing: 26,
    }
  );

  addBrandFooter(slide, pptx);
}

function addRoutineSlide(pptx, plan) {
  const slide = pptx.addSlide();
  slide.background = { color: BRAND.cream };

  slide.addText("Instructional Routine", {
    x: 0.5, y: 0.35, w: 9, h: 0.6,
    fontFace: HEADING_FONT, fontSize: 24, bold: true, color: BRAND.sage,
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.5, y: 0.95, w: 2.4, h: 0.05,
    fill: { color: BRAND.gold }, line: { type: "none" },
  });

  slide.addText(
    (plan.instructionalRoutine || []).map((step, i) => ({
      text: `${i + 1}.  ${step}`,
      options: { breakLine: true, paraSpaceAfter: 10 },
    })),
    {
      x: 0.7, y: 1.3, w: 8.6, h: 3.8,
      fontFace: BODY_FONT, fontSize: 14, color: BRAND.charcoal, valign: "top",
    }
  );

  addBrandFooter(slide, pptx);
}

async function buildPlanPptx(plan, meta) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "CR_16x9", width: 10, height: 5.63 });
  pptx.layout = "CR_16x9";

  addTitleSlide(pptx, plan, meta);
  addObjectivesMaterialsSlide(pptx, plan);
  (plan.schedule || []).forEach((day) => addScheduleSlide(pptx, day));
  addRoutineSlide(pptx, plan);

  const data = await pptx.write({ outputType: "nodebuffer" });
  return data;
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

function buildPlanPdf(plan, meta) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 54 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width;

    function brandHeader() {
      doc.rect(0, 0, pageWidth, 10).fill(BRAND_HEX(BRAND.sage));
      doc.rect(0, 10, pageWidth, 4).fill(BRAND_HEX(BRAND.gold));
      doc.moveDown(1.4);
    }

    function sectionHeading(text) {
      doc.moveDown(0.6);
      doc.fillColor(BRAND_HEX(BRAND.sage)).font("Times-Bold").fontSize(16).text(text);
      doc.moveTo(doc.x, doc.y + 2).lineTo(doc.x + 60, doc.y + 2).lineWidth(2).strokeColor(BRAND_HEX(BRAND.gold)).stroke();
      doc.moveDown(0.5);
      doc.fillColor(BRAND_HEX(BRAND.charcoal)).font("Helvetica").fontSize(11);
    }

    function bulletList(items) {
      items.forEach((item) => {
        doc.fillColor(BRAND_HEX(BRAND.terra)).text("•  ", { continued: true });
        doc.fillColor(BRAND_HEX(BRAND.charcoal)).text(item);
      });
    }

    brandHeader();

    // Lay out the avatar image and title/subtitle side by side using fixed
    // coordinates (not the automatic text-flow cursor), then explicitly move
    // the cursor past whichever of the two is taller before continuing —
    // otherwise later sections overlap the image.
    const headerTop = doc.y;
    const avatarW = 65;
    const avatarH = avatarW * 1.5; // native 1200x1800 (2:3 portrait)
    const textX = doc.page.margins.left + avatarW + 16;
    const textW = pageWidth - doc.page.margins.right - textX;

    try {
      doc.image(AVATAR_PATH, doc.page.margins.left, headerTop, { width: avatarW });
    } catch (err) {
      console.error("plan-documents: failed to embed avatar in PDF:", err);
    }

    doc
      .font("Times-Bold").fontSize(20).fillColor(BRAND_HEX(BRAND.sage))
      .text(plan.title || "Your Lesson Plan", textX, headerTop, { width: textW });

    const subtitle = [meta.standard, meta.gradeBand, meta.durationLabel].filter(Boolean).join("   ·   ");
    doc.font("Helvetica-Bold").fontSize(11).fillColor(BRAND_HEX(BRAND.terra))
      .text(subtitle, textX, doc.y + 4, { width: textW });

    doc.y = Math.max(headerTop + avatarH, doc.y) + 14;
    doc.x = doc.page.margins.left;

    if (plan.standardExplanation) {
      doc.font("Helvetica-Oblique").fontSize(11).fillColor(BRAND_HEX(BRAND.muted))
        .text(plan.standardExplanation, doc.page.margins.left, doc.y, {
          width: pageWidth - doc.page.margins.left - doc.page.margins.right,
        });
    }

    sectionHeading("Learning Objectives");
    bulletList(plan.objectives || []);

    sectionHeading("Materials & Resources");
    bulletList(plan.materials || []);

    sectionHeading("Schedule");
    (plan.schedule || []).forEach((day) => {
      doc.moveDown(0.3);
      doc.font("Helvetica-Bold").fontSize(12).fillColor(BRAND_HEX(BRAND.brown))
        .text(`${day.label || ""} — ${day.focus || ""}`);
      doc.font("Helvetica").fontSize(11).fillColor(BRAND_HEX(BRAND.charcoal));
      bulletList(day.activities || []);
    });

    sectionHeading("Instructional Routine");
    (plan.instructionalRoutine || []).forEach((step, i) => {
      doc.fillColor(BRAND_HEX(BRAND.charcoal)).text(`${i + 1}.  ${step}`);
    });

    doc.moveDown(1.5);
    doc.font("Helvetica-Oblique").fontSize(10).fillColor(BRAND_HEX(BRAND.muted))
      .text("Chalk & Roots  ·  chalkandroots.com", { align: "center" });

    doc.end();
  });
}

function BRAND_HEX(hex) {
  return `#${hex}`;
}

module.exports = { buildPlanPptx, buildPlanPdf, BRAND };
