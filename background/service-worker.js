// ============================================================
// InboxZero AI — Background Service Worker (Dev 2)
// This is the brain. All AI calls go through here.
// Content scripts CANNOT call external APIs, so we do it here.
// ============================================================

import { summarizeEmail, categorizeEmail, spamAnalyzeEmail, checkImportance, summarizeDigest } from '../utils/ai.js';
import { checkSpam } from '../utils/spam-checker.js';

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

// -------------------------------------------------------
// Gmail auth + helpers
// -------------------------------------------------------
function getAuthTokenInteractive() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || 'Unable to get auth token'));
        return;
      }
      resolve(token);
    });
  });
}

async function gmailRequest(path, options = {}) {
  const token = await getAuthTokenInteractive();
  const res = await fetch(`${GMAIL_BASE}${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail API ${res.status}: ${text}`);
  }
  return res.json();
}

async function applyCategoryLabel(category, messageId) {
  if (!messageId) return { applied: false, labelName: null };

  let labelId = null;
  let labelName = null;

  // Map semantic category to Gmail label
  switch (category) {
    case 'Promo':
      labelId = 'CATEGORY_PROMOTIONS';
      labelName = 'Promotions';
      break;
    case 'Spam':
      labelId = 'SPAM';
      labelName = 'Spam';
      break;
    case 'Urgent':
      labelId = 'IMPORTANT';
      labelName = 'Important';
      break;
    case 'Work':
      labelName = 'Work';
      break;
    case 'Personal':
      labelName = 'Personal';
      break;
    default:
      labelName = category || 'InboxZero';
  }

  // For system labels we already know the ID
  if (!labelId && labelName) {
    const labelsResp = await gmailRequest('/labels');
    const existing = (labelsResp.labels || []).find(l => l.name.toLowerCase() === labelName.toLowerCase());
    if (existing) {
      labelId = existing.id;
    } else {
      const created = await gmailRequest('/labels', {
        method: 'POST',
        body: {
          name: labelName,
          labelListVisibility: 'labelShow',
          messageListVisibility: 'show',
        }
      });
      labelId = created.id;
    }
  }

  if (!labelId) return { applied: false, labelName: null };

  const modifyBody = { addLabelIds: [labelId] };

  // If we mark as spam, also remove from inbox
  if (labelId === 'SPAM') {
    modifyBody.removeLabelIds = ['INBOX'];
  }

  await gmailRequest(`/messages/${messageId}/modify`, {
    method: 'POST',
    body: modifyBody,
  });

  return { applied: true, labelName };
}

async function trashMessage(messageId) {
  if (!messageId) throw new Error('Missing messageId');
  await gmailRequest(`/messages/${messageId}/trash`, { method: 'POST' });
  incrementStat('emailsTrashed');
}

async function fetchDashboardMetrics() {
  // Basic counts from Gmail profile + labels
  const profile = await gmailRequest('/profile');
  const labelsResp = await gmailRequest('/labels');

  const labelSummaries = {};
  for (const label of labelsResp.labels || []) {
    labelSummaries[label.name] = {
      id: label.id,
      messagesTotal: label.messagesTotal || 0,
      threadsTotal: label.threadsTotal || 0,
    };
  }

  // Last 7 days received/sent, spam, promotions
  async function countMessages(q) {
    const resp = await gmailRequest(`/messages?q=${encodeURIComponent(q)}&maxResults=200`);
    return (resp.messages || []).length;
  }

  const [receivedWeek, sentWeek, spamWeek, promoWeek] = await Promise.all([
    countMessages('newer_than:7d -in:drafts'),
    countMessages('in:sent newer_than:7d'),
    countMessages('label:spam newer_than:7d'),
    countMessages('category:promotions newer_than:7d'),
  ]);

  return {
    emailAddress: profile.emailAddress || '',
    messagesTotal: profile.messagesTotal || 0,
    threadsTotal: profile.threadsTotal || 0,
    labels: labelSummaries,
    weekly: {
      received: receivedWeek,
      sent: sentWeek,
      spam: spamWeek,
      promotions: promoWeek,
    },
  };
}

async function clearCachedAuthToken() {
  if (typeof chrome.identity.clearAllCachedAuthTokens === 'function') {
    await new Promise((resolve) => chrome.identity.clearAllCachedAuthTokens(() => resolve()));
    return true;
  }

  const token = await new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: false }, (t) => resolve(t || ''));
  });
  if (!token) return false;

  await new Promise((resolve) => chrome.identity.removeCachedAuthToken({ token }, () => resolve()));
  return true;
}

