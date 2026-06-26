import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { MEMBERSHIP_OFFERS, REGISTRATION_FEE } from '../../lib/constants';
import type { MembershipPlan, DayType } from '../../types';

interface MembershipSelectProps {
  onNext: (plan: MembershipPlan, dayType: DayType) => void;
  onBack: () => void;
}

const plans: MembershipPlan[] = ['Monthly', 'Quarterly', 'Half-yearly', 'Yearly'];
const durations = {
  Monthly: '30 days',
  Quarterly: '90 days',
  'Half-yearly': '180 days',
  Yearly: '365 days',
};

export function MembershipSelectPage({ onNext, onBack }: MembershipSelectProps) {
  const handleSelect = (plan: MembershipPlan, dayType: DayType) => {
    onNext(plan, dayType);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <button onClick={onBack} className="text-blue-500 hover:text-blue-600 mb-4 flex items-center gap-2">
            ← Back
          </button>
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900">Choose Your Plan</h1>
          <div className="mt-4 flex justify-between items-center">
            <span className="text-sm font-semibold text-blue-600">Step 2 of 5</span>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map(i => (
                <div
                  key={i}
                  className={`h-2 w-8 rounded-full ${i <= 2 ? 'bg-blue-500' : 'bg-gray-300'}`}
                ></div>
              ))}
            </div>
          </div>
        </div>

        {/* Plans Grid */}
        <div className="space-y-8">
          {plans.map(plan => (
            <div key={plan}>
              <h2 className="text-2xl font-bold text-gray-900 mb-4">{plan}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Half-day */}
                <Card className="relative">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-xl font-bold text-gray-900">Half Day</h3>
                      <p className="text-sm text-gray-600">9am-3pm or 3pm-9pm</p>
                    </div>
                    <span className="text-2xl font-bold text-blue-600">₹{MEMBERSHIP_OFFERS[plan]['Half-day']}</span>
                  </div>

                  <div className="bg-gray-50 p-4 rounded-lg mb-4">
                    <p className="text-sm text-gray-700">
                      <strong>{durations[plan]}</strong> access
                    </p>
                    <p className="text-xs text-gray-600 mt-1">One slot per day • Flexible timings</p>
                  </div>

                  <div className="space-y-2 mb-6">
                    <div className="flex items-center gap-2">
                      <span className="text-green-500">✓</span>
                      <span className="text-sm text-gray-700">One slot per day</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-green-500">✓</span>
                      <span className="text-sm text-gray-700">Morning or Evening</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-green-500">✓</span>
                      <span className="text-sm text-gray-700">QR-based entry</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-green-500">✓</span>
                      <span className="text-sm text-gray-700">Library facilities</span>
                    </div>
                  </div>

                  <div className="border-t pt-4 mb-4">
                    <p className="text-xs text-gray-600 mb-2">Charges breakdown:</p>
                    <div className="flex justify-between text-sm mb-1">
                      <span>Registration Fee</span>
                      <span>₹{REGISTRATION_FEE}</span>
                    </div>
                    <div className="flex justify-between text-sm font-semibold text-gray-900">
                      <span>Plan Fee</span>
                      <span>₹{MEMBERSHIP_OFFERS[plan]['Half-day'] - REGISTRATION_FEE}</span>
                    </div>
                  </div>

                  <Button
                    variant="primary"
                    onClick={() => handleSelect(plan, 'Half-day')}
                    fullWidth
                  >
                    Select Plan
                  </Button>
                </Card>

                {/* Full-day */}
                <Card className="border-2 border-blue-500 relative">
                  <div className="absolute -top-3 -right-3 bg-yellow-400 text-black text-xs font-bold px-2 py-1 rounded">
                    POPULAR
                  </div>
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-xl font-bold text-gray-900">Full Day</h3>
                      <p className="text-sm text-gray-600">9am-9pm</p>
                    </div>
                    <span className="text-2xl font-bold text-blue-600">₹{MEMBERSHIP_OFFERS[plan]['Full-day']}</span>
                  </div>

                  <div className="bg-blue-50 p-4 rounded-lg mb-4">
                    <p className="text-sm text-gray-700">
                      <strong>{durations[plan]}</strong> access
                    </p>
                    <p className="text-xs text-gray-600 mt-1">Full day • Premium benefits</p>
                  </div>

                  <div className="space-y-2 mb-6">
                    <div className="flex items-center gap-2">
                      <span className="text-green-500">✓</span>
                      <span className="text-sm text-gray-700">Full day access (12 hours)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-green-500">✓</span>
                      <span className="text-sm text-gray-700">Both morning & evening slots</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-green-500">✓</span>
                      <span className="text-sm text-gray-700">QR-based entry</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-green-500">✓</span>
                      <span className="text-sm text-gray-700">Premium facilities</span>
                    </div>
                  </div>

                  <div className="border-t pt-4 mb-4">
                    <p className="text-xs text-gray-600 mb-2">Charges breakdown:</p>
                    <div className="flex justify-between text-sm mb-1">
                      <span>Registration Fee</span>
                      <span>₹{REGISTRATION_FEE}</span>
                    </div>
                    <div className="flex justify-between text-sm font-semibold text-gray-900">
                      <span>Plan Fee</span>
                      <span>₹{MEMBERSHIP_OFFERS[plan]['Full-day'] - REGISTRATION_FEE}</span>
                    </div>
                  </div>

                  <Button
                    variant="primary"
                    onClick={() => handleSelect(plan, 'Full-day')}
                    fullWidth
                  >
                    Select Plan
                  </Button>
                </Card>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
