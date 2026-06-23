import { useState } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { SLOT_TYPES, TOTAL_SEATS } from '../../lib/constants';
import { SlotType } from '../../types';

interface SlotSelectionProps {
  dayType: 'Half-day' | 'Full-day';
  onNext: (slotType: SlotType, startDate: Date) => void;
  onBack: () => void;
}

export function SlotSelectionPage({ dayType, onNext, onBack }: SlotSelectionProps) {
  const [selectedSlot, setSelectedSlot] = useState<SlotType | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [error, setError] = useState('');

  // Mock availability data
  const availableSeats: { [key: string]: number } = {
    '9am-3pm': 25,
    '3pm-9pm': 20,
    '9am-9pm': 15,
  };

  const allowedSlots = dayType === 'Half-day'
    ? SLOT_TYPES.filter(s => s.id !== '9am-9pm')
    : SLOT_TYPES.filter(s => s.id === '9am-9pm');

  const handleSubmit = () => {
    if (!selectedSlot || !selectedDate) {
      setError('Please select both slot and date');
      return;
    }
    onNext(selectedSlot, new Date(selectedDate));
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white p-4 sm:p-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <button onClick={onBack} className="text-blue-500 hover:text-blue-600 mb-4 flex items-center gap-2">
            ← Back
          </button>
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900">Select Your Slot</h1>
          <div className="mt-4 flex justify-between items-center">
            <span className="text-sm font-semibold text-blue-600">Step 3 of 5</span>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map(i => (
                <div
                  key={i}
                  className={`h-2 w-8 rounded-full ${i <= 3 ? 'bg-blue-500' : 'bg-gray-300'}`}
                ></div>
              ))}
            </div>
          </div>
        </div>

        {/* Content */}
        <Card>
          <div className="space-y-6">
            {/* Time Slot Selection */}
            <div>
              <h2 className="text-lg font-bold text-gray-900 mb-4">Choose Your Time Slot</h2>
              <div className="grid grid-cols-1 gap-3">
                {allowedSlots.map(slot => (
                  <button
                    key={slot.id}
                    onClick={() => {
                      setSelectedSlot(slot.id as SlotType);
                      setError('');
                    }}
                    className={`p-4 rounded-lg border-2 transition text-left ${
                      selectedSlot === slot.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-300 hover:border-blue-400'
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="font-semibold text-gray-900">{slot.label}</p>
                        <p className="text-sm text-gray-600">{slot.hours}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-lg text-green-600">
                          {availableSeats[slot.id]}/{TOTAL_SEATS}
                        </p>
                        <p className="text-xs text-gray-600">seats available</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Date Selection */}
            <div>
              <h2 className="text-lg font-bold text-gray-900 mb-4">Select Start Date</h2>
              <input
                type="date"
                value={selectedDate}
                onChange={e => {
                  setSelectedDate(e.target.value);
                  setError('');
                }}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              />
              <p className="text-xs text-gray-600 mt-2">Your membership will start from this date</p>
            </div>

            {/* Summary */}
            {selectedSlot && selectedDate && (
              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                <h3 className="font-semibold text-gray-900 mb-2">Membership Summary</h3>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span>Time Slot:</span>
                    <span className="font-semibold">{selectedSlot}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Start Date:</span>
                    <span className="font-semibold">{new Date(selectedDate).toDateString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Available Seats:</span>
                    <span className="font-semibold text-green-600">{availableSeats[selectedSlot]}</span>
                  </div>
                </div>
              </div>
            )}

            {error && <p className="text-red-500 text-sm">{error}</p>}

            <div className="flex gap-4 pt-6">
              <Button variant="secondary" onClick={onBack} fullWidth>
                Back
              </Button>
              <Button variant="primary" onClick={handleSubmit} fullWidth>
                Next
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
