// Modular SDK Imports
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { 
  getFirestore, collection, addDoc, updateDoc, doc, setDoc,
  query, where, orderBy, onSnapshot, getDocs, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { 
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, 
  createUserWithEmailAndPassword 
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

// Web App Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyDvjeTogG8mOArbl8K1m0JHC5y2UQO-Olo",
  authDomain: "parking-ea350.firebaseapp.com",
  projectId: "parking-ea350",
  storageBucket: "parking-ea350.firebasestorage.app",
  messagingSenderId: "415438583979",
  appId: "1:415438583979:web:96cd9482a8262bc66d5fee"
};

// Initialize Primary Firebase Instance
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Secondary Firebase Instance for creating sub-admins without logging out current user
const secondaryApp = initializeApp(firebaseConfig, "Secondary");
const secondaryAuth = getAuth(secondaryApp);

let isAdmin = false;

// Default Admin Credentials
const DEFAULT_ADMIN_EMAIL = "admin@parking.com";
const DEFAULT_ADMIN_PASS = "Admin123456";

// --- SELF-SETUP ROUTINE ---
async function initializeSystem() {
  try {
    const usersRef = collection(db, "users");
    const snapshot = await getDocs(usersRef);

    // If no users exist in Firestore, create the primary admin automatically
    if (snapshot.empty) {
      console.log("No admin users found. Initializing primary admin...");
      
      try {
        // Create user in Firebase Auth
        const cred = await createUserWithEmailAndPassword(auth, DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASS);
        
        // Save user profile to Firestore
        await setDoc(doc(db, "users", cred.user.uid), {
          full_name: "System Administrator",
          email: DEFAULT_ADMIN_EMAIL,
          role: "admin",
          created_at: serverTimestamp()
        });

        showPopup(`Default Admin Created! Email: ${DEFAULT_ADMIN_EMAIL} | Pass: ${DEFAULT_ADMIN_PASS}`, "success");
      } catch (authError) {
        // Handle case where account exists in Auth but not in Firestore collection
        if (authError.code === "auth/email-already-in-use") {
          await signInWithEmailAndPassword(auth, DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASS);
        } else {
          console.error("Auto setup error:", authError);
        }
      }
    } else if (!auth.currentUser) {
      // Auto-login with default admin if available
      try {
        await signInWithEmailAndPassword(auth, DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASS);
      } catch (e) {
        console.log("Manual login required or user credentials updated.");
      }
    }
  } catch (error) {
    console.error("System initialization check failed:", error);
  }
}

// Execute setup on script load
initializeSystem();

// --- AUTHENTICATION STATE TRACKER ---
onAuthStateChanged(auth, (user) => {
  const adminElements = document.querySelectorAll('.admin-only');
  const loginBtn = document.getElementById('admin-login-btn');
  const logoutBtn = document.getElementById('admin-logout-btn');

  if (user) {
    isAdmin = true;
    adminElements.forEach(el => el.classList.remove('hidden'));
    loginBtn.classList.add('hidden');
    logoutBtn.classList.remove('hidden');
  } else {
    isAdmin = false;
    adminElements.forEach(el => el.classList.add('hidden'));
    loginBtn.classList.remove('hidden');
    logoutBtn.classList.add('hidden');
  }
  
  loadParkedTrucks();
});

// Admin Login Handler
window.loginAdmin = function(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;

  signInWithEmailAndPassword(auth, email, password)
    .then(() => {
      showPopup("Logged in as Admin successfully", "success");
      closeLoginModal();
    })
    .catch((error) => {
      showPopup("Login Failed: " + error.message, "error");
    });
};

// Admin Logout Handler
window.logoutAdmin = function() {
  signOut(auth).then(() => showPopup("Logged out successfully", "success"));
};

// Modal Controls
window.openLoginModal = function() { document.getElementById('login-modal').classList.remove('hidden'); };
window.closeLoginModal = function() { document.getElementById('login-modal').classList.add('hidden'); };

// --- CREATE NEW ADMIN USER LOGIC ---
window.handleCreateUser = async function(e) {
  e.preventDefault();

  const fullName = document.getElementById('new-user-name').value;
  const email = document.getElementById('new-user-email').value;
  const password = document.getElementById('new-user-password').value;

  try {
    // 1. Create User in Auth using Secondary App (prevents main session logout)
    const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const newUid = userCredential.user.uid;

    // 2. Save user metadata to Firestore `users` collection
    await setDoc(doc(db, "users", newUid), {
      full_name: fullName,
      email: email,
      role: "admin",
      created_at: serverTimestamp()
    });

    // Sign out secondary auth instance immediately
    await signOut(secondaryAuth);

    showPopup(`Admin user ${fullName} created successfully!`, "success");
    document.getElementById('create-user-form').reset();
    
    loadAdminUsers();

  } catch (error) {
    showPopup("Failed to Create User: " + error.message, "error");
  }
};

// --- LOAD ADMIN USERS ---
async function loadAdminUsers() {
  const container = document.getElementById('users-list');
  container.innerHTML = `<tr><td colspan="4" class="text-center">Loading admin users...</td></tr>`;

  try {
    const usersRef = collection(db, "users");
    const q = query(usersRef, orderBy("created_at", "desc"));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      container.innerHTML = `<tr><td colspan="4" class="text-center">No registered users found.</td></tr>`;
      return;
    }

    let html = '';
    snapshot.forEach((docSnapshot) => {
      const data = docSnapshot.data();
      const createdAt = data.created_at ? data.created_at.toDate().toLocaleDateString() : 'N/A';

      html += `
        <tr>
          <td><strong>${data.full_name}</strong></td>
          <td>${data.email}</td>
          <td><span class="badge badge-bullin">${data.role}</span></td>
          <td>${createdAt}</td>
        </tr>
      `;
    });

    container.innerHTML = html;
  } catch (error) {
    showPopup("Error loading users: " + error.message, "error");
  }
}

