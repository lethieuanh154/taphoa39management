// Runtime detection: Server VN dùng backend local
const getDomainUrl = (): string => {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    // Server VN: backend chạy cùng server nên domainUrl rỗng
    if (host === 'songminhcr.com' || host === 'management.songminhcr.com' || host === '103.173.154.35') {
      return '';
    }
  }
  // Render hoặc mặc định: dùng backend Render
  return 'https://taphoa39backend.onrender.com';
};

export const environment = {
  production: true,
  domainUrl: getDomainUrl(),
  // Firebase Chat project (taphoa39khachhang - for realtime order notifications)
  firebaseChat: {
    apiKey: "AIzaSyCsn7rfux51q26YuB37-Mtd1BzDbE3dMnM",
    authDomain: "taphoa39khachhang.firebaseapp.com",
    projectId: "taphoa39khachhang",
    storageBucket: "taphoa39khachhang.firebasestorage.app",
    messagingSenderId: "127064970883",
    appId: "1:127064970883:web:aff38421e01812a449adb6",
    measurementId: "G-R523DJVKR4"
  }
};
