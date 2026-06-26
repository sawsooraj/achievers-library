import { useState } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { REGISTRATION_FEE, MEMBERSHIP_OFFERS } from '../../lib/constants';
import type { PaymentMethod, MembershipPlan, DayType } from '../../types';

interface PaymentPageProps {
  plan: MembershipPlan;
  dayType: DayType;
  onNext: (paymentMethod: PaymentMethod) => void;
  onBack: () => void;
}

export function PaymentPage({ plan, dayType, onNext, onBack }: PaymentPageProps) {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('upi');
  const [upiId, setUpiId] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [agreedToRules, setAgreedToRules] = useState(false);
  const [error, setError] = useState('');

  const totalAmount = MEMBERSHIP_OFFERS[plan][dayType];
  const planFee = totalAmount - REGISTRATION_FEE;

  const handleSubmit = () => {
    if (!agreedToTerms || !agreedToRules) {
      setError('Please agree to terms and rules');
      return;
    }
    if (paymentMethod === 'upi' && !upiId) {
      setError('Please enter UPI ID');
      return;
    }
    onNext(paymentMethod);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white p-4 sm:p-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <button onClick={onBack} className="text-blue-500 hover:text-blue-600 mb-4 flex items-center gap-2">
            ← Back
          </button>
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900">Payment & Terms</h1>
          <div className="mt-4 flex justify-between items-center">
            <span className="text-sm font-semibold text-blue-600">Step 4 of 5</span>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map(i => (
                <div
                  key={i}
                  className={`h-2 w-8 rounded-full ${i <= 4 ? 'bg-blue-500' : 'bg-gray-300'}`}
                ></div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {/* Amount Summary */}
          <Card>
            <h2 className="text-lg font-bold text-gray-900 mb-4">Amount to Pay</h2>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-700">Registration Fee</span>
                <span className="font-semibold">₹{REGISTRATION_FEE}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-700">{plan} {dayType} Plan</span>
                <span className="font-semibold">₹{planFee}</span>
              </div>
              <div className="border-t pt-3 flex justify-between">
                <span className="font-bold text-lg text-gray-900">Total</span>
                <span className="font-bold text-2xl text-blue-600">₹{totalAmount}</span>
              </div>
            </div>
          </Card>

          {/* Payment Method */}
          <Card>
            <h2 className="text-lg font-bold text-gray-900 mb-4">Payment Method</h2>
            <div className="space-y-3">
              <label className="flex items-center gap-3 p-3 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="payment"
                  value="cash"
                  checked={paymentMethod === 'cash'}
                  onChange={() => setPaymentMethod('cash')}
                  className="w-4 h-4"
                />
                <div>
                  <p className="font-semibold text-gray-900">Cash Payment</p>
                  <p className="text-sm text-gray-600">Pay at reception</p>
                </div>
              </label>

              <label className="flex items-center gap-3 p-3 border-2 border-blue-500 rounded-lg cursor-pointer bg-blue-50">
                <input
                  type="radio"
                  name="payment"
                  value="upi"
                  checked={paymentMethod === 'upi'}
                  onChange={() => setPaymentMethod('upi')}
                  className="w-4 h-4"
                />
                <div>
                  <p className="font-semibold text-gray-900">UPI Payment</p>
                  <p className="text-sm text-gray-600">Quick & secure</p>
                </div>
              </label>
            </div>

            {paymentMethod === 'upi' && (
              <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                <Input
                  label="UPI ID (Optional)"
                  value={upiId}
                  onChange={e => setUpiId(e.target.value)}
                  placeholder="yourname@upi"
                />
                <p className="text-xs text-gray-600 mt-2">
                  Or you can pay via: 98765 43210@upi after admission
                </p>
              </div>
            )}
          </Card>

          {/* Terms & Conditions */}
          <Card>
            <h2 className="text-lg font-bold text-gray-900 mb-4">Agreements</h2>
            <label className="flex items-start gap-3 p-3 mb-4 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
              <input
                type="checkbox"
                checked={agreedToTerms}
                onChange={() => setAgreedToTerms(!agreedToTerms)}
                className="w-5 h-5 mt-1"
              />
              <div>
                <p className="font-semibold text-gray-900">I agree to Terms & Conditions</p>
                <p className="text-xs text-gray-600 mt-1">
                  No refunds after activation. Membership is valid for selected duration.
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 p-3 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
              <input
                type="checkbox"
                checked={agreedToRules}
                onChange={() => setAgreedToRules(!agreedToRules)}
                className="w-5 h-5 mt-1"
              />
              <div>
                <p className="font-semibold text-gray-900">I have read Library Rules</p>
                <p className="text-xs text-gray-600 mt-1">
                  I will maintain silence, cleanliness, and follow library conduct rules.
                </p>
              </div>
            </label>
          </Card>

          {error && <p className="text-red-500 text-sm text-center">{error}</p>}

          <div className="flex gap-4">
            <Button variant="secondary" onClick={onBack} fullWidth>
              Back
            </Button>
            <Button variant="primary" onClick={handleSubmit} fullWidth>
              Proceed to Confirmation
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
