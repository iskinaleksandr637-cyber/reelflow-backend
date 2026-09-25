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

  if (igMatch) return { platform: 'instagram', url: igMatch[0], reelId: igMatch[3], valid: true };
  if (ttMatch) return { platform: 'tiktok', url: ttMatch[0], reelId: ttMatch[2], valid: true };
  if (ttShortMatch) return { platform: 'tiktok', url: ttShortMatch[0], reelId: ttShortMatch[1], valid: true };
  return { valid: false };
}

// === КОМАНДЫ БОТА ===

bot.command('start', async (ctx) => {
  const param = ctx.match;
  const firstName = ctx.from.first_name;

  if (param && /^u\d+$/.test(param)) {
    const targetId = param.slice(1);
    const WEBAPP_URL = process.env.WEBAPP_URL || 'http://localhost:5173';
    await ctx.reply(
      `🎬 Тебе отправили профиль! Нажми кнопку ниже, чтобы открыть:`,
      {
        reply_markup: {
          inline_keyboard: [[{
            text: '👤 Открыть профиль',
            web_app: { url: `${WEBAPP_URL}/?profileId=${targetId}` }
          }]]
        }
      }
    );
    return;
  }

  await ctx.reply(
    `Привет, ${firstName}! 🎬\n\n` +
    `Я ReelFlow — твоя личная копилка рилсов.\n\n` +
    `📥 Перешли мне ссылку на рилс из Instagram или TikTok — я сохраню его.\n` +
    `👥 Подписывайся на друзей и смотри их подборки в ленте.\n\n` +
    `Команды:\n` +
    `/myid — твой ID\n` +
    `/stats — статистика\n` +
    `/profile — ссылка на твой профиль`
  );
});

bot.command('myid', async (ctx) => {
  await ctx.reply(`Твой ID: \`${ctx.from.id}\``, { parse_mode: 'Markdown' });
});

bot.command('stats', async (ctx) => {
  const userId = ctx.from.id.toString();
  const { data: reels } = await supabase.from('reels').select('*').eq('user_id', userId);
  const total = reels?.length || 0;
  const instagram = reels?.filter(r => r.platform === 'instagram').length || 0;
  const tiktok = reels?.filter(r => r.platform === 'tiktok').length || 0;
  await ctx.reply(
    `📊 Твоя статистика:\n\n🎬 Всего рилсов: ${total}\n📸 Instagram: ${instagram}\n🎵 TikTok: ${tiktok}`
  );
});

bot.command('profile', async (ctx) => {
  const link = `https://t.me/${ctx.me.username}/reelflow?startapp=u${ctx.from.id}`;
  await ctx.reply(
    `🔗 Вот ссылка на твой профиль:\n\n${link}\n\n` +
    `Отправь её друзьям — у них откроется твой профиль с кнопкой «Подписаться».`
  );
});

// === СОХРАНЕНИЕ РИЛСОВ ===

bot.on('message:text', async (ctx) => {
  const text = ctx.message.text;
  const userId = ctx.from.id.toString();

  if (text.startsWith('/')) return;

  const parsed = parseReelUrl(text);

  if (!parsed.valid) {
    await ctx.reply('❌ Я пока умею сохранять только ссылки на Instagram Reels и TikTok.');
    return;
  }

  const { data: existing } = await supabase
    .from('reels').select('id')
    .eq('user_id', userId).eq('url', parsed.url).single();

  if (existing) {
    await ctx.reply('ℹ️ Этот рилс уже есть в твоей коллекции!');
    return;
  }

  const { error } = await supabase.from('reels').insert({
    user_id: userId,
    url: parsed.url,
    platform: parsed.platform,
    reel_id: parsed.reelId,
    username: ctx.from.username || ctx.from.first_name,
    saved_at: new Date().toISOString()
  });

  if (error) {
    console.error('DB Error:', error.message);
    await ctx.reply(`💥 Ошибка: ${error.message}`);
    return;
  }

  await ctx.reply(`✅ Рилс сохранён!\n📍 Платформа: ${parsed.platform === 'instagram' ? 'Instagram' : 'TikTok'}`);
});

bot.catch((err) => {
  console.error('Bot error:', err);
});

// === API ===

