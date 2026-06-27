// Accessibility helper utilities and components

export const skipToMainContent = () => {
  const mainContent = document.getElementById('main-content');
  if (mainContent) {
    mainContent.focus();
    mainContent.scrollIntoView();
  }
};

export const AccessibleButton = ({
  onClick,
  children,
  ariaLabel,
  disabled = false,
  className = '',
  type = 'button' as const,
}: {
  onClick?: () => void;
  children: React.ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit' | 'reset';
}) => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled}
    aria-label={ariaLabel}
    className={`${className} focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded`}
  >
    {children}
  </button>
);

export const AccessibleInput = ({
  label,
  id,
  error,
  required = false,
  ...props
}: {
  label: string;
  id: string;
  error?: string;
  required?: boolean;
  [key: string]: any;
}) => (
  <div>
    <label htmlFor={id} className="block font-semibold mb-2">
      {label}
      {required && <span className="text-red-600 ml-1">*</span>}
    </label>
    <input
      id={id}
      aria-invalid={!!error}
      aria-describedby={error ? `${id}-error` : undefined}
      {...props}
    />
    {error && (
      <p id={`${id}-error`} className="text-red-600 text-sm mt-1" role="alert">
        {error}
      </p>
    )}
  </div>
);

export const SkipToMainContent = () => (
  <a
    href="#main-content"
    onClick={() => skipToMainContent()}
    className="absolute top-0 left-0 bg-blue-600 text-white px-4 py-2 rounded -translate-y-full focus:translate-y-0 transition-transform"
  >
    Skip to main content
  </a>
);
