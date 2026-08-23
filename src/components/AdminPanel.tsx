import React, { useState, useEffect } from 'react';
import { db } from '../lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { Shield, Key, Trash2, X, Save } from 'lucide-react';

export function AdminPanel({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState({
    enablePermanentDelete: false,
    useGlobalAiKey: false,
    globalAiKey: '',
    globalProvider: 'gemini'
  });

  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const docRef = doc(db, 'appConfig', 'global');
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setSettings({ ...settings, ...docSnap.data() });
      } else {
        const local = localStorage.getItem('globalAdminSettings');
        if (local) setSettings(JSON.parse(local));
      }
    } catch (e) {
      console.warn('Firestore error, falling back to local storage', e);
      const local = localStorage.getItem('globalAdminSettings');
      if (local) setSettings(JSON.parse(local));
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const docRef = doc(db, 'appConfig', 'global');
      await setDoc(docRef, settings, { merge: true });
      localStorage.setItem('globalAdminSettings', JSON.stringify(settings));
    } catch (e) {
      console.warn('Firestore error, saving to local storage only', e);
      localStorage.setItem('globalAdminSettings', JSON.stringify(settings));
    } finally {
      setSaving(false);
      onClose();
      window.location.reload();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/50 z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-indigo-600" />
            <h2 className="font-bold text-slate-800">Admin Control Panel</h2>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center p-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>
          ) : (
            <div className="space-y-6">
              <div className="space-y-3">
                <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                  <Trash2 className="w-4 h-4 text-rose-500" />
                  Feature Flags
                </h3>
                <label className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-100">
                  <input 
                    type="checkbox" 
                    checked={settings.enablePermanentDelete}
                    onChange={(e) => setSettings({...settings, enablePermanentDelete: e.target.checked})}
                    className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-600"
                  />
                  <div className="flex flex-col">
                    <span className="font-medium text-sm text-slate-700">Enable Permanent Delete</span>
                    <span className="text-xs text-slate-500">Allows users to bypass 30-day trash and permanently delete emails.</span>
                  </div>
                </label>
              </div>

              <div className="space-y-3">
                <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                  <Key className="w-4 h-4 text-amber-500" />
                  Global AI Override
                </h3>
                
                <label className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-100">
                  <input 
                    type="checkbox" 
                    checked={settings.useGlobalAiKey}
                    onChange={(e) => setSettings({...settings, useGlobalAiKey: e.target.checked})}
                    className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-600"
                  />
                  <div className="flex flex-col">
                    <span className="font-medium text-sm text-slate-700">Use Global AI Key</span>
                    <span className="text-xs text-slate-500">Overrides individual user keys. You pay the API costs.</span>
                  </div>
                </label>

                {settings.useGlobalAiKey && (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Provider</label>
                      <select 
                        value={settings.globalProvider}
                        onChange={(e) => setSettings({...settings, globalProvider: e.target.value})}
                        className="w-full bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                      >
                        <option value="gemini">Google Gemini</option>
                        <option value="openai">OpenAI</option>
                        <option value="anthropic">Anthropic</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">API Key</label>
                      <input 
                        type="password"
                        value={settings.globalAiKey}
                        onChange={(e) => setSettings({...settings, globalAiKey: e.target.value})}
                        placeholder={"Enter key..."}
                        className="w-full bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-mono"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded-lg transition-colors">
            Cancel
          </button>
          <button 
            onClick={saveSettings} 
            disabled={saving || loading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div> : <Save className="w-4 h-4" />}
            Save & Apply
          </button>
        </div>
      </div>
    </div>
  );
}
