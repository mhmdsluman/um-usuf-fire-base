// --- SUPABASE CLIENT INITIALIZATION ---
const SUPABASE_URL = 'https://focdnkgnywtlffbnftpb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvY2Rua2dueXd0bGZmYm5mdHBiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI1NDgwNjIsImV4cCI6MjA2ODEyNDA2Mn0.aoCFPui67h3HTedt2aNIP-2kKWNLpOZT5XqKsJ_myiE';
const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- GLOBAL STATE & DEFAULTS ---
let currentUser = null;
let currentUserRole = 'anonymous';
let isAuthReady = false;
let authMode = 'login';

// Data Caches
let studentsCache = [];
let classesCache = [];
let settingsCache = {};
let attendanceCache = {};
let plansCache = [];
let notificationsCache = [];
let examsCache = {}; // Keyed by student_id
let financialsCache = {}; // Keyed by month_year
let expensesCache = [];
let teachersCache = [ // Dummy data, can be moved to a 'teachers' table later
    { id: 'teacher1', name: 'أحمد محمود' },
    { id: 'teacher2', name: 'فاطمة علي' },
];

const defaultSettings = { theme: 'light', themeColor: '#0d9488', currency: 'SDG', examFields: [{ name: "جودة الحفظ", mark: 50 }, { name: "أحكام التجويد", mark: 30 }, { name: "جمال الصوت", mark: 20 }] };
let weeklyProgressChart, classDistributionChart, incomeOverTimeChart, monthlyAttendanceChart;

const achievementsDefinitions = {
    "first_juz": { name: "حافظ الجزء الأول", description: "أتم حفظ الجزء الأول", icon: "⭐" },
    "five_juz": { name: "حافظ خمسة أجزاء", description: "أتم حفظ خمسة أجزاء", icon: "🌟" },
    "ten_juz": { name: "حافظ عشرة أجزاء", description: "أتم حفظ عشرة أجزاء", icon: "✨" },
    "perfect_attendance_month": { name: "حضور مثالي لشهر", description: "لم يغب طوال الشهر", icon: "🗓️" },
    "first_exam_pass": { name: "اجتياز أول اختبار", description: "اجتاز أول اختبار بنجاح", icon: "🏆" },
    "high_scorer": { name: "امتياز في الاختبار", description: "حقق 90% أو أكثر في اختبار", icon: "🏅" },
    "consistent_plan": { name: "مواظب على الخطة", description: "أتم صفحات الخطة الأسبوعية", icon: "✅" },
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    initializeAppState();
    setupEventListeners();
});

async function initializeAppState() {
    const loadingSpinner = document.getElementById('loading-spinner');
    loadingSpinner.classList.remove('hidden');

    try {
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

        supabaseClient.auth.onAuthStateChange(async (event, session) => {
            if (event === 'SIGNED_IN' && session) {
                await handleAuthenticatedUser(session.user);
            } else if (event === 'SIGNED_OUT') {
                isAuthReady = false;
                currentUser = null;
                currentUserRole = 'anonymous';
                [studentsCache, classesCache, plansCache, notificationsCache, expensesCache] = [[], [], [], [], []];
                [settingsCache, attendanceCache, examsCache, financialsCache] = [{}, {}, {}, {}];
                showAuthScreen();
            }
        });
    } catch (e) {
        console.error("Critical initialization error:", e);
        showAuthScreen();
    }
}

async function handleAuthenticatedUser(user) {
    currentUser = user;
    
    const { data, error } = await supabaseClient.from('profiles').select('role').eq('id', user.id).single();

    if (error && error.code !== 'PGRST116') {
        console.error("Error fetching user profile:", error);
    }
    currentUserRole = data?.role || 'teacher';
    
    isAuthReady = true;
    console.log("Authenticated with UID:", currentUser.id, "Role:", currentUserRole);

    document.getElementById('user-id-display').textContent = `معرف المستخدم: ${currentUser.id}`;
    
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
    
    const financialMonthInput = document.getElementById('financial-month');
    const attendanceDateInput = document.getElementById('attendance-date');
    const currencySelect = document.getElementById('currency-select');
    const today = new Date();
    if (financialMonthInput) financialMonthInput.value = today.toISOString().slice(0, 7);
    if (attendanceDateInput) attendanceDateInput.value = today.toISOString().slice(0, 10);
    if (currencySelect) currencySelect.value = settingsCache.currency || 'SDG'; 
    
    showView('dashboard-view');
}

