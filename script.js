const API_BASE_URL = 'https://saku-sloth.vercel.app/api';
const TRANSACTIONS_URL = `${API_BASE_URL}/transactions`;
const BUDGETS_URL = `${API_BASE_URL}/budgets`;
const SAVINGS_GOALS_URL = `${API_BASE_URL}/savings-goals`;
const AUTH_CONFIG_URL = `${API_BASE_URL}/auth/config`;
const AUTH_SESSION_URL = `${API_BASE_URL}/auth/session`;
const VISIBLE_TRANSACTION_LIMIT = 5;
const CATEGORY_COLORS = ['#4a9d72', '#d16a5c', '#6f92c4', '#d6a83c', '#a17ba8', '#3fa8a0', '#e8733f'];

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
    dailyCashPanel: document.getElementById('dailyCashPanel'),
    dailyCashPeriod: document.getElementById('dailyCashPeriod'),
    dailyCashIncome: document.getElementById('dailyCashIncome'),
    dailyCashExpense: document.getElementById('dailyCashExpense'),
    dailyCashNet: document.getElementById('dailyCashNet'),
    dailyCashPeak: document.getElementById('dailyCashPeak'),
    dailyStackedChart: document.getElementById('dailyStackedChart'),
    stackedChartTooltip: document.getElementById('stackedChartTooltip'),
    dailyCashCaption: document.getElementById('dailyCashCaption'),
    incomeLinePeriod: document.getElementById('incomeLinePeriod'),
    incomeLineTotal: document.getElementById('incomeLineTotal'),
    incomeLineAvg: document.getElementById('incomeLineAvg'),
    incomeLinePeak: document.getElementById('incomeLinePeak'),
    incomeLineChart: document.getElementById('incomeLineChart'),
    incomeLineTooltip: document.getElementById('incomeLineTooltip'),
    incomeLineCaption: document.getElementById('incomeLineCaption'),
    expenseLinePeriod: document.getElementById('expenseLinePeriod'),
    expenseLineTotal: document.getElementById('expenseLineTotal'),
    expenseLineAvg: document.getElementById('expenseLineAvg'),
    expenseLinePeak: document.getElementById('expenseLinePeak'),
    expenseLineChart: document.getElementById('expenseLineChart'),
    expenseLineTooltip: document.getElementById('expenseLineTooltip'),
    expenseLineCaption: document.getElementById('expenseLineCaption'),
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
    authForm: document.getElementById('authForm'),
    authEmail: document.getElementById('authEmail'),
    authPassword: document.getElementById('authPassword'),
    authTitle: document.getElementById('authTitle'),
    authSubmitButton: document.getElementById('authSubmitButton'),
    authDescription: document.getElementById('authDescription'),
    authModePrompt: document.getElementById('authModePrompt'),
    authModeToggle: document.getElementById('authModeToggle'),
    accountActions: document.getElementById('accountActions'),
    telegramLinkButton: document.getElementById('telegramLinkButton'),
    telegramLinkDialog: document.getElementById('telegramLinkDialog'),
    telegramLinkCode: document.getElementById('telegramLinkCode'),
    telegramLinkStatus: document.getElementById('telegramLinkStatus'),
    copyTelegramLinkCode: document.getElementById('copyTelegramLinkCode'),
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
let supabaseAccessToken = null;
let signedInUser = null;
let supabaseAuth = null;
let authMode = 'signin';
let authGeneration = 0;
let showAllTransactions = false;
let noticeTimeout;

