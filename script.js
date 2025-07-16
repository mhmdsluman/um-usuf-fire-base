// Add this at the very top of script.js to confirm it's loading
console.log("script.js loaded and executing.");

// Firebase Imports (MUST BE USED)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getAuth, 
    signInAnonymously, 
    signInWithCustomToken, 
    onAuthStateChanged,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    getDoc, 
    setDoc, 
    updateDoc, 
    deleteDoc, 
    onSnapshot, 
    collection, 
    query, 
    where, 
    addDoc,
    getDocs,
    writeBatch 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- GLOBAL STATE & DEFAULTS ---
// Firebase related globals
let app;
let db;
let auth;
let userId = 'anonymous'; // Default to anonymous, will be updated by auth listener
let currentUserRole = 'anonymous'; // Default role, will be updated after login
let isAuthReady = false; // Flag to ensure Firestore operations wait for auth
let authMode = 'login'; // 'login' or 'signup'

// Application data caches (will be populated by Firestore listeners)
let studentsCache = [];
let classesCache = [];
let settingsCache = {};
let attendanceCache = {};
let plansCache = [];
let notificationsCache = [];
let examsCache = {};
let financialsCache = {};

const defaultSettings = { theme: 'light', themeColor: '#0d9488', currency: 'SDG', examFields: [{ name: "جودة الحفظ", mark: 50 }, { name: "أحكام التجويد", mark: 30 }, { name: "جمال الصوت", mark: 20 }] };
let weeklyProgressChart, classDistributionChart, incomeOverTimeChart;

// Global constants for Firestore paths
const APP_ID = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// --- INITIALIZATION ---
// Use DOMContentLoaded for faster and more reliable script execution
document.addEventListener('DOMContentLoaded', () => {
    initializeAppState();
    setupEventListeners();
});

async function initializeAppState() {
    try {
        let firebaseConfig = {};
        console.log("Raw __firebase_config:", typeof __firebase_config !== 'undefined' ? __firebase_config : "undefined");

        // Check if __firebase_config is defined and not an empty string
        if (typeof __firebase_config !== 'undefined' && __firebase_config && __firebase_config.trim() !== '') {
            try {
                firebaseConfig = JSON.parse(__firebase_config);
                console.log("Firebase config loaded successfully:", firebaseConfig);
            } catch (e) {
                console.error("Error parsing __firebase_config. Raw config:", __firebase_config, "Error:", e);
                customAlert("خطأ في تهيئة Firebase: إعدادات غير صالحة. يرجى التحقق من إعدادات المشروع.");
                return; // Stop initialization if config is bad
            }
        } else {
            console.error("__firebase_config is undefined or empty. Firebase will not be initialized.");
            customAlert("خطأ: لم يتم توفير إعدادات Firebase. لن تعمل الميزات المستندة إلى السحابة.");
            return; // Stop initialization if no config
        }

        // Initialize app first
        app = initializeApp(firebaseConfig);
        if (!app) {
            console.error("Firebase app failed to initialize.");
            customAlert("فشل تهيئة تطبيق Firebase. يرجى التحقق من إعدادات Firebase.");
            return;
        }
        console.log("Firebase app initialized.");

        // Initialize db and auth using the initialized app
        db = getFirestore(app);
        auth = getAuth(app);

        // Explicitly check if Firebase services were initialized
        if (!db || !auth) {
            console.error("Firebase Firestore or Auth services failed to initialize.");
            customAlert("فشل تهيئة خدمات Firebase الأساسية (قاعدة البيانات أو المصادقة). يرجى التحقق من اتصالك بالإنترنت وإعدادات Firebase.");
            return;
        }
        console.log("Firebase Firestore and Auth initialized.");

        // --- DEVELOPMENT BYPASS: Always attempt to authenticate and show main app ---
        console.log("DEVELOPMENT BYPASS: Attempting to sign in and show main app directly.");
        const authScreen = document.getElementById('auth-screen');
        const appContainer = document.getElementById('app-container');

        // Attempt to sign in with custom token or anonymously
        try {
            if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                await signInWithCustomToken(auth, __initial_auth_token);
                console.log("Signed in with custom token for bypass.");
            } else {
                await signInAnonymously(auth);
                console.log("Signed in anonymously for bypass.");
            }
        } catch (error) {
            console.error("Firebase Auth error during bypass sign-in:", error);
            const authMessage = document.getElementById('auth-message');
            if (authMessage) {
                authMessage.textContent = "فشل تسجيل الدخول التلقائي. يرجى تسجيل الدخول يدويا.";
                authMessage.classList.remove('hidden');
            }
        }

        // Now, set up the onAuthStateChanged listener to handle the user state
        onAuthStateChanged(auth, async (user) => {
            const userIdDisplay = document.getElementById('user-id-display');

            if (user) {
                userId = user.uid;
                // Fetch user role from Firestore
                const userProfileRef = doc(db, `artifacts/${APP_ID}/users/${userId}/profile/data`);
                const userProfileSnap = await getDoc(userProfileRef);
                if (userProfileSnap.exists()) {
                    currentUserRole = userProfileSnap.data().role || 'teacher'; // Default to teacher if not set
                } else {
                    // For existing users without a profile or new anonymous users, set a default role
                    // For now, anonymous users will have 'anonymous' role, email/password users 'teacher'
                    currentUserRole = user.email ? 'teacher' : 'anonymous'; 
                    await setDoc(userProfileRef, { role: currentUserRole }, { merge: true });
                }

                isAuthReady = true; // Mark auth as ready
                console.log("Authenticated with UID:", userId, "Role:", currentUserRole);

                // Hide auth screen, show main app
                if (authScreen) authScreen.classList.add('hidden');
                if (appContainer) appContainer.classList.remove('hidden');
                
                if (userIdDisplay) {
                    userIdDisplay.textContent = `معرف المستخدم: ${userId} (الدور: ${currentUserRole})`;
                }

                // Once authenticated, set up Firestore listeners
                setupFirestoreListeners();
                // Initial setup for date inputs and view
                const financialMonthInput = document.getElementById('financial-month');
                const attendanceDateInput = document.getElementById('attendance-date');
                const currencySelect = document.getElementById('currency-select');

                const today = new Date();
                if (financialMonthInput) financialMonthInput.value = today.toISOString().slice(0, 7);
                if (attendanceDateInput) attendanceDateInput.value = today.toISOString().slice(0, 10);
                if (currencySelect) currencySelect.value = settingsCache.currency; 
                
                showView('dashboard-view'); // Call global function
                createNotification("تم تحميل التطبيق بنجاح.", "system");

            } else {
                // This block will be hit if the user explicitly logs out
                userId = 'anonymous'; // Reset userId if logged out
                currentUserRole = 'anonymous'; // Reset role
                isAuthReady = false; // Mark auth as not ready
                console.log("No user found or logged out.");
                
                // Show auth screen, hide main app
                if (authScreen) authScreen.classList.remove('hidden');
                if (appContainer) appContainer.classList.add('hidden');
            }
            applyRoleBasedUI(); // Apply UI changes based on the resolved role
        });

    } catch (e) {
        console.error("Critical error during Firebase initialization:", e);
        customAlert("فشل حرج في تهيئة التطبيق. يرجى التحقق من اتصالك بالإنترنت ومراجعة سجلات الأخطاء.");
    }
}

function setupFirestoreListeners() {
    // Ensure listeners are only set up once and after auth is ready
    if (!isAuthReady || !userId) return;

    // Setup real-time listeners for all main collections
    onSnapshot(collection(db, `artifacts/${APP_ID}/users/${userId}/students`), (snapshot) => {
        studentsCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderAll();
        console.log("Students data updated from Firestore.");
    }, (error) => console.error("Error fetching students:", error));

    onSnapshot(collection(db, `artifacts/${APP_ID}/users/${userId}/classes`), (snapshot) => {
        classesCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderAll();
        console.log("Classes data updated from Firestore.");
    }, (error) => console.error("Error fetching classes:", error));

    onSnapshot(doc(db, `artifacts/${APP_ID}/users/${userId}/settings/appSettings`), (docSnapshot) => {
        settingsCache = { ...defaultSettings, ...(docSnapshot.exists() ? docSnapshot.data() : {}) };
        applySettings(); // Call global function
        renderAll();
        console.log("Settings data updated from Firestore.");
    }, (error) => console.error("Error fetching settings:", error));

    onSnapshot(collection(db, `artifacts/${APP_ID}/users/${userId}/attendance`), (snapshot) => {
        attendanceCache = {};
        snapshot.docs.forEach(doc => {
            attendanceCache[doc.id] = doc.data(); // doc.id will be the date string
        });
        renderAll();
        console.log("Attendance data updated from Firestore.");
    }, (error) => console.error("Error fetching attendance:", error));

    onSnapshot(collection(db, `artifacts/${APP_ID}/users/${userId}/plans`), (snapshot) => {
        plansCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderAll();
        console.log("Plans data updated from Firestore.");
    }, (error) => console.error("Error fetching plans:", error));

    onSnapshot(collection(db, `artifacts/${APP_ID}/users/${userId}/notifications`), (snapshot) => {
        notificationsCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderNotifications(); // Call global function. Notifications render separately as they update frequently
        console.log("Notifications data updated from Firestore.");
    }, (error) => console.error("Error fetching notifications:", error));

    onSnapshot(collection(db, `artifacts/${APP_ID}/users/${userId}/exams`), (snapshot) => {
        examsCache = {};
        snapshot.docs.forEach(doc => {
            examsCache[doc.id] = doc.data().exams; // doc.id will be studentId, data will be an array of exams
        });
        renderAll();
        console.log("Exams data updated from Firestore.");
    }, (error) => console.error("Error fetching exams:", error));

    onSnapshot(collection(db, `artifacts/${APP_ID}/users/${userId}/financials`), (snapshot) => {
        financialsCache = {};
        snapshot.docs.forEach(doc => {
            financialsCache[doc.id] = doc.data(); // doc.id will be the month string
        });
        renderAll();
        console.log("Financials data updated from Firestore.");
    }, (error) => console.error("Error fetching financials:", error));
}


function renderAll() {
    // Only render if authentication is ready and userId is set
    if (!isAuthReady || !userId) {
        console.log("Auth not ready or userId not set, skipping renderAll.");
        return;
    }
    renderStudentsTable(); // Call global function
    renderClassesGrid(); // Call global function
    renderPlans(); // Call global function
    // renderNotifications(); // Handled by its own onSnapshot
    renderExamFieldSettings(); // Call global function
    renderExamFieldsForEntry(); // Call global function
    renderFinancialsTable(); // Call global function
    updateDashboard(); // Call global function
    renderFinancialsDashboard(); // Call global function
    populateAllClassDropdowns(); // Call global function
    populateAllPlanDropdowns(); // Call global function
    applyRoleBasedUI(); // Call global function. Re-apply UI rules after data renders
}

