export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") return new Response("Bot is active!");
    try {
      const update = await request.json();
      const from = update.message?.from || update.callback_query?.from;
      
      // ۱. لایه امنیتی ادمین
      if (!from || from.id.toString() !== env.ADMIN_ID.toString()) return new Response("OK");

      if (update.message?.text) {
        const text = update.message.text.trim();
        if (text === "/start") {
          await this.tgCall(env.BOT_TOKEN, "sendMessage", {
            chat_id: update.message.chat.id,
            text: "💎 **به ربات پایش پیشرفته شبکه خوش آمدید**\n\n🎯 لطفاً آدرس سایت یا IP مورد نظر را ارسال کنید:",
            parse_mode: "Markdown"
          });
        } else {
          await this.sendMenu(env.BOT_TOKEN, update.message.chat.id, text);
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
      text: `🛰 **هدف شناسایی شد:** \`${target}\`\n\n> نوع عملیات مورد نظر را انتخاب کنید:`,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🖼 اسکرین‌شات از Check-Host", callback_data: `snap` }],
          [{ text: "📊 پینگ زنده", callback_data: `ping` }, { text: "🔍 جزئیات شبکه", callback_data: `info` }],
          [{ text: "🌐 تست HTTP", callback_data: `http` }],
          [{ text: "🔄 استعلام آدرس جدید", callback_data: `restart` }]
        ]
      }
    });
  },

  async handleCallback(query, env) {
    const chatId = query.message.chat.id;
    const action = query.data;
    const token = env.BOT_TOKEN;
    const target = query.message.text.split('\n')[0].replace('🛰 هدف شناسایی شد: ', '').replace(/`/g, '').trim();

    await this.tgCall(token, "answerCallbackQuery", { callback_query_id: query.id });

    if (action === 'restart') {
      await this.tgCall(token, "sendMessage", { chat_id: chatId, text: "🆕 لطفاً آدرس جدید را وارد کنید:" });
      return;
    }

    await this.tgCall(token, "sendChatAction", { chat_id: chatId, action: (action === 'snap' ? "upload_photo" : "typing") });

    if (action === 'info') {
      const res = await fetch(`http://ip-api.com/json/${target}?fields=status,country,city,isp,query,as`);
      const data = await res.json();
      const msg = data.status === 'success' 
        ? `📍 **جزئیات زیرساخت:**\n\n🚩 کشور: \`${data.country}\`\n🏙 شهر: \`${data.city}\`\n🏢 اپراتور: \`${data.isp}\`\n📡 آی‌پی: \`${data.query}\``
        : "❌ متأسفانه اطلاعاتی یافت نشد.";
      await this.tgCall(token, "sendMessage", { chat_id: chatId, text: msg, parse_mode: "Markdown" });
    } 

    else if (action === 'ping' || action === 'http') {
      const statusMsg = await this.tgCall(token, "sendMessage", { chat_id: chatId, text: `⚡️ در حال فراخوانی گره‌های جهانی برای \`${action}\`...` });
      try {
        const createRes = await fetch('https://api.globalping.io/v1/measurements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: action === 'ping' ? 'ping' : 'http',
            target: target,
            locations: [{ country: 'IR' }, { country: 'US' }, { country: 'DE' }]
          })
        });
        const { id } = await createRes.json();
        
        let data;
        for (let i = 0; i < 4; i++) {
          await new Promise(r => setTimeout(r, 4000));
          const resultRes = await fetch(`https://api.globalping.io/v1/measurements/${id}`);
          data = await resultRes.json();
          if (data.status === 'finished') break;
        }

        let report = `📈 **گزارش نهایی ${action.toUpperCase()}**\n🌐 هدف: \`${target}\`\n\n`;
        data.results.forEach(r => {
          const flag = r.probe.country === 'IR' ? '🇮🇷' : '🌐';
          let val = "🚫";
          if (action === 'ping' && r.result.stats) val = `**${Math.round(r.result.stats.avg)}ms**`;
          else if (action === 'http' && r.result.statusCode) val = `Code: **${r.result.statusCode}**`;
          report += `${flag} ${r.probe.city}: ${val}\n`;
        });
        await this.tgCall(token, "sendMessage", { chat_id: chatId, text: report, parse_mode: "Markdown" });
      } catch (e) {
        await this.tgCall(token, "sendMessage", { chat_id: chatId, text: "❌ خطا در سیستم تست پایش." });
      }
    }

    else if (action === 'snap') {
      // اصلاح آدرس برای گرفتن اسکرین‌شات از صفحه Check-Host
      const checkHostUrl = `https://check-host.net/check-report/${target}`;
      const snapUrl = `http://api.screenshotlayer.com/api/capture?access_key=${env.API_FLASH_KEY}&url=${encodeURIComponent(checkHostUrl)}&viewport=1280x900&format=PNG&delay=3`;
      
      const sendPhoto = await this.tgCall(token, "sendPhoto", { 
        chat_id: chatId, 
        photo: snapUrl,
        caption: `🖼 **گزارش تصویری Check-Host**\n🔗 هدف: \`${target}\``,
        parse_mode: "Markdown"
      });
      
      if (!sendPhoto.ok) {
        await this.tgCall(token, "sendMessage", { chat_id: chatId, text: "❌ خطا در تهیه گزارش تصویری. احتمالاً محدودیت API." });
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
