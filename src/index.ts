import { Client, GatewayIntentBits, Events, EmbedBuilder, SlashCommandBuilder, REST, Routes, Partials } from 'discord.js';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Configuration
const config = {
  token: process.env.DISCORD_TOKEN!,
  clientId: process.env.CLIENT_ID!,
  guildId: process.env.GUILD_ID!, // Your server/guild ID for instant command updates
  adminChannelId: process.env.ADMIN_CHANNEL_ID!,
  boosterRoleId: process.env.BOOSTER_ROLE_ID!,
  targetRoleId: process.env.TARGET_ROLE_ID!, // The role to check for
  allowedUserId: '1025770042245251122', // Your user ID for /test command
  allowedRoleId: '1435335614378676345', // Role that can use /check command
};

// Create a new client instance
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.GuildMember],
});

// When the client is ready
client.once(Events.ClientReady, async (readyClient) => {
  console.log(`✅ Logged in as ${readyClient.user.tag}!`);
  
  // Register slash commands
  await registerCommands();
});

// Listen for role updates
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  console.log(`👤 Member update detected for ${newMember.user.tag}`);
  
  // Check if booster role was removed
  const hadBoosterRole = oldMember.roles.cache.has(config.boosterRoleId);
  const hasBoosterRole = newMember.roles.cache.has(config.boosterRoleId);
  
  console.log(`  Had booster: ${hadBoosterRole}, Has booster: ${hasBoosterRole}`);
  
  // If they had the booster role but don't anymore
  if (hadBoosterRole && !hasBoosterRole) {
    console.log(`🔻 ${newMember.user.tag} lost booster role!`);
    
    // Check if they have the target role
    const hasTargetRole = newMember.roles.cache.has(config.targetRoleId);
    console.log(`  Has target role: ${hasTargetRole}`);
    
    if (hasTargetRole) {
      // Send notification to admin channel
      const adminChannel = await client.channels.fetch(config.adminChannelId);
      
      if (adminChannel?.isTextBased() && 'send' in adminChannel) {
        const embed = new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('⚠️ Boost Removed Alert')
          .setDescription(`${newMember.user.tag} has stopped boosting the server!`)
          .addFields(
            { name: 'User', value: `<@${newMember.user.id}>`, inline: true },
            { name: 'User ID', value: newMember.user.id, inline: true },
            { name: 'Special Role', value: `<@&${config.targetRoleId}>`, inline: true }
          )
          .setThumbnail(newMember.user.displayAvatarURL())
          .setTimestamp();
        
        await adminChannel.send({ embeds: [embed] });
        console.log(`📢 Notified admins: ${newMember.user.tag} stopped boosting`);
      }
    } else {
      console.log(`ℹ️ ${newMember.user.tag} stopped boosting but doesn't have the target role - no notification sent`);
    }
  }
});

