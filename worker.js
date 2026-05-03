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
            text: "🛰 <b>مرکز پایش هوشمند شبکه</b>\n\n🎯 آدرس دامنه یا آی‌پی هدف را ارسال کنید:",
            parse_mode: "HTML"
          });
        } else { await this.sendMenu(env.BOT_TOKEN, message.chat.id, text); }
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
          [{ text: "📸 اسکرین‌شات هوشمند (Google Engine)", callback_data: `snap` }],
          [{ text: "⚡️ پینگ (ایران + جهان)", callback_data: `ping` }, { text: "🌐 تست پاسخدهی HTTP", callback_data: `http` }],
          [{ text: "🔍 آنالیز ASN و ISP", callback_data: `asn` }, { text: "🗂 شناسنامه کامل DNS", callback_data: `dns` }],
          [{ text: "🔄 استعلام آدرس جدید", callback_data: `restart` }]
        ]
      }
    });
  },

  async handleCallback(query, env) {
    const chatId = query.message.chat.id;
    const action = query.data;
    const token = env.BOT_TOKEN;
    const target = query.message.text.match(/Target:\s*([^\n]+)/)?.[1].trim();

    await this.tgCall(token, "answerCallbackQuery", { callback_query_id: query.id });
    if (action === 'restart') {
      await this.tgCall(token, "sendMessage", { chat_id: chatId, text: "🆕 آدرس جدید را بفرستید:" });
      return;
    }

    await this.tgCall(token, "sendChatAction", { chat_id: chatId, action: (action === 'snap' ? "upload_photo" : "typing") });

    if (action === 'dns') {
      let report = `🗂 <b>DNS Records:</b> <code>${target}</code>\n\n`;
      for (const type of ['A', 'NS', 'MX', 'TXT']) {
        const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${target}&type=${type}`, { headers: { 'accept': 'application/dns-json' }});
        const data = await res.json();
        if (data.Answer) {
          report += `<b>🔹 ${type}:</b>\n`;
          data.Answer.forEach(r => report += `  ├ <code>${r.data}</code>\n`);
        }
      }
      await this.tgCall(token, "sendMessage", { chat_id: chatId, text: report || "❌ موردی یافت نشد.", parse_mode: "HTML" });
    }

    else if (action === 'asn') {
      const res = await fetch(`http://ip-api.com/json/${target}?fields=status,country,city,as,isp,org,query`);
      const data = await res.json();
      const msg = data.status === 'success' 
        ? `🏢 <b>Network Info:</b>\n\n📍 کشور: ${data.country}\n🛠 ASN: <code>${data.as}</code>\n🏢 ISP: <code>${data.isp}</code>\n📡 IP: <code>${data.query}</code>`
        : "❌ خطا در دریافت اطلاعات.";
      await this.tgCall(token, "sendMessage", { chat_id: chatId, text: msg, parse_mode: "HTML" });
    }

    else if (action === 'ping' || action === 'http') {
      await this.tgCall(token, "sendMessage", { chat_id: chatId, text: `🔄 در حال دریافت گزارش زنده...` });
      try {
        const createRes = await fetch('https://api.globalping.io/v1/measurements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: action === 'ping' ? 'ping' : 'http',
            target: target,
            locations: [{ country: 'IR', limit: 5 }, { country: 'DE' }, { country: 'US' }, { country: 'NL' }, { country: 'GB' }, { country: 'JP' }]
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
        let report = `📊 <b>${action.toUpperCase()} Report</b>\n🔗 <code>${target}</code>\n\n`;
        data.results.forEach(r => {
          const flag = { 'IR':'🇮🇷','DE':'🇩🇪','US':'🇺🇸','GB':'🇬🇧','NL':'🇳🇱','JP':'🇯🇵' }[r.probe.country] || '🌐';
          let val = "❌";
          if (action === 'ping' && r.result.stats) val = `<b>${Math.round(r.result.stats.avg)}ms</b>`;
          else if (action === 'http' && r.result.statusCode) val = `Code: <b>${r.result.statusCode}</b>`;
          report += `${flag} ${r.probe.city} (${r.probe.network || r.probe.asn}): ${val}\n`;
        });
        await this.tgCall(token, "sendMessage", { chat_id: chatId, text: report, parse_mode: "HTML" });
      } catch (e) { await this.tgCall(token, "sendMessage", { chat_id: chatId, text: "❌ خطا در پایش جهانی." }); }
    }

    else if (action === 'snap') {
      const infoUrl = `https://check-host.net/ip-info?host=${encodeURIComponent(target)}`;
      // استفاده از موتور اسکرین‌شات گوگل (PageSpeed Insights)
      const googleSnapApi = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(infoUrl)}&screenshot=true`;

      try {
        const res = await fetch(googleSnapApi);
        const data = await res.json();
        
        if (data.lighthouseResult?.audits?.['final-screenshot']?.details?.data) {
          // استخراج تصویر Base64 از گوگل و تبدیل به عکس تلگرام
          const base64Data = data.lighthouseResult.audits['final-screenshot'].details.data.replace('data:image/jpeg;base64,', '');
          
          // تلگرام عکس بیس۶۴ مستقیم قبول نمی‌کند، پس ما باید از یک بافر استفاده کنیم
          // اما چون در Cloudflare Workers هستیم، راحت‌ترین راه فرستادن لینک مستقیم گوگل است:
          // برای سادگی و سرعت، از یک جایگزین دیگر که با تلگرام هماهنگ است استفاده می‌کنیم:
          const fastSnap = `https://api.screenshotmachine.com?key=76628b&url=${encodeURIComponent(infoUrl)}&dimension=1024x768&delay=2000`;

          await this.tgCall(token, "sendPhoto", { 
            chat_id: chatId, 
            photo: fastSnap, 
            caption: `📸 <b>IP-Info Report</b>\n🎯 <code>${target}</code>\n\n🔎 <a href="${infoUrl}">[لینک گزارش]</a>`, 
            parse_mode: "HTML" 
          });
        } else {
            // اگر گوگل جواب نداد، از موتور سریع Thum.io استفاده کن (رایگان و بی نیاز به کلید برای استفاده محدود)
            const fallbackSnap = `https://image.thum.io/get/width/1024/crop/800/https://check-host.net/ip-info?host=${target}`;
            await this.tgCall(token, "sendPhoto", { 
                chat_id: chatId, 
                photo: fallbackSnap, 
                caption: `📸 <b>IP-Info Report (Fast Engine)</b>\n🎯 <code>${target}</code>`, 
                parse_mode: "HTML" 
            });
        }
      } catch (e) {
        await this.tgCall(token, "sendMessage", { chat_id: chatId, text: "🚨 خطای سیستمی در دریافت تصویر." });
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
