const API_BASE_URL = 'https://saku-sloth.vercel.app/api';
const TRANSACTIONS_URL = `${API_BASE_URL}/transactions`;
const BUDGETS_URL = `${API_BASE_URL}/budgets`;
const SAVINGS_GOALS_URL = `${API_BASE_URL}/savings-goals`;
const AUTH_CONFIG_URL = `${API_BASE_URL}/auth/config`;
const AUTH_SESSION_URL = `${API_BASE_URL}/auth/session`;
const VISIBLE_TRANSACTION_LIMIT = 5;
const CATEGORY_COLORS = ['#a9df71', '#f0a096', '#91a8d0', '#e6c46b', '#ba9dd4', '#78c9b7', '#e79a5a'];

const elements = {
    balance: document.getElementById('balanceValue'),
    balanceCaption: document.getElementById('balanceCaption'),
    income: document.getElementById('incomeValue'),
    expense: document.getElementById('expenseValue'),
    incomeCount: document.getElementById('incomeCount'),
    expenseCount: document.getElementById('expenseCount'),
    incomeBar: document.getElementById('incomeBar'),
    expenseBar: document.getElementById('expenseBar'),
    incomePercent: document.getElementById('incomePercent'),
    expensePercent: document.getElementById('expensePercent'),
    flowTotal: document.getElementById('flowTotal'),
    flowPeriod: document.getElementById('flowPeriod'),
    healthNote: document.getElementById('healthNote'),
    categoryDonut: document.getElementById('categoryDonut'),
    categoryLegend: document.getElementById('categoryLegend'),
    categoryTotal: document.getElementById('categoryTotal'),
    transactionList: document.getElementById('transactionList'),
    emptyState: document.getElementById('emptyState'),
    listStatus: document.getElementById('listStatus'),
    monthFilter: document.getElementById('monthFilter'),
    search: document.getElementById('transactionSearch'),
    typeFilter: document.getElementById('transactionTypeFilter'),
    categoryFilter: document.getElementById('transactionCategoryFilter'),
    sort: document.getElementById('transactionSort'),
    trendChart: document.getElementById('trendChart'),
    trendPeriod: document.getElementById('trendPeriod'),
    trendCaption: document.getElementById('trendCaption'),
    budgetForm: document.getElementById('budgetForm'),
    budgetCategory: document.getElementById('budgetCategory'),
    budgetLimit: document.getElementById('budgetLimit'),
    budgetList: document.getElementById('budgetList'),
    budgetPeriod: document.getElementById('budgetPeriod'),
    categoryOptions: document.getElementById('transactionCategories'),
    goalForm: document.getElementById('goalForm'),
    goalList: document.getElementById('goalList'),
    analysisButton: document.getElementById('runFinancialAnalysis'),
    analysisResult: document.getElementById('analysisResult'),
    appShell: document.querySelector('.app-shell'),
    authScreen: document.getElementById('authScreen'),
    authStatus: document.getElementById('authStatus'),
    googleSignInButton: document.getElementById('googleSignInButton'),
    accountActions: document.getElementById('accountActions'),
    accountName: document.getElementById('accountName'),
    accountAvatar: document.getElementById('accountAvatar'),
    notice: document.getElementById('notice'),
    dialog: document.getElementById('transactionDialog'),
    form: document.getElementById('transactionForm'),
    formError: document.getElementById('formError'),
    saveButton: document.getElementById('saveTransaction')
};

let transactions = [];
let monthlyBudgets = [];
let savingsGoals = [];
let googleIdToken = null;
let signedInUser = null;
let authGeneration = 0;
let showAllTransactions = false;
let noticeTimeout;