app.get('/api/reels/:userId', async (req, res) => {
  const { data, error } = await supabase
    .from('reels').select('*')
    .eq('user_id', req.params.userId)
    .order('saved_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.delete('/api/reels/:userId/:reelId', async (req, res) => {
  const { error } = await supabase
    .from('reels').delete()
    .eq('user_id', req.params.userId)
    .eq('reel_id', req.params.reelId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

app.post('/api/users/upsert', async (req, res) => {
  const { user_id, username, first_name, photo_url } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  const { error } = await supabase.from('users').upsert({
    user_id,
    username: username || null,
    first_name: first_name || null,
    photo_url: photo_url || null,
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

app.get('/api/users/:userId', async (req, res) => {
  const id = req.params.userId;
  const { data: user } = await supabase.from('users').select('*').eq('user_id', id).single();
  const { count: followers } = await supabase.from('subscriptions')
    .select('*', { count: 'exact', head: true }).eq('target_id', id);
  const { count: following } = await supabase.from('subscriptions')
    .select('*', { count: 'exact', head: true }).eq('subscriber_id', id);
  const { count: reels } = await supabase.from('reels')
    .select('*', { count: 'exact', head: true }).eq('user_id', id);
  res.json({
    user: user || { user_id: id, first_name: 'Неизвестный' },
    stats: { followers: followers || 0, following: following || 0, reels: reels || 0 }
  });
});

app.get('/api/explore', async (req, res) => {
  const { data: users, error } = await supabase
    .from('users').select('*')
    .order('updated_at', { ascending: false }).limit(100);
  if (error) return res.status(500).json({ error: error.message });
  const { data: reels } = await supabase.from('reels').select('user_id');
  const counts = {};
  (reels || []).forEach(r => { counts[r.user_id] = (counts[r.user_id] || 0) + 1; });
  res.json((users || []).map(u => ({ ...u, reel_count: counts[u.user_id] || 0 })));
});

app.get('/api/subscriptions/:userId', async (req, res) => {
  const { data, error } = await supabase
    .from('subscriptions').select('target_id')
    .eq('subscriber_id', req.params.userId);
  if (error) return res.status(500).json({ error: error.message });
  res.json((data || []).map(r => r.target_id));
});

app.post('/api/subscribe', async (req, res) => {
  const { subscriber_id, target_id } = req.body || {};
  if (!subscriber_id || !target_id || subscriber_id === target_id) {
    return res.status(400).json({ error: 'invalid' });
  }
  const { error } = await supabase.from('subscriptions').upsert(
    { subscriber_id, target_id },
    { onConflict: 'subscriber_id,target_id' }
  );
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

app.delete('/api/subscribe/:subscriberId/:targetId', async (req, res) => {
  const { error } = await supabase.from('subscriptions').delete()
    .eq('subscriber_id', req.params.subscriberId)
    .eq('target_id', req.params.targetId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

app.get('/api/feed/:userId', async (req, res) => {
  const id = req.params.userId;
  const { data: subs, error: subErr } = await supabase
    .from('subscriptions').select('target_id')
    .eq('subscriber_id', id);
  if (subErr) return res.status(500).json({ error: subErr.message });
  const ids = (subs || []).map(s => s.target_id);
  if (ids.length === 0) return res.json({ reels: [], curators: [] });

  const { data: reels, error: rErr } = await supabase
    .from('reels').select('*')
    .in('user_id', ids)
    .order('saved_at', { ascending: false }).limit(50);
  if (rErr) return res.status(500).json({ error: rErr.message });

  const curatorIds = [...new Set((reels || []).map(r => r.user_id))];
  const { data: curators } = curatorIds.length
    ? await supabase.from('users').select('*').in('user_id', curatorIds)
    : { data: [] };
  res.json({ reels: reels || [], curators: curators || [] });
});

// Запуск API
app.listen(process.env.PORT, () => {
  console.log(`🌐 API работает на порту ${process.env.PORT}`);
});

// Запуск бота
bot.start({
  onStart: (me) => {
    console.log(`🚀 Бот запущен! Юзернейм: @${me.username}`);
  }
}).catch((err) => {
  console.error('❌ Ошибка запуска бота:', err.message);
});