export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") return new Response("Bot is running!");
    try {
      const update = await request.json();
      const from = update.message?.from || update.callback_query?.from;
      
      // ۱. بررسی دقیق امنیت ادمین (جلوگیری از دسترسی غریبه‌ها)
      if (!from || from.id.toString() !== env.ADMIN_ID.toString()) {
        if (update.message) {
          await this.tgCall(env.BOT_TOKEN, "sendMessage", {
            chat_id: update.message.chat.id,
            text: "⚠️ **دسترسی غیرمجاز!** این ربات شخصی است.",
            parse_mode: "Markdown"
          });
        }
        return new Response("OK");
      }

      // ۲. پردازش پیام‌های متنی
      if (update.message?.text) {
        const text = update.message.text.trim();
        if (text === "/start") {
          await this.tgCall(env.BOT_TOKEN, "sendMessage", {
            chat_id: update.message.chat.id,
            text: "🚀 **به ربات پایش شبکه خوش آمدید.**\n\nلطفاً یک آدرس دامنه (مثل google.com) یا یک IP ارسال کنید:",
            parse_mode: "Markdown"
          });
        } else {
          await this.sendMenu(env.BOT_TOKEN, update.message.chat.id, text);
        }
      } 
      
      // ۳. پردازش کلیک روی دکمه‌ها
      else if (update.callback_query) {
        ctx.waitUntil(this.handleCallback(update.callback_query, env));
      }
    } catch (e) {
      console.error("Worker Error:", e);
    }
    return new Response("OK");
  },

  async sendMenu(token, chatId, target) {
    await this.tgCall(token, "sendMessage", {
      chat_id: chatId,
      text: `🎯 **هدف:** \`${target}\`\n\nیک عملیات را انتخاب کنید:`,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "📸 اسکرین‌شات کامل سایت", callback_data: `snap` }],
          [{ text: "⚡️ پینگ جهانی (IR/US/EU)", callback_data: `ping` }, { text: "ℹ️ جزئیات IP", callback_data: `info` }],
          [{ text: "🌐 تست پاسخدهی HTTP", callback_data: `http` }],
          [{ text: "🔄 استعلام آدرس جدید", callback_data: `restart` }]
        ]
      }
    });
  },

  async handleCallback(query, env) {
    const chatId = query.message.chat.id;
    const action = query.data;
    const token = env.BOT_TOKEN;
    // استخراج تمیز آدرس هدف
    const target = query.message.text.split('\n')[0].replace('🎯 هدف: ', '').replace(/`/g, '').trim();

    await this.tgCall(token, "answerCallbackQuery", { callback_query_id: query.id });

    if (action === 'restart') {
      await this.tgCall(token, "sendMessage", { chat_id: chatId, text: "🔄 لطفاً آدرس جدید را بفرستید:" });
      return;
    }

    // شبیه‌سازی وضعیت Typing برای تجربه کاربری بهتر
    await this.tgCall(token, "sendChatAction", { chat_id: chatId, action: "typing" });

    if (action === 'info') {
      const res = await fetch(`http://ip-api.com/json/${target}?fields=status,country,city,isp,query,as`);
      const data = await res.json();
      if (data.status === 'success') {
        const msg = `ℹ️ **جزئیات شبکه:**\n\n🌍 کشور: ${data.country}\n🏙 شهر: ${data.city}\n🏢 اپراتور: \`${data.isp}\`\n📡 آی‌پی: \`${data.query}\`\n🛠 AS: \`${data.as}\``;
        await this.tgCall(token, "sendMessage", { chat_id: chatId, text: msg, parse_mode: "Markdown" });
      } else {
        await this.tgCall(token, "sendMessage", { chat_id: chatId, text: "❌ آدرس نامعتبر است یا اطلاعاتی یافت نشد." });
      }
    } 

    else if (action === 'ping' || action === 'http') {
      await this.tgCall(token, "sendMessage", { chat_id: chatId, text: `⏳ در حال استعلام از گره‌های جهانی (شامل ایران)...` });
      
      try {
        const createRes = await fetch('https://api.globalping.io/v1/measurements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: action === 'ping' ? 'ping' : 'http',
            target: target,
            locations: [{ country: 'IR' }, { country: 'US' }, { country: 'DE' }, { country: 'GB' }]
          })
        });
        
        if (!createRes.ok) throw new Error("Globalping API Error");
        const { id } = await createRes.json();

        // سیستم هوشمند دریافت نتیجه (Polling)
        let data;
        for (let i = 0; i < 3; i++) {
          await new Promise(r => setTimeout(r, 5000));
          const resultRes = await fetch(`https://api.globalping.io/v1/measurements/${id}`);
          data = await resultRes.json();
          if (data.status === 'finished') break;
        }

        let report = `📊 **نتایج ${action.toUpperCase()}**\n🔗 \`${target}\`\n\n`;
        data.results.forEach(r => {
          const flag = r.probe.country === 'IR' ? '🇮🇷' : '🌐';
          let val = "❌";
          if (action === 'ping' && r.result.stats) {
            val = `**${Math.round(r.result.stats.avg)}ms**`;
          } else if (action === 'http' && r.result.statusCode) {
            val = `Code: **${r.result.statusCode}**`;
          }
          report += `${flag} ${r.probe.city}: ${val}\n`;
        });

        await this.tgCall(token, "sendMessage", { chat_id: chatId, text: report, parse_mode: "Markdown" });
      } catch (e) {
        await this.tgCall(token, "sendMessage", { chat_id: chatId, text: "❌ خطا: سرویس تست جهانی در حال حاضر در دسترس نیست." });
      }
    }

    else if (action === 'snap') {
      await this.tgCall(token, "sendChatAction", { chat_id: chatId, action: "upload_photo" });
      const finalUrl = target.includes('://') ? target : 'http://' + target;
      const snapUrl = `https://api.apiflash.com/v1/urltoimage?access_key=${env.API_FLASH_KEY}&url=${encodeURIComponent(finalUrl)}&width=1280&height=900&fresh=true&delay=3`;
      
      try {
        const sendPhoto = await this.tgCall(token, "sendPhoto", { 
          chat_id: chatId, 
          photo: snapUrl,
          caption: `✅ اسکرین‌شات مستقیم: ${target}`
        });
        if (!sendPhoto.ok) throw new Error();
      } catch (e) {
        await this.tgCall(token, "sendMessage", { chat_id: chatId, text: "❌ خطا در تهیه اسکرین‌شات. (ممکن است سایت مسدود باشد یا سهمیه تمام شده باشد)." });
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
              