// --- UI & NAVIGATION ---
window.showView = (viewId) => {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    const viewToShow = document.getElementById(viewId);
    if (viewToShow) viewToShow.classList.remove('hidden');
    if (window.innerWidth < 1024) document.getElementById('sidebar').classList.add('sidebar-closed');
    if (viewId === 'dashboard-view') updateDashboard();
    if (viewId === 'financials-dashboard-view') renderFinancialsDashboard();
};

function setupEventListeners() {
    console.log("Setting up event listeners...");
    // Ensure elements exist before attaching listeners
    const sidebarToggle = document.getElementById('sidebar-toggle');
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', () => document.getElementById('sidebar').classList.toggle('sidebar-closed'));
        console.log("Sidebar toggle listener attached.");
    } else {
        console.warn("Sidebar toggle element not found.");
    }

    const studentSearch = document.getElementById('student-search');
    if (studentSearch) {
        studentSearch.addEventListener('input', renderStudentsTable);
        console.log("Student search listener attached.");
    } else {
        console.warn("Student search element not found.");
    }

    const confirmCancelBtn = document.getElementById('confirm-cancel-btn');
    if (confirmCancelBtn) {
        confirmCancelBtn.addEventListener('click', () => closeModal('confirm-modal'));
        console.log("Confirm cancel button listener attached.");
    } else {
        console.warn("Confirm cancel button not found.");
    }

    const confirmOkBtn = document.getElementById('confirm-ok-btn');
    if (confirmOkBtn) {
        confirmOkBtn.addEventListener('click', () => { if (window.confirmCallback) window.confirmCallback(); closeModal('confirm-modal'); window.confirmCallback = null; });
        console.log("Confirm OK button listener attached.");
    } else {
        console.warn("Confirm OK button not found.");
    }

    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
        console.log("Theme toggle listener attached.");
    } else {
        console.warn("Theme toggle element not found.");
    }

    const themeColorPicker = document.getElementById('theme-color-picker');
    if (themeColorPicker) {
        themeColorPicker.addEventListener('input', (e) => applySettings(e.target.value));
        themeColorPicker.addEventListener('change', async (e) => {
            settingsCache.themeColor = e.target.value;
            if (isAuthReady && userId !== 'anonymous') { // Only save to Firestore if authenticated and not anonymous
                await setDoc(doc(db, `artifacts/${APP_ID}/users/${userId}/settings/appSettings`), settingsCache, { merge: true });
            }
            createNotification("تم حفظ لون الواجهة الجديد.", "success");
        });
        console.log("Theme color picker listeners attached.");
    } else {
        console.warn("Theme color picker element not found.");
    }

    const notificationBell = document.getElementById('notification-bell');
    if (notificationBell) {
        notificationBell.addEventListener('click', (e) => {
            e.stopPropagation();
            const notificationsPanel = document.getElementById('notifications-panel');
            if (notificationsPanel) notificationsPanel.classList.toggle('hidden');
        });
        console.log("Notification bell listener attached.");
    } else {
        console.warn("Notification bell element not found.");
    }
    document.body.addEventListener('click', () => {
        const notificationsPanel = document.getElementById('notifications-panel');
        if (notificationsPanel) notificationsPanel.classList.add('hidden');
    });

    populateCountryCodes(); // Call global function

    // --- Authentication Event Listeners ---
    const authForm = document.getElementById('auth-form');
    if (authForm) {
        authForm.addEventListener('submit', handleAuthFormSubmit);
        console.log("Auth form listener attached.");
    } else {
        console.warn("Auth form element not found.");
    }

    const toggleAuthModeBtn = document.getElementById('toggle-auth-mode');
    if (toggleAuthModeBtn) {
        toggleAuthModeBtn.addEventListener('click', toggleAuthMode);
        console.log("Toggle auth mode button listener attached.");
    } else {
        console.warn("Toggle auth mode button not found.");
    }

    const signInAnonymouslyBtn = document.getElementById('sign-in-anonymously');
    if (signInAnonymouslyBtn) {
        signInAnonymouslyBtn.addEventListener('click', handleAnonymousSignIn);
        console.log("Sign in anonymously button listener attached.");
    } else {
        console.warn("Sign in anonymously button not found.");
    }
}

window.applySettings = (newColor = null) => {
    const color = newColor || settingsCache.themeColor;
    document.body.classList.toggle('dark', settingsCache.theme === 'dark');
    document.documentElement.style.setProperty('--theme-color', color);
    const darkColor = Chart.helpers.color(color).darken(0.2).hexString();
    document.documentElement.style.setProperty('--theme-color-dark', darkColor);
    if (!newColor) {
        const themeColorPicker = document.getElementById('theme-color-picker');
        if (themeColorPicker) themeColorPicker.value = color;
    }
};

window.toggleTheme = async () => {
    settingsCache.theme = document.body.classList.contains('dark') ? 'light' : 'dark';
    applySettings();
    if (isAuthReady && userId !== 'anonymous') { // Only save to Firestore if authenticated and not anonymous
        await setDoc(doc(db, `artifacts/${APP_ID}/users/${userId}/settings/appSettings`), settingsCache, { merge: true });
    }
};

// --- AUTHENTICATION FUNCTIONS ---
async function handleAuthFormSubmit(e) {
    e.preventDefault();
    const emailInput = document.getElementById('auth-email');
    const passwordInput = document.getElementById('auth-password');
    const authMessage = document.getElementById('auth-message');

    if (!emailInput || !passwordInput || !authMessage) {
        console.error("Auth form elements not found.");
        return;
    }

    const email = emailInput.value;
    const password = passwordInput.value;
    authMessage.classList.add('hidden'); // Hide previous messages

    if (authMode === 'login') {
        await handleLogin(email, password);
    } else { // signup
        await handleSignUp(email, password);
    }
}

async function handleLogin(email, password) {
    const authMessage = document.getElementById('auth-message');
    try {
        await signInWithEmailAndPassword(auth, email, password);
        // onAuthStateChanged will handle UI update
        createNotification("تم تسجيل الدخول بنجاح.", "success");
    } catch (error) {
        let errorMessage = "فشل تسجيل الدخول. ";
        if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
            errorMessage += "البريد الإلكتروني أو كلمة المرور غير صحيحة.";
        } else if (error.code === 'auth/invalid-email') {
            errorMessage += "صيغة البريد الإلكتروني غير صالحة.";
        } else {
            errorMessage += error.message;
        }
        if (authMessage) {
            authMessage.textContent = errorMessage;
            authMessage.classList.remove('hidden');
        }
        console.error("Login error:", error);
    }
}

async function handleSignUp(email, password) {
    const authMessage = document.getElementById('auth-message');
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const newUserId = userCredential.user.uid;
        // Set default role for new user
        await setDoc(doc(db, `artifacts/${APP_ID}/users/${newUserId}/profile/data`), { role: 'teacher' });
        // onAuthStateChanged will handle UI update
        createNotification("تم إنشاء حساب وتسجيل الدخول بنجاح.", "success");
    } catch (error) {
        let errorMessage = "فشل إنشاء الحساب. ";
        if (error.code === 'auth/email-already-in-use') {
            errorMessage += "هذا البريد الإلكتروني مستخدم بالفعل.";
        } else if (error.code === 'auth/weak-password') {
            errorMessage += "كلمة المرور ضعيفة جداً (يجب أن تكون 6 أحرف على الأقل).";
        } else if (error.code === 'auth/invalid-email') {
            errorMessage += "صيغة البريد الإلكتروني غير صالحة.";
        } else {
            errorMessage += error.message;
        }
        if (authMessage) {
            authMessage.textContent = errorMessage;
            authMessage.classList.remove('hidden');
        }
        console.error("Sign-up error:", error);
    }
}

window.handleAnonymousSignIn = async () => {
    const authMessage = document.getElementById('auth-message');
    try {
        await signInAnonymously(auth);
        createNotification("تم تسجيل الدخول كزائر.", "info");
    } catch (error) {
        if (authMessage) {
            authMessage.textContent = `فشل تسجيل الدخول كزائر: ${error.message}`;
            authMessage.classList.remove('hidden');
        }
        console.error("Anonymous sign-in error:", error);
    }
}

window.handleLogout = async () => {
    if (!isAuthReady) { customAlert("الرجاء الانتظار حتى يتم تهيئة التطبيق."); return; }
    customConfirm("هل أنت متأكد من تسجيل الخروج؟", async () => {
        try {
            await signOut(auth);
            // onAuthStateChanged will handle UI update
            createNotification("تم تسجيل الخروج بنجاح.", "info");
        } catch (error) {
            customAlert(`فشل تسجيل الخروج: ${error.message}`);
            console.error("Logout error:", error);
        }
    });
};

function toggleAuthMode() {
    const submitBtn = document.getElementById('auth-submit-btn');
    const toggleBtn = document.getElementById('toggle-auth-mode');
    const authMessage = document.getElementById('auth-message');

    if (!submitBtn || !toggleBtn || !authMessage) {
        console.error("Auth mode toggle elements not found.");
        return;
    }

    authMessage.classList.add('hidden'); // Hide messages on mode switch

    if (authMode === 'login') {
        authMode = 'signup';
        submitBtn.textContent = 'إنشاء حساب';
        toggleBtn.textContent = 'تسجيل الدخول بحساب موجود';
    } else {
        authMode = 'login';
        submitBtn.textContent = 'تسجيل الدخول';
        toggleBtn.textContent = 'إنشاء حساب جديد';
    }
}

// --- ROLE-BASED UI CONTROL ---
window.applyRoleBasedUI = () => {
    const isAdmin = currentUserRole === 'admin';
    const isTeacher = currentUserRole === 'teacher';
    const isAnonymous = currentUserRole === 'anonymous';

    // Elements visible only to Admin
    document.querySelectorAll('[data-role-admin]').forEach(el => {
        el.classList.toggle('hidden', !isAdmin);
    });

    // Elements visible to Admin and Teacher (most data entry)
    document.querySelectorAll('[data-role-teacher-admin]').forEach(el => {
        el.classList.toggle('hidden', !(isAdmin || isTeacher));
    });

    // Specific elements
    const addStudentBtn = document.querySelector('#students-view button[onclick="openStudentModal()"]');
    if (addStudentBtn) addStudentBtn.classList.toggle('hidden', !(isAdmin || isTeacher));

    const assignClassBulkBtn = document.getElementById('assign-class-bulk');
    if (assignClassBulkBtn) assignClassBulkBtn.classList.toggle('hidden', !(isAdmin || isTeacher));

    const createClassBtn = document.querySelector('#classes-view button[onclick="openClassModal()"]');
    if (createClassBtn) createClassBtn.classList.toggle('hidden', !(isAdmin || isTeacher));

    const createPlanBtn = document.querySelector('#plans-view button[onclick="openPlanModal()"]');
    if (createPlanBtn) createPlanBtn.classList.toggle('hidden', !(isAdmin || isTeacher));

    const settingsView = document.getElementById('settings-view');
    if (settingsView) settingsView.classList.toggle('hidden', !isAdmin); // Settings only for admin

    // Student table actions (edit/delete buttons)
    // These are dynamically rendered, so we need to ensure the renderStudentsTable function
    // is aware of the role. For now, we'll rely on security rules to block actual actions.
    // A more robust UI approach would be to modify the renderStudentsTable to omit these buttons.
    // For this update, we'll assume security rules are the primary enforcement.
}


