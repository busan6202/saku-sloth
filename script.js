const API_BASE_URL = 'https://saku-sloth.vercel.app/api';
const TRANSACTIONS_URL = `${API_BASE_URL}/transactions`;
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
    notice: document.getElementById('notice'),
    dialog: document.getElementById('transactionDialog'),
    form: document.getElementById('transactionForm'),
    formError: document.getElementById('formError'),
    saveButton: document.getElementById('saveTransaction')
};

let transactions = [];
let showAllTransactions = false;
let noticeTimeout;

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
    updateSummary(monthTransactions);
    renderTransactions();
}

async function loadTransactions() {
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
        const response = await fetch(TRANSACTIONS_URL, {
            headers: { Accept: 'application/json' }
        });
        if (!response.ok) throw new Error(`Server merespons ${response.status}`);

        const data = await response.json();
        if (!Array.isArray(data)) throw new Error('Format data transaksi tidak sesuai.');
        transactions = data;
        elements.emptyState.querySelector('strong').textContent = 'Belum ada transaksi';
        elements.emptyState.querySelector('span:not(.empty-illustration)').textContent = 'Catat transaksi pertama untuk mulai melihat gambaran keuanganmu.';
        elements.emptyState.querySelector('[data-open-form]').hidden = false;
        renderDashboard();
    } catch (error) {
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

    try {
        const response = await fetch(TRANSACTIONS_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: JSON.stringify(transaction)
        });

        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            throw new Error(errorBody.error || `Server merespons ${response.status}`);
        }

        const savedTransaction = await response.json();
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
        console.error('Gagal menyimpan transaksi:', error);
        elements.formError.textContent = error.message || 'Transaksi gagal disimpan. Silakan coba lagi.';
        elements.formError.hidden = false;
    } finally {
        elements.saveButton.disabled = false;
        elements.saveButton.textContent = 'Simpan transaksi';
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
elements.monthFilter.addEventListener('change', renderDashboard);
elements.search.addEventListener('input', () => {
    showAllTransactions = true;
    renderTransactions();
});
document.getElementById('showAllTransactions').addEventListener('click', () => {
    showAllTransactions = !showAllTransactions;
    renderTransactions();
});
document.getElementById('openTransaction').addEventListener('click', openTransactionDialog);
document.getElementById('refreshButton').addEventListener('click', loadTransactions);
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
loadTransactions();
