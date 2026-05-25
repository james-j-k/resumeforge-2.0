const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const multer   = require('multer');
const pdfParse = require('pdf-parse');
const mammoth  = require('mammoth');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const fs       = require('fs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload     = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const JWT_SECRET = process.env.JWT_SECRET || 'resumeforge-dev-secret';
const DB_PATH    = path.join(__dirname, 'db.json');

// ── DATABASE ──────────────────────────────────────────────────
function loadDB() {
  if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify({ users: [] }, null, 2));
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}
function saveDB(db) { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }
function emptyProfile() {
  return { name:'', title:'', email:'', phone:'', location:'', links:'', summary:'',
           experience:[], skills:[], projects:[], education:[] };
}

// Seed default manager on first run
(function init() {
  const db = loadDB();
  if (!db.users.find(u => u.role === 'manager')) {
    db.users.push({
      id: uuidv4(), username: 'admin', name: 'Admin', email: 'admin@company.com',
      role: 'manager', password: bcrypt.hashSync('admin123', 10),
      profile: emptyProfile(), createdAt: new Date().toISOString()
    });
    saveDB(db);
    console.log('\n  ✦ Default manager created → username: admin  password: admin123\n');
  }
})();

// ── AUTH MIDDLEWARE ───────────────────────────────────────────
function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ error: 'Not authenticated' });
  try { req.user = jwt.verify(h.split(' ')[1], JWT_SECRET); next(); }
  catch(e) { res.status(401).json({ error: 'Invalid or expired session' }); }
}
function managerOnly(req, res, next) {
  if (req.user.role !== 'manager') return res.status(403).json({ error: 'Manager access required' });
  next();
}

// ── AUTH ──────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const db = loadDB();
  const user = db.users.find(u => u.username === username.toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Invalid username or password' });
  const token = jwt.sign({ id: user.id, username: user.username, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, username: user.username, name: user.name, role: user.role } });
});

app.post('/api/auth/register', (req, res) => {
  const { username, password, name, email } = req.body;
  if (!username || !password || !name) return res.status(400).json({ error: 'Username, name and password required' });
  const db = loadDB();
  if (db.users.find(u => u.username === username.toLowerCase().trim()))
    return res.status(400).json({ error: 'Username already taken' });
  const user = {
    id: uuidv4(), username: username.toLowerCase().trim(), name, email: email||'',
    role: 'employee', password: bcrypt.hashSync(password, 10),
    profile: { ...emptyProfile(), name, email: email||'' }, createdAt: new Date().toISOString()
  };
  db.users.push(user); saveDB(db);
  const token = jwt.sign({ id: user.id, username: user.username, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, username: user.username, name: user.name, role: user.role } });
});

app.get('/api/auth/me', auth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ id: user.id, username: user.username, name: user.name, role: user.role, email: user.email, profile: user.profile || emptyProfile() });
});

// ── PROFILE ───────────────────────────────────────────────────
app.put('/api/profile', auth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  user.profile = req.body;
  saveDB(db);
  res.json({ ok: true });
});

// ── EMPLOYEES (manager) ───────────────────────────────────────
app.get('/api/employees', auth, managerOnly, (req, res) => {
  const db = loadDB();
  let list = db.users.filter(u => u.role === 'employee');
  const { q } = req.query;
  if (q) {
    const terms = q.toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    list = list.filter(u => terms.some(t =>
      (u.profile?.skills||[]).some(s => s.toLowerCase().includes(t)) ||
      (u.profile?.title||'').toLowerCase().includes(t) ||
      (u.name||'').toLowerCase().includes(t)
    ));
  }
  res.json(list.map(u => ({ id: u.id, name: u.name, username: u.username, email: u.email, profile: u.profile, createdAt: u.createdAt })));
});

app.get('/api/employees/:id', auth, managerOnly, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json({ id: user.id, name: user.name, username: user.username, email: user.email, profile: user.profile });
});

app.post('/api/employees', auth, managerOnly, (req, res) => {
  const { username, password, name, email } = req.body;
  if (!username || !password || !name) return res.status(400).json({ error: 'Username, name and password required' });
  const db = loadDB();
  if (db.users.find(u => u.username === username.toLowerCase().trim()))
    return res.status(400).json({ error: 'Username already taken' });
  const user = {
    id: uuidv4(), username: username.toLowerCase().trim(), name, email: email||'',
    role: 'employee', password: bcrypt.hashSync(password, 10),
    profile: { ...emptyProfile(), name, email: email||'' }, createdAt: new Date().toISOString()
  };
  db.users.push(user); saveDB(db);
  res.json({ id: user.id, name: user.name, username: user.username });
});

app.delete('/api/employees/:id', auth, managerOnly, (req, res) => {
  const db = loadDB();
  const idx = db.users.findIndex(u => u.id === req.params.id && u.role === 'employee');
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.users.splice(idx, 1); saveDB(db);
  res.json({ ok: true });
});

// ── SHARED AI CALLER ──────────────────────────────────────────
async function callAI(provider, apiKey, prompt, maxTokens = 2800) {
  const { default: fetch } = await import('node-fetch');
  if (provider === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] })
    });
    const d = await r.json(); if (d.error) throw new Error(d.error.message); return d.content[0].text;
  }
  if (provider === 'openai') {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] })
    });
    const d = await r.json(); if (d.error) throw new Error(d.error.message); return d.choices[0].message.content;
  }
  if (provider === 'gemini') {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const d = await r.json(); if (d.error) throw new Error(d.error.message); return d.candidates[0].content.parts[0].text;
  }
  if (provider === 'groq') {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'llama3-8b-8192', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] })
    });
    const d = await r.json(); if (d.error) throw new Error(d.error.message || JSON.stringify(d.error)); return d.choices[0].message.content;
  }
  throw new Error('Unknown provider: ' + provider);
}

