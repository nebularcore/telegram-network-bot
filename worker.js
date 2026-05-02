export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") return new Response("Bot is running securely!");
    try {
      const update = await request.json();
      // پشتیبانی از پیام‌های عادی و ویرایش شده
      const message = update.message || update.edited_message; 
      const from = message?.from || update.callback_query?.from;
      
      // ۱. اعتبارسنجی قطعی ادمین
      if (!from || from.id.toString() !== env.ADMIN_ID.toString()) return new Response("OK");

      if (message?.text) {
        const text = message.text.trim();
        if (text === "/start") {
          await this.tgCall(env.BOT_TOKEN, "sendMessage", {
            chat_id: message.chat.id,
            text: "💎 <b>به مرکز مانیتورینگ پیشرفته خوش آمدید</b>\n\n🎯 آدرس دامنه (مثل google.com) یا آی‌پی هدف را ارسال کنید:",
            parse_mode: "HTML"
          });
        } else {
          await this.sendMenu(env.BOT_TOKEN, message.chat.id, text);
        }
      } else if (update.callback_query) {
        // جلوگیری از تایم‌اوت شدن Worker با استفاده از waitUntil
        ctx.waitUntil(this.handleCallback(update.callback_query, env));
      }
    } catch (e) { console.error("Worker Core Error:", e); }
    return new Response("OK");
  },

  async sendMenu(token, chatId, target) {
    await this.tgCall(token, "sendMessage", {
      chat_id: chatId,
      text: `🛰 <b>تارگت:</b> <code>${target}</code>\n\n> لطفاً یکی از ابزارهای تحلیلی را انتخاب کنید:`,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "📸 اسکرین‌شات Check-Host", callback_data: `snap` }],
          [{ text: "⚡️ پینگ (۷ نقطه جهان)", callback_data: `ping` }, { text: "🌐 تست HTTP", callback_data: `http` }],
          [{ text: "🔍 آنالیز ASN و شبکه", callback_data: `asn` }, { text: "🗂 استخراج رکوردهای DNS", callback_data: `dns` }],
          [{ text: "🔄 بررسی آدرس جدید", callback_data: `restart` }]
        ]
      }
    });
  },

  async handleCallback(query, env) {
    const chatId = query.message.chat.id;
    const action = query.data;
    const token = env.BOT_TOKEN;
    
    // استخراج فوق‌العاده امن تارگت با Regex
    const targetMatch = query.message.text.match(/تارگت:\s*([^\n]+)/);
    const target = targetMatch ? targetMatch[1].trim() : "";

    await this.tgCall(token, "answerCallbackQuery", { callback_query_id: query.id });

    if (action === 'restart') {
      await this.tgCall(token, "sendMessage", { chat_id: chatId, text: "🆕 آدرس جدید را بفرستید:" });
      return;
    }

    if (!target) {
      await this.tgCall(token, "sendMessage", { chat_id: chatId, text: "❌ خطا در شناسایی آدرس. لطفاً مجدد ارسال کنید." });
      return;
    }

    await this.tgCall(token, "sendChatAction", { chat_id: chatId, action: (action === 'snap' ? "upload_photo" : "typing") });

    // --- عملیات ۱: ASN ---
    if (action === 'asn') {
      try {
        const res = await fetch(`http://ip-api.com/json/${target}?fields=status,country,city,as,isp,org,reverse,query`);
        const data = await res.json();
        const msg = data.status === 'success' 
          ? `🏢 <b>اطلاعات لایه شبکه (ASN):</b>\n\n🌍 کشور: ${data.country} - ${data.city}\n🛠 شماره AS: <code>${data.as?.split(' ')[0] || 'N/A'}</code>\n📛 شبکه: <code>${data.isp || 'N/A'}</code>\n🏢 سازمان: <code>${data.org || 'N/A'}</code>\n🔄 Reverse DNS: <code>${data.reverse || 'ندارد'}</code>\n📡 آی‌پی نهایی: <code>${data.query}</code>`
          : "❌ خطا در دریافت اطلاعات. (ممکن است دامنه معتبر نباشد)";
        await this.tgCall(token, "sendMessage", { chat_id: chatId, text: msg, parse_mode: "HTML" });
      } catch (e) {
        await this.tgCall(token, "sendMessage", { chat_id: chatId, text: "❌ سرور اطلاعات شبکه پاسخگو نیست." });
      }
    }

    // --- عملیات ۲: DNS Lookup (ویژگی جدید) ---
    else if (action === 'dns') {
      const isIp = /^[\d\.]+$/.test(target) || /:/.test(target);
      if (isIp) {
        await this.tgCall(token, "sendMessage", { chat_id: chatId, text: "⚠️ این یک آدرس IP است. ابزار DNS برای دامنه‌ها (مثل google.com) استفاده می‌شود." });
        return;
      }
      try {
        const dnsRes = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(target)}&type=A`, { headers: { 'accept': 'application/dns-json' }});
        const dnsData = await dnsRes.json();
        let report = `🗂 <b>رکوردهای اتصال (DNS A):</b>\n🎯 <code>${target}</code>\n\n`;
        if (dnsData.Answer && dnsData.Answer.length > 0) {
          dnsData.Answer.forEach(record => { report += `🔹 <code>${record.data}</code>\n`; });
        } else {
          report += "❌ رکوردی یافت نشد یا دامنه ثبت نشده است.";
        }
        await this.tgCall(token, "sendMessage", { chat_id: chatId, text: report, parse_mode: "HTML" });
      } catch (e) {
        await this.tgCall(token, "sendMessage", { chat_id: chatId, text: "❌ خطا در اتصال به سرورهای DNS." });
      }
    }

    // --- عملیات ۳: Global Ping & HTTP ---
    else if (action === 'ping' || action === 'http') {
      const statusMsg = await this.tgCall(token, "sendMessage", { chat_id: chatId, text: `🔄 در حال فراخوانی سنسورهای جهانی ${action.toUpperCase()}...` });
      try {
        const createRes = await fetch('https://api.globalping.io/v1/measurements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: action === 'ping' ? 'ping' : 'http',
            target: target,
            locations: [{ country: 'IR' }, { country: 'DE' }, { country: 'US' }, { country: 'NL' }, { country: 'GB' }, { country: 'TR' }, { country: 'RU' }]
          })
        });
        const { id } = await createRes.json();
        
        let data;
        for (let i = 0; i < 5; i++) {
          await new Promise(r => setTimeout(r, 4500)); // ۴.۵ ثانیه وقفه برای تکمیل تست‌های جهانی
          const resultRes = await fetch(`https://api.globalping.io/v1/measurements/${id}`);
          data = await resultRes.json();
          if (data.status === 'finished') break;
        }

        let report = `📊 <b>گزارش ${action.toUpperCase()}</b>\n🔗 <code>${target}</code>\n\n`;
        const flags = { 'IR': '🇮🇷', 'DE': '🇩🇪', 'US': '🇺🇸', 'NL': '🇳🇱', 'GB': '🇬🇧', 'TR': '🇹🇷', 'RU': '🇷🇺' };
        
        if (data && data.results) {
          data.results.forEach(r => {
            const flag = flags[r.probe.country] || '🌐';
            let val = "❌ Timeout";
            if (action === 'ping' && r.result.stats) val = `<b>${Math.round(r.result.stats.avg)}ms</b>`;
            else if (action === 'http' && r.result.statusCode) val = `Code: <b>${r.result.statusCode}</b>`;
            report += `${flag} ${r.probe.city}: ${val}\n`;
          });
        } else {
          report += "⚠️ خطا در دریافت نتایج سنسورها.";
        }
        
        await this.tgCall(token, "sendMessage", { chat_id: chatId, text: report, parse_mode: "HTML" });
      } catch (e) {
        await this.tgCall(token, "sendMessage", { chat_id: chatId, text: "❌ خطا در سیستم مانیتورینگ." });
      }
    }

    // --- عملیات ۴: اسکرین‌شات ---
    else if (action === 'snap') {
      const infoUrl = `https://check-host.net/ip-info?host=${encodeURIComponent(target)}`;
      const snapUrl = `http://api.screenshotlayer.com/api/capture?access_key=${env.API_FLASH_KEY}&url=${encodeURIComponent(infoUrl)}&viewport=1280x900&format=PNG&delay=3`;
      
      await this.tgCall(token, "sendPhoto", { 
        chat_id: chatId, 
        photo: snapUrl,
        caption: `📊 <b>آنالیز تصویری میزبان</b>\n🎯 <code>${target}</code>\n\n🔎 <a href="${infoUrl}">[لینک مستقیم گزارش Check-Host]</a>`,
        parse_mode: "HTML"
      }).then(async (sendPhotoRes) => {
        if (!sendPhotoRes.ok) {
           await this.tgCall(token, "sendMessage", { chat_id: chatId, text: "❌ محدودیت در سرویس تصویربرداری یا طولانی شدن زمان پاسخ." });
        }
      });
    }
  },

  async tgCall(token, method, payload) {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return await res.json();
  }
};
