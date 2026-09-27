const {
  Client,
  GatewayIntentBits,
  Events,
  SlashCommandBuilder,
  REST,
  Routes
} = require('discord.js');
const express = require('express');
require('dotenv').config();

// ===== Keep-alive web server (Render 24/7 এর জন্য) =====
const app = express();
app.get('/', (req, res) => res.send('✅ Super Z Bot is alive!'));
app.listen(process.env.PORT || 3000, () => console.log('🌐 Web server started'));

// ===== Configuration =====
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID || '';
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT ||
  'তুমি Super Z, একজন বন্ধুত্বপূর্ণ ও সাহায্যকারী AI সহকারী। তুমি বাংলায় কথা বলো, নম্র ও সহজ-বোধ্য ভাষায় উত্তর দাও।';
const MAX_MEMORY = parseInt(process.env.MAX_MEMORY || '20', 10);

if (!TOKEN || !CLIENT_ID) {
  console.error('❌ DISCORD_TOKEN বা CLIENT_ID পাওযা যায়নি।');
}

// ===== Conversation Memory (per channel) =====
const conversations = new Map();

function getHistory(channelId) {
  if (!conversations.has(channelId)) {
    conversations.set(channelId, [{ role: 'assistant', content: SYSTEM_PROMPT }]);
  }
  return conversations.get(channelId);
}

function addUserMessage(channelId, text) {
  getHistory(channelId).push({ role: 'user', content: text });
  trimHistory(channelId);
}

function addAssistantMessage(channelId, text) {
  getHistory(channelId).push({ role: 'assistant', content: text });
  trimHistory(channelId);
}

function trimHistory(channelId) {
  const history = getHistory(channelId);
  if (history.length > MAX_MEMORY + 1) {
    const system = history[0];
    const recent = history.slice(-MAX_MEMORY);
    conversations.set(channelId, [system, ...recent]);
  }
}

function clearHistory(channelId) {
  conversations.set(channelId, [{ role: 'assistant', content: SYSTEM_PROMPT }]);
}

// ===== ZAI SDK (lazy init) =====
let ZAI = null;
let zaiInstance = null;

async function getZAI() {
  if (!zaiInstance) {
    if (!ZAI) ZAI = require('z-ai-web-dev-sdk').default || require('z-ai-web-dev-sdk');
    zaiInstance = await ZAI.create();
    console.log('✅ z-ai-web-dev-sdk ইনিশিয়ালাইজ হয়েছে।');
  }
  return zaiInstance;
}

async function askAI(channelId, userMessage) {
  const zai = await getZAI();
  const history = getHistory(channelId);
  addUserMessage(channelId, userMessage);

  const completion = await zai.chat.completions.create({
    messages: history,
    thinking: { type: 'disabled' }
  });

  const response = completion.choices?.[0]?.message?.content?.trim();
  if (!response) throw new Error('AI থেকে খালি উত্তর এসেছে।');
  addAssistantMessage(channelId, response);
  return response;
}

// ===== Discord Client =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ ${c.user.tag} লগইন হয়েছে!`);
  console.log(`🤖 বট প্রস্তুত। @${c.user.username} বলে চ্যাট শুরু করুন।`);
  await registerCommands();
});

// ===== Slash Commands =====
const commands = [
  new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Super Z কে কিছু জিজ্ঞেস করুন')
    .addStringOption(opt =>
      opt.setName('question').setDescription('আপনার প্রশ্ন লিখুন').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('এই চ্যানেলের কথা মনে রাখা মুছে ফেলুন'),
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('বট ব্যবহারের নিয়ম দেখুন')
];

async function registerCommands() {
  if (!TOKEN || !CLIENT_ID) return;
  const restClient = new REST({ version: '10' }).setToken(TOKEN);
  const body = commands.map(cmd => cmd.toJSON());

  try {
    if (GUILD_ID) {
      await restClient.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body });
      console.log(`✅ Slash commands রেজিস্টার হয়েছে (guild: ${GUILD_ID})`);
    } else {
      await restClient.put(Routes.applicationCommands(CLIENT_ID), { body });
      console.log('✅ Slash commands গ্লোবালি রেজিস্টার হয়েছে।');
    }
  } catch (err) {
    console.error('❌ Slash command রেজিস্ট্রেশন ব্যর্থ:', err.message);
  }
}

// ===== Interaction handler =====
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'help') {
    await interaction.reply({
      embeds: [{
        title: '🤖 Super Z Bot — সাহায্য',
        description: [
          `**@${client.user.username}** কে মেনশন করে কথা বলুন`,
          '',
          '**Slash Commands:**',
          '`/ask question: আপনার প্রশ্ন` — একটা নির্দিষ্ট প্রশ্ন',
          '`/clear` — এই চ্যানেলের আগের কথা মুছে ফেলুন',
          '`/help` — এই সাহায্য দেখুন',
          '',
          '💡 বট প্রতি চ্যানেলে আলাদাভাবে কথা মনে রাখে।'
        ].join('\n'),
        color: 0x5865F2
      }]
    });
    return;
  }

  if (interaction.commandName === 'clear') {
    clearHistory(interaction.channelId);
    await interaction.reply({ content: '🧹 এই চ্যানেলের সব আগের কথা মুছে ফেলা হয়েছে।', ephemeral: true });
    return;
  }

  if (interaction.commandName === 'ask') {
    const question = interaction.options.getString('question');
    await interaction.deferReply();

    try {
      const answer = await askAI(interaction.channelId, question);
      await sendChunkedReply((msg) => interaction.editReply(msg), answer);
    } catch (err) {
      console.error('AI error:', err);
      await interaction.editReply('⚠️ দুঃখিত, এই মুহূর্তে উত্তর দেওয়া যাচ্ছে না। আবার চেষ্টা করুন।');
    }
    return;
  }
});

// ===== Message handler (@mention) =====
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const isMentioned = message.mentions.has(client.user, { ignoreRoles: true, ignoreEveryone: true });
  if (!isMentioned) return;

  const text = message.content.replace(/<@!?\d+>/g, '').trim();
  if (!text) {
    await message.reply(`👋 হ্যালো! কিছু জিজ্ঞেস করুন — উদাহরণ: \`<@${client.user.id}> আজকের আবহাওয়া কেমন?\``);
    return;
  }

  await message.channel.sendTyping();
  const typingInterval = setInterval(() => message.channel.sendTyping().catch(() => {}), 5000);

  try {
    const answer = await askAI(message.channelId, text);
    clearInterval(typingInterval);
    await sendChunkedReply((msg) => message.reply(msg), answer);
  } catch (err) {
    clearInterval(typingInterval);
    console.error('AI error:', err);
    await message.reply('⚠️ দুঃখিত, উত্তর দেওয়া যাচ্ছে না। আবার চেষ্টা করুন।');
  }
});

// ===== Helper: split long messages =====
async function sendChunkedReply(send, text, limit = 1900) {
  if (text.length <= limit) {
    await send(text);
    return;
  }
  const chunks = splitText(text, limit);
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 200));
    await send(chunks[i]);
  }
}

function splitText(text, limit) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf('\n', limit);
    if (cut === -1 || cut < limit / 2) {
      cut = remaining.lastIndexOf(' ', limit);
      if (cut === -1 || cut < limit / 2) cut = limit;
    }
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

// ===== Login =====
if (TOKEN) {
  client.login(TOKEN).catch(err => {
    console.error('❌ লগইন ব্যর্থ:', err.message);
  });
}

process.on('SIGINT', () => {
  console.log('\n👋 বট বন্ধ করা হচ্ছে...');
  client.destroy();
  process.exit(0);
});
