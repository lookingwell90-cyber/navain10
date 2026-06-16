import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

export const firebaseConfig = {
  apiKey: "AIzaSyDteptTOhJ1gjmNOrrnrIfepe2neg6hmkU",
  authDomain: "my-leads-app-f6198.firebaseapp.com",
  projectId: "my-leads-app-f6198",
  storageBucket: "my-leads-app-f6198.firebasestorage.app",
  messagingSenderId: "239949793404",
  appId: "1:239949793404:web:092e751967d04be2c8e1f9"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