// --- MODALS ---
window.openModal = (modalId) => document.getElementById(modalId).classList.remove('hidden');
window.closeModal = (modalId) => document.getElementById(modalId).classList.add('hidden');
window.customAlert = (msg) => { document.getElementById('alert-message').textContent = msg; openModal('alert-modal'); };
window.customConfirm = (msg, cb) => { document.getElementById('confirm-message').textContent = msg; window.confirmCallback = cb; openModal('confirm-modal'); };

// --- DATA RENDERING ---
window.renderStudentsTable = () => {
    const searchTermInput = document.getElementById('student-search');
    const classFilterSelect = document.getElementById('filter-class');
    const tableBody = document.getElementById('students-table-body');

    const searchTerm = searchTermInput ? searchTermInput.value.toLowerCase() : '';
    const classFilter = classFilterSelect ? classFilterSelect.value : '';

    let filtered = studentsCache.filter(s => (s.name.toLowerCase().includes(searchTerm) || s.id.includes(searchTerm)) && (!classFilter || s.classId === classFilter));
    if (filtered.length === 0) { 
        if (tableBody) tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4">لم يتم العثور على طلاب.</td></tr>`; 
        return; 
    }
    
    const canEditDelete = currentUserRole === 'admin' || currentUserRole === 'teacher';

    if (tableBody) {
        tableBody.innerHTML = filtered.map(s => {
            const cls = classesCache.find(c => c.id === s.classId);
            const pages = Object.values(s.progress || {}).reduce((sum, p) => pSum + p.length, 0);
            let actionsHtml = '';
            if (canEditDelete) {
                actionsHtml = `<button class="text-blue-500 hover:text-blue-700 mx-1" onclick='openStudentModal("${s.id}")'>تعديل</button><button class="text-red-500 hover:text-red-700 mx-1" onclick='deleteStudent("${s.id}", "${s.name}")'>حذف</button>`;
            }
            return `<tr class="hover:bg-gray-50 dark:hover:bg-gray-600"><td class="py-3 px-2 text-center"><input type="checkbox" class="custom-checkbox student-checkbox" data-student-id="${s.id}"></td><td class="py-3 px-6 font-semibold text-theme dark:text-theme-dark cursor-pointer hover:underline" onclick="viewStudentProfile('${s.id}')">${s.name}</td><td class="py-3 px-6">${cls ? cls.name : 'غير محدد'}</td><td class="py-3 px-6">${pages}</td><td class="py-3 px-6">${s.age || 'N/A'}</td><td class="py-3 px-6 text-center">${actionsHtml}</td></tr>`;
        }).join('');
    }
};

window.viewClassDetails = (classId) => {
    // This function is called from the Classes View to show details of a specific class.
    // The original code did not have a dedicated 'class-details-view' rendering logic.
    // For now, we'll just log the ID and suggest this as a future enhancement.
    console.log("Viewing class details for:", classId);
    customAlert(`عرض تفاصيل الفصل: ${classesCache.find(c => c.id === classId)?.name || 'غير معروف'}`);
    // Future: Implement detailed class view with student list, class-specific stats, etc.
};


window.viewStudentProfile = (studentId) => {
    const student = studentsCache.find(s => s.id === studentId);
    if (!student) { customAlert("لم يتم العثور على الطالب."); return; }
    const profileView = document.getElementById('student-profile-view');
    const studentClass = classesCache.find(c => c.id === student.classId);
    const studentPlan = plansCache.find(p => p.id === student.planId);
    let contactLinks = '';
    if (student.phone && student.countryCode) {
        let cleanPhone = student.phone.startsWith('0') ? student.phone.substring(1) : student.phone;
        const fullPhone = `${student.countryCode.replace('+', '')}${cleanPhone}`;
        contactLinks = `<div class="flex gap-4 mt-4">
                            <a href="https://wa.me/${fullPhone}" target="_blank" class="flex items-center gap-2 bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.487 5.235 3.487 8.413.003 6.557-5.338 11.892-11.894 11.892-1.99 0-3.903-.52-5.586-1.456l-6.305 1.654zM6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.886-.001 2.267.655 4.398 1.804 6.043l-1.225 4.485 4.574-1.194z"/></svg>
                                واتساب
                            </a>
                            <a href="https://t.me/+${fullPhone}" target="_blank" class="flex items-center gap-2 bg-sky-500 text-white px-4 py-2 rounded-lg hover:bg-sky-600">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm7.14 8.33l-2.34 11.12c-.15.73-.59.9-1.2.56l-3.6-2.66-1.74 1.67c-.19.19-.36.37-.7.37l.25-3.72 6.7-6.04c.28-.25-.06-.39-.43-.14L7.3 12.44l-3.53-1.1c-.72-.23-.73-.73.14-1.08l12.4-4.62c.6-.23 1.1.14.93.87z"/></svg>
                                تليجرام
                            </a>
                        </div>`;
    }
    let memorizationHtml = '';
    const canToggleMemorization = currentUserRole === 'admin' || currentUserRole === 'teacher';

    for (let i = 1; i <= 30; i++) {
        const juzProgress = student.progress ? (student.progress[i] || []) : [];
        const percentage = (juzProgress.length / 20) * 100;
        memorizationHtml += `<div class="mb-4"><h4 class="font-semibold">الجزء ${i} (${juzProgress.length}/20)</h4><div class="w-full progress-bar-bg mt-1"><div class="progress-bar" style="width: ${percentage}%"></div></div><details class="mt-2"><summary class="cursor-pointer text-sm text-gray-500 dark:text-gray-400">عرض/تعديل الصفحات</summary><div class="memorization-grid mt-2 p-2 bg-gray-100 dark:bg-gray-800 rounded">${[...Array(20).keys()].map(p => `<div class="page-square ${juzProgress.includes(p + 1) ? 'memorized' : ''}" ${canToggleMemorization ? `onclick="togglePageMemorization('${student.id}', ${i}, ${p + 1})"` : ''}>${p + 1}</div>`).join('')}</div></details></div>`;
    }
    
    // Conditional rendering for notes textarea
    const notesTextarea = canToggleMemorization ? `<textarea id="student-notes" class="w-full p-2 border rounded dark:bg-gray-800 dark:border-gray-600" rows="4" onchange="updateStudentNote('${student.id}', this.value)">${student.notes || ''}</textarea>` : `<p class="w-full p-2 border rounded dark:bg-gray-800 dark:border-gray-600">${student.notes || 'لا توجد ملاحظات.'}</p>`;

    if (profileView) {
        profileView.innerHTML = `<div class="flex justify-between items-start"><div><h2 class="text-3xl font-bold">${student.name}</h2><p class="text-gray-500 dark:text-gray-400">تاريخ الانضمام: ${student.startDate || 'غير محدد'}</p></div><button class="bg-gray-200 dark:bg-gray-600 px-4 py-2 rounded-lg" onclick="showView('students-view')">العودة للطلاب</button></div><div class="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6"><div class="lg:col-span-1 bg-white dark:bg-gray-700 p-6 rounded-lg shadow-md"><h3 class="text-xl font-bold mb-4 border-b pb-2 dark:border-gray-600">معلومات الطالب</h3><p><strong>العمر:</strong> ${student.age || 'غير محدد'}</p><p><strong>ولي الأمر:</strong> ${student.guardianName || 'غير محدد'}</p><p><strong>الفصل:</strong> ${studentClass ? studentClass.name : 'غير محدد'}</p><p><strong>الخطة:</strong> ${studentPlan ? studentPlan.name : 'غير محدد'}</p>${contactLinks}<h3 class="text-xl font-bold mb-4 mt-6 border-b pb-2 dark:border-gray-600">ملاحظات المعلم</h3>${notesTextarea}</div><div class="lg:col-span-2 bg-white dark:bg-gray-700 p-6 rounded-lg shadow-md"><h3 class="text-xl font-bold mb-4">متابعة الحفظ التفصيلي</h3><div class="overflow-y-auto max-h-[70vh] pr-2">${memorizationHtml}</div></div></div>`;
    }
    showView('student-profile-view');
};

window.renderClassesGrid = () => {
    const grid = document.getElementById('classes-grid');
    if (classesCache.length === 0) { 
        if (grid) grid.innerHTML = `<p class="col-span-full text-center py-4">لم يتم إنشاء أي فصول بعد.</p>`; 
        return; 
    }
    
    const canEditDelete = currentUserRole === 'admin' || currentUserRole === 'teacher';

    if (grid) {
        grid.innerHTML = classesCache.map(cls => {
            const membersCount = studentsCache.filter(s => s.classId === cls.id).length;
            let actionsHtml = '';
            if (canEditDelete) {
                actionsHtml = `<button class="text-blue-500 hover:text-blue-700 mx-1 text-sm" onclick='event.stopPropagation(); openClassModal("${cls.id}")'>تعديل</button><button class="text-red-500 hover:text-red-700 mx-1 text-sm" onclick='event.stopPropagation(); deleteClass("${cls.id}", "${cls.name}")'>حذف</button>`;
            }
            return `<div class="bg-white dark:bg-gray-700 p-6 rounded-lg shadow-md flex flex-col justify-between cursor-pointer hover:shadow-lg transition-shadow" onclick="viewClassDetails('${cls.id}')"><div><img src="${cls.photo || `https://placehold.co/600x400/0d9488/ffffff?text=${encodeURIComponent(cls.name)}`}" class="w-full h-32 object-cover rounded-md mb-4" onerror="this.onerror=null;this.src='https://placehold.co/600x400/cccccc/ffffff?text=Error';"><h3 class="text-xl font-bold text-blue-700 dark:text-blue-400">${cls.name}</h3><p class="text-gray-600 dark:text-gray-300">${membersCount} طالب</p><p class="text-sm text-gray-500 dark:text-gray-400 mt-2">${cls.schedule || 'لم يحدد جدول'}</p><p class="font-bold text-theme dark:text-theme-dark mt-2">${cls.fee || 0} ${settingsCache.currency}</p></div><div class="mt-4 text-left">${actionsHtml}</div></div>`;
        }).join('');
    }
};