async function apiFetch(url, options = {}) {
    if (!supabaseAccessToken || !supabaseAuth) throw new Error('Silakan masuk dengan akun Google terlebih dahulu.');
    const requestGeneration = authGeneration;
    const { data, error } = await supabaseAuth.auth.getSession();
    if (error) throw error;
    const freshToken = data.session?.access_token;
    if (!freshToken) throw new Error('Sesi Supabase sudah berakhir. Silakan masuk kembali.');
    if (requestGeneration !== authGeneration || !supabaseAuth) {
        const error = new Error('Sesi login sudah berubah.');
        error.name = 'AbortError';
        throw error;
    }
    supabaseAccessToken = freshToken;
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${supabaseAccessToken}`);
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

const fullDateFormatter = new Intl.DateTimeFormat('id-ID', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
});

function formatCompactCurrency(amount) {
    const val = Number(amount) || 0;
    if (val === 0) return 'Rp 0';
    if (val >= 1_000_000_000) {
        const b = (val / 1_000_000_000).toFixed(1).replace('.0', '');
        return `${b} M`;
    }
    if (val >= 1_000_000) {
        const m = (val / 1_000_000).toFixed(1).replace('.0', '');
        return `${m} jt`;
    }
    if (val >= 1_000) {
        const k = (val / 1_000).toFixed(0);
        return `${k} rb`;
    }
    return `Rp ${val}`;
}

function getNiceCeiling(num) {
    if (num <= 0) return 100000;
    const exp = Math.floor(Math.log10(num));
    const frac = num / Math.pow(10, exp);
    let niceFrac;
    if (frac <= 1) niceFrac = 1;
    else if (frac <= 1.5) niceFrac = 1.5;
    else if (frac <= 2) niceFrac = 2;
    else if (frac <= 3) niceFrac = 3;
    else if (frac <= 5) niceFrac = 5;
    else niceFrac = 10;
    return niceFrac * Math.pow(10, exp);
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
    renderDailyCharts(monthTransactions);
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

function buildSmoothPath(pts) {
    if (!pts || !pts.length) return '';
    if (pts.length === 1) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i === 0 ? i : i - 1];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[i + 2 < pts.length ? i + 2 : i + 1];
        const cp1x = p1.x + (p2.x - p0.x) / 6;
        const cp1y = p1.y + (p2.y - p0.y) / 6;
        const cp2x = p2.x - (p3.x - p1.x) / 6;
        const cp2y = p2.y - (p3.y - p1.y) / 6;
        d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return d;
}

function getMonthlyDailyStats(monthTransactions) {
    const selectedDate = new Date(`${elements.monthFilter.value}-01T12:00:00`);
    const year = selectedDate.getFullYear();
    const month = selectedDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
    const currentDay = isCurrentMonth ? today.getDate() : -1;

    const days = Array.from({ length: daysInMonth }, (_, index) => {
        const dayNumber = index + 1;
        const date = new Date(year, month, dayNumber, 12, 0, 0);
        return {
            day: dayNumber,
            date,
            isToday: dayNumber === currentDay,
            isWeekend: date.getDay() === 0 || date.getDay() === 6,
            income: 0,
            expense: 0,
            incomeTransactions: [],
            expenseTransactions: []
        };
    });

    monthTransactions.forEach((tx) => {
        const date = new Date(tx.date);
        if (Number.isNaN(date.getTime())) return;
        const dayNumber = date.getDate();
        if (dayNumber >= 1 && dayNumber <= daysInMonth) {
            const dayItem = days[dayNumber - 1];
            const amount = Number(tx.amount) || 0;
            if (tx.type === 'income') {
                dayItem.income += amount;
                dayItem.incomeTransactions.push(tx);
            } else {
                dayItem.expense += amount;
                dayItem.expenseTransactions.push(tx);
            }
        }
    });

    return {
        selectedDate,
        year,
        month,
        daysInMonth,
        days
    };
}

function renderDailyCashStackedChart(dailyStats) {
    if (!elements.dailyCashPeriod || !elements.dailyStackedChart) return;

    const monthName = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(dailyStats.selectedDate);
    elements.dailyCashPeriod.textContent = monthName;

    let totalIncome = 0;
    let totalExpense = 0;
    let peakFlow = 0;
    let peakDay = null;
    let activeDaysCount = 0;
    let surplusDaysCount = 0;
    let defisitDaysCount = 0;

    dailyStats.days.forEach((day) => {
        totalIncome += day.income;
        totalExpense += day.expense;
        const flow = day.income + day.expense;
        if (flow > peakFlow) {
            peakFlow = flow;
            peakDay = day;
        }
        if (flow > 0) activeDaysCount += 1;
        if (day.income > day.expense) surplusDaysCount += 1;
        else if (day.expense > day.income) defisitDaysCount += 1;
    });

    const netCash = totalIncome - totalExpense;
    const maxDailyFlow = Math.max(0, ...dailyStats.days.map((d) => d.income + d.expense));

    elements.dailyCashIncome.textContent = formatCurrency(totalIncome);
    elements.dailyCashExpense.textContent = formatCurrency(totalExpense);
    elements.dailyCashNet.textContent = `${netCash > 0 ? '+' : ''}${formatCurrency(netCash)}`;
    elements.dailyCashNet.className = `daily-metric-value ${netCash >= 0 ? 'text-income' : 'text-expense'}`;
    elements.dailyCashPeak.textContent = peakDay && peakFlow > 0 ? `Tgl ${peakDay.day} (${formatCompactCurrency(peakFlow)})` : '-';

    if (maxDailyFlow === 0) {
        elements.dailyCashCaption.textContent = 'Belum ada transaksi kas pada bulan ini. Catat transaksi untuk melihat dinamika pergerakan kas per hari.';
    } else {
        const netStatus = netCash >= 0 ? `surplus bersih sebesar ${formatCurrency(netCash)}` : `defisit sebesar ${formatCurrency(Math.abs(netCash))}`;
        const peakDesc = peakDay ? `Puncak perputaran kas terjadi pada tanggal ${peakDay.day} (${formatCurrency(peakFlow)}).` : '';
        elements.dailyCashCaption.textContent = `Terdapat ${activeDaysCount} hari aktif (${surplusDaysCount} hari surplus, ${defisitDaysCount} hari defisit) dengan kondisi akhir ${netStatus}. ${peakDesc}`;
    }

    elements.dailyStackedChart.replaceChildren();

    dailyStats.days.forEach((day) => {
        const col = document.createElement('div');
        col.className = `daily-col${day.isToday ? ' is-today' : ''}${day.isWeekend ? ' is-weekend' : ''}`;
        col.tabIndex = 0;
        col.setAttribute('role', 'button');
        const dayTotal = day.income + day.expense;
        col.setAttribute('aria-label', `Tanggal ${day.day}: Masuk ${formatCurrency(day.income)}, Keluar ${formatCurrency(day.expense)}`);

        const barWrap = document.createElement('div');
        barWrap.className = 'daily-bar-wrap';

        if (dayTotal > 0 && maxDailyFlow > 0) {
            const net = day.income - day.expense;
            const netPip = document.createElement('span');
            netPip.className = `daily-net-pip ${net >= 0 ? 'is-surplus' : 'is-defisit'}`;
            netPip.textContent = net > 0 ? '+' : (net < 0 ? '−' : '•');
            netPip.title = net >= 0 ? `Surplus ${formatCurrency(net)}` : `Defisit ${formatCurrency(Math.abs(net))}`;
            barWrap.append(netPip);

            const bar = document.createElement('div');
            bar.className = 'daily-stacked-bar';
            const barHeightPct = Math.max(6, (dayTotal / maxDailyFlow) * 100);
            bar.style.height = `${barHeightPct}%`;

            if (day.expense > 0) {
                const expSeg = document.createElement('span');
                expSeg.className = 'segment-expense';
                expSeg.style.height = `${(day.expense / dayTotal) * 100}%`;
                bar.append(expSeg);
            }
            if (day.income > 0) {
                const incSeg = document.createElement('span');
                incSeg.className = 'segment-income';
                incSeg.style.height = `${(day.income / dayTotal) * 100}%`;
                bar.append(incSeg);
            }
            barWrap.append(bar);
        } else {
            const emptyMark = document.createElement('span');
            emptyMark.className = 'daily-bar-empty';
            barWrap.append(emptyMark);
        }

        const dayLabel = document.createElement('span');
        dayLabel.className = 'daily-col-label';
        dayLabel.textContent = String(day.day);
        col.append(barWrap, dayLabel);

        const showTooltip = () => {
            if (!elements.stackedChartTooltip || !elements.dailyCashPanel) return;
            elements.stackedChartTooltip.replaceChildren();

            const dateHeader = document.createElement('div');
            dateHeader.className = 'chart-tooltip-date';
            dateHeader.textContent = fullDateFormatter.format(day.date);

            const inRow = document.createElement('div');
            inRow.className = 'chart-tooltip-row';
            inRow.innerHTML = `<span>Kas Masuk</span><strong class="text-income">+${formatCurrency(day.income)}</strong>`;

            const outRow = document.createElement('div');
            outRow.className = 'chart-tooltip-row';
            outRow.innerHTML = `<span>Kas Keluar</span><strong class="text-expense">-${formatCurrency(day.expense)}</strong>`;

            const netDiff = day.income - day.expense;
            const netRow = document.createElement('div');
            netRow.className = 'chart-tooltip-row';
            const netClass = netDiff >= 0 ? 'text-income' : 'text-expense';
            const netSign = netDiff > 0 ? '+' : '';
            netRow.innerHTML = `<span>Net Kas</span><strong class="${netClass}">${netSign}${formatCurrency(netDiff)}</strong>`;

            elements.stackedChartTooltip.append(dateHeader, inRow, outRow, netRow);

            const allTxs = [...day.incomeTransactions, ...day.expenseTransactions];
            if (allTxs.length > 0) {
                const txsWrap = document.createElement('div');
                txsWrap.className = 'chart-tooltip-txs';
                allTxs.slice(0, 3).forEach((tx) => {
                    const item = document.createElement('div');
                    item.className = 'chart-tooltip-tx-item';
                    const desc = document.createElement('span');
                    desc.textContent = tx.desc || tx.category || 'Transaksi';
                    const val = document.createElement('strong');
                    val.className = tx.type === 'income' ? 'text-income' : 'text-expense';
                    val.textContent = `${tx.type === 'income' ? '+' : '-'}${formatCurrency(Number(tx.amount) || 0)}`;
                    item.append(desc, val);
                    txsWrap.append(item);
                });
                if (allTxs.length > 3) {
                    const more = document.createElement('span');
                    more.textContent = `+${allTxs.length - 3} lainnya`;
                    txsWrap.append(more);
                }
                elements.stackedChartTooltip.append(txsWrap);
            }

            const colRect = col.getBoundingClientRect();
            const panelRect = elements.dailyCashPanel.getBoundingClientRect();
            const left = colRect.left - panelRect.left + colRect.width / 2;
            const top = colRect.top - panelRect.top + 30;

            elements.stackedChartTooltip.style.left = `${left}px`;
            elements.stackedChartTooltip.style.top = `${top}px`;
            elements.stackedChartTooltip.hidden = false;
        };

        const hideTooltip = () => {
            if (elements.stackedChartTooltip) elements.stackedChartTooltip.hidden = true;
        };

        col.addEventListener('mouseenter', showTooltip);
        col.addEventListener('mouseleave', hideTooltip);
        col.addEventListener('focus', showTooltip);
        col.addEventListener('blur', hideTooltip);
        col.addEventListener('touchstart', showTooltip, { passive: true });

        elements.dailyStackedChart.append(col);
    });
}

function renderDailyLineChart(dailyStats, type) {
    const isIncome = type === 'income';
    const periodEl = isIncome ? elements.incomeLinePeriod : elements.expenseLinePeriod;
    const totalEl = isIncome ? elements.incomeLineTotal : elements.expenseLineTotal;
    const avgEl = isIncome ? elements.incomeLineAvg : elements.expenseLineAvg;
    const peakEl = isIncome ? elements.incomeLinePeak : elements.expenseLinePeak;
    const containerEl = isIncome ? elements.incomeLineChart : elements.expenseLineChart;
    const tooltipEl = isIncome ? elements.incomeLineTooltip : elements.expenseLineTooltip;
    const captionEl = isIncome ? elements.incomeLineCaption : elements.expenseLineCaption;

    if (!containerEl) return;

    const monthName = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(dailyStats.selectedDate);
    if (periodEl) periodEl.textContent = monthName;

    const values = dailyStats.days.map((d) => d[type]);
    const total = values.reduce((sum, v) => sum + v, 0);
    const avg = Math.round(total / dailyStats.daysInMonth);
    const maxVal = Math.max(0, ...values);
    const peakDay = maxVal > 0 ? dailyStats.days.find((d) => d[type] === maxVal) : null;

    if (totalEl) totalEl.textContent = formatCurrency(total);
    if (avgEl) avgEl.textContent = formatCurrency(avg);
    if (peakEl) peakEl.textContent = peakDay ? `Tgl ${peakDay.day} (${formatCompactCurrency(maxVal)})` : '-';

    const labelName = isIncome ? 'pemasukan' : 'pengeluaran';
    if (captionEl) {
        if (maxVal === 0) {
            captionEl.textContent = `Belum ada ${labelName} tercatat pada bulan ${monthName}.`;
        } else {
            captionEl.textContent = `Total ${labelName} sebesar ${formatCurrency(total)} (rata-rata ${formatCurrency(avg)}/hari). Puncak ${labelName} tercatat pada tanggal ${peakDay.day} (${formatCurrency(maxVal)}).`;
        }
    }

    containerEl.replaceChildren();

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 680 170');
    svg.setAttribute('preserveAspectRatio', 'none');

    const defs = document.createElementNS(svgNS, 'defs');
    const gradId = `${type}AreaGradient`;
    const grad = document.createElementNS(svgNS, 'linearGradient');
    grad.setAttribute('id', gradId);
    grad.setAttribute('x1', '0');
    grad.setAttribute('y1', '0');
    grad.setAttribute('x2', '0');
    grad.setAttribute('y2', '1');

    const stop1 = document.createElementNS(svgNS, 'stop');
    stop1.setAttribute('offset', '0%');
    stop1.setAttribute('style', `stop-color: var(${isIncome ? '--green' : '--red'}); stop-opacity: 0.28;`);

    const stop2 = document.createElementNS(svgNS, 'stop');
    stop2.setAttribute('offset', '100%');
    stop2.setAttribute('style', `stop-color: var(${isIncome ? '--green' : '--red'}); stop-opacity: 0.0;`);

    grad.append(stop1, stop2);
    defs.append(grad);
    svg.append(defs);

    const padding = { top: 22, right: 18, bottom: 26, left: 56 };
    const plotW = 680 - padding.left - padding.right;
    const plotH = 170 - padding.top - padding.bottom;
    const niceMax = getNiceCeiling(maxVal);

    const gridLevels = [
        { val: niceMax, label: formatCompactCurrency(niceMax), ratio: 1 },
        { val: niceMax / 2, label: formatCompactCurrency(niceMax / 2), ratio: 0.5 },
        { val: 0, label: 'Rp 0', ratio: 0 }
    ];

    gridLevels.forEach((level) => {
        const y = padding.top + plotH - level.ratio * plotH;
        const line = document.createElementNS(svgNS, 'line');
        line.setAttribute('class', 'line-grid-line');
        line.setAttribute('x1', String(padding.left));
        line.setAttribute('x2', String(padding.left + plotW));
        line.setAttribute('y1', String(y));
        line.setAttribute('y2', String(y));
        svg.append(line);

        const text = document.createElementNS(svgNS, 'text');
        text.setAttribute('class', 'line-axis-label');
        text.setAttribute('x', String(padding.left - 8));
        text.setAttribute('y', String(y + 3));
        text.setAttribute('text-anchor', 'end');
        text.textContent = level.label;
        svg.append(text);
    });

    const points = dailyStats.days.map((day, idx) => {
        const x = padding.left + (idx / (dailyStats.daysInMonth - 1)) * plotW;
        const val = day[type];
        const y = padding.top + plotH - (maxVal > 0 ? (val / niceMax) * plotH : 0);
        return { x, y, day, val, index: idx };
    });

    const smoothLinePath = buildSmoothPath(points);
    const baselineY = padding.top + plotH;

    if (smoothLinePath) {
        const areaPath = document.createElementNS(svgNS, 'path');
        const lastPt = points[points.length - 1];
        const firstPt = points[0];
        areaPath.setAttribute('d', `${smoothLinePath} L ${lastPt.x.toFixed(1)} ${baselineY.toFixed(1)} L ${firstPt.x.toFixed(1)} ${baselineY.toFixed(1)} Z`);
        areaPath.setAttribute('fill', `url(#${gradId})`);
        svg.append(areaPath);

        const strokeLine = document.createElementNS(svgNS, 'path');
        strokeLine.setAttribute('d', smoothLinePath);
        strokeLine.setAttribute('class', isIncome ? 'line-path-income' : 'line-path-expense');
        svg.append(strokeLine);
    }

    const labelDays = new Set([1, 5, 10, 15, 20, 25, dailyStats.daysInMonth]);
    points.forEach((pt) => {
        if (labelDays.has(pt.day.day)) {
            const dateText = document.createElementNS(svgNS, 'text');
            dateText.setAttribute('class', 'line-axis-label');
            dateText.setAttribute('x', String(pt.x));
            dateText.setAttribute('y', String(baselineY + 16));
            dateText.setAttribute('text-anchor', 'middle');
            dateText.textContent = String(pt.day.day);
            svg.append(dateText);
        }

        if (pt.val > 0) {
            const circle = document.createElementNS(svgNS, 'circle');
            circle.setAttribute('cx', String(pt.x));
            circle.setAttribute('cy', String(pt.y));
            circle.setAttribute('r', pt.val === maxVal ? '4.5' : '3');
            circle.setAttribute('class', isIncome ? 'line-point-income' : 'line-point-expense');
            if (pt.val === maxVal) circle.classList.add('is-peak');
            svg.append(circle);
        }
    });

    const crosshair = document.createElementNS(svgNS, 'line');
    crosshair.setAttribute('class', 'line-crosshair');
    crosshair.setAttribute('y1', String(padding.top));
    crosshair.setAttribute('y2', String(baselineY));
    crosshair.style.display = 'none';
    svg.append(crosshair);

    const activeDot = document.createElementNS(svgNS, 'circle');
    activeDot.setAttribute('class', `line-active-dot ${type}`);
    activeDot.setAttribute('r', '4.5');
    activeDot.style.display = 'none';
    svg.append(activeDot);

    const handlePointer = (event) => {
        const rect = svg.getBoundingClientRect();
        if (!rect.width) return;
        const clientX = event.touches ? event.touches[0].clientX : event.clientX;
        const mouseX = ((clientX - rect.left) / rect.width) * 680;
        const dayIdx = Math.round(((mouseX - padding.left) / plotW) * (dailyStats.daysInMonth - 1));
        const clampedIdx = Math.max(0, Math.min(dailyStats.daysInMonth - 1, dayIdx));
        const pt = points[clampedIdx];
        if (!pt) return;

        crosshair.setAttribute('x1', String(pt.x));
        crosshair.setAttribute('x2', String(pt.x));
        crosshair.style.display = 'block';

        activeDot.setAttribute('cx', String(pt.x));
        activeDot.setAttribute('cy', String(pt.y));
        activeDot.style.display = 'block';

        if (tooltipEl) {
            tooltipEl.replaceChildren();

            const dateHeader = document.createElement('div');
            dateHeader.className = 'chart-tooltip-date';
            dateHeader.textContent = fullDateFormatter.format(pt.day.date);

            const row = document.createElement('div');
            row.className = 'chart-tooltip-row';
            row.innerHTML = `<span>${isIncome ? 'Pemasukan' : 'Pengeluaran'}</span><strong class="${isIncome ? 'text-income' : 'text-expense'}">${formatCurrency(pt.val)}</strong>`;

            const countRow = document.createElement('div');
            countRow.className = 'chart-tooltip-row';
            const txs = pt.day[type + 'Transactions'];
            countRow.innerHTML = `<span>Transaksi</span><strong>${txs.length} kali</strong>`;

            tooltipEl.append(dateHeader, row, countRow);

            if (txs.length > 0) {
                const txsWrap = document.createElement('div');
                txsWrap.className = 'chart-tooltip-txs';
                txs.slice(0, 3).forEach((tx) => {
                    const item = document.createElement('div');
                    item.className = 'chart-tooltip-tx-item';
                    const desc = document.createElement('span');
                    desc.textContent = tx.desc || tx.category || 'Transaksi';
                    const val = document.createElement('strong');
                    val.className = isIncome ? 'text-income' : 'text-expense';
                    val.textContent = `${isIncome ? '+' : '-'}${formatCurrency(Number(tx.amount) || 0)}`;
                    item.append(desc, val);
                    txsWrap.append(item);
                });
                if (txs.length > 3) {
                    const more = document.createElement('span');
                    more.textContent = `+${txs.length - 3} lainnya`;
                    txsWrap.append(more);
                }
                tooltipEl.append(txsWrap);
            }

            tooltipEl.hidden = false;
            const leftPct = (pt.x / 680) * 100;
            const topPct = (pt.y / 170) * 100;
            tooltipEl.style.left = `${leftPct}%`;
            tooltipEl.style.top = `${topPct}%`;
        }
    };

    const handlePointerLeave = () => {
        crosshair.style.display = 'none';
        activeDot.style.display = 'none';
        if (tooltipEl) tooltipEl.hidden = true;
    };

    svg.addEventListener('pointermove', handlePointer);
    svg.addEventListener('pointerleave', handlePointerLeave);
    svg.addEventListener('touchstart', handlePointer, { passive: true });
    svg.addEventListener('touchmove', handlePointer, { passive: true });
    svg.addEventListener('touchend', handlePointerLeave);

    containerEl.append(svg);
}

