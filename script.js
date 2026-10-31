const API_BASE_URL = 'https://saku-sloth.vercel.app/api';
const TRANSACTIONS_URL = `${API_BASE_URL}/transactions`;
const VISIBLE_TRANSACTION_LIMIT = 6;
const CATEGORY_COLORS = ['#89bd5c', '#e9756a', '#6b96d6', '#f5b942', '#9b7ede', '#57b8a6', '#e79a5a'];

const STORAGE_KEYS = {
    theme: 'saku-theme',
    bills: 'saku-monthly-bills-v1',
    budget: 'saku-monthly-budget-v1',
    dateOverrides: 'saku-trx-date-overrides-v1',
    localTrxCache: 'saku-local-trx-cache-v1',
    gsheetWebhook: 'saku-gsheet-webhook-v1',
    notifiedBills: 'saku-notified-bills-session'
};

const DEFAULT_BILLS = [
    { id: 'bill-pln', name: 'Listrik PLN & Token', amount: 350000, dueDay: 20, category: 'Tagihan & Utilitas', paidMonths: [] },
    { id: 'bill-wifi', name: 'WiFi & Internet Rumah', amount: 320000, dueDay: 15, category: 'Langganan Digital', paidMonths: [] },
    { id: 'bill-bpjs', name: 'BPJS / Asuransi Kesehatan', amount: 150000, dueDay: 10, category: 'Kesehatan', paidMonths: [] },
    { id: 'bill-stream', name: 'Langganan Hiburan / Cloud', amount: 85000, dueDay: 28, category: 'Langganan Digital', paidMonths: [] }
];

const SLOTH_TIPS = [
    '🦥 Tips Saku: Gunakan rumus 50/30/20! Maksimal 50% kebutuhan pokok, 30% keinginan, dan minimal 20% langsung ditabung di awal gajian.',
    '🪙 Tips Saku: Sebelum beli barang keinginan di atas Rp150rb, coba tunggu 24 jam. Kalau besoknya sudah lupa, berarti kamu nggak butuh!',
    '📅 Tips Saku: Cek kalender bulananmu tiap malam selama 1 menit. Kebiasaan kecil ini bisa memangkas pengeluaran bocor hingga 22%!',
    '🔔 Tips Saku: Bayar tagihan rutin sebelum jatuh tempo supaya bebas denda dan skor kesehatan finansialmu tetap 100!',
    '🌱 Tips Saku: Selalu patuhi angka "Jatah Aman Hari Ini" (Safe-to-Spend) agar saldo akhir bulanmu tetap surplus!'
];

const elements = {
    balance: document.getElementById('balanceValue'),
    balanceCaption: document.getElementById('balanceCaption'),
    safeSpendValue: document.getElementById('safeSpendValue'),
    safeSpendCaption: document.getElementById('safeSpendCaption'),
    dailySpendBar: document.getElementById('dailySpendBar'),
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
    notice: document.getElementById('notice'),
    dialog: document.getElementById('transactionDialog'),
    form: document.getElementById('transactionForm'),
    formError: document.getElementById('formError'),
    saveButton: document.getElementById('saveTransaction'),
    // Calendar & Timeline
    calendarMonthHeading: document.getElementById('calendarMonthHeading'),
    gcalGrid: document.getElementById('gcalGrid'),
    gcalContainer: document.getElementById('gcalContainer'),
    calendarWorkspace: document.getElementById('calendarWorkspace'),
    selectedDayEyebrow: document.getElementById('selectedDayEyebrow'),
    selectedDayTitle: document.getElementById('selectedDayTitle'),
    selectedDaySummary: document.getElementById('selectedDaySummary'),
    selectedDayEvents: document.getElementById('selectedDayEvents'),
    monthlyTimelineWrap: document.getElementById('monthlyTimelineWrap'),
    monthlyBarTimeline: document.getElementById('monthlyBarTimeline'),
    monthlyTimelineStream: document.getElementById('monthlyTimelineStream'),
    timelineSummaryChip: document.getElementById('timelineSummaryChip'),
    // Smart Planner
    financialScoreValue: document.getElementById('financialScoreValue'),
    budgetReferenceLabel: document.getElementById('budgetReferenceLabel'),
    needsRatioText: document.getElementById('needsRatioText'),
    wantsRatioText: document.getElementById('wantsRatioText'),
    savingsRatioText: document.getElementById('savingsRatioText'),
    needsBar: document.getElementById('needsBar'),
    wantsBar: document.getElementById('wantsBar'),
    savingsBar: document.getElementById('savingsBar'),
    statDailyMean: document.getElementById('statDailyMean'),
    statMonthProjection: document.getElementById('statMonthProjection'),
    statAnomalyThreshold: document.getElementById('statAnomalyThreshold'),
    statPotentialSaving: document.getElementById('statPotentialSaving'),
    recommendationsGrid: document.getElementById('recommendationsGrid'),
    // Bills & Notifications
    billsGrid: document.getElementById('billsGrid'),
    billTotalAmount: document.getElementById('billTotalAmount'),
    billUnpaidAmount: document.getElementById('billUnpaidAmount'),
    billPaidCount: document.getElementById('billPaidCount'),
    notifBadge: document.getElementById('notifBadge'),
    navBillBadge: document.getElementById('navBillBadge'),
    notifPopover: document.getElementById('notifPopover'),
    notifList: document.getElementById('notifList'),
    urgentBillBanner: document.getElementById('urgentBillBanner'),
    urgentBillTitle: document.getElementById('urgentBillTitle'),
    urgentBillDesc: document.getElementById('urgentBillDesc'),
    // Mascot & Modals
    mascotStage: document.getElementById('mascotStage'),
    mascotSpeech: document.getElementById('mascotSpeech'),
    mascotMouth: document.getElementById('mascotMouth'),
    mascotSweat: document.getElementById('mascotSweat'),
    plannerMoodBadge: document.getElementById('plannerMoodBadge'),
    billDialog: document.getElementById('billDialog'),
    billForm: document.getElementById('billForm'),
    budgetDialog: document.getElementById('budgetDialog'),
    budgetForm: document.getElementById('budgetForm'),
    monthlyBudgetInput: document.getElementById('monthlyBudgetInput'),
    gsheetDialog: document.getElementById('gsheetDialog'),
    gsheetWebhookUrl: document.getElementById('gsheetWebhookUrl')
};

let transactions = [];
let bills = loadBills();
let monthlyBudgetTarget = Number(localStorage.getItem(STORAGE_KEYS.budget) || 0);
let showAllTransactions = false;
let selectedDateKey = localDateKey(new Date());
let calendarViewMode = 'both';
let noticeTimeout;
let slothTipIndex = 0;

const currencyFormatter = new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
});

const compactCurrencyFormatter = new Intl.NumberFormat('id-ID', {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 1
});

const dateFormatter = new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
});

const fullDateFormatter = new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
});

function localMonthValue(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function localDateKey(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatCurrency(amount) {
    return currencyFormatter.format(Number.isFinite(amount) ? Math.round(amount) : 0);
}

function formatCompactRp(amount) {
    if (!Number.isFinite(amount) || amount === 0) return 'Rp0';
    return `Rp${compactCurrencyFormatter.format(Math.abs(amount))}`;
}

function formatTransactionDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Tanggal tidak tersedia';
    return dateFormatter.format(date);
}

function loadDateOverrides() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEYS.dateOverrides) || '{}');
    } catch {
        return {};
    }
}

function saveDateOverride(id, dateStr) {
    if (!id || !dateStr) return;
    const overrides = loadDateOverrides();
    overrides[String(id)] = dateStr;
    localStorage.setItem(STORAGE_KEYS.dateOverrides, JSON.stringify(overrides));
}

function applyDateOverrides(list) {
    const overrides = loadDateOverrides();
    return list.map((trx) => {
        const overrideDate = overrides[String(trx.id)];
        if (overrideDate) {
            return { ...trx, date: `${overrideDate}T12:00:00` };
        }
        return trx;
    });
}

function loadBills() {
    try {
        const raw = localStorage.getItem(STORAGE_KEYS.bills);
        if (!raw) {
            localStorage.setItem(STORAGE_KEYS.bills, JSON.stringify(DEFAULT_BILLS));
            return [...DEFAULT_BILLS];
        }
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [...DEFAULT_BILLS];
    } catch {
        return [...DEFAULT_BILLS];
    }
}

