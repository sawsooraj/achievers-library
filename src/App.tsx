/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, react-hooks/purity, react-hooks/set-state-in-effect */
// @ts-nocheck - Extensive type issues in monolithic legacy component, requires full refactor
// TODO: Split into smaller typed components in future refactor (Issue #500)
import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { db, auth } from './firebase';
import { collection, addDoc, getDocs, updateDoc, doc, onSnapshot, query, where } from 'firebase/firestore';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import DOMPurify from 'dompurify';
import './index.css';

// Configuration
const ADMIN_PASSWORDS = [import.meta.env.VITE_ADMIN_PASSWORD || 'tempAdmin#2026!Secure'];
const TOTAL_SEATS = 69;
const SEATS_PER_SLOT = 23;
const SLOTS = ['9am-3pm', '3pm-9pm', '9am-9pm'] as const;

const PLANS = {
  Monthly: { 'Half-day': 700, 'Full-day': 1200 },
  Quarterly: { 'Half-day': 1700, 'Full-day': 3200 },
  'Half-yearly': { 'Half-day': 3200, 'Full-day': 6000 },
  Yearly: { 'Half-day': 6000, 'Full-day': 10000 },
};

// LOGGING (FIX #1: Console.log in production)
const log = (message: string, data?: any) => {
  if (import.meta.env.DEV) {
    if (data !== undefined) console.log(message, data);
    else console.log(message);
  }
};

const logError = (message: string, error?: any) => {
  if (import.meta.env.DEV) {
    if (error !== undefined) console.error(message, error);
    else console.error(message);
  }
};

// FIX #118: Centralized helper to filter out deleted members
const getActiveMembers = (members: any[]) => members.filter(m => !m.deletedAt && !m.deleted);

// Short membership id, e.g. "MEM7K2PX" (MEM + 5 chars). Pass the ids already in
// use so we can regenerate on the rare collision and keep ids unique.
// "MEM" + 5 digits, e.g. MEM48213. Pass existing ids to avoid collisions.
const generateMembershipId = (existingIds: string[] = []) => {
  let id = '';
  do {
    id = 'MEM' + Math.floor(10000 + Math.random() * 90000); // 10000–99999 (always 5 digits)
  } while (existingIds.includes(id));
  return id;
};

// ---- CSV import/export (no external library) ----
// [field on member object, column header in the spreadsheet]
const MEMBER_COLUMNS: [string, string][] = [
  ['id', 'Membership ID'],
  ['fullName', 'Name'],
  ['email', 'Email'],
  ['phone', 'Phone'],
  ['plan', 'Plan'],
  ['slot', 'Slot'],
  ['amount', 'Amount'],
  ['paymentStatus', 'Payment Status'],
  ['paymentUTR', 'UTR'],
  ['startDate', 'Start Date'],
  ['gender', 'Gender'],
  ['dateOfBirth', 'DOB'],
  ['emergencyContactName', 'Emergency Contact'],
  ['emergencyContactPhone', 'Emergency Phone'],
  ['createdAt', 'Created At'],
];

const csvEscape = (v: any) => {
  const s = (v ?? '').toString();
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

const membersToCSV = (members: any[]) => {
  const header = MEMBER_COLUMNS.map(c => c[1]).join(',');
  const rows = members.map(m =>
    MEMBER_COLUMNS.map(([field]) => csvEscape(field === 'paymentUTR' ? (m.paymentUTR ?? m.utrNumber ?? '') : m[field])).join(',')
  );
  return [header, ...rows].join('\r\n');
};

// Minimal RFC-4180-ish CSV parser (handles quotes, commas and newlines in fields).
const parseCSV = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
};

const downloadFile = (filename: string, content: string, type = 'text/csv;charset=utf-8') => {
  const blob = new Blob(['﻿' + content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// Lightweight non-blocking toast. Works on any screen (the app has many early
// returns, so this writes straight to document.body instead of using state).
const showToast = (msg: string, type: 'success' | 'error' | 'info' = 'success') => {
  const bg = type === 'error' ? '#dc2626' : type === 'info' ? '#2563eb' : '#16a34a';
  const icon = type === 'error' ? '❌' : type === 'info' ? 'ℹ️' : '✅';
  const el = document.createElement('div');
  el.textContent = `${icon}  ${msg}`;
  el.setAttribute('role', 'status');
  el.style.cssText = `position:fixed;left:50%;bottom:28px;transform:translateX(-50%) translateY(8px);` +
    `background:${bg};color:#fff;padding:13px 22px;border-radius:12px;font-weight:600;font-size:15px;` +
    `box-shadow:0 8px 24px rgba(0,0,0,.22);z-index:99999;max-width:90vw;text-align:center;` +
    `opacity:0;transition:opacity .25s ease, transform .25s ease;font-family:system-ui,sans-serif;`;
  document.body.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateX(-50%) translateY(0)'; });
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(-50%) translateY(8px)'; }, 2600);
  setTimeout(() => el.remove(), 2900);
};

// Nice custom confirm dialog (replaces the browser's ugly window.confirm).
// Promise-based + built on document.body so it works across the app's many
// early returns. Resolves true on confirm, false on cancel/Esc/backdrop.
const confirmDialog = (message: string, opts: { confirmText?: string; cancelText?: string; danger?: boolean; title?: string } = {}): Promise<boolean> =>
  new Promise((resolve) => {
    const { confirmText = 'Confirm', cancelText = 'Cancel', danger = false, title = '' } = opts;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(17,24,39,.5);display:flex;align-items:center;justify-content:center;z-index:100000;padding:16px;font-family:system-ui,sans-serif;opacity:0;transition:opacity .15s;';
    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:18px;max-width:400px;width:100%;padding:26px;box-shadow:0 24px 60px rgba(0,0,0,.3);transform:scale(.96);transition:transform .15s;';
    if (title) { const h = document.createElement('p'); h.textContent = title; h.style.cssText = 'font-size:18px;font-weight:800;color:#111827;margin:0 0 8px;'; box.append(h); }
    const msg = document.createElement('p'); msg.textContent = message; msg.style.cssText = 'font-size:15px;color:#374151;margin:0 0 22px;line-height:1.55;'; box.append(msg);
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;';
    const cancel = document.createElement('button'); cancel.textContent = cancelText;
    cancel.style.cssText = 'padding:11px 20px;border-radius:12px;border:2px solid #e5e7eb;background:#fff;color:#374151;font-weight:700;cursor:pointer;font-size:14px;';
    const ok = document.createElement('button'); ok.textContent = confirmText;
    ok.style.cssText = `padding:11px 20px;border-radius:12px;border:none;background:${danger ? '#dc2626' : '#2563eb'};color:#fff;font-weight:800;cursor:pointer;font-size:14px;`;
    const close = (val: boolean) => { document.removeEventListener('keydown', onKey); overlay.style.opacity = '0'; box.style.transform = 'scale(.96)'; setTimeout(() => overlay.remove(), 150); resolve(val); };
    cancel.onclick = () => close(false);
    ok.onclick = () => close(true);
    overlay.onclick = (e) => { if (e.target === overlay) close(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(false); if (e.key === 'Enter') close(true); };
    document.addEventListener('keydown', onKey);
    row.append(cancel, ok); box.append(row); overlay.append(box); document.body.append(overlay);
    requestAnimationFrame(() => { overlay.style.opacity = '1'; box.style.transform = 'scale(1)'; });
    ok.focus();
  });

// Nice custom prompt (replaces window.prompt). Resolves the text, or null on cancel.
const promptDialog = (message: string, defaultValue = '', opts: { confirmText?: string; placeholder?: string } = {}): Promise<string | null> =>
  new Promise((resolve) => {
    const { confirmText = 'Save', placeholder = '' } = opts;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(17,24,39,.5);display:flex;align-items:center;justify-content:center;z-index:100000;padding:16px;font-family:system-ui,sans-serif;';
    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:18px;max-width:400px;width:100%;padding:26px;box-shadow:0 24px 60px rgba(0,0,0,.3);';
    const msg = document.createElement('p'); msg.textContent = message; msg.style.cssText = 'font-size:15px;font-weight:600;color:#374151;margin:0 0 12px;';
    const input = document.createElement('input'); input.value = defaultValue; input.placeholder = placeholder;
    input.style.cssText = 'width:100%;padding:11px 14px;border:2px solid #e5e7eb;border-radius:12px;font-size:15px;margin-bottom:18px;box-sizing:border-box;outline:none;';
    input.onfocus = () => { input.style.borderColor = '#2563eb'; };
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;';
    const cancel = document.createElement('button'); cancel.textContent = 'Cancel';
    cancel.style.cssText = 'padding:11px 20px;border-radius:12px;border:2px solid #e5e7eb;background:#fff;color:#374151;font-weight:700;cursor:pointer;font-size:14px;';
    const ok = document.createElement('button'); ok.textContent = confirmText;
    ok.style.cssText = 'padding:11px 20px;border-radius:12px;border:none;background:#2563eb;color:#fff;font-weight:800;cursor:pointer;font-size:14px;';
    const close = (val: string | null) => { document.removeEventListener('keydown', onKey); overlay.remove(); resolve(val); };
    cancel.onclick = () => close(null);
    ok.onclick = () => close(input.value);
    overlay.onclick = (e) => { if (e.target === overlay) close(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(null); if (e.key === 'Enter') close(input.value); };
    document.addEventListener('keydown', onKey);
    box.append(msg, input); row.append(cancel, ok); box.append(row); overlay.append(box); document.body.append(overlay);
    input.focus(); input.select();
  });

// Push one member to a Google Sheet via a user-deployed Apps Script web app.
// text/plain + no-cors keeps it a "simple" request (no CORS preflight that
// Apps Script can't answer); we fire-and-forget since the response is opaque.
const syncMemberToSheet = async (member: any) => {
  const url = localStorage.getItem('sheetWebhookUrl');
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        id: member.id, fullName: member.fullName, email: member.email, phone: member.phone,
        plan: member.plan, slot: member.slot, amount: member.amount,
        paymentStatus: member.paymentStatus, paymentUTR: member.paymentUTR ?? member.utrNumber ?? '',
        startDate: member.startDate, createdAt: member.createdAt ?? new Date().toISOString(),
      }),
    });
  } catch (e) {
    // Best-effort; failures must never block registration.
    if (import.meta.env.DEV) console.error('Sheet sync failed:', e);
  }
};

// Membership duration in months, keyed by the first word of the stored plan
// string (e.g. "Monthly Half-day" -> "Monthly"). Used to derive the expiry date
// from startDate, since no explicit expiry is persisted.
const PLAN_MONTHS: Record<string, number> = { Monthly: 1, Quarterly: 3, 'Half-yearly': 6, Yearly: 12 };
const getMembershipExpiry = (member: any): Date | null => {
  if (!member?.startDate) return null;
  const months = PLAN_MONTHS[(member.plan || '').split(' ')[0]];
  if (!months) return null;
  const d = new Date(member.startDate);
  if (isNaN(d.getTime())) return null;
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  // setMonth overflows (e.g. Jan 31 + 1 month -> Mar 3); clamp back to month end.
  if (d.getDate() < day) d.setDate(0);
  return d;
};

// Helper to parse query params
const getQueryParams = (searchString: string) => {
  const params = new URLSearchParams(searchString);
  return Object.fromEntries(params);
};

// Compress/downscale an image file to a JPEG data URL that fits comfortably
// under Firestore's 1 MiB per-document limit. The screenshot is stored INLINE in
// the member document, so an un-compressed phone photo (1–5 MB, ~33% larger once
// base64-encoded) would otherwise make the whole registration write fail.
const compressImage = (file: File, maxDim = 1000): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read image file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not load image'));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas not supported'));
        ctx.drawImage(img, 0, 0, w, h);
        // Step quality down until the data URL is safely under ~700 KB.
        let quality = 0.7;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        while (dataUrl.length > 700_000 && quality > 0.3) {
          quality -= 0.1;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        resolve(dataUrl);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });

// Safe JSON.parse for localStorage reads — corrupted data must never crash the app
const safeJSONParse = <T,>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

// FIX #213: Retry mechanism for failed async operations
const retryOperation = async (operation: () => Promise<any>, maxRetries = 3, delayMs = 500) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
    }
  }
};

// FIX #214: Timeout wrapper for async operations
const withTimeout = async (promise: Promise<any>, timeoutMs = 10000) => {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Operation timeout')), timeoutMs)
  );
  return Promise.race([promise, timeoutPromise]);
};

