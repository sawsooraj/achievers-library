// @ts-nocheck
import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import { db } from './firebase';
import { collection, addDoc, getDocs, updateDoc, doc } from 'firebase/firestore';
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
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    phone: '',
  });
  const [selectedPlan, setSelectedPlan] = useState('');
  const [selectedDayType, setSelectedDayType] = useState('');
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [selectedSlot, setSelectedSlot] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('upi');

  // Admin States
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [adminPage, setAdminPage] = useState<'dashboard' | 'scanner' | 'members' | 'payments' | 'reminders'>('dashboard');
  const [members, setMembers] = useState<any[]>([]);
  const [scannedBookingId, setScannedBookingId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Sync URL with step/admin state
  useEffect(() => {
    if (isAdmin) {
      navigate(`/admin/${adminPage}`);
    } else if (step > 0) {
      navigate(`/admission/step-${step}`);
    } else if (!location.hash.includes('/admin')) {
      navigate('/');
    }
  }, [step, isAdmin, adminPage, navigate, location]);

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

  // Admin Functions
  const handleAdminLogin = (password: string) => {
    const pwd = password.trim();
    if (pwd === 'admin123' || pwd === 'admin' || pwd === 'library') {
      setIsAdmin(true);
      setAdminPassword('');
      setAdminPage('dashboard');
    } else {
      alert('❌ Invalid password!\n\n✅ Try one of these:\n• admin123\n• admin\n• library');
    }
  };

  const addMember = async (memberData: any) => {
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
    }
  };

  const addDemoData = async () => {
    const demoUsers = [
      { fullName: 'Sooraj Kumar', email: 'sooraj@email.com', phone: '9876543210', plan: 'Monthly Half-day', slot: '9am-3pm', amount: 700, paymentStatus: 'verified' },
      { fullName: 'Priya Sharma', email: 'priya@email.com', phone: '9876543211', plan: 'Monthly Full-day', slot: '9am-9pm', amount: 1200, paymentStatus: 'verified' },
      { fullName: 'Raj Patel', email: 'raj@email.com', phone: '9876543212', plan: 'Quarterly Half-day', slot: '3pm-9pm', amount: 1700, paymentStatus: 'pending' },
      { fullName: 'Anjali Singh', email: 'anjali@email.com', phone: '9876543213', plan: 'Monthly Half-day', slot: '9am-3pm', amount: 700, paymentStatus: 'verified' },
      { fullName: 'Vikram Gupta', email: 'vikram@email.com', phone: '9876543214', plan: 'Quarterly Full-day', slot: '9am-9pm', amount: 3200, paymentStatus: 'verified' },
      { fullName: 'Neha Desai', email: 'neha@email.com', phone: '9876543215', plan: 'Half-yearly Half-day', slot: '3pm-9pm', amount: 3200, paymentStatus: 'pending' },
      { fullName: 'Arjun Reddy', email: 'arjun@email.com', phone: '9876543216', plan: 'Monthly Half-day', slot: '9am-3pm', amount: 700, paymentStatus: 'verified' },
      { fullName: 'Pooja Nair', email: 'pooja@email.com', phone: '9876543217', plan: 'Yearly Full-day', slot: '9am-9pm', amount: 10000, paymentStatus: 'verified' },
      { fullName: 'Rohan Verma', email: 'rohan@email.com', phone: '9876543218', plan: 'Monthly Half-day', slot: '3pm-9pm', amount: 700, paymentStatus: 'pending' },
      { fullName: 'Divya Kapoor', email: 'divya@email.com', phone: '9876543219', plan: 'Quarterly Half-day', slot: '9am-3pm', amount: 1700, paymentStatus: 'verified' },
      { fullName: 'Aditya Joshi', email: 'aditya@email.com', phone: '9876543220', plan: 'Monthly Full-day', slot: '9am-9pm', amount: 1200, paymentStatus: 'verified' },
      { fullName: 'Sneha Mishra', email: 'sneha@email.com', phone: '9876543221', plan: 'Half-yearly Full-day', slot: '3pm-9pm', amount: 6000, paymentStatus: 'pending' },
      { fullName: 'Ravi Kumar', email: 'ravi@email.com', phone: '9876543222', plan: 'Monthly Half-day', slot: '9am-3pm', amount: 700, paymentStatus: 'verified' },
      { fullName: 'Sakshi Pandey', email: 'sakshi@email.com', phone: '9876543223', plan: 'Quarterly Full-day', slot: '9am-9pm', amount: 3200, paymentStatus: 'verified' },
      { fullName: 'Manish Singh', email: 'manish@email.com', phone: '9876543224', plan: 'Monthly Half-day', slot: '3pm-9pm', amount: 700, paymentStatus: 'pending' },
      { fullName: 'Isha Rao', email: 'isha@email.com', phone: '9876543225', plan: 'Monthly Full-day', slot: '9am-9pm', amount: 1200, paymentStatus: 'verified' },
      { fullName: 'Harsh Malhotra', email: 'harsh@email.com', phone: '9876543226', plan: 'Yearly Half-day', slot: '9am-3pm', amount: 6000, paymentStatus: 'verified' },
      { fullName: 'Megha Tiwari', email: 'megha@email.com', phone: '9876543227', plan: 'Quarterly Half-day', slot: '3pm-9pm', amount: 1700, paymentStatus: 'pending' },
      { fullName: 'Nikhil Bhat', email: 'nikhil@email.com', phone: '9876543228', plan: 'Monthly Half-day', slot: '9am-3pm', amount: 700, paymentStatus: 'verified' },
      { fullName: 'Richa Sharma', email: 'richa@email.com', phone: '9876543229', plan: 'Half-yearly Half-day', slot: '9am-9pm', amount: 3200, paymentStatus: 'verified' },
      { fullName: 'Deepak Negi', email: 'deepak@email.com', phone: '9876543230', plan: 'Monthly Full-day', slot: '3pm-9pm', amount: 1200, paymentStatus: 'pending' },
      { fullName: 'Ananya Chatterjee', email: 'ananya@email.com', phone: '9876543231', plan: 'Quarterly Half-day', slot: '9am-3pm', amount: 1700, paymentStatus: 'verified' },
      { fullName: 'Sameer Khan', email: 'sameer@email.com', phone: '9876543232', plan: 'Monthly Half-day', slot: '9am-9pm', amount: 700, paymentStatus: 'verified' },
      { fullName: 'Tanya Mishra', email: 'tanya@email.com', phone: '9876543233', plan: 'Yearly Full-day', slot: '3pm-9pm', amount: 10000, paymentStatus: 'pending' },
      { fullName: 'Vishal Kumar', email: 'vishal@email.com', phone: '9876543234', plan: 'Monthly Half-day', slot: '9am-3pm', amount: 700, paymentStatus: 'verified' },
      { fullName: 'Kavya Singh', email: 'kavya@email.com', phone: '9876543235', plan: 'Half-yearly Full-day', slot: '9am-9pm', amount: 6000, paymentStatus: 'verified' },
      { fullName: 'Aryan Patel', email: 'aryan@email.com', phone: '9876543236', plan: 'Quarterly Half-day', slot: '3pm-9pm', amount: 1700, paymentStatus: 'pending' },
      { fullName: 'Zara Desai', email: 'zara@email.com', phone: '9876543237', plan: 'Monthly Full-day', slot: '9am-3pm', amount: 1200, paymentStatus: 'verified' },
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
    if (!confirm('⚠️ Are you sure? This will delete ALL members!')) return;

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
    } catch (error) {
      console.error('Error updating payment:', error);
    }
  };

  const getStats = () => ({
    totalMembers: members.length,
    pendingPayments: members.filter(m => m.paymentStatus === 'pending').length,
    verifiedMembers: members.filter(m => m.verified).length,
    totalRevenue: members.reduce((sum, m) => sum + (m.amount || 0), 0),
  });

  // ADMIN LOGIN PAGE (show when on /admin path but not yet logged in)
  if (!isAdmin && (location.pathname.includes('/admin') || location.hash.includes('/admin'))) {
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
            placeholder="Enter admin password"
            className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg mb-4 focus:border-blue-600 outline-none"
            autoFocus
          />

          <button
            onClick={() => handleAdminLogin(adminPassword)}
            className="w-full py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-bold rounded-lg hover:shadow-lg"
          >
            Login
          </button>

          <button
            onClick={() => { navigate('/'); }}
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
              <div className="text-2xl font-bold text-blue-600">📊 Admin Dashboard</div>
              <button
                onClick={() => { setIsAdmin(false); setAdminPage('dashboard'); setStep(0); }}
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
                  onClick={() => setAdminPage('dashboard')}
                  className={`w-full text-left px-4 py-3 rounded-lg font-semibold ${
                    adminPage === 'dashboard' ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  📈 Dashboard
                </button>
                <button
                  onClick={() => setAdminPage('scanner')}
                  className={`w-full text-left px-4 py-3 rounded-lg font-semibold ${
                    adminPage === 'scanner' ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  📱 QR Scanner
                </button>
                <button
                  onClick={() => setAdminPage('members')}
                  className={`w-full text-left px-4 py-3 rounded-lg font-semibold ${
                    adminPage === 'members' ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  👥 Members
                </button>
                <button
                  onClick={() => setAdminPage('payments')}
                  className={`w-full text-left px-4 py-3 rounded-lg font-semibold ${
                    adminPage === 'payments' ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  💳 Payments
                </button>
                <button
                  onClick={() => setAdminPage('reminders')}
                  className={`w-full text-left px-4 py-3 rounded-lg font-semibold ${
                    adminPage === 'reminders' ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  📨 Reminders
                </button>
              </nav>
            </div>

            {/* Main Content */}
            <div className="flex-1 p-8">
              {/* Stats Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                <div className="bg-white p-6 rounded-lg shadow">
                  <div className="text-gray-600 text-sm font-semibold">Total Members</div>
                  <div className="text-4xl font-bold text-blue-600 mt-2">{stats.totalMembers}</div>
                </div>
                <div className="bg-white p-6 rounded-lg shadow">
                  <div className="text-gray-600 text-sm font-semibold">Verified</div>
                  <div className="text-4xl font-bold text-green-600 mt-2">{stats.verifiedMembers}</div>
                </div>
                <div className="bg-white p-6 rounded-lg shadow">
                  <div className="text-gray-600 text-sm font-semibold">Pending Payments</div>
                  <div className="text-4xl font-bold text-orange-600 mt-2">{stats.pendingPayments}</div>
                </div>
                <div className="bg-white p-6 rounded-lg shadow">
                  <div className="text-gray-600 text-sm font-semibold">Total Revenue</div>
                  <div className="text-4xl font-bold text-purple-600 mt-2">₹{stats.totalRevenue}</div>
                </div>
              </div>

              {/* Demo Data Button */}
              <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-6 mb-8">
                {members.length === 0 ? (
                  <>
                    <p className="text-blue-900 font-semibold mb-4">
                      📊 No members yet? Add demo data to test the dashboard!
                    </p>
                    <button
                      onClick={addDemoData}
                      className="w-full py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700"
                    >
                      ➕ Add 27 Demo Users
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-blue-900 font-semibold mb-4">
                      ⚠️ You have {members.length} members in the database
                    </p>
                    <button
                      onClick={deleteAllDemoData}
                      className="w-full py-3 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700"
                    >
                      🗑️ Delete All Demo Data
                    </button>
                  </>
                )}
                <p className="text-xs text-blue-700 mt-3">
                  💡 Use demo data to test. Delete before going live!
                </p>
              </div>

              {/* Recent Members Table */}
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-2xl font-bold mb-4">Recent Members</h2>
                {members.length === 0 ? (
                  <p className="text-gray-500">No members yet</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-3 px-4">Name</th>
                          <th className="text-left py-3 px-4">ID</th>
                          <th className="text-left py-3 px-4">Phone</th>
                          <th className="text-left py-3 px-4">Plan</th>
                          <th className="text-left py-3 px-4">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {members.slice(-5).reverse().map(member => (
                          <tr key={member.id} className="border-b hover:bg-gray-50">
                            <td className="py-3 px-4">{member.fullName}</td>
                            <td className="py-3 px-4 font-mono text-sm">{member.id}</td>
                            <td className="py-3 px-4">{member.phone}</td>
                            <td className="py-3 px-4">{member.plan}</td>
                            <td className="py-3 px-4">
                              <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                                member.paymentStatus === 'verified' ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'
                              }`}>
                                {member.paymentStatus}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
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
              <button onClick={() => setAdminPage('dashboard')} className="text-2xl">←</button>
              <div className="text-2xl font-bold text-blue-600">📱 QR Scanner</div>
            </div>
          </header>

          <div className="max-w-2xl mx-auto p-8">
            <div className="bg-white rounded-lg shadow p-8">
              <p className="text-center text-gray-600 mb-6">Point camera at QR code to scan</p>

              <div id="qr-reader" className="w-full mb-6"></div>

              {scannedBookingId && (
                <div className="bg-green-50 border border-green-200 p-6 rounded-lg">
                  <div className="text-lg font-bold text-green-700 mb-4">✅ QR Scanned!</div>
                  <div className="text-2xl font-mono font-bold text-blue-600 mb-6">{scannedBookingId}</div>

                  {members.find(m => m.id === scannedBookingId) ? (
                    <div className="space-y-4">
                      {members.map(m => m.id === scannedBookingId && (
                        <div key={m.id}>
                          <p className="text-lg"><strong>Name:</strong> {m.fullName}</p>
                          <p className="text-lg"><strong>Phone:</strong> {m.phone}</p>
                          <p className="text-lg"><strong>Plan:</strong> {m.plan}</p>
                          <p className="text-lg"><strong>Status:</strong> {m.paymentStatus}</p>
                          <button
                            onClick={() => { setScannedBookingId(''); setAdminPage('dashboard'); }}
                            className="mt-4 w-full py-3 bg-blue-600 text-white font-bold rounded-lg"
                          >
                            ✓ Admission Verified
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-red-600 font-bold">Member not found</p>
                  )}
                </div>
              )}

              <button
                onClick={() => { setAdminPage('dashboard'); setScannedBookingId(''); }}
                className="w-full mt-6 py-3 border-2 border-blue-600 text-blue-600 font-bold rounded-lg"
              >
                Back to Dashboard
              </button>
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
              <button onClick={() => setAdminPage('dashboard')} className="text-2xl">←</button>
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <button
              onClick={() => setAdminPage('dashboard')}
              className="mt-6 px-6 py-3 bg-blue-600 text-white font-bold rounded-lg"
            >
              Back to Dashboard
            </button>
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
              <button onClick={() => setAdminPage('dashboard')} className="text-2xl">←</button>
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
                      </div>

                      <div className="flex gap-3">
                        <button
                          onClick={() => updateMemberPayment(member.id, 'verified')}
                          className="flex-1 py-2 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700"
                        >
                          ✓ Verify Payment
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
        </div>
      );
    }

    // Reminders Page
    if ((adminPage as string) === 'reminders') {
      return (
        <div className="min-h-screen bg-gray-50">
          <header className="sticky top-0 z-40 bg-white shadow">
            <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-4">
              <button onClick={() => setAdminPage('dashboard')} className="text-2xl">←</button>
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
                  onClick={() => alert('Reminders sent via WhatsApp!')}
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
                onClick={() => setStep(1)}
                className="px-4 md:px-6 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold rounded-lg hover:shadow-lg transition text-xs md:text-sm"
              >
                Join
              </button>
              <button
                onClick={() => {
                  window.location.href = '/#/admin/dashboard';
                }}
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
                onClick={() => setStep(1)}
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
            onClick={() => setStep(1)}
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
                <label className="block font-semibold mb-2">Full Name</label>
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
                <label className="block font-semibold mb-2">Email</label>
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
                <label className="block font-semibold mb-2">WhatsApp Number</label>
                <input
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleInputChange}
                  placeholder="+91 XXXXXXXXXX"
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 outline-none"
                />
              </div>
            </div>
            <div className="flex gap-4 mt-8">
              <button
                onClick={() => setStep(0)}
                className="flex-1 py-3 px-6 border-2 border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50"
              >
                Back
              </button>
              <button
                onClick={() => setStep(2)}
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

  // STEP 2: MEMBERSHIP PLAN
  if (step === 2) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white p-4">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <div className="flex justify-between items-center mb-4">
              <h1 className="text-3xl font-bold">Choose Membership Plan</h1>
              <span className="text-blue-600 font-bold">Step 2/5</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-blue-600 h-2 rounded-full" style={{ width: '40%' }}></div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            {Object.entries(PLANS).map(([plan, prices]: any) => (
              <div key={plan}>
                <h3 className="font-bold text-lg mb-4">{plan}</h3>
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
              onClick={() => setStep(1)}
              className="flex-1 py-3 px-6 border-2 border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50"
            >
              Back
            </button>
            <button
              onClick={() => setStep(3)}
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

  // STEP 3: SLOT & DATE SELECTION
  if (step === 3) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white p-4">
        <div className="max-w-2xl mx-auto">
          <div className="mb-8">
            <div className="flex justify-between items-center mb-4">
              <h1 className="text-3xl font-bold">Select Slot & Date</h1>
              <span className="text-blue-600 font-bold">Step 3/5</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-blue-600 h-2 rounded-full" style={{ width: '60%' }}></div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-lg p-8 border border-gray-100 space-y-6">
            <div>
              <h3 className="font-bold mb-4">Select Time Slot</h3>
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
              <h3 className="font-bold mb-4">Select Start Date</h3>
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
              onClick={() => setStep(2)}
              className="flex-1 py-3 px-6 border-2 border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50"
            >
              Back
            </button>
            <button
              onClick={() => setStep(4)}
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

  // STEP 4: PAYMENT
  if (step === 4) {
    const amount = PLANS[selectedPlan as keyof typeof PLANS]?.[selectedDayType as keyof typeof PLANS[keyof typeof PLANS]] || 0;
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white p-4">
        <div className="max-w-2xl mx-auto">
          <div className="mb-8">
            <div className="flex justify-between items-center mb-4">
              <h1 className="text-3xl font-bold">Payment</h1>
              <span className="text-blue-600 font-bold">Step 4/5</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-blue-600 h-2 rounded-full" style={{ width: '80%' }}></div>
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
              <h3 className="font-bold text-lg mb-4">Select Payment Method</h3>
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
                I agree to Terms & Conditions and have read Library Rules
              </label>
            </div>
          </div>

          <div className="flex gap-4 mt-6">
            <button
              onClick={() => setStep(3)}
              className="flex-1 py-3 px-6 border-2 border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50"
            >
              Back
            </button>
            <button
              onClick={() => setStep(5)}
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
  if (step === 5) {
    const amount = PLANS[selectedPlan as keyof typeof PLANS]?.[selectedDayType as keyof typeof PLANS[keyof typeof PLANS]] || 0;
    const bookingId = `ABD${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    return (
      <div className="min-h-screen bg-gradient-to-b from-green-50 to-white p-4">
        <div className="max-w-2xl mx-auto">
          <div className="mb-8">
            <div className="flex justify-between items-center mb-4">
              <h1 className="text-3xl font-bold text-green-600">✅ Admission Confirmed!</h1>
              <span className="text-green-600 font-bold">Step 5/5</span>
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
                <span className="font-bold">{formData.fullName || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Plan</span>
                <span className="font-bold">{selectedPlan} - {selectedDayType}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Slot</span>
                <span className="font-bold">{selectedSlot}</span>
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
                    fullName: formData.fullName,
                    email: formData.email,
                    phone: formData.phone,
                    plan: `${selectedPlan} ${selectedDayType}`,
                    slot: selectedSlot,
                    startDate: selectedDate,
                    amount: amount,
                    paymentMethod: paymentMethod,
                  });
                }}
                className="w-full py-3 px-6 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700"
              >
                📥 Download Admission PDF
              </button>
              <button
                onClick={() => setStep(0)}
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
