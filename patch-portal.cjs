const fs = require('fs');
let content = fs.readFileSync('src/components/BulkOrganizeDropdown.tsx', 'utf8');

// Remove import { createPortal } from 'react-dom';
content = content.replace(/import \{ createPortal \} from 'react-dom';\\n/, '');

// Replace the JSX
content = content.replace(
`      {isOpen && (
        <>
          {/* Mobile Portal */}
          {typeof document !== 'undefined' && createPortal(
            <div className="sm:hidden relative z-[100]">
              <div className="fixed inset-0 bg-slate-900/40" onClick={(e) => { e.stopPropagation(); setIsOpen(false); }} />
              <div className="fixed inset-0 m-auto w-[calc(100vw-2rem)] max-w-[380px] h-fit max-h-[85vh] bg-white rounded-xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
                {renderContent()}
              </div>
            </div>,
            document.body
          )}

          {/* Desktop Dropdown */}
          <div className="hidden sm:flex absolute right-0 mt-2 w-96 bg-white rounded-xl shadow-2xl border border-slate-200 z-50 flex-col max-h-[85vh] overflow-hidden origin-top-right">
            {renderContent()}
          </div>
        </>
      )}`,
`      {isOpen && (
        <>
          {/* Mobile Overlay & Modal */}
          <div className="sm:hidden fixed inset-0 z-[100]">
            <div className="absolute inset-0 bg-slate-900/40" onClick={(e) => { e.stopPropagation(); setIsOpen(false); }} />
            <div className="absolute inset-0 m-auto w-[calc(100vw-2rem)] max-w-[380px] h-fit max-h-[85vh] bg-white rounded-xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
              {renderContent()}
            </div>
          </div>

          {/* Desktop Dropdown */}
          <div className="hidden sm:flex absolute right-0 mt-2 w-96 bg-white rounded-xl shadow-2xl border border-slate-200 z-50 flex-col max-h-[85vh] overflow-hidden origin-top-right">
            {renderContent()}
          </div>
        </>
      )}`
);

fs.writeFileSync('src/components/BulkOrganizeDropdown.tsx', content);
console.log("Patched portal successfully.");
