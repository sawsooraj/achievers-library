import { useEffect, useState } from 'react';

export type AlertType = 'success' | 'error' | 'warning' | 'info';

interface AlertProps {
  message: string;
  type: AlertType;
  duration?: number;
  onClose?: () => void;
}

export const Alert = ({ message, type, duration = 5000, onClose }: AlertProps) => {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (duration === 0) return;
    const timer = setTimeout(() => {
      setIsVisible(false);
      onClose?.();
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  if (!isVisible) return null;

  const styles = {
    success: 'bg-green-50 border-green-200 text-green-800',
    error: 'bg-red-50 border-red-200 text-red-800',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    info: 'bg-blue-50 border-blue-200 text-blue-800',
  };

  const icons = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️',
  };

  return (
    <div className={`border-l-4 p-4 rounded ${styles[type]} flex items-start gap-3`}>
      <span className="text-xl flex-shrink-0">{icons[type]}</span>
      <div className="flex-1">
        <p className="font-semibold">{message}</p>
      </div>
      <button
        onClick={() => {
          setIsVisible(false);
          onClose?.();
        }}
        className="text-lg font-bold opacity-50 hover:opacity-100 ml-2"
        aria-label="Close alert"
      >
        ×
      </button>
    </div>
  );
};

// Hook for managing alerts
export const useAlert = () => {
  const [alerts, setAlerts] = useState<Array<AlertProps & { id: string }>>([]);

  const showAlert = (message: string, type: AlertType = 'info', duration = 5000) => {
    const id = Math.random().toString(36).substr(2, 9);
    setAlerts(prev => [...prev, { id, message, type, duration }]);
    return id;
  };

  const closeAlert = (id: string) => {
    setAlerts(prev => prev.filter(alert => alert.id !== id));
  };

  return { alerts, showAlert, closeAlert };
};