function saveBills() {
    localStorage.setItem(STORAGE_KEYS.bills, JSON.stringify(bills));
}

function getCategoryIcon(category, type) {
    if (type === 'income') return { name: 'arrow-down-left', tone: 'income' };

    const normalized = String(category || '').toLocaleLowerCase('id-ID');
    if (/makan|minum|kuliner|resto|kopi|jajan/.test(normalized)) return { name: 'utensils', tone: 'food' };
    if (/transport|bensin|kendaraan|ojek|parkir/.test(normalized)) return { name: 'car-front', tone: 'transport' };
    if (/belanja|shop|lifestyle|hiburan/.test(normalized)) return { name: 'shopping-bag', tone: 'shopping' };
    if (/tagihan|listrik|utilitas|air|cicilan|kredit/.test(normalized)) return { name: 'zap', tone: 'bills' };
    if (/kesehatan|obat|medis|bpjs/.test(normalized)) return { name: 'heart-pulse', tone: 'health' };
    if (/gaji|salary|kerja|bonus/.test(normalized)) return { name: 'briefcase-business', tone: 'income' };
    if (/rumah|sewa|hunian|kost|kpr/.test(normalized)) return { name: 'house', tone: 'home' };
    if (/langganan|digital|internet|wifi|streaming/.test(normalized)) return { name: 'monitor-play', tone: 'digital' };
    return { name: 'receipt-text', tone: 'other' };
}

function classifyExpenseBucket(category, desc) {
    const text = `${category || ''} ${desc || ''}`.toLocaleLowerCase('id-ID');
    if (/tabungan|investasi|dana darurat|reksadana|emas|deposito/.test(text)) return 'savings';
    if (/belanja|lifestyle|hiburan|kopi|nongkrong|game|streaming|bioskop|liburan|snack|jajan|fashion|hobi/.test(text)) return 'wants';
    return 'needs';
}

/* ================= ANIMASI KARTUN & PARTIKEL KOIN ================= */
function triggerCartoonCelebration(count = 14) {
    const container = document.getElementById('cartoonCelebration');
    if (!container) return;
    const symbols = ['🪙', '✨', '💰', '★', 'Rp', '🎉', '🦥'];

    for (let i = 0; i < count; i++) {
        const particle = document.createElement('span');
        particle.className = 'confetti-coin';
        particle.textContent = symbols[i % symbols.length];
        const startX = 35 + Math.random() * 35;
        const startY = 25 + Math.random() * 30;
        const tx = (Math.random() - 0.5) * 260;
        const ty = -80 - Math.random() * 160;
        const rot = (Math.random() - 0.5) * 520;

        particle.style.left = `${startX}vw`;
        particle.style.top = `${startY}vh`;
        particle.style.setProperty('--tx', `${tx}px`);
        particle.style.setProperty('--ty', `${ty}px`);
        particle.style.setProperty('--rot', `${rot}deg`);
        container.append(particle);
        window.setTimeout(() => particle.remove(), 1400);
    }
}