// Handle slash commands
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  
  if (interaction.commandName === 'test') {
    // Check if user is allowed
    if (interaction.user.id !== config.allowedUserId) {
      await interaction.reply({ content: '❌ You do not have permission to use this command.', flags: 64 });
      return;
    }
    
    // Create test embed
    const testEmbed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('✅ Test Embed')
      .setDescription('This is a test embed to verify the bot is working correctly!')
      .addFields(
        { name: 'Status', value: 'All systems operational', inline: true },
        { name: 'Triggered by', value: `${interaction.user.tag}`, inline: true }
      )
      .setThumbnail(interaction.user.displayAvatarURL())
      .setTimestamp()
      .setFooter({ text: 'Test Command' });
    
    await interaction.reply({ embeds: [testEmbed] });
    console.log(`🧪 Test command triggered by ${interaction.user.tag}`);
  }
  
  if (interaction.commandName === 'ping') {
    const sent = await interaction.reply({ content: 'Pinging...', withResponse: true, flags: 64 });
    
    const wsLatency = client.ws.ping;
    const apiLatency = sent.createdTimestamp - interaction.createdTimestamp;
    const shardId = interaction.guild?.shardId ?? 0;
    
    const pingEmbed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🏓 Pong!')
      .addFields(
        { name: '📡 Websocket Latency', value: `${wsLatency}ms`, inline: true },
        { name: '🔄 API Latency', value: `${apiLatency}ms`, inline: true },
        { name: '🌐 Shard ID', value: `${shardId}`, inline: true },
        { name: '⏰ Uptime', value: formatUptime(client.uptime || 0), inline: true },
        { name: '💾 Memory Usage', value: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`, inline: true }
      )
      .setTimestamp();
    
    await interaction.editReply({ content: '', embeds: [pingEmbed] });
    console.log(`🏓 Ping command used by ${interaction.user.tag}`);
  }
  
  if (interaction.commandName === 'check') {
    // Check if user is allowed (either by user ID or role)
    const member = interaction.member;
    const hasRole = member && 'roles' in member && member.roles.cache.has(config.allowedRoleId);
    
    if (interaction.user.id !== config.allowedUserId && !hasRole) {
      await interaction.reply({ content: '❌ You do not have permission to use this command.', flags: 64 });
      return;
    }
    
    await interaction.deferReply({ flags: 64 });
    
    try {
      // Fetch all members in the guild
      const guild = interaction.guild;
      if (!guild) {
        await interaction.editReply('❌ Could not find guild.');
        return;
      }
      
      await guild.members.fetch();
      
      // Find members with target role but without booster role
      const problematicMembers = guild.members.cache.filter(member => 
        member.roles.cache.has(config.targetRoleId) && 
        !member.roles.cache.has(config.boosterRoleId)
      );
      
      if (problematicMembers.size === 0) {
        const successEmbed = new EmbedBuilder()
          .setColor(0x00FF00)
          .setTitle('✅ Audit Complete')
          .setDescription('All members with the target role are currently boosting!')
          .setTimestamp();
        
        await interaction.editReply({ embeds: [successEmbed] });
      } else {
        const memberList = problematicMembers.map(member => 
          `• ${member.user.tag} (${member.user.id})`
        ).join('\n');
        
        const warningEmbed = new EmbedBuilder()
          .setColor(0xFFA500)
          .setTitle('⚠️ Audit Results')
          .setDescription(`Found **${problematicMembers.size}** member(s) with the target role who are NOT boosting:`)
          .addFields({ name: 'Members', value: memberList || 'None' })
          .setTimestamp();
        
        await interaction.editReply({ embeds: [warningEmbed] });
        
        // Also send to admin channel - wrapped in try/catch to handle permission errors
        try {
          const adminChannel = await client.channels.fetch(config.adminChannelId);
          if (adminChannel?.isTextBased() && 'send' in adminChannel) {
            await adminChannel.send({ embeds: [warningEmbed] });
          }
        } catch (channelError) {
          console.error('⚠️ Could not send to admin channel (check bot permissions):', channelError);
        }
      }
      
      console.log(`🔍 Manual check performed by ${interaction.user.tag}`);
    } catch (error) {
      console.error('Error in check command:', error);
      await interaction.editReply('❌ An error occurred while checking members.');
    }
  }
});

// Helper function to format uptime
function formatUptime(ms: number): string {
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0) parts.push(`${seconds}s`);
  
  return parts.join(' ') || '0s';
}

// Function to register slash commands
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('test')
      .setDescription('Test command to verify embeds work (admin only)')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('ping')
      .setDescription('Check bot latency and information')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('check')
      .setDescription('Manually check for members with target role who are not boosting (admin only)')
      .toJSON(),
  ];
  
  const rest = new REST({ version: '10' }).setToken(config.token);
  
  try {
    console.log('🔄 Started refreshing application (/) commands.');
    
    // Delete all global commands (this removes duplicates)
    console.log('🗑️ Deleting old global commands...');
    await rest.put(
      Routes.applicationCommands(config.clientId),
      { body: [] }
    );
    console.log('✅ Deleted global commands.');
    
    // Register commands for specific guild (instant updates)
    await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.guildId),
      { body: commands }
    );
    
    console.log('✅ Successfully reloaded application (/) commands for guild.');
  } catch (error) {
    console.error('❌ Error registering commands:', error);
  }
}

// Login to Discord
client.login(config.token);