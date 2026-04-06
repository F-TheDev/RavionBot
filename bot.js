require('./keep_alive.js');
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, ActionRowBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, MessageFlags } = require('discord.js');
const Database = require('better-sqlite3');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

// ================================
// DATABASE SETUP
// ================================
const db = new Database('./data.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS purchase_dms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    dm_channel_id TEXT NOT NULL,
    dm_message_id TEXT NOT NULL,
    product_title TEXT NOT NULL,
    description_text TEXT NOT NULL,
    download_link TEXT,
    downloadable INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS version_dms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    dm_channel_id TEXT NOT NULL,
    dm_message_id TEXT NOT NULL,
    product_title TEXT NOT NULL,
    download_link TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tracked_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role_id TEXT NOT NULL UNIQUE,
    product_title TEXT NOT NULL
  );
`);

console.log('✅ Database ready');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
  ]
});

const buttonData = new Map();
const pendingPurchases = new Map();
let buttonCounter = 0;

// ================================
// SLASH COMMANDS
// ================================
const commands = [
  // /create embed
  new SlashCommandBuilder()
    .setName('create')
    .setDescription('Create a product embed')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub.setName('embed')
        .setDescription('Creates a product embed in a specific channel')
        .addChannelOption(opt => opt.setName('channel').setDescription('Channel where the embed will be posted').setRequired(true))
        .addStringOption(opt => opt.setName('title').setDescription('Product title').setRequired(true))
        .addStringOption(opt => opt.setName('price').setDescription('Price in R$ (e.g. 50)').setRequired(true))
        .addStringOption(opt => opt.setName('buy_link').setDescription('Purchase link').setRequired(true))
        .addRoleOption(opt => opt.setName('purchase_role').setDescription('Role to check after purchase').setRequired(true))
        .addBooleanOption(opt => opt.setName('downloadable').setDescription('Is this product downloadable?').setRequired(true))
        .addBooleanOption(opt => opt.setName('off_sale').setDescription('Is this product off sale?').setRequired(true))
        .addBooleanOption(opt => opt.setName('show_buy_button').setDescription('Show the Buy button? If false, only Download button shown').setRequired(true))
        .addStringOption(opt => opt.setName('category1_content').setDescription('Category 1 content (use \\n for new lines)').setRequired(true))
        .addAttachmentOption(opt => opt.setName('image').setDescription('Embed image').setRequired(true))
        .addStringOption(opt => opt.setName('color').setDescription('Left stripe color hex (e.g. #A8FF3E)').setRequired(true))
        .addStringOption(opt => opt.setName('version').setDescription('Product version (e.g. V1.0.0) — internal only').setRequired(true))
        .addStringOption(opt => opt.setName('subtitle').setDescription('Text under title (optional)').setRequired(false))
        .addStringOption(opt => opt.setName('category2_title').setDescription('Category 2 title').setRequired(false))
        .addStringOption(opt => opt.setName('category2_content').setDescription('Category 2 content').setRequired(false))
        .addStringOption(opt => opt.setName('category3_title').setDescription('Category 3 title').setRequired(false))
        .addStringOption(opt => opt.setName('category3_content').setDescription('Category 3 content').setRequired(false))
        .addStringOption(opt => opt.setName('download_link').setDescription('Download link').setRequired(false))
    ),

  // /update embed
  new SlashCommandBuilder()
    .setName('update')
    .setDescription('Update an existing product embed')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub.setName('embed')
        .setDescription('Updates an existing embed by message ID')
        .addStringOption(opt => opt.setName('message_id').setDescription('Message ID of the embed').setRequired(true))
        .addChannelOption(opt => opt.setName('channel').setDescription('Channel where the embed is').setRequired(true))
        .addStringOption(opt => opt.setName('title').setDescription('Product title').setRequired(true))
        .addStringOption(opt => opt.setName('price').setDescription('Price in R$').setRequired(true))
        .addStringOption(opt => opt.setName('buy_link').setDescription('Purchase link').setRequired(true))
        .addRoleOption(opt => opt.setName('purchase_role').setDescription('Role to check after purchase').setRequired(true))
        .addBooleanOption(opt => opt.setName('downloadable').setDescription('Is this product downloadable?').setRequired(true))
        .addBooleanOption(opt => opt.setName('off_sale').setDescription('Is this product off sale?').setRequired(true))
        .addBooleanOption(opt => opt.setName('show_buy_button').setDescription('Show the Buy button?').setRequired(true))
        .addStringOption(opt => opt.setName('category1_content').setDescription('Category 1 content').setRequired(true))
        .addStringOption(opt => opt.setName('color').setDescription('Left stripe color hex').setRequired(true))
        .addStringOption(opt => opt.setName('version').setDescription('New version (e.g. V2.0.0)').setRequired(true))
        .addStringOption(opt => opt.setName('old_version').setDescription('Current version (e.g. V1.0.0)').setRequired(true))
        .addStringOption(opt => opt.setName('subtitle').setDescription('Text under title').setRequired(false))
        .addStringOption(opt => opt.setName('category2_title').setDescription('Category 2 title').setRequired(false))
        .addStringOption(opt => opt.setName('category2_content').setDescription('Category 2 content').setRequired(false))
        .addStringOption(opt => opt.setName('category3_title').setDescription('Category 3 title').setRequired(false))
        .addStringOption(opt => opt.setName('category3_content').setDescription('Category 3 content').setRequired(false))
        .addStringOption(opt => opt.setName('download_link').setDescription('New download link').setRequired(false))
        .addAttachmentOption(opt => opt.setName('image').setDescription('New image (leave empty to keep current)').setRequired(false))
    ),

  // /delete product
  new SlashCommandBuilder()
    .setName('delete')
    .setDescription('Delete a product and all its DMs')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub.setName('product')
        .setDescription('Deletes all DMs related to a product by role')
        .addRoleOption(opt => opt.setName('purchase_role').setDescription('The role of the product to delete').setRequired(true))
    ),

  // /send message
  new SlashCommandBuilder()
    .setName('send')
    .setDescription('Send a custom embed DM to all members with a role')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub.setName('message')
        .setDescription('Sends a custom embed DM to all members with a role')
        .addRoleOption(opt => opt.setName('role').setDescription('All members with this role will receive the DM').setRequired(true))
        .addStringOption(opt => opt.setName('title').setDescription('Embed title').setRequired(true))
        .addStringOption(opt => opt.setName('content').setDescription('Main text (use \\n for new lines)').setRequired(true))
        .addStringOption(opt => opt.setName('color').setDescription('Left stripe color hex').setRequired(true))
        .addStringOption(opt => opt.setName('subtitle').setDescription('Subtitle (optional)').setRequired(false))
    ),

  // /check license
  new SlashCommandBuilder()
    .setName('check')
    .setDescription('Check the licenses of a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub.setName('license')
        .setDescription('Shows all tracked product licenses a user has or does not have')
        .addUserOption(opt => opt.setName('user').setDescription('The user to check').setRequired(true))
    )
].map(cmd => cmd.toJSON());

// ================================
// BOT READY
// ================================
client.once('clientReady', async () => {
  console.log(`✅ Bot is online as ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    console.log('📡 Registering slash commands...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('✅ Slash commands registered!');
  } catch (err) {
    console.error('❌ Error registering commands:', err);
  }
});