window.renderPlans = () => {
    const container = document.getElementById('plans-container');
    if (plansCache.length === 0) { 
        if (container) container.innerHTML = `<p class="text-center py-4">لم يتم إنشاء أي خطط بعد.</p>`; 
        return; 
    }
    
    const canEditDelete = currentUserRole === 'admin' || currentUserRole === 'teacher';

    if (container) {
        container.innerHTML = plansCache.map(plan => {
            let actionsHtml = '';
            if (canEditDelete) {
                actionsHtml = `<button class="text-blue-500 hover:text-blue-700 mx-1 text-sm" onclick='openPlanModal("${plan.id}")'>تعديل</button><button class="text-red-500 hover:text-red-700 mx-1 text-sm" onclick='deletePlan("${plan.id}", "${plan.name}")'>حذف</button>`;
            }
            return `<div class="bg-white dark:bg-gray-700 p-4 rounded-lg shadow-md"><h4 class="font-bold text-lg">${plan.name}</h4><p class="text-gray-600 dark:text-gray-300">${plan.description}</p><div class="mt-4 text-left">${actionsHtml}</div></div>`;
        }).join('');
    }
};

window.renderNotifications = () => {
    const panel = document.getElementById('notifications-panel-content');
    const dot = document.getElementById('notification-dot');
    notificationsCache.sort((a, b) => new Date(b.date) - new Date(a.date));
    const unreadCount = notificationsCache.filter(n => !n.read).length;
    if (dot) dot.classList.toggle('hidden', unreadCount === 0);
    if (notificationsCache.length === 0) { 
        if (panel) panel.innerHTML = `<p class="p-4 text-center text-gray-500">لا توجد إشعارات</p>`; 
        return; 
    }
    if (panel) {
        panel.innerHTML = notificationsCache.map(n => `<div class="p-3 border-b border-gray-200 dark:border-gray-600 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 ${!n.read ? 'bg-teal-50 dark:bg-teal-900' : ''}" onclick="openNotificationModal('${n.id}')"><p class="text-sm">${n.message}</p><p class="text-xs text-gray-500 dark:text-gray-400 mt-1">${new Date(n.date).toLocaleString()}</p></div>`).join('');
    }
};

window.renderExamFieldSettings = () => {
    const container = document.getElementById('exam-fields-settings-container');
    // Only render if user is admin
    if (currentUserRole !== 'admin') {
        if (container) container.innerHTML = `<p class="text-center py-4 text-gray-500">لا تملك صلاحية لإدارة حقول الاختبارات.</p>`;
        return;
    }
    if (container) {
        container.innerHTML = (settingsCache.examFields || []).map((field, index) => `<div class="flex items-center justify-between bg-gray-100 dark:bg-gray-600 p-2 rounded mb-2"><span>${field.name} (${field.mark} درجة)</span><button class="text-red-500 hover:text-red-700" onclick="removeExamField(${index})">&times;</button></div>`).join('');
    }
};

window.renderExamFieldsForEntry = () => {
    const container = document.getElementById('exam-fields-container');
    // Only render if user is admin or teacher
    if (currentUserRole !== 'admin' && currentUserRole !== 'teacher') {
        if (container) container.innerHTML = `<p class="text-center py-4 text-gray-500">لا تملك صلاحية لرصد درجات الاختبارات.</p>`;
        return;
    }
    if (container) {
        container.innerHTML = (settingsCache.examFields || []).map(field => `<div><label class="block mb-1 font-semibold">${field.name} (من ${field.mark})</label><input type="number" data-field-name="${field.name}" data-max-mark="${field.mark}" class="w-full p-2 border rounded dark:bg-gray-800 dark:border-gray-600 exam-score-field" placeholder="الدرجة"></div>`).join('');
    }
};

window.renderAttendanceTable = () => {
    const classIdSelect = document.getElementById('attendance-class-select');
    const dateInput = document.getElementById('attendance-date');
    const container = document.getElementById('attendance-table-container');
    
    if (currentUserRole !== 'admin' && currentUserRole !== 'teacher') {
        if (container) container.innerHTML = `<p class="text-center py-4 text-gray-500">لا تملك صلاحية لتسجيل الحضور والغياب.</p>`;
        return;
    }

    const classId = classIdSelect ? classIdSelect.value : '';
    const date = dateInput ? dateInput.value : '';

    if (!classId || !date) { 
        if (container) container.innerHTML = '<p class="text-center py-4">الرجاء اختيار فصل وتاريخ.</p>'; 
        return; 
    }
    const studentsInClass = studentsCache.filter(s => s.classId === classId);
    if (studentsInClass.length === 0) { 
        if (container) container.innerHTML = '<p class="text-center py-4">لا يوجد طلاب في هذا الفصل.</p>'; 
        return; 
    }
    const dailyRecord = attendanceCache[date] || {};
    if (container) {
        container.innerHTML = `<table class="min-w-full bg-white dark:bg-gray-700"><thead class="bg-gray-200 dark:bg-gray-600"><tr><th class="py-3 px-6 text-right">الاسم</th><th class="py-3 px-6 text-center">الحالة</th></tr></thead><tbody>${studentsInClass.map(student => `<tr class="hover:bg-gray-50 dark:hover:bg-gray-600"><td class="py-3 px-6">${student.name}</td><td class="py-3 px-6 text-center"><div class="flex justify-center gap-4"><label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="attendance-${student.id}" value="present" class="form-radio text-green-500" ${dailyRecord[student.id] === 'present' ? 'checked' : ''}><span>حاضر</span></label><label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="attendance-${student.id}" value="absent" class="form-radio text-red-500" ${dailyRecord[student.id] === 'absent' ? 'checked' : ''}><span>غائب</span></label></div></td></tr>`).join('')}</tbody></table>`;
    }
};

window.renderFinancialsTable = () => {
    const container = document.getElementById('financials-table-container');
    const monthInput = document.getElementById('financial-month');
    
    const month = monthInput ? monthInput.value : '';
    const monthData = financialsCache[month] || {};

    if (currentUserRole !== 'admin') { // Only admin can manage financials
        if (container) container.innerHTML = `<p class="text-center py-4 text-gray-500">لا تملك صلاحية لمتابعة الأمور المالية.</p>`;
        return;
    }

    if (studentsCache.length === 0) { 
        if (container) container.innerHTML = `<p class="text-center py-4">لا يوجد طلاب.</p>`; 
        return; 
    }
    if (container) {
        container.innerHTML = `<table class="min-w-full bg-white dark:bg-gray-700"><thead class="bg-gray-200 dark:bg-gray-600"><tr><th class="py-3 px-6 text-right">الطالب</th><th class="py-3 px-6 text-right">رسوم الفصل</th><th class="py-3 px-6 text-center">الحالة</th></tr></thead><tbody>${studentsCache.map(student => { const status = monthData[student.id] || 'pending'; const cls = classesCache.find(c => c.id === student.classId); const fee = cls ? (cls.fee || 0) : 0; return `<tr class="hover:bg-gray-50 dark:hover:bg-gray-600"><td class="py-3 px-6">${student.name}</td><td class="py-3 px-6">${fee} ${settingsCache.currency}</td><td class="py-3 px-6 text-center"><select data-student-id="${student.id}" class="p-1 border rounded dark:bg-gray-800 financial-status-select"><option value="pending" ${status === 'pending' ? 'selected' : ''}>لم يدفع</option><option value="paid" ${status === 'paid' ? 'selected' : ''}>دفع</option><option value="exempt" ${status === 'exempt' ? 'selected' : ''}>معفى</option></select></td></tr>`; }).join('')}</tbody></table>`;
    }
};

window.updateDashboard = () => {
    const totalStudentsDashboard = document.getElementById('total-students-dashboard');
    if (totalStudentsDashboard) totalStudentsDashboard.textContent = studentsCache.length;

    const today = new Date().toISOString().slice(0, 10);
    const activeToday = Object.values(attendanceCache[today] || {}).filter(s => s === 'present').length;
    const activeTodayDashboard = document.getElementById('active-today-dashboard');
    if (activeTodayDashboard) activeTodayDashboard.textContent = activeToday;

    const totalPages = studentsCache.reduce((sum, s) => sum + Object.values(s.progress || {}).reduce((pSum, p) => pSum + p.length, 0), 0);
    const totalPagesDashboard = document.getElementById('total-pages-dashboard');
    if (totalPagesDashboard) totalPagesDashboard.textContent = totalPages;
    
    let totalScores = 0, totalMaxScores = 0;
    Object.values(examsCache).flat().forEach(studentExams => { // examsCache stores studentId -> array of exams
        if (Array.isArray(studentExams)) {
            studentExams.forEach(exam => {
                totalScores += exam.totalScore;
                totalMaxScores += exam.maxScore;
            });
        }
    });
    const avgScore = totalMaxScores > 0 ? ((totalScores / totalMaxScores) * 100).toFixed(0) : 0;
    const avgExamScoreDashboard = document.getElementById('avg-exam-score-dashboard');
    if (avgExamScoreDashboard) avgExamScoreDashboard.textContent = `${avgScore}%`;

    renderTopStudents(); // Call global function
    renderWeeklyProgressChart(); // Call global function
    renderClassDistributionChart(); // Call global function
};

window.renderTopStudents = () => {
    const list = document.getElementById('top-students-list');
    const sorted = [...studentsCache].sort((a, b) => (Object.values(b.progress||{}).flat().length) - (Object.values(a.progress||{}).flat().length)).slice(0, 5);
    if (sorted.length === 0) { 
        if (list) list.innerHTML = `<p class="text-center text-gray-500">لا يوجد بيانات</p>`; 
        return; 
    }
    if (list) {
        list.innerHTML = sorted.map((s, i) => `<div class="flex justify-between items-center p-2 rounded ${i % 2 === 0 ? 'bg-gray-50 dark:bg-gray-800' : ''}"><div class="font-semibold">${i + 1}. ${s.name}</div><div class="text-theme dark:text-theme-dark font-bold">${Object.values(s.progress||{}).flat().length} صفحة</div></div>`).join('');
    }
};