function updateMascotMood(mood, customMessage) {
    if (!elements.mascotMouth || !elements.mascotSweat) return;

    if (mood === 'danger') {
        elements.mascotMouth.setAttribute('d', 'M111 97C115 91 125 91 129 97');
        elements.mascotSweat.setAttribute('opacity', '1');
        elements.plannerMoodBadge.textContent = '🚨 Waspada Arus Kas!';
        elements.plannerMoodBadge.style.background = '#ffd5cf';
        elements.plannerMoodBadge.style.color = '#8c271e';
    } else if (mood === 'warning') {
        elements.mascotMouth.setAttribute('d', 'M112 95L128 95');
        elements.mascotSweat.setAttribute('opacity', '0.85');
        elements.plannerMoodBadge.textContent = '⚠️ Rem Belanja Harian';
        elements.plannerMoodBadge.style.background = '#ffe8b3';
        elements.plannerMoodBadge.style.color = '#7a5206';
    } else {
        elements.mascotMouth.setAttribute('d', 'M110 92C115 100 125 100 130 92');
        elements.mascotSweat.setAttribute('opacity', '0');
        elements.plannerMoodBadge.textContent = '✨ Smart Planner Sehat';
        elements.plannerMoodBadge.style.background = '';
        elements.plannerMoodBadge.style.color = '';
    }

    if (customMessage) {
        elements.mascotSpeech.textContent = customMessage;
    }
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

function getDaysInMonth(monthStr) {
    const [year, month] = monthStr.split('-').map(Number);
    return new Date(year, month, 0).getDate();
}

/* ================= FINANCIAL PLANNER JS ENGINE (SIMPLE-STATISTICS + 50/30/20) ================= */
function runFinancialPlannerEngine(monthTransactions, income, expense) {
    const ss = window.ss;
    const selectedMonth = elements.monthFilter.value;
    const totalDaysInMonth = getDaysInMonth(selectedMonth);
    const today = new Date();
    const isCurrentMonth = localMonthValue(today) === selectedMonth;
    const elapsedDays = isCurrentMonth ? Math.max(1, today.getDate()) : totalDaysInMonth;
    const remainingDays = isCurrentMonth ? Math.max(1, totalDaysInMonth - today.getDate() + 1) : 1;

    // Basis anggaran: Target manual user atau Pemasukan bulan ini
    const baseBudget = monthlyBudgetTarget > 0 ? monthlyBudgetTarget : income;
    elements.budgetReferenceLabel.textContent = monthlyBudgetTarget > 0
        ? `Basis Target: ${formatCurrency(monthlyBudgetTarget)}`
        : income > 0
            ? `Basis Pemasukan: ${formatCurrency(income)}`
            : 'Belum ada basis anggaran';

    // Hitung pengeluaran hari ini
    const todayKey = localDateKey(today);
    const todayExpense = monthTransactions
        .filter((t) => t.type !== 'income' && localDateKey(t.date) === todayKey)
        .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    // Hitung Safe-to-Spend Harian
    const unpaidBillsTotal = bills
        .filter((b) => !Array.isArray(b.paidMonths) || !b.paidMonths.includes(selectedMonth))
        .reduce((sum, b) => sum + (Number(b.amount) || 0), 0);

    const remainingSpendable = Math.max(0, (baseBudget || income) - expense - unpaidBillsTotal);
    const dailySafeToSpend = remainingDays > 0 ? remainingSpendable / remainingDays : 0;

    elements.safeSpendValue.textContent = formatCurrency(dailySafeToSpend);
    elements.safeSpendCaption.textContent = `Hari ini keluar ${formatCurrency(todayExpense)} · Sisa ${remainingDays} hari`;
    const dailyUsageRatio = dailySafeToSpend > 0 ? Math.min(100, Math.round((todayExpense / dailySafeToSpend) * 100)) : (todayExpense > 0 ? 100 : 0);
    elements.dailySpendBar.style.width = `${dailyUsageRatio}%`;
    elements.dailySpendBar.style.background = dailyUsageRatio > 90 ? '#e9756a' : dailyUsageRatio > 70 ? '#f5b942' : '#6da638';

    // Klasifikasi 50/30/20
    let needsTotal = 0;
    let wantsTotal = 0;
    let explicitSavings = 0;
    const expenseAmounts = [];
    const dailyExpenseMap = new Map();
    const categoryMap = new Map();

    monthTransactions.forEach((t) => {
        const amt = Number(t.amount) || 0;
        if (t.type === 'income' || amt <= 0) return;
        expenseAmounts.push(amt);

        const dayKey = localDateKey(t.date);
        dailyExpenseMap.set(dayKey, (dailyExpenseMap.get(dayKey) || 0) + amt);

        const cat = String(t.category || 'Umum').trim() || 'Umum';
        categoryMap.set(cat, (categoryMap.get(cat) || 0) + amt);

        const bucket = classifyExpenseBucket(t.category, t.desc);
        if (bucket === 'wants') wantsTotal += amt;
        else if (bucket === 'savings') explicitSavings += amt;
        else needsTotal += amt;
    });

    const netSavings = Math.max(0, (income - expense) + explicitSavings);
    const denom = Math.max(1, baseBudget || expense || 1);
    const needsPct = Math.round((needsTotal / denom) * 100);
    const wantsPct = Math.round((wantsTotal / denom) * 100);
    const savingsPct = baseBudget > 0 || income > 0 ? Math.max(0, Math.round((netSavings / denom) * 100)) : 0;

    elements.needsRatioText.textContent = `${needsPct}% (${formatCurrency(needsTotal)})`;
    elements.wantsRatioText.textContent = `${wantsPct}% (${formatCurrency(wantsTotal)})`;
    elements.savingsRatioText.textContent = `${savingsPct}% (${formatCurrency(netSavings)})`;

    elements.needsBar.style.width = `${Math.min(100, needsPct)}%`;
    elements.wantsBar.style.width = `${Math.min(100, wantsPct)}%`;
    elements.savingsBar.style.width = `${Math.min(100, savingsPct)}%`;

    // Statistik menggunakan library simple-statistics (window.ss)
    const dailySeries = [];
    const regressionPoints = [];
    let cumulative = 0;
    for (let d = 1; d <= elapsedDays; d++) {
        const key = `${selectedMonth}-${String(d).padStart(2, '0')}`;
        const daySpend = dailyExpenseMap.get(key) || 0;
        dailySeries.push(daySpend);
        cumulative += daySpend;
        regressionPoints.push([d, cumulative]);
    }

    const dailyMean = ss && dailySeries.length ? ss.mean(dailySeries) : (expense / elapsedDays);
    const trxMean = ss && expenseAmounts.length ? ss.mean(expenseAmounts) : 0;
    const trxStdDev = ss && expenseAmounts.length > 1 ? ss.standardDeviation(expenseAmounts) : 0;
    const anomalyThreshold = trxMean + 1.5 * trxStdDev;

    // Proyeksi akhir bulan dengan regresi linier simple-statistics
    let projectedMonthExpense = dailyMean * totalDaysInMonth;
    if (ss && regressionPoints.length >= 2) {
        const line = ss.linearRegressionLine(ss.linearRegression(regressionPoints));
        const regressedEnd = line(totalDaysInMonth);
        if (Number.isFinite(regressedEnd) && regressedEnd >= expense) {
            projectedMonthExpense = (regressedEnd + projectedMonthExpense) / 2;
        }
    }

    // Potensi penghematan (30% dari kelebihan Wants + 15% dari kategori terbesar + pemangkasan anomali)
    const sortedCategories = [...categoryMap.entries()].sort((a, b) => b[1] - a[1]);
    const topCategory = sortedCategories[0];
    const wantsExcess = baseBudget > 0 ? Math.max(0, wantsTotal - baseBudget * 0.3) : wantsTotal * 0.25;
    const topCatSaving = topCategory ? topCategory[1] * 0.15 : 0;
    const potentialSaving = Math.max(wantsExcess, topCatSaving, expense * 0.12);

    elements.statDailyMean.textContent = formatCurrency(dailyMean);
    elements.statMonthProjection.textContent = formatCurrency(projectedMonthExpense);
    elements.statAnomalyThreshold.textContent = formatCurrency(anomalyThreshold);
    elements.statPotentialSaving.textContent = formatCurrency(potentialSaving);

    // Hitung Skor Kesehatan Finansial (0-100)
    let score = 100;
    if (expense > income && income > 0) score -= 35;
    else if (income > 0 && expense / income > 0.8) score -= 18;
    if (wantsPct > 30) score -= Math.min(20, Math.round((wantsPct - 30) * 0.8));
    if (needsPct > 55) score -= Math.min(15, Math.round((needsPct - 55) * 0.5));
    if (savingsPct < 20 && (income > 0 || baseBudget > 0)) score -= 10;
    score = Math.max(15, Math.min(100, score));
    elements.financialScoreValue.textContent = `${score}/100`;

    // Update ekspresi kartun Saku si Sloth
    if (expense > income && income > 0) {
        updateMascotMood('danger', `Waduh! Pengeluaran bulan ini sudah melampaui pemasukan sebesar ${formatCurrency(expense - income)}. Yuk tahan belanja keinginan dulu!`);
    } else if ((baseBudget > 0 && projectedMonthExpense > baseBudget) || (income > 0 && expense / income >= 0.8)) {
        updateMascotMood('warning', `Hati-hati! Berdasarkan regresi statistik, proyeksi pengeluaran akhir bulanmu mencapai ${formatCurrency(projectedMonthExpense)}. Patuhi jatah harian ${formatCurrency(dailySafeToSpend)} ya!`);
    } else {
        updateMascotMood('happy', `Keren! Skor finansialmu ${score}/100. Jatah aman belanjamu hari ini adalah ${formatCurrency(dailySafeToSpend)} agar target tabungan tetap aman.`);
    }

    // Buat Kartu Rekomendasi Penghematan
    const recommendations = [];

    if (topCategory) {
        const [catName, catAmount] = topCategory;
        const catSave = Math.round(catAmount * 0.2);
        recommendations.push({
            emoji: '✂️',
            tag: 'Prioritas Utama',
            priority: 'high',
            title: `Optimalkan Pos "${catName}"`,
            desc: `Pos ${catName} menyerap ${Math.round((catAmount / Math.max(1, expense)) * 100)}% dari total pengeluaranmu (${formatCurrency(catAmount)}). Pangkas 20% dengan batas mingguan.`,
            savingText: `Hemat ${formatCurrency(catSave)}/bln`
        });
    }

    if (wantsPct > 30 || wantsTotal > 0) {
        const targetWants = baseBudget > 0 ? baseBudget * 0.3 : expense * 0.25;
        const saveWants = Math.max(Math.round(wantsTotal * 0.25), Math.round(wantsTotal - targetWants));
        recommendations.push({
            emoji: '☕',
            tag: 'Aturan 50/30/20',
            priority: wantsPct > 30 ? 'high' : 'medium',
            title: 'Diet Gaya Hidup & Impulse Buying',
            desc: `Porsi keinginan (Wants) saat ini ${wantsPct}% (${formatCurrency(wantsTotal)}). Terapkan aturan tunda 24 jam sebelum checkout belanja non-esensial.`,
            savingText: `Hemat ${formatCurrency(Math.max(25000, saveWants))}/bln`
        });
    }

    const anomalyTrx = monthTransactions.filter((t) => t.type !== 'income' && Number(t.amount) > anomalyThreshold && anomalyThreshold > 0);
    if (anomalyTrx.length > 0) {
        const biggest = anomalyTrx.sort((a, b) => Number(b.amount) - Number(a.amount))[0];
        recommendations.push({
            emoji: '📊',
            tag: 'Deteksi Statistik JS',
            priority: 'medium',
            title: `${anomalyTrx.length} Transaksi di Atas Batas Wajar`,
            desc: `Simple-Statistics mendeteksi lonjakan pada "${biggest.desc}" (${formatCurrency(Number(biggest.amount))}), melampaui batas wajar ${formatCurrency(anomalyThreshold)}.`,
            savingText: `Cegah bocor ${formatCurrency(Number(biggest.amount) * 0.3)}`
        });
    } else {
        recommendations.push({
            emoji: '🎯',
            tag: 'Daily Safe-to-Spend',
            priority: 'good',
            title: 'Jaga Ritme Pengeluaran Harian',
            desc: `Rata-rata pengeluaran harianmu ${formatCurrency(dailyMean)}/hari. Pertahankan di bawah batas aman ${formatCurrency(dailySafeToSpend)}/hari untuk sisa bulan ini.`,
            savingText: `Target Sisa ${formatCurrency(remainingSpendable)}`
        });
    }

    const idealSaving = Math.max(income * 0.2, baseBudget * 0.2, 250000);
    recommendations.push({
        emoji: '🐷',
        tag: 'Pay Yourself First',
        priority: savingsPct >= 20 ? 'good' : 'medium',
        title: 'Otomatisasi Dana Darurat 20%',
        desc: `Sisihkan minimal 20% di awal bulan ke rekening terpisah sebelum dipakai belanja harian agar masa depan finansialmu makin tenang.`,
        savingText: `Target Tabung ${formatCurrency(idealSaving)}/bln`
    });

    elements.recommendationsGrid.replaceChildren(...recommendations.map((rec) => {
        const card = document.createElement('article');
        card.className = 'rec-card';
        card.innerHTML = `
            <div>
                <div class="rec-head">
                    <span class="rec-emoji" aria-hidden="true">${rec.emoji}</span>
                    <span class="rec-tag ${rec.priority}">${rec.tag}</span>
                </div>
                <h3 class="rec-title">${rec.title}</h3>
                <p class="rec-desc">${rec.desc}</p>
            </div>
            <div class="rec-saving-pill">
                <span>Potensi Dampak</span>
                <strong>${rec.savingText}</strong>
            </div>
        `;
        return card;
    }));
}

/* ================= KALENDER BULANAN (GOOGLE CALENDAR STYLE) & TIMELINE PERBULAN ================= */
function renderGoogleCalendarAndTimeline(monthTransactions) {
    const selectedMonth = elements.monthFilter.value;
    const [year, month] = selectedMonth.split('-').map(Number);
    const firstDayOfMonth = new Date(year, month - 1, 1);
    const totalDays = new Date(year, month, 0).getDate();

    elements.calendarMonthHeading.textContent = new Intl.DateTimeFormat('id-ID', {
        month: 'long',
        year: 'numeric'
    }).format(firstDayOfMonth);

    // Kelompokkan transaksi per tanggal (YYYY-MM-DD)
    const trxByDate = new Map();
    monthTransactions.forEach((trx) => {
        const key = localDateKey(trx.date);
        if (!key) return;
        if (!trxByDate.has(key)) trxByDate.set(key, []);
        trxByDate.get(key).push(trx);
    });

    // Kelompokkan tagihan per tanggal jatuh tempo pada bulan terpilih
    const billsByDate = new Map();
    bills.forEach((bill) => {
        const clampedDay = Math.min(totalDays, Math.max(1, Number(bill.dueDay) || 1));
        const key = `${selectedMonth}-${String(clampedDay).padStart(2, '0')}`;
        if (!billsByDate.has(key)) billsByDate.set(key, []);
        billsByDate.get(key).push(bill);
    });

    // Pastikan selectedDateKey berada di bulan terpilih
    if (!selectedDateKey.startsWith(selectedMonth)) {
        const todayKey = localDateKey(new Date());
        selectedDateKey = todayKey.startsWith(selectedMonth) ? todayKey : `${selectedMonth}-01`;
    }

    // Hitung offset hari Senin (Senin = 0 ... Minggu = 6)
    const startWeekday = (firstDayOfMonth.getDay() + 6) % 7;
    const prevMonthTotalDays = new Date(year, month - 1, 0).getDate();
    const totalCells = Math.ceil((startWeekday + totalDays) / 7) * 7;
    const todayKey = localDateKey(new Date());

    elements.gcalGrid.replaceChildren();

    for (let i = 0; i < totalCells; i++) {
        const cell = document.createElement('div');
        cell.className = 'gcal-cell';
        cell.setAttribute('role', 'gridcell');

        const dayOffset = i - startWeekday + 1;
        if (dayOffset < 1) {
            cell.classList.add('is-outside');
            const prevDay = prevMonthTotalDays + dayOffset;
            cell.innerHTML = `<div class="gcal-cell-head"><span class="gcal-day-num">${prevDay}</span></div>`;
            elements.gcalGrid.append(cell);
            continue;
        }
        if (dayOffset > totalDays) {
            cell.classList.add('is-outside');
            const nextDay = dayOffset - totalDays;
            cell.innerHTML = `<div class="gcal-cell-head"><span class="gcal-day-num">${nextDay}</span></div>`;
            elements.gcalGrid.append(cell);
            continue;
        }

        const dateKey = `${selectedMonth}-${String(dayOffset).padStart(2, '0')}`;
        const dayTrx = trxByDate.get(dateKey) || [];
        const dayBills = billsByDate.get(dateKey) || [];

        if (dateKey === todayKey) cell.classList.add('is-today');
        if (dateKey === selectedDateKey) cell.classList.add('is-selected');

        let dayIncome = 0;
        let dayExpense = 0;
        dayTrx.forEach((t) => {
            const amt = Number(t.amount) || 0;
            if (t.type === 'income') dayIncome += amt;
            else dayExpense += amt;
        });
        const dayNet = dayIncome - dayExpense;

        const head = document.createElement('div');
        head.className = 'gcal-cell-head';
        const numSpan = document.createElement('span');
        numSpan.className = 'gcal-day-num';
        numSpan.textContent = String(dayOffset);
        head.append(numSpan);

        if (dayIncome > 0 || dayExpense > 0) {
            const netSpan = document.createElement('span');
            netSpan.className = `gcal-day-net ${dayNet >= 0 ? 'positive' : 'negative'}`;
            netSpan.textContent = `${dayNet >= 0 ? '+' : '-'}${formatCompactRp(dayNet)}`;
            head.append(netSpan);
        }

        const eventsBox = document.createElement('div');
        eventsBox.className = 'gcal-events';

        const chips = [];
        dayBills.forEach((bill) => {
            const isPaid = Array.isArray(bill.paidMonths) && bill.paidMonths.includes(selectedMonth);
            const chip = document.createElement('div');
            chip.className = `gcal-chip chip-bill${isPaid ? ' paid' : ''}`;
            chip.innerHTML = `<span>🔔 ${bill.name}</span><span>${formatCompactRp(bill.amount)}</span>`;
            chips.push(chip);
        });

        dayTrx.forEach((trx) => {
            const isInc = trx.type === 'income';
            const chip = document.createElement('div');
            chip.className = `gcal-chip ${isInc ? 'chip-income' : 'chip-expense'}`;
            const title = document.createElement('span');
            title.textContent = String(trx.desc || trx.category || 'Transaksi');
            const val = document.createElement('span');
            val.textContent = `${isInc ? '+' : '-'}${formatCompactRp(Number(trx.amount))}`;
            chip.append(title, val);
            chips.push(chip);
        });

        chips.slice(0, 3).forEach((chip) => eventsBox.append(chip));
        if (chips.length > 3) {
            const more = document.createElement('div');
            more.className = 'gcal-more';
            more.textContent = `+${chips.length - 3} aktivitas lagi`;
            eventsBox.append(more);
        }

        cell.append(head, eventsBox);
        cell.addEventListener('click', () => {
            selectedDateKey = dateKey;
            renderGoogleCalendarAndTimeline(monthTransactions);
        });
        elements.gcalGrid.append(cell);
    }

    renderDayInspector(selectedDateKey, trxByDate.get(selectedDateKey) || [], billsByDate.get(selectedDateKey) || []);
    renderMonthlyTimeline(selectedMonth, totalDays, trxByDate, billsByDate);
}

function renderDayInspector(dateKey, dayTrx, dayBills) {
    const parsed = new Date(`${dateKey}T12:00:00`);
    const selectedMonth = elements.monthFilter.value;
    elements.selectedDayEyebrow.textContent = dateKey === localDateKey(new Date()) ? 'HARI INI' : 'DETAIL TANGGAL';
    elements.selectedDayTitle.textContent = Number.isNaN(parsed.getTime()) ? dateKey : fullDateFormatter.format(parsed);

    let inc = 0;
    let exp = 0;
    dayTrx.forEach((t) => {
        const amt = Number(t.amount) || 0;
        if (t.type === 'income') inc += amt;
        else exp += amt;
    });

    elements.selectedDaySummary.innerHTML = `
        <div class="day-stat-box">
            <span>Pemasukan</span>
            <strong class="text-success">+ ${formatCurrency(inc)}</strong>
        </div>
        <div class="day-stat-box">
            <span>Pengeluaran</span>
            <strong class="text-danger">- ${formatCurrency(exp)}</strong>
        </div>
    `;

    elements.selectedDayEvents.replaceChildren();

    if (!dayTrx.length && !dayBills.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-copy';
        empty.textContent = 'Belum ada transaksi atau jadwal tagihan pada tanggal ini. Klik "+ Catat" untuk menambahkan.';
        elements.selectedDayEvents.append(empty);
        return;
    }

    dayBills.forEach((bill) => {
        const isPaid = Array.isArray(bill.paidMonths) && bill.paidMonths.includes(selectedMonth);
        const card = document.createElement('div');
        card.className = 'day-event-card';
        const left = document.createElement('div');
        left.className = 'ev-left';
        left.innerHTML = `<div class="ev-title">🔔 Tagihan: ${bill.name}</div><div class="ev-sub">${bill.category} · ${formatCurrency(bill.amount)}</div>`;

        const actionBtn = document.createElement('button');
        actionBtn.type = 'button';
        actionBtn.className = `button ${isPaid ? 'button-secondary' : 'button-primary'} button-sm`;
        actionBtn.textContent = isPaid ? 'Lunas ✓' : 'Bayar';
        actionBtn.disabled = isPaid;
        actionBtn.addEventListener('click', () => markBillPaidAndRecord(bill.id));
        card.append(left, actionBtn);
        elements.selectedDayEvents.append(card);
    });

    dayTrx.forEach((trx) => {
        const isInc = trx.type === 'income';
        const card = document.createElement('div');
        card.className = 'day-event-card';
        const left = document.createElement('div');
        left.className = 'ev-left';
        const title = document.createElement('div');
        title.className = 'ev-title';
        title.textContent = String(trx.desc || 'Transaksi');
        const sub = document.createElement('div');
        sub.className = 'ev-sub';
        sub.textContent = String(trx.category || 'Umum');
        left.append(title, sub);

        const right = document.createElement('strong');
        right.className = isInc ? 'text-success' : 'text-danger';
        right.textContent = `${isInc ? '+' : '-'}${formatCurrency(Number(trx.amount))}`;
        card.append(left, right);
        elements.selectedDayEvents.append(card);
    });
}

function renderMonthlyTimeline(selectedMonth, totalDays, trxByDate, billsByDate) {
    elements.monthlyBarTimeline.replaceChildren();
    elements.monthlyTimelineStream.replaceChildren();

    let maxDailyValue = 1;
    const dailyData = [];

    for (let d = 1; d <= totalDays; d++) {
        const dateKey = `${selectedMonth}-${String(d).padStart(2, '0')}`;
        const dayTrx = trxByDate.get(dateKey) || [];
        const dayBills = billsByDate.get(dateKey) || [];
        let inc = 0;
        let exp = 0;
        dayTrx.forEach((t) => {
            const amt = Number(t.amount) || 0;
            if (t.type === 'income') inc += amt;
            else exp += amt;
        });
        maxDailyValue = Math.max(maxDailyValue, inc, exp);
        dailyData.push({ day: d, dateKey, inc, exp, dayTrx, dayBills });
    }

    const activeDaysCount = dailyData.filter((d) => d.dayTrx.length > 0 || d.dayBills.length > 0).length;
    elements.timelineSummaryChip.textContent = `${activeDaysCount} hari beraktivitas dari ${totalDays} hari`;

    // Render Bar Strip Harian (1 s/d 31)
    dailyData.forEach((item) => {
        const col = document.createElement('div');
        col.className = `t-bar-col${item.dateKey === selectedDateKey ? ' is-active' : ''}`;
        col.title = `Tanggal ${item.day}: Masuk ${formatCurrency(item.inc)} | Keluar ${formatCurrency(item.exp)}`;

        const track = document.createElement('div');
        track.className = 't-bar-track';

        if (item.inc > 0) {
            const incBar = document.createElement('span');
            incBar.className = 't-bar-fill inc';
            incBar.style.height = `${Math.max(8, Math.round((item.inc / maxDailyValue) * 72))}px`;
            track.append(incBar);
        }
        if (item.exp > 0) {
            const expBar = document.createElement('span');
            expBar.className = 't-bar-fill exp';
            expBar.style.height = `${Math.max(8, Math.round((item.exp / maxDailyValue) * 72))}px`;
            track.append(expBar);
        }
        if (item.dayBills.length > 0) {
            const billBar = document.createElement('span');
            billBar.className = 't-bar-fill bill-dot';
            billBar.style.height = '18px';
            track.append(billBar);
        }
        if (!item.inc && !item.exp && !item.dayBills.length) {
            const idleBar = document.createElement('span');
            idleBar.className = 't-bar-fill';
            idleBar.style.height = '4px';
            idleBar.style.background = 'var(--line)';
            track.append(idleBar);
        }

        const label = document.createElement('span');
        label.className = 't-bar-day';
        label.textContent = String(item.day);

        col.append(track, label);
        col.addEventListener('click', () => {
            selectedDateKey = item.dateKey;
            renderDashboard();
        });
        elements.monthlyBarTimeline.append(col);
    });

    // Render Chronological Stream
    const activeNodes = dailyData.filter((d) => d.dayTrx.length > 0 || d.dayBills.length > 0);
    if (!activeNodes.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-copy';
        empty.textContent = 'Belum ada timeline aktivitas pada bulan ini.';
        elements.monthlyTimelineStream.append(empty);
        return;
    }

    let runningNet = 0;
    activeNodes.forEach((node) => {
        runningNet += (node.inc - node.exp);
        const wrapper = document.createElement('div');
        wrapper.className = 'timeline-day-Node';

        const parsedDate = new Date(`${node.dateKey}T12:00:00`);
        const head = document.createElement('div');
        head.className = 'timeline-day-head';
        head.innerHTML = `
            <span>📅 ${fullDateFormatter.format(parsedDate)}</span>
            <span>Saldo Kumulatif: <strong>${formatCurrency(runningNet)}</strong></span>
        `;

        const itemsWrap = document.createElement('div');
        itemsWrap.className = 'timeline-day-items';

        node.dayBills.forEach((bill) => {
            const isPaid = Array.isArray(bill.paidMonths) && bill.paidMonths.includes(selectedMonth);
            const chip = document.createElement('span');
            chip.className = `gcal-chip chip-bill${isPaid ? ' paid' : ''}`;
            chip.textContent = `🔔 Tagihan ${bill.name} (${formatCurrency(bill.amount)})`;
            itemsWrap.append(chip);
        });

        node.dayTrx.forEach((trx) => {
            const isInc = trx.type === 'income';
            const chip = document.createElement('span');
            chip.className = `gcal-chip ${isInc ? 'chip-income' : 'chip-expense'}`;
            chip.textContent = `${isInc ? '🟢 +' : '🔴 -'}${formatCurrency(Number(trx.amount))} · ${trx.desc}`;
            itemsWrap.append(chip);
        });

        wrapper.append(head, itemsWrap);
        elements.monthlyTimelineStream.append(wrapper);
    });
}

/* ================= PENGINGAT TAGIHAN BULANAN & NOTIFIKASI ================= */
function renderBillsAndNotifications() {
    const selectedMonth = elements.monthFilter.value;
    const today = new Date();
    const currentDay = today.getDate();
    const isCurrentMonth = localMonthValue(today) === selectedMonth;

    let totalBillAmt = 0;
    let unpaidBillAmt = 0;
    let paidCount = 0;
    const urgentNotifications = [];

    elements.billsGrid.replaceChildren();

    const sortedBills = [...bills].sort((a, b) => (Number(a.dueDay) || 1) - (Number(b.dueDay) || 1));

    sortedBills.forEach((bill) => {
        const amount = Number(bill.amount) || 0;
        const dueDay = Number(bill.dueDay) || 1;
        const isPaid = Array.isArray(bill.paidMonths) && bill.paidMonths.includes(selectedMonth);

        totalBillAmt += amount;
        if (isPaid) paidCount += 1;
        else unpaidBillAmt += amount;

        const diffDays = dueDay - currentDay;
        let statusClass = 'upcoming';
        let statusText = `Jatuh tempo tgl ${dueDay}`;

        if (isPaid) {
            statusClass = 'paid';
            statusText = 'Sudah Lunas ✓';
        } else if (isCurrentMonth && diffDays < 0) {
            statusClass = 'overdue';
            statusText = `Terlambat ${Math.abs(diffDays)} hari!`;
            urgentNotifications.push({
                kind: 'urgent',
                title: `🚨 Tagihan Terlambat: ${bill.name}`,
                body: `Jatuh tempo tanggal ${dueDay} sebesar ${formatCurrency(amount)}. Segera lunasi!`
            });
        } else if (isCurrentMonth && diffDays === 0) {
            statusClass = 'overdue';
            statusText = 'Jatuh Tempo HARI INI!';
            urgentNotifications.push({
                kind: 'urgent',
                title: `🔔 Jatuh Tempo Hari Ini: ${bill.name}`,
                body: `Tagihan ${bill.name} (${formatCurrency(amount)}) jatuh tempo hari ini.`
            });
        } else if (isCurrentMonth && diffDays <= 5) {
            statusClass = 'soon';
            statusText = `${diffDays} hari lagi (Tgl ${dueDay})`;
            urgentNotifications.push({
                kind: 'soon',
                title: `⏰ Segera Jatuh Tempo: ${bill.name}`,
                body: `${diffDays} hari lagi (tanggal ${dueDay}) sebesar ${formatCurrency(amount)}.`
            });
        }

        const card = document.createElement('article');
        card.className = `bill-card${isPaid ? ' is-paid' : ''}${statusClass === 'overdue' ? ' is-overdue' : ''}`;
        card.innerHTML = `
            <div class="bill-card-top">
                <div>
                    <div class="bill-title">${bill.name}</div>
                    <div class="bill-sub">${bill.category} · Rutin tiap tanggal ${dueDay}</div>
                </div>
                <span class="bill-due-badge ${statusClass}">${statusText}</span>
            </div>
            <div class="bill-card-bottom">
                <strong class="bill-amount">${formatCurrency(amount)}</strong>
                <div class="bill-btn-group">
                    <button type="button" class="button ${isPaid ? 'button-secondary' : 'button-primary'} button-sm" data-pay-bill="${bill.id}">
                        ${isPaid ? 'Batalkan Lunas' : 'Bayar & Catat'}
                    </button>
                    <button type="button" class="icon-button btn-sm" data-delete-bill="${bill.id}" title="Hapus pengingat tagihan" aria-label="Hapus ${bill.name}">🗑️</button>
                </div>
            </div>
        `;

        card.querySelector('[data-pay-bill]').addEventListener('click', () => markBillPaidAndRecord(bill.id));
        card.querySelector('[data-delete-bill]').addEventListener('click', () => deleteBill(bill.id));
        elements.billsGrid.append(card);
    });

    elements.billTotalAmount.textContent = formatCurrency(totalBillAmt);
    elements.billUnpaidAmount.textContent = formatCurrency(unpaidBillAmt);
    elements.billPaidCount.textContent = `${paidCount} / ${bills.length} Tagihan`;

    // Update Notification Center & Badge
    const count = urgentNotifications.length;
    elements.notifBadge.hidden = count === 0;
    elements.notifBadge.textContent = String(count);
    elements.navBillBadge.hidden = count === 0;
    elements.navBillBadge.textContent = String(count);

    if (count > 0) {
        elements.urgentBillBanner.hidden = false;
        elements.urgentBillTitle.textContent = urgentNotifications[0].title;
        elements.urgentBillDesc.textContent = `${urgentNotifications[0].body}${count > 1 ? ` (+${count - 1} tagihan lainnya)` : ''}`;
    } else {
        elements.urgentBillBanner.hidden = true;
    }

    elements.notifList.replaceChildren();
    if (count === 0) {
        const empty = document.createElement('p');
        empty.className = 'empty-copy';
        empty.textContent = 'Semua tagihan bulan ini aman terkendali! 🎉';
        elements.notifList.append(empty);
    } else {
        urgentNotifications.forEach((n) => {
            const item = document.createElement('div');
            item.className = `notif-item ${n.kind}`;
            item.innerHTML = `<div><strong>${n.title}</strong><div>${n.body}</div></div>`;
            elements.notifList.append(item);
        });
    }

    // Trigger Browser Notification sekali per sesi jika diizinkan
    if (count > 0 && 'Notification' in window && Notification.permission === 'granted') {
        const sessionKey = `${selectedMonth}-${count}`;
        if (sessionStorage.getItem(STORAGE_KEYS.notifiedBills) !== sessionKey) {
            sessionStorage.setItem(STORAGE_KEYS.notifiedBills, sessionKey);
            new Notification('Saku Harian — Pengingat Tagihan', {
                body: `${urgentNotifications[0].title}: ${urgentNotifications[0].body}`
            });
        }
    }
}

async function markBillPaidAndRecord(billId) {
    const selectedMonth = elements.monthFilter.value;
    const bill = bills.find((b) => b.id === billId);
    if (!bill) return;

    if (!Array.isArray(bill.paidMonths)) bill.paidMonths = [];

    if (bill.paidMonths.includes(selectedMonth)) {
        bill.paidMonths = bill.paidMonths.filter((m) => m !== selectedMonth);
        saveBills();
        renderDashboard();
        setNotice(`Status lunas "${bill.name}" dibatalkan.`);
        return;
    }

    bill.paidMonths.push(selectedMonth);
    saveBills();
    triggerCartoonCelebration(16);

    // Catat juga sebagai transaksi pengeluaran
    const dueDateStr = `${selectedMonth}-${String(Math.min(getDaysInMonth(selectedMonth), Number(bill.dueDay) || 1)).padStart(2, '0')}`;
    await createNewTransaction({
        desc: `Bayar Tagihan: ${bill.name}`,
        amount: Number(bill.amount),
        type: 'expense',
        category: bill.category || 'Tagihan & Utilitas',
        dateStr: dueDateStr
    });
}

function deleteBill(billId) {
    bills = bills.filter((b) => b.id !== billId);
    saveBills();
    renderDashboard();
    setNotice('Pengingat tagihan berhasil dihapus.');
}

async function requestAndTestBrowserNotification() {
    if (!('Notification' in window)) {
        setNotice('Browser kamu belum mendukung Web Notification API, tetapi pengingat dalam aplikasi tetap aktif!', 'error');
        return;
    }

    let permission = Notification.permission;
    if (permission === 'default') {
        permission = await Notification.requestPermission();
    }

    if (permission === 'granted') {
        new Notification('🔔 Saku Harian Smart Planner', {
            body: 'Notifikasi pengingat tagihan bulanan telah aktif! Saku si Sloth akan mengingatkan tagihanmu tepat waktu.'
        });
        triggerCartoonCelebration(10);
        setNotice('Notifikasi browser berhasil diaktifkan dan diuji!');
    } else {
        setNotice('Izin notifikasi browser ditolak. Kamu tetap bisa melihat pengingat di ikon lonceng atas.', 'error');
    }
}

/* ================= RINGKASAN, KATEGORI & DAFTAR TRANSAKSI ================= */
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
    elements.balanceCaption.textContent = net >= 0 ? 'Kondisi bulan ini tetap surplus' : 'Pengeluaran melampaui pemasukan';
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
            ? 'Pengeluaran bulan ini melampaui pemasukan. Cek rekomendasi penghematan di atas!'
            : expense / (income || 1) >= 0.8
                ? 'Sebagian besar pemasukan sudah terpakai. Pertimbangkan untuk menahan belanja keinginan.'
                : 'Arus kas bulan ini terjaga sehat. Pertahankan kebiasaan baikmu!';
    elements.healthNote.lastElementChild.textContent = healthMessage;

    renderCategories(categoryTotals, expense);
    runFinancialPlannerEngine(monthTransactions, income, expense);
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
}

