import { useState, useRef } from 'react';

const ADMIN_PASSWORDS = ['admin', 'achievers123'];

interface LoginAttempts {
  count: number;
  timestamp: number;
}

export const useAdminAuth = () => {
  const [isAdmin, setIsAdmin] = useState(() => {
    const saved = localStorage.getItem('isAdmin');
    return saved === 'true';
  });
  const [adminError, setAdminError] = useState('');
  const [loginLocked, setLoginLocked] = useState(false);
  const loginAttemptsRef = useRef<LoginAttempts>({ count: 0, timestamp: 0 });

  const login = (password: string) => {
    const now = Date.now();
    const { count, timestamp } = loginAttemptsRef.current;

    if (count >= 5 && now - timestamp < 300000) {
      setAdminError('Too many attempts. Try again later.');
      setLoginLocked(true);
      return false;
    }

    if (now - timestamp > 300000) {
      loginAttemptsRef.current = { count: 0, timestamp: now };
    }

    const pwd = password.trim();
    const customAdminPassword = localStorage.getItem('customAdminPassword');
    const validPasswords = [...ADMIN_PASSWORDS];
    if (customAdminPassword) validPasswords.push(customAdminPassword);

    if (validPasswords.includes(pwd)) {
      loginAttemptsRef.current = { count: 0, timestamp: now };
      setLoginLocked(false);
      setAdminError('');
      setIsAdmin(true);
      localStorage.setItem('isAdmin', 'true');
      return true;
    } else {
      loginAttemptsRef.current = { count: count + 1, timestamp: timestamp === 0 ? now : timestamp };
      setAdminError('Invalid password!');
      if (loginAttemptsRef.current.count >= 5) {
        setLoginLocked(true);
      }
      setTimeout(() => setAdminError(''), 3000);
      return false;
    }
  };

  const logout = () => {
    setIsAdmin(false);
    localStorage.setItem('isAdmin', 'false');
  };

  return {
    isAdmin,
    login,
    logout,
    adminError,
    loginLocked,
  };
};