function App() {
  const navigate = useNavigate();
  const location = useLocation();

  // Admission Flow States
  const [step, setStep] = useState(0);
  const initialFormData = {
    fullName: '',
    email: '',
    phone: '',
    dateOfBirth: '',
    gender: '',
    currentClass: '',
    targetExam: '',
    schoolCollege: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    referralSource: '',
    // Temporary Address - Structured
    tempStreet: '',
    tempCity: '',
    tempState: '',
    tempPincode: '',
    // Permanent Address - Structured
    permStreet: '',
    permCity: '',
    permState: '',
    permPincode: '',
  };

  const [formData, setFormData] = useState(initialFormData);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSamePermanentAddress, setIsSamePermanentAddress] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false); // FIX #102: Controlled checkbox state
  const [selectedPlan, setSelectedPlan] = useState('');
  const [selectedDayType, setSelectedDayType] = useState('');
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [selectedSlot, setSelectedSlot] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('upi');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingMember, setIsSavingMember] = useState(false);
  const [debugError, setDebugError] = useState<string | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successMemberId, setSuccessMemberId] = useState<string | null>(null);
  const [upiScreenshot, setUpiScreenshot] = useState<string | null>(null);
  const [utrNumber, setUtrNumber] = useState('');
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [pdfBookingId, setPdfBookingId] = useState<string | null>(null);
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());

  // Admin States
  const [isAdmin, setIsAdmin] = useState(() => {
    const saved = localStorage.getItem('isAdmin');
    return saved === 'true';
  });
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminError, setAdminError] = useState('');
  const [adminPage, setAdminPage] = useState<'dashboard' | 'scanner' | 'members' | 'payments' | 'reminders' | 'seats' | 'users'>('dashboard');
  const [previousAdminPage, setPreviousAdminPage] = useState<'dashboard' | 'scanner' | 'members' | 'payments' | 'reminders' | 'seats' | 'users'>('dashboard');
  // FIX: Load users from localStorage so password changes persist
  const [users, setUsers] = useState<any[]>(() => {
    // No default passwords — weak hardcoded creds would be visible in the public
    // client bundle. Users can only log in once an admin sets a password (>=6)
    // for them via the Users page; until then only the master password works.
    const defaults = [
      { id: 'admin1', name: 'Admin', role: 'admin', password: '', email: 'admin@library.com' },
      { id: 'staff1', name: 'Staff Member', role: 'staff', password: '', email: 'staff@library.com' },
    ];
    const parsed = safeJSONParse<any[]>(localStorage.getItem('adminUsers'), defaults);
    if (!Array.isArray(parsed) || parsed.length === 0) return defaults;
    // Migration: scrub the old weak hardcoded defaults that may linger in
    // localStorage from a previous build, so they can't be used to log in.
    const weak = ['admin123', 'staff123'];
    return parsed.map((u: any) => (weak.includes(u?.password) ? { ...u, password: '' } : u));
  });
  const [editingUser, setEditingUser] = useState<any>(null);
  const [editUserPassword, setEditUserPassword] = useState('');
  const [members, setMembers] = useState<any[]>([]);
  const [selectedPaymentForReview, setSelectedPaymentForReview] = useState<any>(null);
  const [paymentReviewNotes, setPaymentReviewNotes] = useState('');
  const [reminderType, setReminderType] = useState<'payment' | 'welcome' | 'renewal'>('renewal');
  // Import / export / Google-Sheet sync
  const [showDataPanel, setShowDataPanel] = useState(false);
  const [sheetUrl, setSheetUrl] = useState(() => localStorage.getItem('sheetWebhookUrl') || '');
  const [importStatus, setImportStatus] = useState('');
  const importFileRef = useRef<HTMLInputElement>(null);
  const [editingMember, setEditingMember] = useState<any>(null);
  const [editFormData, setEditFormData] = useState<any>(null);
  const [scannedBookingId, setScannedBookingId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [memberFilter, setMemberFilter] = useState<'all' | 'approve' | 'verify' | 'active' | 'expiring' | 'expired' | 'rejected' | 'morning' | 'evening' | 'fullday'>('all');
  const [selectedMemberDetail, setSelectedMemberDetail] = useState<any>(null);

  // FIX #106: Debounce refs for preventing multiple calls
  const whatsappDebounceRef = useRef<{ [key: string]: number }>({});
  const paymentVerifyDebounceRef = useRef<{ [key: string]: boolean }>({});
  const formSubmitDebounceRef = useRef(0);
  const listenerUnsubscribesRef = useRef<Array<() => void>>([]);

  // FIX #203: Track mounted state to prevent setState in unmounted component
  const isMountedRef = useRef(true);

  // FIX #215: Track ongoing operations to prevent concurrent writes
  const ongoingOperationsRef = useRef<Set<string>>(new Set());

  // Track the last query-string we auto-opened a modal for, so that a
  // Firestore `members` update (which re-runs the URL effect) does not
  // re-open a modal the user has just closed.
  const lastModalSearchRef = useRef<string>('');

  // FIX #217: Rate limiting for admin login
  const loginAttemptsRef = useRef<{ count: number; timestamp: number }>({ count: 0, timestamp: 0 });
  const [loginLocked, setLoginLocked] = useState(false);

  // FIX #203: Cleanup effect - mark as unmounted
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Persist admin login state
  useEffect(() => {
    localStorage.setItem('isAdmin', String(isAdmin));
  }, [isAdmin]);

  // FIX: Persist users data to localStorage when they change
  useEffect(() => {
    localStorage.setItem('adminUsers', JSON.stringify(users));
  }, [users]);

  // Restore an in-progress admission once on mount, so a refresh or an
  // accidental tab-close doesn't wipe what the student already typed.
  useEffect(() => {
    const draft = safeJSONParse<any>(localStorage.getItem('admissionDraft'), null);
    if (draft?.formData?.fullName) {
      setFormData(prev => ({ ...prev, ...draft.formData }));
      if (draft.selectedPlan) setSelectedPlan(draft.selectedPlan);
      if (draft.selectedDayType) setSelectedDayType(draft.selectedDayType);
      if (draft.selectedSlot) setSelectedSlot(draft.selectedSlot);
      if (draft.selectedDate) setSelectedDate(draft.selectedDate);
      if (draft.isSamePermanentAddress) setIsSamePermanentAddress(true);
    }
  }, []);

  // Autosave the in-progress admission (small — screenshot is not included).
  useEffect(() => {
    if (formData.fullName || formData.email || formData.phone) {
      localStorage.setItem('admissionDraft', JSON.stringify({
        formData, selectedPlan, selectedDayType, selectedSlot, selectedDate, isSamePermanentAddress,
      }));
    }
  }, [formData, selectedPlan, selectedDayType, selectedSlot, selectedDate, isSamePermanentAddress]);

  // Handle browser back button
  useEffect(() => {
    const handlePopState = () => {
      // URL has changed, parser will handle updating state
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Parse URL and sync to step/admin state (URL is source of truth)
  useEffect(() => {
    const pathname = location.pathname || '/';
    const queryParams = getQueryParams(location.search);

    if (pathname.startsWith('/admin/')) {
      const page = pathname.replace('/admin/', '') as any;
      // Handle admin login page separately
      if (page === 'login') {
        setShowAdminLogin(true);
        // DON'T set isAdmin here - let handleAdminLogin manage it
      } else {
        // Only allow access to other admin pages if already logged in
        // FIX: Wait for state to stabilize before checking (small delay)
        if (!isAdmin) {
          setTimeout(() => {
            if (!isAdmin) navigate('/admin/login', { replace: true });
          }, 10);
        } else if (page === 'scanner' || page === 'payments' || page === 'reminders') {
          // These pages were removed (now handled inside Members) — redirect.
          navigate('/admin/dashboard', { replace: true });
        } else {
          setAdminPage(page || 'dashboard');
        }
      }

      // Handle modal/detail views via query params
      // e.g., /admin/members?detail=memberId or /admin/payments?review=paymentId
      // Only auto-open when the query-string itself changed — otherwise a
      // `members` listener update would re-open a modal the user just closed.
      if (location.search !== lastModalSearchRef.current) {
        let opened = false;
        if (queryParams.detail && members.length > 0) {
          const member = members.find(m => m.docId === queryParams.detail);
          if (member) { setSelectedMemberDetail(member); opened = true; }
        }
        if (queryParams.review && members.length > 0) {
          const payment = members.find(m => m.id === queryParams.review);
          if (payment) { setSelectedPaymentForReview(payment); opened = true; }
        }
        if (queryParams.edit && members.length > 0) {
          const member = members.find(m => m.docId === queryParams.edit);
          if (member) {
            setEditingMember(member);
            setEditFormData({...member});
            opened = true;
          }
        }
        // Record the search only once a modal actually opened, so a deep-link
        // that arrives before members have loaded still opens on the next run.
        if (opened || (!queryParams.detail && !queryParams.review && !queryParams.edit)) {
          lastModalSearchRef.current = location.search;
        }
      }
    } else if (pathname.startsWith('/admission/step-')) {
      const stepNum = parseInt(pathname.replace('/admission/step-', ''));
      if (!isNaN(stepNum) && stepNum >= 1 && stepNum <= 7) {
        const canAccessStep = stepNum === 1 || (
          stepNum >= 2 && formData.fullName && formData.dateOfBirth && formData.gender && formData.email && formData.phone
        );
        if (canAccessStep) {
          setStep(stepNum);
        } else {
          setStep(1);
          navigate('/admission/step-1', { replace: true });
        }
      } else {
        setStep(0);
      }
    } else {
      setStep(0);
    }
  }, [location.pathname, location.search, isAdmin, navigate, members]);

  // Load members from Firestore with real-time updates (FIX #19: Add [] dependency array)
  useEffect(() => {
    try {
      log('Setting up Firestore real-time listener...');
      // Set up real-time listener for members collection
      const unsubscribe = onSnapshot(
        collection(db, 'members'),
        (querySnapshot) => {
          log('Firestore listener triggered, total docs:', querySnapshot.docs.length);
          const membersList = querySnapshot.docs
            .map(doc => {
              const data = doc.data();
              log('Doc ID:', doc.id, 'Deleted:', data.deleted, 'Name:', data.fullName);
              return {
                id: data.id || doc.id,
                docId: doc.id,
                ...data
              };
            })
            .reduce((acc: any[], member: any, idx: number, arr: any[]) => {
              if (!member.deleted && !member.deletedAt && acc.findIndex(x => x.id === member.id) === -1) {
                acc.push(member);
              }
              return acc;
            }, []);
          log('✅ Members loaded from Firestore:', membersList.length, 'members');
          // FIX #203: Only setState if component is still mounted
          if (isMountedRef.current) {
            setMembers(membersList as any[]);
          }
        },
        (error) => {
          logError('❌ Firestore listener error:', error);
          log('Loading members from localStorage as fallback...');
          // FIX #203: Only setState if component is still mounted
          if (isMountedRef.current) setMembers(safeJSONParse<any[]>(localStorage.getItem('members'), []));
        }
      );

      // FIX #110: Add null check for unsubscribe function
      return () => {
        if (typeof unsubscribe === 'function') {
          unsubscribe();
        }
      };
    } catch (error) {
      logError('Error setting up listener:', error);
      setMembers(safeJSONParse<any[]>(localStorage.getItem('members'), []));
    }
  }, []);

  // QR Scanner initialization.
  // Depends only on [adminPage, scannedBookingId] — NOT on any state the effect
  // itself sets, otherwise a camera failure re-arms the effect into an infinite
  // re-init loop ("Maximum update depth exceeded"). The instance is tracked in a
  // ref so we never construct two scanners, and the per-frame decode-error
  // callback is intentionally ignored (it fires continuously when no QR code is
  // in view — that is normal, not an error to surface).
  useEffect(() => {
    if (adminPage !== 'scanner' || scannedBookingId) return;

    let qrScanner: Html5QrcodeScanner | null = null;
    try {
      qrScanner = new Html5QrcodeScanner('qr-reader', { fps: 10, qrbox: 250 }, false);
      qrScanner.render(
        (decodedText: string) => {
          const bookingId = decodedText.includes(':') ? decodedText.split(':')[1] : decodedText;
          setScannedBookingId(bookingId);
          try { qrScanner?.clear(); } catch { /* ignore */ }
        },
        () => { /* per-frame decode errors are expected; ignore */ }
      );
    } catch (error) {
      logError('QR Scanner error:', error);
    }

    return () => {
      try { qrScanner?.clear(); } catch { /* ignore cleanup errors */ }
    };
  }, [adminPage, scannedBookingId]);

  // FIX #96: Validate input name exists before setting
  const handleInputChange = (e: any) => {
    const { name, value } = e.target;
    if (!name || typeof name !== 'string') return;
    let sanitizedValue = value;
    if (name === 'fullName' || name === 'emergencyContactName') {
      sanitizedValue = value.replace(/[\p{Emoji}]/gu, '');
    }
    if (name === 'email') {
      sanitizedValue = value.toLowerCase().trim();
    }
    if (name === 'phone') {
      sanitizedValue = value.replace(/[^0-9]/g, '').slice(0, 10);
    }
    setFormData(prev => ({ ...prev, [name]: sanitizedValue }));
  };

  const generatePDF = async (bookingId: string, amount: number) => {
    try {
      const doc = new jsPDF('p', 'mm', 'a4');
      const pageWidth = doc.internal.pageSize.getWidth();
      let y = 15;

      // Header
      doc.setFontSize(22);
      doc.setFont('', 'bold');
      doc.setTextColor(25, 118, 210);
      doc.text('THE ACHIEVERS\' LIBRARY', pageWidth / 2, y, { align: 'center' });

      y += 7;
      doc.setFontSize(10);
      doc.setFont('', 'normal');
      doc.setTextColor(100, 100, 100);
      doc.text('Membership Admission Confirmation', pageWidth / 2, y, { align: 'center' });

      y += 12;

      // Divider
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.5);
      doc.line(15, y, pageWidth - 15, y);

      y += 8;

      // Membership ID prominently
      doc.setFontSize(11);
      doc.setFont('', 'bold');
      doc.setTextColor(60, 60, 60);
      doc.text('Membership ID:', 15, y);
      doc.setFontSize(13);
      doc.setTextColor(25, 118, 210);
      doc.text(bookingId, pageWidth - 15, y, { align: 'right' });

      y += 10;

      // Student Details
      doc.setFontSize(11);
      doc.setFont('', 'bold');
      doc.setTextColor(25, 118, 210);
      doc.text('STUDENT DETAILS', 15, y);

      y += 7;
      doc.setFont('', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(60, 60, 60);

      doc.text(`Name: ${formData.fullName || 'N/A'}`, 15, y);
      y += 5;
      doc.text(`Email: ${formData.email || 'N/A'}`, 15, y);
      y += 5;
      doc.text(`Phone: ${formData.phone || 'N/A'}`, 15, y);
      y += 5;
      doc.text(`DOB: ${formData.dateOfBirth ? new Date(formData.dateOfBirth).toLocaleDateString('en-IN') : 'N/A'}`, 15, y);
      y += 5;
      doc.text(`Gender: ${formData.gender || 'N/A'}`, 15, y);
      y += 5;
      doc.text(`Class/Year: ${formData.currentClass || 'N/A'}`, 15, y);
      y += 5;
      doc.text(`Target Exam: ${formData.targetExam || 'N/A'}`, 15, y);
      y += 5;
      doc.text(`School/College: ${formData.schoolCollege || 'N/A'}`, 15, y);
      y += 5;
      doc.text(`Emergency Contact: ${formData.emergencyContactName || 'N/A'}`, 15, y);
      y += 5;
      doc.text(`Emergency Phone: ${formData.emergencyContactPhone || 'N/A'}`, 15, y);
      y += 5;
      doc.text(`Referred By: ${formData.referralSource || 'N/A'}`, 15, y);

      y += 10;

      // Membership Plan
      doc.setFont('', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(25, 118, 210);
      doc.text('MEMBERSHIP PLAN', 15, y);

      y += 7;
      doc.setFont('', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(60, 60, 60);

      doc.text(`Plan: ${selectedPlan} - ${selectedDayType}`, 15, y);
      y += 5;
      doc.text(`Timing: ${selectedSlot}`, 15, y);

      const validTillDate = new Date(selectedDate);
      const vtDay = validTillDate.getDate();
      validTillDate.setMonth(validTillDate.getMonth() + (selectedPlan === 'Monthly' ? 1 : selectedPlan === 'Quarterly' ? 3 : selectedPlan === 'Half-yearly' ? 6 : 12));
      if (validTillDate.getDate() < vtDay) validTillDate.setDate(0); // clamp month-end overflow

      y += 5;
      doc.text(`Valid From: ${new Date(selectedDate).toLocaleDateString('en-IN')}`, 15, y);
      y += 5;
      doc.text(`Valid Till: ${validTillDate.toLocaleDateString('en-IN')}`, 15, y);

      y += 10;

      // Amount Box (light background)
      const boxHeight = 20;
      doc.setFillColor(240, 248, 255);
      doc.rect(15, y, pageWidth - 30, boxHeight, 'F');

      doc.setFont('', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(60, 60, 60);
      doc.text('Admission Fee: ₹100', 18, y + 7);
      doc.text(`${selectedPlan} Plan: ₹${amount - 100}`, 18, y + 13);

      doc.setFont('', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(25, 118, 210);
      doc.text(`Total: ₹${amount}`, pageWidth - 18, y + 10, { align: 'right' });

      y += boxHeight + 8;

      // Payment method + UTR / reference (proof of payment on the receipt)
      doc.setFont('', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(60, 60, 60);
      doc.text(`Payment Method: ${paymentMethod === 'upi' ? 'UPI' : 'Cash'}`, 18, y);
      if (paymentMethod === 'upi' && utrNumber) {
        y += 5;
        doc.text(`UTR / Reference: ${utrNumber}`, 18, y);
      }
      y += 10;

      // QR Code
      doc.setFont('', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(25, 118, 210);
      doc.text('SHOW AT RECEPTION', 15, y);

      y += 10;
      const qrCanvas = await QRCode.toCanvas(bookingId, { width: 100 });
      const qrImage = qrCanvas.toDataURL('image/png');
      doc.addImage(qrImage, 'PNG', pageWidth / 2 - 25, y, 50, 50);

      y += 55;

      // Footer
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.5);
      doc.line(15, y, pageWidth - 15, y);

      y += 6;
      doc.setFontSize(9);
      doc.setFont('', 'normal');
      doc.setTextColor(100, 100, 100);
      doc.text('The Achievers\' Library | Akashvani Chowk, Adityapur', pageWidth / 2, y, { align: 'center' });
      y += 4;
      doc.text('Phone: 9153144218', pageWidth / 2, y, { align: 'center' });

      // Return the PDF document instead of auto-saving
      return doc;
    } catch (error) {
      logError('PDF generation error:', error);
      alert('Error generating PDF. Please try again.');
      return null;
    }
  };

  // Input Sanitization Helper (FIX #4: Use DOMPurify instead of weak regex)
  const sanitizeInput = (input: string) => {
    return DOMPurify.sanitize(input, { ALLOWED_TAGS: [] });
  };

  // WhatsApp Messages & Helper
  const sendWhatsAppMessage = (phoneNumber: string, message: string) => {
    // FIX #106: Prevent multiple calls within 2 seconds
    const now = Date.now();
    if (whatsappDebounceRef.current[phoneNumber] && now - whatsappDebounceRef.current[phoneNumber] < 2000) {
      return; // Silently ignore rapid repeated calls
    }
    whatsappDebounceRef.current[phoneNumber] = now;

    // Sanitize phone number - keep only digits
    const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');

    // Ensure it's a valid length (10 or 12 digits)
    if (cleanPhone.length < 10) {
      alert('Invalid phone number for WhatsApp');
      return;
    }

    // Add country code if not present (assume India)
    const whatsappPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;

    const encodedMessage = encodeURIComponent(message);
    const whatsappUrl = `https://wa.me/${whatsappPhone}?text=${encodedMessage}`;
    window.open(whatsappUrl, '_blank');
  };

  const whatsappMessages = {
    welcome: (membershipId: string) => `Hello! Welcome to Achievers Library. Your Membership ID: ${membershipId}. Start studying and achieve your goals! 📚`,
    thankYou: () => `Thank you for your payment! Your membership is now active. Happy studying! 📚`,
    paymentRequest: () => `We didn't receive your payment confirmation. Please share the payment screenshot again. Thanks!`,
    renewal: (date: string) => `Your membership expires on ${date}. Renew now to continue studying! 📚`,
  };

  // Form reset function
  const resetForm = () => {
    // FIX #126: Reset all form state, not just core fields
    setFormData(initialFormData);
    setFormErrors({});
    setSelectedPlan('');
    setSelectedDayType('');
    setSelectedSlot('');
    setPaymentMethod('upi');
    setSelectedDate(new Date().toISOString().split('T')[0]);
    setUpiScreenshot(null);
    setUtrNumber('');
    setAgreeTerms(false);
    setIsSamePermanentAddress(false);
    setPdfDoc(null);
    setPdfBookingId(null);
    localStorage.removeItem('admissionDraft'); // clear saved draft once done
  };

  // Admin Navigation Functions
  const goToAdminPage = (page: 'dashboard' | 'scanner' | 'members' | 'payments' | 'reminders' | 'seats' | 'users') => {
    if (page !== adminPage) {
      setPreviousAdminPage(adminPage);
      // Navigate only — the URL effect is the single source of truth and will
      // set adminPage. Setting it here too risks URL/state desync.
      navigate(`/admin/${page}`, { replace: false });
    }
  };

  // FIX #108: Add validation guard. Navigate (don't just setAdminPage) so the
  // URL stays in sync; otherwise the URL effect re-runs on the next members
  // update and snaps the page back to whatever the (now stale) URL says.
  const goBackAdmin = () => {
    const validPages = ['dashboard', 'scanner', 'members', 'payments', 'reminders', 'seats', 'users'];
    const target = (previousAdminPage && validPages.includes(previousAdminPage as any)) ? previousAdminPage : 'dashboard';
    navigate(`/admin/${target}`);
  };

  // Admin Functions
  const grantAdmin = () => {
    loginAttemptsRef.current = { count: 0, timestamp: Date.now() };
    setLoginLocked(false);
    setIsAdmin(true);
    setAdminPassword('');
    setAdminError('');
    setAdminPage('dashboard');
    setShowAdminLogin(false);
    setTimeout(() => navigate('/admin/dashboard', { replace: true }), 0);
  };

  const rejectLogin = (msg: string) => {
    const now = Date.now();
    const { count, timestamp } = loginAttemptsRef.current;
    loginAttemptsRef.current = { count: count + 1, timestamp: timestamp === 0 ? now : timestamp };
    setAdminError(msg);
    if (loginAttemptsRef.current.count >= 5) setLoginLocked(true);
    setTimeout(() => setAdminError(''), 3000);
  };

  // Secure path = Firebase Auth (email + password): this gives a real token so
  // Firestore Rules can allow admin reads/writes and block everyone else.
  // If an email is given we ONLY trust Firebase Auth. With no email we fall back
  // to the legacy password so nobody gets locked out before Auth is set up —
  // but that path grants UI access only (no token), so under the secure rules it
  // can't touch the database.
  const handleAdminLogin = async (password: string) => {
    const now = Date.now();
    const { count, timestamp } = loginAttemptsRef.current;
    if (count >= 5 && now - timestamp < 300000) {
      setAdminError('Too many attempts. Try again later.');
      return;
    }
    if (now - timestamp > 300000) loginAttemptsRef.current = { count: 0, timestamp: now };

    const pwd = password.trim();
    const email = adminEmail.trim();

    if (email) {
      try {
        await signInWithEmailAndPassword(auth, email, pwd);
        setAdminEmail('');
        grantAdmin();
      } catch (err: any) {
        const code = err?.code || '';
        if (code === 'auth/operation-not-allowed' || code === 'auth/configuration-not-found') {
          rejectLogin('Firebase Auth is not enabled yet. Use the password (leave email empty) for now.');
        } else {
          rejectLogin('Invalid email or password.');
        }
      }
      return;
    }

    // Legacy password-only path (transition): UI access without a Firebase token.
    const customAdminPassword = localStorage.getItem('customAdminPassword');
    const masterPasswords = customAdminPassword ? [customAdminPassword] : [...ADMIN_PASSWORDS];
    const userPasswords = users.map((u: any) => u.password).filter((p: string) => p && p.length >= 6);
    if ([...masterPasswords, ...userPasswords].includes(pwd)) grantAdmin();
    else rejectLogin('Invalid password!');
  };

  // Returns true only when the member was actually saved. The caller relies on
  // this to decide whether to advance to the thank-you page — a duplicate or a
  // write failure must NOT be treated as a successful submission.
  const addMember = async (memberData: any): Promise<boolean> => {
    setIsSubmitting(true);
    setDebugError(null);
    try {
      // VALIDATION: Check for duplicate email
      const emailQuery = query(collection(db, 'members'), where('email', '==', memberData.email.toLowerCase()), where('deleted', '==', false));
      const emailDocs = await getDocs(emailQuery);
      if (emailDocs.docs.length > 0) {
        showToast('Email already exists! Member with this email is already registered.', "error");
        return false;
      }

      // VALIDATION: Check for duplicate phone
      const phoneQuery = query(collection(db, 'members'), where('phone', '==', memberData.phone), where('deleted', '==', false));
      const phoneDocs = await getDocs(phoneQuery);
      if (phoneDocs.docs.length > 0) {
        showToast('Phone number already exists! Member with this phone is already registered.', "error");
        return false;
      }

      const newMember = {
        ...memberData,
        email: memberData.email.toLowerCase(),
        createdAt: new Date().toISOString(),
        paymentStatus: 'pending',
        deleted: false,
      };

      log('📝 Attempting to save:', newMember);

      // Save to Firestore
      const docRef = await addDoc(collection(db, 'members'), newMember);
      log('✅ Saved to Firestore ID:', docRef.id);
      setDebugError(`✅ Saved: ${docRef.id}`);

      // Best-effort live sync to the configured Google Sheet (never blocks).
      syncMemberToSheet(newMember);

      // Show success modal
      setSuccessMemberId(docRef.id);
      setShowSuccessModal(true);
      return true;
    } catch (error: any) {
      const errorMsg = error?.message || String(error);
      logError('❌ Error:', errorMsg);
      setDebugError(`❌ ERROR: ${errorMsg}`);
      alert('❌ Error: ' + errorMsg);
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  // FIX #103: Use Promise.all instead of sequential forEach (faster, concurrent)
  const addDemoData = async () => {
    try {
      // First delete all existing data - use Promise.all for concurrent updates
      const existingDocs = await getDocs(collection(db, 'members'));
      await Promise.all(
        existingDocs.docs.map(docSnapshot =>
          updateDoc(doc(db, 'members', docSnapshot.id), { deleted: true })
        )
      );
    } catch (error) {
      logError('Error deleting demo data:', error);
      return;
    }

    const demoUsers = [
      { fullName: 'Aman Verma', email: 'aman.verma@email.com', phone: '9345612890', plan: 'Monthly Half-day', slot: '9am-3pm', amount: 700, paymentStatus: 'verified' },
      { fullName: 'Bhavna Singh', email: 'bhavna.singh@email.com', phone: '9876123450', plan: 'Monthly Full-day', slot: '9am-9pm', amount: 1200, paymentStatus: 'verified' },
      { fullName: 'Chirag Patel', email: 'chirag.patel@email.com', phone: '9123456789', plan: 'Quarterly Half-day', slot: '3pm-9pm', amount: 1700, paymentStatus: 'pending' },
      { fullName: 'Disha Reddy', email: 'disha.reddy@email.com', phone: '8765432190', plan: 'Monthly Half-day', slot: '9am-3pm', amount: 700, paymentStatus: 'verified' },
      { fullName: 'Esha Kapoor', email: 'esha.kapoor@email.com', phone: '9876543100', plan: 'Quarterly Full-day', slot: '9am-9pm', amount: 3200, paymentStatus: 'verified' },
      { fullName: 'Faisal Khan', email: 'faisal.khan@email.com', phone: '9765432210', plan: 'Half-yearly Half-day', slot: '3pm-9pm', amount: 3200, paymentStatus: 'pending' },
      { fullName: 'Gauravi Nair', email: 'gauravi.nair@email.com', phone: '9654321890', plan: 'Monthly Half-day', slot: '9am-3pm', amount: 700, paymentStatus: 'verified' },
      { fullName: 'Hritik Malhotra', email: 'hritik.malhotra@email.com', phone: '9543210876', plan: 'Yearly Full-day', slot: '9am-9pm', amount: 10000, paymentStatus: 'verified' },
      { fullName: 'Ishita Gupta', email: 'ishita.gupta@email.com', phone: '9432108765', plan: 'Monthly Half-day', slot: '3pm-9pm', amount: 700, paymentStatus: 'pending' },
      { fullName: 'Jaya Chatterjee', email: 'jaya.chatterjee@email.com', phone: '9321098765', plan: 'Quarterly Half-day', slot: '9am-3pm', amount: 1700, paymentStatus: 'verified' },
      { fullName: 'Karan Singh', email: 'karan.singh@email.com', phone: '9210987654', plan: 'Monthly Full-day', slot: '9am-9pm', amount: 1200, paymentStatus: 'verified' },
      { fullName: 'Lipika Tiwari', email: 'lipika.tiwari@email.com', phone: '9109876543', plan: 'Half-yearly Full-day', slot: '3pm-9pm', amount: 6000, paymentStatus: 'pending' },
      { fullName: 'Mohit Sharma', email: 'mohit.sharma@email.com', phone: '8998765432', plan: 'Monthly Half-day', slot: '9am-3pm', amount: 700, paymentStatus: 'verified' },
      { fullName: 'Nisha Bansal', email: 'nisha.bansal@email.com', phone: '8987654321', plan: 'Quarterly Full-day', slot: '9am-9pm', amount: 3200, paymentStatus: 'verified' },
      { fullName: 'Omkar Joshi', email: 'omkar.joshi@email.com', phone: '8976543210', plan: 'Monthly Half-day', slot: '3pm-9pm', amount: 700, paymentStatus: 'pending' },
      { fullName: 'Priyanka Desai', email: 'priyanka.desai@email.com', phone: '8965432109', plan: 'Monthly Full-day', slot: '9am-9pm', amount: 1200, paymentStatus: 'verified' },
      { fullName: 'Quinton Roy', email: 'quinton.roy@email.com', phone: '8954321098', plan: 'Yearly Half-day', slot: '9am-3pm', amount: 6000, paymentStatus: 'verified' },
      { fullName: 'Ritika Rao', email: 'ritika.rao@email.com', phone: '8943210987', plan: 'Quarterly Half-day', slot: '3pm-9pm', amount: 1700, paymentStatus: 'pending' },
      { fullName: 'Samrat Bhat', email: 'samrat.bhat@email.com', phone: '8932109876', plan: 'Monthly Half-day', slot: '9am-3pm', amount: 700, paymentStatus: 'verified' },
      { fullName: 'Tiya Sharma', email: 'tiya.sharma@email.com', phone: '8921098765', plan: 'Half-yearly Half-day', slot: '9am-9pm', amount: 3200, paymentStatus: 'verified' },
      { fullName: 'Uday Kumar', email: 'uday.kumar@email.com', phone: '8910987654', plan: 'Monthly Full-day', slot: '3pm-9pm', amount: 1200, paymentStatus: 'pending' },
      { fullName: 'Veda Singh', email: 'veda.singh@email.com', phone: '8809876543', plan: 'Quarterly Half-day', slot: '9am-3pm', amount: 1700, paymentStatus: 'verified' },
      { fullName: 'Vikram Sinha', email: 'vikram.sinha@email.com', phone: '8798765432', plan: 'Monthly Half-day', slot: '9am-9pm', amount: 700, paymentStatus: 'verified' },
      { fullName: 'Waris Ahmed', email: 'waris.ahmed@email.com', phone: '8687654321', plan: 'Yearly Full-day', slot: '3pm-9pm', amount: 10000, paymentStatus: 'pending' },
      { fullName: 'Xander Lee', email: 'xander.lee@email.com', phone: '8576543210', plan: 'Monthly Half-day', slot: '9am-3pm', amount: 700, paymentStatus: 'verified' },
      { fullName: 'Yamini Patel', email: 'yamini.patel@email.com', phone: '8465432109', plan: 'Half-yearly Full-day', slot: '9am-9pm', amount: 6000, paymentStatus: 'verified' },
      { fullName: 'Zain Hassan', email: 'zain.hassan@email.com', phone: '8354321098', plan: 'Quarterly Half-day', slot: '3pm-9pm', amount: 1700, paymentStatus: 'pending' },
    ];

    try {
      for (const user of demoUsers) {
        await addDoc(collection(db, 'members'), {
          id: generateMembershipId(),
          ...user,
          createdAt: new Date().toISOString(),
          deleted: false,
        });
      }
      // Don't manually update state - let real-time listener handle it
      showToast(`Added ${demoUsers.length} demo users!`, "success");
    } catch (error) {
      logError('Error adding demo data:', error);
      showToast('Error adding demo data', "error");
    }
  };

  const deleteAllDemoData = async () => {
    if (!confirm('⚠️ WARNING: This will delete ALL members permanently!\n\nAre you absolutely sure?')) return;
    if (!confirm('🔴 FINAL CONFIRMATION: Delete all members? This cannot be undone!')) return;

    try {
      const querySnapshot = await getDocs(collection(db, 'members'));
      for (const docSnapshot of querySnapshot.docs) {
        await updateDoc(doc(db, 'members', docSnapshot.id), {
          deleted: true,
        });
      }
      // Don't update local state - let real-time listener handle it
      showToast('All demo data deleted!', "success");
    } catch (error) {
      logError('Error deleting data:', error);
      showToast('Error deleting data', "error");
    }
  };

  const isValidPaymentTransition = (from: string, to: string, amount?: number): boolean => {
    const transitions: { [key: string]: string[] } = {
      'pending': ['verified', 'rejected'],
      'verified': [],
      'rejected': ['pending'],
    };
    if (!transitions[from]?.includes(to)) return false;
    if (to === 'verified' && (!amount || amount <= 0)) return false;
    return true;
  };

  // Export all active members to a CSV file (opens in Excel / Google Sheets).
  const handleExportCSV = () => {
    const active = getActiveMembers(members);
    if (active.length === 0) { alert('No members to export.'); return; }
    const date = new Date().toISOString().split('T')[0];
    downloadFile(`members_${date}.csv`, membersToCSV(active));
  };

  // Import members from a CSV whose header row matches the export columns.
  const handleImportCSV = async (file: File) => {
    try {
      setImportStatus('Reading file…');
      const text = await file.text();
      const rows = parseCSV(text);
      if (rows.length < 2) { setImportStatus('❌ File looks empty.'); return; }
      const header = rows[0].map(h => h.trim().toLowerCase());
      const colIndex = (label: string) => header.indexOf(label.toLowerCase());
      const idxName = colIndex('Name'), idxEmail = colIndex('Email'), idxPhone = colIndex('Phone');
      if (idxName === -1 || idxEmail === -1 || idxPhone === -1) {
        setImportStatus('❌ CSV must have at least Name, Email and Phone columns.');
        return;
      }
      const existingEmails = new Set(members.map(m => (m.email || '').toLowerCase()));
      const existingPhones = new Set(members.map(m => m.phone));
      const existingIds = members.map(m => m.id);
      let imported = 0, skipped = 0;
      for (let r = 1; r < rows.length; r++) {
        const cell = (label: string) => { const i = colIndex(label); return i === -1 ? '' : (rows[r][i] || '').trim(); };
        const fullName = cell('Name');
        const email = cell('Email').toLowerCase();
        const phone = cell('Phone').replace(/[^0-9]/g, '').slice(0, 10);
        if (!fullName || !email || phone.length !== 10) { skipped++; continue; }
        if (existingEmails.has(email) || existingPhones.has(phone)) { skipped++; continue; }
        const id = (cell('Membership ID') || generateMembershipId(existingIds));
        existingIds.push(id); existingEmails.add(email); existingPhones.add(phone);
        // Normalise status (so "Verified" etc. matches) and strip ₹/commas from amount.
        const rawStatus = cell('Payment Status').toLowerCase().trim();
        const paymentStatus = ['verified', 'pending', 'rejected'].includes(rawStatus) ? rawStatus : 'pending';
        const member = {
          id, fullName, email, phone,
          plan: cell('Plan'), slot: cell('Slot'),
          amount: Number(cell('Amount').replace(/[^0-9.]/g, '')) || 0,
          paymentStatus,
          paymentUTR: cell('UTR'), startDate: cell('Start Date'),
          gender: cell('Gender'), dateOfBirth: cell('DOB'),
          emergencyContactName: cell('Emergency Contact'), emergencyContactPhone: cell('Emergency Phone'),
          createdAt: cell('Created At') || new Date().toISOString(),
          deleted: false, importedAt: new Date().toISOString(),
        };
        await addDoc(collection(db, 'members'), member);
        syncMemberToSheet(member);
        imported++;
        setImportStatus(`Importing… ${imported} added`);
      }
      setImportStatus(`✅ Done: ${imported} imported, ${skipped} skipped (duplicates/invalid).`);
    } catch (e) {
      logError('Import failed:', e);
      setImportStatus('❌ Import failed. Check the file format.');
    }
  };

  // Push every existing active member to the configured Google Sheet.
  const handleSyncAllToSheet = async () => {
    if (!localStorage.getItem('sheetWebhookUrl')) { alert('Save your Google Sheet link first.'); return; }
    const active = getActiveMembers(members);
    if (!(await confirmDialog(`Send all ${active.length} members to the Google Sheet?`, { confirmText: 'Send' }))) return;
    for (const m of active) { await syncMemberToSheet(m); await new Promise(res => setTimeout(res, 120)); }
    showToast(`Sent ${active.length} members to the sheet.`, "success");
  };

  // --- Reusable admin actions (toast-based, no blocking popups) ---
  const acceptMember = async (member: any) => {
    if (member.membershipId) { showToast('Already accepted', 'info'); return; }
    if (ongoingOperationsRef.current.has(member.docId)) return;
    ongoingOperationsRef.current.add(member.docId);
    try {
      await retryOperation(() => updateDoc(doc(db, 'members', member.docId), { membershipId: member.id }));
      showToast(`Accepted — Membership ID ${member.id}`);
    } catch (error) {
      logError('Error accepting member:', error);
      showToast('Could not accept. Please try again.', 'error');
    } finally {
      ongoingOperationsRef.current.delete(member.docId);
    }
  };

  // Opens a pre-filled WhatsApp welcome (works before OR after accepting, so it
  // can be re-sent any time). The message is a draft; you tap send in WhatsApp.
  const sendWelcome = (member: any) => {
    if (!member.phone) { showToast('No phone number for this member', 'error'); return; }
    sendWhatsAppMessage(member.phone, whatsappMessages.welcome(member.membershipId || member.id));
    showToast('Opening WhatsApp…', 'info');
  };

  const rejectAdmission = async (member: any) => {
    if (member.deleted) { showToast('Already rejected', 'info'); return; }
    if (ongoingOperationsRef.current.has(member.docId)) return;
    if (!(await confirmDialog(`Reject ${member.fullName}? This removes their admission.`, { danger: true, confirmText: 'Reject' }))) return;
    ongoingOperationsRef.current.add(member.docId);
    try {
      await retryOperation(() => updateDoc(doc(db, 'members', member.docId), {
        deleted: true, deletedAt: new Date().toISOString(), deletedBy: 'admin',
      }));
      showToast(`${member.fullName} rejected`);
    } catch (error) {
      logError('Error rejecting member:', error);
      showToast('Could not reject. Please try again.', 'error');
    } finally {
      ongoingOperationsRef.current.delete(member.docId);
    }
  };

  const verifyPaymentQuick = async (member: any) => {
    if (paymentVerifyDebounceRef.current[member.id]) return;
    if (!member.amount || member.amount <= 0) { showToast('Set a valid amount before verifying', 'error'); return; }
    paymentVerifyDebounceRef.current[member.id] = true;
    try {
      await retryOperation(() => updateDoc(doc(db, 'members', member.docId), { paymentStatus: 'verified', verifiedAt: new Date().toISOString() }));
      showToast(`Payment verified — ₹${member.amount}`);
    } catch (error) {
      logError('Error verifying payment:', error);
      showToast('Could not verify. Please try again.', 'error');
    } finally {
      paymentVerifyDebounceRef.current[member.id] = false;
    }
  };

  const sendPaymentThanks = (member: any) => {
    if (!member.phone) { showToast('No phone number for this member', 'error'); return; }
    sendWhatsAppMessage(member.phone, whatsappMessages.thankYou());
    showToast('Opening WhatsApp…', 'info');
  };

  // Add/edit a private admin note on a member (e.g. "will pay tomorrow").
  const editMemberNote = async (member: any) => {
    const note = await promptDialog(`Note for ${member.fullName}`, member.adminNote || '', { placeholder: 'e.g. will pay tomorrow' });
    if (note === null) return; // cancelled
    try {
      await updateDoc(doc(db, 'members', member.docId), { adminNote: note.slice(0, 300) });
      showToast(note.trim() ? 'Note saved' : 'Note cleared');
    } catch (error) {
      logError('Error saving note:', error);
      showToast('Could not save note. Please try again.', 'error');
    }
  };

  // Send a renewal reminder to one member (WhatsApp draft with their expiry date).
  const sendRenewalReminder = (member: any) => {
    if (!member.phone) { showToast('No phone number for this member', 'error'); return; }
    const exp = getMembershipExpiry(member);
    sendWhatsAppMessage(member.phone, whatsappMessages.renewal(exp ? exp.toLocaleDateString('en-IN') : 'soon'));
    showToast('Opening WhatsApp…', 'info');
  };

  const rejectPaymentQuick = async (member: any) => {
    if (paymentVerifyDebounceRef.current[member.id]) return;
    paymentVerifyDebounceRef.current[member.id] = true;
    try {
      await retryOperation(() => updateDoc(doc(db, 'members', member.docId), { paymentStatus: 'rejected' }));
      showToast('Marked as unpaid');
    } catch (error) {
      logError('Error rejecting payment:', error);
      showToast('Could not update. Please try again.', 'error');
    } finally {
      paymentVerifyDebounceRef.current[member.id] = false;
    }
  };

  const updateMemberPayment = async (id: string, status: string) => {
    try {
      const member = members.find(m => m.id === id);
      if (!member?.docId) {
        showToast('Member not found', "error");
        return;
      }
      const currentStatus = member.paymentStatus || 'pending';
      if (!isValidPaymentTransition(currentStatus, status, member.amount)) {
        if (status === 'verified' && (!member.amount || member.amount <= 0)) {
          showToast('Cannot verify payment without valid amount', "error");
        } else {
          showToast(`Cannot transition from ${currentStatus} to ${status}`, "error");
        }
        return;
      }
      const memberRef = doc(db, 'members', member.docId);
      await updateDoc(memberRef, { paymentStatus: status });
      showToast(`Payment status updated to "${status}"`, "success");
    } catch (error) {
      logError('Error updating payment:', error);
      showToast('Error updating payment status. Please try again.', "error");
    }
  };

  // FIX #29: Memoize stats to avoid recalculation on every render
  // FIX #118: Filter out deleted members from stats
  const stats = useMemo(() => {
    const active = getActiveMembers(members);
    return {
      totalMembers: active.length,
      pendingPayments: active.filter(m => m.paymentStatus === 'pending').length,
      verifiedMembers: active.filter(m => m.paymentStatus === 'verified').length,
      // Only VERIFIED payments count as collected revenue (not pending/rejected).
      totalRevenue: active.filter(m => m.paymentStatus === 'verified').reduce((sum, m) => sum + (m.amount || 0), 0),
    };
  }, [members]);

  // FIX #105: Memoize frequently used member filters to avoid recalculation on every render
  const memberFilters = useMemo(() => {
    const active = getActiveMembers(members);
    const q = searchQuery.trim().toLowerCase();
    const now = Date.now();
    const DAY = 86400000;
    const daysToExpiry = (m: any) => {
      const exp = getMembershipExpiry(m);
      return exp ? Math.ceil((exp.getTime() - now) / DAY) : null;
    };
    return {
      active,
      daysToExpiry,
      noMembershipId: active.filter(m => !m.membershipId),
      pendingPayments: active.filter(m => m.paymentStatus === 'pending'),
      verified: active.filter(m => m.paymentStatus === 'verified'),
      // Expiry buckets only make sense for verified members with a start date.
      expiringSoon: active.filter(m => { const d = daysToExpiry(m); return m.paymentStatus === 'verified' && d !== null && d >= 0 && d <= 7; }),
      expired: active.filter(m => { const d = daysToExpiry(m); return m.paymentStatus === 'verified' && d !== null && d < 0; }),
      searchFiltered: q.length === 0 ? active : active.filter(m =>
        (m.fullName?.toLowerCase().includes(q) || false) ||
        (m.email?.toLowerCase().includes(q) || false) ||
        (m.phone?.includes(q) || false) ||
        (m.id?.toLowerCase().includes(q) || false)
      ),
    };
  }, [members, searchQuery]);

  // ADMIN LOGIN PAGE (show when login button is clicked or at /admin/login URL)
  // Priority: URL-driven login (if pathname is /admin/login, show login regardless of showAdminLogin state)
  const isLoginPath = location.pathname === '/admin/login';
  if ((showAdminLogin || isLoginPath) && !isAdmin) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-2xl p-8 w-full max-w-md shadow-2xl"
        >
          <div className="text-center mb-8">
            <div className="text-5xl mb-4">🔐</div>
            <h1 className="text-3xl font-bold text-gray-800">Admin Access</h1>
            <p className="text-gray-600 mt-2">The Achievers' Library</p>
          </div>

          <input
            type="email"
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
            onKeyPress={(e) => { if (e.key === 'Enter') handleAdminLogin(adminPassword); }}
            placeholder="Admin email (recommended)"
            className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg mb-3 focus:border-blue-600 outline-none focus:ring-2 focus:ring-blue-200"
            autoComplete="username"
          />
          <input
            type="password"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                handleAdminLogin(adminPassword);
              }
            }}
            placeholder="Password"
            autoComplete="current-password"
            className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg mb-4 focus:border-blue-600 outline-none focus:ring-2 focus:ring-blue-200"
            autoFocus
          />

          {adminError && (
            <div className="mb-4 p-3 bg-red-100 border-l-4 border-red-500 text-red-700 rounded">
              <p className="font-semibold">❌ {adminError}</p>
              <p className="text-sm mt-1">Check with your administrator for access</p>
            </div>
          )}

          <button
            onClick={() => handleAdminLogin(adminPassword)}
            className="w-full py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-bold rounded-lg hover:shadow-lg transition"
          >
            Login
          </button>

          <button
            onClick={() => {
              setShowAdminLogin(false);
              setAdminError('');
            }}
            className="w-full mt-3 py-3 border-2 border-blue-600 text-blue-600 font-bold rounded-lg hover:bg-blue-50"
          >
            Back
          </button>
        </motion.div>
      </div>
    );
  }

  // ADMIN PAGES
  if (isAdmin && adminPage) {
    // Admin Dashboard
    if (adminPage === 'dashboard') {
      // FIX #29: Use memoized stats instead of calling getStats()
      return (
        <div className="min-h-screen bg-gray-50">
          {/* Admin Header */}
          <header className="sticky top-0 z-40 bg-white shadow">
            <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="text-2xl font-bold text-blue-600">📊 Admin Dashboard</div>
                <div className="flex items-center gap-1 bg-green-100 px-3 py-1 rounded-full">
                  <span className="w-2 h-2 bg-green-600 rounded-full animate-pulse"></span>
                  <span className="text-xs font-bold text-green-700">Live v2.0</span>
                </div>
              </div>
              <button
                onClick={() => { signOut(auth).catch(() => {}); setIsAdmin(false); setAdminPage('dashboard'); navigate('/'); }}
                className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
              >
                Logout
              </button>
            </div>
          </header>

          {/* Sidebar Navigation */}
          <div className="flex max-w-7xl mx-auto">
            <div className="w-48 bg-white shadow p-4">
              <nav className="space-y-2">
                <button
                  onClick={() => goToAdminPage('dashboard')}
                  className={`w-full text-left px-4 py-3 rounded-lg font-semibold ${
                    adminPage === 'dashboard' ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  📈 Dashboard
                </button>
                <button
                  onClick={() => goToAdminPage('seats')}
                  className={`w-full text-left px-4 py-3 rounded-lg font-semibold ${
                    adminPage === 'seats' ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  🪑 Seats
                </button>
                <button
                  onClick={() => goToAdminPage('members')}
                  className={`w-full text-left px-4 py-3 rounded-lg font-semibold ${
                    adminPage === 'members' ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  👥 Members
                </button>
                <button
                  onClick={() => goToAdminPage('users')}
                  className={`w-full text-left px-4 py-3 rounded-lg font-semibold ${
                    adminPage === 'users' ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  👤 Users & Passwords
                </button>
              </nav>
            </div>

            {/* Main Content - TODAY'S ACTION ITEMS */}
            <div className="flex-1 p-8">
              {/* Quick Summary */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                <div className="bg-green-50 p-4 rounded-lg border-l-4 border-green-500">
                  <div className="text-gray-600 text-xs font-semibold">NEW ADMISSIONS</div>
                  <div className="text-3xl font-bold text-green-600 mt-1">{members.filter(m => !m.membershipId).length}</div>
                </div>
                <div className="bg-orange-50 p-4 rounded-lg border-l-4 border-orange-500">
                  <div className="text-gray-600 text-xs font-semibold">PENDING PAYMENTS</div>
                  <div className="text-3xl font-bold text-orange-600 mt-1">{members.filter(m => m.paymentStatus === 'pending').length}</div>
                </div>
                <div className="bg-blue-50 p-4 rounded-lg border-l-4 border-blue-500">
                  <div className="text-gray-600 text-xs font-semibold">ACTIVE MEMBERS</div>
                  <div className="text-3xl font-bold text-blue-600 mt-1">{stats.verifiedMembers}</div>
                </div>
                <div className="bg-purple-50 p-4 rounded-lg border-l-4 border-purple-500">
                  <div className="text-gray-600 text-xs font-semibold">COLLECTED REVENUE</div>
                  <div className="text-3xl font-bold text-purple-600 mt-1">₹{stats.totalRevenue}</div>
                </div>
              </div>

              {/* Section 1: New Admissions Pending */}
              <div className="bg-white rounded-lg shadow p-6 mb-6">
                {/* FIX #118: Filter out deleted members from pending admissions */}
                {/* FIX #105: Use memoized filter */}
                {(() => {
                  const pendingAdmissions = memberFilters.noMembershipId;
                  return (
                    <>
                      <h2 className="text-xl font-bold text-green-700 mb-4">🆕 New Admissions Pending ({pendingAdmissions.length})</h2>
                      {pendingAdmissions.length === 0 ? (
                        <p className="text-gray-500">No pending admissions</p>
                      ) : (
                        <div className="space-y-4">
                          {pendingAdmissions.map(member => (
                      <div key={member.id} className="border-2 border-green-200 p-4 rounded-lg bg-green-50">
                        <div className="grid grid-cols-2 gap-4 mb-4">
                          <div>
                            <p className="text-xs text-gray-600">Name</p>
                            <p className="font-bold text-lg">{member.fullName}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-600">Plan</p>
                            <p className="font-bold">{member.plan}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-600">Phone</p>
                            <p className="font-bold">{member.phone}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-600">Amount</p>
                            <p className="font-bold text-green-600">₹{member.amount || 700}</p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => acceptMember(member)}
                            className="flex-1 py-2.5 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 active:scale-95 transition text-sm"
                          >
                            ✅ Accept
                          </button>
                          <button
                            onClick={() => sendWelcome(member)}
                            title="Send welcome message on WhatsApp"
                            className="flex-1 py-2.5 bg-emerald-500 text-white font-bold rounded-lg hover:bg-emerald-600 active:scale-95 transition text-sm"
                          >
                            💬 WhatsApp
                          </button>
                          <button
                            onClick={() => rejectAdmission(member)}
                            title="Reject this admission"
                            className="px-4 py-2.5 bg-red-100 text-red-700 font-bold rounded-lg hover:bg-red-200 active:scale-95 transition text-sm"
                          >
                            ❌
                          </button>
                        </div>
                      </div>
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>

              {/* Section 2: Pending Payments */}
              <div className="bg-white rounded-lg shadow p-6 mb-6">
                {/* FIX #118: Filter out deleted members from pending payments */}
                {/* FIX #105: Use memoized filter */}
                {(() => {
                  const pendingPayments = memberFilters.pendingPayments;
                  return (
                    <>
                      <h2 className="text-xl font-bold text-orange-700 mb-4">💰 Pending Payments to Verify ({pendingPayments.length})</h2>
                      {pendingPayments.length === 0 ? (
                        <p className="text-gray-500">No pending payments</p>
                      ) : (
                        <div className="space-y-4">
                          {pendingPayments.map(member => (
                      <div key={member.id} className="border-2 border-orange-200 p-4 rounded-lg bg-orange-50">
                        <div className="flex gap-4 mb-4">
                          {/* Payment screenshot thumbnail — tap to enlarge */}
                          {member.upiScreenshot ? (
                            <img
                              src={member.upiScreenshot}
                              alt="Payment proof"
                              onClick={() => window.open(member.upiScreenshot, '_blank')}
                              className="w-20 h-20 object-cover rounded-lg border-2 border-orange-300 cursor-pointer flex-shrink-0"
                              title="Tap to view full screenshot"
                            />
                          ) : (
                            <div className="w-20 h-20 rounded-lg border-2 border-dashed border-orange-300 flex items-center justify-center text-xs text-gray-400 flex-shrink-0 text-center">No screenshot</div>
                          )}
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 flex-1">
                            <div><p className="text-xs text-gray-500">Name</p><p className="font-bold">{member.fullName}</p></div>
                            <div><p className="text-xs text-gray-500">Amount</p><p className="font-bold text-orange-600">₹{member.amount || 0}</p></div>
                            <div><p className="text-xs text-gray-500">Method</p><p className="font-semibold capitalize">{member.paymentMethod || 'UPI'}</p></div>
                            <div><p className="text-xs text-gray-500">UTR / Ref</p><p className="font-semibold break-all">{member.paymentUTR || member.utrNumber || '—'}</p></div>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => verifyPaymentQuick(member)}
                            className="flex-1 py-2.5 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 active:scale-95 transition text-sm"
                          >
                            ✅ Verify
                          </button>
                          <button
                            onClick={() => sendPaymentThanks(member)}
                            title="Send thank-you on WhatsApp"
                            className="flex-1 py-2.5 bg-emerald-500 text-white font-bold rounded-lg hover:bg-emerald-600 active:scale-95 transition text-sm"
                          >
                            💬 Thank
                          </button>
                          <button
                            onClick={() => rejectPaymentQuick(member)}
                            title="Mark as unpaid"
                            className="px-4 py-2.5 bg-red-100 text-red-700 font-bold rounded-lg hover:bg-red-200 active:scale-95 transition text-sm"
                          >
                            ✗
                          </button>
                        </div>
                      </div>
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>

              {/* Section 3: Renewals Due Soon */}
              <div className="bg-white rounded-lg shadow p-6 mb-6">
                <h2 className="text-xl font-bold text-blue-700 mb-4">🔄 Renewals Coming Up (Upcoming Members)</h2>
                <p className="text-gray-500 text-center py-4">Send renewal reminders when memberships are expiring soon</p>
              </div>

            </div>
          </div>
        </div>
      );
    }

    // QR Scanner Page
    if ((adminPage as string) === 'scanner') {
      return (
        <div className="min-h-screen bg-gray-50">
          <header className="sticky top-0 z-40 bg-white shadow">
            <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-4">
              <button onClick={() => { setScannedBookingId(''); goBackAdmin(); }} className="text-2xl">←</button>
              <div className="text-2xl font-bold text-blue-600">📱 QR Scanner</div>
            </div>
          </header>

          <div className="max-w-2xl mx-auto p-8">
            <div className="bg-white rounded-lg shadow p-8">
              {!scannedBookingId ? (
                <>
                  <p className="text-center text-gray-600 mb-6 font-semibold">📸 Point camera at QR code</p>

                  <div id="qr-reader" className="w-full mb-6" style={{minHeight: '300px'}}></div>

                  <div className="bg-blue-50 p-4 rounded-lg mb-6 text-center">
                    <p className="text-sm text-gray-700">
                      💡 Tip: Make sure lighting is good and QR code is clearly visible
                    </p>
                  </div>

                  <button
                    onClick={() => { setScannedBookingId(''); navigate('/admin/dashboard'); }}
                    className="w-full py-3 border-2 border-blue-600 text-blue-600 font-bold rounded-lg hover:bg-blue-50"
                  >
                    Back to Dashboard
                  </button>
                </>
              ) : (
                <div className="space-y-6">
                  <div className="bg-green-50 border border-green-200 p-6 rounded-lg">
                    <div className="text-lg font-bold text-green-700 mb-4">✅ QR Scanned Successfully!</div>
                    <div className="text-3xl font-mono font-bold text-blue-600 mb-6 p-4 bg-blue-50 rounded text-center">{scannedBookingId}</div>

                    {members.find(m => m.id === scannedBookingId) ? (
                      <div className="bg-white p-6 rounded-lg space-y-3 border-2 border-green-200">
                        {members.map(m => m.id === scannedBookingId && (
                          <div key={m.id} className="space-y-3">
                            <div className="flex justify-between border-b pb-2">
                              <span className="font-semibold">Name:</span>
                              <span>{m.fullName}</span>
                            </div>
                            <div className="flex justify-between border-b pb-2">
                              <span className="font-semibold">Phone:</span>
                              <span>{m.phone}</span>
                            </div>
                            <div className="flex justify-between border-b pb-2">
                              <span className="font-semibold">Plan:</span>
                              <span>{m.plan}</span>
                            </div>
                            <div className="flex justify-between border-b pb-2">
                              <span className="font-semibold">Slot:</span>
                              <span>{m.slot || 'N/A'}</span>
                            </div>
                            <div className="flex justify-between pb-2">
                              <span className="font-semibold">Status:</span>
                              <span className={`px-2 py-1 rounded font-bold ${
                                m.paymentStatus === 'verified' ? 'bg-green-200 text-green-800' :
                                m.paymentStatus === 'pending' ? 'bg-yellow-200 text-yellow-800' :
                                'bg-red-200 text-red-800'
                              }`}>
                                {m.paymentStatus === 'verified' ? '✓ Verified' :
                                 m.paymentStatus === 'pending' ? '⏳ Pending' :
                                 '❌ Rejected'}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="bg-red-50 border border-red-200 p-6 rounded-lg">
                        <p className="text-red-600 font-bold text-center">❌ Member not found in database</p>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={() => { setScannedBookingId(''); }}
                      className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700"
                    >
                      📸 Scan Next
                    </button>
                    <button
                      onClick={() => { setScannedBookingId(''); navigate('/admin/dashboard'); }}
                      className="flex-1 py-3 border-2 border-blue-600 text-blue-600 font-bold rounded-lg hover:bg-blue-50"
                    >
                      Back to Dashboard
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    // Members Page — command center: search + status filters + per-member actions
    if ((adminPage as string) === 'members') {
      const searched = memberFilters.searchFiltered;
      const d2e = memberFilters.daysToExpiry;
      const byTab: Record<string, any[]> = {
        all: searched,
        approve: searched.filter(m => !m.membershipId),
        verify: searched.filter(m => m.paymentStatus === 'pending'),
        active: searched.filter(m => m.paymentStatus === 'verified'),
        expiring: searched.filter(m => { const d = d2e(m); return m.paymentStatus === 'verified' && d !== null && d >= 0 && d <= 7; }),
        expired: searched.filter(m => { const d = d2e(m); return m.paymentStatus === 'verified' && d !== null && d < 0; }),
        rejected: searched.filter(m => m.paymentStatus === 'rejected'),
        morning: searched.filter(m => m.slot === '9am-3pm'),
        evening: searched.filter(m => m.slot === '3pm-9pm'),
        fullday: searched.filter(m => m.slot === '9am-9pm'),
      };
      const filtered = byTab[memberFilter] || searched;
      const act = memberFilters.active;
      const filterChips = [
        { key: 'all', label: '👥 All', count: act.length },
        { key: 'approve', label: '🆕 Approve', count: memberFilters.noMembershipId.length },
        { key: 'verify', label: '💰 Verify Payment', count: memberFilters.pendingPayments.length },
        { key: 'active', label: '✅ Active', count: memberFilters.verified.length },
        { key: 'expiring', label: '⏰ Expiring', count: memberFilters.expiringSoon.length },
        { key: 'expired', label: '🔴 Expired', count: memberFilters.expired.length },
        { key: 'rejected', label: '🚫 Rejected', count: act.filter(m => m.paymentStatus === 'rejected').length },
        { key: 'morning', label: '🌅 Morning', count: act.filter(m => m.slot === '9am-3pm').length },
        { key: 'evening', label: '🌆 Evening', count: act.filter(m => m.slot === '3pm-9pm').length },
        { key: 'fullday', label: '🌞 Full-day', count: act.filter(m => m.slot === '9am-9pm').length },
      ];

      return (
        <div className="min-h-screen bg-gray-50">
          <header className="sticky top-0 z-40 bg-white shadow">
            <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <button onClick={() => goBackAdmin()} className="text-2xl">←</button>
                <div className="text-2xl font-bold text-blue-600">👥 Members List</div>
              </div>
              <button
                onClick={() => { signOut(auth).catch(() => {}); setIsAdmin(false); setAdminPage('dashboard'); navigate('/'); }}
                className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 font-semibold text-sm"
              >
                Logout
              </button>
            </div>
          </header>

          <div className="max-w-6xl mx-auto p-8">
            <div className="mb-6">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search by name or ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-600 outline-none"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-3 text-gray-500 hover:text-gray-700 text-xl font-bold"
                    title="Clear search"
                  >
                    ✕
                  </button>
                )}
              </div>
              {searchQuery && <p className="text-sm text-gray-600 mt-2">Found {filtered.length} member(s)</p>}
            </div>

            {/* Import / Export / Google Sheet toolbar */}
            <div className="mb-6 flex flex-wrap gap-3">
              <button onClick={handleExportCSV} className="px-4 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 text-sm">
                ⬇️ Export CSV
              </button>
              <button onClick={() => importFileRef.current?.click()} className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 text-sm">
                ⬆️ Import CSV
              </button>
              <button onClick={() => setShowDataPanel(true)} className="px-4 py-2 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 text-sm">
                📊 Google Sheet {localStorage.getItem('sheetWebhookUrl') ? '✓' : ''}
              </button>
              <input
                ref={importFileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportCSV(f); e.target.value = ''; }}
              />
              {importStatus && <span className="self-center text-sm font-semibold text-gray-700">{importStatus}</span>}
            </div>

            {showDataPanel && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[85vh] overflow-y-auto">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold">📊 Live Google Sheet Sync</h2>
                    <button onClick={() => setShowDataPanel(false)} className="text-2xl text-gray-500 hover:text-gray-700">×</button>
                  </div>

                  <p className="text-sm text-gray-600 mb-2">Paste your Google Apps Script Web App URL. Once saved, every new member is added to your sheet automatically.</p>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={sheetUrl}
                      onChange={(e) => setSheetUrl(e.target.value)}
                      placeholder="https://script.google.com/macros/s/..../exec"
                      className="flex-1 px-3 py-2 border-2 border-gray-300 rounded-lg text-sm"
                    />
                    <button
                      onClick={async () => {
                        const u = sheetUrl.trim();
                        if (u && !/^https:\/\/script\.google\.com\/.*\/exec$/.test(u)) {
                          if (!(await confirmDialog('That does not look like an Apps Script /exec URL. Save anyway?', { confirmText: 'Save anyway' }))) return;
                        }
                        if (u) localStorage.setItem('sheetWebhookUrl', u); else localStorage.removeItem('sheetWebhookUrl');
                        showToast(u ? 'Google Sheet link saved!' : 'Link cleared.');
                      }}
                      className="px-4 py-2 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 text-sm"
                    >Save</button>
                  </div>
                  <button onClick={handleSyncAllToSheet} className="w-full mb-5 px-4 py-2 bg-purple-600 text-white font-bold rounded-lg hover:bg-purple-700 text-sm">
                    🔄 Send all existing members to the sheet
                  </button>

                  <div className="bg-gray-50 border rounded-lg p-4">
                    <p className="font-bold text-sm mb-2">One-time setup (≈3 min):</p>
                    <ol className="text-xs text-gray-700 list-decimal ml-4 space-y-1 mb-3">
                      <li>Open your Google Sheet → <b>Extensions → Apps Script</b></li>
                      <li>Delete any code, paste the code below, click <b>Save</b></li>
                      <li><b>Deploy → New deployment → Web app</b></li>
                      <li>Execute as: <b>Me</b>; Who has access: <b>Anyone</b> → <b>Deploy</b></li>
                      <li>Copy the <b>Web app URL</b> (ends with <code>/exec</code>) and paste it above → Save</li>
                    </ol>
                    <textarea
                      readOnly
                      onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                      className="w-full h-44 p-2 font-mono text-[11px] border rounded bg-white"
                      value={`function doPost(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Members') || ss.getActiveSheet();
  var d = JSON.parse(e.postData.contents);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Membership ID','Name','Email','Phone','Plan','Slot','Amount','Payment Status','UTR','Start Date','Created At']);
  }
  // update existing row if same Membership ID, else append
  var ids = sheet.getRange(1,1,Math.max(sheet.getLastRow(),1),1).getValues().map(function(r){return r[0];});
  var row = [d.id,d.fullName,d.email,d.phone,d.plan,d.slot,d.amount,d.paymentStatus,d.paymentUTR,d.startDate,d.createdAt];
  var at = ids.indexOf(d.id);
  if (at > 0) { sheet.getRange(at+1,1,1,row.length).setValues([row]); }
  else { sheet.appendRow(row); }
  return ContentService.createTextOutput('ok');
}`}
                    />
                    <p className="text-xs text-gray-500 mt-1">Tip: name a tab “Members” in your sheet (optional).</p>
                  </div>
                </div>
              </div>
            )}

            {selectedMembers.size > 0 && (
              <div className="mb-6 p-4 bg-blue-50 border-2 border-blue-300 rounded-lg flex justify-between items-center">
                <span className="font-bold text-blue-700">{selectedMembers.size} member(s) selected</span>
                <button
                  onClick={async () => {
                    if (confirm(`🗑️ Delete ${selectedMembers.size} members? This cannot be undone!`)) {
                      try {
                        let deletedCount = 0;
                        for (const memberId of selectedMembers) {
                          const member = members.find(m => m.id === memberId);
                          if (member?.docId) {
                            await updateDoc(doc(db, 'members', member.docId), {
                              deleted: true,
                              deletedAt: new Date().toISOString(),
                              deletedBy: 'admin'
                            });
                            deletedCount++;
                          }
                        }
                        setSelectedMembers(new Set());
                        showToast(`${deletedCount} member(s) deleted successfully`, "success");
                      } catch (error) {
                        logError('Error bulk deleting members:', error);
                        showToast('Error deleting members. Please try again.', "error");
                      }
                    }
                  }}
                  className="px-6 py-2 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700"
                >
                  🗑️ Delete Selected
                </button>
              </div>
            )}

            {/* Status filter chips — find anyone, any time */}
            <div className="mb-5 flex flex-wrap gap-2">
              {filterChips.map(c => (
                <button
                  key={c.key}
                  onClick={() => setMemberFilter(c.key as any)}
                  className={`px-3 py-2 rounded-full text-sm font-semibold border-2 transition active:scale-95 ${
                    memberFilter === c.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-200 hover:border-blue-300'
                  }`}
                >
                  {c.label} <span className={memberFilter === c.key ? 'text-blue-100' : 'text-gray-400'}>{c.count}</span>
                </button>
              ))}
            </div>

            {filtered.length === 0 ? (
              <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
                <p className="text-2xl mb-2">📭</p>
                <p className="font-semibold">{members.length === 0 ? 'No members yet' : 'Nothing in this list'}</p>
                <p className="text-sm text-gray-400 mt-1">{searchQuery ? 'Try a different search' : 'Members will appear here'}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filtered.map(member => {
                  const days = d2e(member);
                  const expText = member.paymentStatus === 'verified' && days !== null
                    ? (days < 0 ? `🔴 Expired ${-days}d ago` : days <= 7 ? `⏰ Expires in ${days}d` : `Valid · ${days}d left`)
                    : null;
                  return (
                    <div key={member.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="min-w-0">
                          <button
                            onClick={() => navigate(`/admin/members?detail=${member.docId}`)}
                            className="font-bold text-blue-700 hover:underline text-left text-lg leading-tight"
                          >
                            {member.fullName}
                          </button>
                          <p className="text-xs text-gray-500 font-mono mt-0.5">{member.id} · {member.plan}{member.slot ? ' · ' + member.slot : ''}</p>
                          <p className="text-xs text-gray-500 mt-0.5">📞 {member.phone}{expText ? '   ·   ' + expText : ''}</p>
                        </div>
                        <span className={`px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap ${
                          !member.membershipId ? 'bg-purple-100 text-purple-700' :
                          member.paymentStatus === 'verified' ? 'bg-green-100 text-green-800' :
                          member.paymentStatus === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-red-100 text-red-800'
                        }`}>
                          {!member.membershipId ? '🆕 Approve' :
                           member.paymentStatus === 'verified' ? '✅ Verified' :
                           member.paymentStatus === 'pending' ? '⏳ Pending' : '❌ Rejected'}
                        </span>
                      </div>
                      {member.adminNote && (
                        <div className="mb-3 text-sm bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-lg px-3 py-2">📝 {member.adminNote}</div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {!member.membershipId && (
                          <button onClick={() => acceptMember(member)} className="px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700 active:scale-95 transition">✅ Accept</button>
                        )}
                        {member.paymentStatus === 'pending' && (
                          <button onClick={() => verifyPaymentQuick(member)} className="px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700 active:scale-95 transition">💰 Verify</button>
                        )}
                        {member.paymentStatus === 'verified' && (
                          <button onClick={() => sendRenewalReminder(member)} className="px-3 py-2 bg-amber-500 text-white rounded-lg text-sm font-bold hover:bg-amber-600 active:scale-95 transition">⏰ Reminder</button>
                        )}
                        <button onClick={() => navigate(`/admin/members?detail=${member.docId}`)} title="See full profile + payment proof" className="px-3 py-2 bg-indigo-100 text-indigo-700 rounded-lg text-sm font-bold hover:bg-indigo-200 active:scale-95 transition">🧾 Proof</button>
                        <button onClick={() => sendWelcome(member)} title="Send WhatsApp message" className="px-3 py-2 bg-emerald-500 text-white rounded-lg text-sm font-bold hover:bg-emerald-600 active:scale-95 transition">💬 WhatsApp</button>
                        <button onClick={() => editMemberNote(member)} title="Add/edit a private note" className="px-3 py-2 bg-yellow-100 text-yellow-800 rounded-lg text-sm font-bold hover:bg-yellow-200 active:scale-95 transition">📝 Note</button>
                        <button onClick={() => { setEditingMember(member); setEditFormData({ ...member }); }} className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-bold hover:bg-gray-200 active:scale-95 transition">✏️ Edit</button>
                        <button
                          onClick={async () => {
                            if (!(await confirmDialog(`Delete ${member.fullName}? This cannot be undone.`, { danger: true, confirmText: 'Delete' }))) return;
                            try {
                              await updateDoc(doc(db, 'members', member.docId), { deleted: true, deletedAt: new Date().toISOString(), deletedBy: 'admin' });
                              showToast(`${member.fullName} deleted`);
                            } catch (error) {
                              logError('Error deleting member:', error);
                              showToast('Could not delete. Please try again.', 'error');
                            }
                          }}
                          className="px-3 py-2 bg-red-50 text-red-600 rounded-lg text-sm font-bold hover:bg-red-100 active:scale-95 transition"
                        >🗑️</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <button
              onClick={() => goBackAdmin()}
              className="mt-6 px-6 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700"
            >
              ← Back
            </button>

            {/* Member Detail Modal - COMPLETE PROFILE */}
            {selectedMemberDetail && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 overflow-y-auto">
                <div className="bg-white rounded-lg p-8 max-w-2xl w-full my-8">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-6 pb-4 border-b-2">
                    <div>
                      <h2 className="text-3xl font-bold text-gray-900">{selectedMemberDetail.fullName || 'Member'}</h2>
                      <p className="text-sm text-gray-500 mt-1">ID: {selectedMemberDetail.id || 'N/A'}</p>
                    </div>
                    <button
                      onClick={() => setSelectedMemberDetail(null)}
                      className="text-3xl text-gray-400 hover:text-gray-600"
                    >
                      ×
                    </button>
                  </div>

                  {/* Tabs-like sections */}
                  <div className="space-y-6 max-h-96 overflow-y-auto pr-4">
                    {/* 1. PERSONAL INFORMATION */}
                    <div className="bg-blue-50 p-4 rounded-lg border-l-4 border-blue-500">
                      <h3 className="font-bold text-lg mb-3 text-blue-900">📋 Personal Information</h3>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-xs text-gray-600">Full Name</p>
                          <p className="font-semibold">{selectedMemberDetail.fullName}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-600">Date of Birth</p>
                          <p className="font-semibold">{selectedMemberDetail.dateOfBirth ? new Date(selectedMemberDetail.dateOfBirth).toLocaleDateString('en-IN') : 'N/A'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-600">Gender</p>
                          <p className="font-semibold">{selectedMemberDetail.gender || 'N/A'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-600">Email</p>
                          <p className="font-semibold text-sm break-all">{selectedMemberDetail.email}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-600">Phone</p>
                          <p className="font-semibold">{selectedMemberDetail.phone}</p>
                        </div>
                      </div>
                    </div>

                    {/* 2. ADDRESS */}
                    <div className="bg-green-50 p-4 rounded-lg border-l-4 border-green-500">
                      <h3 className="font-bold text-lg mb-3 text-green-900">🏠 Address</h3>
                      <div className="space-y-4">
                        <div>
                          <p className="text-xs text-gray-600 font-bold mb-2">Temporary Address</p>
                          <div className="space-y-1 bg-white p-3 rounded border border-green-200">
                            <p className="text-xs"><span className="font-bold">Street:</span> {selectedMemberDetail.tempStreet || 'N/A'}</p>
                            <p className="text-xs"><span className="font-bold">City:</span> {selectedMemberDetail.tempCity || 'N/A'}</p>
                            <p className="text-xs"><span className="font-bold">State:</span> {selectedMemberDetail.tempState || 'N/A'}</p>
                            <p className="text-xs"><span className="font-bold">Pin Code:</span> {selectedMemberDetail.tempPincode || 'N/A'}</p>
                          </div>
                        </div>
                        <div>
                          <p className="text-xs text-gray-600 font-bold mb-2">Permanent Address</p>
                          <div className="space-y-1 bg-white p-3 rounded border border-green-200">
                            <p className="text-xs"><span className="font-bold">Street:</span> {selectedMemberDetail.permStreet || 'N/A'}</p>
                            <p className="text-xs"><span className="font-bold">City:</span> {selectedMemberDetail.permCity || 'N/A'}</p>
                            <p className="text-xs"><span className="font-bold">State:</span> {selectedMemberDetail.permState || 'N/A'}</p>
                            <p className="text-xs"><span className="font-bold">Pin Code:</span> {selectedMemberDetail.permPincode || 'N/A'}</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 3. EDUCATION */}
                    <div className="bg-purple-50 p-4 rounded-lg border-l-4 border-purple-500">
                      <h3 className="font-bold text-lg mb-3 text-purple-900">🎓 Education</h3>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-xs text-gray-600">Current Class</p>
                          <p className="font-semibold">{selectedMemberDetail.currentClass || 'N/A'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-600">School/College</p>
                          <p className="font-semibold">{selectedMemberDetail.schoolCollege || 'N/A'}</p>
                        </div>
                        <div className="col-span-2">
                          <p className="text-xs text-gray-600">Target Exam</p>
                          <p className="font-semibold">{selectedMemberDetail.targetExam || 'N/A'}</p>
                        </div>
                      </div>
                    </div>

                    {/* 4. EMERGENCY CONTACT */}
                    <div className="bg-red-50 p-4 rounded-lg border-l-4 border-red-500">
                      <h3 className="font-bold text-lg mb-3 text-red-900">🆘 Emergency Contact</h3>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2">
                          <p className="text-xs text-gray-600">Contact Person</p>
                          <p className="font-semibold">{selectedMemberDetail.emergencyContactName || 'N/A'}</p>
                        </div>
                        <div className="col-span-2">
                          <p className="text-xs text-gray-600">Phone</p>
                          <p className="font-semibold">{selectedMemberDetail.emergencyContactPhone || 'N/A'}</p>
                        </div>
                      </div>
                    </div>

                    {/* 5. MEMBERSHIP DETAILS */}
                    <div className="bg-yellow-50 p-4 rounded-lg border-l-4 border-yellow-500">
                      <h3 className="font-bold text-lg mb-3 text-yellow-900">🎫 Membership Details</h3>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-xs text-gray-600">Member ID</p>
                          <p className="font-semibold text-blue-600">{selectedMemberDetail.id}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-600">Plan</p>
                          <p className="font-semibold">{selectedMemberDetail.plan || 'N/A'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-600">Time Slot</p>
                          <p className="font-semibold">{selectedMemberDetail.slot || 'N/A'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-600">Start Date</p>
                          <p className="font-semibold">{selectedMemberDetail.startDate ? new Date(selectedMemberDetail.startDate).toLocaleDateString('en-IN') : 'N/A'}</p>
                        </div>
                      </div>
                    </div>

                    {/* 6. PAYMENT DETAILS */}
                    <div className="bg-indigo-50 p-4 rounded-lg border-l-4 border-indigo-500">
                      <h3 className="font-bold text-lg mb-4 text-indigo-900">💳 Payment Details</h3>

                      {/* Top Row: Amount & Status */}
                      <div className="grid grid-cols-2 gap-3 mb-3 pb-3 border-b">
                        <div>
                          <p className="text-xs text-gray-600">Amount Paid</p>
                          <p className="font-bold text-2xl text-green-600">₹{selectedMemberDetail.amount || 0}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-600">Payment Status</p>
                          <span className={`inline-block px-3 py-2 rounded-full text-sm font-bold ${
                            selectedMemberDetail.paymentStatus === 'verified'
                              ? 'bg-green-200 text-green-800'
                              : selectedMemberDetail.paymentStatus === 'pending'
                              ? 'bg-yellow-200 text-yellow-800'
                              : 'bg-red-200 text-red-800'
                          }`}>
                            {selectedMemberDetail.paymentStatus === 'verified' ? '✅ Verified' :
                             selectedMemberDetail.paymentStatus === 'pending' ? '⏳ Pending' :
                             '❌ Rejected'}
                          </span>
                        </div>
                      </div>

                      {/* Middle Row: Method & UTR */}
                      <div className="grid grid-cols-2 gap-3 mb-4 pb-4 border-b">
                        <div>
                          <p className="text-xs text-gray-600">Payment Method</p>
                          <p className="font-semibold text-base">{selectedMemberDetail.paymentMethod === 'upi' ? '📱 UPI' : '💵 Cash'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-600">UTR / Reference ID</p>
                          <p className="font-semibold text-base">{selectedMemberDetail.paymentUTR || selectedMemberDetail.utrNumber || '—'}</p>
                        </div>
                      </div>

                      {/* Payment Screenshot - Full Width */}
                      {selectedMemberDetail.upiScreenshot && selectedMemberDetail.paymentMethod === 'upi' ? (
                        <div>
                          <p className="text-xs text-gray-600 font-bold mb-3">📸 Payment Proof Screenshot</p>
                          <div className="bg-white p-2 rounded-lg border-2 border-indigo-300">
                            <img
                              src={selectedMemberDetail.upiScreenshot}
                              alt="Payment proof"
                              className="w-full max-h-64 object-contain rounded cursor-pointer hover:opacity-90 transition"
                              onClick={() => window.open(selectedMemberDetail.upiScreenshot, '_blank')}
                            />
                          </div>
                          <p className="text-xs text-gray-500 mt-2">📌 Click to view full size</p>
                        </div>
                      ) : selectedMemberDetail.paymentMethod === 'upi' ? (
                        <div className="bg-white p-4 rounded-lg border-2 border-yellow-300 text-center">
                          <p className="text-sm text-gray-600">📸 No payment screenshot uploaded</p>
                        </div>
                      ) : (
                        <div className="bg-white p-4 rounded-lg border-2 border-green-300 text-center">
                          <p className="text-sm text-gray-600">💵 Cash payment - No screenshot required</p>
                        </div>
                      )}
                    </div>

                    {/* 7. REFERRAL & OTHER */}
                    <div className="bg-gray-50 p-4 rounded-lg border-l-4 border-gray-400">
                      <h3 className="font-bold text-lg mb-3">ℹ️ Additional Info</h3>
                      <div className="space-y-2">
                        <div>
                          <p className="text-xs text-gray-600">Referral Source</p>
                          <p className="font-semibold">{selectedMemberDetail.referralSource || 'N/A'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-600">Joined On</p>
                          <p className="font-semibold">{selectedMemberDetail.createdAt ? new Date(selectedMemberDetail.createdAt).toLocaleDateString('en-IN') : 'N/A'}</p>
                        </div>
                      </div>
                    </div>

                    {/* 8. QR CODE */}
                    <div className="bg-blue-50 p-4 rounded-lg text-center border-l-4 border-blue-500">
                      <p className="text-sm font-bold text-blue-900 mb-3">📱 Member QR Code</p>
                      <div className="bg-white p-3 rounded inline-block border-2 border-blue-200">
                        <div className="w-32 h-32 bg-gradient-to-br from-blue-100 to-blue-200 rounded flex items-center justify-center">
                          <div className="text-center">
                            <div className="text-3xl">📱</div>
                            <div className="text-xs text-gray-600 mt-1">QR Code</div>
                            <div className="text-xs font-bold">{selectedMemberDetail.id}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 mt-6 pt-4 border-t sticky bottom-0 bg-white">
                    <button
                      onClick={async () => {
                        try {
                          const pdf = new jsPDF();
                          const pageWidth = pdf.internal.pageSize.getWidth();
                          const pageHeight = pdf.internal.pageSize.getHeight();
                          let yPos = 15;

                          // Header
                          pdf.setFontSize(20);
                          pdf.setTextColor(59, 130, 246);
                          pdf.text('📚 Achievers Library', pageWidth / 2, yPos, { align: 'center' });
                          yPos += 10;

                          pdf.setFontSize(14);
                          pdf.setTextColor(31, 41, 55);
                          pdf.text('Member Profile & Details', pageWidth / 2, yPos, { align: 'center' });
                          yPos += 15;

                          pdf.setFontSize(11);
                          pdf.setLineWidth(0.5);
                          pdf.line(15, yPos, pageWidth - 15, yPos);
                          yPos += 8;

                          // All member details (structured address)
                          const details = [
                            ['Name', selectedMemberDetail.fullName],
                            ['Member ID', selectedMemberDetail.id],
                            ['Email', selectedMemberDetail.email],
                            ['Phone', selectedMemberDetail.phone],
                            ['DOB', selectedMemberDetail.dateOfBirth ? new Date(selectedMemberDetail.dateOfBirth).toLocaleDateString('en-IN') : 'N/A'],
                            ['Gender', selectedMemberDetail.gender || 'N/A'],
                            ['Current Class', selectedMemberDetail.currentClass || 'N/A'],
                            ['Target Exam', selectedMemberDetail.targetExam || 'N/A'],
                            ['School/College', selectedMemberDetail.schoolCollege || 'N/A'],
                            ['Temp Address - Street', selectedMemberDetail.tempStreet || 'N/A'],
                            ['Temp Address - City', selectedMemberDetail.tempCity || 'N/A'],
                            ['Temp Address - State', selectedMemberDetail.tempState || 'N/A'],
                            ['Temp Address - Pin Code', selectedMemberDetail.tempPincode || 'N/A'],
                            ['Perm Address - Street', selectedMemberDetail.permStreet || 'N/A'],
                            ['Perm Address - City', selectedMemberDetail.permCity || 'N/A'],
                            ['Perm Address - State', selectedMemberDetail.permState || 'N/A'],
                            ['Perm Address - Pin Code', selectedMemberDetail.permPincode || 'N/A'],
                            ['Emergency Contact', selectedMemberDetail.emergencyContactName || 'N/A'],
                            ['Emergency Phone', selectedMemberDetail.emergencyContactPhone || 'N/A'],
                            ['Plan', selectedMemberDetail.plan || 'N/A'],
                            ['Time Slot', selectedMemberDetail.slot || 'N/A'],
                            ['Start Date', selectedMemberDetail.startDate ? new Date(selectedMemberDetail.startDate).toLocaleDateString('en-IN') : 'N/A'],
                            ['Amount Paid', `₹${selectedMemberDetail.amount || 0}`],
                            ['Payment Method', selectedMemberDetail.paymentMethod === 'upi' ? 'UPI' : 'Cash'],
                            ['Payment Status', selectedMemberDetail.paymentStatus || 'Pending'],
                            ['UTR/Reference', selectedMemberDetail.paymentUTR || selectedMemberDetail.utrNumber || 'N/A'],
                            ['Referral Source', selectedMemberDetail.referralSource || 'N/A'],
                          ];

                          details.forEach(([label, value]) => {
                            pdf.setFont(undefined, 'bold');
                            pdf.setTextColor(31, 41, 55);
                            pdf.text(`${label}:`, 15, yPos);

                            pdf.setFont(undefined, 'normal');
                            pdf.setTextColor(107, 114, 128);
                            const text = String(value);
                            const splitText = pdf.splitTextToSize(text, pageWidth - 80);
                            pdf.text(splitText, 70, yPos);
                            yPos += 5 + (splitText.length - 1) * 4;

                            if (yPos > pageHeight - 30) {
                              pdf.addPage();
                              yPos = 15;
                            }
                          });

                          yPos += 5;
                          pdf.setLineWidth(0.5);
                          pdf.line(15, yPos, pageWidth - 15, yPos);
                          yPos += 10;

                          pdf.setFontSize(10);
                          pdf.setTextColor(156, 163, 175);
                          pdf.text('Generated on: ' + new Date().toLocaleDateString('en-IN') + ' ' + new Date().toLocaleTimeString('en-IN'), pageWidth / 2, pageHeight - 10, { align: 'center' });

                          pdf.save(`${selectedMemberDetail.fullName}_Complete_Profile.pdf`);
                          showToast(`PDF downloaded successfully`, "success");
                        } catch (error) {
                          logError('Error generating PDF:', error);
                          showToast('Error downloading PDF', "error");
                        }
                      }}
                      className="flex-1 px-4 py-3 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700"
                    >
                      📥 Download PDF
                    </button>
                    <button
                      onClick={() => setSelectedMemberDetail(null)}
                      className="flex-1 px-4 py-3 bg-gray-600 text-white font-bold rounded-lg hover:bg-gray-700"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Edit Member Modal */}
            {editingMember && editFormData && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                <div className="bg-white rounded-lg p-8 max-w-2xl w-full max-h-screen overflow-y-auto">
                  <h2 className="text-2xl font-bold mb-6">Edit Member: {editingMember.fullName}</h2>

                  <div className="space-y-4">
                    {/* Personal Info */}
                    <div className="bg-blue-50 p-3 rounded-lg border-l-4 border-blue-500">
                      <h3 className="font-bold text-blue-900 mb-3">Personal Information</h3>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2">
                          <label className="block text-sm font-bold text-gray-700 mb-1">Full Name</label>
                          <input type="text" value={editFormData.fullName || ''} onChange={(e) => setEditFormData(prev => ({...prev, fullName: e.target.value}))} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-600 outline-none text-sm" />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">Date of Birth</label>
                          <input type="date" value={editFormData.dateOfBirth || ''} onChange={(e) => setEditFormData(prev => ({...prev, dateOfBirth: e.target.value}))} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">Gender</label>
                          <select value={editFormData.gender || ''} onChange={(e) => setEditFormData(prev => ({...prev, gender: e.target.value}))} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm">
                            <option value="">Select</option>
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                            <option value="Other">Other</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">Email</label>
                          <input type="email" value={editFormData.email || ''} onChange={(e) => setEditFormData(prev => ({...prev, email: e.target.value}))} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">Phone</label>
                          <input type="tel" value={editFormData.phone || ''} onChange={(e) => {
                            const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 10);
                            setEditFormData(prev => ({...prev, phone: val}));
                          }} maxLength="10" className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                        </div>
                      </div>
                    </div>

                    {/* Address - Structured */}
                    <div className="bg-green-50 p-3 rounded-lg border-l-4 border-green-500">
                      <h3 className="font-bold text-green-900 mb-3">Temporary Address</h3>
                      <div className="grid grid-cols-2 gap-2 mb-4">
                        <div className="col-span-2">
                          <label className="block text-sm font-bold text-gray-700 mb-1">Street Address</label>
                          <input type="text" value={editFormData.tempStreet || ''} onChange={(e) => setEditFormData(prev => ({...prev, tempStreet: e.target.value}))} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">City</label>
                          <input type="text" value={editFormData.tempCity || ''} onChange={(e) => {
                            const val = e.target.value.replace(/[^a-zA-Z\s]/g, '');
                            setEditFormData(prev => ({...prev, tempCity: val}));
                          }} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">State</label>
                          <input type="text" value={editFormData.tempState || ''} onChange={(e) => {
                            const val = e.target.value.replace(/[^a-zA-Z\s]/g, '');
                            setEditFormData(prev => ({...prev, tempState: val}));
                          }} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-sm font-bold text-gray-700 mb-1">Pin Code</label>
                          <input type="text" value={editFormData.tempPincode || ''} onChange={(e) => {
                          const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
                          setEditFormData(prev => ({...prev, tempPincode: val}));
                        }} maxLength="6" className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                        </div>
                      </div>

                      <h3 className="font-bold text-green-900 mb-3">Permanent Address</h3>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="col-span-2">
                          <label className="block text-sm font-bold text-gray-700 mb-1">Street Address</label>
                          <input type="text" value={editFormData.permStreet || ''} onChange={(e) => setEditFormData(prev => ({...prev, permStreet: e.target.value}))} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">City</label>
                          <input type="text" value={editFormData.permCity || ''} onChange={(e) => {
                            const val = e.target.value.replace(/[^a-zA-Z\s]/g, '');
                            setEditFormData(prev => ({...prev, permCity: val}));
                          }} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">State</label>
                          <input type="text" value={editFormData.permState || ''} onChange={(e) => {
                            const val = e.target.value.replace(/[^a-zA-Z\s]/g, '');
                            setEditFormData(prev => ({...prev, permState: val}));
                          }} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-sm font-bold text-gray-700 mb-1">Pin Code</label>
                          <input type="text" value={editFormData.permPincode || ''} onChange={(e) => {
                          const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
                          setEditFormData(prev => ({...prev, permPincode: val}));
                        }} maxLength="6" className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                        </div>
                      </div>
                    </div>

                    {/* Education */}
                    <div className="bg-purple-50 p-3 rounded-lg border-l-4 border-purple-500">
                      <h3 className="font-bold text-purple-900 mb-3">Education</h3>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">Current Class</label>
                          <input type="text" value={editFormData.currentClass || ''} onChange={(e) => setEditFormData(prev => ({...prev, currentClass: e.target.value}))} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">School/College</label>
                          <input type="text" value={editFormData.schoolCollege || ''} onChange={(e) => setEditFormData(prev => ({...prev, schoolCollege: e.target.value}))} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-sm font-bold text-gray-700 mb-1">Target Exam</label>
                          <input type="text" value={editFormData.targetExam || ''} onChange={(e) => setEditFormData(prev => ({...prev, targetExam: e.target.value}))} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                        </div>
                      </div>
                    </div>

                    {/* Emergency Contact */}
                    <div className="bg-red-50 p-3 rounded-lg border-l-4 border-red-500">
                      <h3 className="font-bold text-red-900 mb-3">Emergency Contact</h3>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2">
                          <label className="block text-sm font-bold text-gray-700 mb-1">Contact Person Name</label>
                          <input type="text" value={editFormData.emergencyContactName || ''} onChange={(e) => setEditFormData(prev => ({...prev, emergencyContactName: e.target.value}))} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-sm font-bold text-gray-700 mb-1">Contact Phone</label>
                          <input type="tel" value={editFormData.emergencyContactPhone || ''} onChange={(e) => {
                            const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 10);
                            setEditFormData(prev => ({...prev, emergencyContactPhone: val}));
                          }} maxLength="10" className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                        </div>
                      </div>
                    </div>

                    {/* Membership */}
                    <div className="bg-yellow-50 p-3 rounded-lg border-l-4 border-yellow-500">
                      <h3 className="font-bold text-yellow-900 mb-3">Membership & Payment</h3>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">Plan</label>
                          <select value={editFormData.plan || ''} onChange={(e) => setEditFormData(prev => ({...prev, plan: e.target.value}))} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm">
                            <option value="">Select</option>
                            <option value="Monthly Half-day">Monthly Half-day</option>
                            <option value="Monthly Full-day">Monthly Full-day</option>
                            <option value="Quarterly Half-day">Quarterly Half-day</option>
                            <option value="Quarterly Full-day">Quarterly Full-day</option>
                            <option value="Half-yearly Half-day">Half-yearly Half-day</option>
                            <option value="Half-yearly Full-day">Half-yearly Full-day</option>
                            <option value="Yearly Half-day">Yearly Half-day</option>
                            <option value="Yearly Full-day">Yearly Full-day</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">Time Slot</label>
                          <select value={editFormData.slot || ''} onChange={(e) => setEditFormData(prev => ({...prev, slot: e.target.value}))} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm">
                            <option value="">Select</option>
                            <option value="9am-3pm">9am - 3pm</option>
                            <option value="3pm-9pm">3pm - 9pm</option>
                            <option value="9am-9pm">9am - 9pm (Full)</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">Payment Method</label>
                          <select value={editFormData.paymentMethod || 'upi'} onChange={(e) => setEditFormData(prev => ({...prev, paymentMethod: e.target.value}))} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm">
                            <option value="upi">UPI</option>
                            <option value="cash">Cash</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">Amount Paid (₹)</label>
                          <input type="number" value={editFormData.amount || 0} onChange={(e) => setEditFormData(prev => ({...prev, amount: Number(e.target.value)}))} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">Payment Status</label>
                          <select value={editFormData.paymentStatus || 'pending'} onChange={(e) => setEditFormData(prev => ({...prev, paymentStatus: e.target.value}))} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm">
                            <option value="pending">⏳ Pending</option>
                            <option value="verified">✅ Verified</option>
                            <option value="rejected">❌ Rejected</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">UTR/Reference ID</label>
                          <input type="text" value={editFormData.paymentUTR ?? editFormData.utrNumber ?? ''} onChange={(e) => setEditFormData(prev => ({...prev, paymentUTR: e.target.value}))} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                        </div>
                      </div>
                    </div>

                    {/* Other Info */}
                    <div className="bg-gray-50 p-3 rounded-lg border-l-4 border-gray-400">
                      <h3 className="font-bold text-gray-900 mb-3">Other Information</h3>
                      <div className="space-y-2">
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">Referral Source</label>
                          <input type="text" value={editFormData.referralSource || ''} onChange={(e) => setEditFormData(prev => ({...prev, referralSource: e.target.value}))} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">Admin Notes</label>
                          <textarea value={editFormData.notes || ''} onChange={(e) => setEditFormData(prev => ({...prev, notes: e.target.value}))} placeholder="Add any admin notes..." className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" rows={2} />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-3 mt-6">
                    <button
                      onClick={() => {
                        setEditingMember(null);
                        setEditFormData(null);
                      }}
                      className="flex-1 py-3 border-2 border-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={async () => {
                        // Validation
                        if (!editFormData.fullName.trim()) {
                          showToast('Full name is required', "error");
                          return;
                        }
                        const emailRegex = /^[a-zA-Z0-9._%-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
                        if (!editFormData.email.trim() || !emailRegex.test(editFormData.email.trim())) {
                          showToast('Valid email is required', "error");
                          return;
                        }
                        // Check if email is already taken (by another member)
                        const newEmail = editFormData.email.toLowerCase();
                        if (newEmail !== (editingMember.email || '').toLowerCase()) {
                          const emailExists = members.some(m => m.id !== editingMember.id && (m.email || '').toLowerCase() === newEmail);
                          if (emailExists) {
                            showToast('This email is already registered', "error");
                            return;
                          }
                        }
                        const phoneRegex = /^[0-9]{10}$/;
                        if (!phoneRegex.test(editFormData.phone)) {
                          showToast('Phone must be 10 digits', "error");
                          return;
                        }
                        // Check if phone is already taken (by another member)
                        if (editFormData.phone !== editingMember.phone) {
                          const phoneExists = members.some(m => m.id !== editingMember.id && m.phone === editFormData.phone);
                          if (phoneExists) {
                            showToast('This phone number is already registered', "error");
                            return;
                          }
                        }
                        if (!editFormData.emergencyContactName.trim()) {
                          showToast('Emergency contact name is required', "error");
                          return;
                        }
                        if (!phoneRegex.test(editFormData.emergencyContactPhone)) {
                          showToast('Emergency contact phone must be 10 digits', "error");
                          return;
                        }
                        if (!editFormData.tempStreet.trim() || !editFormData.tempCity.trim() || !editFormData.tempState.trim() || !editFormData.tempPincode.trim()) {
                          showToast('Temporary address fields are required', "error");
                          return;
                        }
                        if (!editFormData.plan) {
                          showToast('Plan is required', "error");
                          return;
                        }
                        if (!editFormData.slot) {
                          showToast('Time slot is required', "error");
                          return;
                        }
                        // A payment can't be 'verified' without a real amount — keep
                        // this consistent with the payment-review state machine.
                        if (editFormData.paymentStatus === 'verified' && (!Number(editFormData.amount) || Number(editFormData.amount) <= 0)) {
                          showToast('Cannot mark payment "verified" with amount ₹0. Set a valid amount first.', "error");
                          return;
                        }

                        if (!(await confirmDialog(`Save changes for ${editFormData.fullName}?`, { confirmText: 'Save' }))) {
                          return;
                        }

                        setIsSavingMember(true);
                        try {
                          // Sanitize data before saving
                          const sanitizedData = {
                            ...editFormData,
                            fullName: sanitizeInput(editFormData.fullName),
                            email: sanitizeInput(editFormData.email.toLowerCase()),
                            schoolCollege: sanitizeInput(editFormData.schoolCollege),
                            emergencyContactName: sanitizeInput(editFormData.emergencyContactName),
                            tempStreet: sanitizeInput(editFormData.tempStreet),
                            tempCity: sanitizeInput(editFormData.tempCity),
                            tempState: sanitizeInput(editFormData.tempState),
                            permStreet: sanitizeInput(editFormData.permStreet),
                            permCity: sanitizeInput(editFormData.permCity),
                            permState: sanitizeInput(editFormData.permState),
                          };
                          // Update Firestore if docId exists
                          if (editingMember?.docId) {
                            const memberRef = doc(db, 'members', editingMember.docId);
                            await updateDoc(memberRef, sanitizedData);
                            log('✅ Firestore updated:', editFormData.fullName, 'Status:', editFormData.paymentStatus);

                            // Don't update local state - let real-time listener handle it
                            // This prevents race conditions where listener overwrites our update
                            setEditingMember(null);
                            setEditFormData(null);
                            showToast(`${editFormData.fullName} updated successfully!`, "success");
                          }
                        } catch (error) {
                          logError('Error updating member:', error);
                          showToast('Error saving changes. Please try again.', "error");
                        } finally {
                          setIsSavingMember(false);
                        }
                      }}
                      disabled={isSavingMember}
                      className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSavingMember ? '⏳ Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      );
    }

    // Payments Page
    if ((adminPage as string) === 'payments') {
      const pending = members.filter(m => m.paymentStatus === 'pending');

      return (
        <div className="min-h-screen bg-gray-50">
          <header className="sticky top-0 z-40 bg-white shadow">
            <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <button onClick={() => goBackAdmin()} className="text-2xl">←</button>
                <div className="text-2xl font-bold text-blue-600">💳 Payment Verification</div>
              </div>
              <button
                onClick={() => { signOut(auth).catch(() => {}); setIsAdmin(false); setAdminPage('dashboard'); navigate('/'); }}
                className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 font-semibold text-sm"
              >
                Logout
              </button>
            </div>
          </header>

          <div className="max-w-6xl mx-auto p-8">
            <div className="bg-white rounded-lg shadow p-6 mb-8">
              <h2 className="text-2xl font-bold mb-4">Pending Payments ({pending.length})</h2>

              {pending.length === 0 ? (
                <p className="text-gray-500 text-lg">All payments verified! ✅</p>
              ) : (
                <div className="space-y-4">
                  {pending.map(member => (
                    <div key={member.id} className="border border-orange-200 p-6 rounded-lg bg-orange-50">
                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                          <p className="text-gray-600">Name</p>
                          <p className="text-lg font-bold">{member.fullName}</p>
                        </div>
                        <div>
                          <p className="text-gray-600">Amount</p>
                          <p className="text-lg font-bold text-blue-600">₹{member.amount || 700}</p>
                        </div>
                        <div>
                          <p className="text-gray-600">Phone</p>
                          <p className="text-lg font-bold">{member.phone}</p>
                        </div>
                        <div>
                          <p className="text-gray-600">Plan</p>
                          <p className="text-lg font-bold">{member.plan}</p>
                        </div>
                        <div>
                          <p className="text-gray-600">Payment Method</p>
                          <p className="text-lg font-bold">{member.paymentMethod || 'UPI'}</p>
                        </div>
                        <div>
                          <p className="text-gray-600">UTR/Ref ID</p>
                          <p className="text-lg font-bold text-gray-700">{member.paymentUTR || member.utrNumber || 'Not provided'}</p>
                        </div>
                      </div>

                      <div className="flex gap-3">
                        <button
                          onClick={() => setSelectedPaymentForReview(member)}
                          className="flex-1 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700"
                        >
                          👁️ Review Proof
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`✅ Verify payment of ₹${member.amount} for ${member.fullName}?`)) {
                              updateMemberPayment(member.id, 'verified');
                              setPaymentReviewNotes('');
                            }
                          }}
                          className="flex-1 py-2 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700"
                        >
                          ✓ Verify
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`❌ Reject payment of ₹${member.amount} for ${member.fullName}?`)) {
                              updateMemberPayment(member.id, 'rejected');
                            }
                          }}
                          className="flex-1 py-2 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700"
                        >
                          ✗ Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={() => navigate('/admin/dashboard')}
              className="px-6 py-3 bg-blue-600 text-white font-bold rounded-lg"
            >
              Back to Dashboard
            </button>
          </div>

          {/* Payment Review Modal */}
          {selectedPaymentForReview && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-lg p-8 max-w-2xl w-full max-h-screen overflow-y-auto">
                <h2 className="text-2xl font-bold mb-6">Payment Review</h2>

                {/* Payment Details */}
                <div className="bg-gray-50 p-4 rounded-lg mb-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-gray-600 text-sm">Member Name</p>
                      <p className="text-lg font-bold">{selectedPaymentForReview.fullName}</p>
                    </div>
                    <div>
                      <p className="text-gray-600 text-sm">Amount</p>
                      <p className="text-lg font-bold text-blue-600">₹{selectedPaymentForReview.amount}</p>
                    </div>
                    <div>
                      <p className="text-gray-600 text-sm">Phone</p>
                      <p className="text-lg font-bold">{selectedPaymentForReview.phone}</p>
                    </div>
                    <div>
                      <p className="text-gray-600 text-sm">Plan</p>
                      <p className="text-lg font-bold">{selectedPaymentForReview.plan}</p>
                    </div>
                    <div>
                      <p className="text-gray-600 text-sm">Payment Method</p>
                      <p className="text-lg font-bold">{selectedPaymentForReview.paymentMethod || 'UPI'}</p>
                    </div>
                    <div>
                      <p className="text-gray-600 text-sm">Email</p>
                      <p className="text-lg font-bold">{selectedPaymentForReview.email}</p>
                    </div>
                  </div>
                </div>

                {/* Payment Proof Section */}
                <div className="mb-6">
                  <h3 className="text-lg font-bold mb-3">Payment Proof</h3>
                  <div className="bg-gray-100 border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                    {selectedPaymentForReview.upiScreenshot && selectedPaymentForReview.paymentMethod === 'upi' ? (
                      <img src={selectedPaymentForReview.upiScreenshot} alt="Payment proof" className="max-h-60 mx-auto rounded" />
                    ) : selectedPaymentForReview.paymentMethod === 'upi' ? (
                      <div className="text-gray-600">
                        <p className="text-4xl mb-2">📸</p>
                        <p>Payment screenshot not uploaded yet</p>
                        <p className="text-sm mt-2">Member should upload during signup</p>
                      </div>
                    ) : (
                      <div className="text-gray-600">
                        <p className="text-4xl mb-2">💵</p>
                        <p>Cash payment - No screenshot required</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Transaction Details */}
                <div className="mb-6">
                  <label className="block text-sm font-bold text-gray-700 mb-2">UTR / Transaction ID / Reference</label>
                  <input
                    type="text"
                    placeholder="e.g., UPI REF 123456789 or Bank Ref: ABC123"
                    defaultValue={selectedPaymentForReview.paymentUTR || selectedPaymentForReview.utrNumber || ''}
                    onChange={(e) => setSelectedPaymentForReview({...selectedPaymentForReview, paymentUTR: e.target.value})}
                    className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-600 outline-none"
                  />
                </div>

                {/* Admin Notes */}
                <div className="mb-6">
                  <label className="block text-sm font-bold text-gray-700 mb-2">Admin Notes</label>
                  <textarea
                    placeholder="Add any notes about this payment..."
                    value={paymentReviewNotes}
                    onChange={(e) => setPaymentReviewNotes(e.target.value.slice(0, 500))}
                    maxLength={500}
                    className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-600 outline-none"
                    rows={3}
                  />
                  <p className="text-xs text-gray-500 mt-1">{paymentReviewNotes.length}/500</p>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setSelectedPaymentForReview(null);
                      setPaymentReviewNotes('');
                    }}
                    className="flex-1 py-3 border-2 border-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-50"
                  >
                    Close
                  </button>
                  <button
                    onClick={async () => {
                      // FIX #201: Prevent multiple reject calls
                      if (paymentVerifyDebounceRef.current[selectedPaymentForReview.id]) {
                        showToast('Already processing payment...', "info");
                        return;
                      }

                      // FIX #211: Prevent rejecting already rejected payment
                      if (selectedPaymentForReview.paymentStatus === 'rejected') {
                        showToast('This payment has already been rejected', "info");
                        return;
                      }

                      if (confirm(`❌ Reject payment of ₹${selectedPaymentForReview.amount} for ${selectedPaymentForReview.fullName}?`)) {
                        paymentVerifyDebounceRef.current[selectedPaymentForReview.id] = true;
                        try {
                          const member = members.find(m => m.id === selectedPaymentForReview.id);
                          if (member?.docId) {
                            await updateDoc(doc(db, 'members', member.docId), {
                              paymentStatus: 'rejected',
                              paymentUTR: selectedPaymentForReview.paymentUTR || '',
                              adminNotes: paymentReviewNotes || '',
                              rejectionReason: paymentReviewNotes
                            });
                            setSelectedPaymentForReview(null);
                            setPaymentReviewNotes('');
                          }
                        } catch (error) {
                          logError('Error rejecting payment:', error);
                          showToast('Error rejecting payment', "error");
                        } finally {
                          paymentVerifyDebounceRef.current[selectedPaymentForReview.id] = false;
                        }
                      }
                    }}
                    className="flex-1 py-3 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700"
                  >
                    ✗ Reject Payment
                  </button>
                  <button
                    onClick={async () => {
                      // FIX #201: Prevent multiple verify calls
                      if (paymentVerifyDebounceRef.current[selectedPaymentForReview.id]) {
                        showToast('Already verifying payment...', "info");
                        return;
                      }

                      // FIX #211: Prevent verifying already verified payment
                      if (selectedPaymentForReview.paymentStatus === 'verified') {
                        showToast('This payment has already been verified', "success");
                        return;
                      }

                      if (confirm(`✅ Verify payment of ₹${selectedPaymentForReview.amount} for ${selectedPaymentForReview.fullName}?`)) {
                        paymentVerifyDebounceRef.current[selectedPaymentForReview.id] = true;
                        try {
                          const member = members.find(m => m.id === selectedPaymentForReview.id);
                          if (member?.docId) {
                            await updateDoc(doc(db, 'members', member.docId), {
                              paymentStatus: 'verified',
                              paymentUTR: selectedPaymentForReview.paymentUTR || '',
                              adminNotes: paymentReviewNotes || ''
                            });
                            setSelectedPaymentForReview(null);
                            setPaymentReviewNotes('');
                          }
                        } catch (error) {
                          logError('Error verifying payment:', error);
                          showToast('Error verifying payment', "error");
                        } finally {
                          paymentVerifyDebounceRef.current[selectedPaymentForReview.id] = false;
                        }
                      }
                    }}
                    className="flex-1 py-3 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700"
                  >
                    ✓ Verify Payment
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }

    // Seats Page
    if ((adminPage as string) === 'seats') {
      const slots = [
        { name: '9am-3pm', hours: '9 AM - 3 PM', capacity: 23 },
        { name: '3pm-9pm', hours: '3 PM - 9 PM', capacity: 23 },
        { name: '9am-9pm', hours: '9 AM - 9 PM (Full-day)', capacity: 23 }
      ];

      return (
        <div className="min-h-screen bg-gray-50">
          <header className="sticky top-0 z-40 bg-white shadow">
            <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-4">
              <div className="text-3xl font-bold text-blue-600">🪑 Seat Availability</div>
            </div>
          </header>

          <div className="max-w-7xl mx-auto p-8">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {slots.map((slot) => {
                const slotMembers = members.filter(m => m.slot === slot.name && !m.deletedAt);
                const availableSeats = slot.capacity - slotMembers.length;

                return (
                  <div key={slot.name} className="bg-white rounded-lg shadow-lg p-6">
                    <h3 className="text-2xl font-bold mb-2 text-gray-900">{slot.hours}</h3>
                    <p className="text-sm text-gray-600 mb-4">Maximum Capacity: {slot.capacity} seats</p>

                    <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm font-semibold text-gray-700">Occupied:</span>
                        <span className="text-2xl font-bold text-red-600">{slotMembers.length}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-semibold text-gray-700">Available:</span>
                        <span className={`text-2xl font-bold ${availableSeats > 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {availableSeats}
                        </span>
                      </div>
                      <div className="mt-3 w-full bg-gray-300 rounded-full h-3 overflow-hidden">
                        <div
                          className="bg-gradient-to-r from-red-500 to-orange-500 h-full rounded-full transition-all"
                          style={{ width: `${(slotMembers.length / slot.capacity) * 100}%` }}
                        ></div>
                      </div>
                    </div>

                    <div>
                      <h4 className="font-bold text-gray-900 mb-4">Seat Grid ({slot.capacity} total):</h4>
                      <div className="grid grid-cols-6 gap-2">
                        {Array.from({ length: slot.capacity }).map((_, seatNum) => {
                          const member = slotMembers[seatNum] || null;
                          return (
                            <button
                              key={seatNum}
                              onClick={() => member && setSelectedMemberDetail(member)}
                              className={`aspect-square rounded-lg font-bold text-sm flex flex-col items-center justify-center transition transform hover:scale-105 ${
                                member
                                  ? 'bg-gradient-to-br from-blue-500 to-blue-600 text-white border-2 border-blue-700 cursor-pointer hover:from-blue-600 hover:to-blue-700'
                                  : 'bg-gradient-to-br from-green-400 to-emerald-500 text-white border-2 border-green-600'
                              }`}
                              title={member ? `${member.fullName}` : 'Empty Seat'}
                            >
                              <div className="text-xs">#{seatNum + 1}</div>
                              {member && <div className="text-xs truncate">{member.fullName?.split(' ')[0] || 'Member'}</div>}
                            </button>
                          );
                        })}
                      </div>

                      <div className="flex gap-4 mt-6">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 bg-gradient-to-br from-green-400 to-emerald-500 rounded border-2 border-green-600"></div>
                          <span className="text-sm font-semibold text-gray-700">Available ({availableSeats})</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-blue-600 rounded border-2 border-blue-700"></div>
                          <span className="text-sm font-semibold text-gray-700">Occupied ({slotMembers.length})</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              onClick={() => goBackAdmin()}
              className="mt-8 px-6 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700"
            >
              ← Back
            </button>
          </div>

          {/* Member Detail Modal */}
          {selectedMemberDetail && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 overflow-y-auto">
              <div className="bg-white rounded-lg p-8 max-w-md w-full my-auto">
                <div className="flex items-start justify-between mb-6">
                  <h2 className="text-2xl font-bold text-gray-900">{selectedMemberDetail.fullName}</h2>
                  <button
                    onClick={() => setSelectedMemberDetail(null)}
                    className="text-3xl text-gray-400 hover:text-gray-600"
                  >
                    ×
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="p-4 bg-blue-50 rounded-lg">
                    <p className="text-sm text-gray-600">Member ID</p>
                    <p className="text-lg font-bold text-gray-900">{selectedMemberDetail.id}</p>
                  </div>

                  {selectedMemberDetail.membershipId && (
                    <div className="p-4 bg-green-50 rounded-lg">
                      <p className="text-sm text-gray-600">Membership ID</p>
                      <p className="text-lg font-bold text-green-700">{selectedMemberDetail.membershipId}</p>
                    </div>
                  )}

                  <div className="p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600">Email</p>
                    <p className="text-gray-900 font-medium break-all">{selectedMemberDetail.email}</p>
                  </div>

                  <div className="p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600">Phone</p>
                    <p className="text-gray-900 font-medium">{selectedMemberDetail.phone}</p>
                  </div>

                  <div className="p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600">Plan</p>
                    <p className="text-gray-900 font-medium">{selectedMemberDetail.plan}</p>
                  </div>

                  <div className="p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600">Time Slot</p>
                    <p className="text-gray-900 font-medium">{selectedMemberDetail.slot}</p>
                  </div>

                  <div className="p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600">Payment Status</p>
                    <span className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${
                      selectedMemberDetail.paymentStatus === 'verified'
                        ? 'bg-green-100 text-green-800'
                        : selectedMemberDetail.paymentStatus === 'pending'
                        ? 'bg-yellow-100 text-yellow-800'
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {selectedMemberDetail.paymentStatus === 'verified' ? '✅ Verified' :
                       selectedMemberDetail.paymentStatus === 'pending' ? '⏳ Pending' :
                       '❌ Rejected'}
                    </span>
                  </div>

                  {selectedMemberDetail.amount && (
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <p className="text-sm text-gray-600">Amount Paid</p>
                      <p className="text-lg font-bold text-gray-900">₹{selectedMemberDetail.amount}</p>
                    </div>
                  )}
                </div>

                <button
                  onClick={() => setSelectedMemberDetail(null)}
                  className="w-full mt-6 px-4 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      );
    }

    // Reminders Page
    if ((adminPage as string) === 'reminders') {
      // Recipients + message depend on the selected reminder type.
      // - payment: members still pending payment
      // - welcome: verified members who have a membership ID issued
      // - renewal: verified members (message includes their computed expiry)
      const active = getActiveMembers(members);
      const reminderRecipients = (
        reminderType === 'payment'
          ? active.filter(m => m.paymentStatus === 'pending' && m.phone)
          : reminderType === 'welcome'
          ? active.filter(m => m.paymentStatus === 'verified' && m.membershipId && m.phone)
          : active.filter(m => m.paymentStatus === 'verified' && m.phone)
      );
      const buildReminderMessage = (m: any) => {
        if (reminderType === 'payment') return whatsappMessages.paymentRequest();
        if (reminderType === 'welcome') return whatsappMessages.welcome(m.membershipId);
        const expiry = getMembershipExpiry(m);
        return whatsappMessages.renewal(expiry ? expiry.toLocaleDateString('en-IN') : 'soon');
      };
      // Full static class strings (Tailwind cannot see interpolated class names).
      const reminderTypes = [
        { key: 'payment' as const, label: '📌 Payment Pending',
          active: 'border-blue-600 bg-blue-100 ring-2 ring-blue-400',
          idle: 'border-blue-300 bg-white hover:bg-blue-50' },
        { key: 'welcome' as const, label: '✅ Welcome Message',
          active: 'border-green-600 bg-green-100 ring-2 ring-green-400',
          idle: 'border-green-300 bg-white hover:bg-green-50' },
        { key: 'renewal' as const, label: '⏰ Renewal Reminder',
          active: 'border-orange-600 bg-orange-100 ring-2 ring-orange-400',
          idle: 'border-orange-300 bg-white hover:bg-orange-50' },
      ];
      return (
        <div className="min-h-screen bg-gray-50">
          <header className="sticky top-0 z-40 bg-white shadow">
            <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-4">
              <button onClick={() => goBackAdmin()} className="text-2xl">←</button>
              <div className="text-2xl font-bold text-blue-600">📨 Send Reminders</div>
            </div>
          </header>

          <div className="max-w-6xl mx-auto p-8">
            <div className="bg-white rounded-lg shadow p-8">
              <h2 className="text-2xl font-bold mb-6">WhatsApp Reminders</h2>

              <div className="space-y-4">
                <div className="p-6 bg-blue-50 border border-blue-200 rounded-lg">
                  <h3 className="font-bold text-lg mb-4">Select reminder type:</h3>
                  <div className="space-y-3">
                    {reminderTypes.map(rt => (
                      <button
                        key={rt.key}
                        onClick={() => setReminderType(rt.key)}
                        className={`w-full text-left p-4 rounded-lg font-semibold border-2 transition ${
                          reminderType === rt.key ? rt.active : rt.idle
                        }`}
                      >
                        {reminderType === rt.key ? '🔘 ' : '⚪ '}{rt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-6 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-green-800 font-semibold">✅ {reminderRecipients.length} member(s) will receive the "{reminderType}" reminder</p>
                </div>

                <button
                  onClick={() => {
                    if (reminderRecipients.length === 0) {
                      alert('No matching members with a phone number for this reminder type.');
                      return;
                    }
                    if (!confirm(`This will open ${reminderRecipients.length} WhatsApp tab(s), one per member. Continue?`)) {
                      return;
                    }
                    reminderRecipients.forEach(member => {
                      sendWhatsAppMessage(member.phone, buildReminderMessage(member));
                    });
                  }}
                  className="w-full py-4 bg-gradient-to-r from-green-600 to-green-700 text-white font-bold rounded-lg hover:shadow-lg text-lg"
                >
                  📱 Send WhatsApp Reminders
                </button>
              </div>

              <button
                onClick={() => navigate('/admin/dashboard')}
                className="w-full mt-6 py-3 border-2 border-blue-600 text-blue-600 font-bold rounded-lg"
              >
                Back to Dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }

    // Users Management Page
    if ((adminPage as string) === 'users') {
      return (
        <div className="min-h-screen bg-gray-50">
          <header className="sticky top-0 z-40 bg-white shadow">
            <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-4">
              <button onClick={() => goBackAdmin()} className="text-2xl">←</button>
              <div className="text-2xl font-bold text-blue-600">👤 Users & Passwords</div>
            </div>
          </header>

          <div className="max-w-4xl mx-auto p-8">
            <div className="space-y-6">
              {/* Admin Login Password Change */}
              <div className="bg-gradient-to-r from-red-50 to-orange-50 rounded-lg shadow p-6 border-2 border-red-200">
                <h3 className="text-lg font-bold text-red-700 mb-4">🔐 Change Admin Login Password</h3>
                <p className="text-sm text-gray-600 mb-4">Change the master password used to login to admin panel</p>
                <div className="flex gap-3">
                  <input
                    type="password"
                    placeholder="New admin password (min 6 chars)"
                    defaultValue=""
                    id="newAdminPassword"
                    className="flex-1 px-4 py-2 border-2 border-red-300 rounded-lg focus:border-red-500 outline-none"
                  />
                  <button
                    onClick={() => {
                      const newPassword = (document.getElementById('newAdminPassword') as HTMLInputElement)?.value;
                      if (!newPassword || newPassword.length < 6) {
                        alert('Password must be at least 6 characters');
                        return;
                      }
                      localStorage.setItem('customAdminPassword', newPassword);
                      (document.getElementById('newAdminPassword') as HTMLInputElement).value = '';
                      showToast(`Admin password changed successfully!`, "success");
                    }}
                    className="px-6 py-2 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700"
                  >
                    Save
                  </button>
                </div>
              </div>

              {/* Users List */}
              <div className="bg-white rounded-lg shadow overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-100 border-b">
                      <tr>
                        <th className="text-left px-6 py-3 font-bold">Name</th>
                        <th className="text-left px-6 py-3 font-bold">Role</th>
                        <th className="text-left px-6 py-3 font-bold">Email</th>
                        <th className="text-left px-6 py-3 font-bold">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map(user => (
                        <tr key={user.id} className="border-b hover:bg-gray-50">
                          <td className="px-6 py-4 font-semibold">
                            {user.name}
                            <div className={`text-xs font-normal mt-0.5 ${user.password && user.password.length >= 6 ? 'text-green-600' : 'text-gray-400'}`}>
                              {user.password && user.password.length >= 6 ? '🔑 Login enabled' : '🔒 No password set'}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`px-3 py-1 rounded-full text-sm font-bold ${
                              user.role === 'admin' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                            }`}>
                              {user.role === 'admin' ? '🔴 Admin' : '👤 Staff'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-gray-600">{user.email}</td>
                          <td className="px-6 py-4">
                            <button
                              onClick={() => {
                                setEditingUser(user);
                                setEditUserPassword('');
                              }}
                              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 font-semibold"
                            >
                              🔐 Change Password
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Password Change Modal */}
              {editingUser && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                  <div className="bg-white rounded-lg p-8 max-w-md w-full">
                    <h2 className="text-2xl font-bold mb-6">Change Password</h2>

                    <div className="bg-gray-100 p-4 rounded-lg mb-6">
                      <p className="text-sm text-gray-600">User</p>
                      <p className="font-bold text-lg">{editingUser.name} ({editingUser.role})</p>
                    </div>

                    <div className="mb-6">
                      <label className="block text-sm font-bold text-gray-700 mb-2">New Password (min 6 characters)</label>
                      <input
                        type="password"
                        value={editUserPassword}
                        onChange={(e) => setEditUserPassword(e.target.value.slice(0, 50))}
                        placeholder="Enter new password"
                        maxLength={50}
                        className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-600 outline-none"
                      />
                      {editUserPassword && editUserPassword.length < 6 && <p className="text-yellow-600 text-sm mt-1">⚠️ Password must be at least 6 characters</p>}
                    </div>

                    <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg mb-6">
                      <p className="text-sm text-yellow-700">
                        ⚠️ <strong>Note:</strong> Password will be changed immediately. Never share passwords.
                      </p>
                    </div>

                    <div className="flex gap-3">
                      <button
                        onClick={() => {
                          setEditingUser(null);
                          setEditUserPassword('');
                        }}
                        className="flex-1 py-2 border-2 border-gray-300 text-gray-700 font-bold rounded hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={async () => {
                          if (!editUserPassword.trim()) {
                            alert('Please enter a new password');
                            return;
                          }
                          if (editUserPassword.length < 6) {
                            alert('Password must be at least 6 characters');
                            return;
                          }
                          try {
                            // FIX: Update users state (will auto-save to localStorage)
                            setUsers(users.map(u => u.id === editingUser.id ? {...u, password: editUserPassword} : u));
                            showToast(`Password updated for ${editingUser.name}`, "success");
                            setEditingUser(null);
                            setEditUserPassword('');
                          } catch (error) {
                            logError('Error updating password:', error);
                            showToast('Error updating password', "error");
                          }
                        }}
                        className="flex-1 py-2 bg-green-600 text-white font-bold rounded hover:bg-green-700"
                      >
                        Update Password
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <button
                onClick={() => navigate('/admin/dashboard')}
                className="w-full py-3 border-2 border-blue-600 text-blue-600 font-bold rounded-lg hover:bg-blue-50"
              >
                Back to Dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }
  }

  // HOME PAGE
  if (step === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-white">
        {/* HEADER */}
        <header className="sticky top-0 z-50 bg-gradient-to-r from-white to-blue-50 backdrop-blur-md border-b border-blue-100 shadow-sm">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="text-4xl">📚</div>
              <div>
                <div className="text-xl font-black bg-gradient-to-r from-blue-600 to-blue-700 bg-clip-text text-transparent">
                  Achievers Library
                </div>
                <div className="text-xs text-gray-500 font-semibold">Premium Study Space</div>
              </div>
            </div>
            <nav className="flex gap-2 md:gap-8 text-sm font-medium items-center">
              <a href="#features" className="hidden md:inline text-gray-600 hover:text-blue-600 transition">Features</a>
              <a href="#pricing" className="hidden md:inline text-gray-600 hover:text-blue-600 transition">Plans</a>
              <a href="#contact" className="hidden md:inline text-gray-600 hover:text-blue-600 transition">Contact</a>
              <button
                onClick={() => navigate('/admission/step-1')}
                className="px-4 md:px-6 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold rounded-lg hover:shadow-lg transition text-xs md:text-sm"
              >
                Join
              </button>
              <button
                onClick={() => navigate('/admin/login')}
                className="px-3 py-2 text-gray-600 hover:text-blue-600 transition text-lg md:text-xs font-semibold"
                title="Admin Panel"
              >
                🔐
              </button>
            </nav>
          </div>
        </header>

        {/* HERO SECTION */}
        <section className="max-w-6xl mx-auto px-4 py-16 sm:py-40">
          <div className="text-center mb-20">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6 }}
              className="inline-block mb-6"
            >
              <div className="text-6xl mb-4">📚✨</div>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
              className="text-6xl sm:text-8xl font-black mb-4 leading-tight"
            >
              <span className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 bg-clip-text text-transparent">
                The Achievers' Library
              </span>
            </motion.h1>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="mb-8"
            >
              <p className="text-2xl sm:text-3xl font-bold text-gray-800 mb-2">
                Where You Can Achieve Your Dream...
              </p>
              <div className="h-1 w-24 bg-gradient-to-r from-blue-500 to-purple-500 mx-auto rounded-full"></div>
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3 }}
              className="text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto mb-12 leading-relaxed"
            >
              A premium study space in Adityapur with comfortable seating, high-speed WiFi, flexible timings, and affordable plans designed for serious students.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              className="flex flex-col sm:flex-row gap-4 justify-center"
            >
              <motion.button
                whileHover={{ scale: 1.05, y: -3 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => navigate('/admission/step-1')}
                className="px-10 py-4 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-bold rounded-xl text-lg shadow-lg hover:shadow-2xl transition"
              >
                ✨ Start Your Admission
              </motion.button>
              <motion.a
                whileHover={{ scale: 1.05, y: -3 }}
                whileTap={{ scale: 0.95 }}
                href="#features"
                className="px-10 py-4 border-2 border-blue-500 text-blue-600 font-bold rounded-xl text-lg hover:bg-blue-50 transition"
              >
                📚 Explore Features
              </motion.a>
            </motion.div>
          </div>

          {/* HOW TO GET STARTED */}
          <div className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-3xl p-12 mb-20 text-white">
            <h3 className="text-3xl font-black text-center mb-12">How to Get Started in 4 Steps</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="text-center">
                <div className="text-5xl mb-4 inline-block bg-white/20 p-4 rounded-full">📝</div>
                <h4 className="font-bold text-lg mb-2">Step 1: Register</h4>
                <p className="text-blue-100 text-sm">Fill in your details and choose your plan</p>
              </div>
              <div className="text-center">
                <div className="text-5xl mb-4 inline-block bg-white/20 p-4 rounded-full">🗓️</div>
                <h4 className="font-bold text-lg mb-2">Step 2: Select Slot</h4>
                <p className="text-blue-100 text-sm">Pick your preferred time and date</p>
              </div>
              <div className="text-center">
                <div className="text-5xl mb-4 inline-block bg-white/20 p-4 rounded-full">💳</div>
                <h4 className="font-bold text-lg mb-2">Step 3: Make Payment</h4>
                <p className="text-blue-100 text-sm">Pay securely via cash or UPI</p>
              </div>
              <div className="text-center">
                <div className="text-5xl mb-4 inline-block bg-white/20 p-4 rounded-full">✨</div>
                <h4 className="font-bold text-lg mb-2">Step 4: Start Studying</h4>
                <p className="text-blue-100 text-sm">Get your QR code and begin!</p>
              </div>
            </div>
          </div>
        </section>

        {/* FEATURES SECTION */}
        <section id="features" className="max-w-6xl mx-auto px-4 py-16">
          <h2 className="text-4xl font-black text-center mb-16">Why Choose Us?</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
            {[
              { icon: '📚', title: 'Comfortable Seats', desc: 'Spacious, well-maintained study areas with proper lighting and ventilation. 69 premium seats designed for maximum comfort during long study sessions.' },
              { icon: '⏰', title: 'Flexible Timings', desc: 'Open from 9 AM to 9 PM daily. Choose between morning (9-3 PM), evening (3-9 PM), or full-day slots based on your schedule.' },
              { icon: '💰', title: 'Affordable Plans', desc: 'Monthly, quarterly, half-yearly, and yearly membership options. Best value for your money with discounts on longer plans.' }
            ].map((feature, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: i * 0.2 }}
                whileHover={{ y: -10, rotateX: 5 }}
                className="bg-gradient-to-br from-white to-blue-50 rounded-2xl shadow-lg hover:shadow-2xl p-8 border border-blue-100 backdrop-blur-sm"
                style={{ perspective: '1000px' }}
              >
                <div className="text-6xl mb-4 transform hover:scale-125 transition duration-300">{feature.icon}</div>
                <h3 className="text-2xl font-bold mb-3 text-gray-900">{feature.title}</h3>
                <p className="text-gray-600 text-lg leading-relaxed">{feature.desc}</p>
              </motion.div>
            ))}
          </div>

          {/* AMENITIES & FACILITIES */}
          <motion.h3
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            transition={{ duration: 0.6 }}
            className="text-4xl font-black mb-12 text-center bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent"
          >
            Complete Amenities & Facilities
          </motion.h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
            {[
              { icon: '🌐', title: 'High-Speed WiFi', desc: 'Ultra-fast internet connection (50+ Mbps) for seamless browsing, research, and online classes' },
              { icon: '💡', title: 'Study Lights', desc: 'Individual LED study lamps at each seat with adjustable brightness to reduce eye strain' },
              { icon: '🔌', title: 'Charging Points', desc: 'Multiple charging sockets and USB ports available at every seat for phones and devices' },
              { icon: '💧', title: 'RO Water Dispenser', desc: 'Fresh, filtered drinking water available throughout the day - free for all members' },
              { icon: '🚽', title: 'Modern Bathrooms', desc: 'Clean, hygienic bathrooms with hot water facilities available 24/7' },
              { icon: '❄️', title: 'Air Conditioning', desc: 'Climate-controlled environment with proper ventilation for comfortable studying' },
              { icon: '📚', title: 'Reference Books', desc: 'Extensive collection of study materials and reference books for various subjects' },
              { icon: '🪑', title: 'Ergonomic Seating', desc: 'Comfortable chairs and desks designed to support good posture during long study sessions' },
              { icon: '🔇', title: 'Silent Environment', desc: 'Noise-controlled study zones with strict silence policy to ensure uninterrupted concentration' }
            ].map((amenity, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4, delay: i * 0.05 }}
                whileHover={{ y: -5 }}
                className="bg-gradient-to-br from-white via-blue-50 to-white rounded-xl p-6 border border-blue-200 hover:shadow-xl transition backdrop-blur-sm"
              >
                <div className="text-4xl mb-3 transform hover:rotate-12 hover:scale-110 transition duration-300">{amenity.icon}</div>
                <h4 className="font-bold text-lg mb-2 text-gray-900">{amenity.title}</h4>
                <p className="text-gray-600 text-sm leading-relaxed">{amenity.desc}</p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* PRICING SECTION */}
        <section id="pricing" className="max-w-6xl mx-auto px-4 py-16 bg-gradient-to-br from-blue-50 to-blue-100 rounded-3xl">
          <h2 className="text-4xl font-black text-center mb-16">Simple, Transparent Pricing</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-white rounded-2xl p-8 border-2 border-gray-200">
              <h3 className="text-2xl font-bold mb-6">Half-Day Plans</h3>
              <div className="space-y-6">
                <div className="border-b pb-4">
                  <div className="flex justify-between mb-2">
                    <span className="font-medium">Monthly</span>
                    <span className="font-bold text-blue-600 text-lg">₹700</span>
                  </div>
                  <div className="text-sm text-gray-600 space-y-1 ml-0">
                    <div className="flex justify-between">
                      <span>Admission Fee</span>
                      <span>₹100</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Plan Fee (30 days)</span>
                      <span>₹600</span>
                    </div>
                  </div>
                </div>

                <div className="border-b pb-4">
                  <div className="flex justify-between mb-2">
                    <span className="font-medium">Quarterly</span>
                    <span className="font-bold text-blue-600 text-lg">₹1,700</span>
                  </div>
                  <div className="text-sm text-gray-600 space-y-1">
                    <div className="flex justify-between">
                      <span>Admission Fee</span>
                      <span>₹100</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Plan Fee (90 days)</span>
                      <span>₹1,600</span>
                    </div>
                  </div>
                </div>

                <div className="border-b pb-4">
                  <div className="flex justify-between mb-2">
                    <span className="font-medium">Half-Yearly</span>
                    <span className="font-bold text-blue-600 text-lg">₹3,200</span>
                  </div>
                  <div className="text-sm text-gray-600 space-y-1">
                    <div className="flex justify-between">
                      <span>Admission Fee</span>
                      <span>₹100</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Plan Fee (180 days)</span>
                      <span>₹3,100</span>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between mb-2">
                    <span className="font-medium">Yearly</span>
                    <span className="font-bold text-blue-600 text-lg">₹6,000</span>
                  </div>
                  <div className="text-sm text-gray-600 space-y-1">
                    <div className="flex justify-between">
                      <span>Admission Fee</span>
                      <span>₹100</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Plan Fee (365 days)</span>
                      <span>₹5,900</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-8 border-2 border-blue-500 shadow-lg">
              <h3 className="text-2xl font-bold mb-6">Full-Day Plans</h3>
              <div className="space-y-6">
                <div className="border-b pb-4">
                  <div className="flex justify-between mb-2">
                    <span className="font-medium">Monthly</span>
                    <span className="font-bold text-green-600 text-lg">₹1,200</span>
                  </div>
                  <div className="text-sm text-gray-600 space-y-1">
                    <div className="flex justify-between">
                      <span>Admission Fee</span>
                      <span>₹100</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Plan Fee (30 days)</span>
                      <span>₹1,100</span>
                    </div>
                  </div>
                </div>

                <div className="border-b pb-4">
                  <div className="flex justify-between mb-2">
                    <span className="font-medium">Quarterly</span>
                    <span className="font-bold text-green-600 text-lg">₹3,200</span>
                  </div>
                  <div className="text-sm text-gray-600 space-y-1">
                    <div className="flex justify-between">
                      <span>Admission Fee</span>
                      <span>₹100</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Plan Fee (90 days)</span>
                      <span>₹3,100</span>
                    </div>
                  </div>
                </div>

                <div className="border-b pb-4">
                  <div className="flex justify-between mb-2">
                    <span className="font-medium">Half-Yearly</span>
                    <span className="font-bold text-green-600 text-lg">₹6,000</span>
                  </div>
                  <div className="text-sm text-gray-600 space-y-1">
                    <div className="flex justify-between">
                      <span>Admission Fee</span>
                      <span>₹100</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Plan Fee (180 days)</span>
                      <span>₹5,900</span>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between mb-2">
                    <span className="font-medium">Yearly</span>
                    <span className="font-bold text-green-600 text-lg">₹10,000</span>
                  </div>
                  <div className="text-sm text-gray-600 space-y-1">
                    <div className="flex justify-between">
                      <span>Admission Fee</span>
                      <span>₹100</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Plan Fee (365 days)</span>
                      <span>₹9,900</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA SECTION */}
        <section className="max-w-4xl mx-auto px-4 py-20 text-center">
          <h2 className="text-4xl font-black mb-6">Ready to Start Your Journey?</h2>
          <p className="text-xl text-gray-600 mb-10">Join hundreds of students already studying at The Achievers' Library</p>
          <button
            onClick={() => navigate('/admission/step-1')}
            className="inline-block bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-bold py-4 px-16 rounded-full text-lg transition shadow-lg hover:shadow-xl transform hover:scale-105"
          >
            ✨ Get Started Today
          </button>
        </section>

        {/* CONTACT SECTION */}
        <section id="contact" className="max-w-6xl mx-auto px-4 py-16">
          <div className="bg-gradient-to-br from-blue-600 to-blue-700 text-white rounded-3xl p-12 text-center">
            <h2 className="text-4xl font-black mb-8">Get In Touch</h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-10">
              <div>
                <div className="text-4xl mb-4">📍</div>
                <h3 className="font-bold text-lg mb-2">Location</h3>
                <p className="text-blue-100">Akashvani Chowk<br/>Opposite Durian Furniture<br/>Adityapur</p>
              </div>
              <div>
                <div className="text-4xl mb-4">📞</div>
                <h3 className="font-bold text-lg mb-2">Phone</h3>
                <p className="text-blue-100 text-2xl font-bold">9153144218</p>
              </div>
              <div>
                <div className="text-4xl mb-4">⏰</div>
                <h3 className="font-bold text-lg mb-2">Hours</h3>
                <p className="text-blue-100">Mon-Sun<br/>9:00 AM - 9:00 PM</p>
              </div>
            </div>

            <p className="text-blue-100 text-lg">Have questions? Call us or visit our location!</p>
          </div>
        </section>

        {/* FOOTER */}
        <footer className="bg-gray-900 text-white text-center py-8 mt-10">
          <p className="text-gray-400">© 2026 The Achievers' Library. All rights reserved.</p>
        </footer>
      </div>
    );
  }

  // STEP 1: PERSONAL INFO
  if (step === 1) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white p-4">
        <div className="max-w-2xl mx-auto">
          <div className="mb-8">
            <div className="flex justify-between items-center mb-4">
              <h1 className="text-3xl font-bold">Admission Form</h1>
              <span className="text-blue-600 font-bold">Step 1/7</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-blue-600 h-2 rounded-full" style={{ width: '14%' }}></div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-lg p-8 border border-gray-100">
            <h2 className="text-2xl font-bold mb-6">Personal Information</h2>
            <div className="space-y-4">
              <div>
                <label className="block font-semibold mb-2">Full Name <span className="text-red-600">*</span></label>
                <input
                  type="text"
                  name="fullName"
                  value={formData.fullName}
                  onChange={handleInputChange}
                  placeholder="Enter your full name"
                  maxLength={50}
                  className={`w-full px-4 py-3 border-2 rounded-lg focus:outline-none ${formErrors.fullName ? 'border-red-600 focus:border-red-600 bg-red-50' : 'border-gray-300 focus:border-blue-500'}`}
                />
                {formErrors.fullName && <p className="text-red-600 text-sm mt-1">⚠️ {formErrors.fullName}</p>}
              </div>
              <div>
                <label className="block font-semibold mb-2">Email <span className="text-red-600">*</span></label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  placeholder="example@email.com"
                  maxLength={100}
                  className={`w-full px-4 py-3 border-2 rounded-lg focus:outline-none ${formErrors.email ? 'border-red-600 focus:border-red-600 bg-red-50' : 'border-gray-300 focus:border-blue-500'}`}
                />
                {formErrors.email && <p className="text-red-600 text-sm mt-1">⚠️ {formErrors.email}</p>}
              </div>
              <div>
                <label className="block font-semibold mb-2">WhatsApp Number <span className="text-red-600">*</span></label>
                <input
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 10);
                    setFormData(prev => ({...prev, phone: val}));
                  }}
                  placeholder="+91 XXXXXXXXXX"
                  maxLength="10"
                  className={`w-full px-4 py-3 border-2 rounded-lg focus:outline-none ${formErrors.phone ? 'border-red-600 focus:border-red-600 bg-red-50' : 'border-gray-300 focus:border-blue-500'}`}
                />
                {formData.phone && formData.phone.length < 10 && <p className="text-yellow-600 text-sm mt-1">⏳ {formData.phone.length}/10 digits entered</p>}
                {formErrors.phone && <p className="text-red-600 text-sm mt-1">⚠️ {formErrors.phone}</p>}
              </div>
              <div>
                <label className="block font-semibold mb-2">Date of Birth <span className="text-red-600">*</span></label>
                <input
                  type="date"
                  name="dateOfBirth"
                  value={formData.dateOfBirth}
                  onChange={handleInputChange}
                  min="1950-01-01"
                  max={new Date().toISOString().split('T')[0]}
                  className={`w-full px-4 py-3 border-2 rounded-lg focus:outline-none ${formErrors.dateOfBirth ? 'border-red-600 focus:border-red-600 bg-red-50' : 'border-gray-300 focus:border-blue-500'}`}
                />
                {formErrors.dateOfBirth && <p className="text-red-600 text-sm mt-1">⚠️ {formErrors.dateOfBirth}</p>}
              </div>
              <div>
                <label className="block font-semibold mb-2">Gender <span className="text-red-500">*</span></label>
                <select
                  name="gender"
                  value={formData.gender}
                  onChange={handleInputChange}
                  className={`w-full px-4 py-3 border-2 rounded-lg focus:outline-none ${formErrors.gender ? 'border-red-600 focus:border-red-600 bg-red-50' : 'border-gray-300 focus:border-blue-500'}`}
                >
                  <option value="">Select Gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                  <option value="Prefer not to say">Prefer not to say</option>
                </select>
                {formErrors.gender && <p className="text-red-600 text-sm mt-1">⚠️ {formErrors.gender}</p>}
              </div>
              <div>
                <label className="block font-semibold mb-2">Current Class/Year</label>
                <select
                  name="currentClass"
                  value={formData.currentClass}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 outline-none"
                >
                  <option value="">Select Class/Year</option>
                  <option value="8th">8th</option>
                  <option value="9th">9th</option>
                  <option value="10th">10th</option>
                  <option value="11th">11th</option>
                  <option value="12th">12th</option>
                  <option value="B.Tech Y1">B.Tech Year 1</option>
                  <option value="B.Tech Y2">B.Tech Year 2</option>
                  <option value="B.Tech Y3">B.Tech Year 3</option>
                  <option value="B.Tech Y4">B.Tech Year 4</option>
                  <option value="Masters">Masters</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-2">School/College Name</label>
                <input
                  type="text"
                  name="schoolCollege"
                  value={formData.schoolCollege}
                  onChange={handleInputChange}
                  placeholder="Enter your school or college name"
                  maxLength={100}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold mb-2">Target Exam/Purpose</label>
                <select
                  name="targetExam"
                  value={formData.targetExam}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 outline-none"
                >
                  <option value="">Select Target Exam/Purpose</option>
                  <option value="JEE Main">JEE Main</option>
                  <option value="JEE Advanced">JEE Advanced</option>
                  <option value="NEET">NEET</option>
                  <option value="12th Board">12th Board Exam</option>
                  <option value="10th Board">10th Board Exam</option>
                  <option value="Gate Exam">GATE Exam</option>
                  <option value="CAT">CAT Exam</option>
                  <option value="Placement Prep">Placement Preparation</option>
                  <option value="General Study">General Study</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>
            <div className="flex gap-4 mt-8">
              <button
                onClick={() => navigate('/')}
                className="flex-1 py-3 px-6 border-2 border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50"
              >
                Back
              </button>
              <button
                onClick={() => {
                  const errors: Record<string, string> = {};

                  if (!formData.fullName.trim()) {
                    errors.fullName = 'Full name is required';
                  }
                  if (!formData.email.trim()) {
                    errors.email = 'Email is required';
                  } else {
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    if (!emailRegex.test(formData.email.trim())) {
                      errors.email = 'Invalid email format';
                    }
                  }
                  if (!formData.phone.trim()) {
                    errors.phone = 'WhatsApp number is required';
                  } else {
                    const phoneRegex = /^[0-9]{10}$/;
                    const cleanPhone = formData.phone.replace(/[^0-9]/g, '');
                    if (!phoneRegex.test(cleanPhone)) {
                      errors.phone = 'Must be 10 digits (no spaces/dashes)';
                    }
                  }
                  if (!formData.dateOfBirth) {
                    errors.dateOfBirth = 'Date of birth is required';
                  } else {
                    const dob = new Date(formData.dateOfBirth);
                    const today = new Date();
                    let age = today.getFullYear() - dob.getFullYear();
                    const m = today.getMonth() - dob.getMonth();
                    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
                    if (age < 13) {
                      errors.dateOfBirth = 'Must be at least 13 years old';
                    }
                  }
                  if (!formData.gender) {
                    errors.gender = 'Gender is required';
                  }

                  if (Object.keys(errors).length > 0) {
                    setFormErrors(errors);
                    showToast(`Please fix the highlighted fields (${Object.keys(errors).length} errors)`, "error");
                    return;
                  }

                  setFormErrors({});
                  navigate('/admission/step-2');
                }}
                className="flex-1 py-3 px-6 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700"
              >
                Next →
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // STEP 2: ADDRESS
  if (step === 2) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white p-4">
        <div className="max-w-2xl mx-auto">
          <div className="mb-8">
            <div className="flex justify-between items-center mb-4">
              <h1 className="text-3xl font-bold">Address Information</h1>
              <span className="text-blue-600 font-bold">Step 2/7</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-blue-600 h-2 rounded-full" style={{ width: '28%' }}></div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-lg p-8 border border-gray-100">
            <h2 className="text-2xl font-bold mb-6">📍 Address Details</h2>

            {/* TEMPORARY ADDRESS */}
            <div className="mb-8 p-6 bg-blue-50 rounded-xl border-2 border-blue-200">
              <h3 className="text-lg font-bold mb-4 text-blue-900">🏠 Temporary Address <span className="text-red-600">*</span></h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-semibold mb-1 text-gray-700">Street Address / House No. <span className="text-red-600">*</span></label>
                  <input type="text" value={formData.tempStreet || ''} onChange={(e) => setFormData(prev => ({...prev, tempStreet: e.target.value}))} placeholder="e.g., 123 Main Street, Apt 456" className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-semibold mb-1 text-gray-700">City <span className="text-red-600">*</span></label>
                    <input type="text" value={formData.tempCity || ''} onChange={(e) => {
                      const val = e.target.value.replace(/[^a-zA-Z\s]/g, '');
                      setFormData(prev => ({...prev, tempCity: val}));
                    }} placeholder="e.g., Delhi" className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-1 text-gray-700">State <span className="text-red-600">*</span></label>
                    <input type="text" value={formData.tempState || ''} onChange={(e) => {
                      const val = e.target.value.replace(/[^a-zA-Z\s]/g, '');
                      setFormData(prev => ({...prev, tempState: val}));
                    }} placeholder="e.g., Delhi" className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 outline-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1 text-gray-700">Postal Code / Pin Code <span className="text-red-600">*</span></label>
                  <input type="text" value={formData.tempPincode || ''} onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
                      setFormData(prev => ({...prev, tempPincode: val}));
                    }} placeholder="e.g., 110001" maxLength="6" className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 outline-none" />
                </div>
              </div>
            </div>

            {/* SAME ADDRESS CHECKBOX */}
            <div className="border-t-2 pt-4 mb-8">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isSamePermanentAddress}
                  onChange={(e) => {
                    setIsSamePermanentAddress(e.target.checked);
                    if (e.target.checked) {
                      setFormData(prev => ({
                        ...prev,
                        permStreet: prev.tempStreet,
                        permCity: prev.tempCity,
                        permState: prev.tempState,
                        permPincode: prev.tempPincode,
                      }));
                    }
                  }}
                  className="w-5 h-5 cursor-pointer"
                />
                <span className="font-bold text-gray-700">✓ Permanent address is same as temporary address</span>
              </label>
            </div>

            {/* PERMANENT ADDRESS */}
            {!isSamePermanentAddress && (
              <div className="mb-8 p-6 bg-green-50 rounded-xl border-2 border-green-200">
                <h3 className="text-lg font-bold mb-4 text-green-900">🏡 Permanent Address <span className="text-red-600">*</span></h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-semibold mb-1 text-gray-700">Street Address / House No. <span className="text-red-600">*</span></label>
                    <input type="text" value={formData.permStreet || ''} onChange={(e) => setFormData(prev => ({...prev, permStreet: e.target.value}))} placeholder="e.g., 123 Main Street, Apt 456" className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-green-500 outline-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-semibold mb-1 text-gray-700">City <span className="text-red-600">*</span></label>
                      <input type="text" value={formData.permCity || ''} onChange={(e) => {
                        const val = e.target.value.replace(/[^a-zA-Z\s]/g, '');
                        setFormData(prev => ({...prev, permCity: val}));
                      }} placeholder="e.g., Delhi" className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-green-500 outline-none" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-1 text-gray-700">State <span className="text-red-600">*</span></label>
                      <input type="text" value={formData.permState || ''} onChange={(e) => {
                        const val = e.target.value.replace(/[^a-zA-Z\s]/g, '');
                        setFormData(prev => ({...prev, permState: val}));
                      }} placeholder="e.g., Delhi" className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-green-500 outline-none" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-1 text-gray-700">Postal Code / Pin Code <span className="text-red-600">*</span></label>
                    <input type="text" value={formData.permPincode || ''} onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
                      setFormData(prev => ({...prev, permPincode: val}));
                    }} maxLength="6" placeholder="e.g., 110001" className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-green-500 outline-none" />
                  </div>
                </div>
              </div>
            )}

            {/* PERMANENT ADDRESS SUMMARY (when same) */}
            {isSamePermanentAddress && (
              <div className="mb-8 p-6 bg-green-50 rounded-xl border-2 border-green-200">
                <h3 className="text-lg font-bold mb-3 text-green-900">🏡 Permanent Address (Same as Temporary)</h3>
                <div className="space-y-2 text-gray-800">
                  <p><span className="font-semibold">Street:</span> {formData.tempStreet}</p>
                  <p><span className="font-semibold">City:</span> {formData.tempCity}</p>
                  <p><span className="font-semibold">State:</span> {formData.tempState}</p>
                  <p><span className="font-semibold">Pin Code:</span> {formData.tempPincode}</p>
                </div>
              </div>
            )}

            <div className="flex gap-4 mt-8">
              <button
                onClick={() => navigate('/admission/step-1')}
                className="flex-1 py-3 px-6 border-2 border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50"
              >
                ← Back
              </button>
              <button
                onClick={() => {
                  if (!formData.tempStreet.trim() || !formData.tempCity.trim() || !formData.tempState.trim() || !formData.tempPincode.trim()) {
                    alert('Please fill all temporary address fields');
                    return;
                  }
                  if (formData.tempPincode.length !== 6) {
                    alert('Temporary pincode must be exactly 6 digits');
                    return;
                  }
                  if (!isSamePermanentAddress && (!formData.permStreet.trim() || !formData.permCity.trim() || !formData.permState.trim() || !formData.permPincode.trim())) {
                    alert('Please fill all permanent address fields');
                    return;
                  }
                  if (!isSamePermanentAddress && formData.permPincode.length !== 6) {
                    alert('Permanent pincode must be exactly 6 digits');
                    return;
                  }
                  navigate('/admission/step-3');
                }}
                className="flex-1 py-3 px-6 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700"
              >
                Next →
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // STEP 3: EMERGENCY CONTACT & REFERRAL
  if (step === 3) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white p-4">
        <div className="max-w-2xl mx-auto">
          <div className="mb-8">
            <div className="flex justify-between items-center mb-4">
              <h1 className="text-3xl font-bold">Emergency Contact & Source</h1>
              <span className="text-blue-600 font-bold">Step 3/7</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-blue-600 h-2 rounded-full" style={{ width: '43%' }}></div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-lg p-8 border border-gray-100">
            <h2 className="text-2xl font-bold mb-6">Contact & Source Information</h2>
            <div className="space-y-4">
              <div>
                <label className="block font-semibold mb-2">Emergency Contact Name <span className="text-red-600">*</span></label>
                <input
                  type="text"
                  name="emergencyContactName"
                  value={formData.emergencyContactName}
                  onChange={handleInputChange}
                  placeholder="Parent/Guardian name"
                  maxLength={50}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold mb-2">Emergency Contact Phone <span className="text-red-600">*</span></label>
                <input
                  type="tel"
                  name="emergencyContactPhone"
                  value={formData.emergencyContactPhone}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 10);
                    setFormData(prev => ({...prev, emergencyContactPhone: val}));
                  }}
                  placeholder="+91 XXXXXXXXXX"
                  maxLength="10"
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold mb-2">How did you hear about us? <span className="text-red-600">*</span></label>
                <select
                  name="referralSource"
                  value={formData.referralSource}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 outline-none"
                >
                  <option value="">Select Source</option>
                  <option value="Google">Google Search</option>
                  <option value="Instagram">Instagram</option>
                  <option value="Facebook">Facebook</option>
                  <option value="Friend">Friend Referral</option>
                  <option value="Family">Family Member</option>
                  <option value="School">School Notice Board</option>
                  <option value="College">College Notice Board</option>
                  <option value="Poster">Local Poster/Flyer</option>
                  <option value="Social Media">Other Social Media</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>
            <div className="flex gap-4 mt-8">
              <button
                onClick={() => navigate('/admission/step-2')}
                className="flex-1 py-3 px-6 border-2 border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50"
              >
                Back
              </button>
              <button
                onClick={() => {
                  if (!formData.emergencyContactName.trim()) {
                    alert('Please enter emergency contact name');
                    return;
                  }
                  if (!formData.emergencyContactPhone.trim()) {
                    alert('Please enter emergency contact phone number');
                    return;
                  }
                  const emergencyPhoneRegex = /^[0-9]{10}$/;
                  const cleanEmergencyPhone = formData.emergencyContactPhone.replace(/[^0-9]/g, '');
                  if (!emergencyPhoneRegex.test(cleanEmergencyPhone)) {
                    alert('Please enter a valid 10-digit emergency contact number');
                    return;
                  }
                  navigate('/admission/step-4');
                }}
                className="flex-1 py-3 px-6 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700"
              >
                Next →
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // STEP 4: MEMBERSHIP PLAN
  if (step === 4) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white p-4">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <div className="flex justify-between items-center mb-4">
              <h1 className="text-3xl font-bold">Choose Membership Plan <span className="text-red-600">*</span></h1>
              <span className="text-blue-600 font-bold">Step 4/7</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-blue-600 h-2 rounded-full" style={{ width: '57%' }}></div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            {Object.entries(PLANS).map(([plan, prices]: any) => (
              <div key={plan}>
                <h3 className="font-bold text-lg mb-4">{plan} <span className="text-red-600">*</span></h3>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => {
                      setSelectedPlan(plan);
                      setSelectedDayType('Half-day');
                    }}
                    className={`p-4 rounded-lg border-2 text-center transition ${
                      selectedPlan === plan && selectedDayType === 'Half-day'
                        ? 'border-blue-600 bg-blue-50'
                        : 'border-gray-300 hover:border-blue-400'
                    }`}
                  >
                    <div className="font-bold text-lg mb-2">Half-day</div>
                    <div className="text-blue-600 font-bold text-xl mb-2">₹{prices['Half-day']}</div>
                    <div className="text-xs text-gray-600 border-t pt-2">
                      <div className="flex justify-between mb-1">
                        <span>Admission</span>
                        <span>₹100</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Fee</span>
                        <span>₹{prices['Half-day'] - 100}</span>
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      setSelectedPlan(plan);
                      setSelectedDayType('Full-day');
                    }}
                    className={`p-4 rounded-lg border-2 text-center transition ${
                      selectedPlan === plan && selectedDayType === 'Full-day'
                        ? 'border-blue-600 bg-blue-50'
                        : 'border-gray-300 hover:border-blue-400'
                    }`}
                  >
                    <div className="font-bold text-lg mb-2">Full-day</div>
                    <div className="text-blue-600 font-bold text-xl mb-2">₹{prices['Full-day']}</div>
                    <div className="text-xs text-gray-600 border-t pt-2">
                      <div className="flex justify-between mb-1">
                        <span>Admission</span>
                        <span>₹100</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Fee</span>
                        <span>₹{prices['Full-day'] - 100}</span>
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-4">
            <button
              onClick={() => navigate('/admission/step-3')}
              className="flex-1 py-3 px-6 border-2 border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50"
            >
              Back
            </button>
            <button
              onClick={() => navigate('/admission/step-5')}
              disabled={!selectedPlan || !selectedDayType}
              className="flex-1 py-3 px-6 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // STEP 5: SLOT & DATE SELECTION
  if (step === 5) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white p-4">
        <div className="max-w-2xl mx-auto">
          <div className="mb-8">
            <div className="flex justify-between items-center mb-4">
              <h1 className="text-3xl font-bold">Select Slot & Date <span className="text-red-600">*</span></h1>
              <span className="text-blue-600 font-bold">Step 5/7</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-blue-600 h-2 rounded-full" style={{ width: '71%' }}></div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-lg p-8 border border-gray-100 space-y-6">
            <div>
              <h3 className="font-bold mb-4">Select Time Slot <span className="text-red-600">*</span></h3>
              <div className="space-y-2">
                {selectedDayType === 'Half-day' ? (
                  <>
                    {(() => {
                      const morning = members.filter(m => m.slot === '9am-3pm' && !m.deleted).length;
                      const evening = members.filter(m => m.slot === '3pm-9pm' && !m.deleted).length;
                      const morningAvail = Math.max(0, SEATS_PER_SLOT - morning);
                      const eveningAvail = Math.max(0, SEATS_PER_SLOT - evening);
                      return (
                        <>
                          <button
                            onClick={() => morningAvail > 0 && setSelectedSlot('9am-3pm')}
                            disabled={morningAvail <= 0}
                            className={`w-full p-3 rounded-lg border-2 text-left transition ${
                              morningAvail <= 0
                                ? 'border-gray-200 bg-gray-100 opacity-60 cursor-not-allowed'
                                : selectedSlot === '9am-3pm'
                                ? 'border-blue-600 bg-blue-50'
                                : 'border-gray-300 hover:border-blue-400'
                            }`}
                          >
                            <div className="font-bold">9 AM - 3 PM</div>
                            <div className="text-sm text-gray-600">Morning slot • {morningAvail > 0 ? `${morningAvail}/${SEATS_PER_SLOT} seats available` : 'FULL — no seats available'}</div>
                          </button>
                          <button
                            onClick={() => eveningAvail > 0 && setSelectedSlot('3pm-9pm')}
                            disabled={eveningAvail <= 0}
                            className={`w-full p-3 rounded-lg border-2 text-left transition ${
                              eveningAvail <= 0
                                ? 'border-gray-200 bg-gray-100 opacity-60 cursor-not-allowed'
                                : selectedSlot === '3pm-9pm'
                                ? 'border-blue-600 bg-blue-50'
                                : 'border-gray-300 hover:border-blue-400'
                            }`}
                          >
                            <div className="font-bold">3 PM - 9 PM</div>
                            <div className="text-sm text-gray-600">Evening slot • {eveningAvail > 0 ? `${eveningAvail}/${SEATS_PER_SLOT} seats available` : 'FULL — no seats available'}</div>
                          </button>
                        </>
                      );
                    })()}
                  </>
                ) : (
                  (() => {
                    const fullday = members.filter(m => m.slot === '9am-9pm' && !m.deleted).length;
                    const fulldayAvail = Math.max(0, SEATS_PER_SLOT - fullday);
                    return (
                      <button
                        onClick={() => fulldayAvail > 0 && setSelectedSlot('9am-9pm')}
                        disabled={fulldayAvail <= 0}
                        className={`w-full p-3 rounded-lg border-2 text-left transition ${
                          fulldayAvail <= 0
                            ? 'border-gray-200 bg-gray-100 opacity-60 cursor-not-allowed'
                            : selectedSlot === '9am-9pm'
                            ? 'border-blue-600 bg-blue-50'
                            : 'border-gray-300 hover:border-blue-400'
                        }`}
                      >
                        <div className="font-bold">9 AM - 9 PM (Full Day)</div>
                        <div className="text-sm text-gray-600">Full day access • {fulldayAvail > 0 ? `${fulldayAvail}/${SEATS_PER_SLOT} seats available` : 'FULL — no seats available'}</div>
                      </button>
                    );
                  })()
                )}
              </div>
            </div>

            <div>
              <h3 className="font-bold mb-4">Select Start Date <span className="text-red-600">*</span></h3>
              <div className="relative">
                <input
                  type="date"
                  value={selectedDate}
                  onChange={e => setSelectedDate(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 outline-none text-base"
                  min={new Date().toISOString().split('T')[0]}
                />
              </div>
            </div>

            {selectedSlot && selectedDate && (
              <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg">
                <div className="font-bold">📅 Booking Summary</div>
                <div className="text-sm text-gray-700 mt-2">
                  <div>Slot: {selectedSlot}</div>
                  <div>Date: {new Date(selectedDate).toDateString()}</div>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-4 mt-6">
            <button
              onClick={() => navigate('/admission/step-4')}
              className="flex-1 py-3 px-6 border-2 border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50"
            >
              Back
            </button>
            <button
              onClick={() => navigate('/admission/step-6')}
              disabled={!selectedSlot || !selectedDate}
              className="flex-1 py-3 px-6 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // STEP 6: PAYMENT
  if (step === 6) {
    const amount = PLANS[selectedPlan as keyof typeof PLANS]?.[selectedDayType as keyof typeof PLANS[keyof typeof PLANS]] || 0;
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white p-4">
        <div className="max-w-2xl mx-auto">
          <div className="mb-8">
            <div className="flex justify-between items-center mb-4">
              <h1 className="text-3xl font-bold">Payment <span className="text-red-600">*</span></h1>
              <span className="text-blue-600 font-bold">Step 6/7</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-blue-600 h-2 rounded-full" style={{ width: '86%' }}></div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-lg p-8 border border-gray-100 space-y-6">
            <div className="bg-blue-50 border border-blue-200 p-6 rounded-lg">
              <div className="font-bold text-lg mb-4">Amount to Pay</div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-700">Admission Fee</span>
                  <span className="font-semibold">₹100</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-700">{selectedPlan} {selectedDayType} Plan</span>
                  <span className="font-semibold">₹{amount - 100}</span>
                </div>
                <div className="border-t-2 pt-2 flex justify-between">
                  <span className="font-bold text-lg">Total Amount</span>
                  <span className="font-bold text-2xl text-blue-600">₹{amount}</span>
                </div>
              </div>
            </div>

            <div>
              <h3 className="font-bold text-lg mb-4">Select Payment Method <span className="text-red-600">*</span></h3>
              <div className="space-y-3">
                <div
                  onClick={() => setPaymentMethod('cash')}
                  className={`p-4 rounded-lg border-2 cursor-pointer transition flex items-center ${
                    paymentMethod === 'cash'
                      ? 'border-blue-600 bg-blue-50'
                      : 'border-gray-300 hover:border-blue-400'
                  }`}
                >
                  <div className={`w-5 h-5 rounded-full border-2 mr-3 flex items-center justify-center ${
                    paymentMethod === 'cash' ? 'border-blue-600 bg-blue-600' : 'border-gray-400'
                  }`}>
                    {paymentMethod === 'cash' && <div className="w-2 h-2 bg-white rounded-full"></div>}
                  </div>
                  <div>
                    <div className="font-bold">💵 Cash Payment</div>
                    <div className="text-sm text-gray-600">Pay at reception</div>
                  </div>
                </div>

                <div
                  onClick={() => setPaymentMethod('upi')}
                  className={`p-4 rounded-lg border-2 cursor-pointer transition flex items-center ${
                    paymentMethod === 'upi'
                      ? 'border-blue-600 bg-blue-50'
                      : 'border-gray-300 hover:border-blue-400'
                  }`}
                >
                  <div className={`w-5 h-5 rounded-full border-2 mr-3 flex items-center justify-center ${
                    paymentMethod === 'upi' ? 'border-blue-600 bg-blue-600' : 'border-gray-400'
                  }`}>
                    {paymentMethod === 'upi' && <div className="w-2 h-2 bg-white rounded-full"></div>}
                  </div>
                  <div>
                    <div className="font-bold">📱 UPI Payment</div>
                    <div className="text-sm text-gray-600">Quick & secure online payment</div>
                  </div>
                </div>
              </div>
            </div>

            {paymentMethod === 'upi' && (
              <div className="space-y-4 border-t pt-6">
                <h3 className="font-bold text-lg">UPI Payment Details <span className="text-red-600">*</span></h3>

                <div>
                  <label className="block text-sm font-semibold mb-2">Upload Payment Screenshot</label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 10 * 1024 * 1024) {
                        showToast('File size must be less than 10MB', "error");
                        return;
                      }
                      try {
                        // Always compress — storing a raw photo inline would blow
                        // past Firestore's 1 MiB document limit and fail the save.
                        const compressed = await compressImage(file);
                        setUpiScreenshot(compressed);
                      } catch (err) {
                        logError('Image compression failed:', err);
                        showToast('Could not process that image. Please try a different screenshot.', "error");
                      }
                    }}
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 outline-none"
                  />
                  {upiScreenshot && <p className="text-sm text-green-600 mt-2">✅ Screenshot uploaded</p>}
                </div>

                <div>
                  <label className="block text-sm font-semibold mb-2">UTR / Transaction ID</label>
                  <input
                    type="text"
                    placeholder="Enter your UPI transaction ID"
                    value={utrNumber}
                    onChange={(e) => setUtrNumber(e.target.value.toUpperCase().slice(0, 30))}
                    maxLength={30}
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 outline-none"
                  />
                </div>
              </div>
            )}

            <div className="flex items-center">
              <input type="checkbox" id="agree" className="mr-2" />
              <label htmlFor="agree" className="text-sm">
                I agree to Terms & Conditions and have read Library Rules <span className="text-red-600">*</span>
              </label>
            </div>
          </div>

          <div className="flex gap-4 mt-6">
            <button
              onClick={() => navigate('/admission/step-5')}
              className="flex-1 py-3 px-6 border-2 border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50"
            >
              Back
            </button>
            <button
              disabled={isSubmitting}
              onClick={async () => {
                try {
                  setIsSubmitting(true);

                  // FIX #11: Validate plan and daytype not empty before using
                  if (!selectedPlan || selectedPlan.trim() === '') {
                    showToast('Please select a plan (Monthly/Quarterly/Half-yearly/Yearly)', "error");
                    setIsSubmitting(false);
                    return;
                  }
                  if (!selectedDayType || selectedDayType.trim() === '') {
                    showToast('Please select day type (Half-day/Full-day)', "error");
                    setIsSubmitting(false);
                    return;
                  }

                  // FIX #6: Validate amount is greater than 0
                  const amount = PLANS[selectedPlan as keyof typeof PLANS]?.[selectedDayType as keyof typeof PLANS[keyof typeof PLANS]] || 0;
                  if (amount <= 0) {
                    showToast('Invalid plan or day type selected - Amount is ₹0', "error");
                    setIsSubmitting(false);
                    return;
                  }

                  const agreeCheckbox = document.getElementById('agree') as HTMLInputElement;
                  if (!agreeCheckbox || !agreeCheckbox.checked) {
                    alert('Please agree to Terms & Conditions');
                    setIsSubmitting(false);
                    return;
                  }

                  if (paymentMethod === 'upi') {
                    if (!upiScreenshot) {
                      alert('Please upload UPI payment screenshot');
                      setIsSubmitting(false);
                      return;
                    }
                    if (!utrNumber.trim()) {
                      alert('Please enter UTR/Transaction ID');
                      setIsSubmitting(false);
                      return;
                    }
                  }

                  const bookingId = generateMembershipId(members.map(m => m.id));

                  log('📝 Starting submission process...');

                  // Step 1: Generate PDF but don't download yet
                  log('📄 Generating PDF...');
                  const pdf = await generatePDF(bookingId, amount);
                  if (pdf) {
                    setPdfDoc(pdf);
                    setPdfBookingId(bookingId);
                    log('✅ PDF generated');
                  }

                  // Step 2: Add member to database
                  log('💾 Saving member to database...');
                  const saved = await addMember({
                    id: bookingId,
                    fullName: sanitizeInput(formData.fullName),
                    email: sanitizeInput(formData.email.toLowerCase()),
                    phone: formData.phone.replace(/[^0-9]/g, ''),
                    dateOfBirth: formData.dateOfBirth,
                    gender: sanitizeInput(formData.gender),
                    currentClass: sanitizeInput(formData.currentClass),
                    targetExam: sanitizeInput(formData.targetExam),
                    schoolCollege: sanitizeInput(formData.schoolCollege),
                    emergencyContactName: sanitizeInput(formData.emergencyContactName),
                    emergencyContactPhone: formData.emergencyContactPhone.replace(/[^0-9]/g, ''),
                    referralSource: sanitizeInput(formData.referralSource),
                    // Temporary Address - Structured
                    tempStreet: sanitizeInput(formData.tempStreet),
                    tempCity: sanitizeInput(formData.tempCity),
                    tempState: sanitizeInput(formData.tempState),
                    tempPincode: formData.tempPincode.trim(),
                    // Permanent Address - Structured (use temp address if same)
                    permStreet: sanitizeInput(isSamePermanentAddress ? formData.tempStreet : formData.permStreet),
                    permCity: sanitizeInput(isSamePermanentAddress ? formData.tempCity : formData.permCity),
                    permState: sanitizeInput(isSamePermanentAddress ? formData.tempState : formData.permState),
                    permPincode: (isSamePermanentAddress ? formData.tempPincode : formData.permPincode).trim(),
                    plan: `${selectedPlan} ${selectedDayType}`,
                    slot: selectedSlot,
                    startDate: selectedDate,
                    amount: amount,
                    paymentMethod: paymentMethod,
                    upiScreenshot: paymentMethod === 'upi' ? upiScreenshot : null,
                    // Save under paymentUTR — the field every admin view reads.
                    // (Previously saved as utrNumber, which the admin UI never showed.)
                    paymentUTR: paymentMethod === 'upi' ? sanitizeInput(utrNumber) : null,
                  });
                  // Step 3: Only advance to the thank-you page if the member was
                  // actually saved. A duplicate/failed save must keep the user on
                  // the payment step so they can correct and retry.
                  if (!saved) {
                    setIsSubmitting(false);
                    return;
                  }
                  log('✅ Member saved. Success modal should show now.');
                  localStorage.removeItem('admissionDraft'); // submitted — drop the draft
                  log('🎉 Navigating to thank you page');
                  navigate('/admission/step-7');
                } catch (error: any) {
                  logError('❌ Submission error:', error);
                  alert('❌ Error during submission:\n' + (error?.message || String(error)));
                  setIsSubmitting(false);
                }
              }}
              disabled={isSubmitting}
              className="flex-1 py-3 px-6 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? '⏳ Submitting...' : '✅ Submit'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // THANK YOU PAGE (shown after successful submission)
  if (step === 7) {
    const amount = PLANS[selectedPlan as keyof typeof PLANS]?.[selectedDayType as keyof typeof PLANS[keyof typeof PLANS]] || 0;
    const bookingId = pdfBookingId || generateMembershipId(members.map(m => m.id));

    return (
      <div className="min-h-screen bg-gradient-to-b from-green-50 to-white p-4">
        <div className="max-w-2xl mx-auto">
          <div className="mb-8">
            <div className="flex justify-between items-center mb-4">
              <h1 className="text-3xl font-bold text-green-600">🎉 Thank You!</h1>
              <span className="text-green-600 font-bold">Step 7/7 - Success</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-green-600 h-2 rounded-full" style={{ width: '100%' }}></div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-lg p-8 border border-gray-100 space-y-6">
            <div className="bg-green-50 border border-green-200 p-6 rounded-lg text-center">
              <div className="text-6xl mb-4">🎊</div>
              <div className="font-bold text-3xl text-green-700">Congratulations!</div>
              <div className="text-gray-600 mt-2 text-lg">Your admission has been successfully submitted</div>
            </div>

            <div className="border border-gray-200 p-6 rounded-lg space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-600">Membership ID</span>
                <span className="font-bold text-blue-600">{bookingId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Name</span>
                <span className="font-bold">{formData.fullName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Email</span>
                <span className="font-bold text-sm">{formData.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">WhatsApp</span>
                <span className="font-bold">{formData.phone}</span>
              </div>
              <div className="flex justify-between border-t pt-3">
                <span className="text-gray-600">Plan</span>
                <span className="font-bold">{selectedPlan} - {selectedDayType}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Time Slot</span>
                <span className="font-bold">{selectedSlot}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Start Date</span>
                <span className="font-bold">{new Date(selectedDate).toDateString()}</span>
              </div>
              <div className="flex justify-between border-t pt-3">
                <span className="font-bold">Amount Paid</span>
                <span className="font-bold text-lg text-green-600">₹{amount}</span>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg text-center">
              <div className="font-bold mb-3">Your QR Code</div>
              <div className="bg-white p-4 rounded inline-block border-2 border-blue-200">
                <div className="w-48 h-48 bg-gradient-to-br from-blue-100 to-blue-200 rounded flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-4xl">📱</div>
                    <div className="text-xs text-gray-600 mt-2">QR Code</div>
                    <div className="text-xs font-bold">{bookingId}</div>
                  </div>
                </div>
              </div>
              <div className="text-sm text-gray-600 mt-3">Show this QR at reception</div>
            </div>

            <div className="space-y-2">
              <button
                onClick={async () => {
                  // generatePDF builds and RETURNS the doc — it does not download.
                  // Use the one made at submit if present, else regenerate, then save.
                  try {
                    const pdf = pdfDoc || await generatePDF(bookingId, amount);
                    if (pdf) pdf.save(`Admission_${bookingId}.pdf`);
                    else showToast('Could not generate the PDF. Please try again.', "error");
                  } catch (e) {
                    logError('PDF download failed:', e);
                    showToast('Could not generate the PDF. Please try again.', "error");
                  }
                }}
                className="w-full py-3 px-6 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700"
              >
                📥 Download Admission PDF
              </button>
              <button
                onClick={() => {
                  resetForm();
                  navigate('/');
                }}
                className="w-full py-3 px-6 border-2 border-blue-600 text-blue-600 font-semibold rounded-lg hover:bg-blue-50"
              >
                🏠 Go to Home
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // SUCCESS MODAL - shown after member is saved
  if (showSuccessModal) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 via-emerald-50 to-white flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full text-center">
          <div className="text-6xl mb-6">🎉</div>
          <h1 className="text-3xl font-bold text-green-600 mb-2">Admission Confirmed!</h1>
          <p className="text-gray-600 mb-6 text-lg">Your membership is now active</p>

          <div className="bg-green-50 border-2 border-green-200 rounded-lg p-4 mb-8">
            <p className="text-sm text-gray-600 mb-2">Your Membership ID</p>
            <p className="text-2xl font-bold text-green-600">{successMemberId}</p>
          </div>

          <p className="text-gray-600 mb-6">
            ✅ PDF generated<br />
            ✅ Data saved to database<br />
            ✅ Admin dashboard updated<br />
            ✅ Ready to start studying!
          </p>

          <div className="space-y-3">
            <button
              onClick={() => {
                if (pdfDoc && pdfBookingId) {
                  pdfDoc.save(`Admission_${pdfBookingId}.pdf`);
                }
              }}
              className="w-full py-3 px-6 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition text-lg"
            >
              📥 Download PDF
            </button>

            <button
              onClick={() => {
                setShowSuccessModal(false);
                navigate('/');
                setTimeout(() => resetForm(), 500);
              }}
              className="w-full py-3 px-6 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 transition text-lg"
            >
              🏠 Back to Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Rest of the component rendering stays the same
  // The useEffect above syncs the URL based on state
}

export default App;
// Updated: Fri Jun 26 12:54:21 IST 2026