window.renderWeeklyProgressChart = () => {
    const ctxCanvas = document.getElementById('weekly-progress-chart');
    if (!ctxCanvas) return;
    const ctx = ctxCanvas.getContext('2d');
    const labels = [];
    const data = [];
    const today = new Date();
    for (let i = 3; i >= 0; i--) {
        const weekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay() - (i * 7));
        labels.push(`أسبوع ${weekStart.toLocaleDateString('ar-EG', {day: '2-digit', month: '2-digit'})}`);
        
        // This part generates random data, it should be replaced with actual data from examsCache or tasmee data
        let pagesThisWeek = 0;
        // Example of how you might calculate real data (this is placeholder logic)
        studentsCache.forEach(student => {
            // Iterate through student's tasmee records for this week
            // For now, keeping the random generation as the original code did not have this data.
            if (Math.random() < (0.8 - i*0.1)) pagesThisWeek += Math.floor(Math.random() * 5); 
        });
        data.push(pagesThisWeek);
    }

    if (weeklyProgressChart) weeklyProgressChart.destroy();
    weeklyProgressChart = new Chart(ctx, { type: 'line', data: { labels, datasets: [{ label: 'صفحات تم تسميعها', data, borderColor: settingsCache.themeColor, backgroundColor: Chart.helpers.color(settingsCache.themeColor).alpha(0.2).rgbString(), fill: true, tension: 0.3 }] } });
};

window.renderClassDistributionChart = () => {
    const ctxCanvas = document.getElementById('class-distribution-chart');
    if (!ctxCanvas) return;
    const ctx = ctxCanvas.getContext('2d');
    const labels = classesCache.map(c => c.name);
    const data = classesCache.map(c => studentsCache.filter(s => s.classId === c.id).length);
    if (classDistributionChart) classDistributionChart.destroy();
    classDistributionChart = new Chart(ctx, { type: 'doughnut', data: { labels, datasets: [{ label: 'الطلاب', data, backgroundColor: ['#34d399', '#60a5fa', '#c084fc', '#f87171', '#fbbf24'] }] }, options: { responsive: true, plugins: { legend: { position: 'top' } } } });
};

window.renderFinancialsDashboard = () => {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const monthData = financialsCache[currentMonth] || {};
    let totalIncome = 0, pendingPayments = 0, exemptStudents = 0;

    studentsCache.forEach(student => {
        const status = monthData[student.id];
        const cls = classesCache.find(c => c.id === student.classId);
        const fee = cls ? (cls.fee || 0) : 0;
        if (status === 'paid') {
            totalIncome += fee;
        } else if (status === 'pending' || !status) {
            pendingPayments += fee;
        } else if (status === 'exempt') {
            exemptStudents++;
        }
    });

    const totalIncomeDashboard = document.getElementById('total-income-dashboard');
    if (totalIncomeDashboard) totalIncomeDashboard.textContent = `${totalIncome.toLocaleString()} ${settingsCache.currency}`;
    
    const pendingPaymentsDashboard = document.getElementById('pending-payments-dashboard');
    if (pendingPaymentsDashboard) pendingPaymentsDashboard.textContent = `${pendingPayments.toLocaleString()} ${settingsCache.currency}`;
    
    const exemptStudentsDashboard = document.getElementById('exempt-students-dashboard');
    if (exemptStudentsDashboard) exemptStudentsDashboard.textContent = exemptStudents;
    
    // Chart
    const ctxCanvas = document.getElementById('income-over-time-chart');
    if (!ctxCanvas) return;
    const ctx = ctxCanvas.getContext('2d');
    const labels = [];
    const expectedData = [];
    const actualData = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        const monthKey = d.toISOString().slice(0, 7);
        labels.push(monthKey);

        let expected = 0, actual = 0;
        const monthPayments = financialsCache[monthKey] || {};
        studentsCache.forEach(student => {
            const cls = classesCache.find(c => c.id === student.classId);
            const fee = cls ? (cls.fee || 0) : 0;
            if (monthPayments[student.id] !== 'exempt') {
                expected += fee;
            }
            if (monthPayments[student.id] === 'paid') {
                actual += fee;
            }
        });
        expectedData.push(expected);
        actualData.push(actual);
    }

    if(incomeOverTimeChart) incomeOverTimeChart.destroy();
    incomeOverTimeChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'الدخل الفعلي', data: actualData, backgroundColor: 'rgba(75, 192, 192, 0.6)' },
                { label: 'الدخل المتوقع', data: expectedData, backgroundColor: 'rgba(255, 99, 132, 0.6)' }
            ]
        }
    });
};

// --- DATA MANIPULATION ---
window.generateId = () => { return Date.now().toString(36) + Math.random().toString(36).substr(2); };

window.handleStudentFormSubmit = async (e) => {
    e.preventDefault();
    if (!isAuthReady || (currentUserRole !== 'admin' && currentUserRole !== 'teacher')) { customAlert("لا تملك صلاحية لحفظ بيانات الطلاب."); return; }

    const id = document.getElementById('student-id')?.value;
    const studentName = document.getElementById('student-name')?.value;
    const studentAge = document.getElementById('student-age')?.value;
    const studentGuardian = document.getElementById('student-guardian')?.value;
    const studentStartDate = document.getElementById('student-start-date')?.value;
    const studentPhone = document.getElementById('student-phone')?.value;
    const studentCountryCode = document.getElementById('student-country-code')?.value;
    const studentClassSelect = document.getElementById('student-class-select')?.value;
    const studentPlanSelect = document.getElementById('student-plan-select')?.value;
    const studentJuzStart = document.getElementById('student-juz-start')?.value;
    const studentNotesModal = document.getElementById('student-notes-modal')?.value;


    const studentData = {
        name: studentName,
        age: studentAge,
        guardianName: studentGuardian,
        startDate: studentStartDate,
        phone: studentPhone,
        countryCode: studentCountryCode,
        classId: studentClassSelect,
        planId: studentPlanSelect,
        juzStart: parseInt(studentJuzStart),
        notes: studentNotesModal,
        progress: id ? (studentsCache.find(s => s.id === id)?.progress || {}) : {}
    };

    try {
        if (id) {
            await setDoc(doc(db, `artifacts/${APP_ID}/users/${userId}/students`, id), studentData, { merge: true });
            createNotification(`تم تحديث بيانات الطالب ${studentData.name}`, "success");
        } else {
            const newStudentRef = doc(collection(db, `artifacts/${APP_ID}/users/${userId}/students`));
            studentData.id = newStudentRef.id;
            await setDoc(newStudentRef, studentData);

            if (studentData.classId) {
                const currentMonth = new Date().toISOString().slice(0, 7);
                const financialDocRef = doc(db, `artifacts/${APP_ID}/users/${userId}/financials`, currentMonth);
                const currentMonthData = (await getDoc(financialDocRef)).data() || {};
                currentMonthData[studentData.id] = 'pending';
                await setDoc(financialDocRef, currentMonthData, { merge: true });
            }
            createNotification(`تم إضافة طالب جديد: ${studentData.name}`, "success");
        }
        closeModal('student-modal');
    } catch (e) {
        console.error("Error saving student:", e);
        customAlert("فشل حفظ بيانات الطالب.");
    }
}

window.deleteStudent = (id, name) => {
    if (!isAuthReady || (currentUserRole !== 'admin' && currentUserRole !== 'teacher')) { customAlert("لا تملك صلاحية لحذف الطلاب."); return; }
    customConfirm(`هل أنت متأكد من حذف الطالب ${name}؟`, async () => {
        try {
            await deleteDoc(doc(db, `artifacts/${APP_ID}/users/${userId}/students`, id));
            await deleteDoc(doc(db, `artifacts/${APP_ID}/users/${userId}/exams`, id));
            
            for (const date in attendanceCache) {
                if (attendanceCache[date][id]) {
                    delete attendanceCache[date][id];
                    await setDoc(doc(db, `artifacts/${APP_ID}/users/${userId}/attendance`, date), attendanceCache[date]);
                }
            }

            for (const month in financialsCache) {
                if (financialsCache[month][id]) {
                    delete financialsCache[month][id];
                    await setDoc(doc(db, `artifacts/${APP_ID}/users/${userId}/financials`, month), financialsCache[month]);
                }
            }

            createNotification(`تم حذف الطالب ${name}`, "warning");
        } catch (e) {
            console.error("Error deleting student:", e);
            customAlert("فشل حذف الطالب.");
        }
    });
}

window.handleClassFormSubmit = async (e) => {
    e.preventDefault();
    if (!isAuthReady || (currentUserRole !== 'admin' && currentUserRole !== 'teacher')) { customAlert("لا تملك صلاحية لحفظ بيانات الفصول."); return; }

    const id = document.getElementById('class-id')?.value;
    const className = document.getElementById('class-name')?.value;
    const classSchedule = document.getElementById('class-schedule')?.value;
    const classFee = document.getElementById('class-fee')?.value;
    const classPhoto = document.getElementById('class-photo')?.value;

    const classData = {
        name: className,
        schedule: classSchedule,
        fee: parseFloat(classFee) || 0,
        photo: classPhoto,
    };

    try {
        if (id) {
            await setDoc(doc(db, `artifacts/${APP_ID}/users/${userId}/classes`, id), classData, { merge: true });
            createNotification(`تم تحديث الفصل ${classData.name}`, "success");
        } else {
            await addDoc(collection(db, `artifacts/${APP_ID}/users/${userId}/classes`), classData);
            createNotification(`تم إنشاء فصل جديد: ${classData.name}`, "success");
        }
        closeModal('class-modal');
    } catch (e) {
        console.error("Error saving class:", e);
        customAlert("فشل حفظ بيانات الفصل.");
    }
}

window.deleteClass = (id, name) => {
    if (!isAuthReady || (currentUserRole !== 'admin' && currentUserRole !== 'teacher')) { customAlert("لا تملك صلاحية لحذف الفصول."); return; }
    customConfirm(`هل أنت متأكد من حذف فصل ${name}؟ سيتم إزالة الطلاب منه.`, async () => {
        try {
            await deleteDoc(doc(db, `artifacts/${APP_ID}/users/${userId}/classes`, id));
            const studentsToUpdate = studentsCache.filter(s => s.classId === id);
            for (const student of studentsToUpdate) {
                await updateDoc(doc(db, `artifacts/${APP_ID}/users/${userId}/students`, student.id), { classId: '' });
            }
            createNotification(`تم حذف الفصل ${name}`, "warning");
        } catch (e) {
            console.error("Error deleting class:", e);
            customAlert("فشل حذف الفصل.");
        }
    });
}

window.handlePlanFormSubmit = async (e) => {
    e.preventDefault();
    if (!isAuthReady || (currentUserRole !== 'admin' && currentUserRole !== 'teacher')) { customAlert("لا تملك صلاحية لحفظ بيانات الخطط."); return; }

    const id = document.getElementById('plan-id')?.value;
    const planName = document.getElementById('plan-name')?.value;
    const planDescription = document.getElementById('plan-description')?.value;

    const planData = {
        name: planName,
        description: planDescription,
    };

    try {
        if (id) {
            await setDoc(doc(db, `artifacts/${APP_ID}/users/${userId}/plans`, id), planData, { merge: true });
            createNotification(`تم تحديث الخطة ${planData.name}`, "success");
        } else {
            await addDoc(collection(db, `artifacts/${APP_ID}/users/${userId}/plans`), planData);
            createNotification(`تم إنشاء خطة جديدة: ${planData.name}`, "success");
        }
        closeModal('plan-modal');
    } catch (e) {
        console.error("Error saving plan:", e);
        customAlert("فشل حفظ بيانات الخطة.");
    }
}