// ================================
// BUILD PRODUCT EMBED
// ================================
function buildEmbed({ title, subtitle, cat1Content, cat2Title, cat2Content, cat3Title, cat3Content, price, imageUrl, colorHex }) {
  let desc = `# ${title}\n`;
  if (subtitle) desc += `**${subtitle}**\n`;
  desc += '\n' + cat1Content.split('\\n').map(l => `> ${l}`).join('\n') + '\n';
  if (cat2Title && cat2Content) {
    desc += `\n> ${cat2Title}\n`;
    desc += cat2Content.split('\\n').map(l => `> ${l}`).join('\n') + '\n';
  }
  if (cat3Title && cat3Content) {
    desc += `\n> ${cat3Title}\n`;
    desc += cat3Content.split('\\n').map(l => `> ${l}`).join('\n') + '\n';
  }
  desc += `\n-# ——————————————————————————————\n`;
  desc += `**R$** ${price}`;
  return new EmbedBuilder().setColor(colorHex).setDescription(desc).setImage(imageUrl);
}

// ================================
// BUILD PUBLIC BUTTONS
// showBuyButton: whether to show the Buy button
// ================================
function buildPublicButtons({ offSale, downloadable, price, btnId, showBuyButton }) {
  const btns = [];

  if (offSale) {
    btns.push(new ButtonBuilder().setCustomId('off_sale_disabled').setLabel('Off Sale').setStyle(ButtonStyle.Danger).setDisabled(true));
  } else {
    if (showBuyButton) {
      btns.push(new ButtonBuilder().setCustomId(btnId).setLabel(`Buy - R$${price}`).setStyle(ButtonStyle.Primary));
    }
    btns.push(downloadable
      ? new ButtonBuilder().setCustomId('download_locked').setLabel('Download available').setStyle(ButtonStyle.Success).setDisabled(true)
      : new ButtonBuilder().setCustomId('download_unavailable').setLabel('Download unavailable').setStyle(ButtonStyle.Danger).setDisabled(true)
    );
  }

  return new ActionRowBuilder().addComponents(btns);
}

