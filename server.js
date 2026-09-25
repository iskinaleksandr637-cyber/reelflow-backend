require('dotenv').config();
const { Bot } = require('grammy');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const cors = require('cors');

const bot = new Bot(process.env.BOT_TOKEN);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);
const app = express();

app.use(cors());
app.use(express.json());

// Парсер ссылок
function parseReelUrl(text) {
  const instagramRegex = /https?:\/\/(www\.)?instagram\.com\/(reel|p)\/([a-zA-Z0-9_-]+)/;
  const tiktokRegex = /https?:\/\/(www\.|vm\.)?tiktok\.com\/.*\/video\/(\d+)/;
  const tiktokShortRegex = /https?:\/\/vm\.tiktok\.com\/([a-zA-Z0-9]+)/;
  
  const igMatch = text.match(instagramRegex);
  const ttMatch = text.match(tiktokRegex);
  const ttShortMatch = text.match(tiktokShortRegex);
  
  if (igMatch) {
    return {
      platform: 'instagram',
      url: igMatch[0],
      reelId: igMatch[3],
      valid: true
    };
  }
  if (ttMatch) {
    return {
      platform: 'tiktok',
      url: ttMatch[0],
      reelId: ttMatch[2],
      valid: true
    };
  }
  if (ttShortMatch) {
    return {
      platform: 'tiktok',
      url: ttShortMatch[0],
      reelId: ttShortMatch[1],
      valid: true
    };
  }
  return { valid: false };
}

// Команда /start
bot.command('start', async (ctx) => {
  const firstName = ctx.from.first_name;
  await ctx.reply(
    `Привет, ${firstName}! 🎬\n\n` +
    `Я ReelFlow — твоя личная копилка рилсов.\n\n` +
    `📥 Просто перешли мне любую ссылку на рилс из Instagram или TikTok, и я сохраню его!\n\n` +
    `📺 Команды:\n` +
    `/myid — узнать свой ID\n` +
    `/stats — статистика коллекции`
  );
});

// Команда узнать свой ID
bot.command('myid', async (ctx) => {
  await ctx.reply(`Твой ID: \`${ctx.from.id}\`\n\nСкопируй его, пригодится для теста!`, {
    parse_mode: 'Markdown'
  });
});

// Команда статистики
bot.command('stats', async (ctx) => {
  const userId = ctx.from.id.toString();
  
  const { data: reels, error } = await supabase
    .from('reels')
    .select('*')
    .eq('user_id', userId);
    
  if (error) {
    await ctx.reply('💥 Ошибка получения статистики');
    return;
  }
  
  const total = reels?.length || 0;
  const instagram = reels?.filter(r => r.platform === 'instagram').length || 0;
  const tiktok = reels?.filter(r => r.platform === 'tiktok').length || 0;
  
  await ctx.reply(
    `📊 Твоя статистика:\n\n` +
    `🎬 Всего рилсов: ${total}\n` +
    `📸 Instagram: ${instagram}\n` +
    `🎵 TikTok: ${tiktok}`
  );
});

// Обработка всех текстовых сообщений
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text;
  const userId = ctx.from.id.toString();
  
  // Игнорируем команды
  if (text.startsWith('/')) return;
  
  const parsed = parseReelUrl(text);
  
  if (!parsed.valid) {
    await ctx.reply('❌ Я пока умею сохранять только ссылки на Instagram Reels и TikTok. Пришли прямую ссылку на видео!');
    return;
  }
  
  // Проверяем дубликаты
  const { data: existing } = await supabase
    .from('reels')
    .select('id')
    .eq('user_id', userId)
    .eq('url', parsed.url)
    .single();
    
  if (existing) {
    await ctx.reply('ℹ️ Этот рилс уже есть в твоей коллекции!');
    return;
  }
  
  // Сохраняем
  const { error } = await supabase
    .from('reels')
    .insert({
      user_id: userId,
      url: parsed.url,
      platform: parsed.platform,
      reel_id: parsed.reelId,
      username: ctx.from.username || ctx.from.first_name,
      saved_at: new Date().toISOString()
    });
    
  if (error) {
    console.error('DB Error:', error.message);
    console.error('Details:', error.details);
    console.error('Hint:', error.hint);
    await ctx.reply(`💥 Ошибка: ${error.message}`);
    return;
  }
  
  await ctx.reply(
    `✅ Рилс сохранён!\n📍 Платформа: ${parsed.platform === 'instagram' ? 'Instagram' : 'TikTok'}`
  );
});

// Обработка ошибок
bot.catch((err) => {
  console.error('Bot error:', err);
});

// === API ДЛЯ ФРОНТЕНДА ===

// Получить все рилсы юзера
app.get('/api/reels/:userId', async (req, res) => {
  const { userId } = req.params;
  const { data, error } = await supabase
    .from('reels')
    .select('*')
    .eq('user_id', userId)
    .order('saved_at', { ascending: false });
    
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// Удалить рилс
app.delete('/api/reels/:userId/:reelId', async (req, res) => {
  const { userId, reelId } = req.params;
  const { error } = await supabase
    .from('reels')
    .delete()
    .eq('user_id', userId)
    .eq('reel_id', reelId);
    
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// Запуск API сервера
app.listen(process.env.PORT, () => {
  console.log(`🌐 API работает на http://localhost:${process.env.PORT}`);
});

// Запуск бота
bot.start({
  onStart: (me) => {
    console.log(`🚀 Бот запущен! Юзернейм: @${me.username}`);
  }
}).catch((err) => {
  console.error('❌ Ошибка запуска бота:', err.message);
});