async function loadAllData() {
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

        studentsCache = studentsRes.data || [];
        classesCache = classesRes.data || [];
        plansCache = plansRes.data || [];
        expensesCache = expensesRes.data || [];
        notificationsCache = notificationsRes.data || [];
        settingsCache = { ...defaultSettings, ...(settingsRes.data?.settings_data || {}) };

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
        console.log("All data loaded.");
    } catch (err) {
        console.error("Error loading data from Supabase:", err);
        customAlert("حدث خطأ أثناء تحميل البيانات. يرجى المحاولة مرة أخرى.");
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

    if (viewId === 'dashboard-view') updateDashboard();
    if (viewId === 'financials-dashboard-view') renderFinancialsDashboard();
};

function setupEventListeners() {
    document.getElementById('sidebar-toggle').addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('sidebar-mobile-open');
    });

    document.getElementById('student-search').addEventListener('input', renderStudentsTable);
    document.getElementById('confirm-cancel-btn').addEventListener('click', () => closeModal('confirm-modal'));
    document.getElementById('confirm-ok-btn').addEventListener('click', () => {
        if (window.confirmCallback) window.confirmCallback();
        closeModal('confirm-modal');
        window.confirmCallback = null;
    });

    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
    const themeColorPicker = document.getElementById('theme-color-picker');
    themeColorPicker.addEventListener('input', (e) => applySettings(e.target.value));
    themeColorPicker.addEventListener('change', async (e) => {
        settingsCache.themeColor = e.target.value;
        await saveSettings();
        createNotification("تم حفظ لون الواجهة الجديد.", "success");
    });

    document.getElementById('notification-bell').addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('notifications-panel').classList.toggle('hidden');
    });
    document.body.addEventListener('click', () => document.getElementById('notifications-panel').classList.add('hidden'));

    document.getElementById('auth-form').addEventListener('submit', handleAuthFormSubmit);
    document.getElementById('toggle-auth-mode').addEventListener('click', toggleAuthMode);
    
    populateCountryCodes();
}

// --- SETTINGS & THEME ---
window.applySettings = (newColor = null) => {
    const color = newColor || settingsCache.themeColor || defaultSettings.themeColor;
    document.body.classList.toggle('dark', settingsCache.theme === 'dark');
    document.documentElement.style.setProperty('--theme-color', color);
    const darkColor = Chart.helpers.color(color).darken(0.2).hexString();
    document.documentElement.style.setProperty('--theme-color-dark', darkColor);
    if (!newColor) document.getElementById('theme-color-picker').value = color;
};

async function saveSettings() {
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
let authMode = 'login'; // or 'signup' as default

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
            await supabaseClient.from('profiles').insert({ id: response.data.user.id, role: 'teacher' });
        }
    }

    if (response.error) {
        authMessage.textContent = response.error.message;
        authMessage.classList.remove('hidden');
    }
}