async function apiFetch(url, options = {}) {
    if (!googleIdToken) throw new Error('Silakan masuk dengan akun Google terlebih dahulu.');
    const requestGeneration = authGeneration;
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${googleIdToken}`);
    const response = await fetch(url, { ...options, headers });
    if (requestGeneration !== authGeneration) {
        const error = new Error('Sesi login sudah berubah.');
        error.name = 'AbortError';
        throw error;
    }
    if (response.status === 401) signOut(false);
    return response;
}

const currencyFormatter = new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
});

const dateFormatter = new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
});

function localMonthValue(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatCurrency(amount) {
    return currencyFormatter.format(Number.isFinite(amount) ? amount : 0);
}

function formatTransactionDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Tanggal tidak tersedia';
    return `${dateFormatter.format(date)} · ${new Intl.DateTimeFormat('id-ID', {
        hour: '2-digit',
        minute: '2-digit'
    }).format(date)}`;
}

function getCategoryIcon(category, type) {
    if (type === 'income') return { name: 'arrow-down-left', tone: 'income' };

    const normalized = String(category || '').toLocaleLowerCase('id-ID');
    if (/makan|minum|kuliner|resto/.test(normalized)) return { name: 'utensils', tone: 'food' };
    if (/transport|bensin|kendaraan|ojek/.test(normalized)) return { name: 'car-front', tone: 'transport' };
    if (/belanja|shop|lifestyle/.test(normalized)) return { name: 'shopping-bag', tone: 'shopping' };
    if (/tagihan|listrik|utilitas/.test(normalized)) return { name: 'zap', tone: 'bills' };
    if (/kesehatan|obat|medis/.test(normalized)) return { name: 'heart-pulse', tone: 'health' };
    if (/gaji|salary|kerja/.test(normalized)) return { name: 'briefcase-business', tone: 'income' };
    if (/rumah|sewa|hunian/.test(normalized)) return { name: 'house', tone: 'home' };
    if (/langganan|digital|internet/.test(normalized)) return { name: 'monitor-play', tone: 'digital' };
    return { name: 'receipt-text', tone: 'other' };
}

function setNotice(message, kind = 'success') {
    window.clearTimeout(noticeTimeout);
    elements.notice.textContent = message;
    elements.notice.dataset.kind = kind;
    elements.notice.hidden = false;
    noticeTimeout = window.setTimeout(() => {
        elements.notice.hidden = true;
    }, 5000);
}

function selectedMonthTransactions() {
    const selectedMonth = elements.monthFilter.value;
    return transactions.filter((transaction) => {
        const date = new Date(transaction.date);
        if (Number.isNaN(date.getTime())) return false;
        return localMonthValue(date) === selectedMonth;
    });
}

function updateSummary(monthTransactions) {
    let income = 0;
    let expense = 0;
    let incomeCount = 0;
    let expenseCount = 0;
    const categoryTotals = new Map();

    monthTransactions.forEach((transaction) => {
        const amount = Number(transaction.amount);
        if (!Number.isFinite(amount)) return;

        if (transaction.type === 'income') {
            income += amount;
            incomeCount += 1;
            return;
        }

        expense += amount;
        expenseCount += 1;
        const category = String(transaction.category || 'Umum').trim() || 'Umum';
        categoryTotals.set(category, (categoryTotals.get(category) || 0) + amount);
    });

    const totalFlow = income + expense;
    const net = income - expense;
    const incomeShare = totalFlow ? Math.round((income / totalFlow) * 100) : 0;
    const expenseShare = totalFlow ? 100 - incomeShare : 0;

    elements.balance.textContent = formatCurrency(net);
    elements.balanceCaption.textContent = net >= 0 ? 'Kondisi bulan ini tetap positif' : 'Pengeluaran lebih tinggi dari pemasukan';
    elements.income.textContent = formatCurrency(income);
    elements.expense.textContent = formatCurrency(expense);
    elements.incomeCount.textContent = `${incomeCount} transaksi`;
    elements.expenseCount.textContent = `${expenseCount} transaksi`;
    const flowCaption = document.createElement('span');
    flowCaption.textContent = 'total pergerakan';
    elements.flowTotal.replaceChildren(document.createTextNode(formatCurrency(totalFlow)), flowCaption);
    elements.incomePercent.textContent = `${incomeShare}%`;
    elements.expensePercent.textContent = `${expenseShare}%`;
    elements.incomeBar.style.width = `${incomeShare}%`;
    elements.expenseBar.style.width = `${expenseShare}%`;
    elements.flowPeriod.textContent = new Intl.DateTimeFormat('id-ID', {
        month: 'long',
        year: 'numeric'
    }).format(new Date(`${elements.monthFilter.value}-01T12:00:00`));

    const healthMessage = totalFlow === 0
        ? 'Mulai catat transaksi untuk melihat kondisi arus kasmu.'
        : net < 0
            ? 'Pengeluaran bulan ini melampaui pemasukan. Cek kembali pos pengeluaranmu.'
            : expense / (income || 1) >= 0.8
                ? 'Sebagian besar pemasukan sudah terpakai. Pertimbangkan untuk menahan belanja berikutnya.'
                : 'Arus kas bulan ini terjaga. Pertahankan kebiasaan baikmu.';
    elements.healthNote.lastElementChild.textContent = healthMessage;

    renderCategories(categoryTotals, expense);
    renderMonthlyTrend();
}

function renderMonthlyTrend() {
    const selectedDate = new Date(`${elements.monthFilter.value}-01T12:00:00`);
    const months = Array.from({ length: 6 }, (_, index) => {
        const date = new Date(selectedDate);
        date.setMonth(date.getMonth() - (5 - index));
        return { date, key: localMonthValue(date), income: 0, expense: 0 };
    });
    const monthTotals = new Map(months.map((month) => [month.key, month]));

    transactions.forEach((transaction) => {
        const date = new Date(transaction.date);
        const month = monthTotals.get(localMonthValue(date));
        const amount = Number(transaction.amount);
        if (!month || !Number.isFinite(amount)) return;
        if (transaction.type === 'income') month.income += amount;
        else month.expense += amount;
    });

    const maxTotal = Math.max(0, ...months.map((month) => month.income + month.expense));
    const selectedMonth = months[months.length - 1];
    const previousMonth = months[months.length - 2];
    const selectedMonthName = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(selectedDate);
    const expenseChange = previousMonth.expense
        ? Math.round(((selectedMonth.expense - previousMonth.expense) / previousMonth.expense) * 100)
        : null;

    elements.trendPeriod.textContent = `${new Intl.DateTimeFormat('id-ID', { month: 'short' }).format(months[0].date)} – ${new Intl.DateTimeFormat('id-ID', { month: 'short', year: 'numeric' }).format(selectedDate)}`;
    elements.trendCaption.textContent = maxTotal === 0
        ? 'Belum ada transaksi pada rentang enam bulan ini.'
        : expenseChange === null
            ? `Pengeluaran pada ${selectedMonthName} sebesar ${formatCurrency(selectedMonth.expense)}. Belum ada pengeluaran pada bulan sebelumnya untuk dibandingkan.`
            : expenseChange > 0
                ? `Pengeluaran pada ${selectedMonthName} naik ${expenseChange}% dibanding bulan sebelumnya.`
                : expenseChange < 0
                    ? `Pengeluaran pada ${selectedMonthName} turun ${Math.abs(expenseChange)}% dibanding bulan sebelumnya.`
                    : `Pengeluaran pada ${selectedMonthName} sama dengan bulan sebelumnya.`;

    elements.trendChart.replaceChildren(...months.map((month) => {
        const column = document.createElement('div');
        column.className = `trend-month${month.key === selectedMonth.key ? ' is-current' : ''}`;
        column.setAttribute('role', 'img');
        column.setAttribute('aria-label', `${new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(month.date)}: pemasukan ${formatCurrency(month.income)}, pengeluaran ${formatCurrency(month.expense)}`);

        const bars = document.createElement('div');
        bars.className = 'trend-bars';
        const incomeBar = document.createElement('span');
        incomeBar.className = 'trend-bar trend-income';
        incomeBar.style.height = `${maxTotal ? Math.max(month.income ? 3 : 0, (month.income / maxTotal) * 100) : 0}%`;
        const expenseBar = document.createElement('span');
        expenseBar.className = 'trend-bar trend-expense';
        expenseBar.style.height = `${maxTotal ? Math.max(month.expense ? 3 : 0, (month.expense / maxTotal) * 100) : 0}%`;
        bars.append(incomeBar, expenseBar);

        const label = document.createElement('span');
        label.className = 'trend-month-label';
        label.textContent = new Intl.DateTimeFormat('id-ID', { month: 'short' }).format(month.date);
        column.append(bars, label);
        return column;
    }));
}

function renderBudgets() {
    const selectedMonth = elements.monthFilter.value;
    const selectedDate = new Date(`${selectedMonth}-01T12:00:00`);
    elements.budgetPeriod.textContent = new Intl.DateTimeFormat('id-ID', {
        month: 'long',
        year: 'numeric'
    }).format(selectedDate);

    const categories = [...new Set(transactions.map((transaction) => String(transaction.category || 'Umum').trim() || 'Umum'))]
        .sort((a, b) => a.localeCompare(b, 'id-ID'));
    elements.categoryOptions.replaceChildren(...categories.map((category) => new Option(category, category)));

    if (!monthlyBudgets.length) {
        elements.budgetList.replaceChildren();
        const emptyMessage = document.createElement('p');
        emptyMessage.className = 'empty-copy';
        emptyMessage.textContent = 'Belum ada budget untuk bulan ini.';
        elements.budgetList.append(emptyMessage);
        return;
    }

    const monthlyExpenses = selectedMonthTransactions()
        .filter((transaction) => transaction.type !== 'income')
        .reduce((totals, transaction) => {
            const category = String(transaction.category || 'Umum').trim() || 'Umum';
            totals.set(category, (totals.get(category) || 0) + Number(transaction.amount || 0));
            return totals;
        }, new Map());

    elements.budgetList.replaceChildren(...monthlyBudgets.map((budget) => {
        const item = document.createElement('article');
        item.className = 'budget-item';
        item.dataset.budgetId = String(budget.id);
        const spent = monthlyExpenses.get(budget.category) || 0;
        const limit = Number(budget.limit_amount);
        const percent = limit > 0 ? (spent / limit) * 100 : 0;

        const heading = document.createElement('div');
        heading.className = 'budget-item-heading';
        const category = document.createElement('strong');
        category.textContent = budget.category;
        const amounts = document.createElement('span');
        amounts.textContent = `${formatCurrency(spent)} / ${formatCurrency(limit)}`;
        heading.append(category, amounts);

        const progress = document.createElement('progress');
        progress.className = `budget-progress${percent >= 100 ? ' is-over' : percent >= 80 ? ' is-near' : ''}`;
        progress.max = 100;
        progress.value = Math.min(percent, 100);
        progress.setAttribute('aria-label', `${budget.category}: ${Math.round(percent)} persen dari budget terpakai`);

        const controls = document.createElement('div');
        controls.className = 'budget-item-controls';
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '1';
        input.step = '1';
        input.value = String(limit);
        input.setAttribute('aria-label', `Batas budget ${budget.category}`);
        const saveButton = document.createElement('button');
        saveButton.className = 'text-button';
        saveButton.type = 'button';
        saveButton.dataset.action = 'save-budget';
        saveButton.textContent = 'Ubah batas';
        const deleteButton = document.createElement('button');
        deleteButton.className = 'text-button destructive-text';
        deleteButton.type = 'button';
        deleteButton.dataset.action = 'delete-budget';
        deleteButton.textContent = 'Hapus';
        controls.append(input, saveButton, deleteButton);
        item.append(heading, progress, controls);
        return item;
    }));
}

function renderSavingsGoals() {
    if (!savingsGoals.length) {
        elements.goalList.replaceChildren();
        const emptyMessage = document.createElement('p');
        emptyMessage.className = 'empty-copy';
        emptyMessage.textContent = 'Belum ada target. Tambahkan tujuan tabungan pertamamu.';
        elements.goalList.append(emptyMessage);
        return;
    }

    elements.goalList.replaceChildren(...savingsGoals.map((goal) => {
        const item = document.createElement('article');
        item.className = 'goal-item';
        item.dataset.goalId = String(goal.id);
        const saved = Number(goal.current_amount);
        const target = Number(goal.target_amount);
        const percent = target > 0 ? (saved / target) * 100 : 0;

        const heading = document.createElement('div');
        heading.className = 'goal-item-heading';
        const name = document.createElement('strong');
        name.textContent = goal.name;
        const percentage = document.createElement('span');
        percentage.textContent = `${Math.round(percent)}%`;
        heading.append(name, percentage);

        const progress = document.createElement('progress');
        progress.className = 'goal-progress';
        progress.max = 100;
        progress.value = Math.min(percent, 100);
        progress.setAttribute('aria-label', `${goal.name}: ${Math.round(percent)} persen tercapai`);

        const amounts = document.createElement('p');
        amounts.className = 'goal-amounts';
        amounts.textContent = `${formatCurrency(saved)} terkumpul dari ${formatCurrency(target)}`;

        const controls = document.createElement('div');
        controls.className = 'goal-item-controls';
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.step = '1';
        input.value = String(saved);
        input.setAttribute('aria-label', `Saldo terkumpul untuk ${goal.name}`);
        const saveButton = document.createElement('button');
        saveButton.className = 'text-button';
        saveButton.type = 'button';
        saveButton.dataset.action = 'save-goal';
        saveButton.textContent = 'Perbarui saldo';
        const deleteButton = document.createElement('button');
        deleteButton.className = 'text-button destructive-text';
        deleteButton.type = 'button';
        deleteButton.dataset.action = 'delete-goal';
        deleteButton.textContent = 'Hapus';
        controls.append(input, saveButton, deleteButton);
        item.append(heading, progress, amounts, controls);
        return item;
    }));
}

async function loadBudgets() {
    const month = elements.monthFilter.value;
    const requestGeneration = authGeneration;
    monthlyBudgets = [];
    renderBudgets();
    try {
        const response = await apiFetch(`${BUDGETS_URL}?month=${encodeURIComponent(month)}`, {
            headers: { Accept: 'application/json' }
        });
        if (!response.ok) throw new Error(`Server merespons ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error('Format budget tidak sesuai.');
        if (month !== elements.monthFilter.value || requestGeneration !== authGeneration) return;
        monthlyBudgets = data;
        renderBudgets();
    } catch (error) {
        if (month !== elements.monthFilter.value || requestGeneration !== authGeneration || error.name === 'AbortError') return;
        console.error('Gagal memuat budget:', error);
        elements.budgetList.replaceChildren();
        const errorMessage = document.createElement('p');
        errorMessage.className = 'empty-copy';
        errorMessage.textContent = 'Budget gagal dimuat. Coba muat ulang data.';
        elements.budgetList.append(errorMessage);
        setNotice('Budget tidak dapat dimuat dari server. Coba muat ulang data.', 'error');
    }
}