function renderDailyCharts(monthTransactions) {
    const dailyStats = getMonthlyDailyStats(monthTransactions);
    renderDailyCashStackedChart(dailyStats);
    renderDailyLineChart(dailyStats, 'income');
    renderDailyLineChart(dailyStats, 'expense');
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

async function handleSupabaseSession(session) {
    const loginAttempt = ++authGeneration;
    const accessToken = session?.access_token;
    const authUser = session?.user;
    if (!accessToken || !authUser?.id) return;

    elements.authStatus.textContent = 'Menyiapkan akun…';
    try {
        const response = await fetch(AUTH_SESSION_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: 'application/json'
            }
        });
        const result = await response.json().catch(() => ({}));
        if (loginAttempt !== authGeneration) return;
        if (!response.ok) throw new Error(result.error || `Server merespons ${response.status}`);
        if (!result.user?.id || !result.user?.email) throw new Error('Identitas akun dari server tidak valid.');

        supabaseAccessToken = accessToken;
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
        console.error('Gagal menyiapkan sesi Supabase:', error);
        supabaseAccessToken = null;
        signedInUser = null;
        elements.authStatus.textContent = error.message || 'Sesi akun gagal disiapkan. Silakan coba lagi.';
        const { error: signOutError } = await supabaseAuth.auth.signOut();
        if (signOutError) console.error('Gagal membersihkan sesi Supabase:', signOutError);
    }
}

