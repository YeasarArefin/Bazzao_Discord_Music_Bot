const express = require('express');
const app = express();
const port = process.env.PORT || 5000;
app.get('/', (req, res) => res.send('Bazzao Bot is running!'));
app.listen(port, () => console.log('✅ Bazzao Bot is Online!'));

require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, demuxProbe } = require('@discordjs/voice');
const ytdl = require('youtube-dl-exec');
const playdl = require('play-dl');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// Bot prefix
const PREFIX = '-';

// Store music queues and player states for each guild
const musicQueues = new Map();

class MusicQueue {
    constructor() {
        this.songs = []; // Current queue
        this.connection = null;
        this.player = null;
        this.isPlaying = false;
        this.currentChannel = null;
        this.updateInterval = null; // For progress bar updates
        this.startTime = null; // Track when song started
        this.idleHandler = null; // Store idle handler reference
        this.nowPlayingMessage = null; // Current now playing message
    }
}

client.once('ready', () => {
    console.log(`🎵 Logged in as ${client.user.tag}!`);
    console.log(`🎧 Use ${PREFIX}play <song> to play music!`);
});

// Handle message commands
client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const guildId = message.guild.id;

    if (!musicQueues.has(guildId)) {
        musicQueues.set(guildId, new MusicQueue());
    }

    const queue = musicQueues.get(guildId);
    queue.currentChannel = message.channel;

    switch (command) {
        case 'p':
        case 'play':
            if (queue.idleTimeout) {
                clearTimeout(queue.idleTimeout);
                queue.idleTimeout = null;
            }
            await handlePlay(message, queue, args.join(' '));
            break;
        case 'stop':
            await handleStop(message, queue);
            break;
        case 'queue':
            await handleQueue(message, queue);
            break;
        case 'pause':
            await handlePause(message, queue);
            break;
        case 'resume':
            await handleResume(message, queue);
            break;
    }
});

// Handle button interactions
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    const guildId = interaction.guild.id;
    const queue = musicQueues.get(guildId);
    if (!queue) return;
    const customId = interaction.customId;
    await interaction.deferUpdate();

    switch (customId) {
        case 'pause_resume':
            if (queue.player && queue.player.state.status === AudioPlayerStatus.Playing) {
                queue.player.pause();
            } else if (queue.player && queue.player.state.status === AudioPlayerStatus.Paused) {
                queue.player.unpause();
            }
            updateNowPlayingMessage(queue);
            break;
        case 'stop':
            handleStop(null, queue);
            break;
    }
});

// Function to clear the now playing message
function clearNowPlayingMessage(queue) {
    if (queue.nowPlayingMessage) {
        try {
            queue.nowPlayingMessage.delete().catch(console.error);
        } catch (error) {
            console.error('Error deleting now playing message:', error);
        }
        queue.nowPlayingMessage = null;
    }
}

// Function to show queue ended card
async function showQueueEndedCard(queue) {
    if (!queue.currentChannel) return;

    // Clear progress updates
    if (queue.updateInterval) {
        clearInterval(queue.updateInterval);
        queue.updateInterval = null;
    }

    const endedEmbed = new EmbedBuilder()
        .setColor('#2c0464')
        .setTitle('🎶 Queue Ended')
        .setDescription('The music queue has finished. Add more songs to keep the party going! 🥳')
        .setFooter({ text: `Use ${PREFIX}play <song name> to add more music!` });

    try {
        // Clear existing now playing message
        clearNowPlayingMessage(queue);

        // Create new ended card message without buttons
        queue.nowPlayingMessage = await queue.currentChannel.send({
            embeds: [endedEmbed]
        });
    } catch (error) {
        console.error('Error showing queue ended card:', error);
    }
}

