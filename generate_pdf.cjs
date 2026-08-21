const fs = require('fs');
const { jsPDF } = require('jspdf');

const doc = new jsPDF({
  orientation: 'portrait',
  unit: 'mm',
  format: 'a4'
});

const pageWidth = doc.internal.pageSize.getWidth();
const pageHeight = doc.internal.pageSize.getHeight();
const margin = 18;
const contentWidth = pageWidth - (margin * 2);
let yPos = margin;

function checkPageBreak(neededHeight) {
  if (yPos + neededHeight > pageHeight - margin) {
    doc.addPage();
    yPos = margin;
    // Header on subsequent pages
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    doc.text('MailFlow Architecture & Engineering Specification — Antigravity Reference', margin, 10);
    doc.line(margin, 12, pageWidth - margin, 12);
    yPos = 18;
  }
}

// Title Section
doc.setFillColor(30, 41, 59); // Slate-800
doc.rect(margin, yPos, contentWidth, 24, 'F');

doc.setFont('helvetica', 'bold');
doc.setFontSize(16);
doc.setTextColor(255, 255, 255);
doc.text('MailFlow: System Architecture & Specification', margin + 6, yPos + 10);

doc.setFont('helvetica', 'normal');
doc.setFontSize(9);
doc.setTextColor(203, 213, 225);
doc.text('Engineering Reference Document for Antigravity & AI Development', margin + 6, yPos + 18);

yPos += 30;

// Section Helper
function addSection(title) {
  checkPageBreak(16);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42); // Slate-900
  doc.text(title, margin, yPos);
  yPos += 2;
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.5);
  doc.line(margin, yPos, pageWidth - margin, yPos);
  yPos += 6;
}

// Paragraph Helper
function addParagraph(text, isBold = false) {
  doc.setFont('helvetica', isBold ? 'bold' : 'normal');
  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85); // Slate-700
  const lines = doc.splitTextToSize(text, contentWidth);
  checkPageBreak(lines.length * 4.5 + 2);
  doc.text(lines, margin, yPos);
  yPos += lines.length * 4.5 + 3;
}

// Bullet Helper
function addBullet(title, text) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(30, 41, 59);
  const titleStr = `•  ${title}: `;
  const fullText = `${titleStr}${text}`;
  const lines = doc.splitTextToSize(fullText, contentWidth - 4);
  checkPageBreak(lines.length * 4.5 + 2);
  doc.text(lines, margin + 2, yPos);
  yPos += lines.length * 4.5 + 2;
}

// Content Building
addSection('1. Executive Summary & Application Scope');
addParagraph('MailFlow is a modern, full-stack Gmail intelligence and bulk management platform designed to automate high-volume inbox decluttering, execute precision batch actions, and reveal behavioral patterns across recurring, automated, and unread communications.');

addSection('2. Technical Stack & Infrastructure');
addBullet('Frontend', 'React 19, TypeScript, Vite 6, Tailwind CSS v4, Motion (transitions), Lucide React.');
addBullet('Backend API Gateway', 'Node.js / Express 4.x compiled to standalone CommonJS (dist/server.cjs) via esbuild.');
addBullet('Authentication', 'Firebase Authentication + Google Identity Services / OAuth 2.0 (scope: https://mail.google.com/).');
addBullet('AI Engine', 'Multi-provider LLM gateway supporting Google Gemini (@google/genai), OpenAI, Anthropic, DeepSeek, Groq, Mistral, and Zhipu AI.');

addSection('3. Core Functional Modules');
addBullet('Natural Language Smart Search', 'Converts free-form input into strict Gmail search query operators (e.g. larger:5M, category:promotions, before:YYYY/MM/DD, is:unread).');
addBullet('Inbox Health & Pattern Clustering', 'Samples recent headers to identify automated behavioral bundles (e.g., Ignored Blasts, Financial Summaries, Receipts, Trial Expirations) with 1-click bulk purge.');
addBullet('High-Throughput Batch Processing', 'Processes operations in concurrent chunks (15-20 messages per batch) to avoid Google API throttling: Trash, Archive, Mark as Read, Permanent Delete.');
addBullet('Exact Telemetry & Real-Time Aggregation', 'Performs live whole-inbox sweeps (countEmails) for top senders and domains to eliminate sampling discrepancies.');

addSection('4. Server Endpoints & Data Contracts');
addBullet('POST /api/parse-query', 'Input: { query, settings } -> Output: { query: string, suggestedFolder?: string, explanation?: string }');
addBullet('POST /api/analyze-inbox', 'Input: { emails: Array<{id, sender, subject, labelIds}>, settings } -> Output: { clusters: Array<{title, description, suggestedAction, searchQuery, estimatedCount, patternDetected}> }');
addBullet('POST /api/models', 'Input: { provider, apiKey, baseUrl? } -> Output: { models: string[] } for dynamic model selection.');

addSection('5. Resilience, Error Handling & Quota Protection');
addParagraph('The platform features automated error interception for AI services:');
addBullet('HTTP 429 Quota Exceeded', 'Intercepted gracefully; disables AI for the current search, activates standard Gmail fallback, and prompts the user to enter their personal API key.');
addBullet('HTTP 503 Service Unavailable', 'Detects provider overload and recommends switching models or providers in Settings without crashing the client UI.');

addSection('6. Antigravity Developer Roadmap (Next Priorities)');
addBullet('Phase 1: Pagination & Deep Loading', 'Implement cursor-based pagination with nextPageToken when search yields >100 items, showing total matching count.');
addBullet('Phase 2: Interactive Distribution Modal', 'Provide an on-demand modal chart visualizing category splits (Primary, Promotions, Social, Updates) and read vs unread ratios.');
addBullet('Phase 3: Automated Rule Creation', 'Enable 1-click conversion of identified AI clusters into persistent Gmail filters (users.me.settings.filters).');
addBullet('Phase 4: Audit & Export Logs', 'Offer CSV/JSON export of message metadata prior to permanent batch deletion.');

// Footer on all pages
const totalPages = doc.internal.getNumberOfPages();
for (let i = 1; i <= totalPages; i++) {
  doc.setPage(i);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin - 15, pageHeight - 8);
  doc.text('MailFlow Confidential — Built with Google AI Studio & Antigravity', margin, pageHeight - 8);
}

// Save PDF
const pdfBuffer = Buffer.from(doc.output('arraybuffer'));
fs.writeFileSync('public/MailFlow_Antigravity_Specification.pdf', pdfBuffer);
fs.writeFileSync('MailFlow_Antigravity_Specification.pdf', pdfBuffer);

console.log('Successfully generated MailFlow_Antigravity_Specification.pdf');