async function initializeSupabaseAuthentication() {
    elements.authStatus.textContent = 'Menghubungkan ke Supabase…';
    try {
        const response = await fetch(AUTH_CONFIG_URL, { headers: { Accept: 'application/json' } });
        const config = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(config.error || `Server merespons ${response.status}`);
        if (!config.supabaseUrl || !config.supabaseAnonKey) {
            throw new Error('Konfigurasi Supabase belum tersedia di server.');
        }
        if (!window.supabase?.createClient) {
            throw new Error('Library Supabase gagal dimuat. Periksa koneksi lalu muat ulang.');
        }

        supabaseAuth = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
        supabaseAuth.auth.onAuthStateChange((event, session) => {
            if (session?.access_token) {
                supabaseAccessToken = session.access_token;
                if (signedInUser?.id === session.user.id && elements.appShell.classList.contains('is-authenticated')) return;
                window.setTimeout(() => handleSupabaseSession(session), 0);
            } else if (event === 'SIGNED_OUT') {
                signOut(false, false);
            }
        });
        elements.authForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const email = elements.authEmail.value.trim().toLowerCase();
            const password = elements.authPassword.value;
            elements.authSubmitButton.disabled = true;
            elements.authModeToggle.disabled = true;
            elements.authStatus.textContent = authMode === 'signup' ? 'Membuat akun…' : 'Memeriksa akun…';
            try {
                if (authMode === 'signup') {
                    const { data, error } = await supabaseAuth.auth.signUp({
                        email,
                        password,
                        options: { emailRedirectTo: window.location.origin }
                    });
                    if (error) throw error;
                    if (!data.session) {
                        elements.authStatus.textContent = 'Akun dibuat. Periksa email untuk mengonfirmasi pendaftaran sebelum masuk.';
                    }
                } else {
                    const { error } = await supabaseAuth.auth.signInWithPassword({ email, password });
                    if (error) throw error;
                }
            } catch (error) {
                console.error(authMode === 'signup' ? 'Gagal membuat akun Supabase:' : 'Gagal masuk ke Supabase:', error);
                elements.authStatus.textContent = error.message || (authMode === 'signup'
                    ? 'Akun gagal dibuat. Silakan coba lagi.'
                    : 'Login gagal. Periksa email dan password.');
            } finally {
                elements.authSubmitButton.disabled = false;
                elements.authModeToggle.disabled = false;
            }
        });
        elements.authModeToggle.addEventListener('click', () => {
            authMode = authMode === 'signin' ? 'signup' : 'signin';
            elements.authPassword.autocomplete = authMode === 'signup' ? 'new-password' : 'current-password';
            const title = document.createElement('span');
            title.textContent = ' Saku Harian.';
            elements.authTitle.replaceChildren(
                document.createTextNode(authMode === 'signup' ? 'Buat akun di' : 'Masuk ke'),
                title
            );
            elements.authSubmitButton.textContent = authMode === 'signup' ? 'Buat akun' : 'Masuk';
            elements.authDescription.textContent = authMode === 'signup'
                ? 'Buat akun untuk menyimpan transaksi dan menautkan bot Telegram milikmu.'
                : 'Masuk dengan email dan password untuk melihat data keuangan milik akunmu.';
            elements.authModePrompt.textContent = authMode === 'signup' ? 'Sudah punya akun?' : 'Belum punya akun?';
            elements.authModeToggle.textContent = authMode === 'signup' ? 'Masuk' : 'Buat akun';
            elements.authStatus.textContent = '';
        });
        elements.authStatus.textContent = 'Masuk atau buat akun untuk melanjutkan.';
    } catch (error) {
        console.error('Gagal menyiapkan Supabase Authentication:', error);
        elements.authStatus.textContent = error.message || 'Supabase Auth belum bisa disiapkan. Coba muat ulang.';
    }
}