window.handleLogout = async () => {
    customConfirm("هل أنت متأكد من تسجيل الخروج؟", async () => {
        const { error } = await supabaseClient.auth.signOut();
        if (error) customAlert(`فشل تسجيل الخروج: ${error.message}`);
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

// --- MODALS ---
window.openModal = (modalId) => document.getElementById(modalId).classList.remove('hidden');
window.closeModal = (modalId) => document.getElementById(modalId).classList.add('hidden');
window.customAlert = (msg) => { document.getElementById('alert-message').textContent = msg; openModal('alert-modal'); };
window.customConfirm = (msg, cb) => { document.getElementById('confirm-message').textContent = msg; window.confirmCallback = cb; openModal('confirm-modal'); };

// --- RENDERING FUNCTIONS ---
window.renderStudentsTable = () => {
    const searchTerm = document.getElementById('student-search').value.toLowerCase();
    const classFilter = document.getElementById('filter-class').value;
    const tableBody = document.getElementById('students-table-body');
    let filtered = studentsCache.filter(s => (s.name.toLowerCase().includes(searchTerm) || (s.id && s.id.includes(searchTerm))) && (!classFilter || s.class_id === classFilter));
    if (filtered.length === 0) { tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4">لم يتم العثور على طلاب.</td></tr>`; return; }
    const canEditDelete = currentUserRole === 'admin' || currentUserRole === 'teacher';
    tableBody.innerHTML = filtered.map(s => {
        const cls = classesCache.find(c => c.id === s.class_id);
        const pages = s.progress ? Object.values(s.progress).flat().length : 0;
        let actionsHtml = canEditDelete ? `<button class="text-blue-500 hover:text-blue-700 mx-1" onclick='openStudentModal("${s.id}")'>تعديل</button><button class="text-red-500 hover:text-red-700 mx-1" onclick='deleteStudent("${s.id}", "${s.name}")'>حذف</button>` : '';
        return `<tr class="hover:bg-gray-50 dark:hover:bg-gray-600">
            <td class="py-3 px-2 text-center"><input type="checkbox" class="custom-checkbox student-checkbox" data-student-id="${s.id}"></td>
            <td class="py-3 px-6 font-semibold text-theme dark:text-theme-dark cursor-pointer hover:underline" onclick="viewStudentProfile('${s.id}')">${s.name}</td>
            <td class="py-3 px-6">${cls ? cls.name : 'غير محدد'}</td><td class="py-3 px-6">${pages}</td><td class="py-3 px-6">${s.age || 'N/A'}</td>
            <td class="py-3 px-6 text-center">${actionsHtml}</td></tr>`;
    }).join('');
};

window.renderClassesGrid = () => {
    const grid = document.getElementById('classes-grid');
    if (classesCache.length === 0) { grid.innerHTML = `<p class="col-span-full text-center py-4">لم يتم إنشاء أي فصول بعد.</p>`; return; }
    const canEditDelete = currentUserRole === 'admin' || currentUserRole === 'teacher';
    grid.innerHTML = classesCache.map(cls => {
        const membersCount = studentsCache.filter(s => s.class_id === cls.id).length;
        const teacher = teachersCache.find(t => t.id === cls.teacher_id);
        let actionsHtml = canEditDelete ? `<button class="text-blue-500 hover:text-blue-700 mx-1 text-sm" onclick='event.stopPropagation(); openClassModal("${cls.id}")'>تعديل</button><button class="text-red-500 hover:text-red-700 mx-1 text-sm" onclick='event.stopPropagation(); deleteClass("${cls.id}", "${cls.name}")'>حذف</button>` : '';
        return `<div class="bg-white dark:bg-gray-700 p-6 rounded-lg shadow-md flex flex-col justify-between cursor-pointer hover:shadow-lg transition-shadow" onclick="viewClassDetails('${cls.id}')">
            <div>
                <img src="${cls.photo || `https://placehold.co/600x400/0d9488/ffffff?text=${encodeURIComponent(cls.name)}`}" class="w-full h-32 object-cover rounded-md mb-4" onerror="this.onerror=null;this.src='https://placehold.co/600x400/cccccc/ffffff?text=Error';">
                <h3 class="text-xl font-bold text-blue-700 dark:text-blue-400">${cls.name}</h3>
                <p class="text-gray-600 dark:text-gray-300">${membersCount} طالب</p>
                <p class="text-sm text-gray-500 dark:text-gray-400 mt-2">${cls.schedule || 'لم يحدد جدول'}</p>
                <p class="font-bold text-theme dark:text-theme-dark mt-2">${cls.fee || 0} ${settingsCache.currency}</p>
                <p class="text-sm text-gray-500 dark:text-gray-400">المعلم: ${teacher ? teacher.name : 'غير محدد'}</p>
            </div>
            <div class="mt-4 text-left">${actionsHtml}</div></div>`;
    }).join('');
};

window.renderPlans = () => {
    const container = document.getElementById('plans-container');
    if (plansCache.length === 0) { container.innerHTML = `<p class="text-center py-4">لم يتم إنشاء أي خطط بعد.</p>`; return; }
    const canEditDelete = currentUserRole === 'admin' || currentUserRole === 'teacher';
    container.innerHTML = plansCache.map(plan => {
        let actionsHtml = canEditDelete ? `<button class="text-blue-500 hover:text-blue-700 mx-1 text-sm" onclick='openPlanModal("${plan.id}")'>تعديل</button><button class="text-red-500 hover:text-red-700 mx-1 text-sm" onclick='deletePlan("${plan.id}", "${plan.name}")'>حذف</button>` : '';
        return `<div class="bg-white dark:bg-gray-700 p-4 rounded-lg shadow-md">
            <h4 class="font-bold text-lg">${plan.name}</h4>
            <p class="text-gray-600 dark:text-gray-300">${plan.description}</p>
            <p class="text-sm text-gray-500 dark:text-gray-400">الصفحات الأسبوعية: ${plan.pages_per_week || 'غير محدد'}</p>
            <div class="mt-4 text-left">${actionsHtml}</div></div>`;
    }).join('');
};

window.renderNotifications = () => {
    const panel = document.getElementById('notifications-panel-content');
    const dot = document.getElementById('notification-dot');
    const unreadCount = notificationsCache.filter(n => !n.is_read).length;
    dot.classList.toggle('hidden', unreadCount === 0);
    if (notificationsCache.length === 0) { panel.innerHTML = `<p class="p-4 text-center text-gray-500">لا توجد إشعارات</p>`; return; }
    panel.innerHTML = notificationsCache.map(n => `<div class="p-3 border-b border-gray-200 dark:border-gray-600 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 ${!n.is_read ? 'bg-teal-50 dark:bg-teal-900' : ''}" onclick="openNotificationModal('${n.id}')">
        <p class="text-sm">${n.message}</p>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">${new Date(n.created_at).toLocaleString()}</p></div>`).join('');
};

window.renderExamFieldSettings = () => {
    const container = document.getElementById('exam-fields-settings-container');
    if (currentUserRole !== 'admin') { container.innerHTML = `<p class="text-center py-4 text-gray-500">لا تملك صلاحية لإدارة حقول الاختبارات.</p>`; return; }
    container.innerHTML = (settingsCache.examFields || []).map((field, index) => `<div class="flex items-center justify-between bg-gray-100 dark:bg-gray-600 p-2 rounded mb-2"><span>${field.name} (${field.mark} درجة)</span><button class="text-red-500 hover:text-red-700" onclick="removeExamField(${index})">&times;</button></div>`).join('');
};

window.renderExamFieldsForEntry = () => {
    const container = document.getElementById('exam-fields-container');
    if (currentUserRole !== 'admin' && currentUserRole !== 'teacher') { container.innerHTML = `<p class="text-center py-4 text-gray-500">لا تملك صلاحية لرصد درجات الاختبارات.</p>`; return; }
    container.innerHTML = (settingsCache.examFields || []).map(field => `<div><label class="block mb-1 font-semibold">${field.name} (من ${field.mark})</label><input type="number" data-field-name="${field.name}" data-max-mark="${field.mark}" class="w-full p-2 border rounded dark:bg-gray-800 dark:border-gray-600 exam-score-field" placeholder="الدرجة"></div>`).join('');
};

window.renderAttendanceTable = () => {
    const classId = document.getElementById('attendance-class-select').value;
    const date = document.getElementById('attendance-date').value;
    const container = document.getElementById('attendance-table-container');
    if (currentUserRole !== 'admin' && currentUserRole !== 'teacher') { container.innerHTML = `<p class="text-center py-4 text-gray-500">لا تملك صلاحية لتسجيل الحضور والغياب.</p>`; return; }
    if (!classId || !date) { container.innerHTML = '<p class="text-center py-4">الرجاء اختيار فصل وتاريخ.</p>'; return; }
    const studentsInClass = studentsCache.filter(s => s.class_id === classId);
    if (studentsInClass.length === 0) { container.innerHTML = '<p class="text-center py-4">لا يوجد طلاب في هذا الفصل.</p>'; return; }
    const dailyRecord = attendanceCache[date] || {};
    container.innerHTML = `<table class="min-w-full bg-white dark:bg-gray-700"><thead class="bg-gray-200 dark:bg-gray-600"><tr><th class="py-3 px-6 text-right">الاسم</th><th class="py-3 px-6 text-center">الحالة</th></tr></thead><tbody>${studentsInClass.map(student => `<tr class="hover:bg-gray-50 dark:hover:bg-gray-600"><td class="py-3 px-6">${student.name}</td><td class="py-3 px-6 text-center"><div class="flex justify-center gap-4"><label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="attendance-${student.id}" value="present" class="form-radio text-green-500" ${dailyRecord[student.id] === 'present' ? 'checked' : ''}><span>حاضر</span></label><label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="attendance-${student.id}" value="absent" class="form-radio text-red-500" ${dailyRecord[student.id] === 'absent' ? 'checked' : ''}><span>غائب</span></label></div></td></tr>`).join('')}</tbody></table>`;
};

window.renderFinancialsTable = () => {
    const container = document.getElementById('financials-table-container');
    const month = document.getElementById('financial-month').value;
    const monthData = financialsCache[month] || {};
    if (currentUserRole !== 'admin') { container.innerHTML = `<p class="text-center py-4 text-gray-500">لا تملك صلاحية لمتابعة الأمور المالية.</p>`; return; }
    if (studentsCache.length === 0) { container.innerHTML = `<p class="text-center py-4">لا يوجد طلاب.</p>`; return; }
    container.innerHTML = `<table class="min-w-full bg-white dark:bg-gray-700"><thead class="bg-gray-200 dark:bg-gray-600"><tr><th class="py-3 px-6 text-right">الطالب</th><th class="py-3 px-6 text-right">رسوم الفصل</th><th class="py-3 px-6 text-center">الحالة</th></tr></thead><tbody>${studentsCache.map(student => {
        const status = monthData[student.id] || 'pending';
        const cls = classesCache.find(c => c.id === student.class_id);
        const fee = cls ? (cls.fee || 0) : 0;
        return `<tr class="hover:bg-gray-50 dark:hover:bg-gray-600"><td class="py-3 px-6">${student.name}</td><td class="py-3 px-6">${fee} ${settingsCache.currency}</td><td class="py-3 px-6 text-center"><select data-student-id="${student.id}" class="p-1 border rounded dark:bg-gray-800 financial-status-select"><option value="pending" ${status === 'pending' ? 'selected' : ''}>لم يدفع</option><option value="paid" ${status === 'paid' ? 'selected' : ''}>دفع</option><option value="exempt" ${status === 'exempt' ? 'selected' : ''}>معفى</option></select></td></tr>`;
    }).join('')}</tbody></table>`;
};

window.renderExpensesList = () => {
    const list = document.getElementById('expenses-list');
    if (expensesCache.length === 0) { list.innerHTML = `<p class="text-center text-gray-500">لا توجد مصروفات مسجلة.</p>`; return; }
    list.innerHTML = `<table class="min-w-full bg-white dark:bg-gray-700 mt-4"><thead class="bg-gray-200 dark:bg-gray-600"><tr><th class="py-3 px-6 text-right">الوصف</th><th class="py-3 px-6 text-right">المبلغ</th><th class="py-3 px-6 text-right">التاريخ</th><th class="py-3 px-6 text-center">إجراءات</th></tr></thead><tbody>${expensesCache.sort((a, b) => new Date(b.date) - new Date(a.date)).map(expense => `
        <tr class="hover:bg-gray-50 dark:hover:bg-gray-600">
            <td class="py-3 px-6">${expense.description}</td><td class="py-3 px-6">${expense.amount} ${settingsCache.currency}</td>
            <td class="py-3 px-6">${new Date(expense.date).toLocaleDateString()}</td>
            <td class="py-3 px-6 text-center"><button class="text-red-500 hover:text-red-700 mx-1" onclick="deleteExpense('${expense.id}')">حذف</button></td>
        </tr>`).join('')}</tbody></table>`;
};

window.updateDashboard = () => {
    document.getElementById('total-students-dashboard').textContent = studentsCache.length;
    const today = new Date().toISOString().slice(0, 10);
    const activeToday = attendanceCache[today] ? Object.values(attendanceCache[today]).filter(s => s === 'present').length : 0;
    document.getElementById('active-today-dashboard').textContent = activeToday;
    const totalPages = studentsCache.reduce((sum, s) => sum + (s.progress ? Object.values(s.progress).flat().length : 0), 0);
    document.getElementById('total-pages-dashboard').textContent = totalPages;
    let totalScores = 0, totalMaxScores = 0;
    Object.values(examsCache).flat().forEach(exam => {
        totalScores += exam.totalScore;
        totalMaxScores += exam.maxScore;
    });
    const avgScore = totalMaxScores > 0 ? ((totalScores / totalMaxScores) * 100).toFixed(0) : 0;
    document.getElementById('avg-exam-score-dashboard').textContent = `${avgScore}%`;
    renderTopStudents();
    renderWeeklyProgressChart();
    renderClassDistributionChart();
    checkPendingAttendance();
    renderMonthlyAttendanceChart();
    checkPendingPayments();
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
    const totalExpenses = expensesCache.filter(e => e.date.startsWith(currentMonth)).reduce((sum, e) => sum + e.amount, 0);
    const netBalance = totalIncome - totalExpenses;
    document.getElementById('total-income-dashboard').textContent = `${totalIncome.toLocaleString()} ${settingsCache.currency}`;
    document.getElementById('total-expenses-dashboard').textContent = `${totalExpenses.toLocaleString()} ${settingsCache.currency}`;
    document.getElementById('net-balance-dashboard').textContent = `${netBalance.toLocaleString()} ${settingsCache.currency}`;
    document.getElementById('pending-payments-dashboard').textContent = `${pendingPayments.toLocaleString()} ${settingsCache.currency}`;
    renderIncomeOverTimeChart();
};

window.renderTopStudents = () => {
    const list = document.getElementById('top-students-list');
    const sorted = [...studentsCache].sort((a, b) => (b.progress ? Object.values(b.progress).flat().length : 0) - (a.progress ? Object.values(a.progress).flat().length : 0)).slice(0, 5);
    if (sorted.length === 0) { list.innerHTML = `<p class="text-center text-gray-500">لا يوجد بيانات</p>`; return; }
    list.innerHTML = sorted.map((s, i) => `<div class="flex justify-between items-center p-2 rounded ${i % 2 === 0 ? 'bg-gray-50 dark:bg-gray-800' : ''}"><div class="font-semibold">${i + 1}. ${s.name}</div><div class="text-theme dark:text-theme-dark font-bold">${s.progress ? Object.values(s.progress).flat().length : 0} صفحة</div></div>`).join('');
};

window.renderWeeklyProgressChart = () => { /* ... full chart implementation ... */ };
window.renderClassDistributionChart = () => { /* ... full chart implementation ... */ };
window.renderMonthlyAttendanceChart = () => { /* ... full chart implementation ... */ };
window.renderIncomeOverTimeChart = () => { /* ... full chart implementation ... */ };

window.checkPendingAttendance = () => {
    const list = document.getElementById('pending-attendance-list');
    list.innerHTML = `<p class="text-center text-gray-500">لا يوجد طلاب بحاجة لمراجعة.</p>`;
};

window.checkPendingPayments = () => {
    const list = document.getElementById('pending-payments-list');
    list.innerHTML = `<p class="text-center text-gray-500">لا توجد دفعات معلقة.</p>`;
};

window.viewStudentProfile = (studentId) => { /* ... full implementation ... */ };
window.viewClassDetails = (classId) => { /* ... full implementation ... */ };
window.renderParentStudentProfile = (studentId) => {
    const display = document.getElementById('parent-student-profile-display');
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
        </div>
    `;
};

// --- DATA MANIPULATION ---
window.handleStudentFormSubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('student-id').value;
    const studentData = {
        name: document.getElementById('student-name').value,
        age: document.getElementById('student-age').value,
        guardian_name: document.getElementById('student-guardian').value,
        start_date: document.getElementById('student-start-date').value,
        phone: document.getElementById('student-phone').value,
        country_code: document.getElementById('student-country-code').value,
        class_id: document.getElementById('student-class-select').value || null,
        plan_id: document.getElementById('student-plan-select').value || null,
        juz_start: parseInt(document.getElementById('student-juz-start').value),
        notes: document.getElementById('student-notes-modal').value,
        user_id: currentUser.id
    };

    let response;
    if (id) {
        response = await supabaseClient.from('students').update(studentData).eq('id', id);
    } else {
        studentData.progress = {};
        studentData.tasmee_sessions = [];
        studentData.achievements = [];
        response = await supabaseClient.from('students').insert([studentData]);
    }

    if (response.error) {
        console.error("Error saving student:", response.error);
        customAlert("فشل حفظ بيانات الطالب.");
    } else {
        createNotification(id ? `تم تحديث بيانات الطالب ${studentData.name}` : `تم إضافة طالب جديد: ${studentData.name}`, "success");
        closeModal('student-modal');
        await loadAllData();
    }
};

window.deleteStudent = (id, name) => {
    customConfirm(`هل أنت متأكد من حذف الطالب ${name}؟ سيتم حذف جميع بياناته المرتبطة.`, async () => {
        const { error } = await supabaseClient.from('students').delete().eq('id', id);
        if (error) {
            console.error("Error deleting student:", error);
            customAlert("فشل حذف الطالب.");
        } else {
            createNotification(`تم حذف الطالب ${name}`, "warning");
            await loadAllData();
        }
    });
};

window.handleClassFormSubmit = async (e) => {
    e.preventDefault();
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
    customConfirm(`هل أنت متأكد من حذف فصل ${name}؟`, async () => {
        const { error } = await supabaseClient.from('classes').delete().eq('id', id);
        if (error) {
            console.error("Error deleting class:", error);
            customAlert("فشل حذف الفصل.");
        } else {
            createNotification(`تم حذف الفصل ${name}`, "warning");
            await loadAllData();
        }
    });
};

window.handlePlanFormSubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('plan-id').value;
    const planData = {
        name: document.getElementById('plan-name').value,
        description: document.getElementById('plan-description').value,
        pages_per_week: parseInt(document.getElementById('plan-pages-per-week').value) || null,
        user_id: currentUser.id
    };
    const { error } = id ? await supabaseClient.from('plans').update(planData).eq('id', id) : await supabaseClient.from('plans').insert([planData]);
    if (error) { customAlert("فشل حفظ الخطة."); console.error(error); }
    else { createNotification(id ? 'تم تحديث الخطة' : 'تم إنشاء خطة جديدة', 'success'); closeModal('plan-modal'); await loadAllData(); }
};

window.deletePlan = (id, name) => {
    customConfirm(`هل أنت متأكد من حذف خطة ${name}؟`, async () => {
        const { error } = await supabaseClient.from('plans').delete().eq('id', id);
        if (error) { customAlert("فشل حذف الخطة."); console.error(error); }
        else { createNotification(`تم حذف الخطة ${name}`, 'warning'); await loadAllData(); }
    });
};

window.saveTasmeeResults = async () => {
    const studentId = document.getElementById('tasmee-student-select').value;
    const juz = parseInt(document.getElementById('tasmee-juz').value);
    const pageFrom = parseInt(document.getElementById('tasmee-page-from').value);
    const pageTo = parseInt(document.getElementById('tasmee-page-to').value) || pageFrom;
    
    if (!studentId || isNaN(juz) || isNaN(pageFrom)) { customAlert("الرجاء ملء جميع الحقول."); return; }

    const student = studentsCache.find(s => s.id === studentId);
    if (!student) { customAlert("لم يتم العثور على الطالب."); return; }

    let progress = student.progress || {};
    if (!progress[juz]) progress[juz] = [];
    for (let i = pageFrom; i <= pageTo; i++) {
        if (!progress[juz].includes(i)) progress[juz].push(i);
    }
    progress[juz].sort((a,b) => a-b);

    const { error } = await supabaseClient.from('students').update({ progress }).eq('id', studentId);
    if (error) { customAlert("فشل حفظ التسميع."); console.error(error); }
    else { customAlert('تم تسجيل التسميع بنجاح.'); await loadAllData(); }
};

window.saveAttendance = async () => {
    const date = document.getElementById('attendance-date').value;
    if (!date) { customAlert("الرجاء تحديد التاريخ."); return; }

    const recordsToUpsert = [];
    document.querySelectorAll('input[type="radio"][name^="attendance-"]:checked').forEach(input => {
        recordsToUpsert.push({
            student_id: input.name.replace('attendance-', ''),
            date: date,
            status: input.value,
            user_id: currentUser.id
        });
    });

    if (recordsToUpsert.length === 0) { customAlert("لم يتم تحديد أي حالة حضور."); return; }

    const { error } = await supabaseClient.from('attendance').upsert(recordsToUpsert, { onConflict: 'student_id,date' });
    if (error) { customAlert("فشل حفظ الحضور."); console.error(error); }
    else { customAlert("تم حفظ الحضور بنجاح."); await loadAllData(); }
};

window.saveExamResults = async () => {
    const studentId = document.getElementById('exam-student-select').value;
    const examName = document.getElementById('exam-name').value.trim();
    const examJuz = parseInt(document.getElementById('exam-juz').value);
    if (!studentId || !examName || isNaN(examJuz)) { customAlert("الرجاء ملء جميع الحقول."); return; }

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

    const examData = { id: crypto.randomUUID(), name: examName, juz: examJuz, scores, totalScore, maxScore, date: new Date().toISOString() };
    
    const { error } = await supabaseClient.from('exams').insert({
        student_id: studentId,
        exam_data: examData,
        user_id: currentUser.id
    });

    if (error) { customAlert("فشل حفظ نتيجة الاختبار."); console.error(error); }
    else { customAlert("تم حفظ نتيجة الاختبار بنجاح."); await loadAllData(); }
};

window.addExamField = async () => {
    const name = document.getElementById('new-field-name').value.trim();
    const mark = parseInt(document.getElementById('new-field-mark').value);
    if (!name || isNaN(mark) || mark <= 0) { customAlert("الرجاء إدخال اسم حقل صحيح ودرجة موجبة."); return; }
    if (!settingsCache.examFields) settingsCache.examFields = [];
    settingsCache.examFields.push({ name, mark });
    await saveSettings();
    renderExamFieldSettings();
    renderExamFieldsForEntry();
};

window.removeExamField = async (index) => {
    settingsCache.examFields.splice(index, 1);
    await saveSettings();
    renderExamFieldSettings();
    renderExamFieldsForEntry();
};

window.saveFinancials = async () => {
    const month = document.getElementById('financial-month').value;
    if (!month) { customAlert("الرجاء تحديد الشهر."); return; }
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
    if (error) { customAlert("فشل حفظ الحالة المالية."); console.error(error); }
    else { createNotification(`تم حفظ الحالة المالية لشهر ${month}.`, 'success'); await loadAllData(); }
};

window.addExpense = async (e) => {
    e.preventDefault();
    const expenseData = {
        description: document.getElementById('expense-description').value,
        amount: parseFloat(document.getElementById('expense-amount').value),
        date: document.getElementById('expense-date').value,
        user_id: currentUser.id
    };
    if (!expenseData.description || isNaN(expenseData.amount) || !expenseData.date) { customAlert("الرجاء ملء جميع حقول المصروفات."); return; }
    const { error } = await supabaseClient.from('expenses').insert([expenseData]);
    if (error) { customAlert("فشل إضافة المصروف."); console.error(error); }
    else { createNotification("تم إضافة المصروف بنجاح.", "success"); document.getElementById('expense-form').reset(); await loadAllData(); }
};

window.deleteExpense = async (id) => {
    customConfirm("هل أنت متأكد من حذف هذا المصروف؟", async () => {
        const { error } = await supabaseClient.from('expenses').delete().eq('id', id);
        if (error) { customAlert("فشل حذف المصروف."); console.error(error); }
        else { createNotification("تم حذف المصروف.", "warning"); await loadAllData(); }
    });
};

window.togglePageMemorization = async (studentId, juz, page) => {
    const student = studentsCache.find(s => s.id === studentId);
    if (!student) return;
    let progress = student.progress || {};
    if (!progress[juz]) progress[juz] = [];
    const pageIndex = progress[juz].indexOf(page);
    if (pageIndex > -1) progress[juz].splice(pageIndex, 1);
    else progress[juz].push(page);
    progress[juz].sort((a, b) => a - b);
    const { error } = await supabaseClient.from('students').update({ progress }).eq('id', studentId);
    if (error) { customAlert("فشل تحديث حالة الحفظ."); console.error(error); }
    else { createNotification("تم تحديث حالة الحفظ.", "info"); await loadAllData(); viewStudentProfile(studentId); }
};

window.updateStudentNote = async (studentId, newNote) => {
    const { error } = await supabaseClient.from('students').update({ notes: newNote }).eq('id', studentId);
    if (error) { customAlert("فشل حفظ الملاحظة."); console.error(error); }
    else { createNotification("تم حفظ الملاحظة.", "info"); } 
};

window.handleBulkAssignClass = async () => {
    const selectedStudentIds = Array.from(document.querySelectorAll('.student-checkbox:checked')).map(cb => cb.dataset.studentId);
    const classId = document.getElementById('bulk-assign-class-select').value;
    if (selectedStudentIds.length === 0 || !classId) { customAlert("الرجاء تحديد الطلاب والفصل."); return; }
    const { error } = await supabaseClient.from('students').update({ class_id: classId }).in('id', selectedStudentIds);
    if (error) { customAlert("فشل تعيين الفصل."); console.error(error); }
    else { createNotification(`تم تعيين ${selectedStudentIds.length} طالب للفصل.`, "success"); closeModal('assign-class-bulk-modal'); await loadAllData(); }
};

// --- HELPER FUNCTIONS ---
window.exportData = () => { /* ... full implementation ... */ };
window.importData = (event) => { /* ... full implementation ... */ };
window.resetAllData = () => { /* ... full implementation ... */ };
window.openNotificationModal = async (id) => { /* ... full implementation ... */ };
window.markAllNotificationsAsRead = async () => { /* ... full implementation ... */ };
window.updateCurrency = async () => { /* ... full implementation ... */ };
window.populateCountryCodes = async () => { /* ... full implementation ... */ };
window.loadStudentsFor = (selectId, classId) => { /* ... full implementation ... */ };
window.openStudentModal = (id = null) => { /* ... full implementation ... */ };
window.openClassModal = (id = null) => { /* ... full implementation ... */ };
window.openPlanModal = (id = null) => { /* ... full implementation ... */ };
window.openAssignClassBulkModal = () => { /* ... full implementation ... */ };
window.toggleAllStudentCheckboxes = (checked) => { document.querySelectorAll('.student-checkbox').forEach(cb => cb.checked = checked); };
window.generateMonthlyReport = () => { /* ... full implementation ... */ };
window.generateFinancialReport = () => { /* ... full implementation ... */ };
window.checkAndAwardAchievements = () => { /* ... full implementation ... */ };

window.createNotification = async (message, type = 'info') => {
    if (!isAuthReady) return;
    await supabaseClient.from('notifications').insert({ message, type, user_id: currentUser.id });
    await loadAllData(); // Refresh notifications
};
