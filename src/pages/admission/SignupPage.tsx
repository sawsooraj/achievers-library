import { useState } from 'react';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import type { AdmissionFormData } from '../../types';

interface SignupPageProps {
  onNext: (data: AdmissionFormData) => void;
}

export function SignupPage({ onNext }: SignupPageProps) {
  const [formData, setFormData] = useState<AdmissionFormData>({
    fullName: '',
    fathersName: '',
    whatsappNumber: '',
    alternateNumber: '',
    email: '',
    address: '',
    aadhaarNumber: '',
    dateOfBirth: '',
    occupation: '',
    emergencyContact: '',
  });

  const [errors, setErrors] = useState<Partial<AdmissionFormData>>({});

  const validateForm = () => {
    const newErrors: Partial<AdmissionFormData> = {};

    if (!formData.fullName) newErrors.fullName = 'Full name is required';
    if (!formData.email) newErrors.email = 'Email is required';
    if (!formData.whatsappNumber) newErrors.whatsappNumber = 'WhatsApp number is required';
    if (!formData.address) newErrors.address = 'Address is required';
    if (!formData.dateOfBirth) newErrors.dateOfBirth = 'Date of birth is required';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateForm()) {
      onNext(formData);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    if (errors[name as keyof AdmissionFormData]) {
      setErrors(prev => ({
        ...prev,
        [name]: undefined
      }));
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white p-4 sm:p-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900">The Achievers' Library</h1>
          <p className="text-gray-600 mt-2">Admission Form</p>
          <div className="mt-4 flex justify-between items-center">
            <span className="text-sm font-semibold text-blue-600">Step 1 of 5</span>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map(i => (
                <div
                  key={i}
                  className={`h-2 w-8 rounded-full ${i === 1 ? 'bg-blue-500' : 'bg-gray-300'}`}
                ></div>
              ))}
            </div>
          </div>
        </div>

        {/* Form */}
        <Card>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Full Name"
              name="fullName"
              value={formData.fullName}
              onChange={handleChange}
              error={errors.fullName}
              placeholder="Enter your full name"
            />

            <Input
              label="Father's/Guardian's Name"
              name="fathersName"
              value={formData.fathersName}
              onChange={handleChange}
              placeholder="Enter father's name"
            />

            <Input
              label="WhatsApp Number"
              name="whatsappNumber"
              value={formData.whatsappNumber}
              onChange={handleChange}
              error={errors.whatsappNumber}
              placeholder="+91 XXXXXXXXXX"
              type="tel"
            />

            <Input
              label="Alternate Mobile Number"
              name="alternateNumber"
              value={formData.alternateNumber}
              onChange={handleChange}
              placeholder="+91 XXXXXXXXXX"
              type="tel"
            />

            <Input
              label="Email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              error={errors.email}
              placeholder="example@email.com"
              type="email"
            />

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Address</label>
              <textarea
                name="address"
                value={formData.address}
                onChange={handleChange}
                placeholder="Enter your address"
                className={`w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 ${
                  errors.address ? 'border-red-500' : ''
                }`}
                rows={3}
              />
              {errors.address && <p className="text-red-500 text-sm mt-1">{errors.address}</p>}
            </div>

            <Input
              label="Aadhaar/ID Number"
              name="aadhaarNumber"
              value={formData.aadhaarNumber}
              onChange={handleChange}
              placeholder="XXXX XXXX XXXX XXXX"
            />

            <Input
              label="Date of Birth"
              name="dateOfBirth"
              value={formData.dateOfBirth}
              onChange={handleChange}
              error={errors.dateOfBirth}
              type="date"
            />

            <Input
              label="Occupation/College/School"
              name="occupation"
              value={formData.occupation}
              onChange={handleChange}
              placeholder="Your occupation or institution"
            />

            <Input
              label="Emergency Contact Number"
              name="emergencyContact"
              value={formData.emergencyContact}
              onChange={handleChange}
              placeholder="+91 XXXXXXXXXX"
              type="tel"
            />

            <div className="flex gap-4 pt-6">
              <Button variant="secondary" fullWidth>
                Cancel
              </Button>
              <Button variant="primary" type="submit" fullWidth>
                Next
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
