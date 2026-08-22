const fs = require('fs');

const code = `      {showContextHelp && (
        <div 
          className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-3 sm:p-4 overscroll-contain"
          onClick={() => setShowContextHelp(false)}
        >
          <div 
            className="bg-white rounded-2xl w-full max-w-sm shadow-xl overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4 sm:p-5 flex flex-col gap-3">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <HelpCircle className="w-5 h-5 text-indigo-600" />
                Context Help
              </h2>
              <div className="text-sm text-slate-600 space-y-3 leading-relaxed">
                {showHealth ? (
                  <p>You are viewing <strong>Inbox Health</strong>. This dashboard provides analytics about your email habits, highlights top senders, and helps you identify where most of your clutter is coming from.</p>
                ) : folderFilters.includes('trash') ? (
                  <>
                    <p>You are viewing the <strong>Trash</strong> folder. Emails here will be automatically deleted by Gmail after 30 days.</p>
                    <ul className="list-disc pl-4 space-y-1">
                      <li>Use <strong>Empty Trash</strong> to instantly and permanently remove everything in this folder.</li>
                      <li>Select specific emails and use <strong>Delete Selected</strong> to permanently remove only those items.</li>
                    </ul>
                    <p className="text-amber-700 font-medium">Note: Deletions from the Trash are permanent and cannot be undone.</p>
                  </>
                ) : folderFilters.includes('archive') ? (
                  <p>You are viewing the <strong>Archive</strong>. These are emails you have removed from your main Inbox to keep it clean, but haven't deleted. They will remain here indefinitely unless you move them to Trash.</p>
                ) : (
                  <>
                    <p>You are viewing your <strong>Inbox</strong> or a custom filter. From here, you can organize your messages:</p>
                    <ul className="list-disc pl-4 space-y-1">
                      <li><strong>Archive:</strong> Removes the email from your Inbox but keeps it safe for future reference.</li>
                      <li><strong>Trash:</strong> Moves the email to the Trash folder where it will be permanently deleted after 30 days.</li>
                      <li><strong>Smart Organize:</strong> Use AI to automatically categorize and label your emails.</li>
                    </ul>
                  </>
                )}
              </div>
            </div>
            <div className="bg-slate-50 px-5 py-4 flex justify-end border-t border-slate-100">
              <button
                onClick={() => setShowContextHelp(false)}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors shadow-sm"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}`;
console.log("Template generated");