// ================================
// DB HELPERS
// ================================
function savePurchaseDM(roleId, userId, dmChannelId, dmMessageId, productTitle, descText, downloadLink, downloadable = 1) {
  db.prepare('DELETE FROM purchase_dms WHERE role_id = ? AND user_id = ?').run(roleId, userId);
  db.prepare(`INSERT INTO purchase_dms (role_id, user_id, dm_channel_id, dm_message_id, product_title, description_text, download_link, downloadable)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(roleId, userId, dmChannelId, dmMessageId, productTitle, descText, downloadLink || null, downloadable);
}

function saveVersionDM(roleId, userId, dmChannelId, dmMessageId, productTitle, downloadLink) {
  db.prepare(`INSERT INTO version_dms (role_id, user_id, dm_channel_id, dm_message_id, product_title, download_link)
    VALUES (?, ?, ?, ?, ?, ?)`).run(roleId, userId, dmChannelId, dmMessageId, productTitle, downloadLink || null);
}

function trackProduct(roleId, productTitle) {
  db.prepare('INSERT OR REPLACE INTO tracked_products (role_id, product_title) VALUES (?, ?)').run(roleId, productTitle);
}

// ================================
// DELETE ALL DMs FOR A PRODUCT
// ================================
async function deleteAllProductDMs(roleId) {
  const purchaseRows = db.prepare('SELECT * FROM purchase_dms WHERE role_id = ?').all(roleId);
  const versionRows  = db.prepare('SELECT * FROM version_dms WHERE role_id = ?').all(roleId);
  const allRows      = [...purchaseRows, ...versionRows];

  let deleted = 0, failed = 0;

  for (const row of allRows) {
    try {
      const dmChannel = await client.channels.fetch(row.dm_channel_id).catch(() => null);
      if (!dmChannel) { failed++; continue; }
      const dmMsg = await dmChannel.messages.fetch(row.dm_message_id).catch(() => null);
      if (dmMsg) { await dmMsg.delete(); deleted++; }
      await new Promise(r => setTimeout(r, 300));
    } catch (_) { failed++; }
  }

  db.prepare('DELETE FROM purchase_dms WHERE role_id = ?').run(roleId);
  db.prepare('DELETE FROM version_dms WHERE role_id = ?').run(roleId);
  db.prepare('DELETE FROM tracked_products WHERE role_id = ?').run(roleId);

  return { deleted, failed };
}

// ================================
// EDIT PURCHASE DMs → UNAVAILABLE
// ================================
async function updatePurchaseDMsToUnavailable(roleId) {
  const rows = db.prepare('SELECT * FROM purchase_dms WHERE role_id = ? AND downloadable = 1').all(roleId);
  if (!rows.length) return { updated: 0, failed: 0 };

  let updated = 0, failed = 0;
  for (const row of rows) {
    try {
      const dmChannel = await client.channels.fetch(row.dm_channel_id).catch(() => null);
      if (!dmChannel) { failed++; continue; }
      const dmMsg = await dmChannel.messages.fetch(row.dm_message_id).catch(() => null);
      if (!dmMsg) { failed++; continue; }

      const updatedEmbed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle(row.product_title + ' — License Unavailable')
        .setDescription(
          `This license is currently **not available**.\n\n` +
          `You will be notified with the new download link as soon as it becomes available again.\n\n` +
          `We apologize for the inconvenience and appreciate your patience.\n\n` +
          `-# For any questions, please open a ticket in <#1466551341601128468>.`
        )
        .setTimestamp()
        .setFooter({ text: row.product_title + ' • License' });

      await dmMsg.edit({
        embeds: [updatedEmbed],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`dl_unavail_${row.user_id}`).setLabel('Download unavailable').setStyle(ButtonStyle.Danger).setDisabled(true)
        )]
      });
      updated++;
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      failed++;
    }
  }

  db.prepare('UPDATE purchase_dms SET downloadable = 0 WHERE role_id = ?').run(roleId);
  return { updated, failed };
}

