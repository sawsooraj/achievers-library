// @ts-nocheck
import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { db } from './firebase';
import { collection, addDoc, getDocs, updateDoc, doc } from 'firebase/firestore';

// Configuration
const ADMIN_PASSWORDS = ['admin123', 'admin', 'library'];
const TOTAL_SEATS = 69;
const SEATS_PER_SLOT = 23;
const SLOTS = ['9am-3pm', '3pm-9pm', '9am-9pm'] as const;
import './index.css';

const PLANS = {
  Monthly: { 'Half-day': 700, 'Full-day': 1200 },
  Quarterly: { 'Half-day': 1700, 'Full-day': 3200 },
  'Half-yearly': { 'Half-day': 3200, 'Full-day': 6000 },
  Yearly: { 'Half-day': 6000, 'Full-day': 10000 },
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
  };

  const [formData, setFormData] = useState(initialFormData);
  const [selectedPlan, setSelectedPlan] = useState('');
  const [selectedDayType, setSelectedDayType] = useState('');
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [selectedSlot, setSelectedSlot] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('upi');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingMember, setIsSavingMember] = useState(false);

  // Admin States
  const [isAdmin, setIsAdmin] = useState(() => {
    const saved = localStorage.getItem('isAdmin');
    return saved === 'true';
  });
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [adminError, setAdminError] = useState('');
  const [adminPage, setAdminPage] = useState<'dashboard' | 'scanner' | 'members' | 'payments' | 'reminders' | 'seats'>('dashboard');
  const [previousAdminPage, setPreviousAdminPage] = useState<'dashboard' | 'scanner' | 'members' | 'payments' | 'reminders' | 'seats'>('dashboard');
  const [members, setMembers] = useState<any[]>([]);
  const [selectedPaymentForReview, setSelectedPaymentForReview] = useState<any>(null);
  const [paymentReviewNotes, setPaymentReviewNotes] = useState('');
  const [editingMember, setEditingMember] = useState<any>(null);
  const [editFormData, setEditFormData] = useState<any>(null);
  const [scannedBookingId, setScannedBookingId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [scannerActive, setScannerActive] = useState(false);
  const [selectedMemberDetail, setSelectedMemberDetail] = useState<any>(null);

  // Persist admin login state
  useEffect(() => {
    localStorage.setItem('isAdmin', String(isAdmin));
  }, [isAdmin]);

  // Parse URL and sync to step/admin state (URL is source of truth)
  useEffect(() => {
    const pathname = location.pathname || '/';

    if (pathname.startsWith('/admin/')) {
      const page = pathname.replace('/admin/', '') as any;
      setIsAdmin(true);
      setAdminPage(page || 'dashboard');
    } else if (pathname.startsWith('/admission/step-')) {
      const stepNum = parseInt(pathname.replace('/admission/step-', ''));
      if (!isNaN(stepNum)) {
        setStep(stepNum);
      }
    } else {
      setStep(0);
    }
  }, [location.pathname]);

  // Load members from Firestore
  useEffect(() => {
    const loadMembers = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, 'members'));
        const membersList = querySnapshot.docs.map(doc => ({
          docId: doc.id,
          ...doc.data()
        }));
        setMembers(membersList as any[]);
      } catch (error) {
        console.log('Loading members from localStorage as fallback...');
        const saved = localStorage.getItem('members');
        if (saved) setMembers(JSON.parse(saved));
      }
    };
    loadMembers();
  }, []);

  // QR Scanner initialization
  useEffect(() => {
    if (adminPage === 'scanner' && !scannedBookingId && !window.__qrScannerActive) {
      try {
        window.__qrScannerActive = true;
        const qrScanner = new Html5QrcodeScanner('qr-reader', { fps: 10, qrbox: 250 }, false);

        qrScanner.render(
          (decodedText) => {
            // Extract booking ID from QR code
            const bookingId = decodedText.includes(':') ? decodedText.split(':')[1] : decodedText;
            setScannedBookingId(bookingId);
            qrScanner.clear();
            window.__qrScannerActive = false;
          },
          (error) => {
            // Silently ignore scanning errors
          }
        );

        return () => {
          try {
            qrScanner.clear();
            window.__qrScannerActive = false;
          } catch (err) {}
        };
      } catch (error) {
        console.error('QR Scanner error:', error);
        window.__qrScannerActive = false;
      }
    }
  }, [adminPage, scannedBookingId]);

  const handleInputChange = (e: any) => {
    const { name, value } = e.target;
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

      // Save
      doc.save(`Admission_${bookingId}.pdf`);
    } catch (error) {
      console.error('PDF generation error:', error);
      alert('Error generating PDF. Please try again.');
    }
  };

  // WhatsApp Messages & Helper
  const sendWhatsAppMessage = (phoneNumber: string, message: string) => {
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
    welcome: (membershipId: number) => `Hello! Welcome to Achievers Library. Your Membership ID: ${membershipId}. Start studying and achieve your goals! 📚`,
    thankYou: () => `Thank you for your payment! Your membership is now active. Happy studying! 📚`,
    paymentRequest: () => `We didn't receive your payment confirmation. Please share the payment screenshot again. Thanks!`,
    renewal: (date: string) => `Your membership expires on ${date}. Renew now to continue studying! 📚`,
  };

  // Form reset function
  const resetForm = () => {
    setFormData(initialFormData);
    setSelectedPlan('');
    setSelectedDayType('');
    setSelectedSlot('');
    setPaymentMethod('upi');
    setSelectedDate(new Date().toISOString().split('T')[0]);
  };

  // Admin Navigation Functions
  const goToAdminPage = (page: 'dashboard' | 'scanner' | 'members' | 'payments' | 'reminders' | 'seats') => {
    if (page !== adminPage) {
      setPreviousAdminPage(adminPage);
      setAdminPage(page);
    }
  };

  const goBackAdmin = () => {
    setAdminPage(previousAdminPage);
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
    try {
      const newMember = {
        id: `ABD${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
        ...memberData,
        createdAt: new Date().toISOString(),
        paymentStatus: 'verified',
        verified: true,
      };

      // Save to Firestore
      await addDoc(collection(db, 'members'), newMember);

      // Also update local state
      setMembers([...members, newMember]);
    } catch (error) {
      console.error('Error adding member:', error);
      alert('Error saving membership. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const addDemoData = async () => {
    // First delete all existing data
    const existingDocs = await getDocs(collection(db, 'members'));
    for (const docSnapshot of existingDocs.docs) {
      await updateDoc(doc(db, 'members', docSnapshot.id), { deleted: true });
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
          id: `ABD${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
          ...user,
          createdAt: new Date().toISOString(),
          verified: user.paymentStatus === 'verified',
        });
      }
      // Reload members
      const querySnapshot = await getDocs(collection(db, 'members'));
      const membersList = querySnapshot.docs.map(doc => ({
        docId: doc.id,
        ...doc.data()
      }));
      setMembers(membersList as any[]);
      alert(`✅ Added ${demoUsers.length} demo users!`);
    } catch (error) {
      console.error('Error adding demo data:', error);
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
      setMembers([]);
      alert('✅ All demo data deleted!');
    } catch (error) {
      console.error('Error deleting data:', error);
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
      }

      // Update local state
      setMembers(members.map(m => m.id === id ? { ...m, paymentStatus: status } : m));
      alert(`✅ Payment status updated to "${status}"`);
    } catch (error) {
      console.error('Error updating payment:', error);
      alert('❌ Error updating payment status. Please try again.');
    }
  };

  const getStats = () => ({
    totalMembers: members.length,
    pendingPayments: members.filter(m => m.paymentStatus === 'pending').length,
    verifiedMembers: members.filter(m => m.verified).length,
    totalRevenue: members.reduce((sum, m) => sum + (m.amount || 0), 0),
  });

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
              <p className="text-sm mt-1">Try: admin123, admin, or library</p>
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
      const stats = getStats();
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
                <h2 className="text-xl font-bold text-green-700 mb-4">🆕 New Admissions Pending ({members.filter(m => !m.membershipId).length})</h2>
                {members.filter(m => !m.membershipId).length === 0 ? (
                  <p className="text-gray-500">No pending admissions</p>
                ) : (
                  <div className="space-y-4">
                    {members.filter(m => !m.membershipId).map(member => (
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
                            onClick={() => {
                              const membershipId = Math.floor(10000 + Math.random() * 90000);
                              setMembers(members.map(m => m.id === member.id ? { ...m, membershipId } : m));
                              const message = whatsappMessages.welcome(membershipId);
                              sendWhatsAppMessage(member.phone, message);
                            }}
                            className="flex-1 py-2 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 text-sm"
                          >
                            💬 Accept & WhatsApp
                          </button>
                          <button
                            onClick={() => {
                              setMembers(members.filter(m => m.id !== member.id));
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
              </div>

              {/* Section 2: Pending Payments */}
              <div className="bg-white rounded-lg shadow p-6 mb-6">
                <h2 className="text-xl font-bold text-orange-700 mb-4">💰 Pending Payments to Verify ({members.filter(m => m.paymentStatus === 'pending').length})</h2>
                {members.filter(m => m.paymentStatus === 'pending').length === 0 ? (
                  <p className="text-gray-500">No pending payments</p>
                ) : (
                  <div className="space-y-4">
                    {members.filter(m => m.paymentStatus === 'pending').map(member => (
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
                            onClick={() => {
                              setMembers(members.map(m => m.id === member.id ? { ...m, paymentStatus: 'verified' } : m));
                              const message = whatsappMessages.thankYou();
                              sendWhatsAppMessage(member.phone, message);
                            }}
                            className="flex-1 py-2 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 text-sm"
                          >
                            ✅ Verify & WhatsApp
                          </button>
                          <button
                            onClick={() => {
                              setMembers(members.map(m => m.id === member.id ? { ...m, paymentStatus: 'rejected' } : m));
                              const message = whatsappMessages.paymentRequest();
                              sendWhatsAppMessage(member.phone, message);
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
                              <span className={`px-2 py-1 rounded font-bold ${m.verified ? 'bg-green-200 text-green-800' : 'bg-yellow-200 text-yellow-800'}`}>
                                {m.verified ? '✓ Verified' : '⏳ Pending'}
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
      const filtered = members.filter(m =>
        m.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.id.includes(searchQuery)
      );

      return (
        <div className="min-h-screen bg-gray-50">
          <header className="sticky top-0 z-40 bg-white shadow">
            <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-4">
              <button onClick={() => goBackAdmin()} className="text-2xl">←</button>
              <div className="text-2xl font-bold text-blue-600">👥 Members List</div>
            </div>
          </header>

          <div className="max-w-6xl mx-auto p-8">
            <div className="mb-6">
              <input
                type="text"
                placeholder="Search by name or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-600 outline-none"
              />
            </div>

            <div className="bg-white rounded-lg shadow overflow-hidden">
              {filtered.length === 0 ? (
                <p className="p-6 text-gray-500">No members found</p>
              ) : (
                <table className="w-full">
                  <thead className="bg-gray-100">
                    <tr>
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
                        <td className="py-4 px-6">{member.fullName}</td>
                        <td className="py-4 px-6 font-mono text-sm">{member.id}</td>
                        <td className="py-4 px-6">{member.email}</td>
                        <td className="py-4 px-6">{member.phone}</td>
                        <td className="py-4 px-6">{member.plan}</td>
                        <td className="py-4 px-6">
                          <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                            member.verified ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                          }`}>
                            {member.verified ? 'Verified' : 'Pending'}
                          </span>
                        </td>
                        <td className="py-4 px-6 flex gap-2">
                          <button
                            onClick={() => setSelectedMemberDetail(member)}
                            className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600 text-sm font-semibold"
                          >
                            👁️ View
                          </button>
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
                            onClick={() => {
                              if (confirm(`Delete ${member.fullName}? This cannot be undone!`)) {
                                setMembers(members.filter(m => m.id !== member.id));
                                alert(`✅ Member ${member.fullName} deleted`);
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

            {/* Member Detail Modal */}
            {selectedMemberDetail && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                <div className="bg-white rounded-lg p-8 max-w-md w-full">
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
                          : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {selectedMemberDetail.paymentStatus === 'verified' ? '✅ Verified' : '⏳ Pending'}
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

            {/* Edit Member Modal */}
            {editingMember && editFormData && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                <div className="bg-white rounded-lg p-8 max-w-2xl w-full max-h-screen overflow-y-auto">
                  <h2 className="text-2xl font-bold mb-6">Edit Member: {editingMember.fullName}</h2>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2">Full Name</label>
                      <input
                        type="text"
                        value={editFormData.fullName || ''}
                        onChange={(e) => setEditFormData({...editFormData, fullName: e.target.value})}
                        className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-600 outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2">Email</label>
                      <input
                        type="email"
                        value={editFormData.email || ''}
                        onChange={(e) => setEditFormData({...editFormData, email: e.target.value})}
                        className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-600 outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2">Phone</label>
                      <input
                        type="tel"
                        value={editFormData.phone || ''}
                        onChange={(e) => setEditFormData({...editFormData, phone: e.target.value})}
                        className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-600 outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2">Plan</label>
                      <select
                        value={editFormData.plan || ''}
                        onChange={(e) => setEditFormData({...editFormData, plan: e.target.value})}
                        className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-600 outline-none"
                      >
                        <option value="">Select a plan</option>
                        <option value="Monthly Half-day">Monthly Half-day (₹600)</option>
                        <option value="Monthly Full-day">Monthly Full-day (₹1100)</option>
                        <option value="Quarterly Half-day">Quarterly Half-day (₹1600)</option>
                        <option value="Quarterly Full-day">Quarterly Full-day (₹3100)</option>
                        <option value="Half-yearly Half-day">Half-yearly Half-day (₹3100)</option>
                        <option value="Half-yearly Full-day">Half-yearly Full-day (₹6000)</option>
                        <option value="Yearly Half-day">Yearly Half-day (₹5900)</option>
                        <option value="Yearly Full-day">Yearly Full-day (₹9900)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2">Time Slot</label>
                      <select
                        value={editFormData.slot || ''}
                        onChange={(e) => setEditFormData({...editFormData, slot: e.target.value})}
                        className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-600 outline-none"
                      >
                        <option value="">Select a slot</option>
                        <option value="9am-3pm">9am - 3pm</option>
                        <option value="3pm-9pm">3pm - 9pm</option>
                        <option value="9am-9pm">9am - 9pm (Full Day)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2">Payment Status</label>
                      <select
                        value={editFormData.paymentStatus || 'pending'}
                        onChange={(e) => setEditFormData({...editFormData, paymentStatus: e.target.value})}
                        className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-600 outline-none"
                      >
                        <option value="pending">Pending</option>
                        <option value="verified">Verified</option>
                        <option value="rejected">Rejected</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2">Notes</label>
                      <textarea
                        value={editFormData.notes || ''}
                        onChange={(e) => setEditFormData({...editFormData, notes: e.target.value})}
                        placeholder="Add any admin notes about this member..."
                        className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-600 outline-none"
                        rows={3}
                      />
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
                        setIsSavingMember(true);
                        try {
                          // Update Firestore if docId exists
                          if (editingMember?.docId) {
                            const memberRef = doc(db, 'members', editingMember.docId);
                            await updateDoc(memberRef, editFormData);
                          }

                          // Update local state
                          setMembers(members.map(m => m.id === editingMember.id ? editFormData : m));
                          setEditingMember(null);
                          setEditFormData(null);
                          alert(`✅ ${editFormData.fullName} updated successfully!`);
                        } catch (error) {
                          console.error('Error updating member:', error);
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
            <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-4">
              <button onClick={() => goBackAdmin()} className="text-2xl">←</button>
              <div className="text-2xl font-bold text-blue-600">💳 Payment Verification</div>
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
                          onClick={() => { updateMemberPayment(member.id, 'verified'); setPaymentReviewNotes(''); }}
                          className="flex-1 py-2 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700"
                        >
                          ✓ Verify
                        </button>
                        <button
                          onClick={() => updateMemberPayment(member.id, 'rejected')}
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
                    {selectedPaymentForReview.paymentProof ? (
                      <img src={selectedPaymentForReview.paymentProof} alt="Payment proof" className="max-h-60 mx-auto rounded" />
                    ) : (
                      <div className="text-gray-600">
                        <p className="text-4xl mb-2">📸</p>
                        <p>Payment screenshot/screenshot not uploaded yet</p>
                        <p className="text-sm mt-2">Member should upload during signup</p>
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
                    onChange={(e) => setPaymentReviewNotes(e.target.value)}
                    className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-600 outline-none"
                    rows={3}
                  />
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
                    onClick={() => {
                      updateMemberPayment(selectedPaymentForReview.id, 'rejected');
                      setSelectedPaymentForReview(null);
                      setPaymentReviewNotes('');
                    }}
                    className="flex-1 py-3 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700"
                  >
                    ✗ Reject Payment
                  </button>
                  <button
                    onClick={() => {
                      updateMemberPayment(selectedPaymentForReview.id, 'verified');
                      setSelectedPaymentForReview(null);
                      setPaymentReviewNotes('');
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
                const slotMembers = members.filter(m => m.slot === slot.name);
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
                      <h4 className="font-bold text-gray-900 mb-4">Seat Grid (23 total):</h4>
                      <div className="grid grid-cols-6 gap-2">
                        {Array.from({ length: slot.capacity }).map((_, seatNum) => {
                          const member = slotMembers[seatNum];
                          return (
                            <button
                              key={seatNum}
                              onClick={() => member && setSelectedMemberDetail(member)}
                              className={`aspect-square rounded-lg font-bold text-sm flex flex-col items-center justify-center transition transform hover:scale-105 ${
                                member
                                  ? 'bg-gradient-to-br from-blue-500 to-blue-600 text-white border-2 border-blue-700 cursor-pointer hover:from-blue-600 hover:to-blue-700'
                                  : 'bg-gradient-to-br from-green-400 to-emerald-500 text-white border-2 border-green-600'
                              }`}
                              title={member ? `${member.fullName}` : 'Empty'}
                            >
                              <div className="text-xs">#{seatNum + 1}</div>
                              {member && <div className="text-xs truncate">{member.fullName.split(' ')[0]}</div>}
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
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-lg p-8 max-w-md w-full">
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
                        : 'bg-yellow-100 text-yellow-800'
                    }`}>
                      {selectedMemberDetail.paymentStatus === 'verified' ? '✅ Verified' : '⏳ Pending'}
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
                    members.forEach(member => {
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
              <span className="text-blue-600 font-bold">Step 1/5</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-blue-600 h-2 rounded-full" style={{ width: '20%' }}></div>
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
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold mb-2">Email <span className="text-red-600">*</span></label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  placeholder="example@email.com"
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold mb-2">WhatsApp Number <span className="text-red-600">*</span></label>
                <input
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleInputChange}
                  placeholder="+91 XXXXXXXXXX"
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold mb-2">Date of Birth <span className="text-red-600">*</span></label>
                <input
                  type="date"
                  name="dateOfBirth"
                  value={formData.dateOfBirth}
                  onChange={handleInputChange}
                  max={new Date().toISOString().split('T')[0]}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold mb-2">Gender</label>
                <select
                  name="gender"
                  value={formData.gender}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 outline-none"
                >
                  <option value="">Select Gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                  <option value="Prefer not to say">Prefer not to say</option>
                </select>
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
                  if (!formData.fullName.trim()) {
                    alert('Please enter your full name');
                    return;
                  }
                  if (!formData.email.trim()) {
                    alert('Please enter your email');
                    return;
                  }
                  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                  if (!emailRegex.test(formData.email.trim())) {
                    alert('Please enter a valid email address');
                    return;
                  }
                  if (!formData.phone.trim()) {
                    alert('Please enter your WhatsApp number');
                    return;
                  }
                  const phoneRegex = /^[0-9]{10}$/;
                  const cleanPhone = formData.phone.replace(/[^0-9]/g, '');
                  if (!phoneRegex.test(cleanPhone)) {
                    alert('Please enter a valid 10-digit phone number');
                    return;
                  }
                  if (!formData.dateOfBirth) {
                    alert('Please select your date of birth');
                    return;
                  }
                  if (!formData.gender) {
                    alert('Please select your gender');
                    return;
                  }
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

  // STEP 2: EMERGENCY CONTACT & REFERRAL
  if (step === 2) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white p-4">
        <div className="max-w-2xl mx-auto">
          <div className="mb-8">
            <div className="flex justify-between items-center mb-4">
              <h1 className="text-3xl font-bold">Emergency Contact & Source</h1>
              <span className="text-blue-600 font-bold">Step 2/6</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-blue-600 h-2 rounded-full" style={{ width: '33%' }}></div>
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
                  onChange={handleInputChange}
                  placeholder="+91 XXXXXXXXXX"
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold mb-2">How did you hear about us?</label>
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
                onClick={() => navigate('/admission/step-1')}
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

  // STEP 3: MEMBERSHIP PLAN (was Step 2)
  if (step === 3) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white p-4">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <div className="flex justify-between items-center mb-4">
              <h1 className="text-3xl font-bold">Choose Membership Plan <span className="text-red-600">*</span></h1>
              <span className="text-blue-600 font-bold">Step 3/6</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-blue-600 h-2 rounded-full" style={{ width: '33%' }}></div>
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
              onClick={() => navigate('/admission/step-1')}
              className="flex-1 py-3 px-6 border-2 border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50"
            >
              Back
            </button>
            <button
              onClick={() => navigate('/admission/step-4')}
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

  // STEP 4: SLOT & DATE SELECTION
  if (step === 4) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white p-4">
        <div className="max-w-2xl mx-auto">
          <div className="mb-8">
            <div className="flex justify-between items-center mb-4">
              <h1 className="text-3xl font-bold">Select Slot & Date <span className="text-red-600">*</span></h1>
              <span className="text-blue-600 font-bold">Step 4/6</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-blue-600 h-2 rounded-full" style={{ width: '50%' }}></div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-lg p-8 border border-gray-100 space-y-6">
            <div>
              <h3 className="font-bold mb-4">Select Time Slot <span className="text-red-600">*</span></h3>
              <div className="space-y-2">
                {selectedDayType === 'Half-day' ? (
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
                      <div className="text-sm text-gray-600">Morning slot • 25/69 seats available</div>
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
                      <div className="text-sm text-gray-600">Evening slot • 20/69 seats available</div>
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setSelectedSlot('9am-9pm')}
                    className={`w-full p-3 rounded-lg border-2 text-left transition ${
                      selectedSlot === '9am-9pm'
                        ? 'border-blue-600 bg-blue-50'
                        : 'border-gray-300 hover:border-blue-400'
                    }`}
                  >
                    <div className="font-bold">9 AM - 9 PM (Full Day)</div>
                    <div className="text-sm text-gray-600">Full day access • 15/69 seats available</div>
                  </button>
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
              onClick={() => navigate('/admission/step-3')}
              className="flex-1 py-3 px-6 border-2 border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50"
            >
              Back
            </button>
            <button
              onClick={() => navigate('/admission/step-5')}
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

  // STEP 5: PAYMENT
  if (step === 5) {
    const amount = PLANS[selectedPlan as keyof typeof PLANS]?.[selectedDayType as keyof typeof PLANS[keyof typeof PLANS]] || 0;
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white p-4">
        <div className="max-w-2xl mx-auto">
          <div className="mb-8">
            <div className="flex justify-between items-center mb-4">
              <h1 className="text-3xl font-bold">Payment <span className="text-red-600">*</span></h1>
              <span className="text-blue-600 font-bold">Step 5/6</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-blue-600 h-2 rounded-full" style={{ width: '66%' }}></div>
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

            <div className="flex items-center">
              <input type="checkbox" id="agree" className="mr-2" />
              <label htmlFor="agree" className="text-sm">
                I agree to Terms & Conditions and have read Library Rules <span className="text-red-600">*</span>
              </label>
            </div>
          </div>

          <div className="flex gap-4 mt-6">
            <button
              onClick={() => navigate('/admission/step-4')}
              className="flex-1 py-3 px-6 border-2 border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50"
            >
              Back
            </button>
            <button
              onClick={() => {
                const agreeCheckbox = document.getElementById('agree') as HTMLInputElement;
                if (!agreeCheckbox || !agreeCheckbox.checked) {
                  alert('Please agree to Terms & Conditions');
                  return;
                }
                navigate('/admission/step-6');
              }}
              className="flex-1 py-3 px-6 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700"
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // STEP 5: CONFIRMATION
  if (step === 6) {
    const amount = PLANS[selectedPlan as keyof typeof PLANS]?.[selectedDayType as keyof typeof PLANS[keyof typeof PLANS]] || 0;
    const bookingId = `ABD${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    return (
      <div className="min-h-screen bg-gradient-to-b from-green-50 to-white p-4">
        <div className="max-w-2xl mx-auto">
          <div className="mb-8">
            <div className="flex justify-between items-center mb-4">
              <h1 className="text-3xl font-bold text-green-600">✅ Admission Confirmed!</h1>
              <span className="text-green-600 font-bold">Step 6/6</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-green-600 h-2 rounded-full" style={{ width: '100%' }}></div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-lg p-8 border border-gray-100 space-y-6">
            <div className="bg-green-50 border border-green-200 p-6 rounded-lg text-center">
              <div className="text-5xl mb-4">🎉</div>
              <div className="font-bold text-2xl text-green-700">Your Admission is Confirmed!</div>
              <div className="text-gray-600 mt-2">Your membership is now active</div>
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
                onClick={() => {
                  generatePDF(bookingId, amount);
                  // Save member to database
                  addMember({
                    fullName: formData.fullName.trim(),
                    email: formData.email.trim().toLowerCase(),
                    phone: formData.phone.replace(/[^0-9]/g, ''),
                    dateOfBirth: formData.dateOfBirth,
                    gender: formData.gender,
                    currentClass: formData.currentClass.trim(),
                    targetExam: formData.targetExam.trim(),
                    schoolCollege: formData.schoolCollege.trim(),
                    emergencyContactName: formData.emergencyContactName.trim(),
                    emergencyContactPhone: formData.emergencyContactPhone.replace(/[^0-9]/g, ''),
                    referralSource: formData.referralSource.trim(),
                    plan: `${selectedPlan} ${selectedDayType}`,
                    slot: selectedSlot,
                    startDate: selectedDate,
                    amount: amount,
                    paymentMethod: paymentMethod,
                  });
                }}
                disabled={isSubmitting}
                className="w-full py-3 px-6 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? '⏳ Saving...' : '📥 Download Admission PDF'}
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

  // Rest of the component rendering stays the same
  // The useEffect above syncs the URL based on state
}

export default App;
// Updated: Fri Jun 26 12:54:21 IST 2026
