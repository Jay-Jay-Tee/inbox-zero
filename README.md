# 📬 InboxZero AI  

### AI-Powered Gmail Intelligence Extension  
Summarization • Categorization • Spam Scoring

InboxZero AI is a Chrome Extension that enhances Gmail with real-time AI-powered summarization, strict email categorization, and a hybrid spam detection engine.

It transforms cluttered inboxes into structured, readable, and safer communication streams — directly inside Gmail.

---

## ✨ Features

### 🧠 AI Email Summarization
- Generates **exactly 3 concise bullet points**
- Each bullet under 12 words
- Deterministic output (low temperature)
- Long emails auto-truncated for performance
- Powered by Gemini 2.5 Flash Lite

---

### 🏷 Strict AI Categorization

Each email is classified into exactly one category:

- Work  
- Personal  
- Promo  
- Urgent  
- Spam  

The model is constrained to output one label only — eliminating ambiguity.

---

### 🛡 Hybrid Spam Detection Engine (AI + Deterministic)

InboxZero AI assigns a **0–100 spam score** using layered heuristics:

- Bulk sender domain detection  
- High-risk scam phrases  
- Suspicious URL patterns  
- Promotional keyword density  
- ALL CAPS subject lines  
- Excessive exclamation marks  
- Short-message phishing behavior  
- Embedded shortened links  

Final classification:
- `safe`
- `suspicious`
- `danger`

---

### ⚙ Adjustable Spam Sensitivity

Users can configure spam threshold in the popup.

Default threshold: `60`

This allows precise tuning between aggressive filtering and permissive sorting.

---

### 🔐 Secure API Key Handling

- API key stored via `chrome.storage.sync`
- No hardcoded credentials
- No password storage
- No backend server
- Fully client-side execution

---

### 🧩 Native Gmail UI Injection

The extension:
- Injects summary panels directly into Gmail
- Displays category labels inline
- Shows spam score indicators
- Preserves Gmail’s native UI experience

No external dashboard required.

---

## 🏗 Architecture

Frontend:
- Chrome Extension (Manifest V3)
- Gmail DOM Injection

AI Layer:
- Gemini 2.5 Flash Lite
- Deterministic prompt design
- Strict response enforcement

Spam Engine:
- Weighted scoring algorithm
- Heuristic pattern detection
- User-controlled sensitivity

Security:
- OAuth-based Gmail access
- No server-side storage
- No email persistence

---
---

## 📦 Requirements

Before installing, make sure you have:

- Google Chrome (latest version recommended) or any other chromium browser
- Internet connection (required by the extension for summarization and categorization)

---

## 🚀 Installation

### 1️⃣ Download the Extension

1. Go to the **Releases** page of https://github.com/Jay-Jay-Tee/gmail-chrome-extension.git.
2. Download the latest `.zip` file from the **Assets** section.
3. Extract the ZIP file to a folder on your computer.

---

### 2️⃣ Load the Extension in Chrome (Load Unpacked Method)

1. Open **Google Chrome** (or any other browser).
2. Open sidebar and click on extensions.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked**.
5. Select the extracted project folder (not the ZIP file).
6. Follow the setup steps as per necessary.
7. The extension will now be installed and visible in your extensions list.

---

## 🔄 Updating

To update the extension:

1. Download the latest version from the **Releases** page.
2. Extract the new ZIP file.
3. Open `chrome://extensions/`.
4. Click **Remove** on the old version.
5. Click **Load unpacked** and select the new folder.

---

## 🛠 Usage

1. Click the extension icon in the Chrome toolbar.
2. Configure settings if available.
3. Start using the extension.

---

## 🐞 Troubleshooting

- Ensure **Developer mode** is enabled.
- Make sure you selected the extracted folder, not the ZIP file.
- If errors appear, check the error message shown in `chrome://extensions/`.

---

## Reference screenshots

### Popup
<img src="images/popup.png" width="30%" >

### Promotional message identification
<img src="images/promo1.png" width="70%">

### Possible spam messages, still with summary
<img src="images/promo2.png" width="70%">

### Template applying
<img src="images/template_large.png" width="70%">
<img src="images/template_small.png" width="70%">



## 📜 License
MIT License
