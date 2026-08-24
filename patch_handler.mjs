import fs from 'fs';

let content = fs.readFileSync('src/components/HealthScoreModal.tsx', 'utf8');

const statusCode = `  const getScoreStatus = (s: number) => {`;

const handlerCode = `  const handleFix = async (type: 'unread' | 'spam' | 'promo', currentPts: number) => {
    setActiveAction(type);
    try {
      let ptsGained = Math.round(currentPts);
      let message = "";
      
      if (type === 'unread') {
        await markAllAsReadByQuery("is:unread in:inbox");
        message = "Unread emails cleared!";
      } else if (type === 'spam') {
        await emptyAllTrash();
        const spamIds = (await searchEmails("in:spam", 1000)).map(e => e.id);
        if (spamIds.length > 0) {
          await batchDeleteEmails(spamIds);
        }
        message = "Junk & trash emptied!";
      } else if (type === 'promo') {
        const promoIds = (await searchEmails("category:promotions older_than:6m -in:trash", 1000)).map(e => e.id);
        if (promoIds.length > 0) {
          await batchTrashEmails(promoIds);
        }
        message = "Old promotions cleaned!";
      }

      await fetchMetrics();
      
      setCelebration({ message, pts: ptsGained });
      setTimeout(() => {
        setCelebration(null);
      }, 3500);

    } catch (error) {
      console.error(error);
    } finally {
      setActiveAction(null);
    }
  };

  const getScoreStatus = (s: number) => {`;

content = content.replace(statusCode, handlerCode);

// We need to inject the relative class and celebration overlay inside the modal content
const relativeReplacement = `<div 
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden my-auto relative"`;

content = content.replace(
  `<div \n        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden my-auto"`,
  relativeReplacement
);

const celebrationOverlay = `        {/* Celebration Overlay */}
        {celebration && (
          <div className="absolute inset-0 z-50 bg-white/95 backdrop-blur-sm flex flex-col items-center justify-center animate-in fade-in zoom-in-95 duration-300">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-4">
              <Sparkles className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">{celebration.message}</h3>
            <p className="text-sm font-semibold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
              +{celebration.pts} Points Recovered
            </p>
          </div>
        )}

        {/* Modal Header */}`;

content = content.replace(`        {/* Modal Header */}`, celebrationOverlay);

fs.writeFileSync('src/components/HealthScoreModal.tsx', content);
console.log("Patched handler and overlay");