function createTransactionRow(transaction) {
    const row = document.createElement('article');
    row.className = 'transaction-row';

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

    row.append(main, date, badge, amount);
    return row;
}

function renderIcons() {
    if (window.lucide?.createIcons) {
        window.lucide.createIcons();
    }
}

function renderTransactions() {
    const query = elements.search.value.trim().toLocaleLowerCase('id-ID');
    const monthTransactions = selectedMonthTransactions();
    const matchingTransactions = monthTransactions.filter((transaction) => {
        const searchable = `${transaction.desc || ''} ${transaction.category || ''} ${transaction.type || ''}`.toLocaleLowerCase('id-ID');
        return searchable.includes(query);
    });
    const visibleTransactions = showAllTransactions
        ? matchingTransactions
        : matchingTransactions.slice(0, VISIBLE_TRANSACTION_LIMIT);

    elements.transactionList.replaceChildren(...visibleTransactions.map(createTransactionRow));
    renderIcons();
    elements.emptyState.hidden = matchingTransactions.length > 0;
    elements.transactionList.hidden = matchingTransactions.length === 0;
    elements.listStatus.textContent = matchingTransactions.length > visibleTransactions.length
        ? `Menampilkan ${visibleTransactions.length} dari ${matchingTransactions.length} transaksi`
        : matchingTransactions.length
            ? `${matchingTransactions.length} transaksi pada periode ini`
            : query
                ? 'Coba kata kunci lain atau pilih bulan yang berbeda.'
                : '';

    const showAllButton = document.getElementById('showAllTransactions');
    showAllButton.hidden = matchingTransactions.length <= VISIBLE_TRANSACTION_LIMIT;
    const arrow = document.createElement('span');
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = showAllTransactions ? '↑' : '→';
    showAllButton.replaceChildren(
        document.createTextNode(showAllTransactions ? 'Tampilkan lebih sedikit ' : 'Lihat semua '),
        arrow
    );
}

