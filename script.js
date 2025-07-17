// --- SUPABASE CLIENT INITIALIZATION ---
// Replace with your actual Supabase URL and Anon Key
const SUPABASE_URL = 'https://focdnkgnywtlffbnftpb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvY2Rua2dueXd0bGZmYm5mdHBiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI1NDgwNjIsImV4cCI6MjA2ODEyNDA2Mn0.aoCFPui67h3HTedt2aNIP-2kKWNLpOZT5XqKsJ_myiE';
const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- GLOBAL STATE & DEFAULTS ---
// Supabase/Auth related globals
let currentUser = null;
let currentUserRole = 'anonymous'; // 'admin', 'teacher', 'parent', 'anonymous'
let isAuthReady = false;
let authMode = 'login'; // 'login' or 'signup'

// Application data caches
let studentsCache = [];
let classesCache = [];
let settingsCache = {};
let attendanceCache = {}; // Key: "YYYY-MM-DD", Value: { student_id: "status" }
let plansCache = [];
let notificationsCache = [];
let examsCache = {}; // Key: student_id, Value: [examObject1, examObject2]
let financialsCache = {}; // Key: "YYYY-MM", Value: { student_id: "status" }
let expensesCache = [];
let teachersCache = [ // Dummy data, can be moved to a 'teachers' table later
    { id: 'teacher1', name: 'أحمد محمود' },
    { id: 'teacher2', name: 'فاطمة علي' },
];


// Default settings
const defaultSettings = {
    theme: 'light',
    themeColor: '#0d9488',
    currency: 'SDG',
    examFields: [
        { name: "جودة الحفظ", mark: 50 },
        { name: "أحكام التجويد", mark: 30 },
        { name: "جمال الصوت", mark: 20 }
    ]
};

// Chart instances
let weeklyProgressChart, classDistributionChart, incomeOverTimeChart, monthlyAttendanceChart;

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    initializeAppState();
    setupEventListeners();
});

async function initializeAppState() {
    const loadingSpinner = document.getElementById('loading-spinner');
    loadingSpinner.classList.remove('hidden');

    try {
        // Listen to auth state changes
        supabaseClient.auth.onAuthStateChange(async (event, session) => {
            if (event === 'SIGNED_IN' && session) {
                await handleAuthenticatedUser(session.user);
            } else if (event === 'SIGNED_OUT') {
                isAuthReady = false;
                currentUser = null;
                currentUserRole = 'anonymous';
                // Clear all caches
                [studentsCache, classesCache, plansCache, notificationsCache, expensesCache] = [[], [], [], [], []];
                [settingsCache, attendanceCache, examsCache, financialsCache] = [{}, {}, {}, {}];
                showAuthScreen();
            }
        });

        // Check for initial session
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        if (error) {
            console.error("Error getting session:", error);
            showAuthScreen();
            return;
        }
        
        if (session && session.user) {
            await handleAuthenticatedUser(session.user);
        } else {
            showAuthScreen();
        }

    } catch (e) {
        console.error("Critical initialization error:", e);
        customAlert("فشل حرج في تهيئة التطبيق. يرجى التحقق من اتصالك بالإنترنت.");
        showAuthScreen();
    }
}

async function handleAuthenticatedUser(user) {
    currentUser = user;
    
    // Fetch user role from 'profiles' table
    const { data, error } = await supabaseClient.from('profiles').select('role').eq('id', user.id).single();

    if (error && error.code !== 'PGRST116') { // PGRST116 means no rows found, which is fine
        console.error("Error fetching user profile:", error);
    }
    currentUserRole = data?.role || 'teacher'; // Default to 'teacher' if no profile found
    
    isAuthReady = true;
    console.log("Authenticated with UID:", currentUser.id, "Role:", currentUserRole);
    
    document.getElementById('user-id-display').textContent = `معرف المستخدم: ${currentUser.email} (الدور: ${currentUserRole})`;
    
    await loadAllData();
    showMainApp();
}

function showAuthScreen() {
    document.getElementById('loading-spinner').classList.add('hidden');
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('app-container').classList.add('hidden');
}

function showMainApp() {
    document.getElementById('loading-spinner').classList.add('hidden');
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app-container').classList.remove('hidden');
    
    // Set default dates and values on UI elements
    const financialMonthInput = document.getElementById('financial-month');
    const attendanceDateInput = document.getElementById('attendance-date');
    const currencySelect = document.getElementById('currency-select');
    const today = new Date();

    if (financialMonthInput) financialMonthInput.value = today.toISOString().slice(0, 7);
    if (attendanceDateInput) attendanceDateInput.value = today.toISOString().slice(0, 10);
    if (currencySelect) currencySelect.value = settingsCache.currency || 'SDG'; 
    
    showView('dashboard-view');
    createNotification("تم تحميل التطبيق بنجاح.", "system");
}

async function loadAllData() {
    if (!isAuthReady) return;
    console.log("Loading all data from Supabase...");
    const loadingSpinner = document.getElementById('loading-spinner');
    loadingSpinner.classList.remove('hidden');

    try {
        const [
            studentsRes, classesRes, plansRes, attendanceRes, examsRes,
            financialsRes, expensesRes, notificationsRes, settingsRes
        ] = await Promise.all([
            supabaseClient.from('students').select('*'),
            supabaseClient.from('classes').select('*'),
            supabaseClient.from('plans').select('*'),
            supabaseClient.from('attendance').select('*'),
            supabaseClient.from('exams').select('*'),
            supabaseClient.from('financials').select('*'),
            supabaseClient.from('expenses').select('*'),
            supabaseClient.from('notifications').select('*').order('created_at', { ascending: false }).limit(50),
            supabaseClient.from('settings').select('settings_data').eq('user_id', currentUser.id).single()
        ]);

        // Populate caches, checking for errors
        studentsCache = studentsRes.data || [];
        classesCache = classesRes.data || [];
        plansCache = plansRes.data || [];
        expensesCache = expensesRes.data || [];
        notificationsCache = notificationsRes.data || [];
        settingsCache = { ...defaultSettings, ...(settingsRes.data?.settings_data || {}) };

        // Reduce array data into keyed objects for efficient lookup
        attendanceCache = (attendanceRes.data || []).reduce((acc, record) => {
            if (!acc[record.date]) acc[record.date] = {};
            acc[record.date][record.student_id] = record.status;
            return acc;
        }, {});
        
        examsCache = (examsRes.data || []).reduce((acc, record) => {
            if (!acc[record.student_id]) acc[record.student_id] = [];
            acc[record.student_id].push(record.exam_data);
            return acc;
        }, {});

        financialsCache = (financialsRes.data || []).reduce((acc, record) => {
            if (!acc[record.month_year]) acc[record.month_year] = {};
            acc[record.month_year][record.student_id] = record.status;
            return acc;
        }, {});

        applySettings();
        renderAll();
        console.log("All data loaded successfully.");

    } catch (err) {
        console.error("Error loading data from Supabase:", err);
        customAlert("حدث خطأ أثناء تحميل البيانات. يرجى إعادة تحميل الصفحة.");
    } finally {
        loadingSpinner.classList.add('hidden');
    }
}

function renderAll() {
    if (!isAuthReady) return;
    renderStudentsTable();
    renderClassesGrid();
    renderPlans();
    renderNotifications();
    renderExamFieldSettings();
    renderExamFieldsForEntry();
    renderFinancialsTable();
    renderExpensesList();
    updateDashboard();
    renderFinancialsDashboard();
    populateAllClassDropdowns();
    populateAllPlanDropdowns();
    populateTeacherDropdowns();
    applyRoleBasedUI();
    populateParentPortalStudentDropdown();
}


// --- UI & NAVIGATION ---
window.showView = (viewId) => {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    const viewToShow = document.getElementById(viewId);
    if (viewToShow) viewToShow.classList.remove('hidden');
    
    const sidebar = document.getElementById('sidebar');
    if (window.innerWidth < 1024) {
        sidebar.classList.remove('sidebar-mobile-open');
    }

    // Refresh data when switching to a view that needs it
    if (viewId === 'dashboard-view') updateDashboard();
    if (viewId === 'financials-dashboard-view') renderFinancialsDashboard();
    if (viewId === 'student-profile-view') { /* Data is loaded when profile is opened */ }
};

function setupEventListeners() {
    console.log("Setting up event listeners...");
    // Sidebar toggle
    document.getElementById('sidebar-toggle').addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('sidebar-mobile-open');
    });

    // Main search and filters
    document.getElementById('student-search').addEventListener('input', renderStudentsTable);
    document.getElementById('filter-class').addEventListener('change', renderStudentsTable);
    
    // Modal confirmation buttons
    document.getElementById('confirm-cancel-btn').addEventListener('click', () => closeModal('confirm-modal'));
    document.getElementById('confirm-ok-btn').addEventListener('click', () => {
        if (window.confirmCallback) window.confirmCallback();
        closeModal('confirm-modal');
        window.confirmCallback = null;
    });

    // Theme controls
    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
    const themeColorPicker = document.getElementById('theme-color-picker');
    themeColorPicker.addEventListener('input', (e) => applySettings(e.target.value));
    themeColorPicker.addEventListener('change', async (e) => {
        settingsCache.themeColor = e.target.value;
        await saveSettings();
        createNotification("تم حفظ لون الواجهة الجديد.", "success");
    });

    // Notifications panel
    document.getElementById('notification-bell').addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('notifications-panel').classList.toggle('hidden');
    });
    document.body.addEventListener('click', () => document.getElementById('notifications-panel').classList.add('hidden'));

    // Auth form
    document.getElementById('auth-form').addEventListener('submit', handleAuthFormSubmit);
    document.getElementById('toggle-auth-mode').addEventListener('click', toggleAuthMode);
    
    // Country codes for student form
    populateCountryCodes();
    
    // Add other event listeners for forms and buttons as needed
    document.getElementById('student-form').addEventListener('submit', handleStudentFormSubmit);
    document.getElementById('class-form').addEventListener('submit', handleClassFormSubmit);
    document.getElementById('plan-form').addEventListener('submit', handlePlanFormSubmit);
    document.getElementById('expense-form').addEventListener('submit', addExpense);
    
    // Link class dropdowns to update student lists
    document.getElementById('tasmee-class-select').addEventListener('change', (e) => loadStudentsFor('tasmee-student-select', e.target.value));
    document.getElementById('exam-class-select').addEventListener('change', (e) => loadStudentsFor('exam-student-select', e.target.value));
    document.getElementById('attendance-class-select').addEventListener('change', renderAttendanceTable);
    document.getElementById('attendance-date').addEventListener('change', renderAttendanceTable);
    document.getElementById('financial-month').addEventListener('change', renderFinancialsTable);
    document.getElementById('parent-portal-student-select').addEventListener('change', (e) => renderParentStudentProfile(e.target.value));
}