async function createTelegramLinkCode() {
    elements.telegramLinkDialog.showModal();
    elements.telegramLinkCode.textContent = 'Meminta kode…';
    elements.telegramLinkStatus.textContent = '';
    elements.copyTelegramLinkCode.disabled = true;
    try {
        const response = await apiFetch(`${API_BASE_URL}/telegram/link-code`, {
            method: 'POST',
            headers: { Accept: 'application/json' }
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `Server merespons ${response.status}`);
        elements.telegramLinkCode.textContent = `/link ${result.code}`;
        elements.copyTelegramLinkCode.disabled = false;
        elements.telegramLinkStatus.textContent = 'Kirim kode ini di chat pribadi bot @duitandaBOT.';
    } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Gagal membuat kode tautan Telegram:', error);
        elements.telegramLinkCode.textContent = 'Kode belum tersedia.';
        elements.telegramLinkStatus.textContent = error.message || 'Kode tidak dapat dibuat. Silakan coba lagi.';
    }
}

function signOut(showStatus = true, revokeSession = true) {
    if (revokeSession && supabaseAuth) {
        supabaseAuth.auth.signOut().then(({ error }) => {
            if (error) console.error('Gagal keluar dari Supabase:', error);
        });
    }
    authGeneration += 1;
    supabaseAccessToken = null;
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
    if (elements.dailyStackedChart) elements.dailyStackedChart.replaceChildren();
    if (elements.dailyCashCaption) elements.dailyCashCaption.textContent = '';
    if (elements.incomeLineChart) elements.incomeLineChart.replaceChildren();
    if (elements.incomeLineCaption) elements.incomeLineCaption.textContent = '';
    if (elements.expenseLineChart) elements.expenseLineChart.replaceChildren();
    if (elements.expenseLineCaption) elements.expenseLineCaption.textContent = '';
    if (elements.stackedChartTooltip) elements.stackedChartTooltip.hidden = true;
    if (elements.incomeLineTooltip) elements.incomeLineTooltip.hidden = true;
    if (elements.expenseLineTooltip) elements.expenseLineTooltip.hidden = true;
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
    if (showStatus) elements.authStatus.textContent = 'Anda telah keluar. Masuk kembali untuk melanjutkan.';
}