async function loadSavingsGoals() {
    const requestGeneration = authGeneration;
    try {
        const response = await apiFetch(SAVINGS_GOALS_URL, {
            headers: { Accept: 'application/json' }
        });
        if (!response.ok) throw new Error(`Server merespons ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error('Format target tabungan tidak sesuai.');
        if (requestGeneration !== authGeneration) return;
        savingsGoals = data;
        renderSavingsGoals();
    } catch (error) {
        if (requestGeneration !== authGeneration || error.name === 'AbortError') return;
        console.error('Gagal memuat target tabungan:', error);
        elements.goalList.replaceChildren();
        const errorMessage = document.createElement('p');
        errorMessage.className = 'empty-copy';
        errorMessage.textContent = 'Target tabungan gagal dimuat. Coba muat ulang data.';
        elements.goalList.append(errorMessage);
        setNotice('Target tabungan tidak dapat dimuat dari server. Coba muat ulang data.', 'error');
    }
}

async function saveBudget(category, limitAmount) {
    const normalizedCategory = String(category || '').trim();
    const amount = Number(limitAmount);
    const month = elements.monthFilter.value;
    const requestGeneration = authGeneration;
    if (!normalizedCategory || !Number.isFinite(amount) || amount <= 0) {
        setNotice('Masukkan kategori dan batas budget yang valid.', 'error');
        return;
    }

    try {
        const response = await apiFetch(BUDGETS_URL, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ month, category: normalizedCategory, limitAmount: amount })
        });
        if (requestGeneration !== authGeneration) return;
        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            throw new Error(errorBody.error || `Server merespons ${response.status}`);
        }
        const savedBudget = await response.json();
        if (requestGeneration !== authGeneration) return;
        if (month !== elements.monthFilter.value) {
            setNotice(`Budget untuk ${month} berhasil disimpan.`);
            return;
        }
        monthlyBudgets = [...monthlyBudgets.filter((budget) => budget.category !== savedBudget.category), savedBudget]
            .sort((a, b) => a.category.localeCompare(b.category, 'id-ID'));
        elements.budgetForm.reset();
        renderBudgets();
        setNotice('Budget berhasil disimpan.');
    } catch (error) {
        if (requestGeneration !== authGeneration || error.name === 'AbortError') return;
        console.error('Gagal menyimpan budget:', error);
        setNotice(error.message || 'Budget gagal disimpan. Silakan coba lagi.', 'error');
    }
}

async function deleteBudget(budgetId) {
    const budget = monthlyBudgets.find((item) => String(item.id) === String(budgetId));
    if (!budget || !window.confirm(`Hapus budget kategori "${budget.category}" untuk ${budget.month}?`)) return;
    const requestGeneration = authGeneration;
    try {
        const response = await apiFetch(`${BUDGETS_URL}/${encodeURIComponent(budgetId)}`, { method: 'DELETE' });
        if (requestGeneration !== authGeneration) return;
        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            throw new Error(errorBody.error || `Server merespons ${response.status}`);
        }
        monthlyBudgets = monthlyBudgets.filter((budget) => String(budget.id) !== String(budgetId));
        renderBudgets();
        setNotice('Budget berhasil dihapus.');
    } catch (error) {
        if (requestGeneration !== authGeneration || error.name === 'AbortError') return;
        console.error('Gagal menghapus budget:', error);
        setNotice(error.message || 'Budget gagal dihapus. Silakan coba lagi.', 'error');
    }
}

async function createSavingsGoal(event) {
    event.preventDefault();
    const formData = new FormData(elements.goalForm);
    const goal = {
        name: String(formData.get('name') || '').trim(),
        targetAmount: Number(formData.get('targetAmount')),
        currentAmount: Number(formData.get('currentAmount') || 0)
    };
    if (!goal.name || !Number.isFinite(goal.targetAmount) || goal.targetAmount <= 0
        || !Number.isFinite(goal.currentAmount) || goal.currentAmount < 0) {
        setNotice('Masukkan nama tujuan dan nominal tabungan yang valid.', 'error');
        return;
    }

    const button = document.getElementById('saveGoal');
    const requestGeneration = authGeneration;
    button.disabled = true;
    try {
        const response = await apiFetch(SAVINGS_GOALS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(goal)
        });
        if (requestGeneration !== authGeneration) return;
        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            throw new Error(errorBody.error || `Server merespons ${response.status}`);
        }
        const savedGoal = await response.json();
        if (requestGeneration !== authGeneration) return;
        savingsGoals.push(savedGoal);
        elements.goalForm.reset();
        document.getElementById('goalCurrent').value = '0';
        renderSavingsGoals();
        setNotice('Target tabungan berhasil ditambahkan.');
    } catch (error) {
        if (requestGeneration !== authGeneration || error.name === 'AbortError') return;
        console.error('Gagal membuat target tabungan:', error);
        setNotice(error.message || 'Target tabungan gagal dibuat. Silakan coba lagi.', 'error');
    } finally {
        if (requestGeneration === authGeneration) button.disabled = false;
    }
}

async function updateSavingsGoal(goalId, currentAmount) {
    const amount = Number(currentAmount);
    if (!Number.isFinite(amount) || amount < 0) {
        setNotice('Masukkan saldo terkumpul yang valid.', 'error');
        return;
    }
    const requestGeneration = authGeneration;
    try {
        const response = await apiFetch(`${SAVINGS_GOALS_URL}/${encodeURIComponent(goalId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ currentAmount: amount })
        });
        if (requestGeneration !== authGeneration) return;
        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            throw new Error(errorBody.error || `Server merespons ${response.status}`);
        }
        const updatedGoal = await response.json();
        if (requestGeneration !== authGeneration) return;
        savingsGoals = savingsGoals.map((goal) => String(goal.id) === String(goalId) ? updatedGoal : goal);
        renderSavingsGoals();
        setNotice('Saldo target tabungan berhasil diperbarui.');
    } catch (error) {
        if (requestGeneration !== authGeneration || error.name === 'AbortError') return;
        console.error('Gagal memperbarui target tabungan:', error);
        setNotice(error.message || 'Saldo target tabungan gagal diperbarui.', 'error');
    }
}