// -------------------------------------------------------
// Quick actions for popup (archive, summarize, filter, cleanup)
// -------------------------------------------------------
async function archiveNewsletters() {
  const query = 'category:promotions -in:trash';
  const resp = await gmailRequest(`/messages?q=${encodeURIComponent(query)}&maxResults=100`);
  const messages = resp.messages || [];
  if (!messages.length) {
    return { message: 'No newsletters found to archive.' };
  }

  let archived = 0;
  for (const m of messages) {
    try {
      await gmailRequest(`/messages/${m.id}/modify`, {
        method: 'POST',
        body: { removeLabelIds: ['INBOX'] },
      });
      archived++;
    } catch (e) {
      // skip failures, keep going
    }
  }

  return { message: `Archived ${archived} newsletter emails.` };
}

async function summarizeTodayEmails() {
  const query = 'newer_than:1d -in:trash -in:spam';
  const resp = await gmailRequest(`/messages?q=${encodeURIComponent(query)}&maxResults=40`);
  const messages = resp.messages || [];
  if (!messages.length) {
    return { message: 'No recent emails to summarize.', digest: 'No recent emails to summarize.' };
  }

  const meta = [];
  for (const m of messages) {
    try {
      const full = await gmailRequest(`/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`);
      const headers = full.payload?.headers || [];
      const subject = (headers.find(h => h.name === 'Subject') || {}).value || '';
      const from = (headers.find(h => h.name === 'From') || {}).value || '';
      meta.push({
        subject,
        from,
        snippet: full.snippet || '',
      });
    } catch (e) {
      // ignore individual failures
    }
  }

  if (!meta.length) {
    return { message: 'Could not read recent emails to summarize.', digest: 'Could not read recent emails to summarize.' };
  }

  const { digest } = await summarizeDigest(meta);
  return {
    message: `Summarized ${meta.length} emails from today.`,
    digest,
  };
}

async function showOnlyUrgent() {
  // Open Gmail search for important inbox mail
  const url = 'https://mail.google.com/mail/u/0/#search/in%3Ainbox+label%3Aimportant';
  chrome.tabs.create({ url });
  return { message: 'Opened Gmail filtered to urgent emails.' };
}

async function autoUnsubSuggest() {
  // Open Gmail search to highlight likely unsubscribe candidates
  const url = 'https://mail.google.com/mail/u/0/#search/category%3Apromotions+"unsubscribe"';
  chrome.tabs.create({ url });
  return { message: 'Opened Gmail with unsubscribe-heavy promotional emails.' };
}

