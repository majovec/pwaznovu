import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, enableIndexedDbPersistence } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyBRwpuyQkbMBaX9E7hVx_WxQRd4mKf6dM4",
  authDomain: "silny-4182a.firebaseapp.com",
  projectId: "silny-4182a",
  storageBucket: "silny-4182a.firebasestorage.app",
  messagingSenderId: "987967454091",
  appId: "1:987967454091:web:e8c444e34a259d1bcf8d8e",
  measurementId: "G-B2JC1KTNCH"
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const storage = getStorage(firebaseApp);

// Firestore offline cache. If another tab already owns persistence, Firebase
// will continue normally without persistence in this tab.
enableIndexedDbPersistence(db).catch(() => {});

export const uidPath = (uid, collection) => `users/${uid}/${collection}`;