// --- SETTINGS & THEME ---
window.applySettings = (newColor = null) => {
    const color = newColor || settingsCache.themeColor || defaultSettings.themeColor;
    document.body.classList.toggle('dark', settingsCache.theme === 'dark');
    document.documentElement.style.setProperty('--theme-color', color);
    
    // Check for Chart.helpers existence before using it
    if (window.Chart && Chart.helpers && Chart.helpers.color) {
        const darkColor = Chart.helpers.color(color).darken(0.2).hexString();
        document.documentElement.style.setProperty('--theme-color-dark', darkColor);
    }

    if (!newColor) document.getElementById('theme-color-picker').value = color;

    // Re-render charts to apply new colors
    if (isAuthReady) {
        updateDashboard();
        renderFinancialsDashboard();
    }
};

async function saveSettings() {
    if (currentUserRole === 'anonymous') return;
    const { error } = await supabaseClient
        .from('settings')
        .upsert({ user_id: currentUser.id, settings_data: settingsCache }, { onConflict: 'user_id' });
    if (error) {
        console.error("Error saving settings:", error);
        customAlert("فشل حفظ الإعدادات.");
    }
}

window.toggleTheme = async () => {
    settingsCache.theme = document.body.classList.contains('dark') ? 'light' : 'dark';
    applySettings();
    await saveSettings();
};

// --- AUTHENTICATION ---
async function handleAuthFormSubmit(e) {
    e.preventDefault();
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const authMessage = document.getElementById('auth-message');
    authMessage.classList.add('hidden');

    let response;
    if (authMode === 'login') {
        response = await supabaseClient.auth.signInWithPassword({ email, password });
    } else {
        response = await supabaseClient.auth.signUp({ email, password });
        if (!response.error && response.data.user) {
            // Create a default profile for the new user
            await supabaseClient.from('profiles').insert({ id: response.data.user.id, role: 'teacher', email: response.data.user.email });
        }
    }

    if (response.error) {
        authMessage.textContent = response.error.message;
        authMessage.classList.remove('hidden');
        console.error(`Authentication Error (${authMode}):`, response.error);
    }
    // onAuthStateChange will handle successful login
}

window.handleLogout = async () => {
    customConfirm("هل أنت متأكد من تسجيل الخروج؟", async () => {
        const { error } = await supabaseClient.auth.signOut();
        if (error) {
            customAlert(`فشل تسجيل الخروج: ${error.message}`);
            console.error("Logout error:", error);
        }
        // onAuthStateChange will handle UI update
    });
};

function toggleAuthMode() {
    const submitBtn = document.getElementById('auth-submit-btn');
    const toggleBtn = document.getElementById('toggle-auth-mode');
    document.getElementById('auth-message').classList.add('hidden');
    authMode = (authMode === 'login') ? 'signup' : 'login';
    submitBtn.textContent = (authMode === 'login') ? 'تسجيل الدخول' : 'إنشاء حساب';
    toggleBtn.textContent = (authMode === 'login') ? 'إنشاء حساب جديد' : 'تسجيل الدخول بحساب موجود';
}

// --- ROLE-BASED UI CONTROL ---
window.applyRoleBasedUI = () => {
    const isAdmin = currentUserRole === 'admin';
    const isTeacher = currentUserRole === 'teacher';
    const isParent = currentUserRole === 'parent';

    // Hide all role-specific elements by default
    document.querySelectorAll('[data-role]').forEach(el => el.classList.add('hidden'));

    // Show elements based on current role
    if (isAdmin) {
        document.querySelectorAll('[data-role="admin"], [data-role="teacher"]').forEach(el => el.classList.remove('hidden'));
    } else if (isTeacher) {
        document.querySelectorAll('[data-role="teacher"]').forEach(el => el.classList.remove('hidden'));
    } else if (isParent) {
        document.querySelectorAll('[data-role="parent"]').forEach(el => el.classList.remove('hidden'));
    }

    // Toggle entire views
    document.getElementById('settings-view').classList.toggle('hidden', !isAdmin);
    document.getElementById('parent-portal-view').classList.toggle('hidden', !isParent);

    // Re-render components that might have role-specific actions inside them
    if (isAuthReady) {
        renderStudentsTable();
        renderClassesGrid();
    }
};

// --- MODALS ---
window.openModal = (modalId) => document.getElementById(modalId).classList.remove('hidden');
window.closeModal = (modalId) => document.getElementById(modalId).classList.add('hidden');
window.customAlert = (msg, type = "error") => { 
    document.getElementById('alert-message').textContent = msg; 
    openModal('alert-modal'); 
};
window.customConfirm = (msg, cb) => { 
    document.getElementById('confirm-message').textContent = msg; 
    window.confirmCallback = cb; 
    openModal('confirm-modal'); 
};


// --- RENDERING FUNCTIONS ---

window.renderStudentsTable = () => {
    const searchTerm = document.getElementById('student-search').value.toLowerCase();
    const classFilter = document.getElementById('filter-class').value;
    const tableBody = document.getElementById('students-table-body');
    if(!tableBody) return;
    
    let filtered = studentsCache.filter(s => 
        (s.name.toLowerCase().includes(searchTerm) || (s.id && s.id.toString().toLowerCase().includes(searchTerm))) && 
        (!classFilter || s.class_id === classFilter)
    );
    
    if (filtered.length === 0) { 
        tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4">لم يتم العثور على طلاب.</td></tr>`; 
        return; 
    }

    const canEditDelete = currentUserRole === 'admin' || currentUserRole === 'teacher';
    
    tableBody.innerHTML = filtered.map(s => {
        const cls = classesCache.find(c => c.id === s.class_id);
        const pages = s.progress ? Object.values(s.progress).flat().length : 0;
        let actionsHtml = canEditDelete 
            ? `<button class="text-blue-500 hover:text-blue-700 mx-1" onclick='openStudentModal("${s.id}")'>تعديل</button>
               <button class="text-red-500 hover:text-red-700 mx-1" onclick='deleteStudent("${s.id}", "${s.name}")'>حذف</button>` 
            : '';
            
        return `<tr class="hover:bg-gray-50 dark:hover:bg-gray-600">
            <td class="py-3 px-2 text-center"><input type="checkbox" class="custom-checkbox student-checkbox" data-student-id="${s.id}"></td>
            <td class="py-3 px-6 font-semibold text-theme dark:text-theme-dark cursor-pointer hover:underline" onclick="viewStudentProfile('${s.id}')">${s.name}</td>
            <td class="py-3 px-6">${cls ? cls.name : 'غير محدد'}</td>
            <td class="py-3 px-6">${pages}</td>
            <td class="py-3 px-6">${s.age || 'N/A'}</td>
            <td class="py-3 px-6 text-center">${actionsHtml}</td>
        </tr>`;
    }).join('');
};

