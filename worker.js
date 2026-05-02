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
            text: "🛰 <b>سامانه متمرکز پایش زیرساخت</b>\n\n🎯 آدرس هدف را ارسال کنید (IP یا Domain):",
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
          [{ text: "📸 اسکرین‌شات (IP-Info)", callback_data: `snap` }],
          [{ text: "⚡️ پینگ ۱۰ نقطه جهان", callback_data: `ping` }, { text: "🌐 تست HTTP", callback_data: `http` }],
          [{ text: "🔍 آنالیز ASN و ISP", callback_data: `asn` }, { text: "🗂 شناسنامه کامل DNS", callback_data: `dns` }],
          [{ text: "🔄 استعلام جدید", callback_data: `restart` }]
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

    await this.tgCall(token, "sendChatAction", { chat_id: chatId, action: "typing" });

    if (action === 'dns') {
      let report = `🗂 <b>DNS Records for:</b> <code>${target}</code>\n\n`;
      const types = ['A', 'NS', 'MX', 'TXT'];
      for (const type of types) {
        const dnsRes = await fetch(`https://cloudflare-dns.com/dns-query?name=${target}&type=${type}`, { headers: { 'accept': 'application/dns-json' }});
        const data = await dnsRes.json();
        if (data.Answer) {
          report += `<b>🔹 ${type} Records:</b>\n`;
          data.Answer.forEach(r => report += `  ├ <code>${r.data}</code>\n`);
        }
      }
      await this.tgCall(token, "sendMessage", { chat_id: chatId, text: report || "❌ رکوردی یافت نشد.", parse_mode: "HTML" });
    }

    else if (action === 'asn') {
      const res = await fetch(`http://ip-api.com/json/${target}?fields=status,country,city,as,isp,org,query`);
      const data = await res.json();
      const msg = data.status === 'success' 
        ? `🏢 <b>Network Info:</b>\n\n📍 Country: ${data.country}\n🛠 ASN: <code>${data.as}</code>\n🏢 ISP: <code>${data.isp}</code>\n📡 IP: <code>${data.query}</code>`
        : "❌ خطای دریافت اطلاعات.";
      await this.tgCall(token, "sendMessage", { chat_id: chatId, text: msg, parse_mode: "HTML" });
    }

    else if (action === 'ping' || action === 'http') {
      await this.tgCall(token, "sendMessage", { chat_id: chatId, text: `🔄 در حال دریافت گزارش از ۱۰ سنسور جهانی...` });
      const createRes = await fetch('https://api.globalping.io/v1/measurements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: action === 'ping' ? 'ping' : 'http',
          target: target,
          locations: [
            { country: 'IR' }, { country: 'DE' }, { country: 'US' }, { country: 'GB' }, 
            { country: 'NL' }, { country: 'TR' }, { country: 'RU' }, { country: 'JP' }, 
            { country: 'BR' }, { country: 'AU' }
          ]
        })
      });
      const { id } = await createRes.json();
      let data;
      for (let i = 0; i < 6; i++) {
        await new Promise(r => setTimeout(r, 4000));
        const resultRes = await fetch(`https://api.globalping.io/v1/measurements/${id}`);
        data = await resultRes.json();
        if (data.status === 'finished') break;
      }
      let report = `📊 <b>${action.toUpperCase()} Global Report</b>\n🔗 <code>${target}</code>\n\n`;
      const flags = { 'IR':'🇮🇷','DE':'🇩🇪','US':'🇺🇸','GB':'🇬🇧','NL':'🇳🇱','TR':'🇹🇷','RU':'🇷🇺','JP':'🇯🇵','BR':'🇧🇷','AU':'🇦🇺' };
      data.results.forEach(r => {
        const flag = flags[r.probe.country] || '🌐';
        let val = "❌";
        if (action === 'ping' && r.result.stats) val = `<b>${Math.round(r.result.stats.avg)}ms</b>`;
        else if (action === 'http' && r.result.statusCode) val = `Code: <b>${r.result.statusCode}</b>`;
        // اضافه شدن نام دیتاسنتر/AS
        report += `${flag} ${r.probe.city} (${r.probe.asn}): ${val}\n`;
      });
      await this.tgCall(token, "sendMessage", { chat_id: chatId, text: report, parse_mode: "HTML" });
    }

    else if (action === 'snap') {
      const infoUrl = `https://check-host.net/ip-info?host=${encodeURIComponent(target)}`;
      const snapUrl = `http://api.screenshotlayer.com/api/capture?access_key=${env.API_FLASH_KEY}&url=${encodeURIComponent(infoUrl)}&viewport=1280x900&format=PNG&delay=4`;
      await this.tgCall(token, "sendPhoto", { chat_id: chatId, photo: snapUrl, caption: `📸 <b>IP-Info Report</b>\n🎯 <code>${target}</code>`, parse_mode: "HTML" });
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
