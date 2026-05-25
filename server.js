const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const multer    = require('multer');
const pdfParse  = require('pdf-parse');
const mammoth   = require('mammoth');

const app = express();
app.use(cors());
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// ── SHARED AI CALLER ──────────────────────────────────────────
async function callAI(provider, apiKey, prompt, maxTokens = 2800) {
  const { default: fetch } = await import('node-fetch');

  if (provider === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] })
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    return d.content[0].text;
  }
  if (provider === 'openai') {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] })
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    return d.choices[0].message.content;
  }
  if (provider === 'gemini') {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    return d.candidates[0].content.parts[0].text;
  }
  if (provider === 'groq') {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'llama3-8b-8192', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] })
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));
    return d.choices[0].message.content;
  }
  throw new Error('Unknown provider: ' + provider);
}

// ── GENERATE (resume + cover letter + polish) ─────────────────
app.post('/api/generate', async (req, res) => {
  const { provider, apiKey, prompt } = req.body;
  try {
    res.json({ text: await callAI(provider, apiKey, prompt) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── UPLOAD & PARSE ────────────────────────────────────────────
app.post('/api/parse-resume', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const { provider, apiKey } = req.body;
  try {
    let text = '';
    const ext = req.file.originalname.toLowerCase();
    if (ext.endsWith('.pdf') || req.file.mimetype === 'application/pdf') {
      text = (await pdfParse(req.file.buffer)).text;
    } else if (ext.endsWith('.docx')) {
      text = (await mammoth.extractRawText({ buffer: req.file.buffer })).value;
    } else if (ext.endsWith('.txt') || req.file.mimetype.startsWith('text/')) {
      text = req.file.buffer.toString('utf-8');
    } else {
      return res.status(400).json({ error: 'Please upload PDF, DOCX, or TXT.' });
    }
    if (!text.trim()) return res.status(400).json({ error: 'No readable text found.' });

    const jsonText = await callAI(provider, apiKey,
      `Extract all information from this resume and return ONLY a valid JSON object — no markdown, no explanation.
Schema: {"name":"","title":"","email":"","phone":"","location":"","links":"","summary":"",
"experience":[{"title":"","company":"","duration":"","desc":""}],
"skills":[],"projects":[{"name":"","stack":"","desc":""}],"education":[{"degree":"","institution":"","year":""}]}
Resume text:\n${text.substring(0, 8000)}`, 2000);

    const match = jsonText.match(/\{[\s\S]*\}/);
    if (!match) return res.status(500).json({ error: 'Could not parse resume structure.' });
    res.json(JSON.parse(match[0]));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── EXPORT DOCX ───────────────────────────────────────────────
app.post('/api/export-docx', async (req, res) => {
  const { resume } = req.body;
  if (!resume) return res.status(400).json({ error: 'No resume data.' });
  try {
    const { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle } = require('docx');

    const SF = 'Calibri';  // sans
    const SE = 'Georgia';  // serif
    const SM = 'Courier New'; // mono

    const secTitle = (t) => new Paragraph({
      children: [new TextRun({ text: t.toUpperCase(), bold: true, size: 18, font: SM, color: '111111', characterSpacing: 80 })],
      spacing: { before: 280, after: 80 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'cccccc', space: 6 } }
    });

    const bullet = (b) => new Paragraph({
      children: [new TextRun({ text: '–  ' + b, size: 20, font: SE })],
      indent: { left: 260 },
      spacing: { after: 50 }
    });

    const kids = [];

    // Header
    kids.push(new Paragraph({ children: [new TextRun({ text: resume.header?.name || '', bold: true, size: 52, font: SF })], alignment: AlignmentType.CENTER, spacing: { after: 40 } }));
    if (resume.header?.title) kids.push(new Paragraph({ children: [new TextRun({ text: resume.header.title, size: 24, font: SE, italics: true, color: '555555' })], alignment: AlignmentType.CENTER, spacing: { after: 60 } }));
    if (resume.header?.contact) kids.push(new Paragraph({ children: [new TextRun({ text: resume.header.contact, size: 18, font: SM, color: '666666' })], alignment: AlignmentType.CENTER, spacing: { after: 0 } }));
    kids.push(new Paragraph({ children: [new TextRun({ text: '' })], border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: '1a1a1a', space: 8 } }, spacing: { before: 160, after: 0 } }));

    // Summary
    if (resume.summary) {
      kids.push(secTitle('Professional Summary'));
      kids.push(new Paragraph({ children: [new TextRun({ text: resume.summary, size: 21, font: SE, color: '333333' })], spacing: { after: 80 } }));
    }

    // Experience
    if (resume.experience?.length) {
      kids.push(secTitle('Work Experience'));
      resume.experience.forEach(e => {
        kids.push(new Paragraph({ children: [new TextRun({ text: e.title || '', bold: true, size: 22, font: SF }), ...(e.duration ? [new TextRun({ text: '   ' + e.duration, size: 18, font: SM, color: '777777' })] : [])], spacing: { before: 160, after: 20 } }));
        kids.push(new Paragraph({ children: [new TextRun({ text: e.company || '', italics: true, size: 20, font: SE, color: '555555' }), ...(e.location ? [new TextRun({ text: '  ·  ' + e.location, size: 18, font: SM, color: '999999' })] : [])], spacing: { after: 60 } }));
        (e.bullets || []).forEach(b => kids.push(bullet(b)));
      });
    }

    // Skills
    if (resume.skills?.length) {
      kids.push(secTitle('Skills'));
      resume.skills.forEach(sg => kids.push(new Paragraph({ children: [new TextRun({ text: (sg.category || '') + ': ', bold: true, size: 20, font: SF }), new TextRun({ text: (sg.items || []).join(', '), size: 20, font: SE, color: '222222' })], spacing: { after: 50 } })));
    }

    // Projects
    if (resume.projects?.length) {
      kids.push(secTitle('Projects'));
      resume.projects.forEach(p => {
        kids.push(new Paragraph({ children: [new TextRun({ text: p.name || '', bold: true, size: 22, font: SF }), ...(p.stack ? [new TextRun({ text: '  |  ' + p.stack, size: 19, font: SE, italics: true, color: '666666' })] : [])], spacing: { before: 140, after: 60 } }));
        (p.bullets || []).forEach(b => kids.push(bullet(b)));
      });
    }

    // Education
    if (resume.education?.length) {
      kids.push(secTitle('Education'));
      resume.education.forEach(e => {
        kids.push(new Paragraph({ children: [new TextRun({ text: e.degree || '', bold: true, size: 22, font: SF }), ...(e.year ? [new TextRun({ text: '   ' + e.year, size: 18, font: SM, color: '777777' })] : [])], spacing: { before: 140, after: 20 } }));
        if (e.institution) kids.push(new Paragraph({ children: [new TextRun({ text: e.institution, italics: true, size: 20, font: SE, color: '555555' })], spacing: { after: 60 } }));
      });
    }

    const doc = new Document({ sections: [{ properties: { page: { margin: { top: 720, right: 1080, bottom: 720, left: 1080 } } }, children: kids }] });
    const buf = await Packer.toBuffer(doc);
    const fname = (resume.header?.name || 'resume').replace(/\s+/g, '_').toLowerCase();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}_resume.docx"`);
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`\n✦ ResumeForge → http://localhost:${PORT}\n`));