// ================================
// HANDLE DOWNLOAD LINK CHANGE
// ================================
async function handleDownloadLinkChange(roleId, productTitle, newDownloadLink, colorHex) {
  const oldVersionDMs = db.prepare('SELECT * FROM version_dms WHERE role_id = ?').all(roleId);
  let deletedVersionDMs = 0;
  for (const row of oldVersionDMs) {
    try {
      const dmCh = await client.channels.fetch(row.dm_channel_id).catch(() => null);
      if (dmCh) {
        const dmMsg = await dmCh.messages.fetch(row.dm_message_id).catch(() => null);
        if (dmMsg) { await dmMsg.delete(); deletedVersionDMs++; }
      }
      await new Promise(r => setTimeout(r, 300));
    } catch (_) {}
  }
  db.prepare('DELETE FROM version_dms WHERE role_id = ?').run(roleId);

  const purchaseRows = db.prepare('SELECT * FROM purchase_dms WHERE role_id = ?').all(roleId);
  let sent = 0, failed = 0;

  for (const row of purchaseRows) {
    try {
      const user = await client.users.fetch(row.user_id).catch(() => null);
      if (!user) { failed++; continue; }

      const availEmbed = new EmbedBuilder()
        .setColor(colorHex)
        .setTitle(`${productTitle} — Now Available`)
        .setDescription(
          `**${productTitle}** is now available for download again!\n\n` +
          `The download has been restored and is ready for you. Please use the new download link below.\n\n` +
          `Make sure to replace any previous version you may have installed.\n\n` +
          `-# For any questions, feel free to reach out in <#1466551341601128468>.`
        )
        .setTimestamp()
        .setFooter({ text: `${productTitle} • Download Available` });

      const sentMsg = await user.send({
        embeds: [availEmbed],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel('Download available').setStyle(ButtonStyle.Link).setURL(newDownloadLink)
        )]
      });
      saveVersionDM(roleId, user.id, sentMsg.channel.id, sentMsg.id, productTitle, newDownloadLink);
      sent++;
      await new Promise(r => setTimeout(r, 500));
    } catch (_) { failed++; }
  }

  // Also update purchase DMs with new link
  for (const row of purchaseRows) {
    try {
      const dmCh = await client.channels.fetch(row.dm_channel_id).catch(() => null);
      if (!dmCh) continue;
      const dmMsg = await dmCh.messages.fetch(row.dm_message_id).catch(() => null);
      if (!dmMsg) continue;

      const restoredEmbed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle(row.product_title + ' — License Confirmed')
        .setDescription(row.description_text)
        .setTimestamp()
        .setFooter({ text: row.product_title + ' • License' });

      await dmMsg.edit({
        embeds: [restoredEmbed],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel('Download available').setStyle(ButtonStyle.Link).setURL(newDownloadLink)
        )]
      });
      db.prepare('UPDATE purchase_dms SET download_link = ?, downloadable = 1 WHERE role_id = ? AND user_id = ?')
        .run(newDownloadLink, roleId, row.user_id);
      await new Promise(r => setTimeout(r, 300));
    } catch (_) {}
  }

  return { sent, failed, deletedVersionDMs };
}

