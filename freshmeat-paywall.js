// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBFxIFfgtTYT8vb42rPIQ-eJClzm73xttw",
  authDomain: "freshmeat-6bfd0.firebaseapp.com",
  projectId: "freshmeat-6bfd0",
  storageBucket: "freshmeat-6bfd0.firebasestorage.app",
  messagingSenderId: "329301869183",
  appId: "1:329301869183:web:5145e6b73cc5a85e85b54a",
  measurementId: "G-ZB314FHRJ6"
};

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig, "freshmeatPaywallApp");
const auth = getAuth(app);
const db = getFirestore(app);

// ---- Trial & Paywall Logic (Phone-verified, Firestore-backed) ----
// Free trial length: 30 days from the phone's first verified visit.
const TRIAL_DAYS = 30;
const PLATFORM_UPI_ID = "9940491206@upi"; // platform owner's UPI ID — access-fee payments always go here, same across all customer deployments, do not change per customer

// Access-fee tiers. All paid to PLATFORM_UPI_ID (this is the platform's own
// access fee, separate from any product/order payment the shop owner collects
// on their own UPI ID elsewhere in the app).
const TIERS = [
  { id: "day",   label: "1 Day",   price: 20,   hours: 24 },
  { id: "month", label: "1 Month", price: 200,  hours: 24 * 30 },
  { id: "year",  label: "1 Year",  price: 2000, hours: 24 * 365 }
];

let confirmationResult = null;

function getVerifiedPhone() {
  return localStorage.getItem("fm_verifiedPhone");
}

function setVerifiedPhone(phone) {
  localStorage.setItem("fm_verifiedPhone", phone);
}

// Each shop deployment (freshmeat-shop, freshmeat-customer1, etc.) sets its
// own window.SHOP_ID from its index.html's inline script. Trials are stored
// under trials/{shopId}/phones/{phone} so a customer's trial on one shop is
// completely independent from their trial on any other shop, even though
// every deployment shares the same Firestore project. Falls back to
// "default" only if a page somehow doesn't set window.SHOP_ID.
function getShopId() {
  return window.SHOP_ID || "default";
}

async function getOrCreateTrialDoc(phone) {
  const ref = doc(db, "trials", getShopId(), "phones", phone);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    return snap.data();
  }
  const data = { firstVisit: Date.now(), unlockUntil: 0 };
  await setDoc(ref, data);
  return data;
}

async function markPaid(phone, tier) {
  const unlockUntil = Date.now() + tier.hours * 60 * 60 * 1000;
  const ref = doc(db, "trials", getShopId(), "phones", phone);
  await setDoc(ref, { unlockUntil, lastTier: tier.id }, { merge: true });
  return unlockUntil;
}

function isAccessAllowed(trialData) {
  const now = Date.now();
  const trialExpiry = trialData.firstVisit + TRIAL_DAYS * 24 * 60 * 60 * 1000;
  if (now < trialExpiry) return true;
  if (now < (trialData.unlockUntil || 0)) return true;
  return false;
}

