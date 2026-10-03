const API_URL = 'https://saku-sloth-backend.vercel.app/api/transactions';

const transactionForm = document.getElementById('transaction-form');
const transactionList = document.getElementById('transaction-list');
const totalBalance = document.getElementById('total-balance');
const currentMonthExpenseEl = document.getElementById('current-month-expense');
const lastMonthExpenseEl = document.getElementById('last-month-expense');
const warningAlertSection = document.getElementById('warning-alert-section');
const warningText = document.getElementById('warning-text');

let expenseChartInstance = null;

// Fungsi Pemetaan Ikon Menarik Berdasarkan Kategori
function getCategoryIcon(category) {
    const icons = {
        'Makan & Minum': '🍜',
        'Transportasi': '🚗',
        'Langganan Digital': '💻',
        'Kesehatan & Self-Care': '🧘',
        'Belanja & Lifestyle': '🛍️',
        'Tagihan & Utilitas': '⚡',
        'Gaji Utama': '💼',
        'Side Hustle / Freelance': '🚀',
        'Investasi & Dividen': '📈'
    };
    return icons[category] || '📁';
}

async function fetchTransactions() {
    try {
        const response = await fetch(API_URL);
        const transactions = await response.json();
        renderDashboard(transactions);
        updateChart(transactions);
    } catch (error) {
        console.error("Gagal mengambil data:", error);
    }
}

function renderDashboard(transactions) {
    transactionList.innerHTML = '';
    
    if (transactions.length === 0) {
        transactionList.innerHTML = `<li class="empty-state">Belum ada catatan berjalan. Santai dulu! 🦥</li>`;
        totalBalance.innerText = `Rp 0`;
        currentMonthExpenseEl.innerText = `Rp 0`;
        lastMonthExpenseEl.innerText = `Rp 0`;
        warningAlertSection.classList.add('hidden');
        return;
    }

    let balance = 0;
    let currentMonthExpense = 0;
    let lastMonthExpense = 0;

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const categoryTotals = {};

    transactions.forEach(trx => {
        const amountNum = Number(trx.amount);
        const trxDate = new Date(trx.date);
        const trxMonth = trxDate.getMonth();
        const trxYear = trxDate.getFullYear();

        if (trx.type === 'income') {
            balance += amountNum;
        } else {
            balance -= amountNum;
            
            if (trxMonth === currentMonth && trxYear === currentYear) {
                currentMonthExpense += amountNum;
                const cat = trx.category || 'Lainnya';
                categoryTotals[cat] = (categoryTotals[cat] || 0) + amountNum;
            }
        }

        let prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
        let prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;
        if (trx.type === 'expense' && trxMonth === prevMonth && trxYear === prevYear) {
            lastMonthExpense += amountNum;
        }

        // Ambil Ikon Dinamis
        const iconSymbol = getCategoryIcon(trx.category);

        // Render Item Riwayat Berjalan dengan Ikon
        const li = document.createElement('li');
        li.className = trx.type;
        li.innerHTML = `
            <div class="history-info">
                <div class="history-icon">${iconSymbol}</div>
                <div>
                    <span><strong>${trx.desc}</strong></span>
                    <br><small style="color: #7f8c8d; font-size: 0.75rem;">${trx.category || 'Umum'} • ${trxDate.toLocaleDateString('id-ID')}</small>
                </div>
            </div>
            <strong>${trx.type === 'income' ? '+' : '-'} Rp ${amountNum.toLocaleString('id-ID')}</strong>
        `;
        transactionList.appendChild(li);
    });

    totalBalance.innerText = `Rp ${balance.toLocaleString('id-ID')}`;
    currentMonthExpenseEl.innerText = `Rp ${currentMonthExpense.toLocaleString('id-ID')}`;
    lastMonthExpenseEl.innerText = `Rp ${lastMonthExpense.toLocaleString('id-ID')}`;

    let highestCategory = '';
    let highestAmount = 0;
    for (const [cat, amt] of Object.entries(categoryTotals)) {
        if (amt > highestAmount) {
            highestAmount = amt;
            highestCategory = cat;
        }
    }

    if (highestAmount > 0 && currentMonthExpense > 0 && (highestAmount / currentMonthExpense) >= 0.4) {
        warningText.innerText = `Kategori "${highestCategory}" mendominasi pengeluaran bulan ini sebesar Rp ${highestAmount.toLocaleString('id-ID')}!`;
        warningAlertSection.classList.remove('hidden');
    } else {
        warningAlertSection.classList.add('hidden');
    }
}

function updateChart(transactions) {
    const expenses = transactions.filter(trx => trx.type === 'expense');
    const categoryTotals = {};
    expenses.forEach(trx => {
        const cat = trx.category || 'Lainnya';
        categoryTotals[cat] = (categoryTotals[cat] || 0) + Number(trx.amount);
    });

    const labels = Object.keys(categoryTotals);
    const data = Object.values(categoryTotals);

    const ctx = document.getElementById('expenseChart').getContext('2d');

    if (expenseChartInstance) {
        expenseChartInstance.destroy();
    }

    if (labels.length === 0) {
        expenseChartInstance = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: ['Belum ada pengeluaran'],
                datasets: [{ data: [1], backgroundColor: ['#e0e0e0'] }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
        return;
    }

    const earthToneColors = ['#52796f', '#354f52', '#84a98c', '#cad2c5', '#bc4749', '#dda15e', '#606c38'];

    expenseChartInstance = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: earthToneColors.slice(0, labels.length),
                borderWidth: 2,
                borderColor: '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        boxWidth: 12,
                        font: { size: 11, family: 'Plus Jakarta Sans' }
                    }
                }
            }
        }
    });
}

transactionForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const desc = document.getElementById('desc').value;
    const amount = document.getElementById('amount').value;
    const type = document.getElementById('type').value;
    const category = document.getElementById('category').value;

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ desc, amount, type, category })
        });

        if (response.ok) {
            transactionForm.reset();
            fetchTransactions();
        }
    } catch (error) {
        console.error("Gagal menyimpan data:", error);
    }
});

fetchTransactions();