async function handlePlay(message, queue, query) {
    if (!query) {
        return message.reply('Please provide a song name! Example: `#play never gonna give you up`');
    }

    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
        return message.reply('You need to be in a voice channel to play music!');
    }

    const loadingMessage = await message.reply('🔍 Searching for song...');

    try {
        let songInfo;
        const isURL = playdl.yt_validate(query) === 'video';

        if (isURL) {
            // Get info using youtube-dl-exec
            const info = await ytdl(query, {
                dumpSingleJson: true,
                noWarnings: true,
                preferFreeFormats: true,
                addHeader: ['referer:youtube.com', 'user-agent:googlebot']
            });

            songInfo = {
                title: info.title,
                url: query,
                duration: info.duration,
                thumbnail: info.thumbnail
            };
        } else {
            // Search using play-dl
            const searchResults = await playdl.search(query, { limit: 1 });
            if (searchResults.length === 0) {
                return loadingMessage.edit('❌ No songs found!');
            }
            songInfo = {
                title: searchResults[0].title,
                url: searchResults[0].url,
                duration: searchResults[0].durationInSec,
                thumbnail: searchResults[0].thumbnails[0]?.url
            };
        }

        const song = {
            title: songInfo.title,
            url: songInfo.url,
            duration: songInfo.duration,
            requestedBy: message.author.tag,
            thumbnail: songInfo.thumbnail
        };

        queue.songs.push(song);

        if (!queue.connection) {
            queue.connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,
            });

            queue.player = createAudioPlayer();
            queue.connection.subscribe(queue.player);

            // Create idle handler
            const idleHandler = async () => {
                if (queue.updateInterval) {
                    clearInterval(queue.updateInterval);
                    queue.updateInterval = null;
                }

                if (!queue.connection) return;

                // Clear current now playing message
                clearNowPlayingMessage(queue);

                const playedSong = queue.songs.shift();
                if (queue.songs.length > 0) {
                    await playNextSong(queue);
                } else {
                    queue.isPlaying = false;
                    await showQueueEndedCard(queue);

                    // Delay disconnect by 2 minutes
                    queue.idleTimeout = setTimeout(() => {
                        handleStop(null, queue);
                    }, 2 * 60 * 1000);
                }
            };

            // Store handler for skip functionality
            queue.idleHandler = idleHandler;
            queue.player.on(AudioPlayerStatus.Idle, idleHandler);

            // Error handling
            queue.player.on('error', error => {
                console.error('Audio Player Error:', error);
                if (queue.currentChannel) {
                    queue.currentChannel.send('❌ Player error. Skipping song...');
                }
                skipSong(queue);
            });
        }

        if (!queue.isPlaying) {
            await playNextSong(queue);
            loadingMessage.edit(`✅ Now playing: **${song.title}**`);
        } else {
            loadingMessage.edit(`✅ Added to queue: **${song.title}**`);
        }
    } catch (error) {
        console.error('Play Command Error:', error);
        loadingMessage.edit(`❌ Error: ${error.message}`);
    }
}

async function playNextSong(queue) {
    // Clear progress bar updates from previous song
    if (queue.updateInterval) {
        clearInterval(queue.updateInterval);
        queue.updateInterval = null;
    }

    if (queue.songs.length === 0 || !queue.connection) {
        queue.isPlaying = false;
        return;
    }

    const song = queue.songs[0];
    const maxRetries = 2;
    let retryCount = 0;
    let success = false;

    if (!queue.currentChannel) return;

    while (retryCount < maxRetries && !success) {
        try {
            console.log(`Playing: ${song.title} [Attempt ${retryCount + 1}]`);

            // Use youtube-dl-exec to stream audio directly
            const ytdlProcess = ytdl.exec(
                song.url,
                {
                    output: '-',
                    quiet: true,
                    format: 'bestaudio',
                    limitRate: '1M',
                    addHeader: ['referer:youtube.com', 'user-agent:googlebot'],
                    noCheckCertificates: true,
                    preferInsecure: true
                },
                { stdio: ['ignore', 'pipe', 'ignore'] }
            );

            if (!ytdlProcess.stdout) {
                throw new Error('Failed to create audio stream');
            }

            // Use demuxProbe to detect audio format
            const { stream, type } = await demuxProbe(ytdlProcess.stdout);

            // Create audio resource with detected type
            const resource = createAudioResource(stream, {
                inputType: type,
                inlineVolume: true
            });

            // Set volume
            resource.volume.setVolume(1); // Fixed at 100% volume

            queue.player.play(resource);
            queue.isPlaying = true;
            queue.startTime = Date.now(); // Track start time

            // Clear previous now playing message
            clearNowPlayingMessage(queue);

            // Create new now playing message
            await updateNowPlayingMessage(queue);

            // Start progress bar updates
            startProgressBarUpdates(queue);

            success = true;
        } catch (error) {
            console.error(`Play Error [Attempt ${retryCount + 1}]:`, error);
            retryCount++;

            if (retryCount >= maxRetries) {
                let errorMsg = `❌ Failed to play: **${song.title}**`;

                if (error.message.includes('age restricted')) {
                    errorMsg += '\n🔞 Age-restricted content cannot be played.';
                } else if (error.message.includes('unavailable')) {
                    errorMsg += '\n🌍 Region blocked - Try using VPN.';
                } else if (error.message.includes('private') || error.message.includes('embedding disabled')) {
                    errorMsg += '\n🔒 Private video or embedding disabled.';
                } else {
                    errorMsg += `\n💻 Error: ${error.message}`;
                }

                if (queue.currentChannel) {
                    queue.currentChannel.send(errorMsg);
                }
                skipSong(queue);
            }
        }
    }
}

// Skip to next song in queue
function skipSong(queue) {
    if (queue.songs.length === 0) {
        handleStop(null, queue);
        return;
    }

    // Remove current song
    queue.songs.shift();

    // Play next song if available
    if (queue.songs.length > 0) {
        playNextSong(queue);
    } else {
        handleStop(null, queue);
    }
}