// --- TRUCK ENTRY LOGIC WITH DUPLICATE CHECK ---
window.handleTruckEntry = async function(e) {
  e.preventDefault();

  const plateInput = document.getElementById('plate');
  const cleanPlate = plateInput.value.replace(/\s+/g, '').toUpperCase();
  const vehicleType = document.getElementById('vehicle-type').value;
  const driverName = document.getElementById('driver-name').value;

  try {
    // 1. Validation: Check if plate is actively parked
    const trucksRef = collection(db, "trucks");
    const q = query(trucksRef, where("license_plate", "==", cleanPlate), where("status", "==", "parked"));
    const duplicateCheck = await getDocs(q);

    if (!duplicateCheck.empty) {
      showPopup(`Failed: Truck ${cleanPlate} is already inside the parking!`, "error");
      return;
    }

    // 2. Add truck entry
    await addDoc(trucksRef, {
      license_plate: cleanPlate,
      vehicle_type: vehicleType,
      driver_name: driverName,
      entry_time: serverTimestamp(),
      exit_time: null,
      status: "parked"
    });

    showPopup(`Success: Truck ${cleanPlate} registered successfully!`, "success");
    document.getElementById('truck-entry-form').reset();

  } catch (error) {
    showPopup("Transaction Error: " + error.message, "error");
  }
};

// --- REAL-TIME PARKED TRUCKS LISTENER ---
function loadParkedTrucks() {
  const trucksRef = collection(db, "trucks");
  const q = query(trucksRef, where("status", "==", "parked"), orderBy("entry_time", "desc"));

  onSnapshot(q, (snapshot) => {
    const container = document.getElementById('parked-list');
    document.getElementById('parked-count').innerText = snapshot.size;

    if (snapshot.empty) {
      container.innerHTML = `<tr><td colspan="5" class="text-center">No trucks currently parked.</td></tr>`;
      return;
    }

    let html = '';
    snapshot.forEach((docSnapshot) => {
      const data = docSnapshot.data();
      const entryDate = data.entry_time ? data.entry_time.toDate().toLocaleString() : 'Processing...';

      html += `
        <tr>
          <td><strong>${data.license_plate}</strong></td>
          <td><span class="badge badge-${data.vehicle_type}">${data.vehicle_type.replace('_', ' ')}</span></td>
          <td>${data.driver_name}</td>
          <td>${entryDate}</td>
          ${isAdmin ? `<td><button class="btn-danger" onclick="markDeparted('${docSnapshot.id}', '${data.license_plate}')">Mark Departed</button></td>` : ''}
        </tr>
      `;
    });

    container.innerHTML = html;
  }, (error) => {
    console.error(error);
  });
}

// --- DEPARTURE LOGIC ---
window.markDeparted = async function(docId, plate) {
  try {
    const docRef = doc(db, "trucks", docId);
    await updateDoc(docRef, {
      status: "departed",
      exit_time: serverTimestamp()
    });

    showPopup(`Truck ${plate} marked as departed.`, "success");
  } catch (error) {
    showPopup("Error: " + error.message, "error");
  }
};

// --- LOAD DEPARTED HISTORY ---
async function loadDepartedHistory() {
  const container = document.getElementById('departed-list');
  container.innerHTML = `<tr><td colspan="5" class="text-center">Loading history...</td></tr>`;

  try {
    const trucksRef = collection(db, "trucks");
    const q = query(trucksRef, where("status", "==", "departed"), orderBy("exit_time", "desc"));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      container.innerHTML = `<tr><td colspan="5" class="text-center">No departure history found.</td></tr>`;
      return;
    }

    let html = '';
    snapshot.forEach((docSnapshot) => {
      const data = docSnapshot.data();
      const entryDate = data.entry_time ? data.entry_time.toDate().toLocaleString() : 'N/A';
      const exitDate = data.exit_time ? data.exit_time.toDate().toLocaleString() : 'N/A';

      html += `
        <tr>
          <td><strong>${data.license_plate}</strong></td>
          <td><span class="badge badge-${data.vehicle_type}">${data.vehicle_type.replace('_', ' ')}</span></td>
          <td>${data.driver_name}</td>
          <td>${entryDate}</td>
          <td>${exitDate}</td>
        </tr>
      `;
    });

    container.innerHTML = html;
  } catch (error) {
    showPopup("Error loading history: " + error.message, "error");
  }
}

// --- TAB NAVIGATION ---
window.switchTab = function(tabName, evt) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));

  if (tabName === 'parked') {
    evt.target.classList.add('active');
    document.getElementById('parked-view').classList.remove('hidden');
  } else if (tabName === 'departed') {
    evt.target.classList.add('active');
    document.getElementById('departed-view').classList.remove('hidden');
    loadDepartedHistory();
  } else if (tabName === 'users') {
    evt.target.classList.add('active');
    document.getElementById('users-view').classList.remove('hidden');
    loadAdminUsers();
  }
};

// --- POPUP NOTIFICATION HELPER ---
function showPopup(message, type = "success") {
  const popup = document.createElement("div");
  popup.className = `transaction-popup ${type}`;
  popup.innerText = message;

  document.body.appendChild(popup);

  setTimeout(() => {
    popup.remove();
  }, 3500);
}
