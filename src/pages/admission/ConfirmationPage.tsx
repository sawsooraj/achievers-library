import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { MembershipPlan, DayType } from '../../types';

interface ConfirmationPageProps {
  plan: MembershipPlan;
  dayType: DayType;
  bookingId: string;
  fullName: string;
  whatsappNumber: string;
  totalAmount: number;
}

export function ConfirmationPage({
  plan,
  dayType,
  bookingId,
  fullName,
  whatsappNumber,
  totalAmount,
}: ConfirmationPageProps) {
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${bookingId}`;

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white p-4 sm:p-6">
      <div className="max-w-2xl mx-auto">
        {/* Success Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
            <span className="text-3xl">✅</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900">Admission Confirmed!</h1>
          <p className="text-gray-600 mt-2">Your membership is now active</p>
          <div className="mt-4 flex justify-between items-center">
            <span className="text-sm font-semibold text-green-600">Step 5 of 5</span>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="h-2 w-8 rounded-full bg-green-500"></div>
              ))}
            </div>
          </div>
        </div>

        {/* Booking Details */}
        <Card className="mb-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Booking Details</h2>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-700">Booking ID</span>
              <span className="font-mono font-bold text-blue-600">{bookingId}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-700">Name</span>
              <span className="font-semibold">{fullName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-700">WhatsApp Number</span>
              <span className="font-semibold">{whatsappNumber}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-700">Membership Plan</span>
              <span className="font-semibold">
                {plan} - {dayType}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-700">Amount Paid</span>
              <span className="font-bold text-lg text-green-600">₹{totalAmount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-700">Status</span>
              <span className="font-semibold text-green-600">✓ Verified</span>
            </div>
          </div>
        </Card>

        {/* QR Code */}
        <Card className="mb-6 text-center">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Your Admission QR Code</h2>
          <div className="bg-gray-100 p-6 rounded-lg mb-4">
            <img
              src={qrCodeUrl}
              alt="Admission QR Code"
              className="mx-auto border-4 border-white rounded"
            />
          </div>
          <p className="text-sm text-gray-600 mb-4">
            Show this QR code at the reception for admission
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              fullWidth
              onClick={() => window.print()}
            >
              Print QR
            </Button>
            <Button
              variant="secondary"
              fullWidth
              onClick={() => {
                const link = document.createElement('a');
                link.href = qrCodeUrl;
                link.download = `QR-${bookingId}.png`;
                link.click();
              }}
            >
              Download QR
            </Button>
          </div>
        </Card>

        {/* WhatsApp Notification */}
        <Card className="mb-6 bg-blue-50 border-2 border-blue-200">
          <p className="text-sm text-gray-700">
            <span className="font-semibold">📱 WhatsApp Notification:</span> A confirmation message has been sent to{' '}
            <span className="font-semibold">{whatsappNumber}</span> with your admission details and QR code.
          </p>
        </Card>

        {/* Next Steps */}
        <Card className="mb-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">What's Next?</h2>
          <div className="space-y-3">
            <div className="flex gap-3">
              <span className="font-bold text-blue-600 text-lg">1</span>
              <div>
                <p className="font-semibold text-gray-900">Visit the Reception</p>
                <p className="text-sm text-gray-600">Show this QR code at the library reception</p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="font-bold text-blue-600 text-lg">2</span>
              <div>
                <p className="font-semibold text-gray-900">Verify Your Documents</p>
                <p className="text-sm text-gray-600">Bring your ID proof for verification</p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="font-bold text-blue-600 text-lg">3</span>
              <div>
                <p className="font-semibold text-gray-900">Select Your Seat</p>
                <p className="text-sm text-gray-600">Choose from available seats and start studying</p>
              </div>
            </div>
          </div>
        </Card>

        {/* Library Contact */}
        <Card className="text-center">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Need Help?</h2>
          <div className="space-y-2">
            <p className="text-gray-700">
              <span className="font-semibold">The Achievers' Library</span>
            </p>
            <p className="text-sm text-gray-600">Akashvani Chowk, Opposite Durian Furniture</p>
            <p className="text-sm text-gray-600">Adityapur</p>
            <p className="text-lg font-bold text-blue-600 mt-3">9153144218</p>
          </div>
          <div className="mt-6">
            <Button
              variant="primary"
              onClick={() => {
                window.location.href = '/';
              }}
              fullWidth
            >
              Go to Home
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