function renderDashboard() {
    const monthTransactions = selectedMonthTransactions();
    renderBillsAndNotifications();
    updateSummary(monthTransactions);
    renderGoogleCalendarAndTimeline(monthTransactions);
    renderTransactions();
    renderIcons();
}

async function loadTransactions() {
    elements.transactionList.hidden = false;
    elements.emptyState.hidden = true;
    const loadingState = document.createElement('div');
    loadingState.className = 'loading-state';
    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    spinner.setAttribute('aria-hidden', 'true');
    loadingState.append(spinner, document.createTextNode('Memuat data Smart Planner...'));
    elements.transactionList.replaceChildren(loadingState);

    try {
        const response = await fetch(TRANSACTIONS_URL, {
            headers: { Accept: 'application/json' }
        });
        if (!response.ok) throw new Error(`Server merespons ${response.status}`);

        const data = await response.json();
        if (!Array.isArray(data)) throw new Error('Format data transaksi tidak sesuai.');
        transactions = applyDateOverrides(data);
        localStorage.setItem(STORAGE_KEYS.localTrxCache, JSON.stringify(transactions));
        renderDashboard();
    } catch (error) {
        console.warn('Menggunakan cache lokal karena server tidak terjangkau:', error);
        const cached = JSON.parse(localStorage.getItem(STORAGE_KEYS.localTrxCache) || '[]');
        transactions = applyDateOverrides(Array.isArray(cached) ? cached : []);
        renderDashboard();
    }
}