window.deletePlan = (id, name) => {
    if (!isAuthReady || (currentUserRole !== 'admin' && currentUserRole !== 'teacher')) { customAlert("لا تملك صلاحية لحذف الخطط."); return; }
    customConfirm(`هل أنت متأكد من حذف خطة ${name}؟`, async () => {
        try {
            await deleteDoc(doc(db, `artifacts/${APP_ID}/users/${userId}/plans`, id));
            const studentsToUpdate = studentsCache.filter(s => s.planId === id);
            for (const student of studentsToUpdate) {
                await updateDoc(doc(db, `artifacts/${APP_ID}/users/${userId}/students`, student.id), { planId: '' });
            }
            createNotification(`تم حذف الخطة ${name}`, "warning");
        } catch (e) {
            console.error("Error deleting plan:", e);
            customAlert("فشل حذف الخطة.");
        }
    });
}

window.saveTasmeeResults = async () => {
    if (!isAuthReady || (currentUserRole !== 'admin' && currentUserRole !== 'teacher')) { customAlert("لا تملك صلاحية لتسجيل التسميع."); return; }

    const studentId = document.getElementById('tasmee-student-select')?.value;
    const juz = parseInt(document.getElementById('tasmee-juz')?.value);
    const pageFrom = parseInt(document.getElementById('tasmee-page-from')?.value);
    const pageTo = parseInt(document.getElementById('tasmee-page-to')?.value) || pageFrom;

    if (!studentId || isNaN(juz) || isNaN(pageFrom)) { customAlert("الرجاء اختيار طالب وتحديد الجزء والصفحة."); return; }
    if (pageTo < pageFrom) { customAlert("صفحة النهاية يجب أن تكون بعد صفحة البداية."); return; }
    if (juz < 1 || juz > 30) { customAlert("رقم الجزء يجب أن يكون بين 1 و 30."); return; }
    if (pageFrom < 1 || pageFrom > 20 || pageTo < 1 || pageTo > 20) { customAlert("رقم الصفحة يجب أن يكون بين 1 و 20."); return; }


    try {
        const studentRef = doc(db, `artifacts/${APP_ID}/users/${userId}/students`, studentId);
        const studentDoc = await getDoc(studentRef);
        if (!studentDoc.exists()) { customAlert("لم يتم العثور على الطالب."); return; }

        const studentData = studentDoc.data();
        if (!studentData.progress) studentData.progress = {};
        if (!studentData.progress[juz]) studentData.progress[juz] = [];

        for (let i = pageFrom; i <= pageTo; i++) {
            if (!studentData.progress[juz].includes(i)) {
                studentData.progress[juz].push(i);
            }
        }
        studentData.progress[juz].sort((a, b) => a - b);

        await updateDoc(studentRef, { progress: studentData.progress });
        customAlert(`تم تسجيل التسميع بنجاح.`);
    } catch (e) {
        console.error("Error saving tasmee results:", e);
        customAlert("فشل حفظ التسميع.");
    }
}

window.saveAttendance = async () => {
    if (!isAuthReady || (currentUserRole !== 'admin' && currentUserRole !== 'teacher')) { customAlert("لا تملك صلاحية لحفظ الحضور."); return; }

    const dateInput = document.getElementById('attendance-date');
    const date = dateInput ? dateInput.value : '';
    if (!date) { customAlert("الرجاء تحديد التاريخ أولاً."); return; }

    const dailyRecord = {};
    document.querySelectorAll('input[type="radio"][name^="attendance-"]:checked').forEach(input => {
        dailyRecord[input.name.replace('attendance-', '')] = input.value;
    });

    try {
        await setDoc(doc(db, `artifacts/${APP_ID}/users/${userId}/attendance`, date), dailyRecord);
        customAlert("تم حفظ بيانات الحضور بنجاح.");
    } catch (e) {
        console.error("Error saving attendance:", e);
        customAlert("فشل حفظ الحضور.");
    }
}

window.saveExamResults = async () => {
    if (!isAuthReady || (currentUserRole !== 'admin' && currentUserRole !== 'teacher')) { customAlert("لا تملك صلاحية لحفظ نتائج الاختبارات."); return; }

    const studentId = document.getElementById('exam-student-select')?.value;
    const examName = document.getElementById('exam-name')?.value.trim();
    const examJuz = parseInt(document.getElementById('exam-juz')?.value);

    if (!studentId || !examName || isNaN(examJuz)) { customAlert("الرجاء ملء جميع الحقول."); return; }

    const scores = {};
    let totalScore = 0, maxScore = 0, isValid = true;
    document.querySelectorAll('.exam-score-field').forEach(field => {
        const fieldName = field.dataset.fieldName;
        const maxMark = parseInt(field.dataset.maxMark);
        const score = parseInt(field.value);
        if (isNaN(score) || score < 0 || score > maxMark) {
            customAlert(`الدرجة لحقل "${fieldName}" غير صالحة. يجب أن تكون بين 0 و ${maxMark}.`);
            isValid = false;
        }
        scores[fieldName] = score;
        totalScore += score;
        maxScore += maxMark;
    });
    if (!isValid) return;

    const examData = { id: generateId(), name: examName, juz: examJuz, scores, totalScore, maxScore, date: new Date().toISOString() };

    try {
        const studentExamDocRef = doc(db, `artifacts/${APP_ID}/users/${userId}/exams`, studentId);
        const studentExamDoc = await getDoc(studentExamDocRef);
        let studentExams = [];

        if (studentExamDoc.exists()) {
            studentExams = studentExamDoc.data().exams || [];
        }
        studentExams.push(examData);

        await setDoc(studentExamDocRef, { exams: studentExams });
        customAlert("تم حفظ نتيجة الاختبار بنجاح.");
    } catch (e) {
        console.error("Error saving exam results:", e);
        customAlert("فشل حفظ نتيجة الاختبار.");
    }
}

window.addExamField = async () => {
    if (!isAuthReady || currentUserRole !== 'admin') { customAlert("لا تملك صلاحية لإضافة حقول الاختبارات."); return; }

    const nameInput = document.getElementById('new-field-name');
    const markInput = document.getElementById('new-field-mark');

    const name = nameInput ? nameInput.value.trim() : '';
    const mark = parseInt(markInput ? markInput.value : '');

    if (!name || isNaN(mark) || mark <= 0) { customAlert("الرجاء إدخال اسم حقل صحيح ودرجة موجبة."); return; }

    if (!settingsCache.examFields) settingsCache.examFields = [];
    settingsCache.examFields.push({ name, mark });

    try {
        await setDoc(doc(db, `artifacts/${APP_ID}/users/${userId}/settings/appSettings`), settingsCache, { merge: true });
        renderExamFieldSettings(); // Call global function
        renderExamFieldsForEntry(); // Call global function
    } catch (e) {
        console.error("Error adding exam field:", e);
        customAlert("فشل إضافة حقل الاختبار.");
    }
}

window.removeExamField = async (index) => {
    if (!isAuthReady || currentUserRole !== 'admin') { customAlert("لا تملك صلاحية لحذف حقول الاختبارات."); return; }

    settingsCache.examFields.splice(index, 1);

    try {
        await setDoc(doc(db, `artifacts/${APP_ID}/users/${userId}/settings/appSettings`), settingsCache, { merge: true });
        renderExamFieldSettings(); // Call global function
        renderExamFieldsForEntry(); // Call global function
    } catch (e) {
        console.error("Error removing exam field:", e);
        customAlert("فشل حذف حقل الاختبار.");
    }
}

window.saveFinancials = async () => {
    if (!isAuthReady || currentUserRole !== 'admin') { customAlert("لا تملك صلاحية لحفظ التغييرات المالية."); return; }

    const monthInput = document.getElementById('financial-month');
    const month = monthInput ? monthInput.value : '';
    if (!month) { customAlert("الرجاء تحديد الشهر أولاً."); return; }

    const monthData = {};
    document.querySelectorAll('.financial-status-select').forEach(select => {
        monthData[select.dataset.studentId] = select.value;
    });

    try {
        await setDoc(doc(db, `artifacts/${APP_ID}/users/${userId}/financials`, month), monthData);
        createNotification(`تم حفظ الحالة المالية لشهر ${month}.`, "success");
    } catch (e) {
        console.error("Error saving financials:", e);
        customAlert("فشل حفظ التغييرات المالية.");
    }
}

window.togglePageMemorization = async (studentId, juz, page) => {
    if (!isAuthReady || (currentUserRole !== 'admin' && currentUserRole !== 'teacher')) { customAlert("لا تملك صلاحية لتحديث حالة الحفظ."); return; }

    try {
        const studentRef = doc(db, `artifacts/${APP_ID}/users/${userId}/students`, studentId);
        const studentDoc = await getDoc(studentRef);
        if (!studentDoc.exists()) { customAlert("لم يتم العثور على الطالب."); return; }

        const studentData = studentDoc.data();
        if (!studentData.progress) studentData.progress = {};
        if (!studentData.progress[juz]) studentData.progress[juz] = [];

        const pageIndex = studentData.progress[juz].indexOf(page);
        if (pageIndex > -1) {
            studentData.progress[juz].splice(pageIndex, 1);
        } else {
            studentData.progress[juz].push(page);
        }
        studentData.progress[juz].sort((a, b) => a - b);

        await updateDoc(studentRef, { progress: studentData.progress });
        createNotification("تم تحديث حالة الحفظ.", "info");
    } catch (e) {
        console.error("Error toggling page memorization:", e);
        customAlert("فشل تحديث حالة الحفظ.");
    }
};

window.updateStudentNote = async (studentId, newNote) => {
    if (!isAuthReady || (currentUserRole !== 'admin' && currentUserRole !== 'teacher')) { customAlert("لا تملك صلاحية لتحديث ملاحظات الطلاب."); return; }

    try {
        const studentRef = doc(db, `artifacts/${APP_ID}/users/${userId}/students`, studentId);
        await updateDoc(studentRef, { notes: newNote });
        createNotification("تم حفظ الملاحظة.", "info");
    } catch (e) {
        console.error("Error updating student note:", e);
        customAlert("فشل حفظ الملاحظة.");
    }
}