// ================================
// INTERACTION HANDLER
// ================================
client.on('interactionCreate', async interaction => {

  // /create embed
  if (interaction.isChatInputCommand() && interaction.commandName === 'create' && interaction.options.getSubcommand() === 'embed') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator))
      return interaction.reply({ content: '❌ No permission!', flags: MessageFlags.Ephemeral });

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const channel       = interaction.options.getChannel('channel');
      const title         = interaction.options.getString('title');
      const price         = interaction.options.getString('price');
      const buyLink       = interaction.options.getString('buy_link');
      const purchaseRole  = interaction.options.getRole('purchase_role');
      const downloadable  = interaction.options.getBoolean('downloadable');
      const offSale       = interaction.options.getBoolean('off_sale');
      const showBuyButton = interaction.options.getBoolean('show_buy_button');
      const cat1Content   = interaction.options.getString('category1_content');
      const image         = interaction.options.getAttachment('image');
      const colorInput    = interaction.options.getString('color');
      const version       = interaction.options.getString('version');
      const subtitle      = interaction.options.getString('subtitle') || null;
      const cat2Title     = interaction.options.getString('category2_title') || null;
      const cat2Content   = interaction.options.getString('category2_content') || null;
      const cat3Title     = interaction.options.getString('category3_title') || null;
      const cat3Content   = interaction.options.getString('category3_content') || null;
      const downloadLink  = interaction.options.getString('download_link') || null;
      const colorHex      = parseInt(colorInput.replace('#', ''), 16) || 0xA8FF3E;
      const btnId         = `buy_${buttonCounter++}`;

      buttonData.set(btnId, { roleId: purchaseRole.id, buyLink, title, downloadable, downloadLink, price, colorHex, imageUrl: image.url, subtitle, version, cat1Content, cat2Title, cat2Content, cat3Title, cat3Content, showBuyButton });
      trackProduct(purchaseRole.id, title);

      const embed = buildEmbed({ title, subtitle, cat1Content, cat2Title, cat2Content, cat3Title, cat3Content, price, imageUrl: image.url, colorHex });
      const row   = buildPublicButtons({ offSale, downloadable, price, btnId, showBuyButton });

      await channel.send({ embeds: [embed], components: [row] });
      await interaction.editReply({ content: `✅ Embed posted in <#${channel.id}>! (Version: ${version})` });
    } catch (err) {
      console.error('❌ Error creating embed:', err);
      await interaction.editReply({ content: `❌ Error: ${err.message}` });
    }
  }

  // /update embed
  if (interaction.isChatInputCommand() && interaction.commandName === 'update' && interaction.options.getSubcommand() === 'embed') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator))
      return interaction.reply({ content: '❌ No permission!', flags: MessageFlags.Ephemeral });

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const messageId     = interaction.options.getString('message_id');
      const channel       = interaction.options.getChannel('channel');
      const title         = interaction.options.getString('title');
      const price         = interaction.options.getString('price');
      const buyLink       = interaction.options.getString('buy_link');
      const purchaseRole  = interaction.options.getRole('purchase_role');
      const downloadable  = interaction.options.getBoolean('downloadable');
      const offSale       = interaction.options.getBoolean('off_sale');
      const showBuyButton = interaction.options.getBoolean('show_buy_button');
      const cat1Content   = interaction.options.getString('category1_content');
      const colorInput    = interaction.options.getString('color');
      const version       = interaction.options.getString('version');
      const oldVersion    = interaction.options.getString('old_version');
      const subtitle      = interaction.options.getString('subtitle') || null;
      const cat2Title     = interaction.options.getString('category2_title') || null;
      const cat2Content   = interaction.options.getString('category2_content') || null;
      const cat3Title     = interaction.options.getString('category3_title') || null;
      const cat3Content   = interaction.options.getString('category3_content') || null;
      const downloadLink  = interaction.options.getString('download_link') || null;
      const newImage      = interaction.options.getAttachment('image') || null;
      const colorHex      = parseInt(colorInput.replace('#', ''), 16) || 0xA8FF3E;

      const targetMessage = await channel.messages.fetch(messageId).catch(() => null);
      if (!targetMessage) return await interaction.editReply({ content: '❌ Message not found!' });

      const imageUrl = newImage ? newImage.url : (targetMessage.embeds[0]?.image?.url || 'https://example.com');
      const btnId    = `buy_${buttonCounter++}`;
      buttonData.set(btnId, { roleId: purchaseRole.id, buyLink, title, downloadable, downloadLink, price, colorHex, imageUrl, subtitle, version, cat1Content, cat2Title, cat2Content, cat3Title, cat3Content, showBuyButton });
      trackProduct(purchaseRole.id, title);

      const embed = buildEmbed({ title, subtitle, cat1Content, cat2Title, cat2Content, cat3Title, cat3Content, price, imageUrl, colorHex });
      const row   = buildPublicButtons({ offSale, downloadable, price, btnId, showBuyButton });
      await targetMessage.edit({ embeds: [embed], components: [row] });

      const versionChanged  = version.trim().toLowerCase() !== oldVersion.trim().toLowerCase();
      const oldLinkRow      = db.prepare('SELECT download_link FROM purchase_dms WHERE role_id = ? LIMIT 1').get(purchaseRole.id);
      const oldDownloadLink = oldLinkRow?.download_link || null;
      const linkChanged     = downloadLink && oldDownloadLink && downloadLink !== oldDownloadLink;

      await interaction.guild.members.fetch();
      const roleMembers = interaction.guild.members.cache.filter(m => m.roles.cache.has(purchaseRole.id) && !m.user.bot);

      if (versionChanged) {
        if (!downloadable) return await interaction.editReply({ content: `✅ Embed updated! Version changed but downloadable is false — no DMs sent.` });
        await interaction.editReply({ content: `✅ Embed updated! Sending version DMs...` });
        let sent = 0, failed = 0;
        for (const [, member] of roleMembers) {
          try {
            const vEmbed = new EmbedBuilder()
              .setColor(colorHex)
              .setTitle(`${title} — ${version} Released`)
              .setDescription(
                `A new version of **${title}** has been released!\n\n` +
                `**${version}** is now available. Please re-download the product to receive the latest updates.\n\n` +
                `Make sure to replace your old version with the new one.\n\n` +
                `-# For any questions, open a ticket in <#1466551341601128468>.`
              )
              .setTimestamp()
              .setFooter({ text: `${title} • Version Update` });

            const sentMsg = await member.user.send({
              embeds: [vEmbed],
              components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setLabel('Download available').setStyle(ButtonStyle.Link).setURL(downloadLink)
              )]
            });
            saveVersionDM(purchaseRole.id, member.user.id, sentMsg.channel.id, sentMsg.id, title, downloadLink);
            sent++;
            await new Promise(r => setTimeout(r, 500));
          } catch (_) { failed++; }
        }
        await interaction.editReply({ content: `✅ **${oldVersion}** → **${version}**. DMs sent: **${sent}** ✅ | Failed: **${failed}** ❌` });

      } else if (linkChanged && downloadable) {
        await interaction.editReply({ content: `✅ Embed updated! Download link changed — updating DMs...` });
        const { sent, failed, deletedVersionDMs } = await handleDownloadLinkChange(purchaseRole.id, title, downloadLink, colorHex);
        await interaction.editReply({ content: `✅ Link updated!\n• Old version DMs deleted: **${deletedVersionDMs}**\n• New DMs sent: **${sent}** ✅ | Failed: **${failed}** ❌` });

      } else if (!downloadable) {
        await interaction.editReply({ content: `✅ Embed updated! Editing DMs to unavailable...` });
        const { updated, failed } = await updatePurchaseDMsToUnavailable(purchaseRole.id);

        // Also update version DMs
        const vRows = db.prepare('SELECT * FROM version_dms WHERE role_id = ?').all(purchaseRole.id);
        let vUpdated = 0;
        for (const row of vRows) {
          try {
            const dmCh = await client.channels.fetch(row.dm_channel_id).catch(() => null);
            if (!dmCh) continue;
            const dmMsg = await dmCh.messages.fetch(row.dm_message_id).catch(() => null);
            if (!dmMsg) continue;
            const uEmbed = new EmbedBuilder()
              .setColor(0xED4245)
              .setTitle(row.product_title + ' — License Unavailable')
              .setDescription(`The download for **${row.product_title}** is currently **unavailable**.\n\nYou will be notified once it becomes available again.\n\n-# For questions, open a ticket in <#1466551341601128468>.`)
              .setTimestamp().setFooter({ text: row.product_title + ' • Download Status' });
            await dmMsg.edit({ embeds: [uEmbed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`vdl_${row.user_id}`).setLabel('Download unavailable').setStyle(ButtonStyle.Danger).setDisabled(true))] });
            vUpdated++;
            await new Promise(r => setTimeout(r, 300));
          } catch (_) {}
        }
        await interaction.editReply({ content: `✅ Embed updated!\n• Purchase DMs updated: **${updated}** ✅ | Failed: **${failed}** ❌\n• Version DMs updated: **${vUpdated}** ✅` });
      } else {
        await interaction.editReply({ content: `✅ Embed updated! (Version: ${version})` });
      }
    } catch (err) {
      console.error('❌ Error updating embed:', err);
      await interaction.editReply({ content: `❌ Error: ${err.message}` });
    }
  }

  // /delete product
  if (interaction.isChatInputCommand() && interaction.commandName === 'delete' && interaction.options.getSubcommand() === 'product') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator))
      return interaction.reply({ content: '❌ No permission!', flags: MessageFlags.Ephemeral });

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const purchaseRole = interaction.options.getRole('purchase_role');
      await interaction.editReply({ content: `🗑️ Deleting all DMs for **${purchaseRole.name}**...` });

      const { deleted, failed } = await deleteAllProductDMs(purchaseRole.id);
      await interaction.editReply({ content: `✅ Done! DMs deleted: **${deleted}** ✅ | Failed: **${failed}** ❌` });
    } catch (err) {
      console.error('❌ Error deleting product:', err);
      await interaction.editReply({ content: `❌ Error: ${err.message}` });
    }
  }

  // /send message
  if (interaction.isChatInputCommand() && interaction.commandName === 'send' && interaction.options.getSubcommand() === 'message') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator))
      return interaction.reply({ content: '❌ No permission!', flags: MessageFlags.Ephemeral });

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const role       = interaction.options.getRole('role');
      const title      = interaction.options.getString('title');
      const content    = interaction.options.getString('content');
      const colorInput = interaction.options.getString('color');
      const subtitle   = interaction.options.getString('subtitle') || null;
      const colorHex   = parseInt(colorInput.replace('#', ''), 16) || 0x5865F2;

      let descText = '';
      if (subtitle) descText += `**${subtitle}**\n\n`;
      descText += content.split('\\n').join('\n');

      const now     = new Date();
      const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

      const embed = new EmbedBuilder()
        .setColor(colorHex).setTitle(title).setDescription(descText)
        .setFooter({ text: `${dateStr} • ${timeStr}` }).setTimestamp();

      await interaction.guild.members.fetch();
      const roleMembers = interaction.guild.members.cache.filter(m => m.roles.cache.has(role.id) && !m.user.bot);
      let sent = 0, failed = 0;
      for (const [, member] of roleMembers) {
        try { await member.user.send({ embeds: [embed] }); sent++; await new Promise(r => setTimeout(r, 500)); }
        catch (_) { failed++; }
      }
      await interaction.editReply({ content: `✅ DMs sent to **${role.name}**! Sent: **${sent}** ✅ | Failed: **${failed}** ❌` });
    } catch (err) {
      console.error('❌ Error sending message:', err);
      await interaction.editReply({ content: `❌ Error: ${err.message}` });
    }
  }

  // /check license
  if (interaction.isChatInputCommand() && interaction.commandName === 'check' && interaction.options.getSubcommand() === 'license') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator))
      return interaction.reply({ content: '❌ No permission!', flags: MessageFlags.Ephemeral });

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const targetUser   = interaction.options.getUser('user');
      const member       = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      const trackedProds = db.prepare('SELECT * FROM tracked_products').all();

      if (!member) return await interaction.editReply({ content: '❌ User not found in this server.' });
      if (!trackedProds.length) return await interaction.editReply({ content: '❌ No tracked products found. Create an embed first.' });

      let licenseLines = '';
      for (const prod of trackedProds) {
        const hasRole = member.roles.cache.has(prod.role_id);
        licenseLines += `${hasRole ? '✅' : '❌'} **${prod.product_title}** — ${hasRole ? 'License active' : 'No license'}\n`;
      }

      const checkEmbed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`License Check — ${targetUser.username}`)
        .setThumbnail(targetUser.displayAvatarURL())
        .setDescription(licenseLines)
        .setTimestamp()
        .setFooter({ text: `Checked by ${interaction.user.username}` });

      await interaction.editReply({ embeds: [checkEmbed] });
    } catch (err) {
      console.error('❌ Error checking license:', err);
      await interaction.editReply({ content: `❌ Error: ${err.message}` });
    }
  }

  // Buy button
  if (interaction.isButton() && interaction.customId.startsWith('buy_')) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const data = buttonData.get(interaction.customId);
      if (!data) return await interaction.editReply({ content: '❌ Button data not found. Please recreate the embed.' });

      const { roleId, buyLink, title, downloadable, downloadLink } = data;
      const userId = interaction.user.id;
      const member = await interaction.guild.members.fetch(userId).catch(() => null);

      // User already has role → resend purchase DM
      if (member && member.roles.cache.has(roleId)) {
        await sendPurchaseDM(member.user, title, downloadable, downloadLink, roleId);
        return await interaction.editReply({ content: `✅ You already have access! Check your DMs.` });
      }

      // Normal purchase flow (Buy works even if not downloadable)
      pendingPurchases.set(userId, { roleId, title, downloadable, downloadLink, startTime: Date.now() });

      const linkButton = new ButtonBuilder().setLabel('Go to purchase →').setStyle(ButtonStyle.Link).setURL(buyLink);
      await interaction.editReply({
        content: `🛒 Click below to purchase! Once you receive the role <@&${roleId}>, you will automatically get a DM.`,
        components: [new ActionRowBuilder().addComponents(linkButton)]
      });

      startRoleCheck(userId, interaction.guild);
    } catch (err) {
      console.error('❌ Buy button error:', err);
      await interaction.editReply({ content: '❌ An error occurred.' });
    }
  }
});