// Function to start progress bar updates
function startProgressBarUpdates(queue) {
    // Clear any existing interval
    if (queue.updateInterval) {
        clearInterval(queue.updateInterval);
    }

    // Set up a new interval to update the progress bar every 5 seconds
    queue.updateInterval = setInterval(async () => {
        if (queue.player && queue.player.state.status === AudioPlayerStatus.Playing) {
            try {
                await updateNowPlayingMessage(queue);
            } catch (error) {
                console.error('Progress bar update error:', error);
            }
        }
    }, 5000);
}

async function updateNowPlayingMessage(queue) {
    if (!queue.currentChannel || queue.songs.length === 0) return;

    const song = queue.songs[0];
    let position = 0;
    if (queue.player?.state.status === AudioPlayerStatus.Playing) {
        position = queue.player.state.playbackDuration / 1000;
    } else if (queue.startTime) {
        position = (Date.now() - queue.startTime) / 1000;
    }

    const progressBarLength = 20;
    const progress = Math.min(1, position / song.duration);
    const progressPosition = Math.floor(progress * progressBarLength);
    const progressBar = '─'.repeat(progressBarLength);
    const progressBarWithMarker = `${progressBar.substring(0, progressPosition)}🔹${progressBar.substring(progressPosition + 1)}`;

    const embed = new EmbedBuilder()
        .setColor('#2e085b')
        .setTitle(`🎵 Now Playing`)
        .setDescription(`**[${song.title}](${song.url})**`)
        .setThumbnail(song.thumbnail)
        .addFields(
            { name: '⏱️ Time', value: `\`${formatDuration(position)} / ${formatDuration(song.duration)}\``, inline: true },
            { name: '🙋 Requested by', value: song.requestedBy, inline: true },
            { name: 'Progress', value: progressBarWithMarker, inline: false },
        )
        .setFooter({ text: `🎧 Enjoy your music!` });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('pause_resume')
            .setEmoji(queue.player?.state.status === AudioPlayerStatus.Playing ? '⏸️' : '▶️')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('stop')
            .setEmoji('⏹️')
            .setStyle(ButtonStyle.Secondary)
    );

    try {
        if (queue.nowPlayingMessage) {
            await queue.nowPlayingMessage.edit({ embeds: [embed], components: [row] });
        } else {
            queue.nowPlayingMessage = await queue.currentChannel.send({ embeds: [embed], components: [row] });
        }
    } catch (error) {
        console.error('Error updating now playing message:', error);
        // Attempt to create a new message if editing fails
        try {
            queue.nowPlayingMessage = await queue.currentChannel.send({ embeds: [embed], components: [row] });
        } catch (err) {
            console.error('Failed to create new now playing message:', err);
        }
    }
}

async function handleStop(message, queue) {
    if (!queue.connection) {
        if (message) message.reply('❌ No music is currently playing!');
        return;
    }

    // Show ended card only if stopping during playback
    if (queue.isPlaying || queue.songs.length > 0) {
        await showQueueEndedCard(queue);
    }

    // Clear progress bar updates
    if (queue.updateInterval) {
        clearInterval(queue.updateInterval);
        queue.updateInterval = null;
    }

    // Remove idle handler
    if (queue.idleHandler && queue.player) {
        queue.player.off(AudioPlayerStatus.Idle, queue.idleHandler);
        queue.idleHandler = null;
    }

    // Clean up player and connection
    if (queue.player) {
        queue.player.stop();
        queue.player = null;
    }

    if (queue.connection) {
        queue.connection.destroy();
        queue.connection = null;
    }

    // Reset queue state
    queue.songs = [];
    queue.isPlaying = false;
    queue.startTime = null;

    // Clear idle timeout if exists
    if (queue.idleTimeout) {
        clearTimeout(queue.idleTimeout);
        queue.idleTimeout = null;
    }

    if (message) message.reply('⏹️ Music stopped and bot disconnected!');
}

async function handlePause(message, queue) {
    if (!queue.player || queue.player.state.status !== AudioPlayerStatus.Playing) {
        message.reply('❌ No music is currently playing!');
        return;
    }

    queue.player.pause();
    message.reply('⏸️ Playback paused!');
    updateNowPlayingMessage(queue);
}

async function handleResume(message, queue) {
    if (!queue.player || queue.player.state.status !== AudioPlayerStatus.Paused) {
        message.reply('❌ Playback is not paused!');
        return;
    }

    queue.player.unpause();
    message.reply('▶️ Playback resumed!');
    updateNowPlayingMessage(queue);
}

async function handleQueue(message, queue) {
    if (queue.songs.length === 0) {
        return message.reply('📭 The queue is empty!');
    }

    const queueList = queue.songs.slice(0, 10).map((song, index) => {
        const duration = song.duration ? formatDuration(song.duration) : 'Unknown';
        return `${index + 1}. **${song.title}** (${duration}) - Requested by ${song.requestedBy}`;
    }).join('\n');

    message.reply({
        embeds: [{
            color: 0x3498db,
            title: '🎵 Current Queue',
            description: queueList,
            footer: { text: `Total songs: ${queue.songs.length}` }
        }]
    });
}

function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

client.login(process.env.BOT_TOKEN);