function showOverlay(innerHtml) {
  let overlay = document.getElementById("fm-paywall-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "fm-paywall-overlay";
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.6);
      display: flex; align-items: center; justify-content: center; z-index: 9999;
    `;
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = innerHtml;
  return overlay;
}

function removeOverlay() {
  const overlay = document.getElementById("fm-paywall-overlay");
  if (overlay) overlay.remove();
}

function showPhoneEntryScreen() {
  showOverlay(`
    <div style="background:#F7F1EA; border-radius:16px; padding:28px; max-width:340px; text-align:center; font-family:'Inter',sans-serif;">
      <h2 style="margin:0 0 8px;">Verify your phone</h2>
      <p style="color:#8A6F5C; margin:0 0 16px;">Enter your phone number to start your 30-day free trial</p>
      <input id="fm-phone-input" type="tel" placeholder="+91XXXXXXXXXX" style="width:100%; padding:10px; margin-bottom:12px; border-radius:8px; border:1px solid #ccc; box-sizing:border-box;" />
      <div id="fm-recaptcha-container"></div>
      <button id="fm-send-otp-btn" style="width:100%; padding:12px; background:#7A2323; color:white; border:none; border-radius:8px; font-size:16px; margin-top:8px;">Send OTP</button>
      <p id="fm-phone-error" style="color:#b00; font-size:13px; margin-top:10px;"></p>
    </div>
  `);

  const recaptchaVerifier = new RecaptchaVerifier(auth, "fm-recaptcha-container", {
    size: "invisible"
  });

  document.getElementById("fm-send-otp-btn").addEventListener("click", async () => {
    const phoneInput = document.getElementById("fm-phone-input");
    const phone = phoneInput.value.trim();
    const errorEl = document.getElementById("fm-phone-error");
    errorEl.textContent = "";

    if (!/^\+\d{10,15}$/.test(phone)) {
      errorEl.textContent = "Enter phone number with country code, e.g. +919940491206";
      return;
    }

    try {
      confirmationResult = await signInWithPhoneNumber(auth, phone, recaptchaVerifier);
      showOtpEntryScreen(phone);
    } catch (err) {
      errorEl.textContent = "Failed to send OTP. Please try again.";
      console.error(err);
    }
  });
}

function showOtpEntryScreen(phone) {
  showOverlay(`
    <div style="background:#F7F1EA; border-radius:16px; padding:28px; max-width:340px; text-align:center; font-family:'Inter',sans-serif;">
      <h2 style="margin:0 0 8px;">Enter OTP</h2>
      <p style="color:#8A6F5C; margin:0 0 16px;">We sent a code to ${phone}</p>
      <input id="fm-otp-input" type="text" inputmode="numeric" placeholder="123456" style="width:100%; padding:10px; margin-bottom:12px; border-radius:8px; border:1px solid #ccc; box-sizing:border-box;" />
      <button id="fm-verify-otp-btn" style="width:100%; padding:12px; background:#7A2323; color:white; border:none; border-radius:8px; font-size:16px;">Verify</button>
      <p id="fm-otp-error" style="color:#b00; font-size:13px; margin-top:10px;"></p>
    </div>
  `);

  document.getElementById("fm-verify-otp-btn").addEventListener("click", async () => {
    const code = document.getElementById("fm-otp-input").value.trim();
    const errorEl = document.getElementById("fm-otp-error");
    errorEl.textContent = "";

    try {
      await confirmationResult.confirm(code);
      setVerifiedPhone(phone);
      showTrialStartedScreen();
    } catch (err) {
      errorEl.textContent = "Incorrect code. Please try again.";
      console.error(err);
    }
  });
}

function showTrialStartedScreen() {
  showOverlay(`
    <div style="background:#F7F1EA; border-radius:16px; padding:28px; max-width:340px; text-align:center; font-family:'Inter',sans-serif;">
      <h2 style="margin:0 0 8px;">You're verified! 🎉</h2>
      <p style="color:#8A6F5C; margin:0 0 16px;">Enjoy your ${TRIAL_DAYS}-day free trial. After that, you can choose a plan to continue.</p>
      <button id="fm-start-shopping-btn" style="width:100%; padding:12px; background:#7A2323; color:white; border:none; border-radius:8px; font-size:16px;">Start Shopping</button>
    </div>
  `);

  document.getElementById("fm-start-shopping-btn").addEventListener("click", () => {
    removeOverlay();
    checkAccess();
  });
}

function renderTierOptionsHtml(selectedTierId) {
  return TIERS.map(tier => `
    <label style="display:flex; align-items:center; gap:10px; padding:10px 12px; margin-bottom:8px; border:1px solid ${tier.id === selectedTierId ? '#7A2323' : '#ccc'}; border-radius:8px; text-align:left; cursor:pointer;">
      <input type="radio" name="fm-tier" value="${tier.id}" ${tier.id === selectedTierId ? "checked" : ""} style="accent-color:#7A2323;" />
      <span style="flex:1;">${tier.label}</span>
      <strong>₹${tier.price}</strong>
    </label>
  `).join("");
}

function showPaywallScreen(phone) {
  let selectedTier = TIERS[0];

  function render() {
    const upiLink = `upi://pay?pa=${PLATFORM_UPI_ID}&pn=FreshMeat&am=${selectedTier.price}&cu=INR&tn=${encodeURIComponent(selectedTier.label + " access pass")}`;
    const qrImgSrc = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(upiLink)}`;

    showOverlay(`
      <div style="background:#F7F1EA; border-radius:16px; padding:28px; max-width:340px; text-align:center; font-family:'Inter',sans-serif;">
        <h2 style="margin:0 0 8px;">Free trial ended</h2>
        <p style="color:#8A6F5C; margin:0 0 16px;">Choose an access plan</p>
        <div id="fm-tier-list">${renderTierOptionsHtml(selectedTier.id)}</div>
        <img src="${qrImgSrc}" alt="UPI QR code" style="width:200px; height:200px; margin:8px 0 16px; border-radius:8px;" />
        <p style="font-size:13px; color:#8A6F5C; margin:0 0 16px;">Scan with any UPI app to pay ₹${selectedTier.price} for ${selectedTier.label.toLowerCase()}, then confirm below</p>
        <button id="fm-paid-btn" style="width:100%; padding:12px; background:#7A2323; color:white; border:none; border-radius:8px; font-size:16px;">I've paid</button>
      </div>
    `);

    document.querySelectorAll('input[name="fm-tier"]').forEach(input => {
      input.addEventListener("change", (e) => {
        selectedTier = TIERS.find(t => t.id === e.target.value) || TIERS[0];
        render();
      });
    });

    document.getElementById("fm-paid-btn").addEventListener("click", async () => {
      await markPaid(phone, selectedTier);
      removeOverlay();
    });
  }

  render();
}

async function checkAccess() {
  const phone = getVerifiedPhone();
  if (!phone) {
    showPhoneEntryScreen();
    return;
  }
  const trialData = await getOrCreateTrialDoc(phone);
  if (!isAccessAllowed(trialData)) {
    showPaywallScreen(phone);
  }
}

// Exposed for index.html to call before allowing checkout (opening the pay
// modal, or recording a payment). Re-checks trial status on demand and, if
// access has expired, shows the paywall overlay and tells the caller to
// abort — this is what actually blocks checkout, not just the visual
// overlay from the periodic checkAccess() poll below.
window.fmCheckAccessBlocking = async function () {
  const phone = getVerifiedPhone();
  if (!phone) {
    showPhoneEntryScreen();
    return false;
  }
  const trialData = await getOrCreateTrialDoc(phone);
  if (!isAccessAllowed(trialData)) {
    showPaywallScreen(phone);
    return false;
  }
  return true;
};

checkAccess();

// Re-check periodically so a tab that's already open gets paywalled the
// moment the trial (or paid access) expires, instead of only on the next
// full page reload. Only poll once the phone is verified — polling before
// that would re-render (and reset) the phone/OTP entry screens mid-typing.
setInterval(() => {
  if (getVerifiedPhone()) {
    checkAccess();
  }
}, 15000); // every 15s