// ================================
// ROLE CHECK
// ================================
function startRoleCheck(userId, guild) {
  if (pendingPurchases.get(userId)?._checking) return;
  const pending = pendingPurchases.get(userId);
  if (pending) pending._checking = true;

  const maxDuration = 30 * 60 * 1000;
  const startTime = Date.now();

  const interval = setInterval(async () => {
    try {
      const p = pendingPurchases.get(userId);
      if (!p) { clearInterval(interval); return; }
      if (Date.now() - startTime > maxDuration) { pendingPurchases.delete(userId); clearInterval(interval); return; }

      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) { clearInterval(interval); return; }

      if (member.roles.cache.has(p.roleId)) {
        pendingPurchases.delete(userId);
        clearInterval(interval);
        await sendPurchaseDM(member.user, p.title, p.downloadable, p.downloadLink, p.roleId);
        console.log(`✅ Purchase verified for ${member.user.tag}`);
      }
    } catch (err) {
      console.error('Role check error:', err);
    }
  }, 10000);
}

// ================================
// SEND PURCHASE DM + SAVE TO DB
// ================================
async function sendPurchaseDM(user, productTitle, downloadable, downloadLink, roleId) {
  try {
    const descriptionText =
      `Hey! You have successfully purchased the **${productTitle}** license.\n\n` +
      `Please make sure to follow our product rules at all times. Violations may result in consequences including the removal of your license.\n\n` +
      `By using this product you agree that **FTS is not responsible for your actions**. If you use modified or altered versions of this product, our support team will not be able to assist you.\n\n` +
      `You are not permitted to share, redistribute or resell this license or its contents under any circumstances.\n\n` +
      `For any questions or support, our team is happy to help — please open a ticket in <#1466551341601128468>.\n\n` +
      `-# FTS reserves the right to revoke your license at any time in the event of rule violations or breaches of the Roblox Terms of Service.`;

    const dmEmbed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle(`${productTitle} — License Confirmed`)
      .setDescription(descriptionText)
      .setTimestamp()
      .setFooter({ text: `${productTitle} • License` });

    const dmBtns = [];
    if (downloadable && downloadLink?.startsWith('http')) {
      dmBtns.push(new ButtonBuilder().setLabel('Download available').setStyle(ButtonStyle.Link).setURL(downloadLink));
    } else {
      dmBtns.push(new ButtonBuilder().setCustomId(`dm_dl_unavail_${user.id}`).setLabel('Download unavailable').setStyle(ButtonStyle.Danger).setDisabled(true));
    }

    const sentMsg = await user.send({ embeds: [dmEmbed], components: [new ActionRowBuilder().addComponents(dmBtns)] });
    console.log(`✅ DM sent to ${user.tag}`);

    if (roleId) {
      savePurchaseDM(roleId, user.id, sentMsg.channel.id, sentMsg.id, productTitle, descriptionText, downloadLink, downloadable ? 1 : 0);
    }
  } catch (err) {
    console.error(`❌ Could not send DM to ${user.tag}:`, err.message);
  }
}

client.login(TOKEN);