export type MembershipPlan = 'Monthly' | 'Quarterly' | 'Half-yearly' | 'Yearly';
export type DayType = 'Half-day' | 'Full-day';
export type SlotType = '9am-3pm' | '3pm-9pm' | '9am-9pm';
export type PaymentMethod = 'cash' | 'upi';

export interface MembershipPlans {
  [key: string]: {
    [key: string]: number;
  };
}

export interface AdmissionFormData {
  fullName: string;
  fathersName: string;
  whatsappNumber: string;
  alternateNumber: string;
  email: string;
  address: string;
  aadhaarNumber: string;
  dateOfBirth: string;
  occupation: string;
  emergencyContact: string;
}

export interface BookingData {
  membershipPlan: MembershipPlan;
  dayType: DayType;
  selectedDate: Date;
  slotType: SlotType;
  seatNumber: number;
  paymentMethod: PaymentMethod;
}
