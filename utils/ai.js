// ============================================================
// InboxZero AI — AI Utility (Dev 2)
// Wrapper around the Gemini API.
// All prompts and API calls live here.
// ============================================================

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent';

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
async function callGemini(prompt) {
  const apiKey = await getApiKey();

  const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,      // low temp = consistent, predictable output
        maxOutputTokens: 300,  // keep responses short and fast
      }
    })
  });

  if (!response.ok) {
    const err = await response.json();
    const msg = err?.error?.message || `API error ${response.status}`;
    throw new Error(msg);
  }

  const data = await response.json();

  if (!data.candidates || data.candidates.length === 0) {
    throw new Error('No response from Gemini');
  }

  return data.candidates[0].content.parts[0].text.trim();
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