async function createNewTransaction({ desc, amount, type, category, dateStr }) {
    const chosenDateIso = dateStr ? `${dateStr}T12:00:00` : new Date().toISOString();
    try {
        const response = await fetch(TRANSACTIONS_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: JSON.stringify({ desc, amount, type, category, date: chosenDateIso })
        });

        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            throw new Error(errorBody.error || `Server merespons ${response.status}`);
        }

        const savedTransaction = await response.json();
        if (dateStr) {
            saveDateOverride(savedTransaction.id, dateStr);
            savedTransaction.date = chosenDateIso;
        }
        transactions.unshift(savedTransaction);
        localStorage.setItem(STORAGE_KEYS.localTrxCache, JSON.stringify(transactions));
        if (dateStr) {
            elements.monthFilter.value = dateStr.slice(0, 7);
            selectedDateKey = dateStr;
        }
        renderDashboard();
        triggerCartoonCelebration(14);
        setNotice('Transaksi berhasil dicatat ke Kalender & Smart Planner!');
        return true;
    } catch (error) {
        // Fallback simpan ke lokal jika offline
        const fallbackTrx = {
            id: `local-${Date.now()}`,
            desc,
            amount,
            type,
            category,
            date: chosenDateIso
        };
        transactions.unshift(fallbackTrx);
        localStorage.setItem(STORAGE_KEYS.localTrxCache, JSON.stringify(transactions));
        if (dateStr) {
            elements.monthFilter.value = dateStr.slice(0, 7);
            selectedDateKey = dateStr;
        }
        renderDashboard();
        triggerCartoonCelebration(12);
        setNotice('Transaksi disimpan ke kalender lokal.');
        return true;
    }
}