window.renderClassesGrid = () => {
    const grid = document.getElementById('classes-grid');
    if(!grid) return;

    if (classesCache.length === 0) { 
        grid.innerHTML = `<p class="col-span-full text-center py-4">لم يتم إنشاء أي فصول بعد.</p>`; 
        return; 
    }
    const canEditDelete = currentUserRole === 'admin' || currentUserRole === 'teacher';

    grid.innerHTML = classesCache.map(cls => {
        const membersCount = studentsCache.filter(s => s.class_id === cls.id).length;
        const teacher = teachersCache.find(t => t.id === cls.teacher_id);
        let actionsHtml = canEditDelete 
            ? `<div class="mt-4 text-left">
                 <button class="text-blue-500 hover:text-blue-700 mx-1 text-sm" onclick='event.stopPropagation(); openClassModal("${cls.id}")'>تعديل</button>
                 <button class="text-red-500 hover:text-red-700 mx-1 text-sm" onclick='event.stopPropagation(); deleteClass("${cls.id}", "${cls.name}")'>حذف</button>
               </div>` 
            : '';

        return `<div class="bg-white dark:bg-gray-700 p-6 rounded-lg shadow-md flex flex-col justify-between cursor-pointer hover:shadow-lg transition-shadow" onclick="viewClassDetails('${cls.id}')">
            <div>
                <img src="${cls.photo || `https://placehold.co/600x400/0d9488/ffffff?text=${encodeURIComponent(cls.name)}`}" class="w-full h-32 object-cover rounded-md mb-4" onerror="this.onerror=null;this.src='https://placehold.co/600x400/cccccc/ffffff?text=Error';">
                <h3 class="text-xl font-bold text-blue-700 dark:text-blue-400">${cls.name}</h3>
                <p class="text-gray-600 dark:text-gray-300">${membersCount} طالب</p>
                <p class="text-sm text-gray-500 dark:text-gray-400 mt-2">${cls.schedule || 'لم يحدد جدول'}</p>
                <p class="font-bold text-theme dark:text-theme-dark mt-2">${cls.fee || 0} ${settingsCache.currency}</p>
                <p class="text-sm text-gray-500 dark:text-gray-400">المعلم: ${teacher ? teacher.name : 'غير محدد'}</p>
            </div>
            ${actionsHtml}
        </div>`;
    }).join('');
};

window.renderPlans = () => {
    const container = document.getElementById('plans-container');
    if(!container) return;
    if (plansCache.length === 0) { 
        container.innerHTML = `<p class="text-center py-4">لم يتم إنشاء أي خطط بعد.</p>`; 
        return; 
    }
    const canEditDelete = currentUserRole === 'admin' || currentUserRole === 'teacher';
    container.innerHTML = plansCache.map(plan => {
        let actionsHtml = canEditDelete 
            ? `<button class="text-blue-500 hover:text-blue-700 mx-1 text-sm" onclick='openPlanModal("${plan.id}")'>تعديل</button>
               <button class="text-red-500 hover:text-red-700 mx-1 text-sm" onclick='deletePlan("${plan.id}", "${plan.name}")'>حذف</button>` 
            : '';

        return `<div class="bg-white dark:bg-gray-700 p-4 rounded-lg shadow-md">
            <h4 class="font-bold text-lg">${plan.name}</h4>
            <p class="text-gray-600 dark:text-gray-300">${plan.description}</p>
            <p class="text-sm text-gray-500 dark:text-gray-400">الصفحات الأسبوعية: ${plan.pages_per_week || 'غير محدد'}</p>
            <div class="mt-4 text-left">${actionsHtml}</div>
        </div>`;
    }).join('');
};

window.renderNotifications = () => {
    const panel = document.getElementById('notifications-panel-content');
    const dot = document.getElementById('notification-dot');
    if(!panel || !dot) return;
    
    const unreadCount = notificationsCache.filter(n => !n.is_read).length;
    dot.classList.toggle('hidden', unreadCount === 0);
    
    if (notificationsCache.length === 0) { 
        panel.innerHTML = `<p class="p-4 text-center text-gray-500">لا توجد إشعارات</p>`; 
        return; 
    }
    panel.innerHTML = notificationsCache.map(n => 
        `<div class="p-3 border-b border-gray-200 dark:border-gray-600 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 ${!n.is_read ? 'bg-teal-50 dark:bg-teal-900' : ''}" onclick="openNotificationModal('${n.id}')">
            <p class="text-sm">${n.message}</p>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">${new Date(n.created_at).toLocaleString()}</p>
        </div>`
    ).join('');
};

window.renderExamFieldSettings = () => {
    const container = document.getElementById('exam-fields-settings-container');
    if(!container) return;
    if (currentUserRole !== 'admin') { 
        container.innerHTML = `<p class="text-center py-4 text-gray-500">لا تملك صلاحية لإدارة حقول الاختبارات.</p>`; 
        return; 
    }
    container.innerHTML = (settingsCache.examFields || []).map((field, index) => 
        `<div class="flex items-center justify-between bg-gray-100 dark:bg-gray-600 p-2 rounded mb-2">
            <span>${field.name} (${field.mark} درجة)</span>
            <button class="text-red-500 hover:text-red-700" onclick="removeExamField(${index})">&times;</button>
        </div>`
    ).join('');
};

window.renderExamFieldsForEntry = () => {
    const container = document.getElementById('exam-fields-container');
    if(!container) return;
    if (currentUserRole !== 'admin' && currentUserRole !== 'teacher') { 
        container.innerHTML = `<p class="text-center py-4 text-gray-500">لا تملك صلاحية لرصد درجات الاختبارات.</p>`; 
        return; 
    }
    container.innerHTML = (settingsCache.examFields || []).map(field => 
        `<div>
            <label class="block mb-1 font-semibold">${field.name} (من ${field.mark})</label>
            <input type="number" data-field-name="${field.name}" data-max-mark="${field.mark}" class="w-full p-2 border rounded dark:bg-gray-800 dark:border-gray-600 exam-score-field" placeholder="الدرجة">
        </div>`
    ).join('');
};

window.renderAttendanceTable = () => {
    const classId = document.getElementById('attendance-class-select').value;
    const date = document.getElementById('attendance-date').value;
    const container = document.getElementById('attendance-table-container');
    if(!container) return;
    
    if (currentUserRole !== 'admin' && currentUserRole !== 'teacher') {
        container.innerHTML = `<p class="text-center py-4 text-gray-500">لا تملك صلاحية لتسجيل الحضور والغياب.</p>`;
        return;
    }
    if (!classId || !date) { 
        container.innerHTML = '<p class="text-center py-4">الرجاء اختيار فصل وتاريخ.</p>'; 
        return; 
    }
    
    const studentsInClass = studentsCache.filter(s => s.class_id === classId);
    if (studentsInClass.length === 0) { 
        container.innerHTML = '<p class="text-center py-4">لا يوجد طلاب في هذا الفصل.</p>'; 
        return; 
    }

    const dailyRecord = attendanceCache[date] || {};
    container.innerHTML = `
        <table class="min-w-full bg-white dark:bg-gray-700">
            <thead class="bg-gray-200 dark:bg-gray-600">
                <tr><th class="py-3 px-6 text-right">الاسم</th><th class="py-3 px-6 text-center">الحالة</th></tr>
            </thead>
            <tbody>
                ${studentsInClass.map(student => `
                    <tr class="hover:bg-gray-50 dark:hover:bg-gray-600">
                        <td class="py-3 px-6">${student.name}</td>
                        <td class="py-3 px-6 text-center">
                            <div class="flex justify-center gap-4">
                                <label class="flex items-center gap-2 cursor-pointer">
                                    <input type="radio" name="attendance-${student.id}" value="present" class="form-radio text-green-500" ${dailyRecord[student.id] === 'present' ? 'checked' : ''}>
                                    <span>حاضر</span>
                                </label>
                                <label class="flex items-center gap-2 cursor-pointer">
                                    <input type="radio" name="attendance-${student.id}" value="absent" class="form-radio text-red-500" ${dailyRecord[student.id] === 'absent' ? 'checked' : ''}>
                                    <span>غائب</span>
                                </label>
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>`;
};

window.renderFinancialsTable = () => {
    const container = document.getElementById('financials-table-container');
    const month = document.getElementById('financial-month').value;
    if(!container || !month) return;
    
    const monthData = financialsCache[month] || {};
    if (currentUserRole !== 'admin') { 
        container.innerHTML = `<p class="text-center py-4 text-gray-500">لا تملك صلاحية لمتابعة الأمور المالية.</p>`; 
        return; 
    }
    if (studentsCache.length === 0) { 
        container.innerHTML = `<p class="text-center py-4">لا يوجد طلاب.</p>`; 
        return; 
    }

    container.innerHTML = `
        <table class="min-w-full bg-white dark:bg-gray-700">
            <thead class="bg-gray-200 dark:bg-gray-600">
                <tr>
                    <th class="py-3 px-6 text-right">الطالب</th>
                    <th class="py-3 px-6 text-right">رسوم الفصل</th>
                    <th class="py-3 px-6 text-center">الحالة</th>
                </tr>
            </thead>
            <tbody>
                ${studentsCache.map(student => {
                    const status = monthData[student.id] || 'pending';
                    const cls = classesCache.find(c => c.id === student.class_id);
                    const fee = cls ? (cls.fee || 0) : 0;
                    return `
                        <tr class="hover:bg-gray-50 dark:hover:bg-gray-600">
                            <td class="py-3 px-6">${student.name}</td>
                            <td class="py-3 px-6">${fee} ${settingsCache.currency}</td>
                            <td class="py-3 px-6 text-center">
                                <select data-student-id="${student.id}" class="p-1 border rounded dark:bg-gray-800 financial-status-select">
                                    <option value="pending" ${status === 'pending' ? 'selected' : ''}>لم يدفع</option>
                                    <option value="paid" ${status === 'paid' ? 'selected' : ''}>دفع</option>
                                    <option value="exempt" ${status === 'exempt' ? 'selected' : ''}>معفى</option>
                                </select>
                            </td>
                        </tr>`;
                }).join('')}
            </tbody>
        </table>`;
};

window.renderExpensesList = () => {
    const list = document.getElementById('expenses-list');
    if(!list) return;

    if (expensesCache.length === 0) { 
        list.innerHTML = `<p class="text-center text-gray-500">لا توجد مصروفات مسجلة.</p>`; 
        return; 
    }

    list.innerHTML = `
        <table class="min-w-full bg-white dark:bg-gray-700 mt-4">
            <thead class="bg-gray-200 dark:bg-gray-600">
                <tr>
                    <th class="py-3 px-6 text-right">الوصف</th>
                    <th class="py-3 px-6 text-right">المبلغ</th>
                    <th class="py-3 px-6 text-right">التاريخ</th>
                    <th class="py-3 px-6 text-center">إجراءات</th>
                </tr>
            </thead>
            <tbody>
                ${expensesCache.sort((a, b) => new Date(b.date) - new Date(a.date)).map(expense => `
                    <tr class="hover:bg-gray-50 dark:hover:bg-gray-600">
                        <td class="py-3 px-6">${expense.description}</td>
                        <td class="py-3 px-6">${expense.amount} ${settingsCache.currency}</td>
                        <td class="py-3 px-6">${new Date(expense.date).toLocaleDateString()}</td>
                        <td class="py-3 px-6 text-center">
                            <button class="text-red-500 hover:text-red-700 mx-1" onclick="deleteExpense('${expense.id}')">حذف</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>`;
};

window.viewStudentProfile = (studentId) => {
    const student = studentsCache.find(s => s.id === studentId);
    if (!student) { customAlert("لم يتم العثور على الطالب."); return; }

    const profileView = document.getElementById('student-profile-view');
    const studentClass = classesCache.find(c => c.id === student.class_id);
    const studentPlan = plansCache.find(p => p.id === student.plan_id);

    // Generate WhatsApp/Telegram contact links
    let contactLinks = '';
    if (student.phone && student.country_code) {
        let cleanPhone = student.phone.startsWith('0') ? student.phone.substring(1) : student.phone;
        const fullPhone = `${student.country_code.replace('+', '')}${cleanPhone}`;
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

    // Generate interactive memorization grid
    let memorizationHtml = '';
    const canToggleMemorization = currentUserRole === 'admin' || currentUserRole === 'teacher';
    for (let i = 1; i <= 30; i++) {
        const juzProgress = student.progress ? (student.progress[i] || []) : [];
        const percentage = (juzProgress.length / 20) * 100;
        memorizationHtml += `
            <div class="mb-4">
                <h4 class="font-semibold">الجزء ${i} (${juzProgress.length}/20)</h4>
                <div class="w-full progress-bar-bg mt-1"><div class="progress-bar" style="width: ${percentage}%"></div></div>
                <details class="mt-2">
                    <summary class="cursor-pointer text-sm text-gray-500 dark:text-gray-400">عرض/تعديل الصفحات</summary>
                    <div class="memorization-grid mt-2 p-2 bg-gray-100 dark:bg-gray-800 rounded">
                        ${[...Array(20).keys()].map(p => 
                            `<div class="page-square ${juzProgress.includes(p + 1) ? 'memorized' : ''}" 
                                 ${canToggleMemorization ? `onclick="togglePageMemorization('${student.id}', ${i}, ${p + 1})"` : ''}>
                                ${p + 1}
                            </div>`
                        ).join('')}
                    </div>
                </details>
            </div>`;
    }
    
    // Create editable notes section
    const notesTextarea = canToggleMemorization 
        ? `<textarea id="student-notes" class="w-full p-2 border rounded dark:bg-gray-800 dark:border-gray-600" rows="4" onchange="updateStudentNote('${student.id}', this.value)">${student.notes || ''}</textarea>` 
        : `<p class="w-full p-2 border rounded dark:bg-gray-800 dark:border-gray-600">${student.notes || 'لا توجد ملاحظات.'}</p>`;

    // Assemble the final profile HTML
    if (profileView) {
        profileView.innerHTML = `
            <div class="flex justify-between items-start">
                <div><h2 class="text-3xl font-bold">${student.name}</h2><p class="text-gray-500 dark:text-gray-400">تاريخ الانضمام: ${student.start_date || 'غير محدد'}</p></div>
                <button class="bg-gray-200 dark:bg-gray-600 px-4 py-2 rounded-lg" onclick="showView('students-view')">العودة للطلاب</button>
            </div>
            <div class="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div class="lg:col-span-1 bg-white dark:bg-gray-700 p-6 rounded-lg shadow-md">
                    <h3 class="text-xl font-bold mb-4 border-b pb-2 dark:border-gray-600">معلومات الطالب</h3>
                    <p><strong>العمر:</strong> ${student.age || 'غير محدد'}</p>
                    <p><strong>ولي الأمر:</strong> ${student.guardian_name || 'غير محدد'}</p>
                    <p><strong>الفصل:</strong> ${studentClass ? studentClass.name : 'غير محدد'}</p>
                    <p><strong>الخطة:</strong> ${studentPlan ? studentPlan.name : 'غير محدد'}</p>
                    ${contactLinks}
                    <h3 class="text-xl font-bold mb-4 mt-6 border-b pb-2 dark:border-gray-600">ملاحظات المعلم</h3>
                    ${notesTextarea}
                </div>
                <div class="lg:col-span-2 bg-white dark:bg-gray-700 p-6 rounded-lg shadow-md">
                    <h3 class="text-xl font-bold mb-4">متابعة الحفظ التفصيلي</h3>
                    <div class="overflow-y-auto max-h-[70vh] pr-2">${memorizationHtml}</div>
                </div>
            </div>`;
    }
    showView('student-profile-view');
};

window.viewClassDetails = (classId) => {
    // This is a placeholder. A real implementation would show a dedicated view
    // with class students, schedule details, and related stats.
    const cls = classesCache.find(c => c.id === classId);
    customAlert(`عرض تفاصيل الفصل: ${cls ? cls.name : 'غير معروف'}`);
    console.log("Viewing class details for:", classId);
};

window.renderParentStudentProfile = (studentId) => {
    const display = document.getElementById('parent-student-profile-display');
    if (!display) return;

    const student = studentsCache.find(s => s.id === studentId);
    if (!student) {
        display.innerHTML = `<p class="text-center text-gray-500">الرجاء اختيار طالب لعرض التفاصيل.</p>`;
        return;
    }
    const studentClass = classesCache.find(c => c.id === student.class_id);
    const studentPlan = plansCache.find(p => p.id === student.plan_id);
    const studentExams = examsCache[studentId] || [];
    
    let memorizationHtml = '';
    for (let i = 1; i <= 30; i++) {
        const juzProgress = student.progress ? (student.progress[i] || []) : [];
        const percentage = (juzProgress.length / 20) * 100;
        memorizationHtml += `<div class="mb-4"><h4 class="font-semibold">الجزء ${i} (${juzProgress.length}/20)</h4><div class="w-full progress-bar-bg mt-1"><div class="progress-bar" style="width: ${percentage}%"></div></div></div>`;
    }

    let examHistoryHtml = 'لا توجد اختبارات مسجلة.';
    if (studentExams.length > 0) {
        examHistoryHtml = studentExams.map(exam => `<div class="border-b dark:border-gray-600 py-2"><p>${exam.name} (الجزء ${exam.juz})</p><p>الدرجة: ${exam.totalScore}/${exam.maxScore}</p></div>`).join('');
    }

    display.innerHTML = `
        <div class="bg-white dark:bg-gray-700 p-6 rounded-lg shadow-md">
            <h3 class="text-2xl font-bold">${student.name}</h3>
            <p class="text-gray-600 dark:text-gray-300">الفصل: ${studentClass ? studentClass.name : 'غير محدد'}</p>
            <p class="text-gray-600 dark:text-gray-300">الخطة: ${studentPlan ? studentPlan.name : 'غير محدد'}</p>
            <div class="mt-6">
                <h4 class="text-xl font-bold mb-4">متابعة الحفظ</h4>
                <div class="overflow-y-auto max-h-[50vh] pr-2">${memorizationHtml}</div>
            </div>
            <div class="mt-6">
                <h4 class="text-xl font-bold mb-4">سجل الاختبارات</h4>
                ${examHistoryHtml}
            </div>
        </div>`;
};


// --- DASHBOARD RENDERING ---

window.updateDashboard = () => {
    // Basic stats
    document.getElementById('total-students-dashboard').textContent = studentsCache.length;
    const today = new Date().toISOString().slice(0, 10);
    const activeToday = attendanceCache[today] ? Object.values(attendanceCache[today]).filter(s => s === 'present').length : 0;
    document.getElementById('active-today-dashboard').textContent = activeToday;
    const totalPages = studentsCache.reduce((sum, s) => sum + (s.progress ? Object.values(s.progress).flat().length : 0), 0);
    document.getElementById('total-pages-dashboard').textContent = totalPages;

    // Average exam score
    let totalScores = 0, totalMaxScores = 0;
    Object.values(examsCache).flat().forEach(exam => {
        totalScores += exam.totalScore;
        totalMaxScores += exam.maxScore;
    });
    const avgScore = totalMaxScores > 0 ? ((totalScores / totalMaxScores) * 100).toFixed(0) : 0;
    document.getElementById('avg-exam-score-dashboard').textContent = `${avgScore}%`;

    // Render dashboard components
    renderTopStudents();
    renderWeeklyProgressChart();
    renderClassDistributionChart();
    renderMonthlyAttendanceChart();
};

window.renderFinancialsDashboard = () => {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const monthData = financialsCache[currentMonth] || {};
    let totalIncome = 0, pendingPayments = 0;

    studentsCache.forEach(student => {
        const status = monthData[student.id];
        const cls = classesCache.find(c => c.id === student.class_id);
        const fee = cls ? (cls.fee || 0) : 0;
        if (status === 'paid') totalIncome += fee;
        else if (status === 'pending' || !status) pendingPayments += fee;
    });

    const totalExpenses = expensesCache
        .filter(e => e.date.startsWith(currentMonth))
        .reduce((sum, e) => sum + e.amount, 0);

    const netBalance = totalIncome - totalExpenses;

    document.getElementById('total-income-dashboard').textContent = `${totalIncome.toLocaleString()} ${settingsCache.currency}`;
    document.getElementById('total-expenses-dashboard').textContent = `${totalExpenses.toLocaleString()} ${settingsCache.currency}`;
    document.getElementById('net-balance-dashboard').textContent = `${netBalance.toLocaleString()} ${settingsCache.currency}`;
    document.getElementById('pending-payments-dashboard').textContent = `${pendingPayments.toLocaleString()} ${settingsCache.currency}`;
    
    renderIncomeOverTimeChart();
};

window.renderTopStudents = () => {
    const list = document.getElementById('top-students-list');
    if(!list) return;

    const sorted = [...studentsCache].sort((a, b) => 
        (b.progress ? Object.values(b.progress).flat().length : 0) - (a.progress ? Object.values(a.progress).flat().length : 0)
    ).slice(0, 5);

    if (sorted.length === 0) { 
        list.innerHTML = `<p class="text-center text-gray-500">لا يوجد بيانات</p>`; 
        return; 
    }
    list.innerHTML = sorted.map((s, i) => `
        <div class="flex justify-between items-center p-2 rounded ${i % 2 === 0 ? 'bg-gray-50 dark:bg-gray-800' : ''}">
            <div class="font-semibold">${i + 1}. ${s.name}</div>
            <div class="text-theme dark:text-theme-dark font-bold">${s.progress ? Object.values(s.progress).flat().length : 0} صفحة</div>
        </div>`
    ).join('');
};

window.renderWeeklyProgressChart = () => {
    const ctxCanvas = document.getElementById('weekly-progress-chart');
    if (!ctxCanvas || !window.Chart) return;
    const ctx = ctxCanvas.getContext('2d');
    
    // This is placeholder data. A real implementation would require logging
    // tasmee' dates and calculating progress per week.
    const labels = ['الأسبوع 4', 'الأسبوع 3', 'الأسبوع 2', 'الأسبوع الحالي'];
    const data = [Math.floor(Math.random()*20), Math.floor(Math.random()*30), Math.floor(Math.random()*25), Math.floor(Math.random()*40)];

    if (weeklyProgressChart) weeklyProgressChart.destroy();
    weeklyProgressChart = new Chart(ctx, { 
        type: 'line', 
        data: { 
            labels, 
            datasets: [{ 
                label: 'صفحات تم تسميعها', 
                data, 
                borderColor: settingsCache.themeColor, 
                backgroundColor: Chart.helpers.color(settingsCache.themeColor).alpha(0.2).rgbString(), 
                fill: true, 
                tension: 0.3 
            }] 
        } 
    });
};

window.renderClassDistributionChart = () => {
    const ctxCanvas = document.getElementById('class-distribution-chart');
    if (!ctxCanvas || !window.Chart) return;
    const ctx = ctxCanvas.getContext('2d');

    const labels = classesCache.map(c => c.name);
    const data = classesCache.map(c => studentsCache.filter(s => s.class_id === c.id).length);

    if (classDistributionChart) classDistributionChart.destroy();
    classDistributionChart = new Chart(ctx, { 
        type: 'doughnut', 
        data: { 
            labels, 
            datasets: [{ 
                label: 'الطلاب', 
                data, 
                backgroundColor: ['#34d399', '#60a5fa', '#c084fc', '#f87171', '#fbbf24', '#a3e635', '#2dd4bf'] 
            }] 
        }, 
        options: { responsive: true, plugins: { legend: { position: 'top' } } } 
    });
};

window.renderMonthlyAttendanceChart = () => {
    const ctxCanvas = document.getElementById('monthly-attendance-chart');
    if (!ctxCanvas || !window.Chart) return;
    const ctx = ctxCanvas.getContext('2d');
    
    const labels = [];
    const presentData = [];
    const absentData = [];
    const today = new Date();

    for (let i = 5; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const monthKey = d.toLocaleString('ar-EG', { month: 'long' });
        labels.push(monthKey);
        
        let presentCount = 0;
        let absentCount = 0;
        const monthStr = d.toISOString().slice(0, 7);

        Object.keys(attendanceCache).forEach(date => {
            if(date.startsWith(monthStr)) {
                presentCount += Object.values(attendanceCache[date]).filter(s => s === 'present').length;
                absentCount += Object.values(attendanceCache[date]).filter(s => s === 'absent').length;
            }
        });
        presentData.push(presentCount);
        absentData.push(absentCount);
    }

    if (monthlyAttendanceChart) monthlyAttendanceChart.destroy();
    monthlyAttendanceChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'حضور', data: presentData, backgroundColor: 'rgba(75, 192, 192, 0.6)' },
                { label: 'غياب', data: absentData, backgroundColor: 'rgba(255, 99, 132, 0.6)' }
            ]
        },
        options: { scales: { x: { stacked: true }, y: { stacked: true } } }
    });
};


window.renderIncomeOverTimeChart = () => {
    const ctxCanvas = document.getElementById('income-over-time-chart');
    if (!ctxCanvas || !window.Chart) return;
    const ctx = ctxCanvas.getContext('2d');
    
    const labels = [];
    const expectedData = [];
    const actualData = [];
    const expensesData = [];
    
    for (let i = 5; i >= 0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        const monthKey = d.toISOString().slice(0, 7);
        labels.push(d.toLocaleString('ar-EG', { month: 'short', year: 'numeric' }));

        let expected = 0, actual = 0;
        const monthPayments = financialsCache[monthKey] || {};

        studentsCache.forEach(student => {
            const cls = classesCache.find(c => c.id === student.class_id);
            const fee = cls ? (cls.fee || 0) : 0;
            if (monthPayments[student.id] !== 'exempt') {
                expected += fee;
            }
            if (monthPayments[student.id] === 'paid') {
                actual += fee;
            }
        });
        
        const monthExpenses = expensesCache
            .filter(e => e.date.startsWith(monthKey))
            .reduce((sum, e) => sum + e.amount, 0);

        expectedData.push(expected);
        actualData.push(actual);
        expensesData.push(monthExpenses);
    }

    if(incomeOverTimeChart) incomeOverTimeChart.destroy();
    incomeOverTimeChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'الدخل الفعلي', data: actualData, backgroundColor: 'rgba(75, 192, 192, 0.6)' },
                { label: 'المصروفات', data: expensesData, backgroundColor: 'rgba(255, 159, 64, 0.6)' },
                { label: 'الدخل المتوقع', data: expectedData, backgroundColor: 'rgba(201, 203, 207, 0.6)' }
            ]
        },
        options: { scales: { y: { beginAtZero: true } } }
    });
};


// --- DATA MANIPULATION ---

window.handleStudentFormSubmit = async (e) => {
    e.preventDefault();
    if (currentUserRole !== 'admin' && currentUserRole !== 'teacher') {
        return customAlert("لا تملك صلاحية لحفظ بيانات الطلاب.");
    }
    const id = document.getElementById('student-id').value;
    const studentData = {
        name: document.getElementById('student-name').value,
        age: document.getElementById('student-age').value || null,
        guardian_name: document.getElementById('student-guardian').value,
        start_date: document.getElementById('student-start-date').value,
        phone: document.getElementById('student-phone').value,
        country_code: document.getElementById('student-country-code').value,
        class_id: document.getElementById('student-class-select').value || null,
        plan_id: document.getElementById('student-plan-select').value || null,
        juz_start: parseInt(document.getElementById('student-juz-start').value) || null,
        notes: document.getElementById('student-notes-modal').value,
        user_id: currentUser.id
    };

    let response;
    if (id) {
        // Update existing student
        response = await supabaseClient.from('students').update(studentData).eq('id', id);
    } else {
        // Create new student with default progress structure
        studentData.progress = {}; 
        studentData.achievements = [];
        response = await supabaseClient.from('students').insert([studentData]).select().single();
    }

    if (response.error) {
        console.error("Error saving student:", response.error);
        customAlert("فشل حفظ بيانات الطالب.");
    } else {
        createNotification(id ? `تم تحديث بيانات الطالب ${studentData.name}` : `تم إضافة طالب جديد: ${studentData.name}`, "success");
        closeModal('student-modal');
        await loadAllData(); // Refresh data
    }
};

window.deleteStudent = (id, name) => {
    if (currentUserRole !== 'admin' && currentUserRole !== 'teacher') {
        return customAlert("لا تملك صلاحية لحذف الطلاب.");
    }
    customConfirm(`هل أنت متأكد من حذف الطالب ${name}؟ سيتم حذف جميع بياناته المرتبطة بشكل دائم.`, async () => {
        // In a real app, you'd use a transaction or edge function to delete related data.
        // For simplicity here, we delete from each table separately.
        const { error } = await supabaseClient.from('students').delete().eq('id', id);
        
        if (error) {
            console.error("Error deleting student:", error);
            customAlert("فشل حذف الطالب.");
        } else {
             // Also delete from related tables
            await supabaseClient.from('attendance').delete().eq('student_id', id);
            await supabaseClient.from('exams').delete().eq('student_id', id);
            await supabaseClient.from('financials').delete().eq('student_id', id);

            createNotification(`تم حذف الطالب ${name}`, "warning");
            await loadAllData(); // Refresh data
        }
    });
};

window.handleClassFormSubmit = async (e) => {
    e.preventDefault();
    if (currentUserRole !== 'admin' && currentUserRole !== 'teacher') {
        return customAlert("لا تملك صلاحية لحفظ بيانات الفصول.");
    }
    const id = document.getElementById('class-id').value;
    const classData = {
        name: document.getElementById('class-name').value,
        schedule: document.getElementById('class-schedule').value,
        fee: parseFloat(document.getElementById('class-fee').value) || 0,
        teacher_id: document.getElementById('class-teacher-select').value || null,
        photo: document.getElementById('class-photo').value,
        user_id: currentUser.id
    };

    const { error } = id 
        ? await supabaseClient.from('classes').update(classData).eq('id', id)
        : await supabaseClient.from('classes').insert([classData]);

    if (error) {
        console.error("Error saving class:", error);
        customAlert("فشل حفظ بيانات الفصل.");
    } else {
        createNotification(id ? `تم تحديث الفصل ${classData.name}` : `تم إنشاء فصل جديد: ${classData.name}`, "success");
        closeModal('class-modal');
        await loadAllData();
    }
};

window.deleteClass = (id, name) => {
    if (currentUserRole !== 'admin' && currentUserRole !== 'teacher') {
        return customAlert("لا تملك صلاحية لحذف الفصول.");
    }
    customConfirm(`هل أنت متأكد من حذف فصل ${name}؟ سيتم إلغاء تعيين الطلاب من هذا الفصل.`, async () => {
        // First, unassign students from this class
        const { error: updateError } = await supabaseClient
            .from('students')
            .update({ class_id: null })
            .eq('class_id', id);
        
        if (updateError) {
             console.error("Error unassigning students:", updateError);
             customAlert("فشل إلغاء تعيين الطلاب من الفصل.");
             return;
        }

        // Then, delete the class
        const { error: deleteError } = await supabaseClient.from('classes').delete().eq('id', id);
        
        if (deleteError) {
            console.error("Error deleting class:", deleteError);
            customAlert("فشل حذف الفصل.");
        } else {
            createNotification(`تم حذف الفصل ${name}`, "warning");
            await loadAllData();
        }
    });
};

window.handlePlanFormSubmit = async (e) => {
    e.preventDefault();
    if (currentUserRole !== 'admin' && currentUserRole !== 'teacher') {
        return customAlert("لا تملك صلاحية لحفظ الخطط.");
    }
    const id = document.getElementById('plan-id').value;
    const planData = {
        name: document.getElementById('plan-name').value,
        description: document.getElementById('plan-description').value,
        pages_per_week: parseInt(document.getElementById('plan-pages-per-week').value) || null,
        user_id: currentUser.id
    };
    
    const { error } = id 
        ? await supabaseClient.from('plans').update(planData).eq('id', id) 
        : await supabaseClient.from('plans').insert([planData]);
    
    if (error) { 
        customAlert("فشل حفظ الخطة."); 
        console.error("Error saving plan:", error); 
    }
    else { 
        createNotification(id ? 'تم تحديث الخطة' : 'تم إنشاء خطة جديدة', 'success'); 
        closeModal('plan-modal'); 
        await loadAllData(); 
    }
};

window.deletePlan = (id, name) => {
    if (currentUserRole !== 'admin' && currentUserRole !== 'teacher') {
        return customAlert("لا تملك صلاحية لحذف الخطط.");
    }
    customConfirm(`هل أنت متأكد من حذف خطة ${name}؟`, async () => {
        // Unassign students from this plan first
        await supabaseClient.from('students').update({ plan_id: null }).eq('plan_id', id);
        
        // Then delete the plan
        const { error } = await supabaseClient.from('plans').delete().eq('id', id);
        if (error) { 
            customAlert("فشل حذف الخطة."); 
            console.error("Error deleting plan:", error); 
        }
        else { 
            createNotification(`تم حذف الخطة ${name}`, 'warning'); 
            await loadAllData(); 
        }
    });
};

window.saveTasmeeResults = async () => {
    if (currentUserRole !== 'admin' && currentUserRole !== 'teacher') {
        return customAlert("لا تملك صلاحية لتسجيل التسميع.");
    }
    const studentId = document.getElementById('tasmee-student-select').value;
    const juz = parseInt(document.getElementById('tasmee-juz').value);
    const pageFrom = parseInt(document.getElementById('tasmee-page-from').value);
    const pageTo = parseInt(document.getElementById('tasmee-page-to').value) || pageFrom;
    
    if (!studentId || isNaN(juz) || isNaN(pageFrom)) { return customAlert("الرجاء ملء جميع الحقول."); }
    if (pageTo < pageFrom) { return customAlert("صفحة النهاية يجب أن تكون بعد صفحة البداية."); }
    if (juz < 1 || juz > 30 || pageFrom < 1 || pageFrom > 20 || pageTo < 1 || pageTo > 20) {
        return customAlert("الرجاء إدخال أرقام صحيحة للجزء والصفحات (صفحة 1-20).");
    }

    const student = studentsCache.find(s => s.id === studentId);
    if (!student) { return customAlert("لم يتم العثور على الطالب."); }

    let progress = student.progress || {};
    if (!progress[juz]) progress[juz] = [];
    for (let i = pageFrom; i <= pageTo; i++) {
        if (!progress[juz].includes(i)) progress[juz].push(i);
    }
    progress[juz].sort((a,b) => a-b);

    const { error } = await supabaseClient.from('students').update({ progress }).eq('id', studentId);
    if (error) { 
        customAlert("فشل حفظ التسميع."); 
        console.error("Error saving tasmee:", error); 
    }
    else { 
        customAlert('تم تسجيل التسميع بنجاح.');
        document.getElementById('tasmee-form').reset();
        await loadAllData(); 
    }
};

window.saveAttendance = async () => {
    if (currentUserRole !== 'admin' && currentUserRole !== 'teacher') {
        return customAlert("لا تملك صلاحية لحفظ الحضور.");
    }
    const date = document.getElementById('attendance-date').value;
    if (!date) { return customAlert("الرجاء تحديد التاريخ."); }

    const recordsToUpsert = [];
    document.querySelectorAll('input[type="radio"][name^="attendance-"]:checked').forEach(input => {
        recordsToUpsert.push({
            student_id: input.name.replace('attendance-', ''),
            date: date,
            status: input.value,
            user_id: currentUser.id
        });
    });

    if (recordsToUpsert.length === 0) { return customAlert("لم يتم تحديد أي حالة حضور."); }

    const { error } = await supabaseClient.from('attendance').upsert(recordsToUpsert, { onConflict: 'student_id,date' });
    if (error) { 
        customAlert("فشل حفظ الحضور."); 
        console.error("Error saving attendance:", error); 
    }
    else { 
        customAlert("تم حفظ الحضور بنجاح."); 
        await loadAllData(); 
    }
};

window.saveExamResults = async () => {
    if (currentUserRole !== 'admin' && currentUserRole !== 'teacher') {
        return customAlert("لا تملك صلاحية لحفظ نتائج الاختبارات.");
    }
    const studentId = document.getElementById('exam-student-select').value;
    const examName = document.getElementById('exam-name').value.trim();
    const examJuz = parseInt(document.getElementById('exam-juz').value);
    if (!studentId || !examName || isNaN(examJuz)) { return customAlert("الرجاء ملء جميع الحقول."); }

    const scores = {};
    let totalScore = 0, maxScore = 0, isValid = true;
    document.querySelectorAll('.exam-score-field').forEach(field => {
        const fieldName = field.dataset.fieldName;
        const maxMark = parseInt(field.dataset.maxMark);
        const score = parseInt(field.value);
        if (isNaN(score) || score < 0 || score > maxMark) {
            customAlert(`الدرجة لحقل "${fieldName}" غير صالحة.`); isValid = false;
        }
        scores[fieldName] = score;
        totalScore += score;
        maxScore += maxMark;
    });
    if (!isValid) return;

    // Supabase crypto.randomUUID() is not available in browser, use window.crypto
    const examData = { id: window.crypto.randomUUID(), name: examName, juz: examJuz, scores, totalScore, maxScore, date: new Date().toISOString() };
    
    const { error } = await supabaseClient.from('exams').insert({
        student_id: studentId,
        exam_data: examData,
        user_id: currentUser.id
    });

    if (error) { 
        customAlert("فشل حفظ نتيجة الاختبار."); 
        console.error("Error saving exam:", error); 
    }
    else { 
        customAlert("تم حفظ نتيجة الاختبار بنجاح.");
        document.getElementById('exam-form').reset();
        await loadAllData(); 
    }
};

window.addExamField = async () => {
    if (currentUserRole !== 'admin') return customAlert("لا تملك صلاحية لإدارة حقول الاختبارات.");
    const name = document.getElementById('new-field-name').value.trim();
    const mark = parseInt(document.getElementById('new-field-mark').value);
    if (!name || isNaN(mark) || mark <= 0) { return customAlert("الرجاء إدخال اسم حقل صحيح ودرجة موجبة."); }
    if (!settingsCache.examFields) settingsCache.examFields = [];
    settingsCache.examFields.push({ name, mark });
    await saveSettings();
    renderExamFieldSettings();
    renderExamFieldsForEntry();
    document.getElementById('add-exam-field-form').reset();
};

window.removeExamField = async (index) => {
    if (currentUserRole !== 'admin') return customAlert("لا تملك صلاحية لإدارة حقول الاختبارات.");
    settingsCache.examFields.splice(index, 1);
    await saveSettings();
    renderExamFieldSettings();
    renderExamFieldsForEntry();
};

window.saveFinancials = async () => {
    if (currentUserRole !== 'admin') return customAlert("لا تملك صلاحية لحفظ التغييرات المالية.");
    const month = document.getElementById('financial-month').value;
    if (!month) { return customAlert("الرجاء تحديد الشهر."); }

    const recordsToUpsert = [];
    document.querySelectorAll('.financial-status-select').forEach(select => {
        recordsToUpsert.push({
            student_id: select.dataset.studentId,
            month_year: month,
            status: select.value,
            user_id: currentUser.id
        });
    });
    if (recordsToUpsert.length === 0) return;

    const { error } = await supabaseClient.from('financials').upsert(recordsToUpsert, { onConflict: 'student_id,month_year' });
    if (error) { 
        customAlert("فشل حفظ الحالة المالية."); 
        console.error("Error saving financials:", error); 
    }
    else { 
        createNotification(`تم حفظ الحالة المالية لشهر ${month}.`, 'success'); 
        await loadAllData(); 
    }
};

window.addExpense = async (e) => {
    e.preventDefault();
    if (currentUserRole !== 'admin') return customAlert("لا تملك صلاحية لإضافة المصروفات.");
    
    const expenseData = {
        description: document.getElementById('expense-description').value,
        amount: parseFloat(document.getElementById('expense-amount').value),
        date: document.getElementById('expense-date').value,
        user_id: currentUser.id
    };
    if (!expenseData.description || isNaN(expenseData.amount) || !expenseData.date) { 
        return customAlert("الرجاء ملء جميع حقول المصروفات."); 
    }

    const { error } = await supabaseClient.from('expenses').insert([expenseData]);
    if (error) { 
        customAlert("فشل إضافة المصروف."); 
        console.error("Error adding expense:", error); 
    }
    else { 
        createNotification("تم إضافة المصروف بنجاح.", "success"); 
        document.getElementById('expense-form').reset(); 
        await loadAllData(); 
    }
};

window.deleteExpense = async (id) => {
    if (currentUserRole !== 'admin') return customAlert("لا تملك صلاحية لحذف المصروفات.");
    customConfirm("هل أنت متأكد من حذف هذا المصروف؟", async () => {
        const { error } = await supabaseClient.from('expenses').delete().eq('id', id);
        if (error) { 
            customAlert("فشل حذف المصروف."); 
            console.error("Error deleting expense:", error); 
        }
        else { 
            createNotification("تم حذف المصروف.", "warning"); 
            await loadAllData(); 
        }
    });
};

window.togglePageMemorization = async (studentId, juz, page) => {
    if (currentUserRole !== 'admin' && currentUserRole !== 'teacher') {
        return customAlert("لا تملك صلاحية لتحديث حالة الحفظ.");
    }
    const student = studentsCache.find(s => s.id === studentId);
    if (!student) return;

    let progress = student.progress || {};
    if (!progress[juz]) progress[juz] = [];
    
    const pageIndex = progress[juz].indexOf(page);
    if (pageIndex > -1) {
        progress[juz].splice(pageIndex, 1);
    } else {
        progress[juz].push(page);
    }
    progress[juz].sort((a, b) => a - b);

    const { error } = await supabaseClient.from('students').update({ progress }).eq('id', studentId);
    if (error) { 
        customAlert("فشل تحديث حالة الحفظ."); 
        console.error("Error toggling page memorization:", error); 
    }
    else { 
        createNotification("تم تحديث حالة الحفظ.", "info"); 
        await loadAllData(); // Refresh local cache
        viewStudentProfile(studentId); // Re-render the profile view to show the change
    }
};

window.updateStudentNote = async (studentId, newNote) => {
    if (currentUserRole !== 'admin' && currentUserRole !== 'teacher') {
        return customAlert("لا تملك صلاحية لتحديث ملاحظات الطلاب.");
    }
    const { error } = await supabaseClient.from('students').update({ notes: newNote }).eq('id', studentId);
    if (error) { 
        customAlert("فشل حفظ الملاحظة."); 
        console.error("Error updating student note:", error); 
    }
    else { 
        createNotification("تم حفظ الملاحظة.", "info"); 
        // No need to reload all data for this, just update local cache
        const student = studentsCache.find(s => s.id === studentId);
        if(student) student.notes = newNote;
    } 
};

window.handleBulkAssignClass = async () => {
    if (currentUserRole !== 'admin' && currentUserRole !== 'teacher') {
        return customAlert("لا تملك صلاحية لتعيين الفصول.");
    }
    const selectedStudentIds = Array.from(document.querySelectorAll('.student-checkbox:checked')).map(cb => cb.dataset.studentId);
    const classId = document.getElementById('bulk-assign-class-select').value;
    if (selectedStudentIds.length === 0 || !classId) { 
        return customAlert("الرجاء تحديد الطلاب والفصل."); 
    }
    
    const { error } = await supabaseClient.from('students').update({ class_id: classId }).in('id', selectedStudentIds);
    if (error) { 
        customAlert("فشل تعيين الفصل."); 
        console.error("Error bulk assigning class:", error); 
    }
    else { 
        createNotification(`تم تعيين ${selectedStudentIds.length} طالب للفصل.`, "success"); 
        closeModal('assign-class-bulk-modal'); 
        await loadAllData(); 
    }
};

// --- DATA IMPORT/EXPORT/RESET ---

window.exportData = () => {
    if (currentUserRole !== 'admin') { return customAlert("لا تملك صلاحية لتصدير البيانات."); }

    const data = {
        students: studentsCache,
        classes: classesCache,
        settings: settingsCache,
        attendance: attendanceCache,
        plans: plansCache,
        notifications: notificationsCache,
        exams: examsCache,
        financials: financialsCache,
        expenses: expensesCache,
        version: "2.0-supabase"
    };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
    const dl = document.createElement('a');
    dl.setAttribute("href", dataStr);
    dl.setAttribute("download", `quran-app-backup-${new Date().toISOString().slice(0,10)}.json`);
    document.body.appendChild(dl);
    dl.click();
    dl.remove();
    customAlert("تم بدء تصدير البيانات.", "success");
};

window.importData = (event) => {
    if (currentUserRole !== 'admin') { return customAlert("لا تملك صلاحية لاستيراد البيانات."); }

    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const importedData = JSON.parse(e.target.result);
            customConfirm("تحذير! سيؤدي هذا إلى الكتابة فوق جميع بياناتك الحالية. هل أنت متأكد؟", async () => {
                try {
                    // This is a simplified import. A robust solution would validate data
                    // and handle conflicts more gracefully.
                    console.log("Starting data import...");
                    
                    // Clear existing data (order matters for foreign keys if they exist)
                    await supabaseClient.from('expenses').delete().neq('id', 0);
                    await supabaseClient.from('financials').delete().neq('id', 0);
                    await supabaseClient.from('attendance').delete().neq('id', 0);
                    await supabaseClient.from('exams').delete().neq('id', 0);
                    await supabaseClient.from('notifications').delete().neq('id', 0);
                    await supabaseClient.from('students').delete().neq('id', 0);
                    await supabaseClient.from('classes').delete().neq('id', 0);
                    await supabaseClient.from('plans').delete().neq('id', 0);
                    
                    // Insert new data
                    if(importedData.plans) await supabaseClient.from('plans').insert(importedData.plans);
                    if(importedData.classes) await supabaseClient.from('classes').insert(importedData.classes);
                    if(importedData.students) await supabaseClient.from('students').insert(importedData.students);
                    if(importedData.notifications) await supabaseClient.from('notifications').insert(importedData.notifications);
                    if(importedData.expenses) await supabaseClient.from('expenses').insert(importedData.expenses);
                    // ... import other tables ...
                    // Note: attendance, financials, exams have different structures now
                    // A proper import would need to transform the data from the old format.
                    
                    if(importedData.settings){
                         await supabaseClient.from('settings').upsert({ user_id: currentUser.id, settings_data: importedData.settings }, { onConflict: 'user_id' });
                    }

                    customAlert("تم استيراد البيانات بنجاح. سيتم تحديث التطبيق.", "success");
                    await loadAllData();
                } catch (err) {
                    console.error("Error importing data to Supabase:", err);
                    customAlert("فشل استيراد البيانات.", "error");
                }
            });
        } catch (err) {
            customAlert("ملف JSON غير صالح.", "error");
            console.error("Invalid JSON file:", err);
        }
    };
    reader.readAsText(file);
    event.target.value = ''; // Reset file input
};

window.resetAllData = () => {
    if (currentUserRole !== 'admin') { return customAlert("لا تملك صلاحية لمسح جميع البيانات."); }
    customConfirm("تحذير! سيتم حذف جميع البيانات بشكل دائم. هل أنت متأكد تماماً؟", async () => {
        try {
            const tablesToClear = ['expenses', 'financials', 'attendance', 'exams', 'notifications', 'students', 'classes', 'plans', 'settings'];
            for (const tableName of tablesToClear) {
                console.log(`Clearing table: ${tableName}`);
                const { error } = await supabaseClient.from(tableName).delete().neq('id', window.crypto.randomUUID()); // A trick to delete all rows
                 if(error) throw error;
            }
            customAlert("تم مسح جميع البيانات بنجاح.", "warning");
            await loadAllData();
        } catch (e) {
            console.error("Error resetting all data:", e);
            customAlert("فشل مسح جميع البيانات.");
        }
    });
};


// --- HELPER & UTILITY FUNCTIONS ---

window.createNotification = async (message, type = 'info') => {
    if (!isAuthReady || currentUserRole === 'anonymous') return;
    try {
        // Don't save system notifications
        if (type === 'system') {
            console.log(`System Notification: ${message}`);
            return;
        }
        await supabaseClient.from('notifications').insert({ message, type, user_id: currentUser.id });
        await loadAllData(); // Quick refresh to show new notification
    } catch (e) {
        console.error("Error creating notification:", e);
    }
};

window.openNotificationModal = async (id) => {
    if (!isAuthReady) return;
    const notification = notificationsCache.find(n => n.id === id);
    if (!notification) { return customAlert("لم يتم العثور على الإشعار."); }

    const notificationModalMessage = document.getElementById('notification-modal-message');
    const notificationModalDate = document.getElementById('notification-modal-date');
    if(notificationModalMessage) notificationModalMessage.textContent = notification.message;
    if(notificationModalDate) notificationModalDate.textContent = new Date(notification.created_at).toLocaleString();
    openModal('notification-details-modal');

    // Mark as read
    if (!notification.is_read) {
        const { error } = await supabaseClient.from('notifications').update({ is_read: true }).eq('id', id);
        if (error) console.error("Error marking notification as read:", error);
        else notification.is_read = true; // Update cache
        renderNotifications(); // Re-render to remove highlight
    }
};

window.markAllNotificationsAsRead = async () => {
    if (!isAuthReady) return;
    try {
        const unreadIds = notificationsCache.filter(n => !n.is_read).map(n => n.id);
        if (unreadIds.length === 0) return;

        const { error } = await supabaseClient.from('notifications').update({ is_read: true }).in('id', unreadIds);
        if (error) throw error;
        
        createNotification("تم تعليم جميع الإشعارات كمقروءة.", "info");
        await loadAllData();
    } catch (e) {
        console.error("Error marking all notifications as read:", e);
        customAlert("فشل تعليم الإشعارات كمقروءة.");
    }
}

window.updateCurrency = async () => {
    if (currentUserRole !== 'admin') { return customAlert("لا تملك صلاحية لتحديث العملة."); }
    settingsCache.currency = document.getElementById('currency-select')?.value;
    await saveSettings();
};

window.populateCountryCodes = async () => {
    const select = document.getElementById('student-country-code');
    if (!select) return;
    try {
        const response = await fetch('https://gist.githubusercontent.com/anubhavsrivastava/751b7729f6261c1a2f24/raw/70414437433989c9ba7743088665801962376841/CountryCodes.json');
        if(!response.ok) throw new Error('Failed to fetch country codes');
        const countries = await response.json();
        countries.sort((a,b) => a.name.localeCompare(b.name));
        select.innerHTML = countries.map(c => `<option value="${c.dial_code}">${c.name} (${c.dial_code})</option>`).join('');
        select.value = "+249"; // Default to Sudan
    } catch (e) {
        console.error("Could not load country codes, using a fallback list.", e);
        const codes = { "+249": "🇸🇩 Sudan", "+966": "🇸🇦 Saudi Arabia", "+20": "🇪🇬 Egypt", "+971": "🇦🇪 UAE", "+974": "🇶🇦 Qatar" };
        select.innerHTML = Object.entries(codes).map(([code, name]) => `<option value="${code}">${name}</option>`).join('');
        select.value = "+249";
    }
}

// --- Dynamic Dropdown Population ---
window.populateAllClassDropdowns = () => {
    populateClassDropdown(document.getElementById('filter-class'), 'كل الفصول');
    populateClassDropdown(document.getElementById('student-class-select'));
    populateClassDropdown(document.getElementById('tasmee-class-select'));
    populateClassDropdown(document.getElementById('attendance-class-select'));
    populateClassDropdown(document.getElementById('exam-class-select'));
    populateClassDropdown(document.getElementById('bulk-assign-class-select'));
};

window.populateClassDropdown = (select, defaultOption = "اختر فصلاً") => {
    if (!select) return;
    const val = select.value;
    select.innerHTML = `<option value="">${defaultOption}</option>`;
    classesCache.forEach(c => select.innerHTML += `<option value="${c.id}">${c.name}</option>`);
    select.value = val;
};

window.populateAllPlanDropdowns = () => {
    populatePlanDropdown(document.getElementById('student-plan-select'));
};

window.populatePlanDropdown = (select, defaultOption = "بدون خطة") => {
    if (!select) return;
    const val = select.value;
    select.innerHTML = `<option value="">${defaultOption}</option>`;
    plansCache.forEach(p => select.innerHTML += `<option value="${p.id}">${p.name}</option>`);
    select.value = val;
};

window.populateTeacherDropdowns = () => {
    const select = document.getElementById('class-teacher-select');
    if (!select) return;
    const val = select.value;
    select.innerHTML = '<option value="">اختر معلماً</option>';
    teachersCache.forEach(t => select.innerHTML += `<option value="${t.id}">${t.name}</option>`);
    select.value = val;
}

window.populateParentPortalStudentDropdown = () => {
    // In a real app, this would be populated based on the parent's linked students
    const select = document.getElementById('parent-portal-student-select');
    if (!select) return;
    select.innerHTML = '<option value="">اختر ابنك/ابنتك</option>';
    studentsCache.forEach(s => select.innerHTML += `<option value="${s.id}">${s.name}</option>`);
}


window.loadStudentsFor = (selectId, classId) => {
    const studentSelect = document.getElementById(selectId);
    if (!studentSelect) return;
    studentSelect.innerHTML = '<option value="">اختر طالباً</option>';
    if (!classId) return;
    studentsCache.filter(s => s.class_id === classId).forEach(s => studentSelect.innerHTML += `<option value="${s.id}">${s.name}</option>`);
};

// --- Modal Openers with Data Population ---
window.openStudentModal = (id = null) => {
    if (currentUserRole !== 'admin' && currentUserRole !== 'teacher') { return customAlert("لا تملك صلاحية لإدارة الطلاب."); }
    const form = document.getElementById('student-form');
    if (!form) return console.error("Student form not found.");
    form.reset();
    populateAllClassDropdowns();
    populateAllPlanDropdowns();
    
    document.getElementById('student-modal-title').textContent = id ? 'تعديل بيانات الطالب' : 'إضافة طالب جديد';
    document.getElementById('student-id').value = id || '';

    if (id) {
        const s = studentsCache.find(st => st.id === id);
        if (s) {
            document.getElementById('student-name').value = s.name || '';
            document.getElementById('student-age').value = s.age || '';
            document.getElementById('student-guardian').value = s.guardian_name || '';
            document.getElementById('student-start-date').value = s.start_date || '';
            document.getElementById('student-phone').value = s.phone || '';
            document.getElementById('student-country-code').value = s.country_code || '+249';
            document.getElementById('student-class-select').value = s.class_id || '';
            document.getElementById('student-plan-select').value = s.plan_id || '';
            document.getElementById('student-juz-start').value = s.juz_start || '';
            document.getElementById('student-notes-modal').value = s.notes || '';
        }
    }
    openModal('student-modal');
};

window.openClassModal = (id = null) => {
    if (currentUserRole !== 'admin' && currentUserRole !== 'teacher') { return customAlert("لا تملك صلاحية لإدارة الفصول."); }
    const form = document.getElementById('class-form');
    if (!form) return console.error("Class form not found.");
    form.reset();
    populateTeacherDropdowns();
    
    document.getElementById('class-modal-title').textContent = id ? 'تعديل بيانات الفصل' : 'إنشاء فصل جديد';
    document.getElementById('class-id').value = id || '';
    
    if (id) {
        const c = classesCache.find(cls => cls.id === id);
        if (c) {
            document.getElementById('class-name').value = c.name || '';
            document.getElementById('class-schedule').value = c.schedule || '';
            document.getElementById('class-fee').value = c.fee || '';
            document.getElementById('class-photo').value = c.photo || '';
            document.getElementById('class-teacher-select').value = c.teacher_id || '';
        }
    }
    openModal('class-modal');
};

window.openPlanModal = (id = null) => {
    if (currentUserRole !== 'admin' && currentUserRole !== 'teacher') { return customAlert("لا تملك صلاحية لإدارة الخطط."); }
    const form = document.getElementById('plan-form');
    if (!form) return console.error("Plan form not found.");
    form.reset();
    
    document.getElementById('plan-modal-title').textContent = id ? 'تعديل الخطة' : 'إنشاء خطة جديدة';
    document.getElementById('plan-id').value = id || '';

    if (id) {
        const p = plansCache.find(plan => plan.id === id);
        if (p) {
            document.getElementById('plan-name').value = p.name || '';
            document.getElementById('plan-description').value = p.description || '';
            document.getElementById('plan-pages-per-week').value = p.pages_per_week || '';
        }
    }
    openModal('plan-modal');
};

window.openAssignClassBulkModal = () => {
    if (currentUserRole !== 'admin' && currentUserRole !== 'teacher') { return customAlert("لا تملك صلاحية لتعيين الفصول."); }
    const selected = document.querySelectorAll('.student-checkbox:checked').length;
    if (selected === 0) { return customAlert("الرجاء تحديد طالب واحد على الأقل."); }
    openModal('assign-class-bulk-modal');
};

window.toggleAllStudentCheckboxes = (checkbox) => {
    document.querySelectorAll('.student-checkbox').forEach(cb => cb.checked = checkbox.checked);
};

// --- REPORTING ---
window.generateMonthlyReport = () => {
    if (currentUserRole !== 'admin' && currentUserRole !== 'teacher') { return customAlert("لا تملك صلاحية لإنشاء التقارير."); }
    const classId = document.getElementById('attendance-class-select').value;
    if (!classId) { return customAlert("الرجاء اختيار فصل أولاً."); }
    
    const date = new Date(document.getElementById('attendance-date').value || new Date());
    const cls = classesCache.find(c => c.id === classId);
    if (!cls) { return customAlert("الفصل المحدد غير موجود."); }

    const studentsInClass = studentsCache.filter(s => s.class_id === classId);
    const year = date.getFullYear(), month = date.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    let reportHTML = `<div id="report-content" style="font-family: Cairo, sans-serif; direction: rtl; padding: 20px;">
        <h2 style="text-align: center;">تقرير الحضور الشهري - ${cls.name}</h2>
        <h3 style="text-align: center;">شهر: ${date.toLocaleString('ar-EG', { month: 'long', year: 'numeric' })}</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
            <thead>
                <tr style="background-color: #e2e8f0;">
                    <th style="border: 1px solid #ccc; padding: 8px;">الطالب</th>`;
    for(let i = 1; i <= daysInMonth; i++) { reportHTML += `<th style="border: 1px solid #ccc; padding: 4px;">${i}</th>`; }
    reportHTML += `<th style="border: 1px solid #ccc; padding: 8px; background-color: #d1fae5;">حضور</th>
                   <th style="border: 1px solid #ccc; padding: 8px; background-color: #fee2e2;">غياب</th>
                </tr>
            </thead>
            <tbody>`;

    studentsInClass.forEach(student => {
        let presentCount = 0, absentCount = 0;
        reportHTML += `<tr><td style="border: 1px solid #ccc; padding: 8px;">${student.name}</td>`;
        for(let i = 1; i <= daysInMonth; i++) {
            const d = new Date(Date.UTC(year, month, i)).toISOString().split('T')[0];
            const status = (attendanceCache[d] || {})[student.id] || '';
            let symbol = '-';
            if (status === 'present') { symbol = '✔'; presentCount++; }
            else if (status === 'absent') { symbol = '✖'; absentCount++; }
            reportHTML += `<td style="border: 1px solid #ccc; padding: 4px; text-align: center;">${symbol}</td>`;
        }
        reportHTML += `<td style="border: 1px solid #ccc; padding: 8px; text-align: center; background-color: #f0fdf4;">${presentCount}</td>
                       <td style="border: 1px solid #ccc; padding: 8px; text-align: center; background-color: #fef2f2;">${absentCount}</td></tr>`;
    });

    reportHTML += `</tbody></table></div>`;
    
    const reportView = document.getElementById('monthly-report-view');
    if (reportView && window.html2pdf) {
        reportView.innerHTML = reportHTML;
        // Using a temporary container for PDF generation is better
        const content = document.getElementById('report-content');
        html2pdf(content, { 
            margin: 1, 
            filename: `report-${cls.name}-${month+1}-${year}.pdf`, 
            image: { type: 'jpeg', quality: 0.98 }, 
            html2canvas: { scale: 2, useCORS: true }, 
            jsPDF: { unit: 'in', format: 'a3', orientation: 'landscape' } 
        });
        customAlert("جاري إنشاء التقرير...", "info");
    } else {
        console.error("html2pdf library not found or report view element is missing.");
    }
};
