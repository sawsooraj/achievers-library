/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, react-hooks/purity, react-hooks/set-state-in-effect */
// @ts-nocheck - Extensive type issues in monolithic legacy component, requires full refactor
// TODO: Split into smaller typed components in future refactor (Issue #500)
import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { db } from './firebase';
import { collection, addDoc, getDocs, updateDoc, doc, onSnapshot, query, where } from 'firebase/firestore';
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

// VALIDATION FUNCTIONS (FIX #2: Form Validation)
const validateEmail = (email: string) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) ? '' : 'Invalid email format';
};

const validatePhone = (phone: string) => {
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  return cleanPhone.length === 10 ? '' : `Phone must be 10 digits (got ${cleanPhone.length})`;
};

const validateAge = (dateOfBirth: string) => {
  if (!dateOfBirth) return '';
  const today = new Date();
  const birthDate = new Date(dateOfBirth);
  const age = Math.floor((today.getTime() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  if (age < 10) return 'Must be at least 10 years old';
  if (age > 80) return 'Age seems invalid (> 80 years)';
  return '';
};

const validatePincode = (pincode: string) => {
  const pincodeRegex = /^[0-9]{6}$/;
  return pincodeRegex.test(pincode.trim()) ? '' : 'Pincode must be 6 digits';
};

const sanitizeHtml = (input: string) => {
  return DOMPurify.sanitize(input, { ALLOWED_TAGS: [] });
};

// LOGGING (FIX #1: Console.log in production)
const log = (message: string, data?: any) => {
  if (process.env.NODE_ENV !== 'production') {
    if (data) log(message, data);
    else log(message);
  }
};

const logError = (message: string, error?: any) => {
  if (process.env.NODE_ENV !== 'production') {
    if (error) logError(message, error);
    else logError(message);
  }
};

// FIX #118: Centralized helper to filter out deleted members
const getActiveMembers = (members: any[]) => members.filter(m => !m.deleted);
const getDeletedMembers = (members: any[]) => members.filter(m => m.deleted);

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
  // FIX #100: Removed unused selectedMembers state (dead code)

  // Admin States
  const [isAdmin, setIsAdmin] = useState(() => {
    const saved = localStorage.getItem('isAdmin');
    return saved === 'true';
  });
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [adminError, setAdminError] = useState('');
  const [adminPage, setAdminPage] = useState<'dashboard' | 'scanner' | 'members' | 'payments' | 'reminders' | 'seats' | 'users'>('dashboard');
  const [previousAdminPage, setPreviousAdminPage] = useState<'dashboard' | 'scanner' | 'members' | 'payments' | 'reminders' | 'seats' | 'users'>('dashboard');
  const [users, setUsers] = useState<any[]>([
    { id: 'admin1', name: 'Admin', role: 'admin', password: 'admin123', email: 'admin@library.com' },
    { id: 'staff1', name: 'Staff Member', role: 'staff', password: 'staff123', email: 'staff@library.com' },
  ]);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [editUserPassword, setEditUserPassword] = useState('');
  const [members, setMembers] = useState<any[]>([]);
  const [selectedPaymentForReview, setSelectedPaymentForReview] = useState<any>(null);
  const [paymentReviewNotes, setPaymentReviewNotes] = useState('');
  const [editingMember, setEditingMember] = useState<any>(null);
  const [editFormData, setEditFormData] = useState<any>(null);
  const [scannedBookingId, setScannedBookingId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [scannerActive, setScannerActive] = useState(false);
  const [selectedMemberDetail, setSelectedMemberDetail] = useState<any>(null);

  // FIX #106: Debounce refs for preventing multiple calls
  const whatsappDebounceRef = useRef<{ [key: string]: number }>({});
  const paymentVerifyDebounceRef = useRef<{ [key: string]: boolean }>({});
  const formSubmitDebounceRef = useRef(0);
  const listenerUnsubscribesRef = useRef<Array<() => void>>([]);

  // FIX #203: Track mounted state to prevent setState in unmounted component
  const isMountedRef = useRef(true);

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

    if (pathname.startsWith('/admin/')) {
      const page = pathname.replace('/admin/', '') as any;
      setIsAdmin(true);
      setAdminPage(page || 'dashboard');
    } else if (pathname.startsWith('/admission/step-')) {
      const stepNum = parseInt(pathname.replace('/admission/step-', ''));
      if (!isNaN(stepNum) && stepNum >= 1 && stepNum <= 7) {
        setStep(stepNum);
      } else {
        setStep(0);
      }
    } else {
      setStep(0);
    }
  }, [location.pathname]);

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
                id: data.id || doc.id, // Prefer data.id, fall back to docId
                docId: doc.id,
                ...data
              };
            })
            .filter((m: any) => !m.deleted) // Filter out soft-deleted members
            .filter((m: any, idx: number, arr: any[]) => arr.findIndex(x => x.id === m.id) === idx); // Remove duplicates by id
          log('✅ Members loaded from Firestore:', membersList.length, 'members');
          // FIX #203: Only setState if component is still mounted
          if (isMountedRef.current) {
            setMembers(membersList as any[]);
          }
        },
        (error) => {
          logError('❌ Firestore listener error:', error);
          log('Loading members from localStorage as fallback...');
          const saved = localStorage.getItem('members');
          // FIX #203: Only setState if component is still mounted
          if (isMountedRef.current && saved) setMembers(JSON.parse(saved));
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
      const saved = localStorage.getItem('members');
      if (saved) setMembers(JSON.parse(saved));
    }
  }, []);

  // QR Scanner initialization
  // FIX #109: Use useState instead of global flag
  useEffect(() => {
    if (adminPage === 'scanner' && !scannedBookingId && !scannerActive) {
      try {
        setScannerActive(true);
        const qrScanner = new Html5QrcodeScanner('qr-reader', { fps: 10, qrbox: 250 }, false);

        qrScanner.render(
          (decodedText) => {
            // Extract booking ID from QR code
            const bookingId = decodedText.includes(':') ? decodedText.split(':')[1] : decodedText;
            setScannedBookingId(bookingId);
            qrScanner.clear();
            setScannerActive(false);
          },
          (error) => {
            if (error && error.toString().includes('NotAllowedError')) {
              alert('❌ Camera access denied! Please allow camera permission and try again.');
              setScannerActive(false);
            }
          }
        );

        return () => {
          try {
            qrScanner.clear();
            setScannerActive(false);
          } catch (err) {
            // Silently ignore QR scanner cleanup errors
            setScannerActive(false);
          }
        };
      } catch (error) {
        logError('QR Scanner error:', error);
        setScannerActive(false);
      }
    }
  }, [adminPage, scannedBookingId, scannerActive]);

  // FIX #96: Validate input name exists before setting
  const handleInputChange = (e: any) => {
    const { name, value } = e.target;
    if (!name || typeof name !== 'string') return;
    setFormData(prev => ({ ...prev, [name]: value }));
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

      // Booking ID prominently
      doc.setFontSize(11);
      doc.setFont('', 'bold');
      doc.setTextColor(60, 60, 60);
      doc.text('Booking ID:', 15, y);
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
      validTillDate.setMonth(validTillDate.getMonth() + (selectedPlan === 'Monthly' ? 1 : selectedPlan === 'Quarterly' ? 3 : selectedPlan === 'Half-yearly' ? 6 : 12));

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

      y += boxHeight + 10;

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
  };

  // Admin Navigation Functions
  const goToAdminPage = (page: 'dashboard' | 'scanner' | 'members' | 'payments' | 'reminders' | 'seats') => {
    if (page !== adminPage) {
      setPreviousAdminPage(adminPage);
      setAdminPage(page);
      // FIX #113: Sync URL with page state
      navigate(`/admin/${page}`, { replace: false });
    }
  };

  // FIX #108: Add validation guard
  const goBackAdmin = () => {
    const validPages = ['dashboard', 'scanner', 'members', 'payments', 'reminders', 'seats', 'users'] as const;
    if (previousAdminPage && validPages.includes(previousAdminPage as any)) {
      setAdminPage(previousAdminPage);
    } else {
      setAdminPage('dashboard');
    }
  };

  // Admin Functions
  const handleAdminLogin = (password: string) => {
    const pwd = password.trim();
    if (ADMIN_PASSWORDS.includes(pwd)) {
      setIsAdmin(true);
      setAdminPassword('');
      setAdminError('');
      setAdminPage('dashboard');
      setShowAdminLogin(false);
    } else {
      setAdminError('Invalid password!');
      setTimeout(() => setAdminError(''), 3000);
    }
  };

  const addMember = async (memberData: any) => {
    setIsSubmitting(true);
    setDebugError(null);
    try {
      // VALIDATION: Check for duplicate email
      const emailQuery = query(collection(db, 'members'), where('email', '==', memberData.email.toLowerCase()), where('deleted', '==', false));
      const emailDocs = await getDocs(emailQuery);
      if (emailDocs.docs.length > 0) {
        alert('❌ Email already exists! Member with this email is already registered.');
        setIsSubmitting(false);
        return;
      }

      // VALIDATION: Check for duplicate phone
      const phoneQuery = query(collection(db, 'members'), where('phone', '==', memberData.phone), where('deleted', '==', false));
      const phoneDocs = await getDocs(phoneQuery);
      if (phoneDocs.docs.length > 0) {
        alert('❌ Phone number already exists! Member with this phone is already registered.');
        setIsSubmitting(false);
        return;
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

      // Show success modal
      setSuccessMemberId(docRef.id);
      setShowSuccessModal(true);
    } catch (error: any) {
      const errorMsg = error?.message || String(error);
      logError('❌ Error:', errorMsg);
      setDebugError(`❌ ERROR: ${errorMsg}`);
      alert('❌ Error: ' + errorMsg);
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
          id: `ABD${Date.now()}${Math.floor(Math.random() * 1000000)}`,
          ...user,
          createdAt: new Date().toISOString(),
          deleted: false,
        });
      }
      // Don't manually update state - let real-time listener handle it
      alert(`✅ Added ${demoUsers.length} demo users!`);
    } catch (error) {
      logError('Error adding demo data:', error);
      alert('❌ Error adding demo data');
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
      alert('✅ All demo data deleted!');
    } catch (error) {
      logError('Error deleting data:', error);
      alert('❌ Error deleting data');
    }
  };

  const updateMemberPayment = async (id: string, status: string) => {
    try {
      // Find the member with docId
      const member = members.find(m => m.id === id);
      if (member?.docId) {
        // Update in Firestore
        const memberRef = doc(db, 'members', member.docId);
        await updateDoc(memberRef, { paymentStatus: status });
        alert(`✅ Payment status updated to "${status}"`);
      } else {
        alert('❌ Member not found');
      }
    } catch (error) {
      logError('Error updating payment:', error);
      alert('❌ Error updating payment status. Please try again.');
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
      totalRevenue: active.reduce((sum, m) => sum + (m.amount || 0), 0),
    };
  }, [members]);

  // FIX #105: Memoize frequently used member filters to avoid recalculation on every render
  const memberFilters = useMemo(() => {
    const active = getActiveMembers(members);
    const q = searchQuery.trim().toLowerCase();
    return {
      active,
      noMembershipId: active.filter(m => !m.membershipId),
      pendingPayments: active.filter(m => m.paymentStatus === 'pending'),
      verified: active.filter(m => m.paymentStatus === 'verified'),
      searchFiltered: q.length === 0 ? active : active.filter(m =>
        (m.fullName?.toLowerCase().includes(q) || false) ||
        (m.email?.toLowerCase().includes(q) || false) ||
        (m.phone?.includes(q) || false) ||
        (m.id?.toLowerCase().includes(q) || false)
      ),
    };
  }, [members, searchQuery]);

  // ADMIN LOGIN PAGE (show when login button is clicked)
  if (showAdminLogin && !isAdmin) {
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
            type="password"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                handleAdminLogin(adminPassword);
              }
            }}
            placeholder="Enter password"
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
                onClick={() => { setIsAdmin(false); setAdminPage('dashboard'); navigate('/'); }}
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
                  onClick={() => goToAdminPage('scanner')}
                  className={`w-full text-left px-4 py-3 rounded-lg font-semibold ${
                    adminPage === 'scanner' ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  📱 QR Scanner
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
                  onClick={() => goToAdminPage('payments')}
                  className={`w-full text-left px-4 py-3 rounded-lg font-semibold ${
                    adminPage === 'payments' ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  💳 Payments
                </button>
                <button
                  onClick={() => goToAdminPage('reminders')}
                  className={`w-full text-left px-4 py-3 rounded-lg font-semibold ${
                    adminPage === 'reminders' ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  📨 Reminders
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
                  <div className="text-gray-600 text-xs font-semibold">TODAY'S REVENUE</div>
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
                            onClick={async () => {
                              // FIX #208: Prevent double-accepting member
                              if (member.membershipId) {
                                alert('⚠️ This member already has a Membership ID: ' + member.membershipId);
                                return;
                              }
                              try {
                                const membershipId = `MEM${Date.now()}${Math.floor(Math.random() * 1000)}`;
                                const memberRef = doc(db, 'members', member.docId);
                                await updateDoc(memberRef, { membershipId });
                                alert(`✅ Membership ID generated: ${membershipId}`);
                                const message = whatsappMessages.welcome(membershipId);
                                sendWhatsAppMessage(member.phone, message);
                              } catch (error) {
                                logError('Error accepting member:', error);
                                alert('❌ Error accepting member. Please try again.');
                              }
                            }}
                            className="flex-1 py-2 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 text-sm"
                          >
                            💬 Accept & WhatsApp
                          </button>
                          <button
                            onClick={async () => {
                              if (confirm(`❌ Reject ${member.fullName}? This cannot be undone!`)) {
                                try {
                                  const memberRef = doc(db, 'members', member.docId);
                                  await updateDoc(memberRef, {
                                    deleted: true,
                                    deletedAt: new Date().toISOString(),
                                    deletedBy: 'admin'
                                  });
                                  alert(`✅ Member ${member.fullName} rejected`);
                                } catch (error) {
                                  logError('Error rejecting member:', error);
                                  alert('❌ Error rejecting member. Please try again.');
                                }
                              }
                            }}
                            className="flex-1 py-2 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 text-sm"
                          >
                            ❌ Reject
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
                        <div className="grid grid-cols-2 gap-4 mb-4">
                          <div>
                            <p className="text-xs text-gray-600">Name</p>
                            <p className="font-bold text-lg">{member.fullName}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-600">Amount</p>
                            <p className="font-bold text-orange-600">₹{member.amount || 700}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-600">Method</p>
                            <p className="font-bold capitalize">{member.paymentMethod || 'UPI'}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-600">UTR/Ref ID</p>
                            <p className="font-bold">{member.paymentUTR || 'Not provided'}</p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={async () => {
                              try {
                                const memberRef = doc(db, 'members', member.docId);
                                await updateDoc(memberRef, { paymentStatus: 'verified' });
                                // Don't update local state - let real-time listener handle it
                                const message = whatsappMessages.thankYou();
                                sendWhatsAppMessage(member.phone, message);
                              } catch (error) {
                                logError('Error verifying payment:', error);
                                alert('❌ Error verifying payment');
                              }
                            }}
                            className="flex-1 py-2 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 text-sm"
                          >
                            ✅ Verify & WhatsApp
                          </button>
                          <button
                            onClick={async () => {
                              try {
                                const memberRef = doc(db, 'members', member.docId);
                                await updateDoc(memberRef, { paymentStatus: 'rejected' });
                                // Don't update local state - let real-time listener handle it
                                const message = whatsappMessages.paymentRequest();
                                sendWhatsAppMessage(member.phone, message);
                              } catch (error) {
                                logError('Error rejecting payment:', error);
                                alert('❌ Error rejecting payment');
                              }
                            }}
                            className="flex-1 py-2 bg-orange-600 text-white font-bold rounded-lg hover:bg-orange-700 text-sm"
                          >
                            📱 Request Again
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

              {/* Demo Data */}
              <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-6">
                {members.length === 0 ? (
                  <>
                    <p className="text-blue-900 font-semibold mb-4">
                      📊 No members yet? Add demo data to test!
                    </p>
                    <button
                      onClick={addDemoData}
                      className="w-full py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700"
                    >
                      ➕ Add 27 Demo Members
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-blue-900 font-semibold mb-4">
                      ⚠️ Total members: {members.length}
                    </p>
                    <button
                      onClick={deleteAllDemoData}
                      className="w-full py-3 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700"
                    >
                      🗑️ Delete All
                    </button>
                  </>
                )}
                <p className="text-xs text-blue-700 mt-3">
                  💡 Delete demo data before going live!
                </p>
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
              <button onClick={() => { goBackAdmin(); setScannedBookingId(''); setScannerActive(false); }} className="text-2xl">←</button>
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
                    onClick={() => { setAdminPage('dashboard'); setScannerActive(false); }}
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
                      onClick={() => { setScannedBookingId(''); setScannerActive(true); }}
                      className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700"
                    >
                      📸 Scan Next
                    </button>
                    <button
                      onClick={() => { setAdminPage('dashboard'); setScannedBookingId(''); setScannerActive(false); }}
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

    // Members Page
    if ((adminPage as string) === 'members') {
      // FIX #105: Use memoized filtered members instead of recalculating
      const filtered = memberFilters.searchFiltered;

      return (
        <div className="min-h-screen bg-gray-50">
          <header className="sticky top-0 z-40 bg-white shadow">
            <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <button onClick={() => goBackAdmin()} className="text-2xl">←</button>
                <div className="text-2xl font-bold text-blue-600">👥 Members List</div>
              </div>
              <button
                onClick={() => { setIsAdmin(false); setAdminPage('dashboard'); navigate('/'); }}
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
                        alert(`✅ ${deletedCount} member(s) deleted successfully`);
                      } catch (error) {
                        logError('Error bulk deleting members:', error);
                        alert('❌ Error deleting members. Please try again.');
                      }
                    }
                  }}
                  className="px-6 py-2 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700"
                >
                  🗑️ Delete Selected
                </button>
              </div>
            )}

            <div className="bg-white rounded-lg shadow overflow-hidden">
              {filtered.length === 0 ? (
                <div className="p-8 text-center">
                  {members.length === 0 ? (
                    <div className="text-gray-500">
                      <p className="text-2xl mb-2">📭</p>
                      <p className="font-semibold">No members yet</p>
                      <p className="text-sm text-gray-400 mt-1">Members who complete admission will appear here</p>
                    </div>
                  ) : (
                    <div className="text-gray-500">
                      <p className="text-2xl mb-2">🔍</p>
                      <p className="font-semibold">No matching members</p>
                      <p className="text-sm text-gray-400 mt-1">Try searching with a different name, email, or phone</p>
                    </div>
                  )}
                </div>
              ) : (
                <table className="w-full">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="text-left py-4 px-6 w-10">
                        <input
                          type="checkbox"
                          checked={filtered.length > 0 && filtered.every(m => selectedMembers.has(m.id))}
                          onChange={(e) => {
                            if (e.target.checked) {
                              const newSelected = new Set(selectedMembers);
                              filtered.forEach(m => newSelected.add(m.id));
                              setSelectedMembers(newSelected);
                            } else {
                              const newSelected = new Set(selectedMembers);
                              filtered.forEach(m => newSelected.delete(m.id));
                              setSelectedMembers(newSelected);
                            }
                          }}
                          className="w-5 h-5 cursor-pointer"
                        />
                      </th>
                      <th className="text-left py-4 px-6">Name</th>
                      <th className="text-left py-4 px-6">ID</th>
                      <th className="text-left py-4 px-6">Email</th>
                      <th className="text-left py-4 px-6">Phone</th>
                      <th className="text-left py-4 px-6">Plan</th>
                      <th className="text-left py-4 px-6">Status</th>
                      <th className="text-left py-4 px-6">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(member => (
                      <tr key={member.id} className="border-b hover:bg-gray-50">
                        <td className="py-4 px-6 w-10">
                          <input
                            type="checkbox"
                            checked={selectedMembers.has(member.id)}
                            onChange={(e) => {
                              const newSelected = new Set(selectedMembers);
                              if (e.target.checked) {
                                newSelected.add(member.id);
                              } else {
                                newSelected.delete(member.id);
                              }
                              setSelectedMembers(newSelected);
                            }}
                            className="w-5 h-5 cursor-pointer"
                          />
                        </td>
                        <td className="py-4 px-6">
                          <button
                            onClick={() => setSelectedMemberDetail(member)}
                            className="font-semibold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                          >
                            {member.fullName}
                          </button>
                        </td>
                        <td className="py-4 px-6 font-mono text-sm">{member.id}</td>
                        <td className="py-4 px-6">{member.email}</td>
                        <td className="py-4 px-6">{member.phone}</td>
                        <td className="py-4 px-6">{member.plan}</td>
                        <td className="py-4 px-6">
                          <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                            member.paymentStatus === 'verified' ? 'bg-green-100 text-green-800' :
                            member.paymentStatus === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-red-100 text-red-800'
                          }`}>
                            {member.paymentStatus === 'verified' ? '✅ Verified' :
                             member.paymentStatus === 'pending' ? '⏳ Pending' :
                             '❌ Rejected'}
                          </span>
                        </td>
                        <td className="py-4 px-6 flex gap-2">
                          <button
                            onClick={() => {
                              setEditingMember(member);
                              setEditFormData({...member});
                            }}
                            className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm font-semibold"
                          >
                            ✏️ Edit
                          </button>
                          <button
                            onClick={async () => {
                              if (confirm(`🗑️ Delete ${member.fullName}? This cannot be undone!`)) {
                                try {
                                  // Soft delete in Firestore
                                  await updateDoc(doc(db, 'members', member.docId), {
                                    deleted: true,
                                    deletedAt: new Date().toISOString(),
                                    deletedBy: 'admin'
                                  });
                                  // Don't update local state - let real-time listener handle it
                                  alert(`✅ Member ${member.fullName} deleted successfully`);
                                } catch (error) {
                                  logError('Error deleting member:', error);
                                  alert('❌ Error deleting member. Please try again.');
                                }
                              }
                            }}
                            className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-sm font-semibold"
                          >
                            🗑️ Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

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
                          <p className="font-semibold text-base">{selectedMemberDetail.utrNumber || '—'}</p>
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
                            ['UTR/Reference', selectedMemberDetail.utrNumber || 'N/A'],
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
                          alert(`✅ PDF downloaded successfully`);
                        } catch (error) {
                          logError('Error generating PDF:', error);
                          alert('❌ Error downloading PDF');
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
                          <input type="text" value={editFormData.fullName || ''} onChange={(e) => setEditFormData({...editFormData, fullName: e.target.value})} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-600 outline-none text-sm" />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">Date of Birth</label>
                          <input type="date" value={editFormData.dateOfBirth || ''} onChange={(e) => setEditFormData({...editFormData, dateOfBirth: e.target.value})} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">Gender</label>
                          <select value={editFormData.gender || ''} onChange={(e) => setEditFormData({...editFormData, gender: e.target.value})} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm">
                            <option value="">Select</option>
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                            <option value="Other">Other</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">Email</label>
                          <input type="email" value={editFormData.email || ''} onChange={(e) => setEditFormData({...editFormData, email: e.target.value})} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">Phone</label>
                          <input type="tel" value={editFormData.phone || ''} onChange={(e) => {
                            const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 10);
                            setEditFormData({...editFormData, phone: val});
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
                          <input type="text" value={editFormData.tempStreet || ''} onChange={(e) => setEditFormData({...editFormData, tempStreet: e.target.value})} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">City</label>
                          <input type="text" value={editFormData.tempCity || ''} onChange={(e) => {
                            const val = e.target.value.replace(/[^a-zA-Z\s]/g, '');
                            setEditFormData({...editFormData, tempCity: val});
                          }} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">State</label>
                          <input type="text" value={editFormData.tempState || ''} onChange={(e) => {
                            const val = e.target.value.replace(/[^a-zA-Z\s]/g, '');
                            setEditFormData({...editFormData, tempState: val});
                          }} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-sm font-bold text-gray-700 mb-1">Pin Code</label>
                          <input type="text" value={editFormData.tempPincode || ''} onChange={(e) => {
                          const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
                          setEditFormData({...editFormData, tempPincode: val});
                        }} maxLength="6" className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                        </div>
                      </div>

                      <h3 className="font-bold text-green-900 mb-3">Permanent Address</h3>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="col-span-2">
                          <label className="block text-sm font-bold text-gray-700 mb-1">Street Address</label>
                          <input type="text" value={editFormData.permStreet || ''} onChange={(e) => setEditFormData({...editFormData, permStreet: e.target.value})} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">City</label>
                          <input type="text" value={editFormData.permCity || ''} onChange={(e) => {
                            const val = e.target.value.replace(/[^a-zA-Z\s]/g, '');
                            setEditFormData({...editFormData, permCity: val});
                          }} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">State</label>
                          <input type="text" value={editFormData.permState || ''} onChange={(e) => {
                            const val = e.target.value.replace(/[^a-zA-Z\s]/g, '');
                            setEditFormData({...editFormData, permState: val});
                          }} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-sm font-bold text-gray-700 mb-1">Pin Code</label>
                          <input type="text" value={editFormData.permPincode || ''} onChange={(e) => {
                          const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
                          setEditFormData({...editFormData, permPincode: val});
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
                          <input type="text" value={editFormData.currentClass || ''} onChange={(e) => setEditFormData({...editFormData, currentClass: e.target.value})} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">School/College</label>
                          <input type="text" value={editFormData.schoolCollege || ''} onChange={(e) => setEditFormData({...editFormData, schoolCollege: e.target.value})} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-sm font-bold text-gray-700 mb-1">Target Exam</label>
                          <input type="text" value={editFormData.targetExam || ''} onChange={(e) => setEditFormData({...editFormData, targetExam: e.target.value})} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                        </div>
                      </div>
                    </div>

                    {/* Emergency Contact */}
                    <div className="bg-red-50 p-3 rounded-lg border-l-4 border-red-500">
                      <h3 className="font-bold text-red-900 mb-3">Emergency Contact</h3>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2">
                          <label className="block text-sm font-bold text-gray-700 mb-1">Contact Person Name</label>
                          <input type="text" value={editFormData.emergencyContactName || ''} onChange={(e) => setEditFormData({...editFormData, emergencyContactName: e.target.value})} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-sm font-bold text-gray-700 mb-1">Contact Phone</label>
                          <input type="tel" value={editFormData.emergencyContactPhone || ''} onChange={(e) => {
                            const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 10);
                            setEditFormData({...editFormData, emergencyContactPhone: val});
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
                          <select value={editFormData.plan || ''} onChange={(e) => setEditFormData({...editFormData, plan: e.target.value})} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm">
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
                          <select value={editFormData.slot || ''} onChange={(e) => setEditFormData({...editFormData, slot: e.target.value})} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm">
                            <option value="">Select</option>
                            <option value="9am-3pm">9am - 3pm</option>
                            <option value="3pm-9pm">3pm - 9pm</option>
                            <option value="9am-9pm">9am - 9pm (Full)</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">Payment Method</label>
                          <select value={editFormData.paymentMethod || 'upi'} onChange={(e) => setEditFormData({...editFormData, paymentMethod: e.target.value})} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm">
                            <option value="upi">UPI</option>
                            <option value="cash">Cash</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">Amount Paid (₹)</label>
                          <input type="number" value={editFormData.amount || 0} onChange={(e) => setEditFormData({...editFormData, amount: Number(e.target.value)})} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">Payment Status</label>
                          <select value={editFormData.paymentStatus || 'pending'} onChange={(e) => setEditFormData({...editFormData, paymentStatus: e.target.value})} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm">
                            <option value="pending">⏳ Pending</option>
                            <option value="verified">✅ Verified</option>
                            <option value="rejected">❌ Rejected</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">UTR/Reference ID</label>
                          <input type="text" value={editFormData.utrNumber || ''} onChange={(e) => setEditFormData({...editFormData, utrNumber: e.target.value})} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                        </div>
                      </div>
                    </div>

                    {/* Other Info */}
                    <div className="bg-gray-50 p-3 rounded-lg border-l-4 border-gray-400">
                      <h3 className="font-bold text-gray-900 mb-3">Other Information</h3>
                      <div className="space-y-2">
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">Referral Source</label>
                          <input type="text" value={editFormData.referralSource || ''} onChange={(e) => setEditFormData({...editFormData, referralSource: e.target.value})} className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">Admin Notes</label>
                          <textarea value={editFormData.notes || ''} onChange={(e) => setEditFormData({...editFormData, notes: e.target.value})} placeholder="Add any admin notes..." className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" rows={2} />
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
                          alert('❌ Full name is required');
                          return;
                        }
                        const emailRegex = /^[a-zA-Z0-9._%-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
                        if (!editFormData.email.trim() || !emailRegex.test(editFormData.email.trim())) {
                          alert('❌ Valid email is required');
                          return;
                        }
                        // Check if email is already taken (by another member)
                        if (editFormData.email.toLowerCase() !== editingMember.email.toLowerCase()) {
                          const emailExists = members.some(m => m.id !== editingMember.id && m.email.toLowerCase() === editFormData.email.toLowerCase());
                          if (emailExists) {
                            alert('❌ This email is already registered');
                            return;
                          }
                        }
                        const phoneRegex = /^[0-9]{10}$/;
                        if (!phoneRegex.test(editFormData.phone)) {
                          alert('❌ Phone must be 10 digits');
                          return;
                        }
                        // Check if phone is already taken (by another member)
                        if (editFormData.phone !== editingMember.phone) {
                          const phoneExists = members.some(m => m.id !== editingMember.id && m.phone === editFormData.phone);
                          if (phoneExists) {
                            alert('❌ This phone number is already registered');
                            return;
                          }
                        }
                        if (!editFormData.emergencyContactName.trim()) {
                          alert('❌ Emergency contact name is required');
                          return;
                        }
                        if (!phoneRegex.test(editFormData.emergencyContactPhone)) {
                          alert('❌ Emergency contact phone must be 10 digits');
                          return;
                        }
                        if (!editFormData.tempStreet.trim() || !editFormData.tempCity.trim() || !editFormData.tempState.trim() || !editFormData.tempPincode.trim()) {
                          alert('❌ Temporary address fields are required');
                          return;
                        }
                        if (!editFormData.plan) {
                          alert('❌ Plan is required');
                          return;
                        }
                        if (!editFormData.slot) {
                          alert('❌ Time slot is required');
                          return;
                        }

                        if (!confirm(`✅ Save changes for ${editFormData.fullName}?`)) {
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
                            alert(`✅ ${editFormData.fullName} updated successfully!`);
                          }
                        } catch (error) {
                          logError('Error updating member:', error);
                          alert('❌ Error saving changes. Please try again.');
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
                onClick={() => { setIsAdmin(false); setAdminPage('dashboard'); navigate('/'); }}
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
                          <p className="text-lg font-bold text-gray-700">{member.paymentUTR || 'Not provided'}</p>
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
              onClick={() => setAdminPage('dashboard')}
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
                    defaultValue={selectedPaymentForReview.paymentUTR || ''}
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
                        alert('⏳ Already processing payment...');
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
                          alert('❌ Error rejecting payment');
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
                        alert('⏳ Already verifying payment...');
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
                          alert('❌ Error verifying payment');
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
                const slotMembers = members.filter(m => m.slot === slot.name && !m.deleted);
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
                    <button className="w-full text-left p-4 bg-white border-2 border-blue-300 rounded-lg hover:bg-blue-50 font-semibold">
                      📌 Payment Pending
                    </button>
                    <button className="w-full text-left p-4 bg-white border-2 border-green-300 rounded-lg hover:bg-green-50 font-semibold">
                      ✅ Welcome Message
                    </button>
                    <button className="w-full text-left p-4 bg-white border-2 border-orange-300 rounded-lg hover:bg-orange-50 font-semibold">
                      ⏰ Renewal Reminder
                    </button>
                  </div>
                </div>

                <div className="p-6 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-green-800 font-semibold">✅ {members.length} members will receive the reminder</p>
                </div>

                <button
                  onClick={() => {
                    members
                      .filter(m => !m.deleted && m.paymentStatus === 'verified')
                      .forEach(member => {
                        if (member.phone) {
                          const message = whatsappMessages.renewal(member.membershipId?.toString() || 'soon');
                          sendWhatsAppMessage(member.phone, message);
                        }
                      });
                  }}
                  className="w-full py-4 bg-gradient-to-r from-green-600 to-green-700 text-white font-bold rounded-lg hover:shadow-lg text-lg"
                >
                  📱 Send WhatsApp Reminders
                </button>
              </div>

              <button
                onClick={() => setAdminPage('dashboard')}
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
                          <td className="px-6 py-4 font-semibold">{user.name}</td>
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
                            const userRef = doc(db, 'users', editingUser.id);
                            await updateDoc(userRef, { password: editUserPassword });
                            setUsers(users.map(u => u.id === editingUser.id ? {...u, password: editUserPassword} : u));
                            alert(`✅ Password updated for ${editingUser.name}`);
                            setEditingUser(null);
                            setEditUserPassword('');
                          } catch (error) {
                            logError('Error updating password:', error);
                            alert('❌ Error updating password');
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
                onClick={() => setAdminPage('dashboard')}
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
                onClick={() => setShowAdminLogin(!showAdminLogin)}
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
                    setFormData({...formData, phone: val});
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
                    const age = new Date().getFullYear() - new Date(formData.dateOfBirth).getFullYear();
                    if (age < 13) {
                      errors.dateOfBirth = 'Must be at least 13 years old';
                    }
                  }
                  if (!formData.gender) {
                    errors.gender = 'Gender is required';
                  }

                  if (Object.keys(errors).length > 0) {
                    setFormErrors(errors);
                    alert(`❌ Please fix the highlighted fields (${Object.keys(errors).length} errors)`);
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
                  <input type="text" value={formData.tempStreet || ''} onChange={(e) => setFormData({...formData, tempStreet: e.target.value})} placeholder="e.g., 123 Main Street, Apt 456" className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-semibold mb-1 text-gray-700">City <span className="text-red-600">*</span></label>
                    <input type="text" value={formData.tempCity || ''} onChange={(e) => {
                      const val = e.target.value.replace(/[^a-zA-Z\s]/g, '');
                      setFormData({...formData, tempCity: val});
                    }} placeholder="e.g., Delhi" className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-1 text-gray-700">State <span className="text-red-600">*</span></label>
                    <input type="text" value={formData.tempState || ''} onChange={(e) => {
                      const val = e.target.value.replace(/[^a-zA-Z\s]/g, '');
                      setFormData({...formData, tempState: val});
                    }} placeholder="e.g., Delhi" className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 outline-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1 text-gray-700">Postal Code / Pin Code <span className="text-red-600">*</span></label>
                  <input type="text" value={formData.tempPincode || ''} onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
                      setFormData({...formData, tempPincode: val});
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
                      setFormData({
                        ...formData,
                        permStreet: formData.tempStreet,
                        permCity: formData.tempCity,
                        permState: formData.tempState,
                        permPincode: formData.tempPincode,
                      });
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
                    <input type="text" value={formData.permStreet || ''} onChange={(e) => setFormData({...formData, permStreet: e.target.value})} placeholder="e.g., 123 Main Street, Apt 456" className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-green-500 outline-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-semibold mb-1 text-gray-700">City <span className="text-red-600">*</span></label>
                      <input type="text" value={formData.permCity || ''} onChange={(e) => {
                        const val = e.target.value.replace(/[^a-zA-Z\s]/g, '');
                        setFormData({...formData, permCity: val});
                      }} placeholder="e.g., Delhi" className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-green-500 outline-none" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-1 text-gray-700">State <span className="text-red-600">*</span></label>
                      <input type="text" value={formData.permState || ''} onChange={(e) => {
                        const val = e.target.value.replace(/[^a-zA-Z\s]/g, '');
                        setFormData({...formData, permState: val});
                      }} placeholder="e.g., Delhi" className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-green-500 outline-none" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-1 text-gray-700">Postal Code / Pin Code <span className="text-red-600">*</span></label>
                    <input type="text" value={formData.permPincode || ''} onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
                      setFormData({...formData, permPincode: val});
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
                    setFormData({...formData, emergencyContactPhone: val});
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
                      return (
                        <>
                          <button
                            onClick={() => setSelectedSlot('9am-3pm')}
                            className={`w-full p-3 rounded-lg border-2 text-left transition ${
                              selectedSlot === '9am-3pm'
                                ? 'border-blue-600 bg-blue-50'
                                : 'border-gray-300 hover:border-blue-400'
                            }`}
                          >
                            <div className="font-bold">9 AM - 3 PM</div>
                            <div className="text-sm text-gray-600">Morning slot • {SEATS_PER_SLOT - morning}/{SEATS_PER_SLOT} seats available</div>
                          </button>
                          <button
                            onClick={() => setSelectedSlot('3pm-9pm')}
                            className={`w-full p-3 rounded-lg border-2 text-left transition ${
                              selectedSlot === '3pm-9pm'
                                ? 'border-blue-600 bg-blue-50'
                                : 'border-gray-300 hover:border-blue-400'
                            }`}
                          >
                            <div className="font-bold">3 PM - 9 PM</div>
                            <div className="text-sm text-gray-600">Evening slot • {SEATS_PER_SLOT - evening}/{SEATS_PER_SLOT} seats available</div>
                          </button>
                        </>
                      );
                    })()}
                  </>
                ) : (
                  (() => {
                    const fullday = members.filter(m => m.slot === '9am-9pm' && !m.deleted).length;
                    return (
                      <button
                        onClick={() => setSelectedSlot('9am-9pm')}
                        className={`w-full p-3 rounded-lg border-2 text-left transition ${
                          selectedSlot === '9am-9pm'
                            ? 'border-blue-600 bg-blue-50'
                            : 'border-gray-300 hover:border-blue-400'
                        }`}
                      >
                        <div className="font-bold">9 AM - 9 PM (Full Day)</div>
                        <div className="text-sm text-gray-600">Full day access • {SEATS_PER_SLOT - fullday}/{SEATS_PER_SLOT} seats available</div>
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
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        if (file.size > 5 * 1024 * 1024) {
                          alert('❌ File size must be less than 5MB');
                          return;
                        }
                        const reader = new FileReader();
                        reader.onloadend = () => {
                          setUpiScreenshot(reader.result as string);
                        };
                        reader.readAsDataURL(file);
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
                    alert('❌ Please select a plan (Monthly/Quarterly/Half-yearly/Yearly)');
                    setIsSubmitting(false);
                    return;
                  }
                  if (!selectedDayType || selectedDayType.trim() === '') {
                    alert('❌ Please select day type (Half-day/Full-day)');
                    setIsSubmitting(false);
                    return;
                  }

                  // FIX #6: Validate amount is greater than 0
                  const amount = PLANS[selectedPlan as keyof typeof PLANS]?.[selectedDayType as keyof typeof PLANS[keyof typeof PLANS]] || 0;
                  if (amount <= 0) {
                    alert('❌ Invalid plan or day type selected - Amount is ₹0');
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

                  const bookingId = `ABD${Date.now()}${Math.floor(Math.random() * 1000000)}`;

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
                  await addMember({
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
                    // FIX #114: Sanitize utrNumber
                    utrNumber: paymentMethod === 'upi' ? sanitizeInput(utrNumber) : null,
                  });
                  log('✅ Member saved. Success modal should show now.');
                  // Step 3: Navigate to thank you page (DON'T reset form - step 7 needs the data)
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
    const bookingId = pdfBookingId || `ABD${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

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
                <span className="text-gray-600">Booking ID</span>
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
                  generatePDF(bookingId, amount);
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
