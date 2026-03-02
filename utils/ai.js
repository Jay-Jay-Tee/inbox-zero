// ============================================================
// InboxZero AI — AI Utility (Dev 2)
// Wrapper around the Gemini API.
// All prompts and API calls live here.
// ============================================================

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent';

// -------------------------------------------------------
// Get API Key from Chrome Storage (saved by Dev 3's popup)
// -------------------------------------------------------
async function getApiKey() {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(['apiKey'], (data) => {
      if (chrome.runtime.lastError) {
        reject(new Error('Storage error: ' + chrome.runtime.lastError.message));
        return;
      }
      if (!data.apiKey || data.apiKey.trim() === '') {
        reject(new Error('NO_API_KEY'));
        return;
      }
      resolve(data.apiKey.trim());
    });
  });
}

// -------------------------------------------------------
// Core Gemini call — used by all features
// -------------------------------------------------------
async function callGemini(prompt, overrides = {}) {
  const apiKey = await getApiKey();

  const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 300,
        ...overrides,
      }
    })
  });

  if (!response.ok) {
    let msg = `API error ${response.status}`;
    try {
      const err = await response.json();
      msg = err?.error?.message || msg;
    } catch {
      // ignore parse failure
    }
    throw new Error(msg);
  }

  const data = await response.json();

  if (!data.candidates || data.candidates.length === 0) {
    throw new Error('No response from Gemini');
  }

  const part = data.candidates[0]?.content?.parts?.[0];
  const text = typeof part?.text === 'string' ? part.text.trim() : '';
  if (!text) throw new Error('Empty response from Gemini');
  return text;
}


// -------------------------------------------------------
// SUMMARIZER
// Returns: { bullets: ["...", "...", "..."] }
// -------------------------------------------------------
export async function summarizeEmail(emailText) {
  if (!emailText || emailText.trim().length < 20) {
    return { bullets: ['Email is too short to summarize.'] };
  }

  // Truncate very long emails to keep API fast
  const truncated = emailText.slice(0, 3000);

  const prompt = `You are an email summarizer. Summarize the following email in EXACTLY 3 bullet points.
Each bullet point must be under 12 words.
Start each bullet with "• ".
Do not add any other text, intro, or explanation — ONLY the 3 bullet points.

Email:
${truncated}`;

  const raw = await callGemini(prompt);

  // Parse bullet points from response
  const lines = raw
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('•') || l.startsWith('-') || l.startsWith('*'))
    .map(l => l.replace(/^[•\-*]\s*/, '').trim())
    .filter(l => l.length > 0)
    .slice(0, 3);

  // Fallback: if parsing failed, split by newline
  if (lines.length === 0) {
    const fallback = raw.split('\n').filter(l => l.trim().length > 0).slice(0, 3);
    return { bullets: fallback.length > 0 ? fallback : ['Could not parse summary. Please try again.'] };
  }

  return { bullets: lines };
}

// -------------------------------------------------------
// CATEGORIZER
// Returns: { category: "Work" | "Personal" | "Promo" | "Urgent" | "Spam" }
// -------------------------------------------------------
export async function categorizeEmail(emailText, senderEmail = '') {
  if (!emailText || emailText.trim().length < 5) {
    return { category: 'Personal' };
  }

  const truncated = emailText.slice(0, 1500);

  const prompt = `Categorize this email into EXACTLY one of these categories: Work, Personal, Promo, Urgent, Spam.

Rules:
- Work: professional communication, projects, meetings, clients, invoices, colleagues
- Personal: friends, family, social messages
- Promo: newsletters, marketing, deals, offers, unsubscribe links
- Urgent: requires immediate action, deadlines, alerts, warnings
- Spam: suspicious, phishing, fake prizes, unsolicited bulk email

Sender: ${senderEmail}
Email: ${truncated}

Reply with ONLY ONE WORD — the category name. Nothing else.`;

  const raw = await callGemini(prompt);

  // Extract just the category word
  const validCategories = ['Work', 'Personal', 'Promo', 'Urgent', 'Spam'];
  const found = validCategories.find(c => raw.toLowerCase().includes(c.toLowerCase()));

  return { category: found || 'Personal' };
}

