import { GoogleGenAI } from '@google/genai';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Helper koneksi MongoDB Data API / Fetch langsung ke MongoDB Atlas Data API atau Mongoose via serverless.
    // Karena Cloudflare Workers berbasis edge, kita bisa gunakan MongoDB Data API atau driver yang mendukung edge.
    // Di sini kita gunakan pendekatan standar Fetch ke MongoDB Atlas Data API atau handler API.
    
    // 1. API Endpoint untuk Frontend (Ambil Transaksi)
    if (url.pathname === '/api/transactions' && request.method === 'GET') {
      try {
        const data = await fetchMongo(env, 'find', { "collection": "transactions", "database": "sakusloth", "dataSource": "Cluster0", "sort": { "date": -1 } });
        return new Response(JSON.stringify(data.documents || []), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 2. API Endpoint untuk Tambah Transaksi via Web
    if (url.pathname === '/api/transactions' && request.method === 'POST') {
      try {
        const body = await request.json();
        const doc = {
          desc: body.desc,
          amount: Number(body.amount),
          type: body.type,
          category: body.category || 'Umum',
          date: new Date().toISOString()
        };

        await fetchMongo(env, 'insertOne', { "collection": "transactions", "database": "sakusloth", "dataSource": "Cluster0", "document": doc });
        
        // Kirim notifikasi Telegram
        await sendTelegram(env, env.TELEGRAM_CHAT_ID, doc);

        return new Response(JSON.stringify(doc), { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // 3. Webhook Telegram Bot & Gemini AI
    if (url.pathname === '/api/telegram-webhook' && request.method === 'POST') {
      try {
        const update = await request.json();
        if (update.message) {
          const chatId = update.message.chat.id;
          const text = update.message.text;
          const photo = update.message.photo;
          const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

          if (photo && photo.length > 0) {
            const fileId = photo[photo.length - 1].file_id;
            const fileRes = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`);
            const fileData = await fileRes.json();
            const downloadUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${fileData.result.file_path}`;
            
            const imageRes = await fetch(downloadUrl);
            const arrayBuffer = await imageRes.arrayBuffer();
            const base64Image = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

            await sendTelegramText(env, chatId, "🔍 *Gemini sedang membaca nota Anda...*");

            const prompt = `Analisis nota belanja ini. Ekstrak ke JSON murni TANPA markdown:
            {"desc": "Nama toko/barang", "amount": angka saja, "type": "expense", "category": pilih dari ["Makan & Minum", "Transportasi", "Langganan Digital", "Kesehatan & Self-Care", "Belanja & Lifestyle", "Tagihan & Utilitas"]}`;

            const response = await ai.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: [
                { role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: 'image/jpeg', data: base64Image } }] }
              ]
            });

            let jsonText = response.text.trim().replace(/```json/g, '').replace(/```/g, '');
            const parsed = JSON.parse(jsonText.substring(jsonText.indexOf('{'), jsonText.lastIndexOf('}') + 1));
            
            await saveAndNotifyWorker(env, parsed, chatId);

          } else if (text) {
            if (text.startsWith('/start')) {
              await sendTelegramText(env, chatId, "Halo! 🌱 Saku-Sloth Bot aktif di Cloudflare Workers. Kirim foto nota atau teks pengeluaran/pemasukan Anda!");
              return new Response("OK");
            }

            const prompt = `Analisis teks transaksi: "${text}". Ekstrak ke JSON murni TANPA markdown:
            {"desc": "Keterangan", "amount": angka saja, "type": "expense" atau "income", "category": pilih dari ["Makan & Minum", "Transportasi", "Langganan Digital", "Kesehatan & Self-Care", "Belanja & Lifestyle", "Tagihan & Utilitas", "Gaji Utama", "Side Hustle / Freelance", "Investasi & Dividen"]}`;

            const response = await ai.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: prompt
            });

            let jsonText = response.text.trim().replace(/```json/g, '').replace(/```/g, '');
            const parsed = JSON.parse(jsonText.substring(jsonText.indexOf('{'), jsonText.lastIndexOf('}') + 1));

            await saveAndNotifyWorker(env, parsed, chatId);
          }
        }
        return new Response("OK");
      } catch (err) {
        console.error(err);
        return new Response("Error", { status: 500 });
      }
    }

    return new Response("Saku-Sloth Cloudflare Worker Active 🌱", { status: 200 });
  }
};

// Helper MongoDB Atlas Data API
async function fetchMongo(env, action, bodyData) {
  const url = `${env.MONGO_DATA_API_URL}/action/${action}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Request-Headers': '*',
      'api-key': env.MONGO_DATA_API_KEY,
    },
    body: JSON.stringify(bodyData)
  });
  return await res.json();
}

async function sendTelegramText(env, chatId, text) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
  });
}

async function sendTelegram(env, chatId, trx) {
  const symbol = trx.type === 'income' ? '🟢 PEMASUKAN' : '🔴 PENGELUARAN';
  const sign = trx.type === 'income' ? '+' : '-';
  const text = `📊 *PENCATATAN SAKU SLOTH*\n${symbol}\n📝 ${trx.desc}\n📁 ${trx.category}\n💰 ${sign} Rp ${Number(trx.amount).toLocaleString('id-ID')}`;
  await sendTelegramText(env, chatId, text);
}

async function saveAndNotifyWorker(env, trxData, chatId) {
  const doc = { ...trxData, amount: Number(trxData.amount), date: new Date().toISOString() };
  await fetchMongo(env, 'insertOne', { "collection": "transactions", "database": "sakusloth", "dataSource": "Cluster0", "document": doc });
  await sendTelegram(env, chatId, doc);
}