window.handleBulkAssignClass = async () => {
    if (!isAuthReady || (currentUserRole !== 'admin' && currentUserRole !== 'teacher')) { customAlert("لا تملك صلاحية لتعيين الفصول بالجملة."); return; }

    const selectedStudentIds = Array.from(document.querySelectorAll('.student-checkbox:checked')).map(cb => cb.dataset.studentId);
    const classSelect = document.getElementById('bulk-assign-class-select');
    const classId = classSelect ? classSelect.value : '';

    if (selectedStudentIds.length === 0 || !classId) { customAlert("الرجاء تحديد الطلاب والفصل."); return; }

    try {
        for (const studentId of selectedStudentIds) {
            const studentRef = doc(db, `artifacts/${APP_ID}/users/${userId}/students`, studentId);
            await updateDoc(studentRef, { classId: classId });
        }
        createNotification(`تم تعيين ${selectedStudentIds.length} طالب للفصل.`, "success");
        closeModal('assign-class-bulk-modal');
    } catch (e) {
        console.error("Error bulk assigning class:", e);
        customAlert("فشل تعيين الفصل للطلاب المحددين.");
    }
}

// --- DATA IMPORT/EXPORT ---
window.exportData = async () => {
    if (!isAuthReady || currentUserRole !== 'admin') { customAlert("لا تملك صلاحية لتصدير البيانات."); return; }

    const data = {
        students: studentsCache,
        classes: classesCache,
        settings: settingsCache,
        attendance: attendanceCache,
        plans: plansCache,
        notifications: notificationsCache,
        exams: examsCache,
        financials: financialsCache,
        currentUserRole: currentUserRole // Include role in export for context
    };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
    const dl = document.createElement('a');
    dl.setAttribute("href", dataStr);
    dl.setAttribute("download", `backup-quran-app-${new Date().toISOString().slice(0,10)}-${userId}.json`);
    document.body.appendChild(dl);
    dl.click();
    dl.remove();
    customAlert("تم بدء تصدير البيانات المحلية. (لاحظ: هذا لا يشمل بيانات Firestore مباشرة).", "success");
};

window.importData = (event) => {
    if (!isAuthReady || currentUserRole !== 'admin') { customAlert("لا تملك صلاحية لاستيراد البيانات."); return; }

    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const importedData = JSON.parse(e.target.result);
            customConfirm("سيؤدي هذا إلى الكتابة فوق جميع بياناتك الحالية في Firestore. هل أنت متأكد؟", async () => {
                try {
                    // Delete existing documents in each collection
                    const collectionsToDelete = ['students', 'classes', 'attendance', 'plans', 'notifications', 'exams', 'financials'];
                    for (const colName of collectionsToDelete) {
                        const q = query(collection(db, `artifacts/${APP_ID}/users/${userId}/${colName}`));
                        const snapshot = await getDocs(q);
                        for (const docSnapshot of snapshot.docs) {
                            await deleteDoc(doc(db, `artifacts/${APP_ID}/users/${userId}/${colName}`, docSnapshot.id));
                        }
                    }
                    // Delete settings document and profile document
                    await deleteDoc(doc(db, `artifacts/${APP_ID}/users/${userId}/settings/appSettings`));
                    await deleteDoc(doc(db, `artifacts/${APP_ID}/users/${userId}/profile/data`));


                    // Re-populate with imported data
                    if (importedData.students) {
                        for (const student of importedData.students) {
                            await setDoc(doc(db, `artifacts/${APP_ID}/users/${userId}/students`, student.id), student);
                        }
                    }
                    if (importedData.classes) {
                        for (const cls of importedData.classes) {
                            await setDoc(doc(db, `artifacts/${APP_ID}/users/${userId}/classes`, cls.id), cls);
                        }
                    }
                    if (importedData.settings) {
                        await setDoc(doc(db, `artifacts/${APP_ID}/users/${userId}/settings/appSettings`), importedData.settings);
                    }
                    if (importedData.attendance) {
                        for (const date in importedData.attendance) {
                            await setDoc(doc(db, `artifacts/${APP_ID}/users/${userId}/attendance`, date), importedData.attendance[date]);
                        }
                    }
                    if (importedData.plans) {
                        for (const plan of importedData.plans) {
                            await setDoc(doc(db, `artifacts/${APP_ID}/users/${userId}/plans`, plan.id), plan);
                        }
                    }
                    if (importedData.notifications) {
                        for (const notification of importedData.notifications) {
                            await setDoc(doc(db, `artifacts/${APP_ID}/users/${userId}/notifications`, notification.id), notification);
                        }
                    }
                    if (importedData.exams) {
                        for (const studentId in importedData.exams) {
                            await setDoc(doc(db, `artifacts/${APP_ID}/users/${userId}/exams`, studentId), { exams: importedData.exams[studentId] });
                        }
                    }
                    if (importedData.financials) {
                        for (const month in importedData.financials) {
                            await setDoc(doc(db, `artifacts/${APP_ID}/users/${userId}/financials`, month), importedData.financials[month]);
                        }
                    }
                    // Set the imported role
                    if (importedData.currentUserRole) {
                        await setDoc(doc(db, `artifacts/${APP_ID}/users/${userId}/profile/data`), { role: importedData.currentUserRole }, { merge: true });
                    }


                    customAlert("تم استيراد البيانات بنجاح. سيتم تحديث التطبيق.", "success");
                    // Data will refresh automatically due to onSnapshot listeners
                } catch (err) {
                    console.error("Error importing data to Firestore:", err);
                    customAlert("فشل استيراد البيانات إلى Firestore.", "error");
                }
            });
        } catch (err) {
            customAlert("ملف JSON غير صالح.", "error");
            console.error("Invalid JSON file:", err);
        }
    };
    reader.readAsText(file);
};


window.resetAllData = () => {
    if (!isAuthReady || currentUserRole !== 'admin') { customAlert("لا تملك صلاحية لمسح جميع البيانات."); return; }
    customConfirm("تحذير! سيتم حذف جميع البيانات بشكل دائم من Firestore لهذا المستخدم. هل أنت متأكد تماماً؟", async () => {
        try {
            const collectionsToClear = ['students', 'classes', 'attendance', 'plans', 'notifications', 'exams', 'financials'];
            for (const colName of collectionsToClear) {
                const q = query(collection(db, `artifacts/${APP_ID}/users/${userId}/${colName}`));
                const snapshot = await getDocs(q);
                for (const docSnapshot of snapshot.docs) {
                    await deleteDoc(doc(db, `artifacts/${APP_ID}/users/${userId}/${colName}`, docSnapshot.id));
                }
            }
            // Also delete the settings document and profile document
            await deleteDoc(doc(db, `artifacts/${APP_ID}/users/${userId}/settings/appSettings`));
            await deleteDoc(doc(db, `artifacts/${APP_ID}/users/${userId}/profile/data`));


            customAlert("تم مسح جميع البيانات من Firestore. سيتم إعادة تحميل التطبيق.", "warning");
            setTimeout(() => location.reload(), 2000);
        } catch (e) {
            console.error("Error resetting all data:", e);
            customAlert("فشل مسح جميع البيانات.");
        }
    });
};

// --- HELPERS ---
window.createNotification = async (message, type = 'info') => {
    if (!isAuthReady) {
        console.warn("Auth not ready, notification not saved to Firestore:", message);
        return;
    }
    try {
        const newNotification = { message, type, date: new Date().toISOString(), read: false };
        await addDoc(collection(db, `artifacts/${APP_ID}/users/${userId}/notifications`), newNotification);
    } catch (e) {
        console.error("Error creating notification:", e);
    }
};

window.openNotificationModal = async (id) => {
    if (!isAuthReady) { customAlert("الرجاء الانتظار حتى يتم تهيئة التطبيق."); return; }
    try {
        const notificationRef = doc(db, `artifacts/${APP_ID}/users/${userId}/notifications`, id);
        const notificationDoc = await getDoc(notificationRef);
        if (!notificationDoc.exists()) { customAlert("لم يتم العثور على الإشعار."); return; }

        const notificationData = notificationDoc.data();
        if (!notificationData.read) {
            await updateDoc(notificationRef, { read: true });
        }
        
        const notificationModalMessage = document.getElementById('notification-modal-message');
        const notificationModalDate = document.getElementById('notification-modal-date');

        if (notificationModalMessage) notificationModalMessage.textContent = notificationData.message;
        if (notificationModalDate) notificationModalDate.textContent = new Date(notificationData.date).toLocaleString();
        openModal('notification-details-modal');
    } catch (e) {
        console.error("Error opening notification modal:", e);
        customAlert("فشل عرض تفاصيل الإشعار.");
    }
};

window.markAllNotificationsAsRead = async () => {
    if (!isAuthReady) { customAlert("الرجاء الانتظار حتى يتم تهيئة التطبيق."); return; }
    try {
        const q = query(collection(db, `artifacts/${APP_ID}/users/${userId}/notifications`), where("read", "==", false));
        const querySnapshot = await getDocs(q);
        const batch = writeBatch(db);
        querySnapshot.forEach((docSnapshot) => {
            batch.update(doc(db, `artifacts/${APP_ID}/users/${userId}/notifications`, docSnapshot.id), { read: true });
        });
        await batch.commit();
        createNotification("تم تعليم جميع الإشعارات كمقروءة.", "info");
    } catch (e) {
        console.error("Error marking all notifications as read:", e);
        customAlert("فشل تعليم الإشعارات كمقروءة.");
    }
}

window.updateCurrency = async () => {
    if (!isAuthReady || currentUserRole !== 'admin') { customAlert("لا تملك صلاحية لتحديث إعداد العملة."); return; }
    settingsCache.currency = document.getElementById('currency-select')?.value;
    try {
        await setDoc(doc(db, `artifacts/${APP_ID}/users/${userId}/settings/appSettings`), settingsCache, { merge: true });
    } catch (e) {
        console.error("Error updating currency setting:", e);
        customAlert("فشل تحديث إعداد العملة.");
    }
}

window.populateCountryCodes = async () => {
    const select = document.getElementById('student-country-code');
    if (!select) return; // Ensure the select element exists
    try {
        const response = await fetch('https://gist.githubusercontent.com/anubhavsrivastava/751b7729f6261c1a2f24/raw/70414437433989c9ba7743088665801962376841/CountryCodes.json');
        const countries = await response.json();
        countries.sort((a,b) => a.name.localeCompare(b.name));
        select.innerHTML = countries.map(c => `<option value="${c.dial_code}">${c.name} (${c.dial_code})</option>`).join('');
        select.value = "+249"; // Default to Sudan
    } catch (e) {
        console.error("Could not load country codes, using a fallback list.", e);
        const codes = { "+249": "🇸🇩 Sudan", "+966": "🇸🇦 Saudi Arabia", "+20": "🇪🇬 Egypt", "+971": "🇦🇪 UAE", "+974": "🇶🇦 Qatar", "+965": "🇰🇼 Kuwait", "+973": "🇧🇭 Bahrain", "+968": "🇴🇲 Oman" };
        select.innerHTML = Object.entries(codes).map(([code, name]) => `<option value="${code}">${name}</option>`).join('');
        select.value = "+249";
    }
}