// ── GENERATE ─────────────────────────────────────────────────
app.post('/api/generate', async (req, res) => {
  const { provider, apiKey, prompt } = req.body;
  try { res.json({ text: await callAI(provider, apiKey, prompt) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PARSE RESUME ─────────────────────────────────────────────
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
    } else { return res.status(400).json({ error: 'Please upload PDF, DOCX, or TXT.' }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── EXPORT DOCX ───────────────────────────────────────────────
app.post('/api/export-docx', async (req, res) => {
  const { resume } = req.body;
  if (!resume) return res.status(400).json({ error: 'No resume data.' });
  try {
    const { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle } = require('docx');
    const F = 'Calibri';
    const secTitle = (t) => new Paragraph({
      children: [new TextRun({ text: t.toUpperCase(), bold: true, size: 18, font: F, color: '111111', characterSpacing: 80 })],
      spacing: { before: 280, after: 80 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'cccccc', space: 6 } }
    });
    const bullet = (b) => new Paragraph({
      children: [new TextRun({ text: '–  ' + b, size: 20, font: F })],
      indent: { left: 260 }, spacing: { after: 50 }
    });
    const kids = [];
    kids.push(new Paragraph({ children: [new TextRun({ text: resume.header?.name||'', bold: true, size: 52, font: F })], alignment: AlignmentType.CENTER, spacing: { after: 40 } }));
    if (resume.header?.title) kids.push(new Paragraph({ children: [new TextRun({ text: resume.header.title, size: 24, font: F, italics: true, color: '555555' })], alignment: AlignmentType.CENTER, spacing: { after: 60 } }));
    if (resume.header?.contact) kids.push(new Paragraph({ children: [new TextRun({ text: resume.header.contact, size: 18, font: F, color: '666666' })], alignment: AlignmentType.CENTER, spacing: { after: 0 } }));
    kids.push(new Paragraph({ children: [new TextRun({ text: '' })], border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: '1a1a1a', space: 8 } }, spacing: { before: 160, after: 0 } }));
    if (resume.summary) { kids.push(secTitle('Professional Summary')); kids.push(new Paragraph({ children: [new TextRun({ text: resume.summary, size: 21, font: F, color: '333333' })], spacing: { after: 80 } })); }
    if (resume.experience?.length) {
      kids.push(secTitle('Work Experience'));
      resume.experience.forEach(e => {
        kids.push(new Paragraph({ children: [new TextRun({ text: e.title||'', bold: true, size: 22, font: F }), ...(e.duration?[new TextRun({ text: '   '+e.duration, size: 18, font: F, color: '777777' })]:[])], spacing: { before: 160, after: 20 } }));
        kids.push(new Paragraph({ children: [new TextRun({ text: e.company||'', italics: true, size: 20, font: F, color: '555555' }), ...(e.location?[new TextRun({ text: '  ·  '+e.location, size: 18, font: F, color: '999999' })]:[])], spacing: { after: 60 } }));
        (e.bullets||[]).forEach(b => kids.push(bullet(b)));
      });
    }
    if (resume.skills?.length) { kids.push(secTitle('Skills')); resume.skills.forEach(sg => kids.push(new Paragraph({ children: [new TextRun({ text: (sg.category||'')+': ', bold: true, size: 20, font: F }), new TextRun({ text: (sg.items||[]).join(', '), size: 20, font: F, color: '222222' })], spacing: { after: 50 } }))); }
    if (resume.projects?.length) {
      kids.push(secTitle('Projects'));
      resume.projects.forEach(p => {
        kids.push(new Paragraph({ children: [new TextRun({ text: p.name||'', bold: true, size: 22, font: F }), ...(p.stack?[new TextRun({ text: '  |  '+p.stack, size: 19, font: F, italics: true, color: '666666' })]:[])], spacing: { before: 140, after: 60 } }));
        (p.bullets||[]).forEach(b => kids.push(bullet(b)));
      });
    }
    if (resume.education?.length) {
      kids.push(secTitle('Education'));
      resume.education.forEach(e => {
        kids.push(new Paragraph({ children: [new TextRun({ text: e.degree||'', bold: true, size: 22, font: F }), ...(e.year?[new TextRun({ text: '   '+e.year, size: 18, font: F, color: '777777' })]:[])], spacing: { before: 140, after: 20 } }));
        if (e.institution) kids.push(new Paragraph({ children: [new TextRun({ text: e.institution, italics: true, size: 20, font: F, color: '555555' })], spacing: { after: 60 } }));
      });
    }
    const doc = new Document({ sections: [{ properties: { page: { margin: { top: 720, right: 1080, bottom: 720, left: 1080 } } }, children: kids }] });
    const buf = await Packer.toBuffer(doc);
    const fname = (resume.header?.name||'resume').replace(/\s+/g,'_').toLowerCase();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}_resume.docx"`);
    res.send(buf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`\n✦ ResumeForge → http://localhost:${PORT}\n`));
