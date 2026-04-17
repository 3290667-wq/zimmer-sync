/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { Download, Trash2, Edit2, Check, X, Search, Calendar as CalendarIcon, Bed, DoorOpen, Phone, MapPin, ClipboardList, Info, LogOut, User, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ZimmerAvailability, CustomerRequest } from './types.ts';
import { parseWhatsAppText } from './lib/gemini.ts';
import { auth, db, loginWithGoogle, handleFirestoreError, OperationType } from './firebase.ts';
import { onAuthStateChanged, User as FirebaseUser, signOut } from 'firebase/auth';
import { collection, onSnapshot, addDoc, deleteDoc, updateDoc, doc, query, orderBy, serverTimestamp } from 'firebase/firestore';
import { DayPicker } from 'react-day-picker';
import { format, parseISO, isValid } from 'date-fns';
import { he } from 'date-fns/locale';
import 'react-day-picker/dist/style.css';

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [zimmers, setZimmers] = useState<ZimmerAvailability[]>([]);
  const [requests, setRequests] = useState<CustomerRequest[]>([]);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeTab, setActiveTab ] = useState<'available' | 'requests'>('available');

  // Firebase Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
    });
    
    // Test Firestore connection
    const testConnection = async () => {
      try {
        const { getDocFromServer } = await import('firebase/firestore');
        await getDocFromServer(doc(db, '_connection_test_', 'check'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('offline')) {
          console.error("Firestore connection issue: client is offline or config invalid.");
        }
      }
    };
    testConnection();

    return () => unsubscribe();
  }, []);

  // Sync Zimmers from Firestore
  useEffect(() => {
    if (!user) {
      setZimmers([]);
      return;
    }
    const q = query(collection(db, 'zimmers'), orderBy('updatedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ZimmerAvailability));
      setZimmers(data);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'zimmers'));
    return () => unsubscribe();
  }, [user]);

  // Sync Requests from Firestore
  useEffect(() => {
    if (!user) {
      setRequests([]);
      return;
    }
    const q = query(collection(db, 'requests'), orderBy('updatedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CustomerRequest));
      setRequests(data);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'requests'));
    return () => unsubscribe();
  }, [user]);

  const handleImport = async () => {
    if (!importText.trim() || !user) return;
    setIsImporting(true);
    try {
      const parsed = await parseWhatsAppText(importText);
      
      const batchPromises = [
        ...parsed.zimmers.map(z => addDoc(collection(db, 'zimmers'), {
          ...z,
          ownerUid: user.uid,
          updatedAt: serverTimestamp(),
          disabledDates: []
        })),
        ...parsed.requests.map(r => addDoc(collection(db, 'requests'), {
          ...r,
          createdBy: user.uid,
          updatedAt: serverTimestamp()
        }))
      ];

      await Promise.all(batchPromises);
      setIsImportModalOpen(false);
      setImportText('');
    } catch (error) {
      console.error(error);
      alert('תקלה בייבוא הנתונים. וודא שאתה מחובר ונסה שוב.');
    } finally {
      setIsImporting(false);
    }
  };

  const deleteZimmer = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'zimmers', id));
    } catch (e) { handleFirestoreError(e, OperationType.DELETE, `zimmers/${id}`); }
  };

  const deleteRequest = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'requests', id));
    } catch (e) { handleFirestoreError(e, OperationType.DELETE, `requests/${id}`); }
  };

  const updateZimmer = async (id: string, updates: Partial<ZimmerAvailability>) => {
    try {
      // Remove id and ownerUid from updates to be safe
      const { id: _, ownerUid, ...cleanUpdates } = updates as any;
      await updateDoc(doc(db, 'zimmers', id), {
        ...cleanUpdates,
        updatedAt: serverTimestamp()
      });
    } catch (e) { handleFirestoreError(e, OperationType.UPDATE, `zimmers/${id}`); }
  };

  const updateRequest = async (id: string, updates: Partial<CustomerRequest>) => {
    try {
      const { id: _, createdBy, ...cleanUpdates } = updates as any;
      await updateDoc(doc(db, 'requests', id), {
        ...cleanUpdates,
        updatedAt: serverTimestamp()
      });
    } catch (e) { handleFirestoreError(e, OperationType.UPDATE, `requests/${id}`); }
  };

  const filteredZimmers = zimmers.filter(z => 
    z.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    z.location.toLowerCase().includes(searchQuery.toLowerCase()) ||
    z.dates.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredRequests = requests.filter(r => 
    r.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (r.locationPref?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
    r.dates.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-face-bg flex items-center justify-center">
        <Loader2 className="animate-spin text-whatsapp-primary" size={48} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-face-bg flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center space-y-6 border border-face-border">
          <div className="bg-whatsapp-primary w-16 h-16 rounded-full flex items-center justify-center mx-auto text-white">
            <CalendarIcon size={32} />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-extrabold text-whatsapp-dark tracking-tighter">ברוכים הבאים ל-ZimmerSync</h1>
            <p className="text-face-muted text-sm leading-relaxed">
              מערכת ניהול מאגר הצימרים והביקושים שלכם.
              התחברו כדי לצפות בצימרים פנויים, לעדכן יומן זמינות ולנהל לקוחות.
            </p>
          </div>
          <button 
            onClick={loginWithGoogle}
            className="w-full flex items-center justify-center gap-3 bg-white border border-face-border hover:bg-neutral-50 px-6 py-3 rounded-lg font-bold transition-all shadow-sm"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" referrerPolicy="no-referrer" />
            <span>התחברות באמצעות Google</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-face-bg text-face-text font-sans flex flex-col">
      {/* Header */}
      <header className="h-16 bg-white border-b border-face-border sticky top-0 z-20 flex items-center justify-between px-6 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="bg-whatsapp-primary p-1.5 rounded-full text-white">
            <CalendarIcon size={20} />
          </div>
          <h1 className="text-lg md:text-xl font-extrabold text-whatsapp-dark tracking-tighter truncate">
            <span className="hidden sm:inline">ZimmerSync | </span>
            ניהול מאגר פנויים
          </h1>
        </div>
        
        <div className="flex items-center gap-3 md:gap-6">
          <button 
            onClick={() => setIsImportModalOpen(true)}
            className="flex items-center gap-2 bg-whatsapp-primary hover:bg-whatsapp-dark text-white px-3 md:px-4 py-2 rounded-lg font-bold transition-all shadow-sm text-sm"
          >
            <Download size={16} />
            <span className="hidden xs:inline">ייבוא WhatsApp</span>
          </button>
          
          <div className="flex items-center gap-3 border-r border-face-border pr-3 md:pr-6">
            <div className="hidden sm:block text-left">
              <div className="text-xs font-bold text-face-text leading-none mb-0.5">{user.displayName}</div>
              <div className="text-[10px] text-face-muted leading-none">מחובר</div>
            </div>
            {user.photoURL ? (
              <img src={user.photoURL} alt="Profile" className="w-8 h-8 rounded-full border border-face-border" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-neutral-200 flex items-center justify-center"><User size={16} /></div>
            )}
            <button onClick={() => signOut(auth)} className="text-face-muted hover:text-red-500 transition-colors" title="התנתק">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <div className="flex-1 lg:overflow-hidden grid grid-cols-1 lg:grid-cols-[300px_1fr]">
        
        {/* Sidebar: Filters & Stats */}
        <aside className="bg-white border-b lg:border-l border-face-border flex flex-col lg:h-full lg:order-first z-10">
          <div className="whatsapp-panel-header lg:flex">
            <span>תפריט וסינון</span>
          </div>
          <div className="p-4 space-y-4 lg:space-y-6 overflow-y-auto max-h-[40vh] lg:max-h-none">
            {/* Search */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-face-muted uppercase">חיפוש חופשי</label>
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-face-muted" size={14} />
                <input 
                  type="text" 
                  placeholder="שם, מיקום, תאריך..."
                  className="w-full pr-9 pl-3 py-2 bg-neutral-50 border border-face-border rounded focus:outline-none focus:ring-1 focus:ring-whatsapp-primary text-sm"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            {/* Tabs (Mobile as horizontal buttons, Desktop as vertical list) */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-face-muted uppercase">סוג תצוגה</label>
              <div className="flex lg:flex-col gap-2 lg:gap-1">
                <button 
                  onClick={() => setActiveTab('available')}
                  className={`flex-1 lg:flex-none flex items-center justify-between p-2 lg:p-3 rounded text-sm font-bold transition-all ${activeTab === 'available' ? 'bg-[#E1F9EB] text-whatsapp-dark' : 'bg-neutral-50 lg:bg-transparent hover:bg-neutral-100 text-face-muted'}`}
                >
                  <div className="flex items-center gap-2">
                    <DoorOpen size={16} />
                    <span>פנויים</span>
                  </div>
                  <span className="hidden lg:inline bg-white/50 px-2 py-0.5 rounded text-xs">{zimmers.length}</span>
                </button>
                <button 
                  onClick={() => setActiveTab('requests')}
                  className={`flex-1 lg:flex-none flex items-center justify-between p-2 lg:p-3 rounded text-sm font-bold transition-all ${activeTab === 'requests' ? 'bg-[#E7F3FF] text-[#1877F2]' : 'bg-neutral-50 lg:bg-transparent hover:bg-neutral-100 text-face-muted'}`}
                >
                  <div className="flex items-center gap-2">
                    <ClipboardList size={16} />
                    <span>ביקושים</span>
                  </div>
                  <span className="hidden lg:inline bg-white/50 px-2 py-0.5 rounded text-xs">{requests.length}</span>
                </button>
              </div>
            </div>

            {/* Info Box - Hidden on mobile to save space */}
            <div className="hidden lg:block p-4 bg-emerald-50 border border-emerald-100 rounded-lg">
              <h4 className="text-xs font-bold text-emerald-800 flex items-center gap-1 mb-2">
                <Info size={12} />
                טיפ לשימוש
              </h4>
              <p className="text-[11px] text-emerald-700 leading-relaxed">
                ניתן לייבא הודעות מרובות בו זמנית. ה-AI יסדר אותן אוטומטית לפי סוגים.
              </p>
            </div>
          </div>

          {/* Stat Bar - Sticky at bottom of sidebar on desktop, visible below filters on mobile */}
          <div className="p-3 lg:p-4 border-t border-face-border bg-[#F9FAFB] flex gap-4 mt-auto">
            <div className="flex-1 text-center">
              <span className="block text-base lg:text-lg font-extrabold text-whatsapp-dark">{zimmers.length}</span>
              <span className="text-[9px] lg:text-[10px] text-face-muted font-bold uppercase tracking-tight">צימרים פנויים</span>
            </div>
            <div className="flex-1 text-center border-r border-face-border">
              <span className="block text-base lg:text-lg font-extrabold text-[#1877F2]">{requests.length}</span>
              <span className="text-[9px] lg:text-[10px] text-face-muted font-bold uppercase tracking-tight">ביקושי לקוחות</span>
            </div>
          </div>
        </aside>

        {/* Results List */}
        <section className="bg-white flex flex-col lg:h-full overflow-hidden">
          <div className="whatsapp-panel-header shrink-0">
            <span>
              {activeTab === 'available' ? 'תוצאות מאגר - צימרים זמינים' : 'תוצאות מאגר - ביקושי לקוחות'}
            </span>
          </div>
          
          <div className="flex-1 lg:overflow-y-auto p-4 bg-face-bg">
            <AnimatePresence mode="wait">
              {activeTab === 'available' ? (
                <motion.div 
                  key="available"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="space-y-3 max-w-4xl mx-auto"
                >
                  {filteredZimmers.length === 0 ? (
                    <div className="p-12 text-center text-face-muted text-sm italic">לא נמצאו תוצאות לחיפוש זה.</div>
                  ) : (
                    filteredZimmers.map(zimmer => (
                      <ZimmerCard 
                        key={zimmer.id} zimmer={zimmer} 
                        onDelete={deleteZimmer} onUpdate={updateZimmer}
                        isEditing={editingId === zimmer.id} setIsEditing={(val) => setEditingId(val ? zimmer.id : null)}
                      />
                    ))
                  )}
                </motion.div>
              ) : (
                <motion.div 
                  key="requests"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="space-y-3 max-w-4xl mx-auto"
                >
                  {filteredRequests.length === 0 ? (
                    <div className="p-12 text-center text-face-muted text-sm italic">אין ביקושים תואמים.</div>
                  ) : (
                    filteredRequests.map(request => (
                      <RequestCard 
                        key={request.id} request={request} 
                        onDelete={deleteRequest} onUpdate={updateRequest}
                        isEditing={editingId === request.id} setIsEditing={(val) => setEditingId(val ? request.id : null)}
                      />
                    ))
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </section>
      </div>

      {/* Import Modal - styled to match theme */}
      <AnimatePresence>
        {isImportModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => !isImporting && setIsImportModalOpen(false)}
              className="absolute inset-0 bg-[#3b5998]/20 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="relative bg-white w-full max-w-xl rounded-lg shadow-2xl overflow-hidden border border-face-border"
            >
              <div className="px-6 py-4 border-b border-face-border flex items-center justify-between bg-[#DCF8C6]/30">
                <h3 className="text-lg font-bold text-whatsapp-dark flex items-center gap-2">
                  <Download size={20} />
                  סנכרון נתונים מוואטסאפ
                </h3>
                <button 
                  onClick={() => setIsImportModalOpen(false)}
                  disabled={isImporting}
                  className="text-face-muted hover:text-face-text"
                >
                  <X size={24} />
                </button>
              </div>
              <div className="p-6">
                <div className="mb-4 bg-[#DCF8C6] p-4 rounded-lg border-r-4 border-whatsapp-dark text-xs leading-relaxed text-whatsapp-dark italic">
                  <b>הדבק את הודעות הקבוצה כאן:</b> המערכת תזהה באופן אוטומטי אם מדובר בצימר פנוי או בלקוח שמחפש מקום ותקטלג אותם בהתאם.
                </div>
                <textarea 
                  className="w-full h-48 p-4 bg-neutral-50 border border-face-border rounded focus:outline-none focus:ring-1 focus:ring-whatsapp-primary text-sm font-mono"
                  placeholder="הדבק כאן את הטקסט..."
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  disabled={isImporting}
                />
              </div>
              <div className="px-6 py-4 bg-[#F9FAFB] border-t border-face-border flex justify-end gap-3">
                <button 
                  onClick={() => setIsImportModalOpen(false)}
                  disabled={isImporting}
                  className="px-4 py-2 text-sm font-bold text-face-muted hover:text-face-text"
                >
                  סגור
                </button>
                <button 
                  onClick={handleImport}
                  disabled={isImporting || !importText.trim()}
                  className="px-6 py-2 bg-whatsapp-primary hover:bg-whatsapp-dark text-white rounded font-bold shadow-sm disabled:opacity-50 transition-all flex items-center gap-2 text-sm"
                >
                  {isImporting ? (
                    <>
                      <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      מנתח...
                    </>
                  ) : (
                    'הוסף למאגר'
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface ZimmerCardProps {
  zimmer: ZimmerAvailability;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<ZimmerAvailability>) => void;
  isEditing: boolean;
  setIsEditing: (val: boolean) => void;
}

function ZimmerCard({ zimmer, onDelete, onUpdate, isEditing, setIsEditing }: ZimmerCardProps) {
  const [localData, setLocalData] = useState(zimmer);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const currentUser = auth.currentUser;
  const isOwner = currentUser?.uid === zimmer.ownerUid;

  useEffect(() => {
    setLocalData(zimmer);
  }, [zimmer]);

  const handleSave = () => {
    onUpdate(zimmer.id, localData);
    setIsEditing(false);
  };

  const handleDateSelect = (dates: Date[] | undefined) => {
    if (!isOwner) return;
    const isoDates = (dates || []).map(d => d.toISOString().split('T')[0]);
    onUpdate(zimmer.id, { disabledDates: isoDates });
  };

  const selectedDates = (zimmer.disabledDates || []).map(d => parseISO(d)).filter(d => isValid(d));

  return (
    <div className="whatsapp-card relative">
      {isEditing ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-face-muted uppercase">שם הצימר</label>
              <input 
                className="w-full p-2 border border-face-border rounded text-sm" 
                value={localData.name} 
                onChange={e => setLocalData({...localData, name: e.target.value})} 
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-face-muted uppercase">מיקום</label>
              <input 
                className="w-full p-2 border border-face-border rounded text-sm" 
                value={localData.location} 
                onChange={e => setLocalData({...localData, location: e.target.value})} 
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-face-muted uppercase">תאריכים</label>
              <input 
                className="w-full p-2 border border-face-border rounded text-sm" 
                value={localData.dates} 
                onChange={e => setLocalData({...localData, dates: e.target.value})} 
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-face-muted uppercase">חדרים</label>
                <input 
                  type="number"
                  className="w-full p-2 border border-face-border rounded text-sm" 
                  value={localData.rooms} 
                  onChange={e => setLocalData({...localData, rooms: parseInt(e.target.value)})} 
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-face-muted uppercase">מיטות</label>
                <input 
                  type="number"
                  className="w-full p-2 border border-face-border rounded text-sm" 
                  value={localData.beds} 
                  onChange={e => setLocalData({...localData, beds: parseInt(e.target.value)})} 
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setIsEditing(false)} className="text-xs font-bold text-face-muted px-2 py-1">ביטול</button>
            <button onClick={handleSave} className="bg-whatsapp-dark text-white px-3 py-1 rounded font-bold text-xs flex items-center gap-1">
              <Check size={14} /> שמור
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="whatsapp-tag whatsapp-tag-green">פנוי</span>
                <h3 className="font-bold text-face-text text-base">{zimmer.name}</h3>
                {isOwner && <span className="text-[10px] bg-whatsapp-dark/10 text-whatsapp-dark px-2 rounded-full font-bold">הצימר שלי</span>}
              </div>
              <div className="flex items-center gap-3 text-xs text-face-muted">
                <span className="flex items-center gap-1"><MapPin size={12} /> {zimmer.location}</span>
                <span className="text-face-border opacity-50">|</span>
                <span className="flex items-center gap-1"><CalendarIcon size={12} /> {zimmer.dates}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={() => setIsCalendarOpen(!isCalendarOpen)} 
                className={`p-1.5 border border-face-border rounded transition-all ${isCalendarOpen ? 'bg-whatsapp-dark text-white' : 'text-face-muted hover:bg-neutral-50'}`}
                title="יומן תפוסה"
              >
                <CalendarIcon size={14} />
              </button>
              {(isOwner || auth.currentUser?.email === '3290667@gmail.com') && (
                <>
                  <button onClick={() => setIsEditing(true)} className="p-1.5 text-face-muted hover:text-whatsapp-dark border border-face-border rounded hover:bg-neutral-50 transition-all">
                    <Edit2 size={14} />
                  </button>
                  <button onClick={() => onDelete(zimmer.id)} className="p-1.5 text-face-muted hover:text-red-600 border border-face-border rounded hover:bg-red-50 transition-all">
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </div>
          </div>

          <AnimatePresence>
            {isCalendarOpen && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }} 
                animate={{ height: 'auto', opacity: 1 }} 
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-4 p-4 bg-neutral-50 border border-face-border rounded-lg flex flex-col md:flex-row items-center gap-6">
                  <div className="bg-white p-2 rounded border border-face-border shadow-sm">
                    <DayPicker
                      mode="multiple"
                      selected={selectedDates}
                      onSelect={handleDateSelect}
                      locale={he}
                      dir="rtl"
                    />
                  </div>
                  <div className="flex-1 space-y-3">
                    <h4 className="text-xs font-bold text-face-text uppercase tracking-wider">סטטוס יומן תפוסה</h4>
                    <p className="text-[11px] text-face-muted leading-relaxed">
                      {isOwner ? 
                        `בעל הצימר: לחץ על התאריכים בלוח השנה כדי לסמן אותם כתפוסים/זמינים. שאר המשתמשים יראו זאת בזמן אמת.` : 
                        `תאריכים מסומנים באדום/תפוסים בלוח השנה אינם זמינים להזמנה.`
                      }
                    </p>
                    <div className="flex items-center gap-4 text-[10px] font-bold">
                      <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 bg-whatsapp-primary rounded" />
                        <span>פנוי</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                         <div className="w-3 h-3 bg-[#e11d48] rounded" />
                         <span>תפוס</span>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="mt-4 flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-1.5 text-xs font-bold bg-neutral-100 px-2 py-1 rounded border border-face-border">
              <DoorOpen size={14} className="text-face-muted" />
              <span>{zimmer.rooms} חדרים</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-bold bg-neutral-100 px-2 py-1 rounded border border-face-border">
              <Bed size={14} className="text-face-muted" />
              <span>{zimmer.beds} מיטות</span>
            </div>
            {zimmer.price && (
              <span className="text-xs font-extrabold text-[#14A44D] ml-auto">{zimmer.price}</span>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-3">
            {zimmer.contactInfo && (
              <div className="flex items-center gap-1 text-[11px] text-face-muted">
                <Phone size={12}/> {zimmer.contactInfo}
              </div>
            )}
            {zimmer.notes && (
              <div className="flex items-center gap-1 text-[11px] text-[#65676B] italic">
                <Info size={12}/> {zimmer.notes}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

interface RequestCardProps {
  request: CustomerRequest;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<CustomerRequest>) => void;
  isEditing: boolean;
  setIsEditing: (val: boolean) => void;
}

function RequestCard({ request, onDelete, onUpdate, isEditing, setIsEditing }: RequestCardProps) {
  const [localData, setLocalData] = useState(request);
  const currentUser = auth.currentUser;
  const isCreator = currentUser?.uid === request.createdBy;

  useEffect(() => {
    setLocalData(request);
  }, [request]);

  const handleSave = () => {
    onUpdate(request.id, localData);
    setIsEditing(false);
  };

  return (
    <div className="whatsapp-card relative">
      <div className="absolute top-0 right-0 w-1.5 h-full bg-[#1877F2] rounded-r-lg opacity-20" />
      
      {isEditing ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-face-muted uppercase">שם לקוח</label>
              <input 
                className="w-full p-2 border border-face-border rounded text-sm" 
                value={localData.customerName} 
                onChange={e => setLocalData({...localData, customerName: e.target.value})} 
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-face-muted uppercase">מיקום מבוקש</label>
              <input 
                className="w-full p-2 border border-face-border rounded text-sm" 
                value={localData.locationPref || ''} 
                onChange={e => setLocalData({...localData, locationPref: e.target.value})} 
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-face-muted uppercase">תאריכים</label>
              <input 
                className="w-full p-2 border border-face-border rounded text-sm" 
                value={localData.dates} 
                onChange={e => setLocalData({...localData, dates: e.target.value})} 
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-face-muted uppercase">חדרים</label>
                <input 
                  type="number"
                  className="w-full p-2 border border-face-border rounded text-sm" 
                  value={localData.roomsNeeded} 
                  onChange={e => setLocalData({...localData, roomsNeeded: parseInt(e.target.value)})} 
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-face-muted uppercase">מיטות</label>
                <input 
                  type="number"
                  className="w-full p-2 border border-face-border rounded text-sm" 
                  value={localData.bedsNeeded} 
                  onChange={e => setLocalData({...localData, bedsNeeded: parseInt(e.target.value)})} 
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setIsEditing(false)} className="text-xs font-bold text-face-muted px-2 py-1">ביטול</button>
            <button onClick={handleSave} className="bg-[#1877F2] text-white px-3 py-1 rounded font-bold text-xs flex items-center gap-1">
              <Check size={14} /> שמור
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="whatsapp-tag whatsapp-tag-blue">ביקוש</span>
                <h3 className="font-bold text-face-text text-base">{request.customerName}</h3>
                {isCreator && <span className="text-[10px] bg-[#1877F2]/10 text-[#1877F2] px-2 rounded-full font-bold">הבקשה שלי</span>}
              </div>
              <div className="flex items-center gap-3 text-xs text-face-muted">
                <span className="flex items-center gap-1"><MapPin size={12} /> {request.locationPref || 'כל המקומות'}</span>
                <span className="text-face-border opacity-50">|</span>
                <span className="flex items-center gap-1"><CalendarIcon size={12} /> {request.dates}</span>
              </div>
            </div>
            {(isCreator || auth.currentUser?.email === '3290667@gmail.com') && (
              <div className="flex gap-2">
                <button onClick={() => setIsEditing(true)} className="p-1.5 text-face-muted hover:text-[#1877F2] border border-face-border rounded hover:bg-neutral-50 transition-all">
                  <Edit2 size={14} />
                </button>
                <button onClick={() => onDelete(request.id)} className="p-1.5 text-face-muted hover:text-red-600 border border-face-border rounded hover:bg-red-50 transition-all">
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-1.5 text-xs font-bold bg-neutral-100 px-2 py-1 rounded border border-face-border">
              <DoorOpen size={14} className="text-face-muted" />
              <span>{request.roomsNeeded} חדרים דרושים</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-bold bg-neutral-100 px-2 py-1 rounded border border-face-border">
              <Bed size={14} className="text-face-muted" />
              <span>{request.bedsNeeded} מיטות דרושות</span>
            </div>
            {request.budget && (
              <span className="text-xs font-extrabold text-[#1877F2] ml-auto">תקציב: {request.budget}</span>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-3">
            {request.contactInfo && (
              <div className="flex items-center gap-1 text-[11px] text-face-muted">
                <Phone size={12}/> {request.contactInfo}
              </div>
            )}
            {request.notes && (
              <div className="flex items-center gap-1 text-[11px] text-[#65676B] italic">
                <Info size={12}/> {request.notes}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