// -------------------------------------------------------
// LLM SPAM ANALYZER
// Returns: { score: 0-100, level, flags[], reasoning }
// -------------------------------------------------------
export async function spamAnalyzeEmail({ subject = '', senderEmail = '', bodyText = '' }) {
  const trimmed = (subject + '\n' + bodyText).trim();
  if (!trimmed) {
    return {
      score: 0,
      level: 'safe',
      flags: [],
      reasoning: 'No content to analyze.',
    };
  }

  const truncated = bodyText.slice(0, 2500);

  const prompt = `You are an email security assistant.
Evaluate the following email for spam / phishing risk.

Return a STRICT JSON object with this exact shape and nothing else:
{
  "score": number between 0 and 100,
  "level": "safe" | "suspicious" | "danger",
  "flags": ["short reason", "another reason"],
  "reasoning": "1-2 sentence human explanation"
}

Sender: ${senderEmail || 'unknown'}
Subject: ${subject || 'No subject'}
Body:
${truncated}`;

  const raw = await callGemini(prompt, { maxOutputTokens: 200 });

  let parsed;
  try {
    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}');
    const candidate = jsonStart >= 0 && jsonEnd > jsonStart ? raw.slice(jsonStart, jsonEnd + 1) : raw;
    parsed = JSON.parse(candidate);
  } catch {
    return {
      score: 0,
      level: 'safe',
      flags: [],
      reasoning: 'Could not parse AI spam verdict.',
    };
  }

  const score = Math.max(0, Math.min(100, Number(parsed.score) || 0));
  const level = ['safe', 'suspicious', 'danger'].includes(parsed.level) ? parsed.level : 'safe';
  const flags = Array.isArray(parsed.flags) ? parsed.flags.map(String).slice(0, 6) : [];
  const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : '';

  return { score, level, flags, reasoning };
}

// -------------------------------------------------------
// IMPORTANCE CHECKER
// Returns: { isImportant: bool, reason: string }
// -------------------------------------------------------
export async function checkImportance(emailText, senderEmail = '', subject = '') {
  const trimmed = (subject + '\n' + emailText).trim();
  if (!trimmed) {
    return { isImportant: false, reason: '' };
  }

  const truncated = emailText.slice(0, 2500);

  const prompt = `Decide if this email is important and requires attention from the user.
Be strict. Mark as important only if at least one of these applies:
- contains deadlines, meetings, schedules or calendar-related info
- contains tasks, approvals, decisions or asks the user to do something
- is from a manager, direct report, key client, or critical service (bank, payments, security, infra)

Reply with STRICT JSON only, no prose:
{
  "isImportant": true or false,
  "reason": "one short human sentence"
}

Sender: ${senderEmail || 'unknown'}
Subject: ${subject || 'No subject'}
Body:
${truncated}`;

  const raw = await callGemini(prompt, { maxOutputTokens: 160 });

  try {
    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}');
    const candidate = jsonStart >= 0 && jsonEnd > jsonStart ? raw.slice(jsonStart, jsonEnd + 1) : raw;
    const parsed = JSON.parse(candidate);
    return {
      isImportant: Boolean(parsed.isImportant),
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    };
  } catch {
    return { isImportant: false, reason: '' };
  }
}

// -------------------------------------------------------
// DAILY DIGEST SUMMARY (for dashboard "here's what you missed")
// Input: array of { subject, from, snippet }
// Returns: { digest: string }
// -------------------------------------------------------
export async function summarizeDigest(emailsMeta) {
  if (!Array.isArray(emailsMeta) || emailsMeta.length === 0) {
    return { digest: 'No recent emails to summarize.' };
  }

  const lines = emailsMeta.slice(0, 30).map((m, idx) => {
    return `${idx + 1}. From: ${m.from || 'unknown'} | Subject: ${m.subject || 'No subject'} | Snippet: ${m.snippet || ''}`;
  });

  const prompt = `You are a productivity assistant.
Create a tight digest titled "Here's what you missed today" based on this list of recent emails.

Output MUST follow this exact structure in plain text:
LINE 1: 3-line digest (overall summary, <= 40 words total)
LINE 2: "Key decisions:" then 2-3 short bullet-like phrases separated by " | "
LINE 3: "Meetings:" then 0-3 short phrases (or "None")
LINE 4: "Deadlines:" then 0-3 short phrases (or "None")
Nothing else before or after these 4 lines.

Emails:
${lines.join('\n')}`;

  const raw = await callGemini(prompt, { maxOutputTokens: 220 });
  const digest = raw.split('\n').slice(0, 6).join('\n').trim();
  return { digest: digest || 'Could not generate digest.' };
}
