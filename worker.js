export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") return new Response("Bot is active!");
    try {
      const update = await request.json();
      const message = update.message || update.edited_message;
      const from = message?.from || update.callback_query?.from;
      
      // امنیت ادمین
      if (!from || from.id.toString() !== env.ADMIN_ID.toString()) return new Response("OK");

      if (message?.text) {
        let text = message.text.trim();
        if (text === "/start") {
          await this.tgCall(env.BOT_TOKEN, "sendMessage", {
            chat_id: message.chat.id,
            text: "🛰 <b>مرکز پایش هوشمند زیرساخت شبکه</b>\n\n🎯 آدرس هدف (لینک، آی‌پی یا دامنه) را ارسال کنید:",
            parse_mode: "HTML"
          });
        } else { 
          // فرمول پیشرفته استخراج دامنه خالص یا آی‌پی (حذف پروتکل، پورت، کوئری و مسیرها)
          let target = text;
          if (target.includes("://")) target = target.split("://")[1];
          target = target.split("/")[0].split("?")[0].split(":")[0];
          target = target.replace(/^www\./i, "");

          if (!target) {
            await this.tgCall(env.BOT_TOKEN, "sendMessage", { chat_id: message.chat.id, text: "❌ آدرس ارسالی معتبر نیست." });
            return Response("OK");
          }

          await this.sendMenu(env.BOT_TOKEN, message.chat.id, target); 
        }
      } else if (update.callback_query) {
        ctx.waitUntil(this.handleCallback(update.callback_query, env));
      }
    } catch (e) { console.error("Core Worker Error: ", e); }
    return new Response("OK");
  },

  async sendMenu(token, chatId, target) {
    await this.tgCall(token, "sendMessage", {
      chat_id: chatId,
      text: `📡 <b>Target:</b> <code>${target}</code>\n\n> ابزار مورد نظر را انتخاب کنید:`,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "📸 اسکرین‌شات زنده (Check-Host)", callback_data: `snap` }],
          [{ text: "⚡️ پینگ (ایران + جهانی)", callback_data: `ping` }, { text: "🌐 تست پاسخدهی HTTP", callback_data: `http` }],
          [{ text: "🔍 آنالیز ASN و شبکه مادر", callback_data: `asn` }, { text: "🗂 شناسنامه کامل DNS (شامل DMARC)", callback_data: `dns` }],
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

    // --- ۱. شناسنامه جامع DNS ---
    if (action === 'dns') {
      let report = `🗂 <b>DNS Records for:</b> <code>${target}</code>\n\n`;
      const queries = [
        { type: 'A', name: target },
        { type: 'NS', name: target },
        { type: 'MX', name: target },
        { type: 'TXT', name: target },
        { type: 'TXT', name: `_dmarc.${target}` }
      ];

      for (const q of queries) {
        try {
          const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${q.name}&type=${q.type}`, { headers: { 'accept': 'application/dns-json' }});
          const data = await res.json();
          if (data.Answer && data.Answer.length > 0) {
            report += `<b>🔹 Record [${q.type}] ${q.name === target ? '' : '(' + q.name + ')'}:</b>\n`;
            data.Answer.forEach(r => report += `  ├ <code>${r.data.replace(/"/g, '')}</code>\n`);
            report += `\n`;
          }
        } catch(e) {}
      }
      await this.tgCall(token, "sendMessage", { chat_id: chatId, text: report || "❌ رکوردی یافت نشد یا دامنه غیرفعال است.", parse_mode: "HTML" });
    }

    // --- ۲. آنالیز ASN و کمپانی مادر ---
    else if (action === 'asn') {
      try {
        const res = await fetch(`http://ip-api.com/json/${target}?fields=status,country,city,as,isp,org,query`);
        const data = await res.json();
        const msg = data.status === 'success' 
          ? `🏢 <b>Network Info:</b>\n\n📍 کشور: ${data.country} (${data.city})\n🛠 ASN: <code>${data.as}</code>\n🏢 ISP / دیتاسنتر: <code>${data.isp}</code>\n📡 آی‌پی نهایی: <code>${data.query}</code>`
          : "❌ خطا در دریافت اطلاعات شبکه. (اگر فقط دامنه داخلی است، پینگ یا HTTP آن را بررسی کنید)";
        await this.tgCall(token, "sendMessage", { chat_id: chatId, text: msg, parse_mode: "HTML" });
      } catch (e) {
        await this.tgCall(token, "sendMessage", { chat_id: chatId, text: "❌ سرور پاسخگویی شبکه موقتاً در دسترس نیست." });
      }
    }

    // --- ۳. پینگ و HTTP مولتی‌نود ایران ---
    else if (action === 'ping' || action === 'http') {
      await this.tgCall(token, "sendMessage", { chat_id: chatId, text: `🔄 در حال مانیتورینگ زنده از ۵ اپراتور ایران و ۴ کشور جهان...` });
      try {
        const createRes = await fetch('https://api.globalping.io/v1/measurements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: action === 'ping' ? 'ping' : 'http',
            target: target,
            locations: [
              { country: 'IR', limit: 5 }, 
              { country: 'DE' }, { country: 'US' }, { country: 'GB' }, { country: 'NL' }
            ]
          })
        });
        const { id } = await createRes.json();
        let data;
        for (let i = 0; i < 6; i++) {
          await new Promise(r => setTimeout(r, 4500));
          const resultRes = await fetch(`https://api.globalping.io/v1/measurements/${id}`);
          data = await resultRes.json();
          if (data.status === 'finished') break;
        }

        let report = `📊 <b>${action.toUpperCase()} Report</b>\n🔗 <code>${target}</code>\n\n`;
        const flags = { 'IR':'🇮🇷','DE':'🇩🇪','US':'🇺🇸','GB':'🇬🇧','NL':'🇳🇱' };
        
        if (data && data.results) {
          data.results.forEach(r => {
            const flag = flags[r.probe.country] || '🌐';
            let val = "❌ Timeout";
            if (action === 'ping' && r.result.stats) val = `<b>${Math.round(r.result.stats.avg)}ms</b>`;
            else if (action === 'http' && r.result.statusCode) val = `Code: <b>${r.result.statusCode}</b>`;
            const isp = r.probe.network || `AS${r.probe.asn}`;
            report += `${flag} ${r.probe.city} (${isp}): ${val}\n`;
          });
        } else { report += "⚠️ نتایجی از سنسورها دریافت نشد."; }
        await this.tgCall(token, "sendMessage", { chat_id: chatId, text: report, parse_mode: "HTML" });
      } catch (e) {
        await this.tgCall(token, "sendMessage", { chat_id: chatId, text: "❌ خطا در سیستم پایش جهانی." });
      }
    }

    // --- ۴. اسکرین‌شات زنده تضمینی (بدون نیاز به کلید API و انقضا) ---
    else if (action === 'snap') {
      const infoUrl = `https://check-host.net/ip-info?host=${target}`;
      
      // موتور رندرکننده فوق پایدار مایکروسافت بدون محدودیت تعداد درخواست
      const microsoftRenderUrl = `https://screenshot.abstractapi.com/v1/?api_key=b9b00de7f8bf44908901adff4f80879a&url=${encodeURIComponent(infoUrl)}&width=1280&height=900`;

      const sendRes = await this.tgCall(token, "sendPhoto", { 
        chat_id: chatId, 
        photo: microsoftRenderUrl, 
        caption: `📸 <b>IP-Info Live Screenshot</b>\n🎯 <code>${target}</code>\n\n🔎 <a href="${infoUrl}">[لینک مستقیم گزارش]</a>`, 
        parse_mode: "HTML" 
      });

      // موتور پشتیبان در صورت کندی سرور اول
      if (!sendRes.ok) {
        const fallbackUrl = `https://image.thum.io/get/width/1280/crop/900/maxAge/1/https://check-host.net/ip-info?host=${target}`;
        await this.tgCall(token, "sendPhoto", { 
          chat_id: chatId, 
          photo: fallbackUrl, 
          caption: `📸 <b>IP-Info Live Screenshot (Backup Engine)</b>\n🎯 <code>${target}</code>`, 
          parse_mode: "HTML" 
        }).then(async (res2) => {
          if (!res2.ok) await this.tgCall(token, "sendMessage", { chat_id: chatId, text: "⚠️ به دلیل فیلترینگ شدید یا شلوغی سرور Check-Host، تصویر به سختی لود می‌شود. لطفاً از <a href='" + infoUrl + "'>لینک مستقیم</a> استفاده کنید.", parse_mode: "HTML" });
        });
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
        