async function deleteSavingsGoal(goalId) {
    const goal = savingsGoals.find((item) => String(item.id) === String(goalId));
    if (!goal || !window.confirm(`Hapus target tabungan "${goal.name}"?`)) return;
    const requestGeneration = authGeneration;
    try {
        const response = await apiFetch(`${SAVINGS_GOALS_URL}/${encodeURIComponent(goalId)}`, { method: 'DELETE' });
        if (requestGeneration !== authGeneration) return;
        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            throw new Error(errorBody.error || `Server merespons ${response.status}`);
        }
        savingsGoals = savingsGoals.filter((goal) => String(goal.id) !== String(goalId));
        renderSavingsGoals();
        setNotice('Target tabungan berhasil dihapus.');
    } catch (error) {
        if (requestGeneration !== authGeneration || error.name === 'AbortError') return;
        console.error('Gagal menghapus target tabungan:', error);
        setNotice(error.message || 'Target tabungan gagal dihapus.', 'error');
    }
}

async function handleGoogleCredential(credentialResponse) {
    const credential = credentialResponse?.credential;
    if (!credential) {
        elements.authStatus.textContent = 'Google tidak mengembalikan kredensial. Silakan coba lagi.';
        return;
    }

    const loginAttempt = ++authGeneration;
    elements.authStatus.textContent = 'Memverifikasi akun Google...';
    try {
        const response = await fetch(AUTH_SESSION_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${credential}`,
                Accept: 'application/json'
            }
        });
        const result = await response.json().catch(() => ({}));
        if (loginAttempt !== authGeneration) return;
        if (!response.ok) throw new Error(result.error || `Server merespons ${response.status}`);
        if (!result.user?.id || !result.user?.email) throw new Error('Identitas Google dari server tidak valid.');

        googleIdToken = credential;
        signedInUser = result.user;
        elements.appShell.classList.add('is-authenticated');
        elements.authScreen.hidden = true;
        elements.accountActions.hidden = false;
        elements.accountName.textContent = signedInUser.name || signedInUser.email;
        elements.accountAvatar.hidden = !signedInUser.picture;
        if (signedInUser.picture) elements.accountAvatar.src = signedInUser.picture;
        await Promise.all([loadTransactions(), loadBudgets(), loadSavingsGoals()]);
    } catch (error) {
        if (loginAttempt !== authGeneration) return;
        console.error('Gagal masuk dengan Google:', error);
        googleIdToken = null;
        signedInUser = null;
        elements.authStatus.textContent = error.message || 'Login Google gagal. Silakan coba lagi.';
    }
}

async function initializeGoogleSignIn() {
    elements.authStatus.textContent = 'Menghubungkan ke layanan Google...';
    try {
        const response = await fetch(AUTH_CONFIG_URL, { headers: { Accept: 'application/json' } });
        const config = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(config.error || `Server merespons ${response.status}`);
        if (!config.clientId) throw new Error('Client ID Google belum tersedia.');
        if (!window.google?.accounts?.id) throw new Error('Layanan Google Sign-In gagal dimuat. Periksa koneksi lalu muat ulang.');

        window.google.accounts.id.initialize({
            client_id: config.clientId,
            callback: handleGoogleCredential,
            auto_select: false,
            cancel_on_tap_outside: false
        });
        window.google.accounts.id.renderButton(elements.googleSignInButton, {
            type: 'standard',
            theme: 'outline',
            size: 'large',
            text: 'signin_with',
            shape: 'rectangular',
            width: Math.min(Math.floor(elements.googleSignInButton.getBoundingClientRect().width), 400),
            logo_alignment: 'left'
        });
        elements.authStatus.textContent = 'Pilih akun Google untuk masuk.';
    } catch (error) {
        console.error('Gagal menyiapkan Google Sign-In:', error);
        elements.authStatus.textContent = error.message || 'Google Sign-In belum bisa disiapkan. Coba muat ulang.';
    }
}

function signOut(showStatus = true) {
    authGeneration += 1;
    googleIdToken = null;
    signedInUser = null;
    transactions = [];
    monthlyBudgets = [];
    savingsGoals = [];
    elements.accountActions.hidden = true;
    elements.accountName.textContent = '';
    elements.accountAvatar.removeAttribute('src');
    elements.appShell.classList.remove('is-authenticated');
    elements.authScreen.hidden = false;
    elements.transactionList.replaceChildren();
    elements.emptyState.hidden = true;
    elements.listStatus.textContent = '';
    elements.categoryLegend.replaceChildren();
    elements.categoryDonut.style.background = 'conic-gradient(var(--line) 0deg 360deg)';
    elements.categoryTotal.textContent = formatCurrency(0);
    elements.budgetList.replaceChildren();
    elements.goalList.replaceChildren();
    elements.trendChart.replaceChildren();
    elements.trendCaption.textContent = '';
    elements.analysisResult.replaceChildren();
    elements.analysisResult.hidden = true;
    elements.form.reset();
    elements.saveButton.disabled = false;
    elements.saveButton.textContent = 'Simpan transaksi';
    elements.goalForm.reset();
    document.getElementById('saveGoal').disabled = false;
    document.getElementById('saveGoal').textContent = 'Tambah target';
    elements.budgetForm.reset();
    elements.analysisButton.disabled = false;
    const analysisIcon = document.createElement('i');
    analysisIcon.dataset.lucide = 'sparkles';
    analysisIcon.setAttribute('aria-hidden', 'true');
    elements.analysisButton.replaceChildren(analysisIcon, document.createTextNode(' Analisis bulan ini'));
    renderIcons();
    elements.search.value = '';
    elements.typeFilter.value = 'all';
    elements.categoryFilter.replaceChildren(new Option('Semua kategori', 'all'));
    elements.categoryOptions.replaceChildren();
    elements.sort.value = 'newest';
    if (elements.dialog.open) elements.dialog.close();
    elements.balance.textContent = formatCurrency(0);
    elements.balanceCaption.textContent = 'Pemasukan dikurangi pengeluaran';
    elements.income.textContent = formatCurrency(0);
    elements.expense.textContent = formatCurrency(0);
    const flowCaption = document.createElement('span');
    flowCaption.textContent = 'total pergerakan';
    elements.flowTotal.replaceChildren(document.createTextNode(formatCurrency(0)), flowCaption);
    elements.incomeCount.textContent = '0 transaksi';
    elements.expenseCount.textContent = '0 transaksi';
    elements.incomePercent.textContent = '0%';
    elements.expensePercent.textContent = '0%';
    elements.incomeBar.style.width = '0%';
    elements.expenseBar.style.width = '0%';
    if (showStatus) elements.authStatus.textContent = 'Anda telah keluar. Pilih akun Google untuk masuk kembali.';
    window.google?.accounts?.id?.disableAutoSelect();
}

async function requestFinancialAnalysis() {
    const button = elements.analysisButton;
    const requestGeneration = authGeneration;
    button.disabled = true;
    button.textContent = 'Menganalisis...';
    elements.analysisResult.hidden = false;
    elements.analysisResult.textContent = 'Mengirim ringkasan keuangan agregat ke Google Gemini...';

    try {
        const response = await apiFetch(`${API_BASE_URL}/financial-analysis`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ month: elements.monthFilter.value })
        });
        if (requestGeneration !== authGeneration) return;
        const result = await response.json();
        if (requestGeneration !== authGeneration) return;
        if (!response.ok) throw new Error(result.error || `Server merespons ${response.status}`);
        if (typeof result.analysis !== 'string' || !result.analysis.trim()) {
            throw new Error('Hasil analisis dari server tidak valid.');
        }
        elements.analysisResult.textContent = result.analysis;
    } catch (error) {
        if (requestGeneration !== authGeneration || error.name === 'AbortError') return;
        console.error('Gagal meminta analisis AI:', error);
        elements.analysisResult.textContent = error.message || 'Analisis AI gagal dibuat. Coba lagi beberapa saat.';
        setNotice('Analisis AI gagal dibuat. Coba lagi beberapa saat.', 'error');
    } finally {
        if (requestGeneration === authGeneration) {
            button.disabled = false;
            const icon = document.createElement('i');
            icon.dataset.lucide = 'sparkles';
            icon.setAttribute('aria-hidden', 'true');
            button.replaceChildren(icon, document.createTextNode(' Analisis bulan ini'));
            renderIcons();
        }
    }
}

function renderCategories(categoryTotals, totalExpense) {
    const categories = [...categoryTotals.entries()]
        .sort((a, b) => b[1] - a[1])
        .filter(([, amount]) => amount > 0);
    elements.categoryTotal.textContent = formatCurrency(totalExpense);
    elements.categoryLegend.replaceChildren();

    if (!categories.length) {
        elements.categoryDonut.style.background = 'conic-gradient(var(--line) 0deg 360deg)';
        const emptyMessage = document.createElement('p');
        emptyMessage.className = 'empty-copy';
        emptyMessage.textContent = 'Belum ada pengeluaran di bulan ini.';
        elements.categoryLegend.append(emptyMessage);
        return;
    }

    let accumulated = 0;
    const segments = categories.map(([, amount], index) => {
        const start = accumulated;
        accumulated += (amount / totalExpense) * 100;
        return `${CATEGORY_COLORS[index % CATEGORY_COLORS.length]} ${start}% ${accumulated}%`;
    });
    elements.categoryDonut.style.background = `conic-gradient(${segments.join(', ')})`;

    categories.slice(0, 5).forEach(([category, amount], index) => {
        const item = document.createElement('div');
        item.className = 'category-item';

        const swatch = document.createElement('span');
        swatch.className = 'swatch';
        swatch.style.backgroundColor = CATEGORY_COLORS[index % CATEGORY_COLORS.length];

        const name = document.createElement('span');
        name.className = 'category-name';
        name.textContent = category;

        const value = document.createElement('strong');
        value.textContent = formatCurrency(amount);

        item.append(swatch, name, value);
        elements.categoryLegend.append(item);
    });

    if (categories.length > 5) {
        const remaining = categories.slice(5).reduce((sum, [, amount]) => sum + amount, 0);
        const item = document.createElement('div');
        item.className = 'category-item';
        const swatch = document.createElement('span');
        swatch.className = 'swatch';
        swatch.style.backgroundColor = CATEGORY_COLORS[5];
        const name = document.createElement('span');
        name.className = 'category-name';
        name.textContent = `${categories.length - 5} kategori lain`;
        const value = document.createElement('strong');
        value.textContent = formatCurrency(remaining);
        item.append(swatch, name, value);
        elements.categoryLegend.append(item);
    }
}

function createTransactionRow(transaction) {
    const row = document.createElement('article');
    row.className = 'transaction-row';
    row.dataset.transactionId = String(transaction.id);

    const main = document.createElement('div');
    main.className = 'transaction-main';

    const icon = document.createElement('span');
    const iconDetails = getCategoryIcon(transaction.category, transaction.type);
    icon.className = `transaction-icon icon-${iconDetails.tone}`;
    icon.setAttribute('aria-hidden', 'true');
    const iconElement = document.createElement('i');
    iconElement.dataset.lucide = iconDetails.name;
    icon.append(iconElement);

    const details = document.createElement('div');
    details.style.minWidth = '0';
    const description = document.createElement('div');
    description.className = 'transaction-description';
    description.textContent = String(transaction.desc || 'Transaksi tanpa keterangan');
    const category = document.createElement('div');
    category.className = 'transaction-category';
    category.textContent = String(transaction.category || 'Umum');
    details.append(description, category);
    main.append(icon, details);

    const date = document.createElement('time');
    date.className = 'transaction-date';
    date.dateTime = String(transaction.date || '');
    date.textContent = formatTransactionDate(transaction.date);

    const badge = document.createElement('span');
    const isIncome = transaction.type === 'income';
    badge.className = `type-badge${isIncome ? '' : ' expense'}`;
    badge.textContent = isIncome ? 'Pemasukan' : 'Pengeluaran';

    const amount = document.createElement('strong');
    amount.className = `transaction-amount ${isIncome ? 'income' : 'expense'}`;
    const numericAmount = Number(transaction.amount);
    amount.textContent = `${isIncome ? '+' : '−'} ${formatCurrency(numericAmount)}`;

    const deleteButton = document.createElement('button');
    deleteButton.className = 'transaction-delete';
    deleteButton.type = 'button';
    deleteButton.setAttribute('aria-label', `Hapus transaksi ${transaction.desc || 'tanpa keterangan'}`);
    deleteButton.title = 'Hapus transaksi';
    const deleteIcon = document.createElement('i');
    deleteIcon.dataset.lucide = 'trash-2';
    deleteIcon.setAttribute('aria-hidden', 'true');
    deleteButton.append(deleteIcon);

    row.append(main, date, badge, amount, deleteButton);
    return row;
}

function renderIcons() {
    if (window.lucide?.createIcons) {
        window.lucide.createIcons();
    }
}

function renderTransactions() {
    updateCategoryFilter();
    const query = elements.search.value.trim().toLocaleLowerCase('id-ID');
    const monthTransactions = selectedMonthTransactions();
    const type = elements.typeFilter.value;
    const category = elements.categoryFilter.value;
    const matchingTransactions = monthTransactions.filter((transaction) => {
        const searchable = `${transaction.desc || ''} ${transaction.category || ''} ${transaction.type || ''}`.toLocaleLowerCase('id-ID');
        const transactionCategory = String(transaction.category || 'Umum').trim() || 'Umum';
        return searchable.includes(query)
            && (type === 'all' || transaction.type === type)
            && (category === 'all' || transactionCategory === category);
    }).sort((a, b) => {
        if (elements.sort.value === 'oldest') return new Date(a.date) - new Date(b.date);
        if (elements.sort.value === 'amount-desc') return Number(b.amount) - Number(a.amount);
        if (elements.sort.value === 'amount-asc') return Number(a.amount) - Number(b.amount);
        return new Date(b.date) - new Date(a.date);
    });
    const hasFilters = Boolean(query) || type !== 'all' || category !== 'all';
    const hasActiveControls = hasFilters || elements.sort.value !== 'newest';
    const visibleTransactions = showAllTransactions || hasFilters
        ? matchingTransactions
        : matchingTransactions.slice(0, VISIBLE_TRANSACTION_LIMIT);

    elements.transactionList.replaceChildren(...visibleTransactions.map(createTransactionRow));
    renderIcons();
    elements.emptyState.hidden = matchingTransactions.length > 0;
    elements.transactionList.hidden = matchingTransactions.length === 0;
    elements.emptyState.querySelector('strong').textContent = !matchingTransactions.length && monthTransactions.length && hasFilters
        ? 'Tidak ada transaksi yang cocok'
        : 'Belum ada transaksi';
    elements.emptyState.querySelector('span:not(.empty-illustration)').textContent = monthTransactions.length && hasFilters
        ? 'Coba ubah kata kunci atau pilihan filter.'
        : 'Catat transaksi pertama untuk mulai melihat gambaran keuanganmu.';
    elements.emptyState.querySelector('[data-open-form]').hidden = monthTransactions.length > 0;
    elements.listStatus.textContent = matchingTransactions.length > visibleTransactions.length
        ? `Menampilkan ${visibleTransactions.length} dari ${matchingTransactions.length} transaksi`
        : matchingTransactions.length
            ? `${matchingTransactions.length} transaksi ditemukan pada periode ini`
            : hasFilters
                ? 'Coba ubah kata kunci atau pilihan filter.'
                : '';

    const showAllButton = document.getElementById('showAllTransactions');
    showAllButton.hidden = matchingTransactions.length <= VISIBLE_TRANSACTION_LIMIT || hasFilters;
    document.getElementById('clearTransactionFilters').hidden = !hasActiveControls;
    const arrow = document.createElement('span');
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = showAllTransactions ? '↑' : '→';
    showAllButton.replaceChildren(
        document.createTextNode(showAllTransactions ? 'Tampilkan lebih sedikit ' : 'Lihat semua '),
        arrow
    );
}

function updateCategoryFilter() {
    const selectedCategory = elements.categoryFilter.value;
    const categories = [...new Set(transactions.map((transaction) => String(transaction.category || 'Umum').trim() || 'Umum'))]
        .sort((a, b) => a.localeCompare(b, 'id-ID'));
    const options = [new Option('Semua kategori', 'all'), ...categories.map((category) => new Option(category, category))];
    elements.categoryFilter.replaceChildren(...options);
    elements.categoryFilter.value = categories.includes(selectedCategory) ? selectedCategory : 'all';
}

function renderDashboard() {
    const monthTransactions = selectedMonthTransactions();
    updateSummary(monthTransactions);
    renderTransactions();
    renderBudgets();
}

async function loadTransactions() {
    const requestGeneration = authGeneration;
    elements.transactionList.hidden = false;
    elements.emptyState.hidden = true;
    const loadingState = document.createElement('div');
    loadingState.className = 'loading-state';
    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    spinner.setAttribute('aria-hidden', 'true');
    loadingState.append(spinner, document.createTextNode('Memuat transaksi...'));
    elements.transactionList.replaceChildren(loadingState);

    try {
        const response = await apiFetch(TRANSACTIONS_URL, {
            headers: { Accept: 'application/json' }
        });
        if (!response.ok) throw new Error(`Server merespons ${response.status}`);

        const data = await response.json();
        if (requestGeneration !== authGeneration) return;
        if (!Array.isArray(data)) throw new Error('Format data transaksi tidak sesuai.');
        transactions = data;
        elements.emptyState.querySelector('strong').textContent = 'Belum ada transaksi';
        elements.emptyState.querySelector('span:not(.empty-illustration)').textContent = 'Catat transaksi pertama untuk mulai melihat gambaran keuanganmu.';
        elements.emptyState.querySelector('[data-open-form]').hidden = false;
        renderDashboard();
    } catch (error) {
        if (requestGeneration !== authGeneration || error.name === 'AbortError') return;
        console.error('Gagal memuat transaksi:', error);
        elements.transactionList.replaceChildren();
        elements.transactionList.hidden = true;
        elements.emptyState.hidden = false;
        elements.emptyState.querySelector('strong').textContent = 'Data belum bisa dimuat';
        elements.emptyState.querySelector('span:not(.empty-illustration)').textContent = 'Periksa koneksi internetmu lalu coba muat ulang.';
        elements.emptyState.querySelector('[data-open-form]').hidden = true;
        setNotice('Gagal mengambil transaksi dari server. Coba lagi beberapa saat.', 'error');
    }
}

async function exportTransactionsToXlsx() {
    if (!transactions.length) {
        setNotice('Belum ada transaksi yang bisa diekspor.', 'error');
        return;
    }

    if (!window.ExcelJS) {
        setNotice('Library Excel belum berhasil dimuat. Periksa koneksi lalu muat ulang halaman.', 'error');
        return;
    }

    const exportButton = document.getElementById('exportXlsx');
    exportButton.disabled = true;
    try {
        const workbook = new window.ExcelJS.Workbook();
        workbook.creator = 'Saku Harian';
        workbook.created = new Date();
        workbook.subject = 'Laporan transaksi keuangan';
        workbook.title = 'Laporan Keuangan Saku Harian';

        const worksheet = workbook.addWorksheet('Transaksi', {
            views: [{ state: 'frozen', ySplit: 1, showGridLines: false }]
        });
        worksheet.columns = [
            { header: 'ID', key: 'id', width: 12 },
            { header: 'Tanggal', key: 'date', width: 23 },
            { header: 'Keterangan', key: 'description', width: 36 },
            { header: 'Kategori', key: 'category', width: 24 },
            { header: 'Tipe', key: 'type', width: 18 },
            { header: 'Nominal', key: 'amount', width: 20 }
        ];

        transactions.forEach((transaction) => {
            const parsedDate = new Date(transaction.date);
            const row = worksheet.addRow({
                id: transaction.id ?? '',
                date: Number.isNaN(parsedDate.getTime()) ? String(transaction.date || '') : parsedDate,
                description: String(transaction.desc || ''),
                category: String(transaction.category || 'Umum'),
                type: transaction.type === 'income' ? 'Pemasukan' : 'Pengeluaran',
                amount: Number(transaction.amount) || 0
            });
            row.getCell('date').numFmt = 'dd mmm yyyy hh:mm';
            row.getCell('amount').numFmt = '"Rp" #,##0;[Red]-"Rp" #,##0';
            row.getCell('amount').alignment = { horizontal: 'right' };
            row.getCell('id').alignment = { horizontal: 'center' };
        });

        const header = worksheet.getRow(1);
        header.height = 25;
        header.font = { bold: true, color: { argb: 'FF26351F' } };
        header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB8F36A' } };
        header.alignment = { vertical: 'middle' };
        worksheet.autoFilter = { from: 'A1', to: 'F1' };

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        const today = new Date();
        const fileDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        link.download = `laporan-saku-harian-${fileDate}.xlsx`;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
        setNotice(`Berhasil menyiapkan ${transactions.length} transaksi dalam file XLSX.`);
    } catch (error) {
        console.error('Gagal mengekspor laporan XLSX:', error);
        setNotice('File XLSX gagal dibuat. Silakan coba lagi.', 'error');
    } finally {
        exportButton.disabled = false;
    }
}

function openTransactionDialog() {
    elements.formError.hidden = true;
    if (typeof elements.dialog.showModal === 'function') {
        elements.dialog.showModal();
    } else {
        setNotice('Browser ini belum mendukung formulir transaksi. Coba gunakan browser versi terbaru.', 'error');
    }
}

function closeTransactionDialog() {
    elements.dialog.close();
}

async function submitTransaction(event) {
    event.preventDefault();
    elements.formError.hidden = true;

    const formData = new FormData(elements.form);
    const transaction = {
        desc: String(formData.get('desc') || '').trim(),
        amount: Number(formData.get('amount')),
        type: String(formData.get('type')),
        category: String(formData.get('category') || '').trim() || 'Umum'
    };

    if (!transaction.desc || !Number.isFinite(transaction.amount) || transaction.amount <= 0) {
        elements.formError.textContent = 'Isi keterangan dan nominal yang valid terlebih dahulu.';
        elements.formError.hidden = false;
        return;
    }

    elements.saveButton.disabled = true;
    elements.saveButton.textContent = 'Menyimpan...';
    const requestGeneration = authGeneration;

    try {
        const response = await apiFetch(TRANSACTIONS_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: JSON.stringify(transaction)
        });
        if (requestGeneration !== authGeneration) return;

        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            throw new Error(errorBody.error || `Server merespons ${response.status}`);
        }

        const savedTransaction = await response.json();
        if (requestGeneration !== authGeneration) return;
        transactions.unshift(savedTransaction);
        elements.form.reset();
        document.querySelector('input[name="type"][value="expense"]').checked = true;
        document.getElementById('transactionCategory').value = 'Umum';
        showAllTransactions = false;
        elements.search.value = '';
        if (savedTransaction.date) {
            elements.monthFilter.value = localMonthValue(new Date(savedTransaction.date));
        }
        renderDashboard();
        closeTransactionDialog();
        setNotice('Transaksi berhasil dicatat.');
    } catch (error) {
        if (requestGeneration !== authGeneration || error.name === 'AbortError') return;
        console.error('Gagal menyimpan transaksi:', error);
        elements.formError.textContent = error.message || 'Transaksi gagal disimpan. Silakan coba lagi.';
        elements.formError.hidden = false;
    } finally {
        if (requestGeneration === authGeneration) {
            elements.saveButton.disabled = false;
            elements.saveButton.textContent = 'Simpan transaksi';
        }
    }
}

async function deleteTransaction(button) {
    const row = button.closest('.transaction-row');
    const transaction = transactions.find((item) => String(item.id) === row?.dataset.transactionId);
    if (!transaction) {
        setNotice('Transaksi tidak ditemukan. Muat ulang data lalu coba lagi.', 'error');
        return;
    }

    const description = String(transaction.desc || 'Transaksi tanpa keterangan');
    if (!window.confirm(`Hapus transaksi "${description}"? Tindakan ini tidak dapat dibatalkan.`)) return;

    button.disabled = true;
    const requestGeneration = authGeneration;
    try {
        const response = await apiFetch(`${TRANSACTIONS_URL}/${encodeURIComponent(transaction.id)}`, {
            method: 'DELETE',
            headers: { Accept: 'application/json' }
        });
        if (requestGeneration !== authGeneration) return;
        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            throw new Error(errorBody.error || `Server merespons ${response.status}`);
        }

        transactions = transactions.filter((item) => String(item.id) !== String(transaction.id));
        renderDashboard();
        setNotice('Transaksi berhasil dihapus.');
    } catch (error) {
        if (requestGeneration !== authGeneration || error.name === 'AbortError') return;
        console.error('Gagal menghapus transaksi:', error);
        setNotice(error.message || 'Transaksi gagal dihapus. Silakan coba lagi.', 'error');
        button.disabled = false;
    }
}

function initializeTheme() {
    const savedTheme = localStorage.getItem('saku-theme');
    if (savedTheme === 'dark') document.documentElement.dataset.theme = 'dark';

    const themeButton = document.getElementById('themeToggle');
    const updateThemeButton = (isDark) => {
        const icon = document.createElement('i');
        icon.dataset.lucide = isDark ? 'sun' : 'moon';
        icon.setAttribute('aria-hidden', 'true');
        themeButton.replaceChildren(icon);
        themeButton.setAttribute('aria-label', isDark ? 'Gunakan tema terang' : 'Gunakan tema gelap');
        themeButton.title = isDark ? 'Gunakan tema terang' : 'Gunakan tema gelap';
        renderIcons();
    };
    updateThemeButton(savedTheme === 'dark');

    themeButton.addEventListener('click', () => {
        const isDark = document.documentElement.dataset.theme === 'dark';
        if (isDark) {
            delete document.documentElement.dataset.theme;
            localStorage.setItem('saku-theme', 'light');
        } else {
            document.documentElement.dataset.theme = 'dark';
            localStorage.setItem('saku-theme', 'dark');
        }
        updateThemeButton(!isDark);
    });
}

function initializeNavigation() {
    const navLinks = [...document.querySelectorAll('[data-nav]')];
    const sections = [...document.querySelectorAll('#overview, #transactions, #insights')];

    const observer = new IntersectionObserver((entries) => {
        const visible = entries
            .filter((entry) => entry.isIntersecting)
            .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        navLinks.forEach((link) => {
            link.classList.toggle('is-active', link.dataset.nav === visible.target.id);
        });
    }, { rootMargin: '-15% 0px -65% 0px', threshold: [0, 0.2, 0.5] });

    sections.forEach((section) => observer.observe(section));
}

document.getElementById('todayLabel').textContent = new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
}).format(new Date()).toLocaleUpperCase('id-ID');
elements.monthFilter.value = localMonthValue();
elements.monthFilter.addEventListener('change', () => {
    renderDashboard();
    loadBudgets();
});
elements.budgetForm.addEventListener('submit', (event) => {
    event.preventDefault();
    saveBudget(elements.budgetCategory.value, elements.budgetLimit.value);
});
elements.budgetList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    const item = button?.closest('.budget-item');
    if (!button || !item) return;
    if (button.dataset.action === 'save-budget') {
        saveBudget(item.querySelector('strong').textContent, item.querySelector('input').value);
    } else if (button.dataset.action === 'delete-budget') {
        deleteBudget(item.dataset.budgetId);
    }
});
elements.goalForm.addEventListener('submit', createSavingsGoal);
elements.goalList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    const item = button?.closest('.goal-item');
    if (!button || !item) return;
    if (button.dataset.action === 'save-goal') {
        updateSavingsGoal(item.dataset.goalId, item.querySelector('input').value);
    } else if (button.dataset.action === 'delete-goal') {
        deleteSavingsGoal(item.dataset.goalId);
    }
});
elements.analysisButton.addEventListener('click', requestFinancialAnalysis);
elements.search.addEventListener('input', () => {
    showAllTransactions = true;
    renderTransactions();
});
elements.typeFilter.addEventListener('change', renderTransactions);
elements.categoryFilter.addEventListener('change', renderTransactions);
elements.sort.addEventListener('change', renderTransactions);
document.getElementById('clearTransactionFilters').addEventListener('click', () => {
    elements.search.value = '';
    elements.typeFilter.value = 'all';
    elements.categoryFilter.value = 'all';
    elements.sort.value = 'newest';
    showAllTransactions = false;
    renderTransactions();
});
document.getElementById('showAllTransactions').addEventListener('click', () => {
    showAllTransactions = !showAllTransactions;
    renderTransactions();
});
elements.transactionList.addEventListener('click', (event) => {
    const button = event.target.closest('.transaction-delete');
    if (button) deleteTransaction(button);
});
document.getElementById('openTransaction').addEventListener('click', openTransactionDialog);
document.getElementById('refreshButton').addEventListener('click', () => {
    loadTransactions();
    loadBudgets();
    loadSavingsGoals();
});
document.getElementById('exportXlsx').addEventListener('click', exportTransactionsToXlsx);
document.querySelectorAll('[data-open-form]').forEach((button) => {
    button.addEventListener('click', openTransactionDialog);
});
document.getElementById('closeTransaction').addEventListener('click', closeTransactionDialog);
document.getElementById('cancelTransaction').addEventListener('click', closeTransactionDialog);
elements.dialog.addEventListener('click', (event) => {
    if (event.target === elements.dialog) closeTransactionDialog();
});
elements.form.addEventListener('submit', submitTransaction);
initializeTheme();
initializeNavigation();
renderIcons();
document.getElementById('signOutButton').addEventListener('click', () => signOut());
initializeGoogleSignIn();