async function requestFinancialAnalysis() {
    const button = elements.analysisButton;
    const requestGeneration = authGeneration;
    button.disabled = true;
    button.textContent = 'Menganalisis…';
    elements.analysisResult.hidden = false;
    elements.analysisResult.textContent = 'Mengirim ringkasan keuangan agregat ke Google Gemini…';

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
    loadingState.append(spinner, document.createTextNode('Memuat transaksi…'));
    elements.transactionList.replaceChildren(loadingState);

    try {
        const response = await apiFetch(TRANSACTIONS_URL, {
            headers: { Accept: 'application/json' }
        });
        if (!response.ok) {
            const errorBody = await response.json().catch(() => null);
            throw new Error(errorBody?.error || `Server merespons ${response.status}`);
        }

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
        if (transactions.length) {
            renderDashboard();
        } else {
            elements.transactionList.replaceChildren();
            elements.transactionList.hidden = true;
            elements.emptyState.hidden = false;
            elements.emptyState.querySelector('strong').textContent = 'Data belum bisa dimuat';
            elements.emptyState.querySelector('span:not(.empty-illustration)').textContent = error.message || 'Periksa koneksi internetmu lalu coba muat ulang.';
            elements.emptyState.querySelector('[data-open-form]').hidden = true;
        }
        setNotice(`Gagal mengambil transaksi dari server: ${error.message || 'Coba lagi beberapa saat.'}`, 'error');
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
    elements.saveButton.textContent = 'Menyimpan…';
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
elements.telegramLinkButton.addEventListener('click', createTelegramLinkCode);
document.getElementById('closeTelegramLink').addEventListener('click', () => elements.telegramLinkDialog.close());
elements.copyTelegramLinkCode.addEventListener('click', async () => {
    const code = elements.telegramLinkCode.textContent;
    if (!code.startsWith('/link ')) return;
    try {
        await navigator.clipboard.writeText(code);
        elements.telegramLinkStatus.textContent = 'Kode berhasil disalin. Tempelkan di chat bot Telegram.';
    } catch (error) {
        console.error('Gagal menyalin kode tautan Telegram:', error);
        elements.telegramLinkStatus.textContent = 'Tidak dapat menyalin otomatis. Silakan pilih dan salin kode secara manual.';
    }
});
initializeSupabaseAuthentication();
