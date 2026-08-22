import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import Dashboard from './components/Dashboard';
import { InboxHealth } from './components/InboxHealth';
import LoginScreen from './components/LoginScreen';

// Mock localStorage
localStorage.setItem('adminAiSettings', JSON.stringify({
  provider: 'gemini',
  model: 'gemini-1.5-flash',
  apiKey: 'test-key'
}));

// Mock global fetch for API calls
window.fetch = async (url: RequestInfo | URL, _options?: RequestInit): Promise<Response> => {
  const urlStr = String(url);
  if (urlStr.includes('/api/models')) {
    return new Response(JSON.stringify({
      models: ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash', 'gpt-4o', 'claude-3-7-sonnet-latest']
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (urlStr.includes('/api/parse-query')) {
    return new Response(JSON.stringify({
      query: 'from:github.com subject:release',
      explanation: 'Find release notifications from GitHub',
      suggestedFolder: 'Developer Updates'
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (urlStr.includes('/api/analyze-inbox')) {
    return new Response(JSON.stringify({
      clusters: [
        {
          title: 'GitHub CI Notifications',
          description: 'Automated workflow run notifications and pull request review requests.',
          suggestedAction: 'Archive',
          searchQuery: 'from:notifications@github.com',
          estimatedCount: 84,
          patternDetected: 'High frequency automated notifications (daily average ~12)'
        },
        {
          title: 'Stripe Billing & Receipts',
          description: 'Payment receipts, invoice confirmations, and billing statements.',
          suggestedAction: 'Move to Finance',
          searchQuery: 'from:invoice+statements@stripe.com',
          estimatedCount: 23,
          patternDetected: 'Monthly recurring transactional invoices'
        },
        {
          title: 'Substack & Tech Newsletters',
          description: 'Weekly digest publications and long-form tech articles.',
          suggestedAction: 'Review',
          searchQuery: 'category:promotions from:substack.com',
          estimatedCount: 47,
          patternDetected: 'Weekend recurring promotional reading'
        },
        {
          title: 'Security & Auth Alerts',
          description: 'Two-factor login codes, device login confirmations, and password resets.',
          suggestedAction: 'Keep & Read',
          searchQuery: 'subject:("security alert" OR "verification code")',
          estimatedCount: 15,
          patternDetected: 'Time-sensitive authentication messages'
        }
      ]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  // Gmail API mock responses
  if (urlStr.includes('/messages?')) {
    return new Response(JSON.stringify({
      messages: Array.from({ length: 8 }, (_, i) => ({ id: 'msg_' + i, threadId: 'thread_' + i })),
      resultSizeEstimate: 8
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (urlStr.includes('/messages/')) {
    const id = urlStr.split('/messages/')[1].split('?')[0];
    const index = parseInt(id.replace('msg_', '') || '0', 10);
    const mockEmails = [
      { sender: 'Stripe Billing <invoices@stripe.com>', subject: 'Invoice #10943 paid successfully for MailFlow Pro', size: 145000, date: new Date('2026-08-20') },
      { sender: 'GitHub <notifications@github.com>', subject: '[MailFlow/core] Pull Request #42: Optimize mobile viewport rendering performance', size: 45000, date: new Date('2026-08-19') },
      { sender: 'Alex Rivera <alex.rivera.engineering.lead@longdomaincompanynameexample.enterprise.org>', subject: 'Q3 Architectural roadmap review and backend sync notes', size: 850000, date: new Date('2026-08-18') },
      { sender: 'Uber Receipts <receipts@uber.com>', subject: 'Your Wednesday evening trip with Uber from Downtown to West End', size: 220000, date: new Date('2026-08-17') },
      { sender: 'AWS Notifications <no-reply@sns.amazonaws.com>', subject: 'ALARM: "HighCPUUtilization-WorkerCluster" in US-East-1', size: 62000, date: new Date('2026-08-16') },
      { sender: 'Figma Team <digest@figma.com>', subject: 'Design comments in "MailFlow Mobile System v2" by Sarah and 3 others', size: 310000, date: new Date('2026-08-15') },
      { sender: 'Supercalifragilisticexpialidocious Ultra Long Sender Name Without Any Spaces <extremelylongemailaddresswithlotsandlotsofcharacters@subdomain.organization.example.co.uk>', subject: 'EXTREME_STRESS_TEST: This is a very long email subject line designed to challenge flexbox layouts and truncate behavior across tiny screens', size: 1250000, date: new Date('2026-08-14') },
      { sender: 'Taylor Swift <taylor@music.com>', subject: 'Concert tour update', size: 15000, date: new Date('2026-08-13') }
    ];
    const data = mockEmails[index % mockEmails.length];
    return new Response(JSON.stringify({
      id,
      threadId: 't_' + id,
      snippet: 'Here is the detailed preview snippet of this message showing how multiple lines of content appear on mobile devices...',
      labelIds: ['INBOX', 'IMPORTANT'],
      sizeEstimate: data.size,
      payload: {
        headers: [
          { name: 'From', value: data.sender },
          { name: 'Subject', value: data.subject },
          { name: 'Date', value: data.date.toUTCString() }
        ]
      }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (urlStr.includes('/labels')) {
    return new Response(JSON.stringify({
      labels: [
        { id: 'Label_1', name: 'Work', type: 'user' },
        { id: 'Label_2', name: 'Personal & Family', type: 'user' },
        { id: 'Label_3', name: 'Receipts & Finances', type: 'user' },
        { id: 'Label_4', name: 'Important Clients', type: 'user' }
      ]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const mockUser = {
  displayName: 'Alex Rivers',
  email: 'alex.rivers.developer@gmail.com',
  photoURL: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="%233b82f6"/><text x="20" y="25" font-size="16" text-anchor="middle" fill="white" font-family="sans-serif">AR</text></svg>'
};

function TestHarness() {
  const [view, setView] = useState<'login' | 'dashboard' | 'health'>('dashboard');

  return (
    <div id="test-root" className="min-h-screen bg-slate-50 flex flex-col">
      {/* Test controller toolbar */}
      <div id="test-nav" className="bg-slate-900 text-white text-xs p-2 flex flex-wrap gap-2 items-center sticky top-0 z-50 shadow-md">
        <span className="font-bold text-slate-300">Test View:</span>
        <button id="btn-view-login" onClick={() => setView('login')} className={`px-2.5 py-1 rounded cursor-pointer ${view === 'login' ? 'bg-indigo-600 font-bold' : 'bg-slate-700'}`}>LoginScreen</button>
        <button id="btn-view-dash" onClick={() => setView('dashboard')} className={`px-2.5 py-1 rounded cursor-pointer ${view === 'dashboard' ? 'bg-indigo-600 font-bold' : 'bg-slate-700'}`}>Dashboard</button>
        <button id="btn-view-health" onClick={() => setView('health')} className={`px-2.5 py-1 rounded cursor-pointer ${view === 'health' ? 'bg-indigo-600 font-bold' : 'bg-slate-700'}`}>InboxHealth</button>
      </div>

      <div id="test-view-container" className="flex-1">
        {view === 'login' && <LoginScreen onLogin={() => setView('dashboard')} />}
        {view === 'dashboard' && <Dashboard user={mockUser} />}
        {view === 'health' && (
          <div className="p-4 md:p-6 max-w-6xl mx-auto">
            <InboxHealth onApplyQuery={(q, f) => console.log('Query:', q, f)} />
          </div>
        )}
      </div>
    </div>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) {
  const root = createRoot(rootEl);
  root.render(<TestHarness />);
}
