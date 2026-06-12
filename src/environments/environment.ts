export const environment = {
  production: false,
  domainUrl: 'http://127.0.0.1:5000',
  storeLat: 16.019693,
  storeLng: 108.197694,
  // Firebase Auth project (quanlysongminh - shared with TapHoa39BanHang for same login)
  firebase: {
    apiKey: "AIzaSyD6BQL55uF9zGLG0daKiZln8knS8_BoXS8",
    authDomain: "quanlysongminh.firebaseapp.com",
    projectId: "quanlysongminh",
    storageBucket: "quanlysongminh.firebasestorage.app",
    messagingSenderId: "245620111851",
    appId: "1:245620111851:web:110acf5f993691c14f81ae",
    measurementId: "G-Y0FXR6CW04"
  },
  // Firebase Chat project (taphoa39khachhang - for realtime order notifications)
  firebaseChat: {
    apiKey: "AIzaSyCsn7rfux51q26YuB37-Mtd1BzDbE3dMnM",
    authDomain: "taphoa39khachhang.firebaseapp.com",
    projectId: "taphoa39khachhang",
    storageBucket: "taphoa39khachhang.firebasestorage.app",
    messagingSenderId: "127064970883",
    appId: "1:127064970883:web:aff38421e01812a449adb6",
    measurementId: "G-R523DJVKR4"
  },
  // Firebase Products project (for realtime product sync)
  firebaseProducts: {
    apiKey: "AIzaSyBNOqptA-1BpBNmXWcRXRq1kP8V0Z02fJk",
    authDomain: "products-6a635.firebaseapp.com",
    projectId: "products-6a635",
    storageBucket: "products-6a635.firebasestorage.app",
    messagingSenderId: "968502699922",
    appId: "1:968502699922:web:ff93eb49d2b7c73dac834b",
    measurementId: "G-2CKY5V82D8"
  }
};