window.populateAllClassDropdowns = () => {
    const filterClass = document.getElementById('filter-class');
    if (filterClass) populateClassDropdown(filterClass, 'كل الفصول');
    
    const studentClassSelect = document.getElementById('student-class-select');
    if (studentClassSelect) populateClassDropdown(studentClassSelect);
    
    const tasmeeClassSelect = document.getElementById('tasmee-class-select');
    if (tasmeeClassSelect) populateClassDropdown(tasmeeClassSelect);
    
    const attendanceClassSelect = document.getElementById('attendance-class-select');
    if (attendanceClassSelect) populateClassDropdown(attendanceClassSelect);
    
    const examClassSelect = document.getElementById('exam-class-select');
    if (examClassSelect) populateClassDropdown(examClassSelect);
    
    const bulkAssignClassSelect = document.getElementById('bulk-assign-class-select');
    if (bulkAssignClassSelect) populateClassDropdown(bulkAssignClassSelect);
};

window.populateClassDropdown = (select, defaultOption = "اختر فصلاً") => {
    if (!select) return; // Ensure select element exists
    const val = select.value;
    select.innerHTML = `<option value="">${defaultOption}</option>`;
    classesCache.forEach(c => select.innerHTML += `<option value="${c.id}">${c.name}</option>`);
    select.value = val;
};

window.populateAllPlanDropdowns = () => {
    const studentPlanSelect = document.getElementById('student-plan-select');
    if (studentPlanSelect) populatePlanDropdown(studentPlanSelect);
};

window.populatePlanDropdown = (select, defaultOption = "بدون خطة") => {
    if (!select) return; // Ensure select element exists
    const val = select.value;
    select.innerHTML = `<option value="">${defaultOption}</option>`;
    plansCache.forEach(p => select.innerHTML += `<option value="${p.id}">${p.name}</option>`);
    select.value = val;
};

window.loadStudentsFor = (selectId, classId) => {
    const studentSelect = document.getElementById(selectId);
    if (!studentSelect) return; // Ensure select element exists
    studentSelect.innerHTML = '<option value="">اختر طالباً</option>';
    if (!classId) return;
    studentsCache.filter(s => s.classId === classId).forEach(s => studentSelect.innerHTML += `<option value="${s.id}">${s.name}</option>`);
};

window.openStudentModal = (id = null) => {
    if (currentUserRole !== 'admin' && currentUserRole !== 'teacher') { customAlert("لا تملك صلاحية لإدارة الطلاب."); return; }
    const form = document.getElementById('student-form');
    if (!form) { console.error("Student form not found."); return; }
    form.reset();
    populateAllClassDropdowns(); // Call global function
    populateAllPlanDropdowns(); // Call global function
    
    const studentModalTitle = document.getElementById('student-modal-title');
    if (studentModalTitle) studentModalTitle.textContent = id ? 'تعديل بيانات الطالب' : 'إضافة طالب جديد';

    if (id) {
        const s = studentsCache.find(st => st.id === id);
        if (s) {
            const studentId = document.getElementById('student-id');
            const studentName = document.getElementById('student-name');
            const studentAge = document.getElementById('student-age');
            const studentGuardian = document.getElementById('student-guardian');
            const studentStartDate = document.getElementById('student-start-date');
            const studentPhone = document.getElementById('student-phone');
            const studentCountryCode = document.getElementById('student-country-code');
            const studentClassSelect = document.getElementById('student-class-select');
            const studentPlanSelect = document.getElementById('student-plan-select');
            const studentJuzStart = document.getElementById('student-juz-start');
            const studentNotesModal = document.getElementById('student-notes-modal');

            if (studentId) studentId.value = s.id;
            if (studentName) studentName.value = s.name;
            if (studentAge) studentAge.value = s.age;
            if (studentGuardian) studentGuardian.value = s.guardianName;
            if (studentStartDate) studentStartDate.value = s.startDate;
            if (studentPhone) studentPhone.value = s.phone;
            if (studentCountryCode) studentCountryCode.value = s.countryCode;
            if (studentClassSelect) studentClassSelect.value = s.classId;
            if (studentPlanSelect) studentPlanSelect.value = s.planId;
            if (studentJuzStart) studentJuzStart.value = s.juzStart;
            if (studentNotesModal) studentNotesModal.value = s.notes;
        }
    } else {
         const studentId = document.getElementById('student-id');
         if (studentId) studentId.value = '';
    }
    openModal('student-modal'); // Call global function
};

window.openClassModal = (id = null) => {
    if (currentUserRole !== 'admin' && currentUserRole !== 'teacher') { customAlert("لا تملك صلاحية لإدارة الفصول."); return; }
    const form = document.getElementById('class-form');
    if (!form) { console.error("Class form not found."); return; }
    form.reset();
    
    const classModalTitle = document.getElementById('class-modal-title');
    if (classModalTitle) classModalTitle.textContent = id ? 'تعديل بيانات الفصل' : 'إنشاء فصل جديد';

    if (id) {
        const c = classesCache.find(cls => cls.id === id);
        if (c) {
            const classId = document.getElementById('class-id');
            const className = document.getElementById('class-name');
            const classSchedule = document.getElementById('class-schedule');
            const classFee = document.getElementById('class-fee');
            const classPhoto = document.getElementById('class-photo');

            if (classId) classId.value = c.id;
            if (className) className.value = c.name;
            if (classSchedule) classSchedule.value = c.schedule;
            if (classFee) classFee.value = c.fee;
            if (classPhoto) classPhoto.value = c.photo;
        }
    } else {
        const classId = document.getElementById('class-id');
        if (classId) classId.value = '';
    }
    openModal('class-modal'); // Call global function
};

window.openPlanModal = (id = null) => {
    if (currentUserRole !== 'admin' && currentUserRole !== 'teacher') { customAlert("لا تملك صلاحية لإدارة الخطط."); return; }
    const form = document.getElementById('plan-form');
    if (!form) { console.error("Plan form not found."); return; }
    form.reset();
    
    const planModalTitle = document.getElementById('plan-modal-title');
    if (planModalTitle) planModalTitle.textContent = id ? 'تعديل الخطة' : 'إنشاء خطة جديدة';

    if (id) {
        const p = plansCache.find(plan => plan.id === id);
        if (p) {
            const planId = document.getElementById('plan-id');
            const planName = document.getElementById('plan-name');
            const planDescription = document.getElementById('plan-description');

            if (planId) planId.value = p.id;
            if (planName) planName.value = p.name;
            if (planDescription) planDescription.value = p.description;
        }
    } else {
        const planId = document.getElementById('plan-id');
        if (planId) planId.value = '';
    }
    openModal('plan-modal'); // Call global function
};

window.openAssignClassBulkModal = () => {
    if (currentUserRole !== 'admin' && currentUserRole !== 'teacher') { customAlert("لا تملك صلاحية لتعيين الفصول بالجملة."); return; }
    const selected = document.querySelectorAll('.student-checkbox:checked').length;
    if (selected === 0) { customAlert("الرجاء تحديد طالب واحد على الأقل."); return; }
    openModal('assign-class-bulk-modal'); // Call global function
};

window.toggleAllStudentCheckboxes = (checked) => {
    document.querySelectorAll('.student-checkbox').forEach(cb => cb.checked = checked);
};

window.generateMonthlyReport = () => {
    if (currentUserRole !== 'admin' && currentUserRole !== 'teacher') { customAlert("لا تملك صلاحية لإنشاء التقارير."); return; }
    const attendanceClassSelect = document.getElementById('attendance-class-select');
    const classId = attendanceClassSelect ? attendanceClassSelect.value : '';
    if (!classId) { customAlert("الرجاء اختيار فصل أولاً."); return; }
    
    const attendanceDate = document.getElementById('attendance-date');
    const date = new Date(attendanceDate ? attendanceDate.value : new Date());
    
    const cls = classesCache.find(c => c.id === classId);
    if (!cls) { customAlert("الفصل المحدد غير موجود."); return; } // Added check for class existence

    const studentsInClass = studentsCache.filter(s => s.classId === classId);
    const year = date.getFullYear(), month = date.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    let reportHTML = `<div id="report-content" style="font-family: Cairo, sans-serif; direction: rtl; padding: 20px;"><h2 style="text-align: center;">تقرير الحضور الشهري - ${cls.name}</h2><h3 style="text-align: center;">شهر: ${date.toLocaleString('ar-EG', { month: 'long', year: 'numeric' })}</h3><table style="width: 100%; border-collapse: collapse; font-size: 12px;"><thead><tr style="background-color: #e2e8f0;"><th style="border: 1px solid #ccc; padding: 8px;">الطالب</th>`;
    for(let i = 1; i <= daysInMonth; i++) { reportHTML += `<th style="border: 1px solid #ccc; padding: 4px;">${i}</th>`; }
    reportHTML += `<th style="border: 1px solid #ccc; padding: 8px; background-color: #d1fae5;">حضور</th><th style="border: 1px solid #ccc; padding: 8px; background-color: #fee2e2;">غياب</th></tr></thead><tbody>`;
    studentsInClass.forEach(student => {
        let presentCount = 0, absentCount = 0;
        reportHTML += `<tr><td style="border: 1px solid #ccc; padding: 8px;">${student.name}</td>`;
        for(let i = 1; i <= daysInMonth; i++) {
            const d = new Date(year, month, i + 1).toISOString().split('T')[0];
            const status = (attendanceCache[d] || {})[student.id] || '';
            let symbol = '-';
            if (status === 'present') { symbol = '✔'; presentCount++; }
            else if (status === 'absent') { symbol = '✖'; absentCount++; }
            reportHTML += `<td style="border: 1px solid #ccc; padding: 4px; text-align: center;">${symbol}</td>`;
        }
         reportHTML += `<td style="border: 1px solid #ccc; padding: 8px; text-align: center; background-color: #f0fdf4;">${presentCount}</td><td style="border: 1px solid #ccc; padding: 8px; text-align: center; background-color: #fef2f2;">${absentCount}</td></tr>`;
    });
    reportHTML += `</tbody></table></div>`;
    const reportView = document.getElementById('monthly-report-view');
    if (reportView) {
        reportView.innerHTML = reportHTML;
        reportView.classList.remove('hidden');
        html2pdf(document.getElementById('report-content'), { margin: 1, filename: `report-${cls.name}-${month+1}-${year}.pdf`, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: 'in', format: 'a3', orientation: 'landscape' } });
    }
};