async function autoDeleteOldIrrelevant() {
  // Target old mail that is likely low-importance and bucket it into labels.
  const query = 'category:promotions older_than:45d -is:starred -label:important -in:trash';
  const resp = await gmailRequest(`/messages?q=${encodeURIComponent(query)}&maxResults=50`);
  const messages = resp.messages || [];
  if (!messages.length) {
    return { message: 'No old promotional emails found to auto-delete.' };
  }

  let checked = 0;
  let toDeleteCount = 0;
  let superviseCount = 0;
  let importantCount = 0;

  // Helpers to get or create user labels
  async function getOrCreateUserLabel(name) {
    const labelsResp = await gmailRequest('/labels');
    const existing = (labelsResp.labels || []).find(l => l.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing.id;
    const created = await gmailRequest('/labels', {
      method: 'POST',
      body: {
        name,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
      }
    });
    return created.id;
  }

  const toDeleteLabelId = await getOrCreateUserLabel('to-delete');
  const needSupervisionLabelId = await getOrCreateUserLabel('need supervision');
  const importantLabelId = await getOrCreateUserLabel('important');

  for (const m of messages) {
    try {
      const full = await gmailRequest(`/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`);
      const headers = full.payload?.headers || [];
      const subject = (headers.find(h => h.name === 'Subject') || {}).value || '';
      const from = (headers.find(h => h.name === 'From') || {}).value || '';
      const snippet = full.snippet || '';

      checked++;

      // Use LLM importance + category to decide label
      const [importance, categoryResult] = await Promise.all([
        checkImportance(snippet, from, subject),
        categorizeEmail(`${subject}\n\n${snippet}`, from)
      ]);

      const isImportant = importance.isImportant;
      const category = categoryResult.category;

      const addLabelIds = [];
      const removeLabelIds = [];

      if (isImportant) {
        addLabelIds.push(importantLabelId);
        importantCount++;
      } else if (category === 'Promo') {
        addLabelIds.push(toDeleteLabelId);
        // Move out of inbox into the to-delete bucket
        removeLabelIds.push('INBOX');
        toDeleteCount++;
      } else {
        addLabelIds.push(needSupervisionLabelId);
        superviseCount++;
      }

      if (addLabelIds.length || removeLabelIds.length) {
        await gmailRequest(`/messages/${m.id}/modify`, {
          method: 'POST',
          body: {
            addLabelIds: addLabelIds.length ? addLabelIds : undefined,
            removeLabelIds: removeLabelIds.length ? removeLabelIds : undefined,
          }
        });
      }
    } catch (e) {
      // ignore individual failures
    }
  }

  if (!checked) {
    return { message: 'No messages could be inspected for auto-delete.' };
  }

  return {
    message: `Classified ${checked} old emails → ${toDeleteCount} to-delete, ${superviseCount} need supervision, ${importantCount} important.`
  };
}

async function runQuickAction(action) {
  switch (action) {
    case 'ARCHIVE_NEWSLETTERS':
      return archiveNewsletters();
    case 'SUMMARIZE_TODAY':
      return summarizeTodayEmails();
    case 'SHOW_ONLY_URGENT':
      return showOnlyUrgent();
    case 'AUTO_UNSUB_SUGGEST':
      return autoUnsubSuggest();
    case 'AUTO_DELETE_OLD_IRRELEVANT':
      return autoDeleteOldIrrelevant();
    default:
      throw new Error('Unknown quick action: ' + action);
  }
}

// -------------------------------------------------------
// Message Router — listens to messages from content.js and popup
// -------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[InboxZero] Message received:', message.type);

  switch (message.type) {

    case 'SUMMARIZE':
      summarizeEmail(message.text)
        .then(result => sendResponse({ success: true, ...result }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true; // IMPORTANT: keeps message channel open for async response

    case 'CATEGORIZE':
      (async () => {
        try {
          const result = await categorizeEmail(message.text, message.sender);
          let labelApplied = false;
          if (message.messageId) {
            try {
              const labelResult = await applyCategoryLabel(result.category, message.messageId);
              labelApplied = Boolean(labelResult.applied);
            } catch (e) {
              console.warn('[InboxZero] Failed to apply Gmail label:', e);
            }
          }
          sendResponse({ success: true, category: result.category, labelApplied });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;

    case 'SPAM_CHECK':
      (async () => {
        try {
          const heuristic = await checkSpam(message.sender, message.subject, message.text);
          const ai = await spamAnalyzeEmail({
            senderEmail: message.sender,
            subject: message.subject,
            bodyText: message.text,
          });

          const combinedScore = Math.round(
            Math.max(heuristic.score || 0, ai.score || 0, ((heuristic.score || 0) + (ai.score || 0)) / 2)
          );

          const result = {
            score: combinedScore,
            level: ai.level || heuristic.level,
            flags: Array.from(new Set([...(heuristic.flags || []), ...(ai.flags || [])])),
            reasoning: ai.reasoning || 'Spam verdict from rules + AI.',
          };

          if (combinedScore >= 60) incrementStat('spamDetected');
          sendResponse({ success: true, ...result });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;

    case 'FULL_ANALYZE':
      // Runs all 3 checks at once — used when email is first opened
      (async () => {
        try {
          const [summary, category, heuristic] = await Promise.all([
            summarizeEmail(message.text),
            categorizeEmail(message.text, message.sender),
            checkSpam(message.sender, message.subject, message.text)
          ]);

          const ai = await spamAnalyzeEmail({
            senderEmail: message.sender,
            subject: message.subject,
            bodyText: message.text,
          });

          const combinedScore = Math.round(
            Math.max(heuristic.score || 0, ai.score || 0, ((heuristic.score || 0) + (ai.score || 0)) / 2)
          );

          const spam = {
            score: combinedScore,
            level: ai.level || heuristic.level,
            flags: Array.from(new Set([...(heuristic.flags || []), ...(ai.flags || [])])),
            reasoning: ai.reasoning || 'Spam verdict from rules + AI.',
          };

          sendResponse({ success: true, summary, category, spam });

          incrementStat('emailsAnalyzed');
          if (combinedScore >= 60) incrementStat('spamDetected');
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    
    case 'GET_TEMPLATES':
        chrome.storage.sync.get(['templates'], (data) => {
            sendResponse({ templates: data.templates || [] });
        });
        return true;

    case 'GET_SETTINGS':
      chrome.storage.sync.get(['autoSummarize', 'autoCategorize', 'spamAlerts', 'spamThreshold', 'autoImportant'], (data) => {
        sendResponse({
          autoSummarize: data.autoSummarize ?? true,
          autoCategorize: data.autoCategorize ?? true,
          spamAlerts: data.spamAlerts ?? true,
          spamThreshold: data.spamThreshold ?? 60,
          autoImportant: data.autoImportant ?? false,
        });
      });
      return true;

    case 'TRASH_MESSAGE':
      trashMessage(message.messageId)
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'CHECK_IMPORTANCE':
      checkImportance(message.text, message.sender, message.subject)
        .then(async (result) => {
          if (result.isImportant && message.messageId) {
            try {
              await applyCategoryLabel('Urgent', message.messageId);
              incrementStat('importantLabeled');
            } catch (e) {
              console.warn('[InboxZero] Failed to apply important label:', e);
            }
          }
          sendResponse({ success: true, ...result });
        })
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'GET_DASHBOARD_METRICS':
      fetchDashboardMetrics()
        .then((metrics) => {
          chrome.storage.local.get(['emailsAnalyzed', 'spamDetected', 'emailsTrashed', 'importantLabeled'], (local) => {
            sendResponse({
              success: true,
              gmail: metrics,
              localStats: {
                emailsAnalyzed: local.emailsAnalyzed || 0,
                spamDetected: local.spamDetected || 0,
                emailsTrashed: local.emailsTrashed || 0,
                importantLabeled: local.importantLabeled || 0,
              }
            });
          });
        })
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'CLEAR_GMAIL_TOKEN':
      clearCachedAuthToken()
        .then((cleared) => sendResponse({ success: true, cleared }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'CONNECT_GMAIL_ACCOUNT':
      fetchDashboardMetrics()
        .then((metrics) => sendResponse({ success: true, gmail: metrics }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'RUN_ACTION':
      runQuickAction(message.action)
        .then(result => sendResponse({ success: true, ...result }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    default:
      sendResponse({ success: false, error: 'Unknown message type: ' + message.type });
  }
});

// -------------------------------------------------------
// Stats Helper — increments counters for popup dashboard
// -------------------------------------------------------
function incrementStat(key) {
  chrome.storage.local.get([key, 'lastReset'], (data) => {
    const now = Date.now();
    const lastReset = data.lastReset || 0;
    const dayMs = 24 * 60 * 60 * 1000;

    // Reset counts daily
    if (now - lastReset > dayMs) {
      chrome.storage.local.set({
        emailsAnalyzed: 0,
        spamDetected: 0,
        emailsTrashed: 0,
        importantLabeled: 0,
        lastReset: now
      });
      return;
    }

    const current = data[key] || 0;
    chrome.storage.local.set({ [key]: current + 1 });
  });
}

// -------------------------------------------------------
// Extension Install — set defaults
// -------------------------------------------------------
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[InboxZero] Extension installed/updated. Setting defaults...');
  // Always force-write defaults on install OR update so stale keys get fixed
  chrome.storage.sync.set({
    autoSummarize: true,
    autoCategorize: true,
    spamAlerts: true,
    autoImportant: false,
    spamThreshold: 60,
    templates: [
      {
        id: '1',
        name: 'Quick Acknowledgement',
        body: 'Hi,\n\nThank you for reaching out. I have received your email and will get back to you shortly.\n\nBest regards'
      },
      {
        id: '2',
        name: 'Meeting Request',
        body: 'Hi,\n\nI would love to connect. Are you available for a quick call this week? Please let me know your preferred time.\n\nBest regards'
      }
    ]
  });
  chrome.storage.local.set({
    emailsAnalyzed: 0,
    spamDetected: 0,
    emailsTrashed: 0,
    importantLabeled: 0,
    lastReset: Date.now()
  });

  if (details.reason === 'install') {
    chrome.tabs.create({
      url: chrome.runtime.getURL('onboarding/index.html')
    });
  }

  if (details.reason === 'update') {
    chrome.storage.local.get(['onboardingComplete'], (local) => {
      if (local.onboardingComplete === true) return;
      chrome.tabs.create({
        url: chrome.runtime.getURL('onboarding/index.html')
      });
    });
  }
});
// Re-apply defaults on every browser startup in case storage is missing keys
// (onInstalled only fires once so existing installs may have stale/missing keys)
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.sync.get(['autoSummarize', 'autoCategorize', 'spamAlerts', 'autoImportant'], (data) => {
    const updates = {};
    if (typeof data.autoSummarize !== 'boolean') updates.autoSummarize = true;
    if (typeof data.autoCategorize !== 'boolean') updates.autoCategorize = true;
    if (typeof data.spamAlerts !== 'boolean') updates.spamAlerts = true;
    if (typeof data.autoImportant !== 'boolean') updates.autoImportant = false;
    if (Object.keys(updates).length > 0) {
      chrome.storage.sync.set(updates);
    }
  });
});