/* ================= EKSPOR KE GOOGLE SHEETS ================= */
function buildGoogleSheetsRows() {
    const header = ['ID', 'Tanggal', 'Keterangan', 'Kategori', 'Tipe', 'Nominal (IDR)', 'Pos 50/30/20'];
    const rows = [header];

    transactions.forEach((trx) => {
        const dateStr = localDateKey(trx.date) || String(trx.date || '');
        const isInc = trx.type === 'income';
        const bucketLabel = isInc
            ? 'Pemasukan'
            : classifyExpenseBucket(trx.category, trx.desc) === 'wants'
                ? '30% Keinginan (Wants)'
                : classifyExpenseBucket(trx.category, trx.desc) === 'savings'
                    ? '20% Tabungan (Savings)'
                    : '50% Kebutuhan (Needs)';

        rows.push([
            String(trx.id ?? ''),
            dateStr,
            String(trx.desc || '').replace(/\t|\n/g, ' '),
            String(trx.category || 'Umum'),
            isInc ? 'Pemasukan' : 'Pengeluaran',
            String(Number(trx.amount) || 0),
            bucketLabel
        ]);
    });

    return rows;
}

async function copyAndOpenGoogleSheets() {
    const rows = buildGoogleSheetsRows();
    const tsvContent = rows.map((r) => r.join('\t')).join('\n');

    try {
        await navigator.clipboard.writeText(tsvContent);
        setNotice('Data berhasil disalin! Membuka Google Sheets baru — tekan Ctrl+V / Cmd+V di sel A1.');
    } catch {
        setNotice('Membuka Google Sheets baru...');
    }

    window.open('https://sheets.new', '_blank', 'noopener');
    elements.gsheetDialog.close();
}

