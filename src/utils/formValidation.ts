export interface ValidationRule {
  validate: (value: any) => boolean;
  message: string;
}

export interface FormErrors {
  [key: string]: string;
}

export const validators = {
  required: (): ValidationRule => ({
    validate: (v) => v !== null && v !== undefined && v !== '',
    message: 'This field is required',
  }),

  email: (): ValidationRule => ({
    validate: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    message: 'Please enter a valid email address',
  }),

  phone: (): ValidationRule => ({
    validate: (v) => /^\d{10}$/.test(v.replace(/[^0-9]/g, '')),
    message: 'Please enter a valid 10-digit phone number',
  }),

  minLength: (length: number): ValidationRule => ({
    validate: (v) => String(v).length >= length,
    message: `Minimum length is ${length} characters`,
  }),

  maxLength: (length: number): ValidationRule => ({
    validate: (v) => String(v).length <= length,
    message: `Maximum length is ${length} characters`,
  }),

  minValue: (value: number): ValidationRule => ({
    validate: (v) => Number(v) >= value,
    message: `Minimum value is ${value}`,
  }),

  maxValue: (value: number): ValidationRule => ({
    validate: (v) => Number(v) <= value,
    message: `Maximum value is ${value}`,
  }),

  match: (otherValue: any, fieldName: string): ValidationRule => ({
    validate: (v) => v === otherValue,
    message: `Must match ${fieldName}`,
  }),
};

export const validateField = (
  value: any,
  rules: ValidationRule[]
): string | null => {
  for (const rule of rules) {
    if (!rule.validate(value)) {
      return rule.message;
    }
  }
  return null;
};

export const validateForm = (
  formData: Record<string, any>,
  fieldRules: Record<string, ValidationRule[]>
): FormErrors => {
  const errors: FormErrors = {};

  for (const [field, rules] of Object.entries(fieldRules)) {
    const error = validateField(formData[field], rules);
    if (error) {
      errors[field] = error;
    }
  }

  return errors;
};
