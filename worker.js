export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") return new Response("Bot is active!");
    try {
      const update = await request.json();
      const message = update.message || update.edited_message;
      const from = message?.from || update.callback_query?.from;
      
      if (!from || from.id.toString() !== env.ADMIN_ID.toString()) return new Response("OK");

      if (message?.text) {
        const text = message.text.trim();
        if (text === "/start") {
          await this.tgCall(env.BOT_TOKEN, "sendMessage", {
            chat_id: message.chat.id,
            text: "🛰 <b>به مرکز مانیتورینگ پیشرفته خوش آمدید</b>\n\n🎯 آدرس دامنه یا آی‌پی هدف را ارسال کنید:",
            parse_mode: "HTML"
          });
        } else {
          await this.sendMenu(env.BOT_TOKEN, message.chat.id, text);
        }
      } else if (update.callback_query) {
        ctx.waitUntil(this.handleCallback(update.callback_query, env));
      }
    } catch (e) { console.error(e); }
    return new Response("OK");
  },

  async sendMenu(token, chatId, target) {
    await this.tgCall(token, "sendMessage", {
      chat_id: chatId,
      text: `📡 <b>Target:</b> <code>${target}</code>\n\n> ابزار مورد نظر را انتخاب کنید:`,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "📸 اسکرین‌شات (Check-Host)", callback_data: `snap` }],
          [{ text: "⚡️ پینگ (ایران + جهانی)", callback_data: `ping` }, { text: "🌐 تست پاسخدهی HTTP", callback_data: `http` }],
          [{ text: "🔍 آنالیز ASN و شبکه", callback_data: `asn` }, { text: "🗂 شناسنامه کامل DNS", callback_data: `dns` }],
          [{ text: "🔄 استعلام آدرس جدید", callback_data: `restart` }]
        ]
      }
    });
  },

  async handleCallback(query, env) {
    const chatId = query.message.chat.id;
    const action = query.data;
    const token = env.BOT_TOKEN;
    
    const targetMatch = query.message.text.match(/Target:\s*([^\n]+)/);
    const target = targetMatch ? targetMatch[1].trim() : "";

    await this.tgCall(token, "answerCallbackQuery", { callback_query_id: query.id });

    if (action === 'restart') {
      await this.tgCall(token, "sendMessage", { chat_id: chatId, text: "🆕 آدرس جدید را بفرستید:" });
      return;
    }

    if (!target) return;

    await this.tgCall(token, "sendChatAction", { chat_id: chatId, action: (action === 'snap' ? "upload_photo" : "typing") });

    if (action === 'dns') {
      let report = `🗂 <b>DNS Records:</b> <code>${target}</code>\n\n`;
      const types = ['A', 'NS', 'MX', 'TXT'];
      for (const type of types) {
        try {
          const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${target}&type=${type}`, { headers: { 'accept': 'application/dns-json' }});
          const data = await res.json();
          if (data.Answer) {
            report += `<b>🔹 ${type}:</b>\n`;
            data.Answer.forEach(r => report += `  ├ <code>${r.data}</code>\n`);
          }
        } catch(e) {}
      }
      await this.tgCall(token, "sendMessage", { chat_id: chatId, text: report || "❌ رکوردی یافت نشد.", parse_mode: "HTML" });
    }

    else if (action === 'asn') {
      const res = await fetch(`http://ip-api.com/json/${target}?fields=status,country,city,as,isp,org,query`);
      const data = await res.json();
      const msg = data.status === 'success' 
        ? `🏢 <b>Network Info:</b>\n\n📍 کشور: ${data.country}\n🏙 شهر: ${data.city}\n🛠 ASN: <code>${data.as}</code>\n🏢 ISP: <code>${data.isp}</code>\n📡 IP: <code>${data.query}</code>`
        : "❌ خطا در دریافت اطلاعات شبکه.";
      await this.tgCall(token, "sendMessage", { chat_id: chatId, text: msg, parse_mode: "HTML" });
    }

    else if (action === 'ping' || action === 'http') {
      await this.tgCall(token, "sendMessage", { chat_id: chatId, text: `🔄 در حال دریافت گزارش از سنسورهای ایران و جهان...` });
      try {
        const createRes = await fetch('https://api.globalping.io/v1/measurements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: action === 'ping' ? 'ping' : 'http',
            target: target,
            locations: [
              { country: 'IR', limit: 5 }, // درخواست ۵ نود متفاوت از ایران
              { country: 'DE' }, { country: 'US' }, { country: 'GB' }, 
              { country: 'NL' }, { country: 'TR' }, { country: 'JP' }
            ]
          })
        });
        const { id } = await createRes.json();
        let data;
        for (let i = 0; i < 7; i++) {
          await new Promise(r => setTimeout(r, 4500));
          const resultRes = await fetch(`https://api.globalping.io/v1/measurements/${id}`);
          data = await resultRes.json();
          if (data.status === 'finished') break;
        }

        let report = `📊 <b>${action.toUpperCase()} Global Report</b>\n🔗 <code>${target}</code>\n\n`;
        const flags = { 'IR':'🇮🇷','DE':'🇩🇪','US':'🇺🇸','GB':'🇬🇧','NL':'🇳🇱','TR':'🇹🇷','RU':'🇷🇺','JP':'🇯🇵','BR':'🇧🇷','AU':'🇦🇺' };
        
        if (data && data.results) {
          data.results.forEach(r => {
            const flag = flags[r.probe.country] || '🌐';
            let val = "❌ Timeout";
            if (action === 'ping' && r.result.stats) val = `<b>${Math.round(r.result.stats.avg)}ms</b>`;
            else if (action === 'http' && r.result.statusCode) val = `Code: <b>${r.result.statusCode}</b>`;
            const isp = r.probe.network || `AS${r.probe.asn}`;
            report += `${flag} ${r.probe.city} (${isp}): ${val}\n`;
          });
        } else {
          report += "⚠️ نتایجی دریافت نشد.";
        }
        await this.tgCall(token, "sendMessage", { chat_id: chatId, text: report, parse_mode: "HTML" });
      } catch (e) {
        await this.tgCall(token, "sendMessage", { chat_id: chatId, text: "❌ خطا در سیستم پایش." });
      }
    }

    else if (action === 'snap') {
      const infoUrl = `https://check-host.net/ip-info?host=${encodeURIComponent(target)}`;
      const apiUrl = `http://api.screenshotlayer.com/api/capture?access_key=${env.API_FLASH_KEY}&url=${encodeURIComponent(infoUrl)}&viewport=1280x900&format=PNG&delay=4`;
      
      try {
        const checkRes = await fetch(apiUrl);
        if (checkRes.ok) {
          await this.tgCall(token, "sendPhoto", { 
            chat_id: chatId, 
            photo: apiUrl, 
            caption: `📸 <b>IP-Info Report</b>\n🎯 <code>${target}</code>\n\n🔎 <a href="${infoUrl}">[لینک گزارش]</a>`, 
            parse_mode: "HTML" 
          });
        } else {
          let err = "❌ <b>خطای اسکرین‌شات:</b>\n";
          if (checkRes.status === 402) err += "💳 سهمیه ماهانه ۱۰۰تایی شما تمام شده.";
          else if (checkRes.status === 401) err += "🔑 API Key نامعتبر است.";
          else err += `⚠️ کد وضعیت سرور: ${checkRes.status}`;
          await this.tgCall(token, "sendMessage", { chat_id: chatId, text: err, parse_mode: "HTML" });
        }
      } catch (e) {
        await this.tgCall(token, "sendMessage", { chat_id: chatId, text: "🚨 خطا در اتصال به API اسکرین‌شات." });
      }
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