function downloadGoogleSheetsCsv() {
    const rows = buildGoogleSheetsRows();
    const csvContent = '\uFEFF' + rows.map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `saku-smart-planner-googlesheets-${localDateKey(new Date())}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    elements.gsheetDialog.close();
    setNotice('File CSV Google Sheets berhasil diunduh! Buka Google Sheets → File → Impor.');
}

async function syncToGoogleSheetsWebhook() {
    const url = elements.gsheetWebhookUrl.value.trim();
    if (!url) {
        setNotice('Masukkan URL Web App Google Apps Script terlebih dahulu.', 'error');
        return;
    }
    localStorage.setItem(STORAGE_KEYS.gsheetWebhook, url);

    try {
        await fetch(url, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                app: 'Saku Harian Smart Planner',
                exportedAt: new Date().toISOString(),
                month: elements.monthFilter.value,
                transactions,
                bills
            })
        });
        elements.gsheetDialog.close();
        triggerCartoonCelebration(12);
        setNotice('Data berhasil dikirim ke Webhook Google Sheets!');
    } catch (err) {
        setNotice('Gagal menghubungi Webhook Google Sheets. Periksa URL Apps Script kamu.', 'error');
    }
}

/* ================= DIALOG & EVENT HANDLERS ================= */
function openTransactionDialog(prefillDate) {
    elements.formError.hidden = true;
    const dateInput = document.getElementById('transactionDate');
    dateInput.value = typeof prefillDate === 'string' && prefillDate ? prefillDate : selectedDateKey || localDateKey(new Date());
    elements.dialog.showModal();
}

async function submitTransaction(event) {
    event.preventDefault();
    elements.formError.hidden = true;

    const formData = new FormData(elements.form);
    const desc = String(formData.get('desc') || '').trim();
    const amount = Number(formData.get('amount'));
    const type = String(formData.get('type'));
    const category = String(formData.get('category') || '').trim() || 'Umum';
    const dateStr = String(formData.get('date') || '').trim();

    if (!desc || !Number.isFinite(amount) || amount <= 0) {
        elements.formError.textContent = 'Isi keterangan dan nominal yang valid terlebih dahulu.';
        elements.formError.hidden = false;
        return;
    }

    elements.saveButton.disabled = true;
    elements.saveButton.textContent = 'Menyimpan...';

    await createNewTransaction({ desc, amount, type, category, dateStr });

    elements.form.reset();
    document.querySelector('input[name="type"][value="expense"]').checked = true;
    document.getElementById('transactionCategory').value = 'Makan & Minum';
    document.getElementById('transactionDate').value = selectedDateKey;
    elements.saveButton.disabled = false;
    elements.saveButton.textContent = 'Simpan ke Kalender';
    elements.dialog.close();
}

function submitNewBill(event) {
    event.preventDefault();
    const formData = new FormData(elements.billForm);
    const name = String(formData.get('name') || '').trim();
    const amount = Number(formData.get('amount'));
    const dueDay = Math.min(31, Math.max(1, Number(formData.get('dueDay')) || 1));
    const category = String(formData.get('category') || 'Tagihan & Utilitas');

    if (!name || !Number.isFinite(amount) || amount <= 0) return;

    bills.push({
        id: `bill-${Date.now()}`,
        name,
        amount,
        dueDay,
        category,
        paidMonths: []
    });
    saveBills();
    elements.billForm.reset();
    elements.billDialog.close();
    renderDashboard();
    triggerCartoonCelebration(10);
    setNotice(`Pengingat tagihan "${name}" setiap tanggal ${dueDay} berhasil ditambahkan!`);
}

function submitBudgetTarget(event) {
    event.preventDefault();
    const val = Number(elements.monthlyBudgetInput.value) || 0;
    monthlyBudgetTarget = Math.max(0, val);
    localStorage.setItem(STORAGE_KEYS.budget, String(monthlyBudgetTarget));
    elements.budgetDialog.close();
    renderDashboard();
    setNotice(monthlyBudgetTarget > 0
        ? `Target anggaran bulanan diatur ke ${formatCurrency(monthlyBudgetTarget)}.`
        : 'Target anggaran menggunakan basis pemasukan otomatis.');
}

function shiftSelectedMonth(delta) {
    const [year, month] = elements.monthFilter.value.split('-').map(Number);
    const nextDate = new Date(year, month - 1 + delta, 1);
    elements.monthFilter.value = localMonthValue(nextDate);
    selectedDateKey = `${elements.monthFilter.value}-01`;
    renderDashboard();
}

function initializeCalendarViewTabs() {
    const tabs = [...document.querySelectorAll('[data-cal-view]')];
    tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            calendarViewMode = tab.dataset.calView;
            tabs.forEach((t) => {
                const active = t === tab;
                t.classList.toggle('is-active', active);
                t.setAttribute('aria-selected', String(active));
            });
            elements.calendarWorkspace.hidden = calendarViewMode === 'timeline';
            elements.monthlyTimelineWrap.hidden = calendarViewMode === 'grid';
        });
    });
}

function initializeTheme() {
    const savedTheme = localStorage.getItem(STORAGE_KEYS.theme);
    if (savedTheme === 'dark') document.documentElement.dataset.theme = 'dark';

    const themeButton = document.getElementById('themeToggle');
    const updateThemeButton = (isDark) => {
        const icon = document.createElement('i');
        icon.dataset.lucide = isDark ? 'sun' : 'moon';
        icon.setAttribute('aria-hidden', 'true');
        themeButton.replaceChildren(icon);
        themeButton.setAttribute('aria-label', isDark ? 'Gunakan tema terang' : 'Gunakan tema gelap');
        renderIcons();
    };
    updateThemeButton(savedTheme === 'dark');

    themeButton.addEventListener('click', () => {
        const isDark = document.documentElement.dataset.theme === 'dark';
        if (isDark) {
            delete document.documentElement.dataset.theme;
            localStorage.setItem(STORAGE_KEYS.theme, 'light');
        } else {
            document.documentElement.dataset.theme = 'dark';
            localStorage.setItem(STORAGE_KEYS.theme, 'dark');
        }
        updateThemeButton(!isDark);
    });
}

function initializeNavigation() {
    const navLinks = [...document.querySelectorAll('[data-nav]')];
    const sections = [...document.querySelectorAll('#overview, #calendar-section, #planner, #bills, #insights, #transactions')];

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

/* ================= INISIALISASI APLIKASI ================= */
document.getElementById('todayLabel').textContent = new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
}).format(new Date()).toLocaleUpperCase('id-ID');

elements.monthFilter.value = localMonthValue();
elements.gsheetWebhookUrl.value = localStorage.getItem(STORAGE_KEYS.gsheetWebhook) || '';
elements.monthlyBudgetInput.value = monthlyBudgetTarget > 0 ? String(monthlyBudgetTarget) : '';

elements.monthFilter.addEventListener('change', () => {
    selectedDateKey = `${elements.monthFilter.value}-01`;
    renderDashboard();
});

document.getElementById('prevMonthBtn').addEventListener('click', () => shiftSelectedMonth(-1));
document.getElementById('nextMonthBtn').addEventListener('click', () => shiftSelectedMonth(1));
document.getElementById('todayMonthBtn').addEventListener('click', () => {
    const now = new Date();
    elements.monthFilter.value = localMonthValue(now);
    selectedDateKey = localDateKey(now);
    renderDashboard();
});

document.getElementById('addOnSelectedDateBtn').addEventListener('click', () => openTransactionDialog(selectedDateKey));
document.getElementById('openTransaction').addEventListener('click', () => openTransactionDialog(selectedDateKey));
document.querySelectorAll('[data-open-form]').forEach((btn) => {
    btn.addEventListener('click', () => openTransactionDialog(selectedDateKey));
});
document.getElementById('closeTransaction').addEventListener('click', () => elements.dialog.close());
document.getElementById('cancelTransaction').addEventListener('click', () => elements.dialog.close());
elements.form.addEventListener('submit', submitTransaction);

// Bill Modal & Notification Events
document.getElementById('openBillQuick').addEventListener('click', () => elements.billDialog.showModal());
document.getElementById('addBillBtn').addEventListener('click', () => elements.billDialog.showModal());
document.getElementById('closeBillDialog').addEventListener('click', () => elements.billDialog.close());
document.getElementById('cancelBillDialog').addEventListener('click', () => elements.billDialog.close());
elements.billForm.addEventListener('submit', submitNewBill);

document.getElementById('testNotificationBtn').addEventListener('click', requestAndTestBrowserNotification);
document.getElementById('enableBrowserNotifBtn').addEventListener('click', requestAndTestBrowserNotification);
document.getElementById('notifToggleBtn').addEventListener('click', () => {
    elements.notifPopover.hidden = !elements.notifPopover.hidden;
});
document.addEventListener('click', (e) => {
    if (!e.target.closest('.notif-dropdown-wrap')) {
        elements.notifPopover.hidden = true;
    }
});

// Budget Modal Events
document.getElementById('openBudgetModalBtn').addEventListener('click', () => {
    elements.monthlyBudgetInput.value = monthlyBudgetTarget > 0 ? String(monthlyBudgetTarget) : '';
    elements.budgetDialog.showModal();
});
document.getElementById('closeBudgetDialog').addEventListener('click', () => elements.budgetDialog.close());
document.getElementById('cancelBudgetDialog').addEventListener('click', () => elements.budgetDialog.close());
elements.budgetForm.addEventListener('submit', submitBudgetTarget);

// Google Sheets Modal Events
document.getElementById('exportGSheet').addEventListener('click', () => elements.gsheetDialog.showModal());
document.getElementById('closeGSheetDialog').addEventListener('click', () => elements.gsheetDialog.close());
document.getElementById('copyAndOpenGSheetBtn').addEventListener('click', copyAndOpenGoogleSheets);
document.getElementById('downloadGSheetCsvBtn').addEventListener('click', downloadGoogleSheetsCsv);
document.getElementById('syncGSheetWebhookBtn').addEventListener('click', syncToGoogleSheetsWebhook);

//Mascot Click Interaction
elements.mascotStage.addEventListener('click', () => {
    slothTipIndex = (slothTipIndex + 1) % SLOTH_TIPS.length;
    elements.mascotSpeech.textContent = SLOTH_TIPS[slothTipIndex];
    triggerCartoonCelebration(10);
});
elements.mascotStage.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        elements.mascotStage.click();
    }
});

// Search & Refresh
elements.search.addEventListener('input', () => {
    showAllTransactions = true;
    renderTransactions();
});
document.getElementById('showAllTransactions').addEventListener('click', () => {
    showAllTransactions = !showAllTransactions;
    renderTransactions();
});
document.getElementById('refreshButton').addEventListener('click', loadTransactions);

[elements.dialog, elements.billDialog, elements.budgetDialog, elements.gsheetDialog].forEach((dlg) => {
    dlg?.addEventListener('click', (event) => {
        if (event.target === dlg) dlg.close();
    });
});

initializeTheme();
initializeCalendarViewTabs();
initializeNavigation();
renderIcons();
loadTransactions();