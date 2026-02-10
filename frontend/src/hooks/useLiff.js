import { useState, useEffect, useRef } from 'react';
import liff from '@line/liff';

const useLiff = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState(null);
  const [lineUserId, setLineUserId] = useState(null);
  const isInitialized = useRef(false);

  // ตรวจสอบว่าอยู่ในโหมด Mock หรือไม่ (ปิดได้ผ่าน VITE_USE_MOCK=false)
  const useMockProfile = import.meta.env.VITE_USE_MOCK === 'true';

  useEffect(() => {
    // ป้องกันการ init ซ้ำจาก React Strict Mode
    if (isInitialized.current) return;
    
    isInitialized.current = true;

    // ถ้าเปิดโหมด Mock ให้ใช้ mock profile (ต้องตั้ง VITE_USE_MOCK=true ใน .env)
    if (useMockProfile) {
      console.log('🔧 Mock Mode: Using mock profile');
      setProfile({
        userId: 1,
        displayName: 'Dev User',
        pictureUrl: 'https://via.placeholder.com/150/3b82f6/ffffff?text=DEV',
        email: 'dev@example.com',
        role: 'admin'
      });
      setLineUserId('dev-user-id');
      setIsLoggedIn(true);
      setIsLoading(false);
      return;
    }

    initializeLiff();
  }, []);

  const initializeLiff = async () => {
    try {
      const liffId = import.meta.env.VITE_LIFF_ID;
      
      if (!liffId) {
        throw new Error('LIFF ID ไม่ได้ถูกตั้งค่า กรุณาตรวจสอบไฟล์ .env');
      }

      await liff.init({ liffId });

      if (liff.isLoggedIn()) {
        // ลบ authorization code จาก URL เพื่อป้องกัน error เมื่อ reload
        const url = new URL(window.location.href);
        if (url.searchParams.has('code') || url.searchParams.has('state') || url.searchParams.has('liffClientId')) {
          // Clean URL โดยเอา query parameters ออก
          url.search = '';
          window.history.replaceState({}, document.title, url.toString());
        }

        try {
          const userProfile = await liff.getProfile();
          const accessToken = liff.getAccessToken();
          
          // เก็บ LINE User ID ไว้ใช้แสดงในหน้า error
          setLineUserId(userProfile.userId);
          
          console.log('User logged in:', userProfile.userId);
          
          if (!accessToken) {
            // ลอง login ใหม่
            console.warn('No access token, re-logging in...');
            liff.logout();
            window.location.reload();
            return;
          }
          
          // ตรวจสอบกับ Backend
          try {
            const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/verify`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ accessToken }),
            });

            const data = await response.json();

            if (response.ok && data.success) {
              setProfile({
                ...userProfile,
                userId: data.user.id,
                email: data.user.email,
                role: data.user.role
              });
              setIsLoggedIn(true);
            } else {
              // ถ้า token ไม่ valid ให้ logout และ login ใหม่
              if (response.status === 401) {
                console.warn('Token invalid, logging out...');
                liff.logout();
                window.location.reload();
                return;
              }
              throw new Error(data.message || 'User not authorized');
            }
          } catch (fetchError) {
            // ถ้า backend ไม่ทำงานหรือถูก block
            if (fetchError.message.includes('Failed to fetch') || fetchError.name === 'TypeError') {
              throw new Error('ไม่สามารถเชื่อมต่อกับ Backend API\n\n1. ตรวจสอบว่า Backend Server ทำงานที่ ' + import.meta.env.VITE_API_URL + '\n2. ปิด Ad Blocker หรือ Browser Extension ที่อาจ block request\n3. ตรวจสอบ CORS settings');
            }
            throw fetchError;
          }
        } catch (profileError) {
          // ถ้าเป็น error เรื่อง permission/scope
          if (profileError.message && profileError.message.includes('scope')) {
            throw new Error('LIFF app ไม่มี permission ที่จำเป็น\n\nกรุณาไปที่ LINE Developers Console:\n1. เปิด LIFF app settings\n2. เพิ่ม Scopes: profile, openid\n3. Save และลองใหม่อีกครั้ง');
          }
          throw profileError;
        }
      } else {
        liff.login();
      }
    } catch (err) {
      console.error('LIFF initialization failed', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    if (liff.isLoggedIn()) {
      liff.logout();
      setIsLoggedIn(false);
      setProfile(null);
      window.location.reload();
    }
  };

  return {
    isLoggedIn,
    isLoading,
    profile,
    error,
    lineUserId,
    logout,
    liff
  };
};

export default useLiff;
